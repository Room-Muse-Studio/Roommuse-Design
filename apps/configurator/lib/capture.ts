/**
 * A small JPEG of what the 3D view shows, for the project card. The renderer
 * doesn't keep its drawing buffer between frames, so the caller renders a
 * frame and hands the canvas over straight away; it's scaled down through an
 * ordinary 2D canvas. Browser only.
 */
export const THUMBNAIL_WIDTH = 320;
/** What the API accepts: a JPEG data URL of at most 64 KB. */
export const THUMBNAIL_MAX_BYTES = 64 * 1024;

export function captureThumbnail(source: HTMLCanvasElement, width = THUMBNAIL_WIDTH): string | null {
  const sw = source.width, sh = source.height;
  if (!sw || !sh) return null;
  const out = document.createElement('canvas');
  out.width = width;
  out.height = Math.round((width * sh) / sw);
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, out.width, out.height);
  for (const quality of [0.7, 0.5, 0.3]) {
    const url = out.toDataURL('image/jpeg', quality);
    if (dataUrlBytes(url) <= THUMBNAIL_MAX_BYTES) return url;
  }
  return null;
}

/** The decoded size of a base64 data URL. */
export function dataUrlBytes(url: string): number {
  const comma = url.indexOf(',');
  const b64 = comma >= 0 ? url.slice(comma + 1) : url;
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}
