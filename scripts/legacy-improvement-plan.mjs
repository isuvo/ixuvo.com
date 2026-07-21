import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getPublishedPosts } from '../src/lib/pocketbase.js';
import { cleanSeoText } from '../src/lib/seo.js';
import { blogCanonicalForSlug } from '../src/lib/blogUrls.js';

const reportPath = resolve('reports', 'legacy-content-improvement-plan.md');

function hasBrokenFormatting(post) {
  const combined = `${post.title || ''} ${post.summary || ''} ${post.body_markdown || ''}`;
  return /\uFFFD|\u00C3.|\[object Object\]/.test(combined)
    || ((combined.match(/```/g) || []).length % 2 !== 0);
}

function contentLength(post) {
  return cleanSeoText(post.body_markdown || '').length;
}

function isBareOrNearEmpty(post, length) {
  const body = String(post.body_markdown || '').trim();
  const links = body.match(/https?:\/\/\S+/g) || [];
  const nonLinkText = cleanSeoText(body.replace(/https?:\/\/\S+/g, ''));
  return length < 250 || (links.length > 0 && nonLinkText.length < 180);
}

function professionalRelevance(post) {
  const haystack = `${post.title} ${(post.tags || []).join(' ')} ${post.summary}`.toLowerCase();
  const strong = ['ai', 'software', 'security', 'cloud', 'architecture', 'devsecops', 'api', 'sql', 'database', 'javascript', 'asp.net', 'c#', 'system', 'automation', 'kubernetes', 'distributed'];
  const count = strong.filter((term) => haystack.includes(term)).length;
  return count >= 3 ? 'High' : count >= 1 ? 'Medium' : 'Low';
}

function planFor(post, length) {
  const body = String(post.body_markdown || '');
  const relevance = professionalRelevance(post);
  const problems = [];
  const legacyGallery = /gallery-|wp-block-|<style[\s>]/i.test(body);
  const legacyCodeMarkup = /syntaxhighlighter|<pre\b[^>]*class=["'][^"']*brush:/i.test(body);
  const genericSummary = /open the source link|original formatting and media/i.test(post.summary || '');
  const damaged = hasBrokenFormatting(post);

  if (length < 250) problems.push(`Very thin body (${length} cleaned characters)`);
  else problems.push(`Thin or incomplete body (${length} cleaned characters)`);
  if (legacyGallery) problems.push('Legacy WordPress gallery/style markup');
  if (legacyCodeMarkup) problems.push('Legacy syntax-highlighter HTML around code');
  if (genericSummary) problems.push('Generic summary does not explain the post');
  if (damaged) problems.push('Possible encoding or Markdown damage');
  if ((body.match(/https?:\/\/\S+/g) || []).length) problems.push('Link-heavy content needs destination review');

  if (relevance === 'Low' && (legacyGallery || length < 350)) {
    return {
      classification: 'Manual review required',
      problems,
      relevance,
      proposed: 'Compare the archived WordPress version and original media, then decide whether to restore missing captions or gallery content in place. Preserve the personal or historical intent; leave the current post unchanged until approved.',
      sources: 'Original WordPress URL and original media files only; no invented replacement narrative.',
      risk: 'High',
      visible: 'Yes, if approved',
    };
  }

  if (damaged || legacyGallery || legacyCodeMarkup) {
    return {
      classification: 'Repair formatting',
      problems,
      relevance,
      proposed: 'Convert obsolete WordPress or syntax-highlighter markup into valid headings, paragraphs, lists, images, and fenced code while preserving the original wording, examples, and topic. Improve the summary only where it currently describes the migration rather than the article.',
      sources: relevance === 'Low' ? 'Original WordPress page and archived media.' : 'Original WordPress page plus current official documentation for syntax verification.',
      risk: legacyGallery ? 'High' : 'Medium',
      visible: 'Yes, if approved',
    };
  }

  if (relevance !== 'Low') {
    return {
      classification: 'Expand existing content',
      problems,
      relevance,
      proposed: 'Retain the original example and add a short explanation of purpose, prerequisites, expected output, limitations, and a current safe alternative where appropriate. Add two or three contextual links to related ixuvo technical posts.',
      sources: 'Original archive plus official vendor documentation or primary technical references relevant to the named technology.',
      risk: 'High',
      visible: 'Yes, if approved',
    };
  }

  return {
    classification: 'Improve metadata only',
    problems,
    relevance,
    proposed: 'Keep the historical body unchanged. Replace the generic excerpt with a factual description of the existing material and verify that social metadata represents the post accurately.',
    sources: 'Existing post and original WordPress archive; no external claims required.',
    risk: 'Low',
    visible: 'No',
  };
}

function tableCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

await mkdir(resolve('reports'), { recursive: true });
const posts = await getPublishedPosts(500);
const candidates = posts
  .map((post) => ({ post, length: contentLength(post) }))
  .filter(({ post, length }) => hasBrokenFormatting(post) || isBareOrNearEmpty(post, length));

const header = [
  'Existing URL',
  'Existing title',
  'Content length',
  'Classification',
  'Identified problems',
  'Professional relevance',
  'Proposed in-place changes',
  'Sources required',
  'Risk level',
  'Visible content changes',
];
const rows = candidates.map(({ post, length }) => {
  const plan = planFor(post, length);
  return [
    blogCanonicalForSlug(post.slug),
    post.title,
    length,
    plan.classification,
    plan.problems.join('; '),
    plan.relevance,
    plan.proposed,
    plan.sources,
    plan.risk,
    plan.visible,
  ];
});

const markdown = [
  '# Legacy Content Improvement Plan',
  '',
  `Generated: ${new Date().toISOString()}`,
  '',
  `Posts requiring review: ${rows.length}`,
  '',
  'This is an approval-gated plan. No visible body content was changed while producing it.',
  '',
  `| ${header.join(' | ')} |`,
  `| ${header.map(() => '---').join(' | ')} |`,
  ...rows.map((row) => `| ${row.map(tableCell).join(' | ')} |`),
  '',
  '## Guardrails for every approved batch',
  '',
  '- Maximum ten posts per batch.',
  '- Preserve record ID, slug, URL, canonical URL, visible title, publication date, published status, and sitemap membership.',
  '- Do not add redirects, deletion, unpublishing, 404/410 responses, or noindex directives.',
  '- Update the modification date only after a meaningful visible content change.',
  '- Validate HTTP 200, canonical equality, structured data, internal links, metadata, and visual output after each batch.',
  '',
].join('\n');

await writeFile(reportPath, markdown, 'utf8');
console.log(`Legacy improvement plan created: ${reportPath} (${rows.length} posts).`);
