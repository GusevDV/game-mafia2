import type { APIRoute, GetStaticPaths } from 'astro';
import sharp from 'sharp';
import { join } from 'node:path';
import { getPosts } from '@/lib/site';
import { THUMB_WIDTHS, thumbBase } from '@/lib/thumbs';

const UPLOADS_DIR = join(process.cwd(), 'public/uploads');

export const getStaticPaths = (async () => {
  const sources = new Set<string>();
  for (const { data } of await getPosts()) {
    for (const src of [data.cover, ...data.screenshots]) if (src) sources.add(src);
  }
  const paths: { params: { path: string } }[] = [];
  for (const src of sources) {
    const base = thumbBase(src);
    if (!base) continue;
    for (const w of THUMB_WIDTHS) paths.push({ params: { path: `${base}-${w}.webp` } });
  }
  return paths;
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ params }) => {
  const match = params.path?.match(/^(.+)-(\d+)\.webp$/);
  if (!match) return new Response(null, { status: 404 });
  const [, base, width] = match;
  try {
    const body = await sharp(join(UPLOADS_DIR, `${base}.webp`))
      .resize({ width: Number(width), withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
    return new Response(new Uint8Array(body), { headers: { 'Content-Type': 'image/webp' } });
  } catch {
    return new Response(null, { status: 404 });
  }
};
