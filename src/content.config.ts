import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    slug: z.string(),
    categories: z.array(z.string()).min(1), // первая — основная (для URL)
    tags: z.array(z.string()).default([]),
    description: z.string().default(''),
    cover: z.string().optional(),
    screenshots: z.array(z.string()).default([]),
    downloadLinks: z.array(z.string()).default([]),
    modAuthor: z.string().optional(),
    instruction: z.string().optional(),
    views: z.number().optional(),
    draft: z.boolean().default(false),
  }),
});

const pages = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/pages' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    slug: z.string(),
  }),
});

export const collections = { posts, pages };
