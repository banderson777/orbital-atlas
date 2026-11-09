const securityHeaders = {
  'Content-Security-Policy': "frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cache-Control': 'private, no-store',
};

export default {
  fetch(request) {
    const head = request.method === 'HEAD';
    const headers = new Headers(securityHeaders);
    if (!head && request.method !== 'GET') {
      headers.set('Allow', 'GET, HEAD');
      return new Response('Method not allowed', { status: 405, headers });
    }
    const { pathname } = new URL(request.url);
    const file = pathname === '/' ? '/index.html' : pathname;
    const asset = Object.hasOwn(assets, file) ? assets[file] : null;
    if (!asset) return new Response(head ? null : 'Not found', { status: 404, headers });
    const [contentType, body] = asset;
    headers.set('Content-Type', contentType);
    return new Response(head ? null : body, { headers });
  },
};
