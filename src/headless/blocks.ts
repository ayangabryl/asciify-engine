import { levelsOf, type AsciiGrid, type AsciiPixels } from './grid';

/**
 * Sub-cell modes: each character cell holds several pixels as dots or blocks, for the most detail a terminal, a README or a
 * text field can show. `braille` 2 by 4 dots a cell, `half` (▀ ▄ █) 1 by 2, `quad` (▖ ▞ ▙ …) 2 by 2, `sextant` (🬀 … 2 by 3,
 * Unicode's Symbols for Legacy Computing, in recent terminal fonts). With `color`, each cell is split into its lighter and
 * darker pixels, which become its foreground and background colours (`colors` and `backgrounds`), as terminal image viewers
 * draw; without, pixels are lit or not by tone, dithered.
 */
export type BlockMode = 'braille' | 'half' | 'quad' | 'sextant';

export interface BlockGridOptions {
  /** Characters across. Default 80. */
  columns?: number;
  /** Rows; default from the picture's aspect and `cellAspect`. */
  rows?: number;
  /** Height over width of a character where it is shown. Default 2 (a terminal's cells). */
  cellAspect?: number;
  /** Default `'braille'`. */
  mode?: BlockMode;
  /** Two colours a cell from the picture (half, quad and sextant), or the dots' colour (braille). Default false. */
  color?: boolean;
  /** The ground the art sits on: lit pixels are the picture's light on `'dark'`, its dark on `'light'`. Default `'dark'`. */
  background?: 'dark' | 'light';
  /** Without colour: `'diffuse'` (default), `'ordered'` or false (a plain threshold). */
  dither?: 'diffuse' | 'ordered' | false;
  /** `'auto'` stretches the 2nd to 98th percentile of tone to full range (default); `'none'` keeps it. */
  levels?: 'auto' | 'none';
  /** Tone threshold, 0–1, for lit pixels without colour. Default 0.5. */
  threshold?: number;
}

const LAYOUT: Record<BlockMode, [number, number]> = { braille: [2, 4], half: [1, 2], quad: [2, 2], sextant: [2, 3] };
// Braille dot bits by (x, y) in the 2 by 4 cell.
const BRAILLE = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]];
// Quadrants by bits (top-left 1, top-right 2, bottom-left 4, bottom-right 8).
const QUAD = ' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█';
// Sextants by bits (rows top to bottom, left then right: 1, 2, 4, 8, 16, 32). Unicode leaves out the four that already exist
// as space, left half, right half and full block.
const SEXTANT = (() => {
  const out: string[] = [];
  let code = 0x1fb00;
  for (let bits = 0; bits < 64; bits++) {
    if (bits === 0) out.push(' ');
    else if (bits === 63) out.push('█');
    else if (bits === 21) out.push('▌');
    else if (bits === 42) out.push('▐');
    else out.push(String.fromCodePoint(code++));
  }
  return out;
})();
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
const toSrgb = (v: number) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055));

/** The character for a cell's lit pixels (bit i is pixel i, row by row). */
function glyphOf(mode: BlockMode, bits: number) {
  if (mode === 'half') return bits === 0 ? ' ' : bits === 1 ? '▀' : bits === 2 ? '▄' : '█';
  if (mode === 'quad') return QUAD[bits];
  if (mode === 'sextant') return SEXTANT[bits];
  let code = 0;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) if (bits & (1 << (y * 2 + x))) code |= BRAILLE[y][x];
  return String.fromCharCode(0x2800 + code);
}

