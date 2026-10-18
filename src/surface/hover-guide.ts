/** Where a hover may act. `all` is the whole artwork; `subject` keeps it on the subject; `outside` keeps it off. */
export type HoverScope = 'all' | 'subject' | 'outside';
export const HOVER_SCOPES: readonly { value: HoverScope; label: string; description: string }[] = [
  { value: 'all', label: 'Everywhere', description: 'The hover acts on the whole artwork.' },
  { value: 'subject', label: 'Subject', description: 'The hover stays on the subject and fades softly at its edge.' },
  { value: 'outside', label: 'Around', description: 'The hover acts only on the ground around the subject.' },
];
export const normalizeHoverScope = (value: unknown): HoverScope => value === 'subject' || value === 'outside' ? value : 'all';

/** How the subject was found: source alpha, a drawn mask, a plain ground keyed by luminance, or nothing (scope acts as `all`). */
export type HoverGuideKey = 'alpha' | 'mask' | 'ground' | 'none';
export interface HoverGuide {
  width: number;
  height: number;
  /** 0..1 soft subject coverage. */
  subject: Float32Array;
  /** 0..1 smoothed brightness, for depth effects. */
  depth: Float32Array;
  key: HoverGuideKey;
}

export function boxBlur(values: Float32Array, scratch: Float32Array, w: number, h: number, radius: number) {
  if (radius < 1) return;
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) {
      let sum = 0;
      const row = y * w;
      for (let x = -radius; x <= radius; x++) sum += values[row + Math.max(0, Math.min(w - 1, x))];
      for (let x = 0; x < w; x++) {
        scratch[row + x] = sum / (radius * 2 + 1);
        sum += values[row + Math.min(w - 1, x + radius + 1)] - values[row + Math.max(0, x - radius)];
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) sum += scratch[Math.max(0, Math.min(h - 1, y)) * w + x];
      for (let y = 0; y < h; y++) {
        values[y * w + x] = sum / (radius * 2 + 1);
        sum += scratch[Math.min(h - 1, y + radius + 1) * w + x] - scratch[Math.max(0, y - radius) * w + x];
      }
    }
  }
}

/**
 * Builds the subject guide from straight-alpha RGBA samples on a small grid.
 * Source alpha wins. An opaque image on a plain ground (a product or figure on black or white) is keyed by its
 * distance from the ground's tone, read from the border. A busy, edge-to-edge photo has no reliable subject, so the
 * guide reports `none` and every scope behaves like `all` rather than guessing.
 * A drawn `mask` (0..1 per sample) is the person's own subject: it replaces ground keying and multiplies with alpha.
 */
let blurScratch = new Float32Array(0);
export function buildHoverGuide(rgba: ArrayLike<number>, width: number, height: number, mask?: ArrayLike<number> | null, previous?: HoverGuide | null): HoverGuide {
  const n = width * height;
  const guide = previous && previous.width === width && previous.height === height ? previous
    : { width, height, subject: new Float32Array(n), depth: new Float32Array(n), key: 'none' as HoverGuideKey };
  const { subject, depth } = guide;
  let clear = 0;
  for (let i = 0; i < n; i++) if (rgba[i * 4 + 3] < 250) clear++;
  const lum = (i: number) => (rgba[i * 4] * .2126 + rgba[i * 4 + 1] * .7152 + rgba[i * 4 + 2] * .0722) / 255;
  let key: HoverGuideKey = 'none', ground = 0;
  if (clear > n * .01) key = 'alpha';
  else if (mask) key = 'mask';
  else {
    let sum = 0, square = 0, count = 0;
    const ring = Math.max(1, Math.round(Math.min(width, height) * .03));
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (x >= ring && y >= ring && x < width - ring && y < height - ring) continue;
      const l = lum(y * width + x); sum += l; square += l * l; count++;
    }
    ground = sum / Math.max(1, count);
    const spread = Math.sqrt(Math.max(0, square / Math.max(1, count) - ground * ground));
    if (spread < .07) key = 'ground';
  }
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3] / 255, l = lum(i);
    let s = 1;
    if (key === 'alpha') s = a;
    else if (key === 'ground') { const t = Math.max(0, Math.min(1, (Math.abs(l - ground) - .035) / .12)); s = t * t * (3 - 2 * t); }
    subject[i] = s * (mask ? Math.max(0, Math.min(1, mask[i])) : 1);
    depth[i] = l * a;
  }
  guide.key = key;
  // A feather of about 2% of the short side: soft at the boundary, never a hard clip.
  // Video rebuilds the guide a few times a second; the blur scratch is reused rather than reallocated.
  if (blurScratch.length < n) blurScratch = new Float32Array(n);
  const scratch = blurScratch;
  boxBlur(subject, scratch, width, height, Math.max(1, Math.round(Math.min(width, height) * .02)));
  boxBlur(depth, scratch, width, height, Math.max(1, Math.round(Math.min(width, height) * .035)));
  return guide;
}

/** How much a hover may act at a guide sample, for a scope. Without a subject, every scope acts everywhere. */
export function scopeWeight(scope: HoverScope, coverage: number, key: HoverGuideKey = 'ground') {
  return key === 'none' ? 1 : scope === 'subject' ? coverage : scope === 'outside' ? 1 - coverage : 1;
}

/** Bilinear read of a guide channel at normalized coordinates. */
export function guideAt(guide: HoverGuide, channel: 'subject' | 'depth', x: number, y: number) {
  const values = guide[channel], w = guide.width, h = guide.height;
  const gx = Math.max(0, Math.min(w - 1.001, x * (w - 1))), gy = Math.max(0, Math.min(h - 1.001, y * (h - 1)));
  const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy, a = iy * w + ix, b = Math.min(h - 1, iy + 1) * w + ix;
  const right = ix + 1 < w ? 1 : 0;
  return (values[a] * (1 - fx) + values[a + right] * fx) * (1 - fy) + (values[b] * (1 - fx) + values[b + right] * fx) * fy;
}
