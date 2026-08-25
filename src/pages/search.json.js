import { getPosts, postUrl, categoryName } from '@/lib/site';

export async function GET() {
  const posts = await getPosts();
  const index = posts.map((post) => ({
    title: post.data.title,
    url: postUrl(post),
    category: categoryName(post.data.categories[0]),
  }));
  return new Response(JSON.stringify(index), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
