/** Pre-conversion RGB levels and a monotone five-point tonal curve. */
export interface ToneControls {
  blackPoint?: number;
  whitePoint?: number;
  gamma?: number;
  shadows?: number;
  highlights?: number;
}

/** Null is the identity fast path. Build only when settings change. */
export function createToneLookup(options: ToneControls): Uint8Array | null {
  const black = options.blackPoint ?? 0, white = options.whitePoint ?? 1;
  const gamma = options.gamma ?? 1, shadows = options.shadows ?? 0, highlights = options.highlights ?? 0;
  if (black === 0 && white === 1 && gamma === 1 && shadows === 0 && highlights === 0) return null;
  const points = [0, .25 + shadows * .2, .5, .75 + highlights * .2, 1];
  const slopes = points.slice(1).map((value, i) => (value - points[i]) * 4);
  const tangents = [slopes[0], ...slopes.slice(1).map((value, i) =>
    2 * value * slopes[i] / (value + slopes[i])), slopes[3]];
  const lookup = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const x = Math.pow(Math.max(0, Math.min(1, (i / 255 - black) / (white - black))), 1 / gamma);
    const segment = Math.min(3, Math.floor(x * 4)), t = x * 4 - segment;
    const t2 = t * t, t3 = t2 * t;
    const y = (2 * t3 - 3 * t2 + 1) * points[segment]
      + (t3 - 2 * t2 + t) * tangents[segment] / 4
      + (-2 * t3 + 3 * t2) * points[segment + 1]
      + (t3 - t2) * tangents[segment + 1] / 4;
    lookup[i] = Math.round(Math.max(0, Math.min(1, y)) * 255);
  }
  return lookup;
}

export function applyToneLookup(pixels: Uint8ClampedArray, lookup: Uint8Array): void {
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue;
    pixels[i] = lookup[pixels[i]];
    pixels[i + 1] = lookup[pixels[i + 1]];
    pixels[i + 2] = lookup[pixels[i + 2]];
  }
}
