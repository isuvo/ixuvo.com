import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getPublishedPosts } from '../src/lib/pocketbase.js';
import { buildPostMetaDescription, buildPostSeoTitle, cleanSeoText } from '../src/lib/seo.js';
import { isGroundingRedirectUrl, parsePublicHttpsUrl, resolveSourceUrl } from '../src/lib/sourceUrls.js';
import { seoTitleOverrides } from '../src/data/seo-title-overrides.ts';
import { seoDescriptionOverrides } from '../src/data/seo-description-overrides.ts';

const args = new Set(process.argv.slice(2));
const baseArg = process.argv.find((value) => value.startsWith('--base-url='));
const baseUrl = baseArg ? baseArg.slice('--base-url='.length).replace(/\/$/, '') : '';
const shouldResolveSources = args.has('--resolve-sources');
const reportDir = resolve('reports');
const warnings = [];
const critical = [];
const metadataOverrideSlugs = Object.keys(seoDescriptionOverrides);

function warning(code, message, context = '') {
  warnings.push({ code, message, context });
}

function failure(code, message, context = '') {
  critical.push({ code, message, context });
}

function validSlug(slug) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || '');
}

function inspectMetadata(title, description, canonical, context) {
  if (!title) failure('missing-title', 'Title is missing.', context);
  else if (title.length < 30) warning('short-title', `Title is ${title.length} characters.`, context);
  else if (title.length > 65) warning('long-title', `Title is ${title.length} characters.`, context);

  if (!description) failure('missing-description', 'Description is missing.', context);
  else if (description.length < 100) warning('short-description', `Description is ${description.length} characters.`, context);
  else if (description.length > 170) warning('long-description', `Description is ${description.length} characters.`, context);

  if (!canonical) failure('missing-canonical', 'Canonical is missing.', context);
  else if (!canonical.startsWith('https://ixuvo.com/')) failure('invalid-canonical', `Canonical must use https://ixuvo.com: ${canonical}`, context);
}

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

function metaValue(html, key, value) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = attributes(tag);
    if (attrs[key] === value) return attrs.content || '';
  }
  return '';
}

function canonicalValue(html) {
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const attrs = attributes(tag);
    if ((attrs.rel || '').split(/\s+/).includes('canonical')) return attrs.href || '';
  }
  return '';
}

function jsonLdBlocks(html, context) {
  const blocks = [];
  const pattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    try {
      blocks.push(JSON.parse(match[1]));
    } catch (error) {
      failure('invalid-jsonld', error instanceof Error ? error.message : 'Invalid JSON-LD.', context);
    }
  }
  return blocks;
}

function firstHeading(html) {
  const match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  return match ? decodeHtml(match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()) : '';
}

function walkJson(value, visit, key = '') {
  if (Array.isArray(value)) return value.forEach((item) => walkJson(item, visit, key));
  if (!value || typeof value !== 'object') return visit(value, key);
  for (const [childKey, childValue] of Object.entries(value)) walkJson(childValue, visit, childKey);
}

function validateJsonLd(blocks, context) {
  const entityCounts = new Map();
  for (const block of blocks) {
    walkJson(block, (value, key) => {
      if (['@id', 'url', 'image'].includes(key) && typeof value === 'string' && value.startsWith('/')) {
        failure('relative-jsonld-url', `Relative JSON-LD URL: ${value}`, context);
      }
      if (key === '@type' && typeof value === 'string' && ['Person', 'WebSite'].includes(value)) {
        entityCounts.set(value, (entityCounts.get(value) || 0) + 1);
      }
    });
  }
  for (const type of ['Person', 'WebSite']) {
    if ((entityCounts.get(type) || 0) > 1) failure('duplicate-entity', `Duplicate ${type} entities.`, context);
  }
}

function stripBody(value) {
  return cleanSeoText(value || '');
}

