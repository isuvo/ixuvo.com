import type { APIRoute } from 'astro';
import {
  clearRateLimit,
  clientAddress,
  exceedsContentLength,
  isSameOriginRequest,
  takeRateLimit,
} from '../../lib/security.js';

const pbUrl = String(import.meta.env.PB_URL || '').trim().replace(/\/$/, '');
const cookieName = 'ixuvo_writer_session';
const sessionSeconds = 4 * 60 * 60;

if (!pbUrl) {
  throw new Error('PB_URL environment variable is required.');
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

async function refreshWriter(token: string) {
  const response = await fetch(`${pbUrl}/api/collections/blog_authors/auth-refresh`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json().catch(() => ({}));
  return response.ok && data.record?.verified === true ? data : null;
}

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isSameOriginRequest(request)) {
    return json({ message: 'Cross-site requests are not allowed.' }, 403);
  }

  if (exceedsContentLength(request, 4096)) {
    return json({ message: 'Login request is too large.' }, 413);
  }

  let credentials;
  try {
    credentials = await request.json();
  } catch {
    return json({ message: 'Invalid login request.' }, 400);
  }

  if (credentials?.action === 'logout') {
    cookies.delete(cookieName, { path: '/' });
    return json({ ok: true });
  }

  const identity = typeof credentials?.identity === 'string' ? credentials.identity.trim() : '';
  const password = typeof credentials?.password === 'string' ? credentials.password : '';
  if (!identity || !password || identity.length > 320 || password.length > 1024) {
    return json({ message: 'Invalid email or password.' }, 401);
  }

  const rateLimitKey = `writer-login:${clientAddress(request)}`;
  const rateLimit = takeRateLimit(rateLimitKey, 5, 15 * 60 * 1000);
  if (!rateLimit.allowed) {
    return new Response(JSON.stringify({ message: 'Too many login attempts. Please try again later.' }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Retry-After': String(rateLimit.retryAfter),
      },
    });
  }

  let response;
  let data;
  try {
    response = await fetch(`${pbUrl}/api/collections/blog_authors/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity, password }),
    });
    data = await response.json().catch(() => ({}));
  } catch {
    return json({ message: 'Login service is temporarily unavailable.' }, 502);
  }

  if (!response.ok) {
    return json({ message: 'Invalid email or password.' }, 401);
  }

  if (data.record?.verified !== true) {
    return json({ message: 'Verify your author account before logging in.' }, 403);
  }

  cookies.set(cookieName, data.token, {
    httpOnly: true,
    secure: new URL(request.url).protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    maxAge: sessionSeconds,
  });
  clearRateLimit(rateLimitKey);

  return json({
    record: data.record,
    expiresAt: Date.now() + sessionSeconds * 1000,
  });
};

export const GET: APIRoute = async ({ cookies }) => {
  const token = cookies.get(cookieName)?.value;
  if (!token) {
    return json({ message: 'Not logged in.' }, 401);
  }

  const data = await refreshWriter(token);
  if (!data) {
    cookies.delete(cookieName, { path: '/' });
    return json({ message: 'Session expired.' }, 401);
  }

  return json({ record: data.record });
};

export const DELETE: APIRoute = ({ request, cookies }) => {
  if (!isSameOriginRequest(request)) {
    return json({ message: 'Cross-site requests are not allowed.' }, 403);
  }
  cookies.delete(cookieName, { path: '/' });
  return new Response(null, { status: 204 });
};
