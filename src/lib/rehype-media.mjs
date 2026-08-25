import { visit } from 'unist-util-visit';

const YOUTUBE_RE =
  /^https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/;

/**
 * Rehype-плагин:
 *  - абзац, состоящий из одной YouTube-ссылки, превращается в ленивый embed;
 *  - всем <img> проставляется loading="lazy" и decoding="async".
 */
export function rehypeMedia() {
  return (tree) => {
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName === 'img') {
        node.properties.loading = 'lazy';
        node.properties.decoding = 'async';
        return;
      }
      if (
        node.tagName === 'p' &&
        node.children.length === 1 &&
        node.children[0].tagName === 'a'
      ) {
        const href = node.children[0].properties?.href ?? '';
        const id = href.match(YOUTUBE_RE)?.[1];
        if (!id || !parent || index === undefined) return;
        parent.children[index] = {
          type: 'element',
          tagName: 'div',
          properties: { className: ['video-embed'] },
          children: [
            {
              type: 'element',
              tagName: 'iframe',
              properties: {
                src: `https://www.youtube-nocookie.com/embed/${id}`,
                title: 'YouTube video',
                loading: 'lazy',
                allowFullScreen: true,
                allow: 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture',
              },
              children: [],
            },
          ],
        };
      }
    });
  };
}
