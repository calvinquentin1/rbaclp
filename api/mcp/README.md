# Image MCP server

A remote MCP server exposing one tool, `generate_image(prompt, aspect_ratio)`, backed by Google's Gemini image API. It lives at `/api/mcp/<MCP_SECRET>` on this project's Vercel deployment and is added to Claude as a custom connector by pasting that full URL. `aspect_ratio` accepts `4:5` (default, 1080×1350 — the Meta ad format), `1:1` or `9:16`, and is sent to Gemini inside `response_format`, which is the only place the API reads it. Three environment variables drive it, all set in Vercel and never in this repo: **`GEMINI_API_KEY`**, **`GEMINI_MODEL`** and **`MCP_SECRET`**. **To rotate the API key**, issue a new key in Google AI Studio, update `GEMINI_API_KEY` in Vercel → Settings → Environment Variables, redeploy, then revoke the old key — in that order, so there's no window where the connector is broken. **To swap the model**, change `GEMINI_MODEL` and redeploy; valid values are `gemini-3-pro-image` (best text rendering, use for ad creative), `gemini-3.1-flash-image`, `gemini-3.1-flash-lite-image` (cheapest) and `gemini-2.5-flash-image` (legacy). **To rotate the URL secret**, change `MCP_SECRET`, redeploy, and update the connector URL in Claude — the old URL starts returning 404 immediately.

## Notes

- A wrong or missing secret returns **404, not 401**, so probing the path reveals nothing. If `MCP_SECRET` is unset on the server, every request 404s — it fails closed.
- Written without dependencies on purpose. The rest of this repo is a static site with no build step, and adding a framework to host this would change how the landing pages are deployed.
- Upstream Gemini failures are returned as tool errors carrying the upstream message verbatim, never swallowed.
- `maxDuration` is set to 300s in `vercel.json`.

## Testing it standalone

The protocol layer has a test covering the secret check, `initialize`, `tools/list`, `tools/call`, the aspect-ratio plumbing, error surfacing and SSE negotiation. Against the deployed URL, the equivalent smoke test is:

```bash
curl -s -X POST "https://ads.cosaventures.com/api/mcp/YOUR_SECRET" \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```
