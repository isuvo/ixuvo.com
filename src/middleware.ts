import { defineMiddleware } from 'astro:middleware';
import { randomBytes } from 'node:crypto';

function contentSecurityPolicy(nonce: string) {
  return [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  `script-src 'self' 'nonce-${nonce}' https://www.googletagmanager.com https://www.clarity.ms https://scripts.clarity.ms https://platform.x.com https://platform.twitter.com https://cdn.syndication.twimg.com`,
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.clarity.ms https://*.google-analytics.com https://*.googletagmanager.com https://*.twimg.com",
  "font-src 'self' data:",
  "connect-src 'self' https://*.clarity.ms https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://cloudflareinsights.com https://*.x.com https://*.twitter.com",
  "frame-src https://platform.x.com https://platform.twitter.com https://syndication.twitter.com",
  "worker-src 'self' blob:",
  "upgrade-insecure-requests",
  ].join('; ');
}

export const onRequest = defineMiddleware(async ({ request, url, locals }, next) => {
  const nonce = randomBytes(16).toString('base64');
  locals.cspNonce = nonce;
  const response = await next();
  const headers = new Headers(response.headers);

  headers.set('Content-Security-Policy', contentSecurityPolicy(nonce));
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Permissions-Policy', 'camera=(), geolocation=(), microphone=(), payment=(), usb=()');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');

  if (url.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https') {
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  if (url.pathname === '/write' || url.pathname.startsWith('/api/')) {
    headers.set('Cache-Control', 'no-store');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
