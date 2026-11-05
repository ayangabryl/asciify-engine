import { GLYPH_CELL_ASPECT, GLYPH_CHARS, GLYPH_COLS, GLYPH_COVERAGE, GLYPH_INK, GLYPH_ROWS } from './glyph-table';

/* Pixels in, characters out, with no DOM: runs in Node, Deno, Bun, workers and edge runtimes as well as the browser. */

/** Raw pixels, row by row: RGBA (an ImageData, a canvas readback, sharp's `.ensureAlpha().raw()`), RGB or grey. */
export interface AsciiPixels {
  data: ArrayLike<number>;
  width: number;
  height: number;
  /** Values per pixel: 4 (RGBA, default), 3 (RGB) or 1 (grey). */
  channels?: 1 | 3 | 4;
}

export interface AsciiGridOptions {
  /** Characters across. Default 80. */
  columns?: number;
  /** Characters down. Default: from the picture's aspect and `cellAspect`. */
  rows?: number;
  /** Height over width of one character cell where the text is shown. Default 1.93, a typical monospace font at line-height 1. */
  cellAspect?: number;
  /**
   * 'shape' (default) picks, for each cell, the character whose strokes best match the picture inside it, so edges read as
   * `/`, `|`, `_` and curves as `(` or `)`. 'tone' picks by brightness alone along `charset`, the classic ramp.
   */
  mode?: 'shape' | 'tone';
  /**
   * The characters to use. In 'shape' mode, any subset of printable ASCII (default: all of it). In 'tone' mode, a ramp from
   * empty to dense such as ' .:-=+*#%@'; printable ASCII characters are re-ordered by their measured ink, others kept in order.
   */
  charset?: string;
  /** What the text will sit on: 'dark' (light characters, the default) or 'light' (dark characters). */
  background?: 'dark' | 'light';
  /** Stretch the picture's levels to its 1st and 99th percentiles first. Default 'auto'. */
  levels?: 'auto' | 'none';
  /** Contrast around mid grey, 0–3. Default 1. */
  contrast?: number;
  /** Added to the tone, -1–1. Default 0. */
  brightness?: number;
  /** Tone curve; above 1 opens the shadows. Default 1. */
  gamma?: number;
  /**
   * Smoother gradients than the characters alone can give. 'diffuse' (default, or `true`) spreads each cell's leftover tone
   * to its neighbours (Floyd–Steinberg): the most faithful for stills. 'ordered' nudges tone by a fixed 4×4 pattern: a little
   * less faithful, but it does not churn from frame to frame, so use it for video and animation. `false` for none.
   */
  dither?: boolean | 'diffuse' | 'ordered';
  /**
   * The grid this one follows, such as the last frame of a video: a cell keeps its character while that is still nearly as
   * good a match, so still parts of the picture stay still. Ignored if its size differs.
   */
  previous?: AsciiGrid | null;
  /** In 'shape' mode, how hard each cell's own contrast is pushed before matching, 1–4. Higher reads edges more boldly. Default 1.6. */
  sharpness?: number;
  /** Keep each cell's average colour, for ANSI, SVG and HTML output. Default false. */
  color?: boolean;
}

export interface AsciiGrid {
  readonly columns: number;
  readonly rows: number;
  /** One string per row, `columns` characters each. */
  readonly lines: readonly string[];
  /** With `color`, RGB per cell (row by row); otherwise null. */
  readonly colors: Uint8Array | null;
  readonly background: 'dark' | 'light';
}

// sRGB transfer, both ways: pixels are averaged as light (right for shrinking a picture), then shaped and matched as seen.
const TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
// Linear light back to the perceptual scale through a table, interpolated: a power per sub-cell was the largest cost of a
// frame, and the table differs from the exact curve by under 2e-5.
const PERCEPTUAL_STEPS = 4096, PERCEPTUAL = new Float32Array(PERCEPTUAL_STEPS + 2);
for (let i = 0; i <= PERCEPTUAL_STEPS + 1; i++) { const v = Math.min(1, i / PERCEPTUAL_STEPS); PERCEPTUAL[i] = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055; }
const toPerceptual = (v: number) => { const x = v * PERCEPTUAL_STEPS, i = x | 0; return PERCEPTUAL[i] + (PERCEPTUAL[i + 1] - PERCEPTUAL[i]) * (x - i); };
/** x ** power on 0–1 through a table, for the sharpening a cell's parts take; rebuilt only when the power changes. */
let POWER = 0, POWERED = new Float32Array(0);
const poweredTable = (power: number) => {
  if (power !== POWER) { POWER = power; POWERED = new Float32Array(1026); for (let i = 0; i <= 1025; i++) POWERED[i] = Math.min(1, i / 1024) ** power; }
  return POWERED;
};
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

