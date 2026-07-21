import { getPublishedPostsForSitemap } from '../lib/pocketbase.js';
import { blogPathForSlug } from '../lib/blogUrls.js';

const PRODUCTION_ORIGIN = 'https://ixuvo.com';
const PUBLIC_STATIC_ROUTES = ['/', '/blog'];

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isExcludedPath(pathname) {
  return pathname === '/write'
    || pathname.startsWith('/write/')
    || pathname === '/admin'
    || pathname.startsWith('/admin/')
    || pathname === '/api'
    || pathname.startsWith('/api/')
    || pathname === '/healthz'
    || pathname === '/404'
    || pathname.startsWith('/404/');
}

function normalizeLastmod(value) {
  const timestamp = Date.parse(value || '');
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

export async function GET() {
  let posts;

  try {
    posts = await getPublishedPostsForSitemap();
  } catch (error) {
    console.error('Unable to build sitemap from PocketBase.', error);
    return new Response('Sitemap is temporarily unavailable.\n', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const latestPocketBaseModification = posts
    .map((post) => normalizeLastmod(post.updated))
    .filter(Boolean)
    .sort()
    .at(-1) || null;
  const urls = new Map();

  function addUrl(pathname, lastmod) {
    if (isExcludedPath(pathname)) return;

    const url = new URL(pathname, PRODUCTION_ORIGIN);
    if (url.origin !== PRODUCTION_ORIGIN || urls.has(url.href)) return;

    urls.set(url.href, {
      loc: url.href,
      lastmod: normalizeLastmod(lastmod),
    });
  }

  for (const route of PUBLIC_STATIC_ROUTES) {
    addUrl(route, latestPocketBaseModification);
  }

  for (const post of posts) {
    addUrl(blogPathForSlug(post.slug), post.updated);
  }

  const body = Array.from(urls.values())
    .map(({ loc, lastmod }) => [
      '  <url>',
      `    <loc>${escapeXml(loc)}</loc>`,
      lastmod ? `    <lastmod>${escapeXml(lastmod)}</lastmod>` : null,
      '  </url>',
    ].filter(Boolean).join('\n'))
    .join('\n');
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    body,
    '</urlset>',
    '',
  ].join('\n');

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
