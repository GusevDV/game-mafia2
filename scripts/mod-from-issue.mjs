#!/usr/bin/env node
/**
 * Заявка «Добавить мод» (issue form .github/ISSUE_TEMPLATE/add-mod.yml) → пост.
 *
 * Читает событие GitHub (issues), разбирает поля формы, скачивает скриншоты,
 * переводит их в WebP и пишет src/content/posts/<рубрика>/<slug>.md.
 * Git и pull request делает workflow .github/workflows/mod-submission.yml.
 *
 *   node scripts/mod-from-issue.mjs "$GITHUB_EVENT_PATH"
 *   node scripts/mod-from-issue.mjs event.json --dry-run   # только показать пост
 *
 * Результат для workflow — в $GITHUB_OUTPUT (ok, file, title) и текстовые файлы
 * в $RUNNER_TEMP: mod-pr-body.md, mod-comment.md.
 *
 * Тело заявки — недоверенный ввод: HTML вырезается, картинки качаются только
 * с хостов GitHub, всё остальное попадает в YAML через js-yaml.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const POSTS_DIR = join(ROOT, 'src/content/posts');
const UPLOADS_DIR = join(ROOT, 'public/uploads');
const taxonomies = JSON.parse(readFileSync(join(ROOT, 'src/content/taxonomies.json'), 'utf8'));

// Заголовки полей формы — ровно как label в add-mod.yml.
const FIELDS = {
  title: 'Название',
  category: 'Рубрика',
  version: 'Версия игры',
  author: 'Автор мода',
  description: 'Описание',
  links: 'Ссылки на скачивание',
  instruction: 'Установка',
  screenshots: 'Скриншоты',
  video: 'Видео на YouTube',
  rights: 'Права на публикацию',
};

const DE_CATEGORY = 'mafia2-de';
const MAX_SCREENSHOTS = 12;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const IMAGE_WIDTH = 1920;
const SLUG_MAX = 60;
// Совпадает с регэкспом встраивания в src/lib/rehype-media.mjs.
const YOUTUBE_RE = /^https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/;

// ── разбор тела заявки ──────────────────────────────────────────────────────

/** Делит тело issue form на секции по заголовкам «### <label>» известных полей. */
function parseIssueForm(body) {
  const labels = new Set(Object.values(FIELDS));
  const sections = {};
  let current = null;
  for (const line of body.replace(/\r\n/g, '\n').split('\n')) {
    const heading = line.match(/^###\s+(.+?)\s*$/);
    if (heading && labels.has(heading[1])) {
      current = heading[1];
      sections[current] = [];
    } else if (current) {
      sections[current].push(line);
    }
  }
  const out = {};
  for (const [key, label] of Object.entries(FIELDS)) {
    const text = (sections[label] ?? []).join('\n').trim();
    out[key] = text === '_No response_' ? '' : text;
  }
  return out;
}

/** Убирает обёртку ```text … ```, которую GitHub добавляет полям с render. */
function unfence(text) {
  const m = text.match(/^```[\w-]*\n([\s\S]*?)\n?```$/);
  return m ? m[1].trim() : text;
}

const IMAGE_MD_RE = /!\[[^\]]*\]\((\S+?)(?:\s+"[^"]*")?\)/g;
const IMAGE_TAG_RE = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;

/** Достаёт адреса картинок (Markdown и <img>) и возвращает текст без них. */
function extractImages(text) {
  const urls = [];
  const rest = text
    .replace(IMAGE_MD_RE, (_, url) => (urls.push(url), ''))
    .replace(IMAGE_TAG_RE, (_, url) => (urls.push(url), ''));
  return { urls, rest };
}

/**
 * Обезвреживает HTML: в пост попадает только Markdown. Теги не вырезаются, а
 * экранируются, чтобы «нажмите <F5>» в инструкции не потеряло клавишу.
 */
function sanitize(text) {
  return text
    .replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replaceAll('<', '&lt;')
    .replace(/\]\(\s*(?:javascript|data|vbscript):[^)]*\)/gi, '](#)')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Однострочный текст (название, автор): без тегов и переносов. */
function plainLine(text) {
  return text.replace(/<[^>]*>/g, '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
}

/** Первое предложение описания без Markdown — для meta description. */
function summary(markdown) {
  const plain = markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const sentence = plain.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? plain;
  return sentence.length > 200 ? `${sentence.slice(0, 197).replace(/\s+\S*$/, '')}…` : sentence;
}

// ── slug ────────────────────────────────────────────────────────────────────

// Как у старых WordPress-постов (cyr2lat): «прохождение» → proxozhdenie.
const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i',
  й: 'j', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'x', ц: 'c', ч: 'ch', ш: 'sh', щ: 'shh', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya', і: 'i', ї: 'yi', є: 'ye', ґ: 'g',
};