const SUB = GLYPH_COLS * GLYPH_ROWS;
// Matching weights, tuned on photos, line art and type against an SSIM score of the result (see bench/): how much a sub-cell
// counts by how much ink glyphs can put there, the structure below which a cell takes a fill character, the extra cost of ink
// where the picture is dark, the softening between neighbouring sub-cells, the weight of tone against shape, and the cost of
// matching a glyph a third of a cell off centre.
let DIM_WEIGHT = 2, STRUCTURE = 0.15, EXTRA_INK = 1, SOFTEN = 0.5, TONE_WEIGHT = 256, SHIFT_COST = 0.15;
// How much worse a kept character (see `previous`) may be than the best one, in shape cells and in fill cells.
let KEEP_MARGIN = 1.6, KEEP_TONE = 0.1, FILL_ALL: 'all' | 'symbols' | 'classic' = 'symbols', INK_SCALE = 1.45, STROKE_LIFT = 0.5;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/**
 * Spreads each sub-cell a little into its neighbours across and down (weight `amount` shared between the two), so a stroke a
 * third of a cell off centre still matches the glyph with that stroke centred. Applied alike to glyphs and to the picture.
 */
function soften(v: Float32Array, at: number, out: Float32Array, amount: number) {
  if (amount <= 0) { for (let k = 0; k < SUB; k++) out[k] = v[at + k]; return; }
  const side = amount / 4;
  for (let y = 0; y < GLYPH_ROWS; y++) for (let x = 0; x < GLYPH_COLS; x++) {
    const self = v[at + y * GLYPH_COLS + x];
    const l = x > 0 ? v[at + y * GLYPH_COLS + x - 1] : self, r = x < GLYPH_COLS - 1 ? v[at + y * GLYPH_COLS + x + 1] : self;
    const u = y > 0 ? v[at + (y - 1) * GLYPH_COLS + x] : self, d = y < GLYPH_ROWS - 1 ? v[at + (y + 1) * GLYPH_COLS + x] : self;
    out[y * GLYPH_COLS + x] = self * (1 - amount) + (l + r + u + d) * side;
  }
}
const FILL = ' .:-=+*#%@';
const FILL_SYMBOLS = ` .,:;'\`"^-_~=+*<>!?|/\\()[]{}#%@&$`;
/** @internal For tuning only. */
const DEFAULTS = { dimWeight: DIM_WEIGHT, structure: STRUCTURE, extraInk: EXTRA_INK, soften: SOFTEN, toneWeight: TONE_WEIGHT, shiftCost: SHIFT_COST, fillAll: FILL_ALL, inkScale: INK_SCALE, strokeLift: STROKE_LIFT, keepMargin: KEEP_MARGIN, keepTone: KEEP_TONE };
/** @internal For the benchmark's parameter search only; called with nothing, restores the defaults. */
export const tuneHeadless = (t: Partial<typeof DEFAULTS> = {}) => {
  const v = { ...DEFAULTS, ...t };
  DIM_WEIGHT = v.dimWeight; STRUCTURE = v.structure; EXTRA_INK = v.extraInk; SOFTEN = v.soften; TONE_WEIGHT = v.toneWeight; SHIFT_COST = v.shiftCost;
  KEEP_MARGIN = v.keepMargin; KEEP_TONE = v.keepTone; FILL_ALL = v.fillAll; INK_SCALE = v.inkScale; STROKE_LIFT = v.strokeLift;
  table = null;
};
let table: { coverage: Float32Array; mean: Float32Array; shape: Float32Array; weight: Float32Array } | null = null;
function glyphTable() {
  if (table) return table;
  const raw = typeof atob === 'function' ? Uint8Array.from(atob(GLYPH_COVERAGE), c => c.charCodeAt(0))
    : Uint8Array.from((globalThis as unknown as { Buffer: { from(s: string, e: string): Uint8Array } }).Buffer.from(GLYPH_COVERAGE, 'base64'));
  const coverage = new Float32Array(raw.length), mean = new Float32Array(GLYPH_CHARS.length);
  for (let i = 0; i < raw.length; i++) coverage[i] = raw[i] / 255;
  // A glyph's tone is the light it gives off at reading size, measured with anti-aliasing; its strokes come from the outline.
  for (let g = 0; g < GLYPH_CHARS.length; g++) mean[g] = GLYPH_INK[g];
  // Shape vectors: each sub-cell scaled by the most ink any glyph puts there, so a flat patch of the picture asks for an even
  // glyph and a bright stroke asks for the glyph with that stroke, though no glyph inks the whole top or bottom of its cell.
  const shape = new Float32Array(coverage.length);
  // How much any glyph can ink each sub-cell: the bands above capitals and below the baseline hold little but accents and
  // descenders, so a mismatch there counts for less (a line running through the whole cell still reads as `|`).
  let peak = 0;
  for (let i = 0; i < coverage.length; i++) peak = Math.max(peak, coverage[i]);
  const weight = new Float32Array(SUB);
  for (let k = 0; k < SUB; k++) {
    let most = 0;
    for (let g = 0; g < GLYPH_CHARS.length; g++) most = Math.max(most, coverage[g * SUB + k]);
    weight[k] = (most / peak) ** DIM_WEIGHT;
    for (let g = 0; g < GLYPH_CHARS.length; g++) shape[g * SUB + k] = coverage[g * SUB + k] / peak;
  }
  // Each glyph's shape is then scaled to its own peak: a stroke is compared as a stroke, however thin the font draws it, and
  // how much ink a glyph carries is weighed separately by its tone.
  const soft = new Float32Array(shape.length), one = new Float32Array(SUB);
  for (let g = 0; g < GLYPH_CHARS.length; g++) {
    soften(shape, g * SUB, one, SOFTEN);
    let top = 0;
    for (let k = 0; k < SUB; k++) top = Math.max(top, one[k]);
    for (let k = 0; k < SUB; k++) soft[g * SUB + k] = top > 0 ? one[k] / top : 0;
  }
  return (table = { coverage, mean, shape: soft, weight });
}

