// Serves the static Wayfarer app from the ASSETS binding under a path prefix.
// https://arifhosan.me/wayfarer/...  ->  ./app/...
// On the workers.dev preview URL (no prefix) files are served from the root as well.
const BASE = '/wayfarer';

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com https://cdn.jsdelivr.net",
  "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net",
  "img-src 'self' data: blob: https://server.arcgisonline.com https://unpkg.com",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === BASE) return Response.redirect(`${url.origin}${BASE}/${url.search}`, 301);
    if (url.pathname.startsWith(BASE + '/')) url.pathname = url.pathname.slice(BASE.length);

    const res = await env.ASSETS.fetch(new Request(url, request));
    const headers = new Headers(res.headers);
    headers.set('Content-Security-Policy', CSP);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), interest-cohort=()');
    headers.set('X-Frame-Options', 'DENY');
    // the bundled geo data is large and versioned with the code: cache it for a day
    if (url.pathname.startsWith('/geo/')) headers.set('Cache-Control', 'public, max-age=86400');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  },
};
