import rss from '@astrojs/rss';
import { getPublishedPosts } from '../lib/pocketbase.js';

export async function GET(context) {
  const posts = await getPublishedPosts(150);

  return rss({
    title: 'isuvo',
    description: 'Local-first notes and published posts.',
    site: context.site,
    items: posts.map((post) => ({
      title: post.title,
      description: post.summary || '',
      pubDate: post.published_at ? new Date(post.published_at) : new Date(post.created),
      link: `/blog/${post.slug}`,
    })),
  });
}