/**
 * The glyph side of the shape score, laid out for a dot product: for every glyph and each of the three shifts, its weighted
 * ink per part and the sum of its weighted ink squared. With the extra-ink cost at 1 the score is
 * sum(w * (ink - t)^2) = sum(w * ink^2) - 2 * dot(w * ink, t) + sum(w * t^2), so a cell is three short dot products a glyph.
 */
let shifted: { from: object; ink: Float32Array; square: Float32Array } | null = null;
function shiftedTable(t: NonNullable<typeof table>) {
  if (shifted && shifted.from === t) return shifted;
  const count = GLYPH_CHARS.length, ink = new Float32Array(count * 3 * SUB), square = new Float32Array(count * 3);
  for (let g = 0; g < count; g++) for (let s = 0; s < 3; s++) {
    const shift = s - 1, at = (g * 3 + s) * SUB;
    let sq = 0;
    for (let y = 0; y < GLYPH_ROWS; y++) for (let x = 0; x < GLYPH_COLS; x++) {
      const from = x - shift, k = y * GLYPH_COLS + x, v = from < 0 || from >= GLYPH_COLS ? 0 : t.shape[g * SUB + y * GLYPH_COLS + from];
      ink[at + k] = t.weight[k] * v; sq += t.weight[k] * v * v;
    }
    square[g * 3 + s] = sq;
  }
  return (shifted = { from: t, ink, square });
}

/** Printable ASCII without letters and digits: punctuation and symbols only, for a cleaner, more graphic look in 'shape' mode. */
export const ASCII_SYMBOLS = ` .,:;'\`"^-_~=+*<>!?|/\\()[]{}#%@&$`;

/** The measured ink of a printable ASCII character, 0–1 of its cell, or undefined for any other character. */
export function glyphInk(char: string): number | undefined {
  const i = GLYPH_CHARS.indexOf(char);
  return i < 0 || char.length !== 1 ? undefined : glyphTable().mean[i];
}

const finite = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/**
 * Adds every `step`-th pixel's light to the sub-cell (and the cell colour) it falls in. Each pixel row is summed into one small
 * row of sub-cells first and added to the grid once, and how many pixels each sub-cell took is counted by row and column
 * rather than pixel by pixel. Kept apart so the engine keeps it optimised.
 */
function sampleShrink(data: ArrayLike<number>, width: number, height: number, channels: number, ground: number, columns: number, step: number,
  subY: Int32Array, colAt: Int32Array, colCell: Int32Array, tones: Float32Array, counts: Float32Array, cellRgb: Float32Array | null, cellCounts: Float32Array | null) {
  const offset = step >> 1, subColumns = columns * GLYPH_COLS;
  // Sub-cell column of each sampled pixel, and how many sampled pixels each sub-cell column and sub-cell row holds.
  const subX = new Int32Array(width), perCol = new Float64Array(subColumns), perRow = new Float64Array((tones.length / subColumns) | 0);
  for (let x = offset; x < width; x += step) { const c = colCell[x], sx = c * GLYPH_COLS + (colAt[x] - c * SUB); subX[x] = sx; perCol[sx]++; }
  for (let y = offset; y < height; y += step) perRow[subY[y]]++;
  const rowSum = new Float64Array(subColumns), rowRgb = cellRgb ? new Float64Array(columns * 3) : null;
  let rowAt = -1;
  const flush = () => {
    if (rowAt < 0) return;
    const r = (rowAt / GLYPH_ROWS) | 0, rowBase = r * columns * SUB + (rowAt - r * GLYPH_ROWS) * GLYPH_COLS;
    for (let sx = 0; sx < subColumns; sx++) { const c = (sx / GLYPH_COLS) | 0; tones[rowBase + c * SUB + (sx - c * GLYPH_COLS)] += rowSum[sx]; rowSum[sx] = 0; }
    if (rowRgb && cellRgb) for (let i = 0; i < rowRgb.length; i++) { cellRgb[r * columns * 3 + i] += rowRgb[i]; rowRgb[i] = 0; }
  };
  for (let y = offset; y < height; y += step) {
    const sy = subY[y];
    if (sy !== rowAt) { flush(); rowAt = sy; }
    let i = (y * width + offset) * channels;
    for (let x = offset; x < width; x += step, i += channels * step) {
      let red: number, green: number, blue: number;
      if (channels === 1) red = green = blue = TO_LINEAR[data[i] & 255];
      else { red = TO_LINEAR[data[i] & 255]; green = TO_LINEAR[data[i + 1] & 255]; blue = TO_LINEAR[data[i + 2] & 255]; }
      if (channels === 4) {
        const alpha = data[i + 3] & 255;
        if (alpha !== 255) { const a = alpha / 255, g0 = ground * (1 - a); red = red * a + g0; green = green * a + g0; blue = blue * a + g0; }
      }
      rowSum[subX[x]] += 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      if (rowRgb) { const cell = colCell[x] * 3; rowRgb[cell] += red; rowRgb[cell + 1] += green; rowRgb[cell + 2] += blue; }
    }
  }
  flush();
  const subRows = perRow.length;
  for (let sy = 0; sy < subRows; sy++) {
    const r = (sy / GLYPH_ROWS) | 0, rowBase = r * columns * SUB + (sy - r * GLYPH_ROWS) * GLYPH_COLS;
    for (let sx = 0; sx < subColumns; sx++) { const c = (sx / GLYPH_COLS) | 0; counts[rowBase + c * SUB + (sx - c * GLYPH_COLS)] = perRow[sy] * perCol[sx]; }
  }
  if (cellCounts) for (let r = 0; r < cellCounts.length / columns; r++) {
    let rowsIn = 0;
    for (let k = 0; k < GLYPH_ROWS; k++) rowsIn += perRow[r * GLYPH_ROWS + k] ?? 0;
    for (let c = 0; c < columns; c++) { let colsIn = 0; for (let k = 0; k < GLYPH_COLS; k++) colsIn += perCol[c * GLYPH_COLS + k]; cellCounts[r * columns + c] = rowsIn * colsIn; }
  }
}

