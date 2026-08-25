import { getCollection, type CollectionEntry } from 'astro:content';
import taxonomies from '@/content/taxonomies.json';

export const SITE_TITLE = 'Mafia II';
export const SITE_DESCRIPTION =
  'Все для игры Mafia 2. Скачать файлы, программы, моды, DLC';
export const POSTS_PER_PAGE = 12;
// Если репозиторий живёт по другому адресу — поменять только эту строку.
export const REPO_URL = 'https://github.com/dmivlagus/game-mafia2';

export type Post = CollectionEntry<'posts'>;

const categoryNames = new Map(taxonomies.categories.map((c) => [c.slug, c.name]));
const tagNames = new Map(taxonomies.tags.map((t) => [t.slug, t.name]));

export function categoryName(slug: string): string {
  return categoryNames.get(slug) ?? slug;
}

export function tagName(slug: string): string {
  return tagNames.get(slug) ?? slug;
}

/** Опубликованные посты, новые сверху. */
export async function getPosts(): Promise<Post[]> {
  const posts = await getCollection('posts', ({ data }) => !data.draft);
  return posts.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

export function postUrl(post: Post): string {
  return `/${post.data.categories[0]}/${post.data.slug}.html`;
}

export function categoryUrl(slug: string, page = 1): string {
  return page > 1 ? `/${slug}/page/${page}` : `/${slug}`;
}

export function tagUrl(slug: string): string {
  return `/tag/${slug}`;
}

/** Рубрики, в которых есть посты, по убыванию количества. */
export async function getUsedCategories() {
  const posts = await getPosts();
  const counts = new Map<string, number>();
  for (const p of posts)
    for (const c of p.data.categories) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts.entries()]
    .map(([slug, count]) => ({ slug, name: categoryName(slug), count }))
    .sort((a, b) => b.count - a.count);
}

/** Ссылка «предложить правку» — на редактирование исходного файла в GitHub. */
export function editUrl(contentPath: string): string {
  return `${REPO_URL}/edit/main/src/content/${contentPath}`;
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
