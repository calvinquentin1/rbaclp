// Remote MCP server exposing one tool: generate_image, backed by Gemini.
//
// Served at /api/mcp/<MCP_SECRET>. A wrong secret returns 404, not 401, so
// probing the path reveals nothing about whether it exists.
//
// Deliberately dependency-free. The rest of this repo is a static site with no
// build step; pulling in a framework to host this would change how the landing
// pages are deployed, and those are live on paid traffic.

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "cosa-image", version: "1.0.0" };

const ASPECT_RATIOS = ["4:5", "1:1", "9:16"];

const TOOL = {
  name: "generate_image",
  description:
    "Generate an image with Google Gemini. Defaults to 4:5 (1080x1350), the Meta ad format.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "What the image should show.",
      },
      aspect_ratio: {
        type: "string",
        enum: ASPECT_RATIOS,
        description: "Defaults to 4:5.",
      },
    },
    required: ["prompt"],
    additionalProperties: false,
  },
};

// ── Gemini ────────────────────────────────────────────────────────────────
async function generateImage(prompt, aspectRatio) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set on the server.");

  const model = process.env.GEMINI_MODEL || "gemini-3-pro-image";

  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/interactions",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        model,
        input: [{ type: "text", text: prompt }],
        // aspect_ratio belongs here, not on the top-level body. Passing it as a
        // tool argument alone would be silently ignored and every image would
        // come back square.
        response_format: {
          type: "image",
          mime_type: "image/png",
          aspect_ratio: aspectRatio,
        },
      }),
    }
  );

  const text = await res.text();

  if (!res.ok) {
    // Surface the upstream message verbatim. A silent failure here costs a
    // whole session of guessing.
    throw new Error(`Gemini returned ${res.status}: ${text.slice(0, 1500)}`);
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Gemini returned unparseable JSON: ${text.slice(0, 500)}`);
  }

  // Convenience accessor first; fall back to walking the steps when the
  // response interleaves text and images.
  let image = body?.output_image;

  if (!image?.data && Array.isArray(body?.steps)) {
    for (const step of body.steps) {
      for (const part of step?.output ?? step?.content ?? []) {
        if (part?.type === "image" && part?.data) {
          image = part;
          break;
        }
      }
      if (image?.data) break;
    }
  }

  if (!image?.data) {
    throw new Error(
      `No image in the Gemini response. Body began: ${text.slice(0, 800)}`
    );
  }

  return {
    data: image.data,
    mimeType: image.mime_type || image.mimeType || "image/png",
  };
}

// ── JSON-RPC ──────────────────────────────────────────────────────────────
const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

async function handleRpc(msg) {
  const { id, method, params } = msg ?? {};

  switch (method) {
    case "initialize":
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });

    case "ping":
      return ok(id, {});

    case "tools/list":
      return ok(id, { tools: [TOOL] });

    case "tools/call": {
      if (params?.name !== "generate_image") {
        return fail(id, -32602, `Unknown tool: ${params?.name}`);
      }

      const prompt = params?.arguments?.prompt;
      if (typeof prompt !== "string" || !prompt.trim()) {
        return fail(id, -32602, "prompt is required.");
      }

      const requested = params?.arguments?.aspect_ratio ?? "4:5";
      const aspectRatio = ASPECT_RATIOS.includes(requested) ? requested : "4:5";

      try {
        const image = await generateImage(prompt.trim(), aspectRatio);
        return ok(id, {
          content: [
            { type: "image", data: image.data, mimeType: image.mimeType },
          ],
        });
      } catch (err) {
        // Tool-level error, so the model sees the reason and can react.
        return ok(id, {
          isError: true,
          content: [{ type: "text", text: String(err?.message ?? err) }],
        });
      }
    }

    default:
      return fail(id, -32601, `Method not found: ${method}`);
  }
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null && req.body !== "") {
    if (typeof req.body === "string") {
      try {
        return JSON.parse(req.body);
      } catch {
        return null;
      }
    }
    return req.body;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  // Wrong or missing secret looks exactly like a path that was never there.
  const provided = req.query?.secret;
  const expected = process.env.MCP_SECRET;
  if (!expected || provided !== expected) {
    res.status(404).send("Not Found");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).setHeader("Allow", "POST").send("Method Not Allowed");
    return;
  }

  const body = await readBody(req);
  if (!body) {
    res.status(400).json(fail(null, -32700, "Parse error"));
    return;
  }

  const batch = Array.isArray(body) ? body : [body];
  const replies = [];

  for (const msg of batch) {
    // Notifications have no id and get no response.
    if (msg?.id === undefined || msg?.id === null) continue;
    replies.push(await handleRpc(msg));
  }

  if (!replies.length) {
    res.status(202).end();
    return;
  }

  const payload = Array.isArray(body) ? replies : replies[0];

  // Some clients ask for a stream; give them one framed event rather than
  // failing the negotiation.
  const accept = String(req.headers.accept || "");
  if (accept.includes("text/event-stream")) {
    res.setHeader("content-type", "text/event-stream");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("connection", "keep-alive");
    res.write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
    res.end();
    return;
  }

  res.setHeader("content-type", "application/json");
  res.status(200).send(JSON.stringify(payload));
}
