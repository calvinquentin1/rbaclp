export const config = { matcher: ['/((?!api/|home/|_vercel).*)'] };

// home.cosaventures.com (Cosa Home Services, pay-per-lead pages)
//   /                -> /home/            brand page
//   /test, /demo     -> /home/test|demo/  fixed pages
//   /img/..., files  -> /home/img/...
//   /<client-slug>   -> /home/lp/         one shared lead page; it reads the slug and loads the client from Supabase
const STATIC_PAGES = { 'neighbors-ac': '/home/neighbors-ac/', 'neighbors-ac-test': '/home/neighbors-ac/' };
const FIXED = new Set(['test', 'demo', 'img', 'lp', 'privacy', 'terms']);

export default function middleware(request) {
  const url = new URL(request.url);
  // admin.cosagrowth.com -> the pay-per-lead agency dashboard (/ppl-admin)
  if (url.hostname === 'admin.cosagrowth.com') {
    const p = url.pathname === '/' ? '/ppl-admin/' : url.pathname;
    return new Response(null, { headers: { 'x-middleware-rewrite': new URL(p + url.search, url).toString() } });
  }
  // portal.cosagrowth.com -> the pay-per-lead client portal (/portal)
  if (url.hostname === 'portal.cosagrowth.com') {
    const p = url.pathname === '/' ? '/portal/' : url.pathname;
    return new Response(null, { headers: { 'x-middleware-rewrite': new URL(p + url.search, url).toString() } });
  }
  if (url.hostname !== 'home.cosaventures.com') return;
  const first = url.pathname.split('/').filter(Boolean)[0] || '';
  let path;
  if (STATIC_PAGES[first]) path = STATIC_PAGES[first]; // fully static client pages (draw instantly, no data fetch before first paint)
  else if (!first) path = '/home/';
  else if (FIXED.has(first) || url.pathname.includes('.')) path = '/home' + url.pathname;
  else path = '/home/lp/';
  return new Response(null, { headers: { 'x-middleware-rewrite': new URL(path + url.search, url).toString() } });
}
