const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090';

function collectionUrl(name, query = {}) {
  const url = new URL(`/api/collections/${name}/records`, PB_URL);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

async function readJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`PocketBase request failed (${response.status}): ${message}`);
  }

  return response.json();
}

function normalizeArray(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter(Boolean);
      }
    } catch {
      return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }

  return [];
}

export function fileUrl(collectionName, recordId, filename) {
  if (!filename) {
    return null;
  }

  return `/api/pb/api/files/${collectionName}/${recordId}/${filename}`;
}

function cleanArchiveText(value = '') {
  return String(value)
    .replace(/\uFFFD/g, '')
    .replace(/Migrated from the original suvoBGD WordPress archive\.?/gi, '')
    .replace(/Imported from the earlier WordPress archive\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripMarkdown(value = '') {
  return cleanArchiveText(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]+]\([^)]*\)/g, ' ')
    .replace(/[#>*_\-[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function readingTime(value = '') {
  const words = stripMarkdown(value).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 220));
}

const tagProfiles = [
  { value: 'ai', label: 'AI Systems', matches: ['ai', 'ml', 'agent', 'llm'] },
  { value: 'automation', label: 'Automation', matches: ['automation', 'workflow', 'process'] },
  { value: 'cloud', label: 'Cloud', matches: ['cloud', 'azure', 'aws', 'platform'] },
  { value: 'devsecops', label: 'DevSecOps', matches: ['devsecops', 'security', 'devops', 'ci/cd', 'cicd'] },
  { value: 'general', label: 'General', matches: ['general', 'misc', 'notes'] },
  { value: 'management', label: 'Management', matches: ['management', 'leadership', 'delivery', 'product', 'team'] },
  { value: 'ops', label: 'Ops', matches: ['ops', 'operations', 'monitoring', 'reliability', 'sre'] },
  { value: 'legacy', label: 'Legacy Archive', matches: ['legacy', 'wordpress', 'archive', 'legacy-blog', 'wordpress-archive'] },
];

function tagProfileForPost(tags = [], legacyImported = false) {
  const normalized = tags.map((tag) => String(tag).toLowerCase());

  if (legacyImported) {
    return tagProfiles.find((profile) => profile.value === 'legacy');
  }

  return tagProfiles.find((profile) =>
    normalized.some((tag) => profile.value === tag || profile.matches.some((match) => tag.includes(match)))
  ) || tagProfiles.find((profile) => profile.value === 'general') || tagProfiles[0];
}

function categoryForPost(tags = []) {
  const normalized = tags.map((tag) => String(tag).toLowerCase());

  if (normalized.some((tag) => tag.includes('sql') || tag.includes('database'))) return 'SQL';
  if (normalized.some((tag) => tag.includes('.net') || tag.includes('dotnet') || tag.includes('c#'))) return '.NET';
  if (normalized.some((tag) => tag.includes('ai') || tag.includes('ml') || tag.includes('agent'))) return 'AI';
  if (normalized.some((tag) => tag.includes('wordpress') || tag.includes('legacy'))) return 'Legacy';
  if (normalized.some((tag) => tag.includes('personal') || tag.includes('wellness'))) return 'Personal';
  if (normalized.some((tag) => tag.includes('tutorial') || tag.includes('code'))) return 'Tutorial';

  return 'General';
}

function normalizePost(record) {
  const tags = normalizeArray(record.tags);
  const tagProfile = tagProfileForPost(tags, Boolean(record.legacy_imported));
  const cleanedSummary = cleanArchiveText(record.summary);
  const bodyText = stripMarkdown(record.body_markdown);
  const excerpt = cleanedSummary || `${bodyText.slice(0, 180)}${bodyText.length > 180 ? '...' : ''}`;

  return {
    ...record,
    title: cleanArchiveText(record.title),
    summary: cleanedSummary,
    excerpt,
    tags,
    source_urls: normalizeArray(record.source_urls),
    legacy_imported: Boolean(record.legacy_imported),
    legacy_source_url: record.legacy_source_url || '',
    cover_image_url: fileUrl('posts', record.id, record.cover_image) || (record.legacy_imported ? '/legacy-archive.svg' : ''),
    category: categoryForPost(tags),
    filter_tag: tagProfile.value,
    filter_label: tagProfile.label,
    reading_time: readingTime(record.body_markdown),
  };
}

async function getAllPosts(limit = 200) {
  const url = collectionUrl('posts', {
    sort: '-published_at,-created',
    perPage: limit,
    fields:
      'id,title,slug,summary,body_markdown,status,tags,cover_image,source_urls,published_at,linkedin_text,x_text,legacy_imported,legacy_source_url,created,updated',
  });

  const data = await readJson(url);
  return (data.items || []).map(normalizePost);
}

export async function getPublishedPosts(limit = 50) {
  const posts = await getAllPosts(Math.max(limit, 100));
  return posts.filter((post) => post.status === 'published').slice(0, limit);
}

export async function getRecentPostsForHome(limit = 6) {
  return getPublishedPosts(limit);
}

export async function getPublishedPostBySlug(slug) {
  const posts = await getAllPosts(200);
  return posts.find((post) => post.slug === slug && post.status === 'published') || null;
}

export async function getPublishedPostWithNeighbors(slug) {
  const posts = await getPublishedPosts(200);
  const index = posts.findIndex((post) => post.slug === slug);

  if (index === -1) {
    return { post: null, previousPost: null, nextPost: null };
  }

  return {
    post: posts[index],
    previousPost: posts[index + 1] || null,
    nextPost: posts[index - 1] || null,
  };
}

export async function getLatestPublishedPosts(limit = 3) {
  return getPublishedPosts(limit);
}
