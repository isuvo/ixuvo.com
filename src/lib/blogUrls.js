const PRODUCTION_ORIGIN = 'https://ixuvo.com';

export function blogPathForSlug(slug) {
  return `/blog/${String(slug || '').trim()}`;
}

export function blogCanonicalForSlug(slug) {
  return `${PRODUCTION_ORIGIN}${blogPathForSlug(slug)}`;
}
