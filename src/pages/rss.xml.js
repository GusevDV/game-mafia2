import rss from '@astrojs/rss';
import { getPosts, postUrl, SITE_TITLE, SITE_DESCRIPTION } from '@/lib/site';

export async function GET(context) {
  const posts = await getPosts();
  return rss({
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    site: context.site,
    items: posts.slice(0, 20).map((post) => ({
      title: post.data.title,
      pubDate: post.data.date,
      description: post.data.description,
      link: postUrl(post),
    })),
    customData: '<language>ru</language>',
  });
}
