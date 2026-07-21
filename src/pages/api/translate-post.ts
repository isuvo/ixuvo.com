import type { APIRoute } from 'astro';
import { getPublishedPostWithNeighbors } from '../../lib/pocketbase.js';
import { renderPostHtml, sanitizePostHtml } from '../../lib/postHtml.js';
import {
  clientAddress,
  exceedsContentLength,
  isSameOriginRequest,
  takeRateLimit,
} from '../../lib/security.js';

const targetLanguages = {
  fr: 'French',
  bn: 'Bengali',
  es: 'Spanish',
} as const;

type TargetLanguage = keyof typeof targetLanguages;

const translationCache = new Map<string, { expiresAt: number; value: unknown }>();
const translationCacheTtlMs = 6 * 60 * 60 * 1000;

const protectedPattern = /<(pre|code|svg|script|style)\b[\s\S]*?<\/\1>|<img\b[^>]*>/gi;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function apiKey() {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    ''
  );
}

function maskProtectedHtml(html: string) {
  const protectedBlocks: string[] = [];
  const maskedHtml = html.replace(protectedPattern, (match) => {
    const token = `__IXUVO_PROTECTED_BLOCK_${protectedBlocks.length}__`;
    protectedBlocks.push(match);
    return token;
  });

  return { maskedHtml, protectedBlocks };
}

function restoreProtectedHtml(html: string, protectedBlocks: string[]) {
  return protectedBlocks.reduce(
    (result, block, index) => result.replaceAll(`__IXUVO_PROTECTED_BLOCK_${index}__`, block),
    html
  );
}

function parseGeminiJson(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;

    for (let index = 0; index < candidate.length; index += 1) {
      const char = candidate[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        if (depth === 0) {
          start = index;
        }
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0 && start !== -1) {
          return JSON.parse(candidate.slice(start, index + 1));
        }
      }
    }

    throw new Error('Gemini returned a translation that could not be parsed.');
  }
}

async function translateWithGemini(payload: Record<string, unknown>, language: TargetLanguage) {
  const key = apiKey();
  if (!key) {
    throw new Error('Gemini API key is not configured.');
  }

  const modelCandidates = [
    process.env.GEMINI_MODEL || '',
    'gemini-3.5-flash',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash',
  ].filter((model, index, models) => model && models.indexOf(model) === index);

  let lastError = '';
  const deadline = Date.now() + 40_000;

  for (const model of modelCandidates) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      break;
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(18_000, remainingMs));
    let response;

    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': key,
        },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: [
                    `Translate this blog post from English to ${targetLanguages[language]}.`,
                    'Return only valid JSON with these exact string keys: title, summary, contentHtml, previousLabel, previousTitle, nextLabel, nextTitle.',
                    'Preserve all HTML tags, attributes, links, image tags, and placeholder tokens exactly.',
                    'Do not translate placeholder tokens that look like __IXUVO_PROTECTED_BLOCK_0__.',
                    'Do not add commentary or Markdown fences.',
                    JSON.stringify(payload),
                  ].join('\n\n'),
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2,
            maxOutputTokens: 16384,
          },
        }),
      });
    } catch (error) {
      lastError = error instanceof Error && error.name === 'AbortError'
        ? `${model} timed out.`
        : error instanceof Error ? error.message : `${model} request failed.`;
      continue;
    } finally {
      clearTimeout(timeout);
    }

    const data = await response.json().catch(() => ({}));
    const text = data?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('') || '';

    if (response.ok && text) {
      return parseGeminiJson(text);
    }

    lastError = data?.error?.message || response.statusText || `Gemini request failed with ${response.status}.`;
    // Try the next supported model for unavailable, throttled, or transient failures.
    if (response.status === 401 || response.status === 403) break;
  }

  throw new Error(lastError || 'Translation timed out. Please try again.');
}

export const POST: APIRoute = async ({ request }) => {
  if (!isSameOriginRequest(request)) {
    return json({ message: 'Cross-site requests are not allowed.' }, 403);
  }

  if (exceedsContentLength(request, 2048)) {
    return json({ message: 'Translation request is too large.' }, 413);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ message: 'Invalid translation request.' }, 400);
  }

  const slug = String(body?.slug || '').trim();
  const language = String(body?.language || 'en') as TargetLanguage | 'en';

  if (!slug || slug.length > 160 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return json({ message: 'Missing blog post slug.' }, 400);
  }

  if (language === 'en') {
    return json({ message: 'English is the default language.' }, 400);
  }

  if (!(language in targetLanguages)) {
    return json({ message: 'Unsupported translation language.' }, 400);
  }

  const { post, previousPost, nextPost } = await getPublishedPostWithNeighbors(slug);
  if (!post) {
    return json({ message: 'Post not found.' }, 404);
  }

  const cacheKey = `${slug}:${language}:${post.updated || post.published_at || ''}`;
  const cached = translationCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return json(cached.value);
  }
  if (cached) translationCache.delete(cacheKey);

  const rateLimit = takeRateLimit(`translate:${clientAddress(request)}`, 10, 10 * 60 * 1000);
  if (!rateLimit.allowed) {
    return new Response(JSON.stringify({ message: 'Translation limit reached. Please try again later.' }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Retry-After': String(rateLimit.retryAfter),
      },
    });
  }

  const { maskedHtml, protectedBlocks } = maskProtectedHtml(renderPostHtml(post.body_markdown || ''));
  let translation;
  try {
    translation = await translateWithGemini(
      {
        title: post.title,
        summary: post.summary,
        contentHtml: maskedHtml,
        previousLabel: 'Older post',
        previousTitle: previousPost?.title || '',
        nextLabel: 'Newer post',
        nextTitle: nextPost?.title || '',
      },
      language
    );
  } catch (error) {
    console.error('[translation-error]', error instanceof Error ? error.message : 'Translation failed.');
    return json({ message: 'Translation is temporarily unavailable. Please try again.' }, 502);
  }

  const responseData = {
    language,
    title: String(translation.title || post.title),
    summary: String(translation.summary || post.summary || ''),
    contentHtml: sanitizePostHtml(restoreProtectedHtml(String(translation.contentHtml || maskedHtml), protectedBlocks)),
    previousLabel: String(translation.previousLabel || 'Older post'),
    previousTitle: String(translation.previousTitle || previousPost?.title || ''),
    nextLabel: String(translation.nextLabel || 'Newer post'),
    nextTitle: String(translation.nextTitle || nextPost?.title || ''),
  };

  if (translationCache.size >= 100) {
    translationCache.delete(translationCache.keys().next().value || '');
  }
  translationCache.set(cacheKey, { expiresAt: Date.now() + translationCacheTtlMs, value: responseData });
  return json(responseData);
};
