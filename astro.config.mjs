// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import { rehypeMedia } from './src/lib/rehype-media.mjs';

// URL-схема повторяет WordPress-оригинал ради SEO:
//   пост      /cars/izh-21251.html
//   рубрика   /cars            (nginx: try_files $uri $uri.html)
//   тег       /tag/bmw
//   страница  /contact
export default defineConfig({
  site: 'https://game-mafia2.ru',
  trailingSlash: 'never',
  build: { format: 'file' },
  integrations: [
    react(),
    sitemap({
      // страницы пагинации стоят под noindex — в sitemap им не место
      filter: (url) => !/\/page\/\d+$/.test(url),
      serialize: (item) => {
        // посты канонически заканчиваются на .html: /<category>/<slug>.html
        const path = new URL(item.url).pathname;
        if (/^\/[^/]+\/[^/]+$/.test(path) && !path.startsWith('/tag/')) {
          item.url = `${item.url}.html`;
        }
        return item;
      },
    }),
  ],
  markdown: {
    rehypePlugins: [rehypeMedia],
  },
});
