/* Ported from the asciify site's MIT background templates (src/lib/background-templates), unchanged in output. */
// ─── Color parser ─────────────────────────────────────────────────

/** Parse a hex or rgb CSS colour string into { r, g, b }. Returns null on failure. */
export function parseColor(c: string): { r: number; g: number; b: number } | null {
  const hex = c.match(/^#([0-9a-f]{3,8})$/i)?.[1];
  if (hex) {
    const h = hex.length <= 4
      ? hex.split('').map(x => parseInt(x + x, 16))
      : [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)];
    return { r: h[0], g: h[1], b: h[2] };
  }
  const rgb = c.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3] };
  return null;
}

// ─── Value-noise helpers ──────────────────────────────────────────

export function fade(t: number): number { return t * t * t * (t * (t * 6 - 15) + 10); }
export function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

/** Fast 2-D hash → pseudo-random gradient value between -1 and 1 */
export function hash2(ix: number, iy: number): number {
  let n = ix * 127 + iy * 311;
  n = ((n >> 13) ^ n);
  return ((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 0x7fffffff;
}

/** Single octave value noise */
export function vnoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fade(fx), uy = fade(fy);
  const v00 = hash2(ix,     iy    );
  const v10 = hash2(ix + 1, iy    );
  const v01 = hash2(ix,     iy + 1);
  const v11 = hash2(ix + 1, iy + 1);
  return lerp(lerp(v00, v10, ux), lerp(v01, v11, ux), uy); // -1..1
}

/** 3-octave FBM (fractal Brownian motion) */
export function fbm(x: number, y: number): number {
  return (
    vnoise(x,       y      ) * 0.500 +
    vnoise(x * 2.1, y * 2.1) * 0.250 +
    vnoise(x * 4.3, y * 4.3) * 0.125
  ) / 0.875;
}

// ─── Shared look ──────────────────────────────────────────────────

/** A crisp monospace stack for every template, so glyphs render the same on every site. */
export const MONO = '"Geist Mono", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

/** Rounds a CSS-pixel coordinate to the canvas's whole device pixels, so every glyph lands crisp at any pixel ratio. */
export function pixelSnap(ctx: CanvasRenderingContext2D): (value: number) => number {
  const ratio = (typeof ctx.getTransform === 'function' ? ctx.getTransform().a : 1) || 1;
  return value => Math.round(value * ratio) / ratio;
}

/** Graphite inks for the default look: legible on either ground without turning the page grey. */
export const GRAPHITE_LIGHT = { r: 111, g: 109, b: 103 };
export const GRAPHITE_DARK = { r: 143, g: 141, b: 134 };

/** Tone (0–1) above a threshold, rescaled to 0–1. Below the threshold the cell stays empty, which keeps negative space. */
export function band(value: number, from: number, to: number): number {
  return Math.min(1, Math.max(0, (value - from) / (to - from)));
}

/** One ink model for light and dark grounds: alpha rises with tone from a quiet floor to a restrained peak. */
export function toneAlpha(tone: number, floor = .3, peak = .95): number {
  return floor + (peak - floor) * Math.min(1, Math.max(0, tone));
}

/** Stable ordered Bayer quantization. The threshold is fixed in grid space to avoid flicker. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export function ditherIndex(value: number, levels: number, x: number, y: number, strength = 0): number {
  const offset = (BAYER[((y & 3) << 2) | (x & 3)] + .5) / 16;
  return Math.min(levels - 1, Math.max(0, Math.floor(value * (levels - 1) + offset * Math.min(1, Math.max(0, strength)))));
}
