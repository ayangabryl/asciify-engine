/**
 * big-text.ts — ASCII text rendering via an embedded 7×7 bitmap font.
 *
 * Each character is defined as 7 rows × 7 pixels stored as compact bit-patterns.
 * No canvas, no font files, no pixel-sampling — output is always crisp and readable.
 *
 * @example
 * ```ts
 * import { asciifyText } from 'asciify-engine';
 * console.log(asciifyText('Hello!'));
 * console.log(asciifyText('v2', { scale: 2, char: '#' }));
 * ```
 */

// ─── Bitmap font ───────────────────────────────────────────────────────────
// Glyph = [row0..row6]. Each row is a 7-bit number:
//   bit 6 (value 64) = leftmost pixel
//   bit 0 (value  1) = rightmost pixel

const FONT: Record<string, number[]> = {
  // ── Uppercase ──
  'A': [ 28,  54,  99, 127,  99,  99,  99],
  'B': [126,  99,  99, 126,  99,  99, 126],
  'C': [ 62,  99,  96,  96,  96,  99,  62],
  'D': [124, 102,  99,  99,  99, 102, 124],
  'E': [127,  96,  96, 124,  96,  96, 127],
  'F': [127,  96,  96, 124,  96,  96,  96],
  'G': [ 62,  99,  96, 111,  99,  99,  62],
  'H': [ 99,  99,  99, 127,  99,  99,  99],
  'I': [127,   8,   8,   8,   8,   8, 127],
  'J': [ 63,   6,   6,   6, 102, 102,  60],
  'K': [ 99, 102, 108, 120, 108, 102,  99],
  'L': [ 96,  96,  96,  96,  96,  96, 127],
  'M': [ 99, 119, 107, 107,  99,  99,  99],
  'N': [ 99, 115, 107, 103,  99,  99,  99],
  'O': [ 62,  99,  99,  99,  99,  99,  62],
  'P': [126,  99,  99, 126,  96,  96,  96],
  'Q': [ 62,  99,  99,  99, 107, 102,  61],
  'R': [126,  99,  99, 126, 108, 102,  99],
  'S': [ 62,  99,  96,  62,   3,  99,  62],
  'T': [127,   8,   8,   8,   8,   8,   8],
  'U': [ 99,  99,  99,  99,  99,  99,  62],
  'V': [ 99,  99,  99,  99,  54,  28,   8],
  'W': [ 99,  99,  99, 107, 107,  54,  20],
  'X': [ 99,  54,  28,   8,  28,  54,  99],
  'Y': [ 99,  99,  54,  28,   8,   8,   8],
  'Z': [127,   3,   6,  12,  24,  48, 127],

  // ── Lowercase ──
  'a': [  0,   0,  60,   3,  62,  99,  61],
  'b': [ 96,  96, 124,  99,  99,  99, 124],
  'c': [  0,   0,  62,  96,  96,  96,  62],
  'd': [  3,   3,  31,  99,  99,  99,  31],
  'e': [  0,   0,  62,  99, 127,  96,  62],
  'f': [ 30,  48,  48, 126,  48,  48,  48],
  'g': [  0,   0,  63,  99,  63,   3,  62],
  'h': [ 96,  96, 124,  99,  99,  99,  99],
  'i': [  8,   0,  24,   8,   8,   8,  28],
  'j': [  4,   0,  12,   4,   4,  36,  24],
  'k': [ 96,  96, 102, 108, 120, 108, 102],
  'l': [ 24,   8,   8,   8,   8,   8,  28],
  'm': [  0,   0,  92, 107, 107,  99,  99],
  'n': [  0,   0,  94,  99,  99,  99,  99],
  'o': [  0,   0,  62,  99,  99,  99,  62],
  'p': [  0,   0, 126,  99, 126,  96,  96],
  'q': [  0,   0,  63,  99,  63,   3,   3],
  'r': [  0,   0,  94,  99,  96,  96,  96],
  's': [  0,   0,  62,  96,  62,   3, 124],
  't': [ 48,  48, 126,  48,  48,  48,  30],
  'u': [  0,   0,  99,  99,  99, 103,  59],
  'v': [  0,   0,  99,  99,  54,  28,   8],
  'w': [  0,   0,  99,  99, 107,  54,  20],
  'x': [  0,   0,  99,  54,  28,  54,  99],
  'y': [  0,   0,  99,  99,  63,   3,  62],
  'z': [  0,   0, 127,   6,  12,  24, 127],

  // ── Digits ──
  '0': [ 62,  99, 103, 107, 115,  99,  62],
  '1': [  8,  24,  56,   8,   8,   8,  62],
  '2': [ 62,  99,   3,   6,  24,  48, 127],
  '3': [ 62,  99,   3,  30,   3,  99,  62],
  '4': [  6,  14,  22,  38, 127,   6,   6],
  '5': [127,  96, 126,   3,   3,  99,  62],
  '6': [ 62,  99,  96, 126,  99,  99,  62],
  '7': [127,   3,   6,  12,  24,  24,  24],
  '8': [ 62,  99,  99,  62,  99,  99,  62],
  '9': [ 62,  99,  99,  63,   3,  99,  62],

  // ── Punctuation & symbols ──
  ' ': [  0,   0,   0,   0,   0,   0,   0],
  '!': [ 24,  24,  24,  24,  24,   0,  24],
  '?': [ 62,  99,   3,  14,   8,   0,   8],
  '.': [  0,   0,   0,   0,   0,  24,  24],
  ',': [  0,   0,   0,   0,   0,  24,  48],
  ';': [  0,  24,  24,   0,  24,  24,  48],
  ':': [  0,  24,  24,   0,  24,  24,   0],
  '-': [  0,   0,   0,  62,   0,   0,   0],
  '_': [  0,   0,   0,   0,   0,   0, 127],
  "'": [ 24,  24,  32,   0,   0,   0,   0],
  '"': [ 54,  54,  36,   0,   0,   0,   0],
  '`': [ 24,   8,   0,   0,   0,   0,   0],
  ')': [ 24,  12,   6,   6,   6,  12,  24],
  '(': [ 12,  24,  48,  48,  48,  24,  12],
  '[': [ 60,  48,  48,  48,  48,  48,  60],
  ']': [ 30,   6,   6,   6,   6,   6,  30],
  '{': [ 14,  24,  24,  48,  24,  24,  14],
  '}': [ 56,  12,  12,   6,  12,  12,  56],
  '/': [  3,   6,  12,  24,  48,  96,   0],
  '\\': [ 96,  48,  24,  12,   6,   3,   0],
  '|': [  8,   8,   8,   8,   8,   8,   8],
  '+': [  0,   8,   8,  62,   8,   8,   0],
  '=': [  0,   0,  62,   0,  62,   0,   0],
  '*': [  0,  42,  28, 127,  28,  42,   0],
  '#': [ 36,  36, 127,  36, 127,  36,  36],
  '@': [ 62,  99, 111, 107, 111,  96,  62],
  '&': [ 24,  36,  24,  60,  74,  68,  58],
  '%': [ 99,  38,   4,   8,  16,  50,  99],
  '$': [  8,  62,  72,  62,   9,  62,   8],
  '^': [  8,  20,  34,   0,   0,   0,   0],
  '~': [  0,   0,  50,  76,   0,   0,   0],
  '<': [  6,  12,  24,  48,  24,  12,   6],
  '>': [ 48,  24,  12,   6,  12,  24,  48],
};

