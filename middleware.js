export const config = { matcher: ['/((?!api/|home/|_vercel).*)'] };

// home.cosaventures.com (Cosa Home Services, pay-per-lead pages)
//   /                -> /home/            brand page
//   /test, /demo     -> /home/test|demo/  fixed pages
//   /img/..., files  -> /home/img/...
//   /<client-slug>   -> /home/lp/         one shared lead page; it reads the slug and loads the client from Supabase
const FIXED = new Set(['test', 'demo', 'img', 'lp', 'privacy', 'terms']);

export default function middleware(request) {
  const url = new URL(request.url);
  if (url.hostname !== 'home.cosaventures.com') return;
  const first = url.pathname.split('/').filter(Boolean)[0] || '';
  let path;
  if (!first) path = '/home/';
  else if (FIXED.has(first) || url.pathname.includes('.')) path = '/home' + url.pathname;
  else path = '/home/lp/';
  return new Response(null, { headers: { 'x-middleware-rewrite': new URL(path + url.search, url).toString() } });
}