function slugify(title) {
  const latin = [...title.toLowerCase()].map((ch) => TRANSLIT[ch] ?? ch).join('');
  let slug = latin.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug.length > SLUG_MAX) slug = slug.slice(0, SLUG_MAX).replace(/-[^-]*$/, '');
  return slug;
}

function existingSlugs() {
  const slugs = new Set();
  for (const dir of readdirSync(POSTS_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const file of readdirSync(join(POSTS_DIR, dir.name))) {
      if (!file.endsWith('.md')) continue;
      slugs.add(file.slice(0, -3));
      const fm = readFileSync(join(POSTS_DIR, dir.name, file), 'utf8').match(/^slug:\s*['"]?([^'"\n]+)/m);
      if (fm) slugs.add(fm[1].trim());
    }
  }
  return slugs;
}

function uniqueSlug(base, taken) {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

// ── картинки ────────────────────────────────────────────────────────────────

/** Только вложения, загруженные в GitHub: никаких запросов на чужие адреса. */
function isGithubAttachment(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.hostname === 'github.com') return url.pathname.startsWith('/user-attachments/assets/');
  return url.hostname === 'user-images.githubusercontent.com' || url.hostname === 'private-user-images.githubusercontent.com';
}

async function download(url) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_IMAGE_BYTES) throw new Error('файл больше 15 МБ');
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > MAX_IMAGE_BYTES) throw new Error('файл больше 15 МБ');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function saveScreenshots(urls, slug, date, warnings) {
  const { default: sharp } = await import('sharp');
  const month = `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  const dir = join(UPLOADS_DIR, month);
  mkdirSync(dir, { recursive: true });
  const saved = [];
  for (const [i, url] of urls.entries()) {
    const n = i + 1;
    try {
      const input = await download(url);
      const meta = await sharp(input).metadata();
      if (!['jpeg', 'png', 'webp', 'gif', 'avif', 'tiff', 'heif'].includes(meta.format)) {
        throw new Error(`неподдерживаемый формат ${meta.format ?? '?'}`);
      }
      let name = `${slug}-${n}.webp`;
      for (let k = 2; existsSync(join(dir, name)); k++) name = `${slug}-${n}-${k}.webp`;
      await sharp(input, { animated: false })
        .rotate()
        .resize({ width: IMAGE_WIDTH, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(join(dir, name));
      saved.push(`/uploads/${month}/${name}`);
    } catch (err) {
      warnings.push(`Скриншот №${n} не удалось обработать (${err.message}).`);
    }
  }
  return saved;
}

// ── сборка поста ────────────────────────────────────────────────────────────

function categorySlug(name) {
  return taxonomies.categories.find((c) => c.name === name)?.slug;
}

/** Проверяет поля и собирает всё для поста, кроме скачивания картинок. */
function buildDraft(issue) {
  const f = parseIssueForm(issue.body ?? '');
  const errors = [];
  const warnings = [];

  const title = plainLine(f.title || (issue.title ?? '').replace(/^\[Мод\]:\s*/, ''));
  if (!title) errors.push('Не заполнено название.');

  const category = categorySlug(f.category);
  if (!category) errors.push(`Неизвестная рубрика «${f.category}».`);
  const categories = [category];
  if (/Definitive|Обе/.test(f.version) && category !== DE_CATEGORY) categories.push(DE_CATEGORY);

  const desc = extractImages(f.description);
  const instr = extractImages(f.instruction);
  const shots = extractImages(f.screenshots);
  const description = sanitize(desc.rest);
  const instruction = sanitize(instr.rest);
  if (!description) errors.push('Не заполнено описание.');

  const links = [];
  for (const raw of unfence(f.links).match(/https?:\/\/[^\s<>()"']+/g) ?? []) {
    try {
      const url = new URL(raw);
      if (!links.includes(url.href)) links.push(url.href);
    } catch {
      warnings.push(`Ссылка «${raw}» не похожа на адрес и пропущена.`);
    }
  }
  if (links.length === 0) errors.push('Нет ни одной ссылки на скачивание.');

  const video = f.video.trim();
  if (video && !YOUTUBE_RE.test(video)) {
    warnings.push('Видео пропущено: нужна ссылка вида https://www.youtube.com/watch?v=… или https://youtu.be/…');
  }

  if (!/- \[x\]/i.test(f.rights)) errors.push('Не отмечено согласие на публикацию.');

  const imageUrls = [];
  for (const url of [...shots.urls, ...desc.urls, ...instr.urls]) {
    if (imageUrls.includes(url)) continue;
    if (!isGithubAttachment(url)) {
      warnings.push(`Картинка ${url} пропущена: загружайте скриншоты перетаскиванием в форму, а не ссылкой на другой сайт.`);
      continue;
    }
    imageUrls.push(url);
  }
  if (imageUrls.length > MAX_SCREENSHOTS) {
    warnings.push(`Скриншотов больше ${MAX_SCREENSHOTS}, лишние пропущены.`);
    imageUrls.length = MAX_SCREENSHOTS;
  }
  if (imageUrls.length === 0) warnings.push('Нет скриншотов — у карточки мода не будет обложки.');

  return {
    errors,
    warnings,
    title,
    categories,
    description,
    instruction,
    links,
    video: YOUTUBE_RE.test(video) ? video : '',
    modAuthor: plainLine(f.author),
    imageUrls,
  };
}

function renderPost(d, { slug, date, screenshots }) {
  const fm = {
    title: d.title,
    date,
    slug,
    categories: d.categories,
    tags: [],
    description: summary(d.description),
    ...(screenshots.length && { cover: screenshots[0], screenshots }),
    downloadLinks: d.links,
    ...(d.modAuthor && { modAuthor: d.modAuthor }),
    ...(d.instruction && { instruction: d.instruction }),
  };
  const body = [d.description, d.video].filter(Boolean).join('\n\n');
  return `---\n${yaml.dump(fm, { lineWidth: 1000 })}---\n\n${body}\n`;
}

// ── запуск ──────────────────────────────────────────────────────────────────

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function list(items) {
  return items.map((s) => `- ${s}`).join('\n');
}

async function main() {
  const [eventPath, ...flags] = process.argv.slice(2);
  if (!eventPath) {
    console.error('usage: node scripts/mod-from-issue.mjs <event.json> [--dry-run]');
    process.exit(2);
  }
  const dryRun = flags.includes('--dry-run');
  const { issue } = JSON.parse(readFileSync(eventPath, 'utf8'));
  const outDir = process.env.RUNNER_TEMP ?? tmpdir();
  const draft = buildDraft(issue);

  if (draft.errors.length) {
    const msg = [
      'Не получилось подготовить страницу мода — пожалуйста, отредактируйте заявку:',
      '',
      list(draft.errors),
      ...(draft.warnings.length ? ['', list(draft.warnings)] : []),
      '',
      'После сохранения черновик соберётся заново.',
    ].join('\n');
    writeFileSync(join(outDir, 'mod-comment.md'), `${msg}\n`);
    console.log(msg);
    setOutput('ok', 'false');
    return;
  }

  const date = new Date(issue.created_at ?? Date.now());
  date.setUTCMilliseconds(0);
  const slug = uniqueSlug(slugify(draft.title) || `mod-${issue.number}`, existingSlugs());
  const screenshots = dryRun
    ? draft.imageUrls.map((_, i) => `/uploads/(dry-run)/${slug}-${i + 1}.webp`)
    : await saveScreenshots(draft.imageUrls, slug, date, draft.warnings);
  const post = renderPost(draft, { slug, date, screenshots });
  const file = join(POSTS_DIR, draft.categories[0], `${slug}.md`);
  const url = `https://game-mafia2.ru/${draft.categories[0]}/${slug}.html`;

  if (dryRun) {
    console.log(`→ ${relative(ROOT, file)}\n\n${post}`);
    if (draft.warnings.length) console.log(`warnings:\n${list(draft.warnings)}`);
    return;
  }

  writeFileSync(file, post);

  const notes = draft.warnings.length ? ['', '**Замечания:**', list(draft.warnings)] : [];
  writeFileSync(
    join(outDir, 'mod-pr-body.md'),
    [
      `Заявка #${issue.number} от @${issue.user?.login ?? 'unknown'}.`,
      '',
      `Страница: \`${url}\``,
      `Файл: \`${relative(ROOT, file).replaceAll('\\', '/')}\`, скриншотов: ${screenshots.length}.`,
      ...notes,
      '',
      'Перед мержем проверьте:',
      '- [ ] ссылки на скачивание живые и ведут на сам мод;',
      '- [ ] рубрика, название и описание; при необходимости добавьте `tags`;',
      '- [ ] скриншоты относятся к моду.',
      '',
      'Ветка пересобирается при каждой правке заявки и затрёт ручные изменения.',
      'Чтобы править PR руками, сначала снимите с заявки метку `new-mod`.',
      '',
      `Closes #${issue.number}`,
    ].join('\n') + '\n',
  );
  writeFileSync(
    join(outDir, 'mod-comment.md'),
    [
      'Черновик страницы готов и ждёт проверки модератором.',
      '',
      `После публикации мод будет здесь: ${url}`,
      ...notes,
      '',
      'Если нужно что-то поправить — отредактируйте заявку, черновик обновится.',
    ].join('\n') + '\n',
  );

  setOutput('ok', 'true');
  setOutput('file', relative(ROOT, file).replaceAll('\\', '/'));
  setOutput('title', draft.title.replace(/[\r\n]+/g, ' '));
  console.log(`wrote ${relative(ROOT, file)}, ${screenshots.length} screenshot(s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