/** Each sub-cell's average light, back on the perceptual scale. */
function finishTones(tones: Float32Array, counts: Float32Array) {
  for (let i = 0; i < tones.length; i++) { const n = counts[i], v = n ? tones[i] / n : 0; tones[i] = toPerceptual(v < 0 ? 0 : v > 1 ? 1 : v); }
}

/** What each sub-cell asks for, 0 to 1, after levels, contrast, brightness and gamma. */
function fillTargets(tones: Float32Array, target: Float32Array, lo: number, hi: number, contrast: number, brightness: number, gamma: number, light: boolean) {
  const span = 1 / Math.max(hi - lo, 1e-3), invGamma = 1 / gamma;
  for (let i = 0; i < tones.length; i++) {
    let t = (tones[i] - lo) * span;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    t = (t - 0.5) * contrast + 0.5 + brightness;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    if (gamma !== 1) t = t ** invGamma;
    target[i] = light ? 1 - t : t;
  }
}

/**
 * How far glyph `at` (its index times SUB in the shape table) is from the cell's softened target: tried centred and a third of
 * a cell to either side (at a small cost), so a stroke off centre still matches the glyph drawn with it centred. Ink where the
 * picture is dark costs more than ink missing where it is bright: stray bars read as noise. Stops once past `limit`.
 */
function shapeScoreAt(at: number, soft: Float32Array, shape: Float32Array, weight: Float32Array, limit: number) {
  let score = Infinity;
  for (let shift = -1; shift <= 1; shift++) {
    if (shift && !SHIFT_COST) continue;
    let sum = shift ? SHIFT_COST : 0;
    for (let y = 0; y < GLYPH_ROWS && sum < limit; y++) {
      const row = y * GLYPH_COLS, src = at + row;
      for (let x = 0; x < GLYPH_COLS; x++) {
        const from = x - shift, ink = from < 0 || from >= GLYPH_COLS ? 0 : shape[src + from], d = ink - soft[row + x];
        sum += (d > 0 ? d * d * EXTRA_INK : d * d) * weight[row + x];
      }
    }
    if (sum < score) score = sum;
  }
  return score;
}

interface MatchInput {
  columns: number; rows: number; target: Float32Array; glyphs: string[]; indices: Int32Array; shape: Float32Array; weight: Float32Array;
  toneOf: Float64Array; strokeTone: Float64Array; fill: Int32Array; shapeMode: boolean; sharpness: number; sharpen: Float32Array;
  diffuse: boolean; ordered: boolean; previous: readonly string[] | null; cellRgb: Float32Array | null;
  /** Parts a cell holds in `target`: SUB, or 1 when every part of every cell is the same (tone mode at a pixel a cell). */
  stride: number;
}

/** Hands the tone a cell could not show to the cells still to come, spread evenly over their sub-cells (Floyd–Steinberg). */
function spreadError(target: Float32Array, columns: number, rows: number, c: number, r: number, error: number, stride: number) {
  if (c + 1 < columns) { const at = (r * columns + c + 1) * stride, e = error * (7 / 16); for (let k = 0; k < stride; k++) target[at + k] += e; }
  if (r + 1 >= rows) return;
  const next = (r + 1) * columns;
  if (c > 0) { const at = (next + c - 1) * stride, e = error * (3 / 16); for (let k = 0; k < stride; k++) target[at + k] += e; }
  { const at = (next + c) * stride, e = error * (5 / 16); for (let k = 0; k < stride; k++) target[at + k] += e; }
  if (c + 1 < columns) { const at = (next + c + 1) * stride, e = error * (1 / 16); for (let k = 0; k < stride; k++) target[at + k] += e; }
}

/** The shape score from shiftedTable: three dot products, the best of the shifts. */
function fastScoreOf(ink: Float32Array, square: Float32Array, soft: Float32Array, glyph: number, softSquare: number) {
  let score = Infinity;
  for (let s = 0; s < 3; s++) {
    if (s !== 1 && !SHIFT_COST) continue;
    const at = (glyph * 3 + s) * SUB;
    let dot = 0;
    for (let k = 0; k < SUB; k++) dot += ink[at + k] * soft[k];
    const v = square[glyph * 3 + s] - 2 * dot + softSquare + (s !== 1 ? SHIFT_COST : 0);
    if (v < score) score = v;
  }
  return score;
}

