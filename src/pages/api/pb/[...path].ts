import type { APIRoute } from 'astro';
import { Buffer } from 'node:buffer';
import { resolveSourceUrls } from '../../../lib/sourceUrls.js';
import { exceedsContentLength, isSameOriginRequest } from '../../../lib/security.js';

const pbUrl = String(import.meta.env.PB_URL || '').trim().replace(/\/$/, '');

if (!pbUrl) {
  throw new Error('PB_URL environment variable is required.');
}

const allowedRoutes = [
  /^api\/collections\/posts\/records(?:\/[a-zA-Z0-9_-]+)?$/,
  /^api\/files\/posts\/[a-zA-Z0-9_-]+\/[^/]+$/,
];
const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const maxCoverImageBytes = 5 * 1024 * 1024;
const maxEmbeddedImageBytes = 10 * 1024 * 1024;
const maxTotalImageBytes = 30 * 1024 * 1024;
const maxRequestBytes = 48 * 1024 * 1024;

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

function json(data: unknown, status: number, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

function decodeImage(value: unknown, maxBytes: number) {
  if (!value || typeof value !== 'object') throw new Error('Invalid image upload.');
  const image = value as { data?: unknown; name?: unknown; type?: unknown };
  const data = typeof image.data === 'string' ? image.data : '';
  const name = typeof image.name === 'string' ? image.name.trim() : '';
  const type = typeof image.type === 'string' ? image.type.toLowerCase() : '';

  const hasUnsafeName = name.includes('/') || name.includes('\\') || [...name].some((character) => character.charCodeAt(0) < 32);
  if (!data || !name || name.length > 180 || hasUnsafeName || !allowedImageTypes.has(type)) {
    throw new Error('Images must be valid JPG, PNG, WebP, or GIF files.');
  }
  if (!/^[a-zA-Z0-9+/]*={0,2}$/.test(data) || Math.ceil(data.length * 3 / 4) > maxBytes + 2) {
    throw new Error(`Image exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MB limit.`);
  }

  const bytes = Buffer.from(data, 'base64');
  if (!bytes.length || bytes.length > maxBytes) {
    throw new Error(`Image exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MB limit.`);
  }

  const validSignature =
    (type === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    (type === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
    (type === 'image/gif' && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) ||
    (type === 'image/webp' && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP');
  if (!validSignature) throw new Error('Image content does not match its declared file type.');

  return { bytes, name, type };
}

export const ALL: APIRoute = async ({ params, request, url }) => {
  const path = params.path || '';

  if (!isAllowedPath(path)) {
    return json({ message: 'PocketBase proxy route is not allowed.' }, 403);
  }

  if (!['GET', 'HEAD'].includes(request.method) && !isSameOriginRequest(request)) {
    return json({ message: 'Cross-site requests are not allowed.' }, 403);
  }

  if (exceedsContentLength(request, maxRequestBytes)) {
    return json({ message: 'Request is too large.' }, 413);
  }

  const targetUrl = new URL(`${pbUrl}/${path}`);
  targetUrl.search = url.search;

  const headers = new Headers();
  const cookieToken = writerTokenFromCookie(request.headers.get('cookie'));
  const authorization = cookieToken ? `Bearer ${cookieToken}` : '';
  const contentType = request.headers.get('content-type');
  const overrideMethod = request.headers.get('x-http-method-override')?.toUpperCase();
  const upstreamMethod =
    request.method === 'POST' &&
    overrideMethod === 'DELETE' &&
    /^api\/collections\/posts\/records\/[a-zA-Z0-9_-]+$/.test(path)
      ? 'DELETE'
      : request.method;

  const isPostRecordRoute = /^api\/collections\/posts\/records(?:\/[a-zA-Z0-9_-]+)?$/.test(path);
  const isFileRoute = /^api\/files\/posts\/[a-zA-Z0-9_-]+\/[^/]+$/.test(path);
  if (isFileRoute && !['GET', 'HEAD'].includes(request.method)) {
    return json({ message: 'Method not allowed.' }, 405, { Allow: 'GET, HEAD' });
  }

  const writerAuthorized = authorization ? await isAuthorizedWriter(authorization) : false;
  if (isPostRecordRoute && !writerAuthorized) {
    return json({ message: 'Writer authentication required.' }, 401);
  }

  if (isFileRoute && !writerAuthorized) {
    const recordId = path.split('/')[3];
    const recordResponse = await fetch(`${pbUrl}/api/collections/posts/records/${recordId}?fields=id,status`);
    const record = await recordResponse.json().catch(() => ({}));
    if (!recordResponse.ok || record.status !== 'published') {
      return json({ message: 'File not found.' }, 404);
    }
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
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ message: 'Invalid JSON request.' }, 400);
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return json({ message: 'Invalid post payload.' }, 400);
    }
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
      if (embeddedImages.length > 10) {
        return json({ message: 'Upload no more than 10 embedded images at once.' }, 413);
      }

      let decodedCover;
      let decodedEmbedded;
      try {
        decodedCover = hasCoverImage ? decodeImage(coverImage, maxCoverImageBytes) : null;
        decodedEmbedded = embeddedImages
          .filter((image) => image?.data && image?.name && image?.type)
          .map((image) => decodeImage(image, maxEmbeddedImageBytes));
      } catch (error) {
        return json({ message: error instanceof Error ? error.message : 'Invalid image upload.' }, 400);
      }

      const totalImageBytes = (decodedCover?.bytes.length || 0) + decodedEmbedded.reduce((sum, image) => sum + image.bytes.length, 0);
      if (totalImageBytes > maxTotalImageBytes) {
        return json({ message: 'Combined image uploads must be 30 MB or smaller.' }, 413);
      }

      const form = new FormData();
      delete payload._cover_image;
      delete payload._embedded_images;

      for (const [key, value] of Object.entries(payload)) {
        if (value === undefined || value === null) {
          continue;
        }

        form.set(key, Array.isArray(value) || typeof value === 'object' ? JSON.stringify(value) : String(value));
      }

      if (decodedCover) {
        form.set('cover_image', new Blob([decodedCover.bytes], { type: decodedCover.type }), decodedCover.name);
      }

      const isRecordUpdate =
        upstreamMethod === 'PATCH' && /^api\/collections\/posts\/records\/[a-zA-Z0-9_-]+$/.test(path);
      const embeddedFieldName = isRecordUpdate ? 'embedded_images+' : 'embedded_images';

      for (const image of decodedEmbedded) {
        form.append(embeddedFieldName, new Blob([image.bytes], { type: image.type }), image.name);
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
      'Cache-Control': isFileRoute && response.ok ? 'public, max-age=3600' : 'no-store',
    },
  });
};
