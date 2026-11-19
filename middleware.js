// home.cosaventures.com = Cosa Home Services (homeowner lead pages). Serve everything on that host from /home/*.
// ads.cosaventures.com (and every other host) is untouched.
export const config = { matcher: ['/((?!api/|home/|_vercel).*)'] };

export default function middleware(request) {
  const url = new URL(request.url);
  if (url.hostname !== 'home.cosaventures.com') return;
  const path = url.pathname === '/' ? '/home/' : '/home' + url.pathname;
  return new Response(null, { headers: { 'x-middleware-rewrite': new URL(path + url.search, url).toString() } });
}