/**
 * Picks every cell's character. Flat cells take a fill character by tone (nearest, or ordered between the two around it);
 * cells with structure are matched by shape among the glyphs near their tone. A top-level function with no closures, so the
 * engine keeps its loop variables in registers.
 */
function matchCells(m: MatchInput): { out: string[]; colors: Uint8Array | null } {
  const { columns, rows, target, glyphs, indices, shape, weight, toneOf, strokeTone, fill, shapeMode, sharpness, sharpen, diffuse, ordered, previous, cellRgb, stride } = m;
  const out: string[] = [];
  const colors = cellRgb ? new Uint8Array(columns * rows * 3) : null;
  const cellTarget = new Float32Array(SUB), softTarget = new Float32Array(SUB);
  const inFill = new Uint8Array(glyphs.length);
  for (let i = 0; i < fill.length; i++) inFill[fill[i]] = 1;
  // Glyphs in order of tone, so each cell scans outward from the tone it wants and stops on a side once the tone term alone
  // costs more than the best match so far: the same answer as trying every glyph, in a fraction of the work.
  const byTone = Int32Array.from(Array.from(indices, (_, g) => g).sort((a, b) => strokeTone[a] - strokeTone[b]));
  const toneSorted = Float64Array.from(byTone, g => strokeTone[g]);
  const glyphIndex = new Map(glyphs.map((char, g) => [char, g]));
  const picked = new Int32Array(columns);
  // The branch-free score (see shiftedTable) whenever ink over and ink missing cost the same, as tuned.
  const fastShape = shapeMode && EXTRA_INK === 1, fast = fastShape ? shiftedTable(glyphTable()) : null;
  const fastInk = fast ? fast.ink : new Float32Array(0), fastSquare = fast ? fast.square : new Float32Array(0);
  // The fill characters sorted by tone (ties in fill order), so a flat cell finds its neighbours by binary search: the same
  // characters a scan of the whole fill ramp would pick, in a few steps instead of one per character.
  const fillOrder = new Int32Array(glyphs.length).fill(-1);
  for (let i = 0; i < fill.length; i++) if (fillOrder[fill[i]] < 0) fillOrder[fill[i]] = i;
  const sortedFill = Int32Array.from(Array.from(fill).sort((a, b) => toneOf[a] - toneOf[b] || fillOrder[a] - fillOrder[b]));
  const sortedTone = Float64Array.from(sortedFill, g => toneOf[g]), last = sortedFill.length - 1;
  /** Index in sortedFill of the first character whose tone is at least `want`, or sortedFill.length. */
  const firstAtLeast = (want: number) => { let a = 0, b = sortedFill.length; while (a < b) { const m = (a + b) >> 1; if (sortedTone[m] < want) a = m + 1; else b = m; } return a; };
  /** Index of the first character in the run of equal tones that ends at `i`. */
  const runStart = (i: number) => { while (i > 0 && sortedTone[i - 1] === sortedTone[i]) i--; return i; };
  for (let r = 0; r < rows; r++) {
    const prevLine = previous ? previous[r] : null;
    for (let c = 0; c < columns; c++) {
      const base = (r * columns + c) * stride;
      let want = 0, most = 0;
      for (let k = 0; k < stride; k++) { let v = target[base + k]; v = v < 0 ? 0 : v > 1 ? 1 : v; cellTarget[k] = v; want += v; if (v > most) most = v; }
      want /= stride;
      let best = 0, spread2 = 0, bestScore = Infinity;
      if (shapeMode) for (let k = 0; k < SUB; k++) { const d = cellTarget[k] - want; spread2 += d * d; }
      const structured = shapeMode && Math.sqrt(spread2 / SUB) > STRUCTURE * (want + 0.08);
      const keep = prevLine ? glyphIndex.get(prevLine[c]) : undefined;
      if (structured) {
        // Sharpen the cell's own contrast so a soft edge still reads as a stroke on one side, then take the nearest glyph.
        if (sharpness > 1 && most > 0) for (let k = 0; k < SUB; k++) { const x = (cellTarget[k] / most) * 1024, i = x | 0; cellTarget[k] = most * (sharpen[i] + (sharpen[i + 1] - sharpen[i]) * (x - i)); }
        soften(cellTarget, 0, softTarget, SOFTEN);
        let peak = 1e-6;
        for (let k = 0; k < SUB; k++) if (softTarget[k] > peak) peak = softTarget[k];
        for (let k = 0; k < SUB; k++) softTarget[k] /= peak;
        let softSquare = 0;
        if (fastShape) for (let k = 0; k < SUB; k++) softSquare += weight[k] * softTarget[k] * softTarget[k];
        let hi = 0;
        while (hi < toneSorted.length && toneSorted[hi] < want) hi++;
        let lo = hi - 1, loOpen = lo >= 0, hiOpen = hi < byTone.length;
        while (loOpen || hiOpen) {
          // Take whichever side is nearer in tone next.
          const useLo = loOpen && (!hiOpen || want - toneSorted[lo] <= toneSorted[hi] - want);
          const g = byTone[useLo ? lo : hi];
          const miss = strokeTone[g] - want, toneCost = TONE_WEIGHT * miss * miss;
          if (toneCost >= bestScore) { if (useLo) loOpen = false; else hiOpen = false; continue; }
          const score = toneCost + (fastShape ? fastScoreOf(fastInk, fastSquare, softTarget, indices[g], softSquare) : shapeScoreAt(indices[g] * SUB, softTarget, shape, weight, bestScore - toneCost));
          if (score < bestScore) { bestScore = score; best = g; }
          if (useLo) loOpen = --lo >= 0; else hiOpen = ++hi < byTone.length;
        }
        // With the previous frame given, a cell keeps its character while that is still nearly as good: still footage stays
        // still instead of trading between near-equal glyphs.
        if (keep !== undefined && keep !== best) {
          const miss = strokeTone[keep] - want, kept = TONE_WEIGHT * miss * miss + (fastShape ? fastScoreOf(fastInk, fastSquare, softTarget, indices[keep], softSquare) : shapeScoreAt(indices[keep] * SUB, softTarget, shape, weight, Infinity));
          if (kept <= bestScore + KEEP_MARGIN) best = keep;
        }
      } else if (ordered) {
        // Ordered dithering: between the fill characters just below and just above the tone, the cell's place in a 4×4
        // pattern decides, in proportion to how close the tone is to each. Smooth gradients without the frame-to-frame churn
        // of error diffusion, and exact black or white stay exact.
        // The nearest fill tone at or below the cell's, and at or above it (the first in fill order among equal tones).
        const up = firstAtLeast(want);
        const hi = up <= last ? sortedFill[up] : -1;
        let down = up <= last && sortedTone[up] === want ? up : up - 1;
        if (down >= 0) down = runStart(down);
        const lo = down >= 0 ? sortedFill[down] : -1;
        if (lo < 0) best = hi; else if (hi < 0 || hi === lo) best = lo;
        else best = (want - toneOf[lo]) / (toneOf[hi] - toneOf[lo]) > (BAYER[(r & 3) * 4 + (c & 3)] + 0.5) / 16 ? hi : lo;
        if (keep !== undefined && keep !== best && inFill[keep] && Math.abs(toneOf[keep] - want) <= KEEP_TONE) best = keep;
      } else {
        // The nearest fill tone either side; on a tie, the one that comes first in fill order, as a scan would choose.
        const up = firstAtLeast(want), down = up - 1;
        let bestDelta = Infinity;
        for (let side = 0; side < 2; side++) {
          const i = side === 0 ? (down >= 0 ? runStart(down) : -1) : (up <= last ? up : -1);
          if (i < 0) continue;
          const g = sortedFill[i], d = Math.abs(sortedTone[i] - want);
          if (d < bestDelta || (d === bestDelta && fillOrder[g] < fillOrder[best])) { bestDelta = d; best = g; }
        }
        if (keep !== undefined && keep !== best && inFill[keep] && Math.abs(toneOf[keep] - want) <= bestDelta + KEEP_TONE) best = keep;
      }
      picked[c] = best;
      if (diffuse) spreadError(target, columns, rows, c, r, want - (structured ? strokeTone : toneOf)[best], stride);
      if (colors && cellRgb) {
        const at = (r * columns + c) * 3;
        for (let k = 0; k < 3; k++) { const v = cellRgb[at + k]; colors[at + k] = Math.round(toPerceptual(v < 0 ? 0 : v > 1 ? 1 : v) * 255); }
      }
    }
    let line = '';
    for (let c = 0; c < columns; c++) line += glyphs[picked[c]];
    out.push(line);
  }
  return { out, colors };
}

