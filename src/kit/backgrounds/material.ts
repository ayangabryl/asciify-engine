import { GRAPHITE_DARK, GRAPHITE_LIGHT, MONO, band, ditherIndex, parseColor, pixelSnap, toneAlpha } from './shared';

export interface MaterialBackgroundOptions {
  fontSize?: number;
  /** Ordered Bayer dither amount, 0–1. Default 0. */
  ditherStrength?: number;
  /** Density ramp from light to dark. */
  chars?: string;
  speed?: number;
  color?: string;
  accentColor?: string;
  lightMode?: boolean;
}

/** A material's tone at (u, v), in height units, at time t. Values outside 0–1 are clamped. */
export type MaterialSample = (u: number, v: number, aspect: number, t: number) => number;

/** Quiet, deterministic fields: character density carries the material, not hue. */
export function renderMaterial(
  sample: MaterialSample,
  ctx: CanvasRenderingContext2D, width: number, height: number, time: number,
  options: MaterialBackgroundOptions = {},
): void {
  if (width <= 0 || height <= 0) return;
  const size = Math.max(6, options.fontSize ?? 12);
  const cell = size * .62, line = size * 1.2;
  const ink = parseColor(options.color ?? options.accentColor ?? '')
    ?? (options.lightMode ? GRAPHITE_LIGHT : GRAPHITE_DARK);
  const snap = pixelSnap(ctx);
  const t = time * Math.max(0, options.speed ?? .35);
  const aspect = width / height;
  ctx.clearRect(0, 0, width, height);
  ctx.font = `${size}px ${MONO}`;
  ctx.textBaseline = 'top';
  const ramp = Array.from(options.chars || ' .:-=+*#%@');
  for (let y = 0; y < height; y += line) {
    for (let x = 0; x < width; x += cell) {
      // Uniform scale preserves the material on wide and narrow surfaces.
      const u = x / height, v = y / height;
      // The faintest tones stay empty; the rest climb the whole ramp, so forms read as characters, not specks.
      const tone = band(Math.min(1, Math.max(0, sample(u, v, aspect, t))), .06, .72);
      if (tone <= 0) continue;
      const glyph = ramp[ditherIndex(tone, ramp.length, Math.round(x / cell), Math.round(y / line), options.ditherStrength)];
      if (glyph === ' ') continue;
      ctx.fillStyle = `rgba(${ink.r},${ink.g},${ink.b},${toneAlpha(tone)})`;
      ctx.fillText(glyph, snap(x), snap(y));
    }
  }
}
