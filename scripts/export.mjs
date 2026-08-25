#!/usr/bin/env node
/**
 * Экспорт контента WordPress (SQLite-слепок дампа) в Markdown/JSON.
 *
 *   node scripts/export.mjs
 *
 * Результат:
 *   src/content/posts/<категория>/<slug>.md
 *   src/content/pages/<slug>.md
 *   src/content/comments/<slug>.json        (без email/IP)
 *   src/content/taxonomies.json             (рубрики и теги: slug → название)
 *   private/comments-pii.json               (email/IP — в .gitignore)
 *   scripts/referenced-uploads.txt          (файлы uploads, на которые есть ссылки)
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import TurndownService from 'turndown';
import * as yaml from 'js-yaml';

const ROOT = new URL('..', import.meta.url).pathname;
const db = new DatabaseSync(join(ROOT, 'scripts/wp.sqlite'), { readOnly: true });

const OUT_POSTS = join(ROOT, 'src/content/posts');
const OUT_PAGES = join(ROOT, 'src/content/pages');
const OUT_COMMENTS = join(ROOT, 'src/content/comments');

for (const dir of [OUT_POSTS, OUT_PAGES, OUT_COMMENTS]) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}
mkdirSync(join(ROOT, 'private'), { recursive: true });

// ---------- справочники ----------

const attachments = new Map(); // attachment ID → относительный путь в uploads
for (const r of db
  .prepare(`SELECT post_id, meta_value FROM postmeta WHERE meta_key='_wp_attached_file'`)
  .all()) {
  attachments.set(Number(r.post_id), r.meta_value);
}

const terms = new Map(); // term_taxonomy_id → {taxonomy, slug, name, term_id}
for (const r of db
  .prepare(
    `SELECT tt.term_taxonomy_id, tt.taxonomy, tt.description, t.term_id, t.name, t.slug
     FROM term_taxonomy tt JOIN terms t ON t.term_id = tt.term_id`
  )
  .all()) {
  terms.set(Number(r.term_taxonomy_id), {
    taxonomy: r.taxonomy,
    termId: Number(r.term_id),
    name: r.name,
    slug: decodeURIComponent(r.slug),
    description: r.description || '',
  });
}

const postTerms = new Map(); // post ID → [term]
for (const r of db.prepare(`SELECT object_id, term_taxonomy_id FROM term_relationships`).all()) {
  const t = terms.get(Number(r.term_taxonomy_id));
  if (!t) continue;
  const id = Number(r.object_id);
  if (!postTerms.has(id)) postTerms.set(id, []);
  postTerms.get(id).push(t);
}

const meta = new Map(); // post ID → Map(key → [values])
for (const r of db.prepare(`SELECT post_id, meta_key, meta_value FROM postmeta`).all()) {
  const id = Number(r.post_id);
  if (!meta.has(id)) meta.set(id, new Map());
  const m = meta.get(id);
  if (!m.has(r.meta_key)) m.set(r.meta_key, []);
  m.get(r.meta_key).push(r.meta_value);
}

const aioseo = new Map(); // post ID → description
for (const r of db
  .prepare(`SELECT post_id, description FROM aioseo_posts WHERE description IS NOT NULL AND description != ''`)
  .all()) {
  aioseo.set(Number(r.post_id), r.description);
}

// ---------- HTML → Markdown ----------

const td = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});
td.keep(['video', 'audio']);
// YouTube-iframe → голая ссылка на видео отдельной строкой (единый формат с oEmbed)
td.addRule('youtubeIframe', {
  filter: (node) =>
    node.nodeName === 'IFRAME' &&
    /(?:youtube\.com|youtu\.be)\//.test(node.getAttribute('src') ?? ''),
  replacement: (_, node) => {
    const src = node.getAttribute('src');
    const id = src.match(/embed\/([\w-]+)/)?.[1];
    return id ? `\n\nhttps://www.youtube.com/watch?v=${id}\n\n` : `\n\n${src}\n\n`;
  },
});
td.keep(['iframe']);

const UPLOAD_URL_RE =
  /https?:\/\/(?:www\.)?game-mafia2\.ru\/wp-content\/uploads\/([^\s"'<>)]+)/g;

const referencedUploads = new Set();

// физически все картинки в public/uploads пережаты в WebP (см. scripts/convert-to-webp.mjs);
// referencedUploads при этом хранит ОРИГИНАЛЬНЫЕ имена — по ним файлы ищутся в бэкапе WP
const IMAGE_EXT_RE = /\.(jpe?g|png|bmp|gif)$/i;
const toWebpPath = (path) => path.replace(IMAGE_EXT_RE, '.webp');

function rewriteUploads(html) {
  return html.replace(UPLOAD_URL_RE, (_, path) => {
    referencedUploads.add(path);
    return `/uploads/${toWebpPath(path)}`;
  });
}

/** Упрощённый wpautop: двойные переводы строк → <p>, одиночные → <br>. */
const BLOCK_TAGS =
  'table|thead|tbody|tfoot|tr|td|th|caption|col|colgroup|div|dl|dd|dt|ul|ol|li|pre|form|map|area|blockquote|address|style|p|h[1-6]|hr|fieldset|legend|section|article|aside|figure|figcaption|header|footer|nav|details|summary|iframe';