/** The 2nd and 98th percentile tones (on a 256-step histogram), or the full range for a nearly flat picture. @internal */
export function levelsOf(tones: Float32Array): [number, number] {
  let lo = 0, hi = 1;
  const hist = new Uint32Array(256);
  for (let i = 0; i < tones.length; i++) hist[(tones[i] * 255 + 0.5) | 0]++;
  let acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= tones.length * 0.01) { lo = v / 255; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= tones.length * 0.01) { hi = v / 255; break; } }
  if (hi - lo < 0.05) { lo = 0; hi = 1; }
  return [lo, hi];
}

/** The glyphs a grid may use and their tones, as the CPU and GPU matchers both read them. @internal */
export function prepareMatch(options: AsciiGridOptions, mode: 'shape' | 'tone') {
  const { mean } = glyphTable();
  const pool = (options.charset ?? GLYPH_CHARS).split('');
  const known = pool.filter(char => GLYPH_CHARS.includes(char));
  const glyphs = [...new Set(mode === 'shape' ? (known.length >= 2 ? known : GLYPH_CHARS.split('')) : pool)];
  const indices = glyphs.map(char => GLYPH_CHARS.indexOf(char));
  const allKnown = indices.every(i => i >= 0);
  const sharpness = finite(options.sharpness, 1.6, 1, 4);
  const shapeMode = mode === 'shape' && allKnown;
  // Flat cells, with no structure inside, take a fill character by tone; only cells with an edge or a stroke are matched by
  // shape. The fill ramp is the classic one, kept to the characters the charset allows.
  const fillSet = FILL_ALL === 'all' ? null : FILL_ALL === 'symbols' ? FILL_SYMBOLS : FILL;
  const fill = shapeMode && fillSet ? glyphs.map((_, g) => g).filter(g => fillSet.includes(glyphs[g])) : glyphs.map((_, g) => g);
  if (fill.length < 2) fill.splice(0, fill.length, ...glyphs.map((_, g) => g));
  // Every glyph's tone on the target's 0–1 scale: its ink as a share of the densest fill character's. A ramp with characters
  // the table does not know keeps the given order, evenly spaced. The tone scale is the classic fill ramp's (its densest is
  // @), whichever characters fill flat cells.
  const ramp = shapeMode ? glyphs.map((_, g) => g).filter(g => FILL.includes(glyphs[g])) : fill;
  const fillTop = Math.max(...(ramp.length ? ramp : fill).map(g => (allKnown ? mean[indices[g]] : 0)), 1e-6) * (shapeMode ? INK_SCALE : 1);
  const toneOf = indices.map((index, g) => (allKnown ? mean[index] / fillTop : g / Math.max(1, glyphs.length - 1)));
  // Cells with a stroke in them weigh tone on the unstretched scale (INK_SCALE fills flat areas fuller; on a stroke it would
  // trade the stroke's shape for ink).
  const strokeTone = toneOf.map(t => t * (shapeMode ? INK_SCALE ** STROKE_LIFT : 1));
  return { glyphs, indices: Int32Array.from(indices), toneOf: Float64Array.from(toneOf), strokeTone: Float64Array.from(strokeTone), fill: Int32Array.from(fill), shapeMode, sharpness };
}

