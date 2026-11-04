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
const toPerceptual = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

const SUB = GLYPH_COLS * GLYPH_ROWS;
// Matching weights, tuned on photos, line art and type against an SSIM score of the result (see bench/): how much a sub-cell
// counts by how much ink glyphs can put there, the structure below which a cell takes a fill character, the extra cost of ink
// where the picture is dark, the softening between neighbouring sub-cells, the weight of tone against shape, and the cost of
// matching a glyph a third of a cell off centre.
let DIM_WEIGHT = 2, STRUCTURE = 0.05, EXTRA_INK = 1, SOFTEN = 0.5, TONE_WEIGHT = 256, SHIFT_COST = 0.15;
// How much worse a kept character (see `previous`) may be than the best one, in shape cells and in fill cells.
let KEEP_MARGIN = 0.6, KEEP_TONE = 0.04;
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
/** @internal For tuning only. */
const DEFAULTS = { dimWeight: DIM_WEIGHT, structure: STRUCTURE, extraInk: EXTRA_INK, soften: SOFTEN, toneWeight: TONE_WEIGHT, shiftCost: SHIFT_COST, keepMargin: KEEP_MARGIN, keepTone: KEEP_TONE };
/** @internal For the benchmark's parameter search only; called with nothing, restores the defaults. */
export const tuneHeadless = (t: Partial<typeof DEFAULTS> = {}) => {
  const v = { ...DEFAULTS, ...t };
  DIM_WEIGHT = v.dimWeight; STRUCTURE = v.structure; EXTRA_INK = v.extraInk; SOFTEN = v.soften; TONE_WEIGHT = v.toneWeight; SHIFT_COST = v.shiftCost;
  KEEP_MARGIN = v.keepMargin; KEEP_TONE = v.keepTone;
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
 * Converts pixels to a grid of characters. Pure, synchronous and deterministic; a 1920×1080 picture at 160 columns takes about
 * 25 ms on one core.
 * @experimental The characters chosen for a given input may improve in a minor release; see STABILITY.md.
 */
export function toAsciiGrid(pixels: AsciiPixels, options: AsciiGridOptions = {}): AsciiGrid {
  const { width, height, data } = pixels;
  const channels = pixels.channels ?? 4;
  if (!(width > 0 && height > 0) || data.length < width * height * channels) throw new Error('toAsciiGrid needs width × height × channels pixel values.');
  const cellAspect = finite(options.cellAspect, GLYPH_CELL_ASPECT, 0.25, 8);
  const columns = Math.round(finite(options.columns, 80, 1, 2000));
  const rows = Math.round(finite(options.rows, Math.max(1, Math.round(columns * (height / width) / cellAspect)), 1, 2000));
  const light = options.background === 'light';
  const mode = options.mode === 'tone' ? 'tone' : 'shape';
  const contrast = finite(options.contrast, 1, 0, 3), brightness = finite(options.brightness, 0, -1, 1), gamma = finite(options.gamma, 1, 0.1, 5);
  const dither = options.dither ?? 'diffuse', diffuse = dither === true || dither === 'diffuse', ordered = dither === 'ordered';
  const wantColor = !!options.color;

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
  const tones = new Float32Array(columns * rows * SUB), cellRgb = wantColor ? new Float32Array(columns * rows * 3) : null;
  const rgb = new Float32Array(3);
  if (sw >= 1 && sh >= 1) {
    const counts = new Float32Array(tones.length), cellCounts = cellRgb ? new Float32Array(columns * rows) : null;
    const subX = new Int32Array(width), subY = new Int32Array(height);
    for (let x = 0; x < width; x++) subX[x] = Math.min(columns * GLYPH_COLS - 1, Math.floor(x / sw));
    for (let y = 0; y < height; y++) subY[y] = Math.min(rows * GLYPH_ROWS - 1, Math.floor(y / sh));
    // Where each pixel column lands: its sub-cell's offset within the row of cells.
    const colAt = new Int32Array(width), colCell = new Int32Array(width);
    for (let x = 0; x < width; x++) { const sx = subX[x], c = (sx / GLYPH_COLS) | 0; colAt[x] = c * SUB + (sx - c * GLYPH_COLS); colCell[x] = c; }
    // Sub-cells four or more pixels across are averaged from every second pixel each way: a quarter of the reads, the same picture.
    const step = Math.max(1, Math.floor(Math.min(sw, sh) / 2)), offset = step >> 1;
    for (let y = offset; y < height; y += step) {
      const sy = subY[y], r = (sy / GLYPH_ROWS) | 0, rowBase = r * columns * SUB + (sy - r * GLYPH_ROWS) * GLYPH_COLS;
      let i = (y * width + offset) * channels;
      for (let x = offset; x < width; x += step, i += channels * step) {
        let red: number, green: number, blue: number;
        if (channels === 1) red = green = blue = TO_LINEAR[data[i] & 255];
        else { red = TO_LINEAR[data[i] & 255]; green = TO_LINEAR[data[i + 1] & 255]; blue = TO_LINEAR[data[i + 2] & 255]; }
        if (channels === 4) {
          const alpha = data[i + 3] & 255;
          if (alpha !== 255) { const a = alpha / 255, g0 = ground * (1 - a); red = red * a + g0; green = green * a + g0; blue = blue * a + g0; }
        }
        const at = rowBase + colAt[x];
        tones[at] += 0.2126 * red + 0.7152 * green + 0.0722 * blue;
        counts[at]++;
        if (cellRgb) { const cell = (r * columns + colCell[x]) * 3; cellRgb[cell] += red; cellRgb[cell + 1] += green; cellRgb[cell + 2] += blue; cellCounts![cell / 3]++; }
      }
    }
    for (let i = 0; i < tones.length; i++) tones[i] = toPerceptual(clamp01(counts[i] ? tones[i] / counts[i] : 0));
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
  let lo = 0, hi = 1;
  if (options.levels !== 'none') {
    const hist = new Uint32Array(256);
    for (let i = 0; i < tones.length; i++) hist[Math.round(tones[i] * 255)]++;
    let acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= tones.length * 0.01) { lo = v / 255; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= tones.length * 0.01) { hi = v / 255; break; } }
    if (hi - lo < 0.05) { lo = 0; hi = 1; }
  }
  // What each sub-cell asks for, 0–1: light on dark wants ink where the picture is bright, dark on light where it is dark.
  const { mean, shape, weight } = glyphTable();
  const pool = (options.charset ?? GLYPH_CHARS).split('');
  const known = pool.filter(char => GLYPH_CHARS.includes(char));
  const glyphs = [...new Set(mode === 'shape' ? (known.length >= 2 ? known : GLYPH_CHARS.split('')) : pool)];
  const indices = glyphs.map(char => GLYPH_CHARS.indexOf(char));
  const allKnown = indices.every(i => i >= 0);
  const sharpness = finite(options.sharpness, 1.6, 1, 4);
  const target = new Float32Array(tones.length);
  for (let i = 0; i < tones.length; i++) {
    let t = clamp01((tones[i] - lo) / Math.max(hi - lo, 1e-3));
    t = clamp01((t - 0.5) * contrast + 0.5 + brightness);
    if (gamma !== 1) t = t ** (1 / gamma);
    // Matched as seen: a share of the densest fill character's light, on the perceptual scale. (Matching in linear light
    // scored worse and looked too sparse: small glyphs on a screen are read, not averaged.)
    target[i] = light ? 1 - t : t;
  }

  const shapeMode = mode === 'shape' && allKnown;
  // Flat cells, with no structure inside, take a fill character by tone; only cells with an edge or a stroke are matched by
  // shape. The fill ramp is the classic one, kept to the characters the charset allows.
  const fill = shapeMode ? glyphs.map((_, g) => g).filter(g => FILL.includes(glyphs[g])) : glyphs.map((_, g) => g);
  if (fill.length < 2) fill.splice(0, fill.length, ...glyphs.map((_, g) => g));
  // Every glyph's tone on the target's 0–1 scale: its ink as a share of the densest fill character's. A ramp with characters
  // the table does not know keeps the given order, evenly spaced.
  const fillTop = Math.max(...fill.map(g => (allKnown ? mean[indices[g]] : 0)), 1e-6);
  const toneOf = indices.map((index, g) => (allKnown ? mean[index] / fillTop : g / Math.max(1, glyphs.length - 1)));
  const out: string[] = [];
  const colors = wantColor ? new Uint8Array(columns * rows * 3) : null;
  const cellTarget = new Float32Array(SUB), softTarget = new Float32Array(SUB);
  // Glyphs in order of tone, so each cell scans outward from the tone it wants and stops on a side once the tone term alone
  // costs more than the best match so far: the same answer as trying every glyph, in a fraction of the work.
  const byTone = indices.map((_, g) => g).sort((a, b) => toneOf[a] - toneOf[b]);
  const toneSorted = byTone.map(g => toneOf[g]);
  const glyphIndex = new Map(glyphs.map((char, g) => [char, g]));
  const previous = options.previous && options.previous.columns === columns && options.previous.rows === rows ? options.previous.lines : null;
  const shapeScore = (g: number, limit: number) => {
    // Each glyph is tried centred and a third of a cell to either side (at a small cost), so a stroke off centre still matches
    // the glyph drawn with that stroke centred. Ink where the picture is dark costs more than ink missing where it is bright:
    // stray bars read as noise.
    const at = indices[g] * SUB;
    let score = Infinity;
    for (let shift = -1; shift <= 1; shift++) {
      if (shift && !SHIFT_COST) continue;
      let sum = shift ? SHIFT_COST : 0;
      for (let y = 0; y < GLYPH_ROWS && sum < limit; y++) for (let x = 0; x < GLYPH_COLS; x++) {
        const from = x - shift, k = y * GLYPH_COLS + x;
        const ink = from < 0 || from >= GLYPH_COLS ? 0 : shape[at + y * GLYPH_COLS + from];
        const d = ink - softTarget[k];
        sum += (d > 0 ? d * d * EXTRA_INK : d * d) * weight[k];
      }
      if (sum < score) score = sum;
    }
    return score;
  };
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < columns; c++) {
      const base = (r * columns + c) * SUB;
      let want = 0, most = 0;
      for (let k = 0; k < SUB; k++) { const v = clamp01(target[base + k]); cellTarget[k] = v; want += v; if (v > most) most = v; }
      want /= SUB;
      let best = 0, spread2 = 0, bestScore = Infinity;
      for (let k = 0; k < SUB; k++) { const d = cellTarget[k] - want; spread2 += d * d; }
      const structured = shapeMode && Math.sqrt(spread2 / SUB) > STRUCTURE * (want + 0.08);
      const keep = previous ? glyphIndex.get(previous[r][c]) : undefined;
      if (structured) {
        // Sharpen the cell's own contrast so a soft edge still reads as a stroke on one side, then take the nearest glyph.
        if (sharpness > 1 && most > 0) for (let k = 0; k < SUB; k++) cellTarget[k] = most * (cellTarget[k] / most) ** sharpness;
        soften(cellTarget, 0, softTarget, SOFTEN);
        let peak = 0;
        for (let k = 0; k < SUB; k++) peak = Math.max(peak, softTarget[k]);
        for (let k = 0; k < SUB; k++) softTarget[k] /= Math.max(peak, 1e-6);
        let hi = 0;
        while (hi < toneSorted.length && toneSorted[hi] < want) hi++;
        let lo = hi - 1, loOpen = lo >= 0, hiOpen = hi < byTone.length;
        while (loOpen || hiOpen) {
          // Take whichever side is nearer in tone next.
          const useLo = loOpen && (!hiOpen || want - toneSorted[lo] <= toneSorted[hi] - want);
          const g = byTone[useLo ? lo : hi];
          const miss = toneOf[g] - want, toneCost = TONE_WEIGHT * miss * miss;
          if (toneCost >= bestScore) { if (useLo) loOpen = false; else hiOpen = false; continue; }
          const score = toneCost + shapeScore(g, bestScore - toneCost);
          if (score < bestScore) { bestScore = score; best = g; }
          if (useLo) loOpen = --lo >= 0; else hiOpen = ++hi < byTone.length;
        }
        // With the previous frame given, a cell keeps its character while that is still nearly as good: still footage stays
        // still instead of trading between near-equal glyphs.
        if (keep !== undefined && keep !== best) {
          const miss = toneOf[keep] - want, kept = TONE_WEIGHT * miss * miss + shapeScore(keep, Infinity);
          if (kept <= bestScore + KEEP_MARGIN) best = keep;
        }
      } else if (ordered) {
        // Ordered dithering: between the fill characters just below and just above the tone, the cell's place in a 4×4
        // pattern decides, in proportion to how close the tone is to each. Smooth gradients without the frame-to-frame churn
        // of error diffusion, and exact black or white stay exact.
        let below = -1, above = -1;
        for (const g of fill) {
          if (toneOf[g] <= want && (below < 0 || toneOf[g] > toneOf[below])) below = g;
          if (toneOf[g] >= want && (above < 0 || toneOf[g] < toneOf[above])) above = g;
        }
        if (below < 0) best = above; else if (above < 0 || above === below) best = below;
        else best = (want - toneOf[below]) / (toneOf[above] - toneOf[below]) > (BAYER[(r & 3) * 4 + (c & 3)] + 0.5) / 16 ? above : below;
        if (keep !== undefined && keep !== best && (keep === below || keep === above)) best = keep;
      } else {
        let bestDelta = Infinity;
        for (const g of fill) { const d = Math.abs(toneOf[g] - want); if (d < bestDelta) { bestDelta = d; best = g; } }
        if (keep !== undefined && keep !== best && fill.includes(keep) && Math.abs(toneOf[keep] - want) <= bestDelta + KEEP_TONE) best = keep;
      }
      line += glyphs[best];
      if (diffuse) {
        // The tone this cell could not show goes to the cells still to come, spread evenly over their sub-cells.
        const error = want - toneOf[best];
        const spread = (dc: number, dr: number, w: number) => {
          const cc = c + dc, rr = r + dr;
          if (cc < 0 || cc >= columns || rr >= rows) return;
          const at = (rr * columns + cc) * SUB;
          for (let k = 0; k < SUB; k++) target[at + k] += error * w;
        };
        spread(1, 0, 7 / 16); spread(-1, 1, 3 / 16); spread(0, 1, 5 / 16); spread(1, 1, 1 / 16);
      }
      if (colors && cellRgb) {
        const at = (r * columns + c) * 3;
        for (let k = 0; k < 3; k++) colors[at + k] = Math.round(toPerceptual(clamp01(cellRgb[at + k])) * 255);
      }
    }
    out.push(line);
  }
  return { columns, rows, lines: out, colors, background: light ? 'light' : 'dark' };
}
