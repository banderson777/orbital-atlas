/**
 * HTTP handler for the hosted atlas.
 *
 * build_worker.py prepends the asset table when generating the entry point.
 * Sites checks visitor access upstream. This handler serves the chart files
 * and applies security headers to both successful and error responses.
 * @file
 */

const securityHeaders = {
  'Content-Security-Policy': "frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cache-Control': 'private, no-store',
};

export default {
  /**
   * Serve a bundled asset for GET or return its headers for HEAD.
   * @param {Request} request - Incoming request from the Sites runtime.
   * @returns {Response} The asset response or an HTTP error.
   */
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
