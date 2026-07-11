import type { APIRoute } from 'astro';

const pbUrl = (import.meta.env.PB_URL || 'http://127.0.0.1:8090').replace(/\/$/, '');
const ownerEmail = 'isuvo@outlook.com';
const cookieName = 'ixuvo_writer_session';
const sessionSeconds = 4 * 60 * 60;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function refreshWriter(token: string) {
  const response = await fetch(`${pbUrl}/api/collections/blog_authors/auth-refresh`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json().catch(() => ({}));
  return response.ok && data.record?.email === ownerEmail ? data : null;
}

export const POST: APIRoute = async ({ request, cookies }) => {
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

  const response = await fetch(`${pbUrl}/api/collections/blog_authors/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identity: credentials?.identity,
      password: credentials?.password,
    }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    return json(data, response.status);
  }

  if (!data.record?.email || data.record.email !== ownerEmail) {
    return json({ message: 'This writer is restricted to the owner account.' }, 403);
  }

  cookies.set(cookieName, data.token, {
    httpOnly: true,
    secure: new URL(request.url).protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    maxAge: sessionSeconds,
  });

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

export const DELETE: APIRoute = ({ cookies }) => {
  cookies.delete(cookieName, { path: '/' });
  return new Response(null, { status: 204 });
};
