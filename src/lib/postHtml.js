import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

export const postHtmlOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'pre', 'code']),
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    a: ['href', 'name', 'target', 'rel'],
    img: ['src', 'alt', 'title'],
  },
};

export function sanitizePostHtml(html = '') {
  return sanitizeHtml(html, postHtmlOptions);
}

export function renderPostHtml(markdown = '') {
  return sanitizePostHtml(marked.parse(markdown || ''));
}
