import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getPublishedPosts } from '../src/lib/pocketbase.js';
import { blogCanonicalForSlug, blogPathForSlug } from '../src/lib/blogUrls.js';

const args = new Set(process.argv.slice(2));
const createBaseline = args.has('--create-baseline');
const baseArg = process.argv.find((value) => value.startsWith('--base-url='));
const baseUrl = (baseArg ? baseArg.slice('--base-url='.length) : 'https://ixuvo.com').replace(/\/$/, '');
const baselinePath = resolve('reports', 'blog-url-baseline.json');

function decodeHtml(value = '') {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    result[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? '');
  }
  return result;
}

function canonicalValue(html) {
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const attrs = attributes(tag);
    if ((attrs.rel || '').split(/\s+/).includes('canonical')) return attrs.href || '';
  }
  return '';
}

function robotsValue(html) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = attributes(tag);
    if (attrs.name === 'robots') return (attrs.content || '').toLowerCase();
  }
  return '';
}

function firstHeading(html) {
  const match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  return match ? decodeHtml(match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()) : '';
}

async function mapWithConcurrency(items, limit, mapper) {
  const output = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      output[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

async function inspectLivePost(post) {
  const canonicalUrl = blogCanonicalForSlug(post.slug);
  const response = await fetch(`${baseUrl}${blogPathForSlug(post.slug)}`, { redirect: 'manual' });
  const html = await response.text();
  const robots = robotsValue(html);
  return {
    recordId: post.id,
    slug: post.slug,
    canonicalUrl,
    title: post.title,
    publicationDate: post.published_at,
    indexingStatus: robots.includes('noindex') ? 'noindex' : 'index',
    httpStatus: response.status,
    liveCanonical: canonicalValue(html),
    liveTitle: firstHeading(html),
    socialLinksPresent: html.includes('https://x.com/intent/tweet')
      && html.includes('https://www.linkedin.com/sharing/share-offsite/')
      && html.includes(`data-post-url="${canonicalUrl}"`),
  };
}

function fail(errors) {
  for (const error of errors) console.error(`[url-protection] ${error}`);
  if (errors.length) process.exitCode = 1;
}

await mkdir(resolve('reports'), { recursive: true });
const posts = await getPublishedPosts(500);
const sitemapResponse = await fetch(`${baseUrl}/sitemap.xml`, { redirect: 'manual' });
const sitemap = await sitemapResponse.text();

if (createBaseline) {
  const livePosts = await mapWithConcurrency(posts, 8, inspectLivePost);
  const errors = [];
  for (const item of livePosts) {
    if (item.httpStatus !== 200) errors.push(`${item.canonicalUrl} returned ${item.httpStatus}, expected 200.`);
    if (item.liveCanonical !== item.canonicalUrl) errors.push(`${item.canonicalUrl} canonical is ${item.liveCanonical || 'missing'}.`);
    if (item.liveTitle !== item.title) errors.push(`${item.canonicalUrl} does not render its protected title.`);
    if (!item.socialLinksPresent) errors.push(`${item.canonicalUrl} is missing protected social-sharing links.`);
    if (item.indexingStatus !== 'index') errors.push(`${item.canonicalUrl} is unexpectedly noindex.`);
    if (!sitemap.includes(item.canonicalUrl)) errors.push(`${item.canonicalUrl} is missing from the sitemap.`);
  }
  fail(errors);
  if (errors.length) process.exit(1);

  const baseline = {
    createdAt: new Date().toISOString(),
    baseUrl,
    protectedPostCount: livePosts.length,
    protections: {
      slugs: 'immutable',
      canonicalUrls: 'immutable',
      publicationDates: 'immutable',
      publishedStatus: 'immutable',
      indexingStatus: 'no noindex without manual approval',
      redirects: 'forbidden',
      sitemapMembership: 'required',
      directHttpStatus: 200,
    },
    posts: livePosts.map(({ liveCanonical: _liveCanonical, liveTitle: _liveTitle, socialLinksPresent: _socialLinksPresent, ...item }) => ({
      ...item,
      sitemapIncluded: true,
    })),
  };
  await writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  console.log(`Protected baseline created: ${baselinePath} (${baseline.posts.length} posts).`);
  process.exit(0);
}

const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
const errors = [];
const currentById = new Map(posts.map((post) => [post.id, post]));
const baselineIds = new Set(baseline.posts.map((post) => post.recordId));

if (posts.length !== baseline.protectedPostCount) {
  errors.push(`Published post count changed from ${baseline.protectedPostCount} to ${posts.length}.`);
}

for (const post of posts) {
  if (!baselineIds.has(post.id)) errors.push(`Unexpected published record outside the protected baseline: ${post.id} (${post.slug}).`);
}

const livePosts = await mapWithConcurrency(baseline.posts, 8, async (protectedPost) => {
  const current = currentById.get(protectedPost.recordId);
  if (!current) return { protectedPost, current: null, live: null };
  return { protectedPost, current, live: await inspectLivePost(current) };
});

for (const { protectedPost, current, live } of livePosts) {
  if (!current) {
    errors.push(`Protected record ${protectedPost.recordId} (${protectedPost.slug}) is missing or unpublished.`);
    continue;
  }
  if (current.slug !== protectedPost.slug) errors.push(`Slug changed for ${protectedPost.recordId}: ${protectedPost.slug} -> ${current.slug}.`);
  if (current.title !== protectedPost.title) errors.push(`Visible title changed for ${protectedPost.canonicalUrl}.`);
  if (current.published_at !== protectedPost.publicationDate) errors.push(`Publication date changed for ${protectedPost.canonicalUrl}.`);
  if (blogCanonicalForSlug(current.slug) !== protectedPost.canonicalUrl) errors.push(`Canonical generator changed for ${protectedPost.slug}.`);
  if (!live) continue;
  if (live.httpStatus !== 200) errors.push(`${protectedPost.canonicalUrl} returned ${live.httpStatus}; redirects and errors are forbidden.`);
  if (live.liveCanonical !== protectedPost.canonicalUrl) errors.push(`${protectedPost.canonicalUrl} canonical changed to ${live.liveCanonical || 'missing'}.`);
  if (live.liveTitle !== protectedPost.title) errors.push(`${protectedPost.canonicalUrl} no longer renders its protected post title.`);
  if (!live.socialLinksPresent) errors.push(`${protectedPost.canonicalUrl} is missing its X, LinkedIn, or canonical share target.`);
  if (protectedPost.indexingStatus === 'index' && live.indexingStatus !== 'index') errors.push(`${protectedPost.canonicalUrl} became noindex.`);
  if (!sitemap.includes(protectedPost.canonicalUrl)) errors.push(`${protectedPost.canonicalUrl} is missing from the sitemap.`);
}

if (sitemapResponse.status !== 200) errors.push(`Sitemap returned ${sitemapResponse.status}.`);
fail(errors);
if (!errors.length) console.log(`URL protection passed: ${baseline.posts.length} immutable posts, all HTTP 200 with matching canonicals and sitemap coverage.`);
