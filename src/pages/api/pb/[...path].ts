import type { APIRoute } from 'astro';
import { Buffer } from 'node:buffer';
import { resolveSourceUrls } from '../../../lib/sourceUrls.js';

const pbUrl = String(import.meta.env.PB_URL || '').trim().replace(/\/$/, '');

if (!pbUrl) {
  throw new Error('PB_URL environment variable is required.');
}

const allowedRoutes = [
  /^api\/collections\/posts\/records(?:\/[a-zA-Z0-9_-]+)?$/,
  /^api\/files\/posts\/[a-zA-Z0-9_-]+\/[^/]+$/,
];

function isAllowedPath(path: string) {
  return allowedRoutes.some((pattern) => pattern.test(path));
}

function writerTokenFromCookie(cookieHeader: string | null) {
  const match = cookieHeader?.match(/(?:^|;\s*)ixuvo_writer_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function sourceUrlArray(value: unknown) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String).map((item) => item.trim()).filter(Boolean);
  } catch {
    // Fall through to newline/comma parsing for the writer payload.
  }

  return value.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
}

async function isAuthorizedWriter(authorization: string) {
  if (!authorization) {
    return false;
  }

  try {
    const response = await fetch(`${pbUrl}/api/collections/blog_authors/auth-refresh`, {
      method: 'POST',
      headers: { Authorization: authorization },
    });
    const data = await response.json().catch(() => ({}));
    return response.ok && data.record?.verified === true;
  } catch {
    return false;
  }
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
  const cookieToken = writerTokenFromCookie(request.headers.get('cookie'));
  const authorization = request.headers.get('authorization') || request.headers.get('x-writer-token') || (cookieToken ? `Bearer ${cookieToken}` : '');
  const contentType = request.headers.get('content-type');
  const overrideMethod = request.headers.get('x-http-method-override')?.toUpperCase();
  const upstreamMethod =
    request.method === 'POST' &&
    overrideMethod === 'DELETE' &&
    /^api\/collections\/posts\/records\/[a-zA-Z0-9_-]+$/.test(path)
      ? 'DELETE'
      : request.method;

  const isPostRecordRoute = /^api\/collections\/posts\/records(?:\/[a-zA-Z0-9_-]+)?$/.test(path);
  if (isPostRecordRoute && !(await isAuthorizedWriter(authorization))) {
    return new Response(JSON.stringify({ message: 'Writer authentication required.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

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
    if (payload.status === 'published' && Object.hasOwn(payload, 'source_urls')) {
      const sourceResolution = await resolveSourceUrls(sourceUrlArray(payload.source_urls), { timeoutMs: 5000 });
      const invalidSources = sourceResolution.results.filter((result) => result.status === 'invalid');

      if (invalidSources.length) {
        return new Response(JSON.stringify({
          message: 'Published sources must use valid public HTTPS URLs.',
          data: { source_urls: invalidSources },
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      payload.source_urls = sourceResolution.urls;
      for (const result of sourceResolution.unresolved) {
        console.warn('[source-url-review]', JSON.stringify({
          path,
          original: result.original,
          reason: result.reason,
          omitted: !sourceResolution.urls.includes(result.original),
        }));
      }
    }

    const coverImage = payload._cover_image;
    const embeddedImages = Array.isArray(payload._embedded_images) ? payload._embedded_images : [];
    const hasCoverImage = Boolean(coverImage?.data && coverImage?.name && coverImage?.type);
    const hasEmbeddedImages = embeddedImages.some((image) => image?.data && image?.name && image?.type);

    if (hasCoverImage || hasEmbeddedImages) {
      const form = new FormData();
      delete payload._cover_image;
      delete payload._embedded_images;

      for (const [key, value] of Object.entries(payload)) {
        if (value === undefined || value === null) {
          continue;
        }

        form.set(key, Array.isArray(value) || typeof value === 'object' ? JSON.stringify(value) : String(value));
      }

      if (hasCoverImage) {
        const bytes = Buffer.from(String(coverImage.data), 'base64');
        form.set('cover_image', new Blob([bytes], { type: String(coverImage.type) }), String(coverImage.name));
      }

      const isRecordUpdate =
        upstreamMethod === 'PATCH' && /^api\/collections\/posts\/records\/[a-zA-Z0-9_-]+$/.test(path);
      const embeddedFieldName = isRecordUpdate ? 'embedded_images+' : 'embedded_images';

      for (const image of embeddedImages) {
        if (!image?.data || !image?.name || !image?.type) {
          continue;
        }

        const bytes = Buffer.from(String(image.data), 'base64');
        form.append(embeddedFieldName, new Blob([bytes], { type: String(image.type) }), String(image.name));
      }

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