/** The matching constants as tuned, for the GPU matcher. @internal */
export const matchConstants = () => ({ structure: STRUCTURE, soften: SOFTEN, toneWeight: TONE_WEIGHT, shiftCost: SHIFT_COST, keepMargin: KEEP_MARGIN, keepTone: KEEP_TONE, extraInk: EXTRA_INK });
/** The glyph tables, for the GPU matcher. @internal */
export const glyphTables = () => { const t = glyphTable(); return { weight: t.weight, shifted: shiftedTable(t) }; };

/** The grid size and tone settings an options object asks for, read the same way by every matcher. @internal */
export function gridParams(options: AsciiGridOptions, width: number, height: number) {
  const cellAspect = finite(options.cellAspect, GLYPH_CELL_ASPECT, 0.25, 8);
  const columns = Math.round(finite(options.columns, 80, 1, 2000));
  const rows = Math.round(finite(options.rows, Math.max(1, Math.round(columns * (height / width) / cellAspect)), 1, 2000));
  const light = options.background === 'light';
  const mode: 'shape' | 'tone' = options.mode === 'tone' ? 'tone' : 'shape';
  const contrast = finite(options.contrast, 1, 0, 3), brightness = finite(options.brightness, 0, -1, 1), gamma = finite(options.gamma, 1, 0.1, 5);
  const dither = options.dither ?? 'diffuse', diffuse = dither === true || dither === 'diffuse', ordered = dither === 'ordered';
  return { columns, rows, light, mode, contrast, brightness, gamma, diffuse, ordered, wantColor: !!options.color };
}

/**
 * Converts pixels to a grid of characters. Pure, synchronous and deterministic; a 1920×1080 picture at 160 columns takes about
 * 25 ms on one core.
 * @experimental The characters chosen for a given input may improve in a minor release; see STABILITY.md.
 */
