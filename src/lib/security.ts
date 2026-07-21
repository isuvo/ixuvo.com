type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const rateLimits = new Map<string, RateLimitEntry>();

export function clientAddress(request: Request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-real-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

export function takeRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const current = rateLimits.get(key);

  if (!current || current.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
    pruneRateLimits(now);
    return { allowed: true, retryAfter: 0 };
  }

  current.count += 1;
  return {
    allowed: current.count <= limit,
    retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
  };
}

export function clearRateLimit(key: string) {
  rateLimits.delete(key);
}

export function isSameOriginRequest(request: Request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;

  const origin = request.headers.get('origin');
  if (!origin) return true;

  const acceptedOrigins = new Set([new URL(request.url).origin]);
  const configuredSite = String(import.meta.env.SITE_URL || '').trim();
  if (configuredSite) {
    try {
      acceptedOrigins.add(new URL(configuredSite).origin);
    } catch {
      // Ignore a malformed optional SITE_URL; the request origin still applies.
    }
  }

  return acceptedOrigins.has(origin);
}

export function exceedsContentLength(request: Request, maxBytes: number) {
  const value = Number(request.headers.get('content-length'));
  return Number.isFinite(value) && value > maxBytes;
}

function pruneRateLimits(now: number) {
  if (rateLimits.size < 1000) return;
  for (const [key, value] of rateLimits) {
    if (value.resetAt <= now) rateLimits.delete(key);
  }
}
