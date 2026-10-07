import {
  STUDIO_PALETTES,
  type StudioSettings,
  type DitherAlgorithm,
} from "./model";
import { BLUE_NOISE_RANKS, BLUE_NOISE_SIZE } from './blue-noise';
export const noise = (x: number, y: number) => {
  const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return v - Math.floor(v);
};
export function bayer(x: number, y: number, size: number): number {
  let value = 0;
  for (let step = 1; step < size; step *= 2) {
    const a = ((Math.floor(x / step) % 2) + 2) % 2,
      b = ((Math.floor(y / step) % 2) + 2) % 2;
    value =
      value * 4 +
      [
        [0, 2],
        [3, 1],
      ][b][a];
  }
  return (value + 0.5) / (size * size) - 0.5;
}
// Ordered thresholds repeat. Build their tiny lookup tables once, rather than
// evaluating the Bayer recurrence and parsing an algorithm ID for every pixel.
const orderedTables = new Map<number, Float64Array>([2, 4, 8, 16].map(size => [
  size, Float64Array.from({length: size * size}, (_, i) => bayer(i % size, Math.floor(i / size), size)),
]));
const kernels: Partial<Record<DitherAlgorithm, [number, number, number][]>> = {
  "floyd-steinberg": [
    [1, 0, 7 / 16],
    [-1, 1, 3 / 16],
    [0, 1, 5 / 16],
    [1, 1, 1 / 16],
  ],
  atkinson: [
    [1, 0, 0.125],
    [2, 0, 0.125],
    [-1, 1, 0.125],
    [0, 1, 0.125],
    [1, 1, 0.125],
    [0, 2, 0.125],
  ],
  stucki: [
    [1, 0, 8 / 42],
    [2, 0, 4 / 42],
    [-2, 1, 2 / 42],
    [-1, 1, 4 / 42],
    [0, 1, 8 / 42],
    [1, 1, 4 / 42],
    [2, 1, 2 / 42],
    [-2, 2, 1 / 42],
    [-1, 2, 2 / 42],
    [0, 2, 4 / 42],
    [1, 2, 2 / 42],
    [2, 2, 1 / 42],
  ],
  sierra: [
    [1, 0, 5 / 32],
    [2, 0, 3 / 32],
    [-2, 1, 2 / 32],
    [-1, 1, 4 / 32],
    [0, 1, 5 / 32],
    [1, 1, 4 / 32],
    [2, 1, 2 / 32],
    [-1, 2, 2 / 32],
    [0, 2, 3 / 32],
    [1, 2, 2 / 32],
  ],
  "sierra-lite": [
    [1, 0, 0.5],
    [-1, 1, 0.25],
    [0, 1, 0.25],
  ],
  burkes: [
    [1, 0, 8 / 32],
    [2, 0, 4 / 32],
    [-2, 1, 2 / 32],
    [-1, 1, 4 / 32],
    [0, 1, 8 / 32],
    [1, 1, 4 / 32],
    [2, 1, 2 / 32],
  ],
  jarvis: [
    [1, 0, 7 / 48],
    [2, 0, 5 / 48],
    [-2, 1, 3 / 48],
    [-1, 1, 5 / 48],
    [0, 1, 7 / 48],
    [1, 1, 5 / 48],
    [2, 1, 3 / 48],
    [-2, 2, 1 / 48],
    [-1, 2, 3 / 48],
    [0, 2, 5 / 48],
    [1, 2, 3 / 48],
    [2, 2, 1 / 48],
  ],
};
export const rgb = (hex: string) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
/** In-place palette quantization. Diffusion uses a bounded three-row error buffer. */
export function ditherPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options: StudioSettings["dither"],
  time = 0,
) {
  const { algorithm, amount, threshold } = options;
  const blueNoise = algorithm === 'blue-noise';
  const orderedSize = algorithm.startsWith("bayer") ? Number(algorithm.slice(5)) : 0;
  const ordered = orderedTables.get(orderedSize);
  const orderedMask = orderedSize - 1;
  const luminanceMapping = options.colorSpace === "luminance";
  const colors =
    options.palette === "custom"
      ? options.colors
      : (STUDIO_PALETTES[options.palette] ?? STUDIO_PALETTES.mono);
  const palette = colors.map(rgb),
    kernel = kernels[algorithm];
  const errors = kernel ? new Float32Array(width * 3 * 3) : null;
  const shift = options.motion === "drift" ? time * options.speed * 3 : 0;
  const direction = (options.direction ?? 45) * Math.PI / 180;
  const dx = Math.round(Math.cos(direction) * shift);
  const dy = Math.round(Math.sin(direction) * shift);
  const mod = (n: number, m: number) => ((n % m) + m) % m;
  const paletteLuma = palette.map(c => c[0] * .299 + c[1] * .587 + c[2] * .114);
  const phase =
    options.motion === "shimmer"
      ? Math.sin(time * options.speed * 2) * 0.15
      : 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const ex = ((y % 3) * width + x) * 3;
      if (data[i + 3] === 0) {
        if (errors) errors[ex] = errors[ex + 1] = errors[ex + 2] = 0;
        continue;
      }
      let pattern = 0;
      const blueThreshold = blueNoise
        ? (BLUE_NOISE_RANKS[((y - dy) & (BLUE_NOISE_SIZE - 1)) * BLUE_NOISE_SIZE + ((x - dx) & (BLUE_NOISE_SIZE - 1))] + .5) / BLUE_NOISE_RANKS.length
        : 0;
      if (ordered)
        pattern = ordered[((y - dy) & orderedMask) * orderedSize + ((x - dx) & orderedMask)];
      else if (algorithm === "noise") pattern = noise(x - dx, y - dy) - 0.5;
      else if (algorithm === "lines") pattern = mod(y - dy, 4) / 3 - 0.5;
      else if (algorithm === "vertical-lines") pattern = mod(x - dx, 4) / 3 - .5;
      else if (algorithm === "diagonal-lines") pattern = mod(x - dx + y - dy, 4) / 3 - .5;
      else if (algorithm === "radial") pattern = mod(Math.hypot(x - width / 2, y - height / 2) - shift, 6) / 6 - .5;
      else if (algorithm === "halftone")
        pattern = Math.hypot(mod(x - dx, 6) - 2.5, mod(y - dy, 6) - 2.5) / 3.54 - 0.5;
      const offset = (pattern * amount + phase + (0.5 - threshold)) * 128;
      const r = data[i] + offset + (errors?.[ex] ?? 0),
        g = data[i + 1] + offset + (errors?.[ex + 1] ?? 0),
        b = data[i + 2] + offset + (errors?.[ex + 2] ?? 0);
      let cr = 0,
        cg = 0,
        cb = 0;
      if (!palette.length) {
        if (blueNoise) {
          const step = Math.max(0, Math.min(1, .5 + (blueThreshold - .5) * amount));
          cr = Math.floor(r / 51 + 1 - step) * 51;
          cg = Math.floor(g / 51 + 1 - step) * 51;
          cb = Math.floor(b / 51 + 1 - step) * 51;
        } else {
          cr = Math.round(r / 51) * 51;
          cg = Math.round(g / 51) * 51;
          cb = Math.round(b / 51) * 51;
        }
      } else {
        let best = Infinity;
        let second = Infinity, bestIndex = 0, secondIndex = 0;
        const tone = r * .299 + g * .587 + b * .114;
        for (let pi = 0; pi < palette.length; pi++) {
          const c = palette[pi];
          const d = luminanceMapping ? (tone - paletteLuma[pi]) ** 2 :
            (r - c[0]) ** 2 * 0.299 +
            (g - c[1]) ** 2 * 0.587 +
            (b - c[2]) ** 2 * 0.114;
          if (d < best) {
            if (blueNoise) { second = best; secondIndex = bestIndex; bestIndex = pi; }
            best = d;
            [cr, cg, cb] = c;
          } else if (blueNoise && d < second) {
            second = d; secondIndex = pi;
          }
        }
        if (blueNoise && amount > 0 && Number.isFinite(second)) {
          // Mix the two closest palette entries by projection, rather than
          // adding arbitrary RGB noise. This preserves monochrome coverage.
          const target = palette[secondIndex];
          const dr = target[0] - cr, dg = target[1] - cg, db = target[2] - cb;
          const dl = paletteLuma[secondIndex] - paletteLuma[bestIndex];
          const denominator = luminanceMapping ? dl * dl : dr * dr * .299 + dg * dg * .587 + db * db * .114;
          const projection = luminanceMapping ? (tone - paletteLuma[bestIndex]) * dl :
            (r - cr) * dr * .299 + (g - cg) * dg * .587 + (b - cb) * db * .114;
          const mix = denominator ? Math.max(0, Math.min(1, projection / denominator * amount)) : 0;
          if (blueThreshold < mix) [cr, cg, cb] = target;
        }
      }
      data[i] = cr;
      data[i + 1] = cg;
      data[i + 2] = cb;
      if (errors && kernel) {
        errors[ex] = errors[ex + 1] = errors[ex + 2] = 0;
        for (const [dx, dy, weight] of kernel) {
          const nx = x + dx;
          if (nx < 0 || nx >= width || y + dy >= height) continue;
          const j = (((y + dy) % 3) * width + nx) * 3;
          errors[j] += (r - cr) * weight * amount;
          errors[j + 1] += (g - cg) * weight * amount;
          errors[j + 2] += (b - cb) * weight * amount;
        }
      }
    }
}