/** Unknown chars fall back to a 7×7 rectangle outline. */
const FALLBACK: number[] = [127,  65,  65,  65,  65,  65, 127];

function glyph(ch: string): number[] {
  return FONT[ch] ?? FONT[ch.toUpperCase()] ?? FALLBACK;
}

// ─── Options ───────────────────────────────────────────────────────────────

export interface BigTextOptions {
  /**
   * Character used for ink pixels. Any single grapheme — emoji work too.
   * @default '█'
   */
  char?: string;
  /**
   * Pixel scale factor.
   * `1` = each font pixel → 1 char (output is 7 rows tall).
   * `2` = each pixel → 2×2 chars (14 rows tall), etc.
   * @default 1
   */
  scale?: number;
  /** Foreground colour (canvas output only). @default '#d4ff00' */
  color?: string;
  /** Background colour (canvas output only). @default transparent */
  bgColor?: string;
  /** Physical character cell size in px (canvas output only). @default 10 */
  fontSize?: number;
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Convert a string to multi-line ASCII text art.
 *
 * Uses an embedded 7×7 pixel bitmap font — no font files, no install step,
 * works in every JS environment (browser, Node, Deno, Bun).
 *
 * @example
 * ```ts
 * import { asciifyText } from 'asciify-engine';
 * console.log(asciifyText('Hello!'));
 * console.log(asciifyText('v2.0', { char: '#' }));
 * console.log(asciifyText('WOW',  { scale: 2, char: '▓' }));
 * ```
 */
export function asciifyText(text: string, options: BigTextOptions = {}): string {
  if (!text) return '';

  const { char = '█', scale = 1 } = options;
  const fillChar = [...char][0] ?? '█';
  const sc       = Math.max(1, Math.floor(scale));
  const ROWS     = 7 * sc;
  const GAP      = sc;

  const rows: string[] = Array.from({ length: ROWS }, () => '');

  for (let ci = 0; ci < text.length; ci++) {
    const g = glyph(text[ci]);
    for (let srcRow = 0; srcRow < 7; srcRow++) {
      const bits = g[srcRow];
      let seg = '';
      for (let srcCol = 6; srcCol >= 0; srcCol--) {
        seg += ((bits >> srcCol) & 1 ? fillChar : ' ').repeat(sc);
      }
      for (let rep = 0; rep < sc; rep++) rows[srcRow * sc + rep] += seg;
    }
    if (ci < text.length - 1) {
      for (let r = 0; r < ROWS; r++) rows[r] += ' '.repeat(GAP);
    }
  }

  return rows.join('\n');
}

/**
 * Render ASCII text directly onto an HTMLCanvasElement.
 * The canvas is automatically resized to fit the output.
 *
 * @example
 * ```ts
 * import { renderTextToCanvas } from 'asciify-engine';
 * renderTextToCanvas(canvas, 'Hello!', { color: '#d4ff00', scale: 2 });
 * ```
 */
export function renderTextToCanvas(
  canvas: HTMLCanvasElement,
  text: string,
  options: BigTextOptions = {},
): void {
  const { color = '#d4ff00', bgColor, fontSize = 10 } = options;

  const art = asciifyText(text, options);
  if (!art) return;

  const lines = art.split('\n');
  const cols  = Math.max(...lines.map(l => [...l].length));

  // Monospace: each char is ~0.6× as wide as tall
  canvas.width  = Math.ceil(cols * fontSize * 0.6);
  canvas.height = Math.ceil(lines.length * fontSize);

  const ctx = canvas.getContext('2d')!;

  if (bgColor && bgColor !== 'transparent') {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  ctx.fillStyle    = color;
  ctx.font         = `${fontSize}px monospace`;
  ctx.textBaseline = 'top';

  lines.forEach((line, row) => ctx.fillText(line, 0, row * fontSize));
}
