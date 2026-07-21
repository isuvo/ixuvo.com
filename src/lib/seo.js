const HTML_ENTITY_MAP = {
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' ',
};

export function cleanSeoText(value = '') {
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/[*_~>]/g, ' ')
    .replace(/&(amp|quot|#39|apos|lt|gt|nbsp);/gi, (entity) => HTML_ENTITY_MAP[entity.toLowerCase()] || ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function removeDuplicatedTitle(description, title) {
  const cleanTitle = cleanSeoText(title);
  if (!cleanTitle || cleanTitle.length < 12) return description;

  return description
    .replace(new RegExp(`^${escapeRegExp(cleanTitle)}(?:\\s*[-:|—–]\\s*|\\s+)`, 'i'), '')
    .replace(new RegExp(`(?:\\s*[-:|—–]\\s*|\\s+)${escapeRegExp(cleanTitle)}$`, 'i'), '')
    .trim();
}

export function truncateAtWord(value, maxLength, suffix = '…') {
  const text = cleanSeoText(value);
  if (text.length <= maxLength) return text;

  const available = Math.max(1, maxLength - suffix.length);
  const candidate = text.slice(0, available + 1);
  const boundary = candidate.lastIndexOf(' ');
  const cut = boundary >= Math.max(20, available - 28) ? boundary : available;

  return `${candidate.slice(0, cut).replace(/[\s,;:—–-]+$/g, '')}${suffix}`;
}

export function buildPostMetaDescription(post, overrides = {}) {
  const override = cleanSeoText(overrides?.[post?.slug]);
  if (override) return truncateAtWord(override, 160, '');

  const usesManualSummary = Boolean(cleanSeoText(post?.summary));
  const source = usesManualSummary ? post.summary : post?.excerpt;
  const cleaned = removeDuplicatedTitle(cleanSeoText(source), post?.title || '');

  if (usesManualSummary && cleaned.length >= 100 && cleaned.length <= 170) {
    return cleaned;
  }

  return truncateAtWord(cleaned, 155);
}

const GENERIC_TITLE_PREFIXES = [
  /^architectural deep dive:\s*/i,
  /^daily technology operations briefing:\s*/i,
  /^an in-depth (?:analysis|guide|look|overview)(?:\s+of|\s+to)?:\s*/i,
  /^a comprehensive (?:analysis|guide|look|overview)(?:\s+of|\s+to)?:\s*/i,
];

export function buildPostSeoTitle(post, overrides = {}) {
  const override = cleanSeoText(overrides?.[post?.slug]);
  if (override) return truncateAtWord(override, 65);

  let title = cleanSeoText(post?.title);
  for (const prefix of GENERIC_TITLE_PREFIXES) {
    title = title.replace(prefix, '');
  }

  const suffix = ' | Shuvo';
  if (title.length + suffix.length <= 65) return `${title}${suffix}`;
  return truncateAtWord(title, 65);
}

export function absoluteProductionUrl(value) {
  if (!value) return '';
  return new URL(value, 'https://ixuvo.com').href;
}

export function toIsoDate(value) {
  const timestamp = Date.parse(value || '');
  return Number.isNaN(timestamp) ? '' : new Date(timestamp).toISOString();
}