function hasBrokenFormatting(post) {
  const combined = `${post.title || ''} ${post.summary || ''} ${post.body_markdown || ''}`;
  return /\uFFFD|Ã.|Â.|â€|à¦|\[object Object\]/.test(combined)
    || ((combined.match(/```/g) || []).length % 2 !== 0);
}

function isBareOrNearEmpty(post, contentLength) {
  const body = String(post.body_markdown || '').trim();
  const links = body.match(/https?:\/\/\S+/g) || [];
  const nonLinkText = cleanSeoText(body.replace(/https?:\/\/\S+/g, ''));
  return contentLength < 250 || (links.length > 0 && nonLinkText.length < 180);
}

function relevance(post) {
  const haystack = `${post.title} ${(post.tags || []).join(' ')} ${post.summary}`.toLowerCase();
  const strong = ['ai', 'software', 'security', 'cloud', 'architecture', 'devsecops', 'api', 'system', 'automation', 'kubernetes', 'distributed'];
  const count = strong.filter((term) => haystack.includes(term)).length;
  return count >= 3 ? 'High' : count >= 1 ? 'Medium' : 'Low';
}

function tableCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

async function resolveWithConcurrency(items, limit = 6) {
  const output = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      output[index] = await resolveSourceUrl(items[index], 7000);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

async function fetchRoute(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, { redirect: 'manual' });
  return { response, text: await response.text() };
}

await mkdir(reportDir, { recursive: true });
const posts = await getPublishedPosts(500);
const seenSlugs = new Set();
const titleOwners = new Map();
const duplicateVisibleTitles = new Map();

for (const post of posts) {
  const context = `/blog/${post.slug}`;
  const seoTitle = buildPostSeoTitle(post, seoTitleOverrides);
  const description = buildPostMetaDescription(post, seoDescriptionOverrides);
  inspectMetadata(seoTitle, description, `https://ixuvo.com/blog/${post.slug}`, context);
  if (Object.hasOwn(seoDescriptionOverrides, post.slug)) {
    if (seoTitle.length < 45 || seoTitle.length > 65) failure('flagged-title-length', `Protected metadata title is ${seoTitle.length} characters.`, context);
    if (description.length < 140 || description.length > 160) failure('flagged-description-length', `Protected metadata description is ${description.length} characters.`, context);
  }

  if (!validSlug(post.slug)) failure('malformed-blog-url', `Malformed slug: ${post.slug}`, context);
  if (seenSlugs.has(post.slug)) failure('duplicate-blog-url', `Duplicate slug: ${post.slug}`, context);
  seenSlugs.add(post.slug);

  if (titleOwners.has(seoTitle)) warning('duplicate-title', `SEO title also used by ${titleOwners.get(seoTitle)}.`, context);
  else titleOwners.set(seoTitle, context);

  const normalizedVisibleTitle = cleanSeoText(post.title).toLowerCase();
  const owners = duplicateVisibleTitles.get(normalizedVisibleTitle) || [];
  owners.push(post.slug);
  duplicateVisibleTitles.set(normalizedVisibleTitle, owners);
}

inspectMetadata(
  'Shuvo | Engineering Lead, AI Architect & Full-Stack Engineer',
  'Engineering Lead and AI architect Shuvo builds agentic systems, AI SaaS products, secure cloud-native platforms, and scalable business automation.',
  'https://ixuvo.com/',
  '/',
);
inspectMetadata(
  'AI SaaS, Agentic Systems & Software Engineering Blog | Shuvo',
  'Technical writing by Shuvo on AI SaaS, agentic systems, software architecture, automation, cloud-native platforms, DevSecOps, and software security.',
  'https://ixuvo.com/blog',
  '/blog',
);

const wrapperUrls = Array.from(new Set(posts.flatMap((post) => (post.source_urls || []).filter(isGroundingRedirectUrl))));
const wrapperResults = shouldResolveSources ? await resolveWithConcurrency(wrapperUrls) : [];
const wrapperResultMap = new Map(wrapperResults.map((result) => [result.original, result]));
const auditRows = [];
const sourceRows = [];

for (const post of posts) {
  const contentLength = stripBody(post.body_markdown).length;
  const seoTitle = buildPostSeoTitle(post, seoTitleOverrides);
  const description = buildPostMetaDescription(post, seoDescriptionOverrides);
  const metadataQuality = seoTitle.length >= 30 && seoTitle.length <= 65 && description.length >= 100 && description.length <= 170
    ? 'Good'
    : 'Needs improvement';
  const brokenFormatting = hasBrokenFormatting(post);
  const bareOrEmpty = isBareOrNearEmpty(post, contentLength);
  const sourceIssues = (post.source_urls || []).filter((url) => !parsePublicHttpsUrl(url) || isGroundingRedirectUrl(url) || url.includes('...') || /example\.com/i.test(url));
  const duplicates = duplicateVisibleTitles.get(cleanSeoText(post.title).toLowerCase()) || [];
  let action = 'Keep indexed';
  let reason = 'Substantial technical content with acceptable metadata.';

  if (sourceIssues.length) {
    action = 'Source-link repair required';
    reason = 'One or more sources are wrapped, malformed, placeholder, or non-public URLs.';
  } else if (brokenFormatting || bareOrEmpty) {
    action = 'Broken content requiring review';
    reason = brokenFormatting ? 'Possible encoding or Markdown formatting damage detected.' : 'Content is near-empty or dominated by bare links.';
  } else if (duplicates.length > 1) {
    action = 'Potential redirect candidate';
    reason = `Visible title duplicates ${duplicates.length - 1} other published post(s); manual canonical-content review required.`;
  } else if (metadataQuality !== 'Good') {
    action = 'Improve metadata';
    reason = 'SEO title or description falls outside the recommended range.';
  } else if (post.legacy_imported && relevance(post) === 'Low') {
    action = 'Potential noindex candidate';
    reason = 'Low-relevance legacy content; requires manual approval before any indexing change.';
  }

  auditRows.push([
    post.title,
    post.slug,
    `https://ixuvo.com/blog/${post.slug}`,
    post.published_at || post.created || '',
    contentLength,
    metadataQuality,
    relevance(post),
    brokenFormatting ? 'Yes' : 'No',
    bareOrEmpty ? 'Yes' : 'No',
    (post.source_urls || []).filter(isGroundingRedirectUrl).join(' '),
    action,
    reason,
  ]);

  for (const url of post.source_urls || []) {
    const issue = !parsePublicHttpsUrl(url) ? 'Invalid/non-HTTPS'
      : isGroundingRedirectUrl(url) ? 'Grounding redirect wrapper'
      : url.includes('...') || /example\.com/i.test(url) ? 'Placeholder URL'
      : '';
    if (!issue) continue;
    const resolved = wrapperResultMap.get(parsePublicHttpsUrl(url)?.href || url);
    sourceRows.push([
      post.title,
      post.slug,
      url,
      issue,
      resolved?.resolved || '',
      resolved?.resolved ? 'Safe destination found; review before historical update.' : 'Manual review required; historical content unchanged.',
    ]);
  }
}

const auditHeader = ['Title', 'Slug', 'Canonical URL', 'Publication date', 'Content length', 'Metadata quality', 'Technical relevance', 'Broken formatting', 'Bare-link/near-empty', 'Redirect-wrapper sources', 'Recommended action', 'Reason'];
const auditMarkdown = [
  '# Legacy Content Audit',
  '',
  `Generated: ${new Date().toISOString()}`,
  '',
  `Published posts reviewed: ${posts.length}`,
  '',
  `| ${auditHeader.join(' | ')} |`,
  `| ${auditHeader.map(() => '---').join(' | ')} |`,
  ...auditRows.map((row) => `| ${row.map(tableCell).join(' | ')} |`),
  '',
  '> This report is advisory only. No post content, URL, index status, publication state, or redirect was changed.',
  '',
].join('\n');
await writeFile(resolve(reportDir, 'legacy-content-audit.md'), auditMarkdown, 'utf8');

const sourceHeader = ['Title', 'Slug', 'Stored source URL', 'Issue', 'Resolved destination', 'Recommendation'];
const sourceMarkdown = [
  '# Source Link Audit',
  '',
  `Generated: ${new Date().toISOString()}`,
  '',
  `Problematic links reviewed: ${sourceRows.length}`,
  '',
  `| ${sourceHeader.join(' | ')} |`,
  `| ${sourceHeader.map(() => '---').join(' | ')} |`,
  ...sourceRows.map((row) => `| ${row.map(tableCell).join(' | ')} |`),
  '',
  '> Existing PocketBase records were not modified.',
  '',
].join('\n');
await writeFile(resolve(reportDir, 'source-link-audit.md'), sourceMarkdown, 'utf8');

if (baseUrl) {
  const sampleSlugs = Array.from(new Set([...posts.slice(0, 5).map((post) => post.slug), ...metadataOverrideSlugs]));
  const htmlRoutes = ['/', '/blog', ...sampleSlugs.map((slug) => `/blog/${slug}`), '/write', '/admin', '/404'];

  for (const pathname of htmlRoutes) {
    const { response, text } = await fetchRoute(pathname);
    const context = `${baseUrl}${pathname}`;
    const titles = Array.from(text.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi), (match) => decodeHtml(match[1].trim()));
    if (titles.length !== 1) failure('title-count', `Expected one title tag; found ${titles.length}.`, context);
    const robots = metaValue(text, 'name', 'robots');
    const mustNoindex = pathname === '/write' || pathname === '/admin' || pathname === '/404';
    if (mustNoindex && !robots.includes('noindex')) failure('indexable-private-route', `Expected noindex, found: ${robots}`, context);
    if (!mustNoindex && robots.includes('noindex')) failure('unexpected-noindex', 'Public route is noindexed.', context);
    if (!mustNoindex) inspectMetadata(titles[0] || '', metaValue(text, 'name', 'description'), canonicalValue(text), context);
    if (!metaValue(text, 'name', 'author')) failure('missing-author', 'Author metadata is missing.', context);
    if (!mustNoindex && !metaValue(text, 'property', 'og:image')) failure('missing-og-image', 'Open Graph image is missing.', context);
    validateJsonLd(jsonLdBlocks(text, context), context);
    if (pathname.startsWith('/blog/')) {
      const livePost = posts.find((post) => pathname === `/blog/${post.slug}`);
      if (livePost) {
        const expectedTitle = buildPostSeoTitle(livePost, seoTitleOverrides);
        const expectedDescription = buildPostMetaDescription(livePost, seoDescriptionOverrides);
        if (firstHeading(text) !== livePost.title) failure('visible-title-changed', 'Visible H1 does not match the stored post title.', context);
        for (const [key, value] of [['property', 'og:title'], ['name', 'twitter:title']]) {
          if (metaValue(text, key, value) !== expectedTitle) failure('social-title-mismatch', `${value} does not match the SEO title.`, context);
        }
        for (const [key, value] of [['property', 'og:description'], ['name', 'twitter:description']]) {
          if (metaValue(text, key, value) !== expectedDescription) failure('social-description-mismatch', `${value} does not match the meta description.`, context);
        }
        const imageUrl = metaValue(text, 'property', 'og:image');
        if (!imageUrl.startsWith('https://ixuvo.com/')) failure('non-absolute-cover', `Open Graph image is not an absolute ixuvo.com URL: ${imageUrl}`, context);
        else {
          const imageResponse = await fetch(imageUrl, { redirect: 'manual' });
          if (!imageResponse.ok) failure('cover-unavailable', `Cover image returned ${imageResponse.status}.`, context);
        }
        const blogPosting = jsonLdBlocks(text, context).find((block) => block?.['@type'] === 'BlogPosting');
        if (!blogPosting) failure('missing-blogposting', 'BlogPosting structured data is missing.', context);
        else {
          if (blogPosting.headline !== livePost.title) failure('schema-headline-mismatch', 'BlogPosting headline does not match the visible title.', context);
          if (blogPosting.description !== expectedDescription) failure('schema-description-mismatch', 'BlogPosting description does not match metadata.', context);
          if (blogPosting.author?.['@id'] !== 'https://ixuvo.com/#person') failure('schema-person-reference', 'BlogPosting does not reference the homepage Person entity.', context);
        }
      }
    }
    if (response.status >= 500) failure('route-error', `Route returned ${response.status}.`, context);
  }

  const requiredRoutes = ['/robots.txt', '/sitemap.xml', '/rss.xml', '/llms.txt', '/logo.png', '/social-preview.png'];
  for (const pathname of requiredRoutes) {
    const response = await fetch(`${baseUrl}${pathname}`);
    if (!response.ok) failure('required-route', `${pathname} returned ${response.status}.`, baseUrl);
  }

  const sitemap = await (await fetch(`${baseUrl}/sitemap.xml`)).text();
  for (const post of posts) {
    const canonical = `https://ixuvo.com/blog/${post.slug}`;
    if (!sitemap.includes(canonical)) failure('sitemap-missing-post', `Published post missing from sitemap: ${canonical}`, '/sitemap.xml');
  }

  const robotsText = await (await fetch(`${baseUrl}/robots.txt`)).text();
  if (!robotsText.includes('Sitemap: https://ixuvo.com/sitemap.xml')) failure('robots-sitemap', 'robots.txt has an incorrect sitemap reference.', '/robots.txt');
}

const validation = {
  generatedAt: new Date().toISOString(),
  baseUrl: baseUrl || null,
  publishedPosts: posts.length,
  wrapperUrls: wrapperUrls.length,
  warnings,
  critical,
};
await writeFile(resolve(reportDir, 'seo-validation.json'), `${JSON.stringify(validation, null, 2)}\n`, 'utf8');

for (const item of warnings) console.warn(`[seo-warning:${item.code}] ${item.context} ${item.message}`);
for (const item of critical) console.error(`[seo-error:${item.code}] ${item.context} ${item.message}`);
console.log(`SEO audit complete: ${posts.length} posts, ${warnings.length} warnings, ${critical.length} critical errors.`);
console.log(`Reports: ${resolve(reportDir, 'legacy-content-audit.md')}, ${resolve(reportDir, 'source-link-audit.md')}, ${resolve(reportDir, 'seo-validation.json')}`);
if (critical.length) process.exitCode = 1;
