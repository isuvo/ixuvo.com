import type { APIRoute } from 'astro';
import { Buffer } from 'node:buffer';

const pbUrl = (import.meta.env.PB_URL || 'http://127.0.0.1:8090').replace(/\/$/, '');

const allowedRoutes = [
  /^api\/collections\/blog_authors\/auth-with-password$/,
  /^api\/collections\/posts\/records(?:\/[a-zA-Z0-9_-]+)?$/,
  /^api\/files\/posts\/[a-zA-Z0-9_-]+\/[^/]+$/,
];

function isAllowedPath(path: string) {
  return allowedRoutes.some((pattern) => pattern.test(path));
}

export const ALL: APIRoute = async ({ params, request, url }) => {
  const path = params.path || '';

  if (!isAllowedPath(path)) {
    return new Response(JSON.stringify({ message: 'PocketBase proxy route is not allowed.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const targetUrl = new URL(`${pbUrl}/${path}`);
  targetUrl.search = url.search;

  const headers = new Headers();
  const authorization = request.headers.get('authorization') || request.headers.get('x-writer-token');
  const contentType = request.headers.get('content-type');
  const overrideMethod = request.headers.get('x-http-method-override')?.toUpperCase();
  const upstreamMethod =
    request.method === 'POST' &&
    overrideMethod === 'DELETE' &&
    /^api\/collections\/posts\/records\/[a-zA-Z0-9_-]+$/.test(path)
      ? 'DELETE'
      : request.method;

  if (authorization) {
    headers.set('Authorization', authorization);
  }

  if (contentType) {
    headers.set('content-type', contentType);
  }

  let body: BodyInit | undefined;

  if (upstreamMethod === 'GET' || upstreamMethod === 'HEAD' || upstreamMethod === 'DELETE') {
    body = undefined;
  } else if (
    contentType?.includes('application/json') &&
    /^api\/collections\/posts\/records(?:\/[a-zA-Z0-9_-]+)?$/.test(path)
  ) {
    const payload = await request.json();
    const coverImage = payload._cover_image;

    if (coverImage?.data && coverImage?.name && coverImage?.type) {
      const form = new FormData();
      delete payload._cover_image;

      for (const [key, value] of Object.entries(payload)) {
        if (value === undefined || value === null) {
          continue;
        }

        form.set(key, Array.isArray(value) || typeof value === 'object' ? JSON.stringify(value) : String(value));
      }

      const bytes = Buffer.from(String(coverImage.data), 'base64');
      form.set('cover_image', new Blob([bytes], { type: String(coverImage.type) }), String(coverImage.name));
      headers.delete('content-type');
      body = form;
    } else {
      body = JSON.stringify(payload);
    }
  } else {
    body = await request.arrayBuffer();
  }

  const response = await fetch(targetUrl, {
    method: upstreamMethod,
    headers,
    body,
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      'Content-Type': response.headers.get('content-type') || 'application/json',
    },
  });
};
