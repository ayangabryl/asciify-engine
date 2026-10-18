import { boxBlur, buildHoverGuide } from './hover-guide';

/**
 * What a photograph says about its own light and depth, per cell, so motion can come from the image rather
 * than being laid over it. Eight floats per cell:
 * 0 local light (luminance softened over a few cells), 1 depth (0 far, 1 near), 2 glow (nearness to a highlight),
 * 3 detail (local contrast), 4–5 surface normal from the luminance relief, 6–7 the subject's center.
 */
export const PHOTO_CUE_STRIDE = 8;
export type PhotoCues = Float32Array;

const smooth = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The value below which `share` of the samples fall; robust normalization without a full sort. */
function quantile(values: Float32Array, share: number, bins = 256) {
  let max = 0;
  for (let i = 0; i < values.length; i++) if (values[i] > max) max = values[i];
  if (max <= 0) return 0;
  const counts = new Uint32Array(bins);
  for (let i = 0; i < values.length; i++) counts[Math.min(bins - 1, Math.floor(values[i] / max * bins))]++;
  let seen = 0;
  const target = values.length * share;
  for (let b = 0; b < bins; b++) { seen += counts[b]; if (seen >= target) return (b + 1) / bins * max; }
  return max;
}

/** Straight-alpha RGBA at the cell grid in; cues out. Cheap enough to rebuild for every video frame. */
export function buildPhotoCues(rgba: ArrayLike<number>, width: number, height: number, previous?: PhotoCues | null): PhotoCues {
  const n = width * height;
  const cues = previous?.length === n * PHOTO_CUE_STRIDE ? previous : new Float32Array(n * PHOTO_CUE_STRIDE);
  if (!n) return cues;
  const short = Math.min(width, height);
  const lum = new Float32Array(n), soft = new Float32Array(n), relief = new Float32Array(n);
  const detail = new Float32Array(n), glow = new Float32Array(n), depth = new Float32Array(n), scratch = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3] / 255;
    lum[i] = (rgba[i * 4] * .299 + rgba[i * 4 + 1] * .587 + rgba[i * 4 + 2] * .114) / 255 * a;
  }
  soft.set(lum); boxBlur(soft, scratch, width, height, Math.max(1, Math.round(short * .012)));
  relief.set(lum); boxBlur(relief, scratch, width, height, Math.max(1, Math.round(short * .03)));
  for (let i = 0; i < n; i++) {
    detail[i] = Math.abs(lum[i] - soft[i]);
    const h = Math.max(0, lum[i] - .55) / .45;
    glow[i] = h * h;
  }
  boxBlur(detail, scratch, width, height, Math.max(1, Math.round(short * .02)));
  const detailScale = 1 / Math.max(.02, quantile(detail, .95));
  boxBlur(glow, scratch, width, height, Math.max(1, Math.round(short * .05)));
  const glowScale = 1 / Math.max(.03, quantile(glow, .98));
  // Depth: a subject the guide can find (alpha, a plain ground) wins; otherwise sharp, central, lower detail is near.
  const guide = buildHoverGuide(rgba, width, height);
  let cx = 0, cy = 0, weight = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, u = (x + .5) / width, v = (y + .5) / height;
    const sharp = Math.min(1, detail[i] * detailScale);
    const central = 1 - Math.min(1, Math.hypot((u - .5) * 1.3, v - .55) * 1.6);
    const ground = smooth(.2, 1, v);
    const guess = sharp * .55 + central * .3 + ground * .15;
    depth[i] = guide.key === 'none' ? guess : guide.subject[i] * .75 + guess * .25;
    const w = depth[i] * depth[i] * (.25 + lum[i]);
    cx += u * w; cy += v * w; weight += w;
  }
  boxBlur(depth, scratch, width, height, Math.max(1, Math.round(short * .06)));
  const low = quantile(depth, .05), high = quantile(depth, .95);
  const span = Math.max(.05, high - low);
  cx = weight > 0 ? Math.max(.3, Math.min(.7, cx / weight)) : .5;
  cy = weight > 0 ? Math.max(.3, Math.min(.7, cy / weight)) : .5;
  const gradientScale = 1 / Math.max(.004, quantile((() => {
    const g = new Float32Array(n);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x;
      g[i] = Math.hypot(relief[y * width + Math.min(width - 1, x + 1)] - relief[y * width + Math.max(0, x - 1)],
        relief[Math.min(height - 1, y + 1) * width + x] - relief[Math.max(0, y - 1) * width + x]);
    }
    return g;
  })(), .97));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, o = i * PHOTO_CUE_STRIDE;
    const gx = (relief[y * width + Math.min(width - 1, x + 1)] - relief[y * width + Math.max(0, x - 1)]) * gradientScale;
    const gy = (relief[Math.min(height - 1, y + 1) * width + x] - relief[Math.max(0, y - 1) * width + x]) * gradientScale;
    cues[o] = relief[i];
    cues[o + 1] = Math.max(0, Math.min(1, (depth[i] - low) / span));
    cues[o + 2] = Math.min(1, glow[i] * glowScale);
    cues[o + 3] = Math.min(1, detail[i] * detailScale);
    // Bright reads as raised: a slope's normal leans away from the brighter side.
    cues[o + 4] = Math.max(-1, Math.min(1, -gx));
    cues[o + 5] = Math.max(-1, Math.min(1, -gy));
    cues[o + 6] = cx; cues[o + 7] = cy;
  }
  return cues;
}

/** Packs light, depth, glow and detail for the GPU; normals are taken from the light channel there. */
export function packPhotoCues(cues: PhotoCues, out?: Uint8Array) {
  const n = cues.length / PHOTO_CUE_STRIDE;
  const pixels = out?.length === n * 4 ? out : new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) for (let c = 0; c < 4; c++) pixels[i * 4 + c] = Math.round(cues[i * PHOTO_CUE_STRIDE + c] * 255);
  return pixels;
}

const frameCache = new WeakMap<object, PhotoCues>();
/** Cues for an engine frame of cells, cached per frame so a looping still is analysed once. */
export function frameCues(frame: readonly (readonly { r: number; g: number; b: number; a: number }[])[]) {
  const cached = frameCache.get(frame);
  if (cached) return cached;
  const rows = frame.length, cols = frame[0]?.length ?? 0, rgba = new Uint8ClampedArray(cols * rows * 4);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const cell = frame[y][x], i = (y * cols + x) * 4;
    rgba[i] = cell.r; rgba[i + 1] = cell.g; rgba[i + 2] = cell.b; rgba[i + 3] = cell.a;
  }
  const cues = buildPhotoCues(rgba, cols, rows);
  frameCache.set(frame, cues);
  return cues;
}
