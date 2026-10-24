/**
 * Превью картинок из /uploads: оригиналы бывают 2560×1440 и тянутся целиком даже
 * для карточки в 380 px шириной. Превью строятся при сборке эндпоинтом
 * src/pages/thumbs/[...path].ts и лежат в /thumbs/<год>/<месяц>/<имя>-<ширина>.webp.
 */
export const THUMB_WIDTHS = [480, 800] as const;

const UPLOADS_PREFIX = '/uploads/';

/** Относительный путь без расширения: /uploads/2021/08/a.webp -> 2021/08/a. */
export function thumbBase(src: string): string | undefined {
  if (!src.startsWith(UPLOADS_PREFIX)) return undefined;
  return src.slice(UPLOADS_PREFIX.length).replace(/\.[^./]+$/, '');
}

export function thumbUrl(src: string, width: number): string {
  const base = thumbBase(src);
  return base ? encodeURI(`/thumbs/${base}-${width}.webp`) : src;
}

/** srcset для превью; для картинок вне /uploads — undefined. */
export function thumbSrcset(src: string): string | undefined {
  if (!thumbBase(src)) return undefined;
  return THUMB_WIDTHS.map((w) => `${thumbUrl(src, w)} ${w}w`).join(', ');
}