export function toAsciiGrid(pixels: AsciiPixels, options: AsciiGridOptions = {}): AsciiGrid {
  const { width, height, data } = pixels;
  const channels = pixels.channels ?? 4;
  if (!(width > 0 && height > 0) || data.length < width * height * channels) throw new Error('toAsciiGrid needs width × height × channels pixel values.');
  const { columns, rows, light, mode, contrast, brightness, gamma, diffuse, ordered, wantColor } = gridParams(options, width, height);

  // Each pixel as linear light, transparent pixels showing the ground the text sits on.
  const ground = light ? 1 : 0;
  const pixel = (i: number, out: Float32Array) => {
    let r: number, g: number, b: number;
    if (channels === 1) r = g = b = TO_LINEAR[data[i] & 255];
    else { r = TO_LINEAR[data[i] & 255]; g = TO_LINEAR[data[i + 1] & 255]; b = TO_LINEAR[data[i + 2] & 255]; }
    if (channels === 4) { const a = (data[i + 3] & 255) / 255; r = r * a + ground * (1 - a); g = g * a + ground * (1 - a); b = b * a + ground * (1 - a); }
    out[0] = r; out[1] = g; out[2] = b;
  };
  // Average light per sub-cell (and colour per cell). Shrinking, as is usual, every pixel is added to the sub-cell it falls in,
  // in one pass; enlarging (sub-cells under a pixel) reads boxes from summed-area tables instead.
  const cw = width / columns, ch = height / rows, sw = cw / GLYPH_COLS, sh = ch / GLYPH_ROWS;
  // Tone mode with a pixel a cell (imageToAsciiGrid draws the frame down to that) works a cell at a time: every part of a cell
  // would hold the same value, so levels, targets and dithering come out the same with one value a cell, for a fifteenth of
  // the work.
  const cellLevel = mode === 'tone' && width === columns && height === rows, stride = cellLevel ? 1 : SUB;
  const tones = new Float32Array(columns * rows * stride), cellRgb = wantColor ? new Float32Array(columns * rows * 3) : null;
  const rgb = new Float32Array(3);
  if (width === columns && height === rows) {
    // One pixel a cell (a frame the browser drew down to the grid): each of the cell's parts is that pixel.
    for (let r = 0, i = 0; r < rows; r++) for (let c = 0; c < columns; c++, i += channels) {
      pixel(i, rgb);
      const v = toPerceptual(clamp01(0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2])), base = (r * columns + c) * stride;
      for (let k = 0; k < stride; k++) tones[base + k] = v;
      if (cellRgb) { const at = (r * columns + c) * 3; cellRgb[at] = rgb[0]; cellRgb[at + 1] = rgb[1]; cellRgb[at + 2] = rgb[2]; }
    }
  } else if (sw >= 1 && sh >= 1) {
    const counts = new Float32Array(tones.length), cellCounts = cellRgb ? new Float32Array(columns * rows) : null;
    const subX = new Int32Array(width), subY = new Int32Array(height);
    for (let x = 0; x < width; x++) subX[x] = Math.min(columns * GLYPH_COLS - 1, Math.floor(x / sw));
    for (let y = 0; y < height; y++) subY[y] = Math.min(rows * GLYPH_ROWS - 1, Math.floor(y / sh));
    // Where each pixel column lands: its sub-cell's offset within the row of cells.
    const colAt = new Int32Array(width), colCell = new Int32Array(width);
    for (let x = 0; x < width; x++) { const sx = subX[x], c = (sx / GLYPH_COLS) | 0; colAt[x] = c * SUB + (sx - c * GLYPH_COLS); colCell[x] = c; }
    // Sub-cells four or more pixels across are averaged from every second pixel each way: a quarter of the reads, the same picture.
    const step = Math.max(1, Math.floor(Math.min(sw, sh) / 2));
    sampleShrink(data, width, height, channels, ground, columns, step, subY, colAt, colCell, tones, counts, cellRgb, cellCounts);
    finishTones(tones, counts);
    if (cellRgb) for (let i = 0; i < cellRgb.length; i++) cellRgb[i] /= Math.max(1, cellCounts![(i / 3) | 0]);
  } else {
    const W = width + 1, tables = Array.from({ length: cellRgb ? 4 : 1 }, () => new Float64Array(W * (height + 1)));
    const rows4 = new Float64Array(4);
    for (let y = 0; y < height; y++) {
      rows4.fill(0);
      for (let x = 0; x < width; x++) {
        pixel((y * width + x) * channels, rgb);
        const at = (y + 1) * W + x + 1, values = [0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2], rgb[0], rgb[1], rgb[2]];
        for (let t = 0; t < tables.length; t++) { rows4[t] += values[t]; tables[t][at] = tables[t][at - W] + rows4[t]; }
      }
    }
    const box = (table: Float64Array, x0: number, y0: number, x1: number, y1: number) => {
      let a = Math.floor(x0), b = Math.floor(y0), c = Math.ceil(x1), d = Math.ceil(y1);
      a = Math.max(0, Math.min(width - 1, a)); b = Math.max(0, Math.min(height - 1, b));
      c = Math.max(a + 1, Math.min(width, c)); d = Math.max(b + 1, Math.min(height, d));
      return (table[d * W + c] - table[b * W + c] - table[d * W + a] + table[b * W + a]) / ((c - a) * (d - b));
    };
    for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
      const base = (r * columns + c) * SUB;
      for (let sy = 0; sy < GLYPH_ROWS; sy++) for (let sx = 0; sx < GLYPH_COLS; sx++) {
        const x0 = c * cw + sx * sw, y0 = r * ch + sy * sh;
        tones[base + sy * GLYPH_COLS + sx] = toPerceptual(clamp01(box(tables[0], x0, y0, x0 + sw, y0 + sh)));
      }
      if (cellRgb) for (let k = 0; k < 3; k++) cellRgb[(r * columns + c) * 3 + k] = box(tables[k + 1], c * cw, r * ch, (c + 1) * cw, (r + 1) * ch);
    }
  }
  const [lo, hi] = options.levels === 'none' ? [0, 1] : levelsOf(tones);
  // What each sub-cell asks for, 0–1: light on dark wants ink where the picture is bright, dark on light where it is dark.
  const { shape, weight } = glyphTable();
  const { glyphs, indices, toneOf, strokeTone, fill, shapeMode, sharpness } = prepareMatch(options, mode);
  const target = new Float32Array(tones.length), sharpen = poweredTable(sharpness);
  // Matched as seen: a share of the densest fill character's light, on the perceptual scale. (Matching in linear light scored
  // worse and looked too sparse: small glyphs on a screen are read, not averaged.)
  fillTargets(tones, target, lo, hi, contrast, brightness, gamma, light);
  const { out, colors } = matchCells({
    columns, rows, target, glyphs, indices, shape, weight, toneOf, strokeTone, fill, shapeMode, sharpness, sharpen, diffuse, ordered,
    previous: options.previous && options.previous.columns === columns && options.previous.rows === rows ? options.previous.lines : null,
    cellRgb: wantColor ? cellRgb : null, stride,
  });
  return { columns, rows, lines: out, colors, background: light ? 'light' : 'dark' };
}
