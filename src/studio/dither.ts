import {
  STUDIO_PALETTES,
  type StudioSettings,
  type DitherAlgorithm,
} from "./model";
export const noise = (x: number, y: number) => {
  const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return v - Math.floor(v);
};
export function bayer(x: number, y: number, size: number): number {
  let value = 0;
  for (let step = 1; step < size; step *= 2) {
    const a = Math.floor(x / step) % 2,
      b = Math.floor(y / step) % 2;
    value =
      value * 4 +
      [
        [0, 2],
        [3, 1],
      ][b][a];
  }
  return (value + 0.5) / (size * size) - 0.5;
}
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
  const colors =
    options.palette === "custom"
      ? options.colors
      : (STUDIO_PALETTES[options.palette] ?? STUDIO_PALETTES.mono);
  const palette = colors.map(rgb),
    kernel = kernels[algorithm];
  const errors = kernel ? new Float32Array(width * 3 * 3) : null;
  const shift =
    options.motion === "drift" ? Math.floor(time * options.speed * 3) : 0;
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
      if (algorithm.startsWith("bayer"))
        pattern = bayer(
          (x + shift) & 15,
          (y + shift) & 15,
          Number(algorithm.slice(5)),
        );
      else if (algorithm === "noise") pattern = noise(x, y) - 0.5;
      else if (algorithm === "lines") pattern = ((y + shift) % 4) / 3 - 0.5;
      else if (algorithm === "halftone")
        pattern = Math.hypot((x % 6) - 2.5, (y % 6) - 2.5) / 3.54 - 0.5;
      const offset = (pattern * amount + phase + (0.5 - threshold)) * 128;
      const r = data[i] + offset + (errors?.[ex] ?? 0),
        g = data[i + 1] + offset + (errors?.[ex + 1] ?? 0),
        b = data[i + 2] + offset + (errors?.[ex + 2] ?? 0);
      let cr = 0,
        cg = 0,
        cb = 0;
      if (!palette.length) {
        cr = Math.round(r / 51) * 51;
        cg = Math.round(g / 51) * 51;
        cb = Math.round(b / 51) * 51;
      } else {
        let best = Infinity;
        for (const c of palette) {
          const d =
            (r - c[0]) ** 2 * 0.299 +
            (g - c[1]) ** 2 * 0.587 +
            (b - c[2]) ** 2 * 0.114;
          if (d < best) {
            best = d;
            [cr, cg, cb] = c;
          }
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
