import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const GROUNDING_REDIRECT_HOST = 'vertexaisearch.cloud.google.com';
const GROUNDING_REDIRECT_PATH = '/grounding-api-redirect/';

function isPrivateIpv4(hostname) {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 192 && parts[1] === 0 && (parts[2] === 0 || parts[2] === 2))
    || (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19 || parts[1] === 51))
    || (parts[0] === 203 && parts[1] === 0 && parts[2] === 113)
    || parts[0] === 0
    || parts[0] >= 224;
}

function normalizedHostname(value) {
  return String(value || '').toLowerCase().replace(/^\[|\]$/g, '');
}

function isPrivateIp(address) {
  const value = normalizedHostname(address);
  if (value.startsWith('::ffff:')) return isPrivateIpv4(value.slice(7));
  if (isIP(value) === 4) return isPrivateIpv4(value);
  if (isIP(value) !== 6) return true;
  return value === '::'
    || value === '::1'
    || value.startsWith('fc')
    || value.startsWith('fd')
    || /^fe[89ab]/.test(value)
    || value.startsWith('ff');
}

async function assertPublicDestination(url) {
  const hostname = normalizedHostname(url.hostname);
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error('Private network destinations are not allowed.');
    return;
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error('Private network destinations are not allowed.');
  }
}

export function parsePublicHttpsUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const hostname = normalizedHostname(url.hostname);
    const isIpv6 = hostname.includes(':');
    const isPrivateHost = hostname === 'localhost'
      || hostname.endsWith('.localhost')
      || hostname.endsWith('.local')
      || hostname === '::1'
      || (isIpv6 && (hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe80:')))
      || isPrivateIpv4(hostname);

    if (url.protocol !== 'https:' || !hostname || isPrivateHost || url.username || url.password) return null;
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

export function isGroundingRedirectUrl(value) {
  const url = parsePublicHttpsUrl(value);
  return Boolean(url && url.hostname === GROUNDING_REDIRECT_HOST && url.pathname.startsWith(GROUNDING_REDIRECT_PATH));
}

async function fetchFinalUrl(url, method, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let currentUrl = url;
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      await assertPublicDestination(currentUrl);
      const response = await fetch(currentUrl, {
        method,
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5',
          'User-Agent': 'ixuvo-source-validator/1.0 (+https://ixuvo.com/)',
          ...(method === 'GET' ? { Range: 'bytes=0-0' } : {}),
        },
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => {});
        const nextUrl = location ? parsePublicHttpsUrl(new URL(location, currentUrl).href) : null;
        if (!nextUrl) throw new Error('Source redirected to a disallowed destination.');
        currentUrl = nextUrl;
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new Error(`Source returned HTTP ${response.status}.`);
      }
      await response.body?.cancel().catch(() => {});
      return currentUrl.href;
    }
    throw new Error('Source redirected too many times.');
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveSourceUrl(value, timeoutMs = 5000) {
  const original = parsePublicHttpsUrl(value);
  if (!original) {
    return { original: String(value || ''), resolved: '', status: 'invalid', reason: 'Only public HTTPS URLs are accepted.' };
  }

  let finalValue = '';
  let lastError = '';

  for (const method of ['HEAD', 'GET']) {
    try {
      finalValue = await fetchFinalUrl(original, method, timeoutMs);
      if (finalValue) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'URL resolution failed.';
    }
  }

  const resolved = parsePublicHttpsUrl(finalValue);
  if (!resolved || isGroundingRedirectUrl(resolved.href)) {
    return {
      original: original.href,
      resolved: '',
      status: 'unresolved',
      reason: lastError || 'The authoritative destination could not be determined.',
    };
  }

  return {
    original: original.href,
    resolved: resolved.href,
    status: resolved.href === original.href ? 'valid' : 'resolved',
    reason: '',
  };
}

export async function resolveSourceUrls(values, options = {}) {
  const unique = Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean)));
  const results = await Promise.all(unique.map((value) => resolveSourceUrl(value, options.timeoutMs || 5000)));
  const resolvedUrls = [];
  const unresolved = [];

  for (const result of results) {
    if (result.status === 'invalid') {
      unresolved.push(result);
      continue;
    }

    if (result.status === 'unresolved') {
      unresolved.push(result);
      if (!isGroundingRedirectUrl(result.original)) resolvedUrls.push(result.original);
      continue;
    }

    resolvedUrls.push(result.resolved);
  }

  return {
    urls: Array.from(new Set(resolvedUrls)),
    results,
    unresolved,
  };
}