/** Pixels to a grid of sub-cell characters (see `BlockMode`). Pure and synchronous, like `toAsciiGrid`. */
export function toBlockGrid(pixels: AsciiPixels, options: BlockGridOptions = {}): AsciiGrid {
  const { width, height, data } = pixels, channels = pixels.channels ?? 4;
  if (!(width > 0 && height > 0) || data.length < width * height * channels) throw new Error('toBlockGrid needs width × height × channels pixel values.');
  const mode = options.mode ?? 'braille', [sx, sy] = LAYOUT[mode];
  const columns = Math.max(1, Math.round(options.columns ?? 80));
  const cellAspect = options.cellAspect && options.cellAspect > 0 ? options.cellAspect : 2;
  const rows = Math.max(1, Math.round(options.rows ?? (columns * (height / width)) / cellAspect));
  const light = options.background === 'light', color = !!options.color;
  const pw = columns * sx, ph = rows * sy, n = pw * ph;
  // Each sub-pixel the average light of its box of picture pixels (transparency shows the ground).
  const red = new Float32Array(n), green = new Float32Array(n), blue = new Float32Array(n), count = new Float32Array(n);
  const cover = channels === 4 ? new Float32Array(n) : null;
  const ground = light ? 1 : 0;
  for (let y = 0; y < height; y++) {
    const py = Math.min(ph - 1, Math.floor((y * ph) / height));
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels, p = py * pw + Math.min(pw - 1, Math.floor((x * pw) / width));
      let r: number, g: number, b: number;
      if (channels === 1) r = g = b = LINEAR[data[i] & 255];
      else { r = LINEAR[data[i] & 255]; g = LINEAR[data[i + 1] & 255]; b = LINEAR[data[i + 2] & 255]; }
      if (channels === 4) { const a = (data[i + 3] & 255) / 255; r = r * a + ground * (1 - a); g = g * a + ground * (1 - a); b = b * a + ground * (1 - a); cover![p] += a; }
      red[p] += r; green[p] += g; blue[p] += b; count[p]++;
    }
  }
  // A picture smaller than the grid's sub-pixels leaves some with no pixel in them: they take the pixel under their centre.
  for (let py = 0; py < ph; py++) for (let px = 0; px < pw; px++) {
    const p = py * pw + px;
    if (count[p]) continue;
    const x = Math.min(width - 1, Math.floor(((px + 0.5) * width) / pw)), y = Math.min(height - 1, Math.floor(((py + 0.5) * height) / ph));
    const i = (y * width + x) * channels;
    let r: number, g: number, b: number;
    if (channels === 1) r = g = b = LINEAR[data[i] & 255];
    else { r = LINEAR[data[i] & 255]; g = LINEAR[data[i + 1] & 255]; b = LINEAR[data[i + 2] & 255]; }
    if (channels === 4) { const a = (data[i + 3] & 255) / 255; r = r * a + ground * (1 - a); g = g * a + ground * (1 - a); b = b * a + ground * (1 - a); cover![p] = a; }
    red[p] = r; green[p] = g; blue[p] = b; count[p] = 1;
  }
  const tone = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const k = Math.max(1, count[p]);
    red[p] /= k; green[p] /= k; blue[p] /= k;
    const l = 0.2126 * red[p] + 0.7152 * green[p] + 0.0722 * blue[p];
    tone[p] = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  }
  const lines: string[] = [], fg = color ? new Uint8Array(columns * rows * 3) : null, bg = color && mode !== 'braille' ? new Uint8Array(columns * rows * 3) : null;
  if (color && mode !== 'braille') {
    // Two colours a cell: the pixels above the cell's mean tone light the glyph in their mean colour; the rest are the
    // background, in theirs. A cell the picture does not cover at all is left empty and unpainted.
    let alpha: Uint8Array | null = null;
    for (let r = 0; r < rows; r++) {
      let line = '';
      for (let c = 0; c < columns; c++) {
        if (cover) {
          let covered = 0, seen = 0;
          for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) { const p = (r * sy + y) * pw + c * sx + x; covered += cover[p]; seen += count[p]; }
          const share = seen ? covered / seen : 0;
          if (share < 1 - 1e-6) {
            // Partly covered (an edge of the picture): the covered pixels make the glyph, in their own colour, and the
            // rest of the cell is left unpainted, so the edge is crisp on any ground. Not covered at all: an empty cell.
            alpha ??= new Uint8Array(columns * rows).fill(255);
            const at = (r * columns + c) * 3, cell = r * columns + c;
            let bits = 0, on = 0, sr = 0, sg = 0, sb = 0;
            for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
              const p = (r * sy + y) * pw + c * sx + x, a = count[p] ? cover[p] / count[p] : 0;
              if (a < 0.5) continue;
              bits |= 1 << (y * sx + x); on++;
              // The pixel's own colour, without the ground it was laid over.
              sr += (red[p] - ground * (1 - a)) / a; sg += (green[p] - ground * (1 - a)) / a; sb += (blue[p] - ground * (1 - a)) / a;
            }
            if (!on) {
              alpha[cell] = 0;
              fg![at] = fg![at + 1] = fg![at + 2] = bg![at] = bg![at + 1] = bg![at + 2] = light ? 255 : 0;
              line += ' ';
              continue;
            }
            alpha[cell] = Math.max(1, Math.min(254, Math.round(share * 255)));
            fg![at] = bg![at] = toSrgb(sr / on); fg![at + 1] = bg![at + 1] = toSrgb(sg / on); fg![at + 2] = bg![at + 2] = toSrgb(sb / on);
            line += glyphOf(mode, bits);
            continue;
          }
        }
        let mean = 0;
        for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) mean += tone[(r * sy + y) * pw + c * sx + x];
        mean /= sx * sy;
        let bits = 0, on = 0;
        const sums = [0, 0, 0, 0, 0, 0];
        for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
          const p = (r * sy + y) * pw + c * sx + x, lit = tone[p] > mean;
          if (lit) { bits |= 1 << (y * sx + x); on++; }
          const o = lit ? 0 : 3;
          sums[o] += red[p]; sums[o + 1] += green[p]; sums[o + 2] += blue[p];
        }
        const off = sx * sy - on, at = (r * columns + c) * 3;
        // A flat cell: one colour, drawn as a full block.
        if (!on) { bits = (1 << (sx * sy)) - 1; for (let k = 0; k < 3; k++) { fg![at + k] = toSrgb(sums[3 + k] / off); bg![at + k] = fg![at + k]; } }
        else for (let k = 0; k < 3; k++) { fg![at + k] = toSrgb(sums[k] / on); bg![at + k] = off ? toSrgb(sums[3 + k] / off) : fg![at + k]; }
        line += glyphOf(mode, bits);
      }
      lines.push(line);
    }
    return { columns, rows, lines, colors: fg, backgrounds: bg, alpha, background: light ? 'light' : 'dark', cellAspect };
  }
  // One colour: each pixel lit by tone, after levels, dithered.
  const [lo, hi] = options.levels === 'none' ? [0, 1] : levelsOf(tone);
  const span = 1 / Math.max(hi - lo, 1e-3), want = new Float32Array(n);
  for (let p = 0; p < n; p++) { const t = Math.min(1, Math.max(0, (tone[p] - lo) * span)); want[p] = light ? 1 - t : t; }
  const threshold = options.threshold ?? 0.5, dither = options.dither ?? 'diffuse', lit = new Uint8Array(n);
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    const p = y * pw + x, v = want[p];
    const cut = dither === 'ordered' ? (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 : threshold;
    const on = v > cut ? 1 : 0;
    lit[p] = on;
    if (dither === 'diffuse') {
      const error = v - on;
      if (x + 1 < pw) want[p + 1] += error * 7 / 16;
      if (y + 1 < ph) {
        if (x > 0) want[p + pw - 1] += error * 3 / 16;
        want[p + pw] += error * 5 / 16;
        if (x + 1 < pw) want[p + pw + 1] += error / 16;
      }
    }
  }
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < columns; c++) {
      let bits = 0, on = 0;
      const sums = [0, 0, 0];
      for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
        const p = (r * sy + y) * pw + c * sx + x;
        if (lit[p]) { bits |= 1 << (y * sx + x); on++; sums[0] += red[p]; sums[1] += green[p]; sums[2] += blue[p]; }
      }
      if (fg) {
        // Braille in colour: the dots in the mean colour of the pixels they stand for.
        const at = (r * columns + c) * 3;
        for (let k = 0; k < 3; k++) fg[at + k] = on ? toSrgb(sums[k] / on) : 0;
      }
      line += glyphOf(mode, bits);
    }
    lines.push(line);
  }
  return { columns, rows, lines, colors: fg, backgrounds: null, background: light ? 'light' : 'dark', cellAspect };
}