function wpautop(text) {
  // отделяем блочные теги пустой строкой, как это делает оригинальный wpautop
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(new RegExp(`<(${BLOCK_TAGS})(\\s[^>]*)?>`, 'gi'), '\n\n$&')
    .replace(new RegExp(`</(${BLOCK_TAGS})>`, 'gi'), '$&\n\n');
  const blocks = normalized.split(/\n\s*\n/);
  return blocks
    .map((block) => {
      const b = block.trim();
      if (!b) return '';
      if (new RegExp(`^</?(${BLOCK_TAGS})[\\s/>]`, 'i').test(b)) return b;
      return `<p>${b.replace(/\n/g, '<br />\n')}</p>`;
    })
    .join('\n\n');
}

function htmlToMarkdown(rawContent) {
  let html = rawContent.replace(/<!--more-->/g, '');
  html = rewriteUploads(html);
  // внутренние ссылки сайта делаем относительными
  html = html.replace(/https?:\/\/(?:www\.)?game-mafia2\.ru(\/[^\s"'<>]*)?/g, (_, path) => path || '/');
  html = wpautop(html);
  let md = td.turndown(html);
  // голые YouTube-ссылки оставляем отдельной строкой — их подхватит embed-компонент
  return md.trim() + '\n';
}

function plainText(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Обрезает текст до maxLen по границе слова. */
function truncate(text, maxLen = 160) {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:.]$/, '') + '…';
}

function makeExcerpt(post) {
  if (post.post_excerpt?.trim()) return truncate(plainText(post.post_excerpt));
  const moreIdx = post.post_content.indexOf('<!--more-->');
  const src = moreIdx > 0 ? post.post_content.slice(0, moreIdx) : post.post_content;
  return truncate(plainText(src) || plainText(post.post_content));
}

function resolveDescription(post) {
  let d = aioseo.get(post.ID) ?? meta.get(post.ID)?.get('_aioseo_description')?.[0]
    ?? meta.get(post.ID)?.get('_aioseop_description')?.[0] ?? '';
  d = d.trim();
  if (!d || d.includes('#post_excerpt') || d.includes('#post_content')) {
    const excerpt = makeExcerpt(post);
    d = d ? d.replace(/#post_excerpt|#post_content/g, excerpt).trim() : excerpt;
  }
  return truncate(plainText(d), 300);
}

// ---------- вынос «Скачать»-ссылок из текста в frontmatter ----------

// любая ссылка (не картинка), с опциональным title-атрибутом
const LINK_RE = /(?<!!)\[([^\]]*)\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/g;
const DL_TEXT_RE = /скачать|download|зеркало|mirror/i;
// строка, где кроме вынесенных ссылок остался только мусор и пометки
const DL_RESIDUE_RE =
  /^[\s\\*_.,;:!()\-–—]*(Загрузк[аи]\s*:?)?[\s\\*_.,;:!()\-–—]*(\((резервн[а-яё]+\s+ссылка|альтернативн[а-яё]+\s+ссылка|зеркало|mirror)\)[\s\\*_.,;:!\-–—]*)*$/i;
// строка-заголовок блока загрузки
const DL_HEADER_RE =
  /^\**\s*(Загрузк[аи]|Скачать|Ссылк[аи] на скачивание)\s*(\([^)]*\))?\s*:?\s*\**[\s\\]*$/i;
// заголовок версионного блока — такие ссылки оставляем в тексте
// (это архивные версии файла, а не резервные копии актуального)
const VERSION_HDR_RE = /(предыдущ|стар[ао]я|устаревш)/i;
const VERSION_START_RE = /^\**\s*верси[яию]/i; // JS \b не понимает кириллицу

/**
 * Убирает из тела поста строки, состоящие только из ссылок «Скачать»
 * (+ пометки «резервная/альтернативная ссылка»/«зеркало»), и возвращает
 * найденные URL. Инлайновые ссылки внутри предложений остаются на месте.
 */
function extractDownloadLinks(body) {
  // turndown иногда рвёт текст ссылки переносом: `[Ска\nчать](url)` — склеиваем
  for (let pass = 0; pass < 3; pass++) {
    body = body.replace(/\[([^\]\n]*)[ \t]*\n[ \t]*([^\]\n]*\]\()/g, '[$1$2');
  }

  const lines = body.split('\n');
  const links = [];
  const removed = new Set();

  const isDlLine = (line) => {
    const all = [...line.matchAll(LINK_RE)];
    return all.some((m) => DL_TEXT_RE.test(m[1]));
  };

  // ближайшая содержательная строка выше (пропуская пустые и другие строки-ссылки)
  const underVersionHeader = (i) => {
    for (let j = i - 1; j >= 0; j--) {
      const t = lines[j].trim();
      if (t === '' || isDlLine(lines[j])) continue;
      return VERSION_HDR_RE.test(t) || VERSION_START_RE.test(t);
    }
    return false;
  };

  lines.forEach((line, i) => {
    const all = [...line.matchAll(LINK_RE)];
    if (!all.some((m) => DL_TEXT_RE.test(m[1]))) return;
    if (underVersionHeader(i)) return; // архивная версия — остаётся в тексте
    // «Скачать»-ссылки + пустые осколки ссылок рядом с ними
    const accepted = all.filter((m) => DL_TEXT_RE.test(m[1]) || m[1].trim() === '');
    let residue = line;
    for (const m of accepted) residue = residue.replace(m[0], '');
    if (!DL_RESIDUE_RE.test(residue)) return; // ссылка внутри предложения
    links.push(...accepted.map((m) => m[2]));
    removed.add(i);
  });

  if (!links.length) return { body, links };

  // заголовки «Загрузка:» перед вынесенными строками тоже убираем
  lines.forEach((line, i) => {
    if (!DL_HEADER_RE.test(line)) return;
    for (let j = i + 1; j < lines.length; j++) {
      if (removed.has(j)) return removed.add(i);
      if (lines[j].trim() !== '') return;
    }
  });

  const cleaned = lines
    .filter((_, i) => !removed.has(i))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { body: cleaned + '\n', links };
}

// ---------- экспорт постов ----------

const posts = db
  .prepare(
    `SELECT ID, post_date, post_modified, post_content, post_excerpt, post_title, post_name, post_status
     FROM posts
     WHERE post_type='post' AND post_status IN ('publish','draft','private','pending')
     ORDER BY ID`
  )
  .all()
  .map((p) => ({ ...p, ID: Number(p.ID) }));

const postById = new Map(posts.map((p) => [p.ID, p]));
const usedSlugs = new Set();
let exported = 0;

const slugToFile = new Map(); // slug → путь (для комментариев)

for (const post of posts) {
  const m = meta.get(post.ID) ?? new Map();
  const allTerms = postTerms.get(post.ID) ?? [];
  const cats = allTerms
    .filter((t) => t.taxonomy === 'category')
    .sort((a, b) => a.termId - b.termId);
  const tags = allTerms
    .filter((t) => t.taxonomy === 'post_tag')
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  let slug = post.post_name?.trim();
  if (!slug) {
    if (post.post_status !== 'publish' && !post.post_title.trim() && !post.post_content.trim())
      continue; // пустые авточерновики
    slug = `draft-${post.ID}`;
  }
  if (usedSlugs.has(slug)) slug = `${slug}-${post.ID}`;
  usedSlugs.add(slug);

  const primaryCat = cats[0]?.slug ?? 'uncategorized';

  // обложка: _thumbnail_id → скриншоты → первая картинка контента
  const screenshotIds = (m.get('screenshots') ?? []).map(Number);
  const screenshots = screenshotIds
    .map((id) => attachments.get(id))
    .filter(Boolean)
    .map((p) => {
      referencedUploads.add(p);
      return `/uploads/${toWebpPath(p)}`;
    });

  let cover = null;
  const thumbId = Number(m.get('_thumbnail_id')?.[0]);
  if (thumbId && attachments.get(thumbId)) {
    const p = attachments.get(thumbId);
    referencedUploads.add(p);
    cover = `/uploads/${toWebpPath(p)}`;
  }

  const { body, links: bodyLinks } = extractDownloadLinks(htmlToMarkdown(post.post_content));

  if (!cover) {
    const firstImg = body.match(/!\[[^\]]*\]\((\/uploads\/[^)\s]+)/)?.[1];
    cover = firstImg ?? screenshots[0] ?? null;
  }

  const downloadLinks = [
    ...new Set(
      [
        ...(m.get('download_link_1') ?? []),
        ...(m.get('download_link_2') ?? []),
        ...(m.get('file') ?? []),
        ...bodyLinks,
      ]
        .map((v) => v.trim())
        .filter((v) => /^https?:\/\//.test(v))
        .map(rewriteUploads)
    ),
  ];

  const fm = {
    title: post.post_title || slug,
    date: new Date(post.post_date.replace(' ', 'T') + '+03:00'),
    slug,
    categories: cats.map((c) => c.slug),
    tags: tags.map((t) => t.slug),
    description: resolveDescription(post),
  };
  if (post.post_status !== 'publish') fm.draft = true;
  if (cover) fm.cover = cover;
  if (screenshots.length) fm.screenshots = screenshots;
  if (downloadLinks.length) fm.downloadLinks = downloadLinks;
  const modAuthor = m.get('mod_author')?.[0]?.trim();
  if (modAuthor) fm.modAuthor = modAuthor;
  const instruction = m.get('instruction')?.[0]?.trim();
  if (instruction) fm.instruction = htmlToMarkdown(instruction).trim();
  const views = Number(m.get('views')?.[0]);
  if (views) fm.views = views;

  const file = join(OUT_POSTS, primaryCat, `${slug}.md`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `---\n${yaml.dump(fm, { lineWidth: 1000 })}---\n\n${body}`);
  slugToFile.set(post.ID, slug);
  exported++;
}

// ---------- страницы ----------

const pages = db
  .prepare(
    `SELECT ID, post_date, post_content, post_title, post_name FROM posts
     WHERE post_type='page' AND post_status='publish'
       AND post_name != 'confidentiality'` // решили не публиковать
  )
  .all();
for (const page of pages) {
  const fm = {
    title: page.post_title,
    date: new Date(page.post_date.replace(' ', 'T') + '+03:00'),
    slug: page.post_name,
  };
  writeFileSync(
    join(OUT_PAGES, `${page.post_name}.md`),
    `---\n${yaml.dump(fm, { lineWidth: 1000 })}---\n\n${htmlToMarkdown(page.post_content)}`
  );
}

// ---------- таксономии ----------

const taxonomies = {
  categories: [...terms.values()]
    .filter((t) => t.taxonomy === 'category')
    .map(({ slug, name, description }) => ({ slug, name, description })),
  tags: [...terms.values()]
    .filter((t) => t.taxonomy === 'post_tag')
    .map(({ slug, name }) => ({ slug, name })),
};
writeFileSync(join(ROOT, 'src/content/taxonomies.json'), JSON.stringify(taxonomies, null, 2));

// ---------- комментарии ----------

const comments = db
  .prepare(
    `SELECT comment_ID, comment_post_ID, comment_author, comment_author_email, comment_author_IP,
            comment_date, comment_content, comment_parent, user_id
     FROM comments WHERE comment_approved='1' ORDER BY comment_date`
  )
  .all();

const byPost = new Map();
const pii = [];
let orphaned = 0;
for (const c of comments) {
  const postId = Number(c.comment_post_ID);
  const slug = slugToFile.get(postId);
  if (!slug) {
    orphaned++;
    continue;
  }
  if (!byPost.has(slug)) byPost.set(slug, []);
  byPost.get(slug).push({
    id: Number(c.comment_ID),
    parentId: Number(c.comment_parent) || null,
    author: c.comment_author,
    date: c.comment_date.replace(' ', 'T') + '+03:00',
    text: c.comment_content,
  });
  pii.push({
    id: Number(c.comment_ID),
    email: c.comment_author_email || null,
    ip: c.comment_author_IP || null,
    userId: Number(c.user_id) || null,
  });
}
let exportedComments = 0;
for (const [slug, list] of byPost) {
  writeFileSync(join(OUT_COMMENTS, `${slug}.json`), JSON.stringify(list, null, 2));
  exportedComments += list.length;
}
writeFileSync(join(ROOT, 'private/comments-pii.json'), JSON.stringify(pii, null, 2));

// ---------- список нужных файлов uploads ----------

writeFileSync(
  join(ROOT, 'scripts/referenced-uploads.txt'),
  [...referencedUploads].sort().join('\n') + '\n'
);

console.log(`posts: ${exported}`);
console.log(`pages: ${pages.length}`);
console.log(`comments: ${exportedComments} (orphaned: ${orphaned})`);
console.log(`referenced uploads: ${referencedUploads.size}`);
