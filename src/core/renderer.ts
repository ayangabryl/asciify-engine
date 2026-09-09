import { resolveMotion, sampleAmbient } from '../surface/ambient-motion';
/**
 * Core frame-to-canvas renderer and source-to-frame converters.
 */

import type { AsciiOptions, AsciiCell, AsciiFrame, SourceCrop } from '../types';
import { DEFAULT_OPTIONS } from '../types';
// GIF decoding is loaded only by the asynchronous GIF conversion APIs.
import {
  createOffscreenCanvas,
  adjustLuminance,
  customTextToChar,
  applyDither,
  getCellColorStr,
  getCellColorRGB,
  parseChromaKeyColor,
  isDarkMode,
} from './utils';
import { computeHoverEffect } from './animation';
import { advanceHover, createHoverState, type HoverState, type RenderHover } from './hover';

// Re-export AsciiFrame for downstream consumers that import from this module
export type { AsciiFrame };
void DEFAULT_OPTIONS; // keep import alive for tree-shaking hint

let sharedSampleCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
let sharedSampleCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

function getSharedSampleContext(width: number, height: number): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  if (!sharedSampleCanvas || !sharedSampleCtx) {
    const created = createOffscreenCanvas(width, height);
    sharedSampleCanvas = created.canvas;
    sharedSampleCtx = created.ctx;
  }

  if (sharedSampleCanvas.width !== width) sharedSampleCanvas.width = width;
  if (sharedSampleCanvas.height !== height) sharedSampleCanvas.height = height;
  return sharedSampleCtx;
}

export interface AsciiTextFrame {
  rows: string[];
  cols: number;
  rowCount: number;
  colors?: Uint8ClampedArray;
}

const charsetCharsCache = new Map<string, string[]>();
const charLutCache = new Map<string, string[]>();
const textFrameRenderStateCache = new WeakMap<CanvasRenderingContext2D, {
  rows: string[];
  cols: number;
  rowCount: number;
  canvasWidth: number;
  canvasHeight: number;
  fillStyle: string;
}>();

function splitGraphemes(value: string): string[] {
  const Segmenter = (Intl as unknown as {
    Segmenter?: new (
      locale?: string,
      options?: { granularity: 'grapheme' },
    ) => { segment(input: string): Iterable<{ segment: string }> };
  }).Segmenter;

  if (Segmenter) {
    return Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(value), ({ segment }) => segment);
  }

  return [...value];
}

function getCharsetChars(charset: string): string[] {
  let chars = charsetCharsCache.get(charset);
  if (!chars) {
    chars = splitGraphemes(charset);
    charsetCharsCache.set(charset, chars);
  }
  return chars;
}

function getRowChars(row: string): string[] {
  return splitGraphemes(row);
}

function luminanceToCharFast(lum: number, chars: string[], invert: boolean): string {
  const normalized = invert ? 1 - lum / 255 : lum / 255;
  const index = Math.floor(normalized * (chars.length - 1));
  return chars[Math.max(0, Math.min(chars.length - 1, index))] ?? ' ';
}

function getLuminanceCharLut(charset: string, invert: boolean, brightness: number, contrast: number): string[] {
  const key = `${charset}\u0000${invert ? 1 : 0}\u0000${brightness}\u0000${contrast}`;
  let lut = charLutCache.get(key);
  if (!lut) {
    const chars = getCharsetChars(charset);
    lut = new Array(256);
    for (let i = 0; i < 256; i++) {
      lut[i] = luminanceToCharFast(adjustLuminance(i, brightness, contrast), chars, invert);
    }
    charLutCache.set(key, lut);
  }
  return lut;
}

/** Clear shared renderer caches. Useful for long-lived editors that cycle many fonts/charsets. */
export function clearAsciifyCaches(): void {
  charsetCharsCache.clear();
  charLutCache.clear();
  hoverStates = new WeakMap();
  stillFrames = new WeakMap();
  lastFrames = new WeakMap();
  sharedSampleCanvas = null;
  sharedSampleCtx = null;
}

/** Resolve `invert: 'auto'` to a concrete boolean using the active colour scheme. */
function resolveInvert(invert: boolean | 'auto', el?: Element | null): boolean {
  if (invert !== 'auto') return invert;
  return !isDarkMode(el);
}

/**
 * Parse a CSS color value (hex or rgb()) to a 6-char hex string (no `#`).
 * Returns null if the value isn't a recognized color format.
 */
function cssValueToHex(val: string): string | null {
  const hexMatch = val.match(/^#([0-9a-fA-F]{3,6})$/);
  if (hexMatch) {
    let h = hexMatch[1];
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    if (h.length === 6) return h;
  }
  const rgbMatch = val.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (rgbMatch) {
    return [rgbMatch[1], rgbMatch[2], rgbMatch[3]]
      .map(n => parseInt(n).toString(16).padStart(2, '0'))
      .join('');
  }
  return null;
}

/**
 * Resolve `accentColor: 'auto'` to a concrete hex string (no `#`).
 * Detection order:
 *  1. Probe common CSS custom properties on `:root` set by the user's project
 *     (`--accent-color`, `--color-accent`, `--accent`, `--color-primary`, `--primary`, `--brand-color`)
 *  2. Native CSS `accent-color` computed value
 *  3. OS color-scheme fallback: `#0d0d0d` in light mode, `#faf9f7` in dark mode
 */
function resolveAccentHex(accentColor: string | undefined): string {
  const v = accentColor || 'auto';
  if (v !== 'auto') return cssValueToHex(v) ?? 'ffffff';

  if (typeof document !== 'undefined') {
    const rootStyle = getComputedStyle(document.documentElement);
    for (const prop of ['--accent-color', '--color-accent', '--accent', '--color-primary', '--primary', '--brand-color']) {
      const hex = cssValueToHex(rootStyle.getPropertyValue(prop).trim());
      if (hex) return hex;
    }
    const native = cssValueToHex((getComputedStyle(document.body) as CSSStyleDeclaration & { accentColor?: string }).accentColor ?? '');
    if (native) return native;
  }

  return isDarkMode(typeof document !== 'undefined' ? document.body : null) ? 'faf9f7' : '0d0d0d';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function resolveSourceCrop(
  crop: SourceCrop | null | undefined,
  srcWidth: number,
  srcHeight: number,
): { x: number; y: number; width: number; height: number } {
  if (!crop) return { x: 0, y: 0, width: srcWidth, height: srcHeight };

  const unit = crop.unit ?? 'percent';
  const preserveAspect = crop.preserveAspect !== false;
  const toPxX = (value: number | undefined) =>
    value === undefined ? undefined : unit === 'percent' ? value * srcWidth : value;
  const toPxY = (value: number | undefined) =>
    value === undefined ? undefined : unit === 'percent' ? value * srcHeight : value;

  const left = clamp(toPxX(crop.left) ?? 0, 0, srcWidth - 1);
  const right = clamp(toPxX(crop.right) ?? 0, 0, srcWidth - left - 1);
  const top = clamp(toPxY(crop.top) ?? 0, 0, srcHeight - 1);
  const bottom = clamp(toPxY(crop.bottom) ?? 0, 0, srcHeight - top - 1);
  const hasInsets =
    crop.left !== undefined || crop.right !== undefined ||
    crop.top !== undefined || crop.bottom !== undefined;

  const insetWidth = Math.max(1, srcWidth - left - right);
  const insetHeight = Math.max(1, srcHeight - top - bottom);
  const requestedWidth = hasInsets ? insetWidth : toPxX(crop.width);
  const requestedHeight = hasInsets ? insetHeight : toPxY(crop.height);

  let width = requestedWidth ?? srcWidth;
  let height = requestedHeight ?? srcHeight;

  // CSS-like insets already describe an exact source view box. Do not
  // auto-crop the opposite axis here; doing so makes top/bottom crops behave
  // like a centered island instead of a wide hero band. Aspect safety is handled
  // by sizing the output from this resolved crop rectangle.
  if (preserveAspect && !hasInsets) {
    const widthScale = width / srcWidth;
    const heightScale = height / srcHeight;
    const scale = Math.min(widthScale, heightScale);
    const singleDimensionScale = requestedWidth === undefined
      ? heightScale
      : requestedHeight === undefined
        ? widthScale
        : scale;
    width = srcWidth * singleDimensionScale;
    height = srcHeight * singleDimensionScale;
  }

  width = clamp(width, 1, hasInsets ? insetWidth : srcWidth);
  height = clamp(height, 1, hasInsets ? insetHeight : srcHeight);

  const anchor = crop.anchor ?? 'center';
  const explicitX = toPxX(crop.x);
  const explicitY = toPxY(crop.y);
  const baseX = hasInsets ? left : 0;
  const baseY = hasInsets ? top : 0;
  const availableW = hasInsets ? insetWidth : srcWidth;
  const availableH = hasInsets ? insetHeight : srcHeight;
  const alignX = anchor.endsWith('left') || anchor === 'left' ? 0
    : anchor.endsWith('right') || anchor === 'right' ? availableW - width
      : (availableW - width) / 2;
  const alignY = anchor.startsWith('top') || anchor === 'top' ? 0
    : anchor.startsWith('bottom') || anchor === 'bottom' ? availableH - height
      : (availableH - height) / 2;

  const x = clamp(explicitX ?? baseX + alignX, 0, Math.max(0, srcWidth - width));
  const y = clamp(explicitY ?? baseY + alignY, 0, Math.max(0, srcHeight - height));

  return { x, y, width, height };
}

/**
 * Convert an image element or canvas to a single ASCII frame.
 */
export function imageToAsciiFrame(
  source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
  options: AsciiOptions,
  targetWidth?: number,
  targetHeight?: number
): { frame: AsciiFrame; cols: number; rows: number } {
  const srcWidth = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const srcHeight = source instanceof HTMLVideoElement ? source.videoHeight : source.height;

  if (srcWidth === 0 || srcHeight === 0) {
    return { frame: [], cols: 0, rows: 0 };
  }

  const charAspect = options.charAspect;
  const cellW = options.fontSize * options.charSpacing;
  const cellH = options.fontSize / charAspect * options.charSpacing;

  const renderW = targetWidth || srcWidth;
  const renderH = targetHeight || srcHeight;
  const cols = Math.floor(renderW / cellW);
  const rows = Math.floor(renderH / cellH);

  if (cols <= 0 || rows <= 0) {
    return { frame: [], cols: 0, rows: 0 };
  }

  // ── Supersampling ──────────────────────────────────────────────────
  // Drawing the source at cols×rows (one pixel per cell) discards most
  // of the source detail (e.g. 1920×1080 → 100×55).  Instead we sample
  // at a higher resolution and average multiple source pixels per cell.
  // The supersample factor is clamped so the intermediate buffer never
  // exceeds ~4 MP (2048×2048) to stay GPU-friendly.
  const sourceCrop = resolveSourceCrop(options.sourceCrop, srcWidth, srcHeight);
  const maxDim = 2048;
  const ssX = Math.max(1, Math.min(Math.floor(maxDim / cols), Math.floor(sourceCrop.width / cols)));
  const ssY = Math.max(1, Math.min(Math.floor(maxDim / rows), Math.floor(sourceCrop.height / rows)));
  const sampleW = cols * ssX;
  const sampleH = rows * ssY;

  const ctx = getSharedSampleContext(sampleW, sampleH);
  // Replace the previous sample, including transparent pixels.
  const previousComposite = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'copy';
  try { ctx.drawImage(source, sourceCrop.x, sourceCrop.y, sourceCrop.width, sourceCrop.height, 0, 0, sampleW, sampleH); }
  finally { ctx.globalCompositeOperation = previousComposite; }
  const imageData = ctx.getImageData(0, 0, sampleW, sampleH);
  const pixels = imageData.data;

  // ── Chroma-key pre-processing ────────────────────────────────────
  // `true`         — heuristic green: g > r*1.4 && g > b*1.4 && g > 80
  // `'blue-screen'` — heuristic blue:  b > r*1.4 && b > g*1.4 && b > 80
  // string / {r,g,b} — Euclidean distance with chromaKeyTolerance
  const ck = options.chromaKey;
  const ckEnabled = ck != null && ck !== false;
  const ckHeuristicGreen = ck === true;
  const ckHeuristicBlue  = ck === 'blue-screen';
  let ckRGB: { r: number; g: number; b: number } | null = null;
  let ckTolSq = 0;
  if (ckEnabled && !ckHeuristicGreen && !ckHeuristicBlue) {
    ckRGB = parseChromaKeyColor(ck as string | { r: number; g: number; b: number });
    ckTolSq = (options.chromaKeyTolerance ?? 60) ** 2;
  }

  // ── Optional normalize pre-scan ──────────────────────────────────
  // Find the actual luminance range *of non-keyed pixels* so we can
  // stretch it to full [0, 255] — maximises perceived detail.
  // Must run AFTER chroma-key setup so keyed pixels are excluded.
  let normMin = 0;
  let normRange = 255;
  if (options.normalize) {
    let lo = 255, hi = 0;
    for (let k = 0; k < pixels.length; k += 4) {
      // Skip chroma-keyed pixels — they're bg and would inflate the range
      if (ckEnabled) {
        const pr = pixels[k], pg = pixels[k + 1], pb = pixels[k + 2];
        let keyed = false;
        if (ckHeuristicGreen) {
          keyed = pg > pr * 1.4 && pg > pb * 1.4 && pg > 80;
        } else if (ckHeuristicBlue) {
          keyed = pb > pr * 1.4 && pb > pg * 1.4 && pb > 80;
        } else if (ckRGB !== null) {
          const dr = pr - ckRGB.r, dg = pg - ckRGB.g, db = pb - ckRGB.b;
          keyed = dr * dr + dg * dg + db * db <= ckTolSq;
        }
        if (keyed) continue;
      }
      const l = 0.299 * pixels[k] + 0.587 * pixels[k + 1] + 0.114 * pixels[k + 2];
      if (l < lo) lo = l;
      if (l > hi) hi = l;
    }
    normMin = lo;
    normRange = hi > lo ? hi - lo : 255;
  }

  const frame: AsciiFrame = [];
  const invertVal = resolveInvert(options.invert);

  // When chroma-key is active, strip spaces from the charset.
  // Keyed pixels are already transparent (a=0, skipped in renderer) so spaces
  // are redundant.  Keeping them wastes charset range and makes the lightest
  // (or darkest, depending on invert) subject pixels invisible.
  const effectiveCharset = ckEnabled
    ? options.charset.replace(/ /g, '') || options.charset
    : options.charset;
  const charsetChars = getCharsetChars(effectiveCharset);
  const charLut = options.customText
    ? null
    : getLuminanceCharLut(effectiveCharset, invertVal, options.brightness, options.contrast);

  const ssCount = ssX * ssY;

  for (let y = 0; y < rows; y++) {
    const row: AsciiCell[] = [];
    for (let x = 0; x < cols; x++) {
      // Average the ssX × ssY pixel block for this cell
      let sumR = 0, sumG = 0, sumB = 0, sumA = 0;
      let keyedCount = 0;

      for (let sy = 0; sy < ssY; sy++) {
        const rowOff = (y * ssY + sy) * sampleW;
        for (let sx = 0; sx < ssX; sx++) {
          const i = (rowOff + x * ssX + sx) * 4;
          const pr = pixels[i], pg = pixels[i + 1], pb = pixels[i + 2], pa = pixels[i + 3];

          // Chroma-key: count keyed sub-pixels
          if (ckEnabled) {
            let keyed = false;
            if (ckHeuristicGreen) {
              keyed = pg > pr * 1.4 && pg > pb * 1.4 && pg > 80;
            } else if (ckHeuristicBlue) {
              keyed = pb > pr * 1.4 && pb > pg * 1.4 && pb > 80;
            } else if (ckRGB !== null) {
              const dr = pr - ckRGB.r, dg = pg - ckRGB.g, db = pb - ckRGB.b;
              keyed = dr * dr + dg * dg + db * db <= ckTolSq;
            }
            if (keyed) { keyedCount++; continue; }
          }

          sumR += pr; sumG += pg; sumB += pb; sumA += pa;
        }
      }

      // If majority of sub-pixels are keyed, treat whole cell as keyed
      if (ckEnabled && keyedCount > ssCount / 2) {
        row.push({ char: ' ', r: 0, g: 0, b: 0, a: 0 });
        continue;
      }

      const nonKeyed = ssCount - keyedCount;
      const r = nonKeyed > 0 ? sumR / nonKeyed : 0;
      const g = nonKeyed > 0 ? sumG / nonKeyed : 0;
      const b = nonKeyed > 0 ? sumB / nonKeyed : 0;
      const a = nonKeyed > 0 ? sumA / nonKeyed : 0;

      const rawLum = 0.299 * r + 0.587 * g + 0.114 * b;
      const lum = options.normalize
        ? ((rawLum - normMin) / normRange) * 255
        : rawLum;
      const adjustedLum = adjustLuminance(lum, options.brightness, options.contrast);
      const ditheredLum = options.ditherStrength > 0
        ? applyDither(adjustedLum, x, y, options.ditherStrength)
        : adjustedLum;
      const char = options.customText
        ? customTextToChar(ditheredLum, options.customText, x, y, cols, invertVal)
        : options.ditherStrength > 0
          ? luminanceToCharFast(ditheredLum, charsetChars, invertVal)
          : charLut![Math.max(0, Math.min(255, lum | 0))]!;

      row.push({ char, r, g, b, a, lum: ditheredLum });
    }
    frame.push(row);
  }

  return { frame, cols, rows };
}

/**
 * Convert a source into pre-shaped text rows for fast monochrome/accent ASCII.
 *
 * This is the high-performance path for dense video scrubbers. It keeps the
 * expensive pixel sampling work, but avoids allocating one object per cell and
 * lets the renderer draw one string per row instead of one `fillText` per cell.
 */
export function imageToAsciiTextFrame(
  source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
  options: AsciiOptions,
  targetWidth?: number,
  targetHeight?: number
): AsciiTextFrame {
  const srcWidth = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const srcHeight = source instanceof HTMLVideoElement ? source.videoHeight : source.height;

  if (srcWidth === 0 || srcHeight === 0) {
    return { rows: [], cols: 0, rowCount: 0 };
  }

  const charAspect = options.charAspect;
  const cellW = options.fontSize * options.charSpacing;
  const cellH = options.fontSize / charAspect * options.charSpacing;

  const renderW = targetWidth || srcWidth;
  const renderH = targetHeight || srcHeight;
  const cols = Math.floor(renderW / cellW);
  const rowCount = Math.floor(renderH / cellH);

  if (cols <= 0 || rowCount <= 0) {
    return { rows: [], cols: 0, rowCount: 0 };
  }

  // Fast text frames intentionally sample at one pixel per ASCII cell.
  // Browser/GPU downscaling does the expensive image filtering in native code,
  // then JS only maps the compact cols x rows buffer to characters.
  const sampleW = cols;
  const sampleH = rowCount;

  const ctx = getSharedSampleContext(sampleW, sampleH);
  const sourceCrop = resolveSourceCrop(options.sourceCrop, srcWidth, srcHeight);
  // Replace the previous sample, including transparent pixels.
  const previousComposite = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'copy';
  try { ctx.drawImage(source, sourceCrop.x, sourceCrop.y, sourceCrop.width, sourceCrop.height, 0, 0, sampleW, sampleH); }
  finally { ctx.globalCompositeOperation = previousComposite; }
  const pixels = ctx.getImageData(0, 0, sampleW, sampleH).data;

  const ck = options.chromaKey;
  const ckEnabled = ck != null && ck !== false;
  const ckHeuristicGreen = ck === true;
  const ckHeuristicBlue  = ck === 'blue-screen';
  let ckRGB: { r: number; g: number; b: number } | null = null;
  let ckTolSq = 0;
  if (ckEnabled && !ckHeuristicGreen && !ckHeuristicBlue) {
    ckRGB = parseChromaKeyColor(ck as string | { r: number; g: number; b: number });
    ckTolSq = (options.chromaKeyTolerance ?? 60) ** 2;
  }

  let normMin = 0;
  let normRange = 255;
  if (options.normalize) {
    let lo = 255, hi = 0;
    for (let k = 0; k < pixels.length; k += 4) {
      if (ckEnabled) {
        const pr = pixels[k], pg = pixels[k + 1], pb = pixels[k + 2];
        let keyed = false;
        if (ckHeuristicGreen) keyed = pg > pr * 1.4 && pg > pb * 1.4 && pg > 80;
        else if (ckHeuristicBlue) keyed = pb > pr * 1.4 && pb > pg * 1.4 && pb > 80;
        else if (ckRGB !== null) {
          const dr = pr - ckRGB.r, dg = pg - ckRGB.g, db = pb - ckRGB.b;
          keyed = dr * dr + dg * dg + db * db <= ckTolSq;
        }
        if (keyed) continue;
      }
      const l = 0.299 * pixels[k] + 0.587 * pixels[k + 1] + 0.114 * pixels[k + 2];
      if (l < lo) lo = l;
      if (l > hi) hi = l;
    }
    normMin = lo;
    normRange = hi > lo ? hi - lo : 255;
  }

  const invertVal = resolveInvert(options.invert);
  const effectiveCharset = ckEnabled
    ? options.charset.replace(/ /g, '') || options.charset
    : options.charset;
  const charsetChars = getCharsetChars(effectiveCharset);
  const charLut = options.customText
    ? null
    : getLuminanceCharLut(effectiveCharset, invertVal, options.brightness, options.contrast);
  const customTextChars = options.customText ? getCharsetChars(options.customText) : null;
  const captureColors = options.colorMode === 'fullcolor';
  const colors = captureColors ? new Uint8ClampedArray(cols * rowCount * 4) : undefined;
  const rows: string[] = [];

  for (let y = 0; y < rowCount; y++) {
    let line = '';
    for (let x = 0; x < cols; x++) {
      const i = (y * sampleW + x) * 4;
      const colorIndex = i;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const a = pixels[i + 3];

      if (ckEnabled) {
        let keyed = false;
        if (ckHeuristicGreen) keyed = g > r * 1.4 && g > b * 1.4 && g > 80;
        else if (ckHeuristicBlue) keyed = b > r * 1.4 && b > g * 1.4 && b > 80;
        else if (ckRGB !== null) {
          const dr = r - ckRGB.r, dg = g - ckRGB.g, db = b - ckRGB.b;
          keyed = dr * dr + dg * dg + db * db <= ckTolSq;
        }
        if (keyed) {
          line += ' ';
          if (colors) {
            colors[colorIndex] = 0;
            colors[colorIndex + 1] = 0;
            colors[colorIndex + 2] = 0;
            colors[colorIndex + 3] = 0;
          }
          continue;
        }
      }

      if (colors) {
        colors[colorIndex] = r;
        colors[colorIndex + 1] = g;
        colors[colorIndex + 2] = b;
        colors[colorIndex + 3] = a;
      }

      const rawLum = 0.299 * r + 0.587 * g + 0.114 * b;
      const lum = options.normalize
        ? ((rawLum - normMin) / normRange) * 255
        : rawLum;
      const adjustedLum = options.ditherStrength > 0 || customTextChars
        ? adjustLuminance(lum, options.brightness, options.contrast)
        : lum;
      const ditheredLum = options.ditherStrength > 0
        ? applyDither(adjustedLum, x, y, options.ditherStrength)
        : adjustedLum;
      if (customTextChars) {
        const normalized = invertVal ? 1 - ditheredLum / 255 : ditheredLum / 255;
        line += normalized < 0.12 ? ' ' : customTextChars[(y * cols + x) % customTextChars.length];
      } else if (options.ditherStrength <= 0) {
        line += charLut![Math.max(0, Math.min(255, lum | 0))]!;
      } else {
        line += luminanceToCharFast(ditheredLum, charsetChars, invertVal);
      }
    }
    rows.push(line);
  }

  return { rows, cols, rowCount, colors };
}

export function renderTextFrameToCanvas(
  ctx: CanvasRenderingContext2D,
  textFrame: AsciiTextFrame,
  options: AsciiOptions,
  canvasWidth: number,
  canvasHeight: number
): void {
  if (textFrame.rows.length === 0) return;

  const canvasEl = ctx.canvas as HTMLCanvasElement | null;
  const hasTransparentCells = Boolean(options.chromaKey) || textFrame.rows.some(row => row.includes(' '));
  if (!hasTransparentCells) {
    textFrameRenderStateCache.delete(ctx);
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.fillStyle = isDarkMode(canvasEl) ? '#0a0a0a' : '#faf9f7';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  }

  const acHex = resolveAccentHex(options.accentColor);
  const acR = parseInt(acHex.substring(0, 2), 16);
  const acG = parseInt(acHex.substring(2, 4), 16);
  const acB = parseInt(acHex.substring(4, 6), 16);
  const cellW = canvasWidth / textFrame.cols;
  const cellH = canvasHeight / textFrame.rowCount;
  const charAspect = 0.55;
  const fontSize = Math.min(cellW / charAspect, cellH) * 0.9;
  const colors = textFrame.colors;

  if (options.colorMode === 'fullcolor' && colors) {
    textFrameRenderStateCache.delete(ctx);
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.font = `${fontSize}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 1;

    let lastFillStyle = '';
    for (let y = 0; y < textFrame.rows.length; y++) {
      const line = textFrame.rows[y];
      const lineChars = getRowChars(line);
      let x = 0;
      while (x < textFrame.cols) {
        while (x < textFrame.cols && lineChars[x] === ' ') x++;
        if (x >= textFrame.cols) break;

        const start = x;
        const colorIndex = (y * textFrame.cols + x) * 4;
        const qr = colors[colorIndex] & 0xf0;
        const qg = colors[colorIndex + 1] & 0xf0;
        const qb = colors[colorIndex + 2] & 0xf0;

        x++;
        while (x < textFrame.cols && lineChars[x] !== ' ') {
          const nextIndex = (y * textFrame.cols + x) * 4;
          if ((colors[nextIndex] & 0xf0) !== qr || (colors[nextIndex + 1] & 0xf0) !== qg || (colors[nextIndex + 2] & 0xf0) !== qb) {
            break;
          }
          x++;
        }

        const fillStyle = `rgb(${qr},${qg},${qb})`;
        if (fillStyle !== lastFillStyle) {
          ctx.fillStyle = fillStyle;
          lastFillStyle = fillStyle;
        }
        ctx.fillText(lineChars.slice(start, x).join(''), start * cellW + cellW * 0.5, y * cellH + cellH * 0.5);
      }
    }
    ctx.globalAlpha = 1;
    return;
  }

  ctx.font = `${fontSize}px "JetBrains Mono", monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const fillStyle =
    options.colorMode === 'matrix' ? 'rgb(0,255,0)' :
    options.colorMode === 'grayscale' ? (isDarkMode(canvasEl) ? 'rgb(230,230,230)' : 'rgb(24,24,24)') :
    `rgb(${acR},${acG},${acB})`;
  ctx.fillStyle = fillStyle;
  ctx.globalAlpha = 1;

  const previous = textFrameRenderStateCache.get(ctx);
  const canReuseRows = hasTransparentCells &&
    previous &&
    previous.cols === textFrame.cols &&
    previous.rowCount === textFrame.rowCount &&
    previous.canvasWidth === canvasWidth &&
    previous.canvasHeight === canvasHeight &&
    previous.fillStyle === fillStyle;

  if (!canReuseRows) {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  }

  for (let y = 0; y < textFrame.rows.length; y++) {
    const line = textFrame.rows[y];
    if (canReuseRows && previous.rows[y] === line) continue;
    if (canReuseRows) {
      ctx.clearRect(0, y * cellH, canvasWidth, cellH + 1);
    }
    if (line.trim().length === 0) continue;
    ctx.fillText(line, cellW * 0.5, y * cellH + cellH * 0.5);
  }
  textFrameRenderStateCache.set(ctx, {
    rows: textFrame.rows.slice(),
    cols: textFrame.cols,
    rowCount: textFrame.rowCount,
    canvasWidth,
    canvasHeight,
    fillStyle,
  });
  ctx.globalAlpha = 1;
}

/**
 * Extract frames from a video element for ASCII animation.
 */
export async function videoToAsciiFrames(
  video: HTMLVideoElement,
  options: AsciiOptions,
  targetWidth: number,
  targetHeight: number,
  targetFps: number = 12,
  maxDuration: number = 10,
  onProgress?: (progress: number) => void,
  startTime: number = 0,
): Promise<{ frames: AsciiFrame[]; cols: number; rows: number; fps: number }> {
  const duration = Math.min(video.duration - startTime, maxDuration);
  const totalFrames = Math.ceil(duration * targetFps);
  const frames: AsciiFrame[] = [];
  let cols = 0;
  let rows = 0;

  for (let i = 0; i < totalFrames; i++) {
    const time = startTime + (i / targetFps);
    if (time > startTime + duration) break;

    video.currentTime = time;
    await new Promise<void>((resolve) => {
      const handler = () => {
        video.removeEventListener('seeked', handler);
        resolve();
      };
      video.addEventListener('seeked', handler);
    });

    const result = imageToAsciiFrame(video, options, targetWidth, targetHeight);
    frames.push(result.frame);
    cols = result.cols;
    rows = result.rows;

    onProgress?.((i + 1) / totalFrames);
  }

  return { frames, cols, rows, fps: targetFps };
}

/**
 * Extract video frames into compact text rows for high-density monochrome/accent
 * animations. This mirrors videoToAsciiFrames but avoids object-per-cell frames.
 */
export async function videoToAsciiTextFrames(
  video: HTMLVideoElement,
  options: AsciiOptions,
  targetWidth: number,
  targetHeight: number,
  targetFps: number = 12,
  maxDuration: number = 10,
  onProgress?: (progress: number) => void,
  startTime: number = 0,
): Promise<{ frames: AsciiTextFrame[]; cols: number; rows: number; fps: number }> {
  const duration = Math.min(video.duration - startTime, maxDuration);
  const totalFrames = Math.ceil(duration * targetFps);
  const frames: AsciiTextFrame[] = [];
  let cols = 0;
  let rows = 0;

  for (let i = 0; i < totalFrames; i++) {
    const time = startTime + (i / targetFps);
    if (time > startTime + duration) break;

    video.currentTime = time;
    await new Promise<void>((resolve) => {
      const handler = () => {
        video.removeEventListener('seeked', handler);
        resolve();
      };
      video.addEventListener('seeked', handler);
    });

    const frame = imageToAsciiTextFrame(video, options, targetWidth, targetHeight);
    frames.push(frame);
    cols = frame.cols;
    rows = frame.rowCount;

    onProgress?.((i + 1) / totalFrames);
  }

  return { frames, cols, rows, fps: targetFps };
}

/**
 * Extract frames from an animated GIF file buffer.
 */
export async function gifToAsciiFrames(
  buffer: ArrayBuffer,
  options: AsciiOptions,
  targetWidth: number,
  targetHeight: number,
  onProgress?: (progress: number) => void
): Promise<{ frames: AsciiFrame[]; cols: number; rows: number; fps: number }> {
  const { parseGIF, decompressFrames } = await import('gifuct-js');
  const gif = parseGIF(buffer);
  const rawFrames = decompressFrames(gif, true);

  if (rawFrames.length === 0) {
    return { frames: [], cols: 0, rows: 0, fps: 10 };
  }

  const gifW = rawFrames[0].dims.width;
  const gifH = rawFrames[0].dims.height;
  const logicalW = gif.lsd?.width || gifW;
  const logicalH = gif.lsd?.height || gifH;

  const compCanvas = document.createElement('canvas');
  compCanvas.width = logicalW;
  compCanvas.height = logicalH;
  const compCtx = compCanvas.getContext('2d')!;

  const prevCanvas = document.createElement('canvas');
  prevCanvas.width = logicalW;
  prevCanvas.height = logicalH;
  const prevCtx = prevCanvas.getContext('2d')!;

  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d')!;

  const frames: AsciiFrame[] = [];
  let cols = 0;
  let rows = 0;

  let totalDelay = 0;
  for (const f of rawFrames) { totalDelay += (f.delay || 100); }
  const avgDelay = totalDelay / rawFrames.length;
  const fps = Math.round(Math.min(30, Math.max(5, 1000 / avgDelay)));

  const maxFrames = Math.min(rawFrames.length, 300);

  for (let i = 0; i < maxFrames; i++) {
    const f = rawFrames[i];
    const { dims, patch, disposalType } = f;

    if (disposalType === 3) {
      prevCtx.clearRect(0, 0, logicalW, logicalH);
      prevCtx.drawImage(compCanvas, 0, 0);
    }

    if (tempCanvas.width !== dims.width) tempCanvas.width = dims.width;
    if (tempCanvas.height !== dims.height) tempCanvas.height = dims.height;
    const frameImageData = new ImageData(new Uint8ClampedArray(patch.buffer), dims.width, dims.height);
    tempCtx.putImageData(frameImageData, 0, 0);

    compCtx.drawImage(tempCanvas, dims.left || 0, dims.top || 0);

    const result = imageToAsciiFrame(compCanvas, options, targetWidth, targetHeight);
    frames.push(result.frame);
    cols = result.cols;
    rows = result.rows;

    if (disposalType === 2) {
      compCtx.clearRect(dims.left || 0, dims.top || 0, dims.width, dims.height);
    } else if (disposalType === 3) {
      compCtx.clearRect(0, 0, logicalW, logicalH);
      compCtx.drawImage(prevCanvas, 0, 0);
    }

    onProgress?.((i + 1) / maxFrames);
  }

  return { frames, cols, rows, fps };
}

/**
 * Extract animated GIF frames into compact text rows for high-density
 * monochrome/accent playback. Keeps the legacy object-frame extractor intact
 * for full-color and interactive modes.
 */
export async function gifToAsciiTextFrames(
  buffer: ArrayBuffer,
  options: AsciiOptions,
  targetWidth: number,
  targetHeight: number,
  onProgress?: (progress: number) => void
): Promise<{ frames: AsciiTextFrame[]; cols: number; rows: number; fps: number }> {
  const { parseGIF, decompressFrames } = await import('gifuct-js');
  const gif = parseGIF(buffer);
  const rawFrames = decompressFrames(gif, true);

  if (rawFrames.length === 0) {
    return { frames: [], cols: 0, rows: 0, fps: 10 };
  }

  const gifW = rawFrames[0].dims.width;
  const gifH = rawFrames[0].dims.height;
  const logicalW = gif.lsd?.width || gifW;
  const logicalH = gif.lsd?.height || gifH;

  const compCanvas = document.createElement('canvas');
  compCanvas.width = logicalW;
  compCanvas.height = logicalH;
  const compCtx = compCanvas.getContext('2d')!;

  const prevCanvas = document.createElement('canvas');
  prevCanvas.width = logicalW;
  prevCanvas.height = logicalH;
  const prevCtx = prevCanvas.getContext('2d')!;

  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d')!;

  const frames: AsciiTextFrame[] = [];
  let cols = 0;
  let rows = 0;

  let totalDelay = 0;
  for (const f of rawFrames) totalDelay += (f.delay || 100);
  const avgDelay = totalDelay / rawFrames.length;
  const fps = Math.round(Math.min(30, Math.max(5, 1000 / avgDelay)));
  const maxFrames = Math.min(rawFrames.length, 300);

  for (let i = 0; i < maxFrames; i++) {
    const f = rawFrames[i];
    const { dims, patch, disposalType } = f;

    if (disposalType === 3) {
      prevCtx.clearRect(0, 0, logicalW, logicalH);
      prevCtx.drawImage(compCanvas, 0, 0);
    }

    if (tempCanvas.width !== dims.width) tempCanvas.width = dims.width;
    if (tempCanvas.height !== dims.height) tempCanvas.height = dims.height;
    const frameImageData = new ImageData(new Uint8ClampedArray(patch.buffer), dims.width, dims.height);
    tempCtx.putImageData(frameImageData, 0, 0);

    compCtx.drawImage(tempCanvas, dims.left || 0, dims.top || 0);

    const frame = imageToAsciiTextFrame(compCanvas, options, targetWidth, targetHeight);
    frames.push(frame);
    cols = frame.cols;
    rows = frame.rowCount;

    if (disposalType === 2) {
      compCtx.clearRect(dims.left || 0, dims.top || 0, dims.width, dims.height);
    } else if (disposalType === 3) {
      compCtx.clearRect(0, 0, logicalW, logicalH);
      compCtx.drawImage(prevCanvas, 0, 0);
    }

    onProgress?.((i + 1) / maxFrames);
  }

  return { frames, cols, rows, fps };
}

/**
 * Render an ASCII frame to a canvas context.
 * Supports both ASCII text mode and Dots mode.
 */
let hoverStates = new WeakMap<CanvasRenderingContext2D, HoverState>();
let lastFrames = new WeakMap<CanvasRenderingContext2D, { frame: AsciiFrame; since: number }>();
let stillFrames = new WeakMap<CanvasRenderingContext2D, {
  frame: AsciiFrame; key: string; canvas: HTMLCanvasElement;
}>();

/** Frames are immutable: replace a frame after editing cells to invalidate its cached drawing. */
export function renderFrameToCanvas(
  ctx: CanvasRenderingContext2D, frame: AsciiFrame, options: AsciiOptions,
  width: number, height: number, time = 0,
  pointer?: { x: number; y: number; intensity?: number } | null,
): void {
  if (!frame.length || !frame[0].length || width <= 0 || height <= 0) return;
  let hover: RenderHover | null = null;
  if (options.hoverStrength > 0) {
    let state = hoverStates.get(ctx);
    if (!state) { state = createHoverState(); hoverStates.set(ctx, state); }
    hover = advanceHover(state, pointer ?? null, performance.now());
  } else hoverStates.delete(ctx);

  // Moving media and time-based styles use the direct path. A still image
  // keeps one backing bitmap and redraws only cells touched by the cursor.
  if (options.animationStyle !== 'none' || options.charsetFrames?.length || options.hoverStrength <= 0) {
    stillFrames.delete(ctx);
    drawFrameToCanvas(ctx, frame, options, width, height, time, hover);
    return;
  }
  const previous = lastFrames.get(ctx);
  if (previous?.frame !== frame) {
    lastFrames.set(ctx, { frame, since: performance.now() }); stillFrames.delete(ctx);
    drawFrameToCanvas(ctx, frame, options, width, height, time, hover);
    return;
  }
  // Do not allocate a backing bitmap for every decoded video frame.
  if (performance.now() - previous.since < 100) {
    drawFrameToCanvas(ctx, frame, options, width, height, time, hover);
    return;
  }
  const transform = ctx.getTransform();
  // Rotated/sheared contexts retain the general renderer's behavior.
  if (transform.b || transform.c || transform.a <= 0 || transform.d <= 0) {
    drawFrameToCanvas(ctx, frame, options, width, height, time, hover);
    return;
  }
  // Restore the original direct drawing when the wake settles. This also
  // avoids a raster-cache antialiasing change in the final resting image.
  if (!hover || (hover.intensity ?? 0) < 0.003) {
    drawFrameToCanvas(ctx, frame, options, width, height, time, null);
    return;
  }
  const dark = isDarkMode(ctx.canvas);
  const resolvedOptions = { ...options, accentColor: '#' + resolveAccentHex(options.accentColor) };
  const key = JSON.stringify([resolvedOptions, width, height, transform.a, transform.d, dark,
    typeof document.fonts !== 'undefined' ? document.fonts.status : 'loaded']);
  let cached = stillFrames.get(ctx);
  if (!cached || cached.frame !== frame || cached.key !== key) {
    const bitmap = cached?.canvas ?? document.createElement('canvas');
    bitmap.width = Math.ceil(width * transform.a);
    bitmap.height = Math.ceil(height * transform.d);
    const base = bitmap.getContext('2d')!;
    base.setTransform(transform.a, 0, 0, transform.d, 0, 0);
    drawFrameToCanvas(base, frame, resolvedOptions, width, height, 0, null, undefined, dark);
    cached = { frame, key, canvas: bitmap };
    stillFrames.set(ctx, cached);
  }
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(cached.canvas, 0, 0, width, height);
  if (!hover || (hover.intensity ?? 0) < 0.003) return;
  const rows = frame.length, cols = frame[0].length;
  // Padding includes the largest existing displacement, magnification and
  // glyph overhang, so the cached and live portions meet without clipped ink.
  const radius = 0.08 + options.hoverRadius * 0.35 + options.hoverStrength * 0.04;
  const points = options.hoverEffect === 'trail' ? [hover, ...(hover.trail ?? [])] : [hover];
  let left = 1, top = 1, right = 0, bottom = 0;
  for (const point of points) {
    left = Math.min(left, point.x - radius); right = Math.max(right, point.x + radius);
    top = Math.min(top, point.y - radius); bottom = Math.max(bottom, point.y + radius);
  }
  // Glitch words may extend farther than the radial cursor influence.
  if (options.hoverEffect === 'glitchText') {
    const text = options.hoverText;
    const length = Math.max(1, ...(Array.isArray(text) ? text : [text]).map(word => word.length));
    left = Math.min(left, hover.x - length / cols); right = Math.max(right, hover.x + length / cols);
  }
  const padding = Math.ceil(5 + options.hoverStrength * 4);
  const region = { x: Math.max(0, Math.floor(left * cols) - padding), y: Math.max(0, Math.floor(top * rows) - padding),
    right: Math.min(cols, Math.ceil(right * cols) + padding), bottom: Math.min(rows, Math.ceil(bottom * rows) + padding) };
  ctx.save();
  ctx.beginPath();
  ctx.rect(region.x * width / cols, region.y * height / rows,
    (region.right - region.x) * width / cols, (region.bottom - region.y) * height / rows);
  ctx.clip();
  drawFrameToCanvas(ctx, frame, resolvedOptions, width, height, time, hover, region, dark);
  ctx.restore();
}

function drawFrameToCanvas(
  ctx: CanvasRenderingContext2D,
  frame: AsciiFrame,
  options: AsciiOptions,
  canvasWidth: number,
  canvasHeight: number,
  time: number = 0,
  hoverPos?: RenderHover | null,
  region?: { x: number; y: number; right: number; bottom: number },
  darkOverride?: boolean,
) {
  const rows = frame.length;
  if (rows === 0) return;
  const cols = frame[0].length;

  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  let hasTransparency = false;
  const sampleStepY = Math.max(1, rows >> 2);
  const sampleStepX = Math.max(1, cols >> 2);
  outer:
  for (let sampleY = 0; sampleY < rows; sampleY += sampleStepY) {
    const row = frame[sampleY];
    for (let sampleX = 0; sampleX < cols; sampleX += sampleStepX) {
      if (row[sampleX].a < 200) { hasTransparency = true; break outer; }
    }
  }

  const canvasEl = ctx.canvas as HTMLCanvasElement | null;
  const dark = darkOverride ?? isDarkMode(canvasEl);

  if (!hasTransparency) {
    // Fill based on the detected colour scheme (probes ancestor backgrounds,
    // data-theme, .dark class, then OS preference).
    ctx.fillStyle = dark ? '#0a0a0a' : '#faf9f7';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  }

  const cellW = canvasWidth / cols;
  const cellH = canvasHeight / rows;

  const hoverIntensity = hoverPos?.intensity ?? 1;
  const hoverActive = !!(hoverPos && options.hoverStrength > 0 && hoverIntensity > 0.005);

  const hc = '#' + (cssValueToHex(options.hoverColor || '#ffffff') ?? 'ffffff');
  const hcR = parseInt(hc.slice(1, 3), 16);
  const hcG = parseInt(hc.slice(3, 5), 16);
  const hcB = parseInt(hc.slice(5, 7), 16);

  const acHex = resolveAccentHex(options.accentColor);
  const acR = parseInt(acHex.substring(0, 2), 16);
  const acG = parseInt(acHex.substring(2, 4), 16);
  const acB = parseInt(acHex.substring(4, 6), 16);

  const effectiveHoverRadius = options.hoverRadius;

  let hoverMinCol = 0, hoverMaxCol = cols, hoverMinRow = 0, hoverMaxRow = rows;
  let hoverPosX = 0, hoverPosY = 0;
  if (hoverActive && hoverPos) {
    hoverPosX = hoverPos.x;
    hoverPosY = hoverPos.y;
    const hoverNormRadius = (0.08 + effectiveHoverRadius * 0.35) + options.hoverStrength * 0.04;
    hoverMinCol = Math.max(0, Math.floor((hoverPosX - hoverNormRadius) * cols) - 1);
    hoverMaxCol = Math.min(cols, Math.ceil((hoverPosX + hoverNormRadius) * cols) + 1);
    hoverMinRow = Math.max(0, Math.floor((hoverPosY - hoverNormRadius) * rows) - 1);
    hoverMaxRow = Math.min(rows, Math.ceil((hoverPosY + hoverNormRadius) * rows) + 1);
  }

  if (hoverActive && options.hoverEffect === 'trail') {
    for (const point of hoverPos?.trail ?? []) {
      const radius = 0.08 + effectiveHoverRadius * 0.35 + options.hoverStrength * 0.04;
      hoverMinCol = Math.min(hoverMinCol, Math.max(0, Math.floor((point.x - radius) * cols) - 1));
      hoverMaxCol = Math.max(hoverMaxCol, Math.min(cols, Math.ceil((point.x + radius) * cols) + 1));
      hoverMinRow = Math.min(hoverMinRow, Math.max(0, Math.floor((point.y - radius) * rows) - 1));
      hoverMaxRow = Math.max(hoverMaxRow, Math.min(rows, Math.ceil((point.y + radius) * rows) + 1));
    }
  }

  const animStyle = options.animationStyle;
  const animSpeed = options.animationSpeed;
  const ambientMode = resolveMotion(animStyle);
  const noAnimation = ambientMode === 'none';
  const ambient = [0, 0, 0, 1];
  const hoverStrength = options.hoverStrength;
  const hoverEffect = options.hoverEffect;
  const hoverRadiusFactor = effectiveHoverRadius;
  const hoverShape = options.hoverShape || 'circle';
  const isInverted = resolveInvert(options.invert, canvasEl);
  const colorMode = options.colorMode;
  const TWO_PI = Math.PI * 2;
  const invCols = 1 / cols;
  const invRows = 1 / rows;

  let lastFillStyle = '';
  let lastAlpha = -1;

  if (options.renderMode === 'dots') {
    const maxRadius = Math.min(cellW, cellH) * 0.5 * options.dotSizeRatio;

    for (let y = region?.y ?? 0; y < (region?.bottom ?? rows); y++) {
      const rowData = frame[y];
      for (let x = region?.x ?? 0; x < (region?.right ?? cols); x++) {
        const cell = rowData[x];
        if (cell.a < 10) continue;

        const lum = (0.299 * cell.r + 0.587 * cell.g + 0.114 * cell.b) * 0.00392156863;
        const intensity = isInverted ? 1 - lum : lum;
        if (intensity < 0.02) continue;

        if (!noAnimation) sampleAmbient(ambientMode, x / cols, y / rows, time * animSpeed, ambient);
        const animMul = Math.max(0, Math.min(1, (1 + ambient[2]) * ambient[3]));

        let hoverMul = 1;
        let hoverOffX = 0;
        let hoverOffY = 0;
        let hoverGlow = 0;
        let hoverBlend = 0;

        if (hoverActive && x >= hoverMinCol && x <= hoverMaxCol && y >= hoverMinRow && y <= hoverMaxRow) {
          const fx = computeHoverEffect(
            x * invCols, y * invRows, hoverPosX, hoverPosY, hoverIntensity,
            hoverStrength, cellW, cellH, hoverEffect, hoverRadiusFactor, hoverShape, hoverPos?.trail, canvasWidth / canvasHeight
          );
          hoverMul = fx.scale;
          hoverOffX = fx.offsetX;
          hoverOffY = fx.offsetY;
          hoverGlow = fx.glow;
          hoverBlend = fx.colorBlend;
        }

        const radius = maxRadius * intensity * animMul * hoverMul;
        if (radius < 0.3) continue;

        const px = x * cellW + cellW * 0.5 + hoverOffX + ambient[0];
        const py = y * cellH + cellH * 0.5 + hoverOffY + ambient[1];

        let color: string;
        if (hoverBlend > 0) {
          const rgb = getCellColorRGB(cell, colorMode, acR, acG, acB, isInverted);
          const cr = Math.min(255, (rgb[0] + (hcR - rgb[0]) * hoverBlend) | 0);
          const cg = Math.min(255, (rgb[1] + (hcG - rgb[1]) * hoverBlend) | 0);
          const cb = Math.min(255, (rgb[2] + (hcB - rgb[2]) * hoverBlend) | 0);
          color = `rgb(${cr},${cg},${cb})`;
        } else {
          color = getCellColorStr(cell, colorMode, acR, acG, acB, isInverted);
        }

        const alpha = Math.min(1, (cell.a * 0.00392156863) * animMul * (1 + hoverGlow));

        if (alpha !== lastAlpha) { ctx.globalAlpha = alpha; lastAlpha = alpha; }
        if (color !== lastFillStyle) { ctx.fillStyle = color; lastFillStyle = color; }

        if (radius <= 3) {
          const d = radius * 2;
          ctx.fillRect(px - radius, py - radius, d, d);
        } else {
          ctx.beginPath();
          ctx.arc(px, py, radius, 0, TWO_PI);
          ctx.fill();
        }
      }
    }
  } else {
    const charAspect = 0.55;
    const fontSize = Math.min(cellW / charAspect, cellH) * 0.9;
    const useFastRect = false;

    if (!useFastRect) {
      const isEmoji = /\p{Extended_Pictographic}/u.test(options.customText || options.charset);
      ctx.font = isEmoji
        ? `${fontSize}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif`
        : `${fontSize}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
    }

    // ── Dynamic charset (charsetFrames) ──────────────────────────────────
    const dynFrms = options.charsetFrames;
    const hasDyn = !!dynFrms?.length;
    const dynCharset = hasDyn
      ? dynFrms![Math.floor(Math.max(0, time) * (options.charsetFps ?? 2)) % dynFrms!.length]
      : options.charset;

    const baseTransform = !useFastRect ? ctx.getTransform() : null;

    const canBatchTextRows =
      !useFastRect &&
      !hoverActive &&
      noAnimation &&
      !hasDyn &&
      colorMode === 'accent' &&
      !region && options.hoverStrength <= 0 && !/\p{Extended_Pictographic}/u.test(options.customText || options.charset) &&
      'letterSpacing' in ctx && /^[\x20-\x7e]*$/.test(options.customText || options.charset) &&
      frame.every(row => row.every(cell => cell.a < 10 ||
        (cell.a === 255 && cell.char.length === 1 && /^[\x20-\x7e]$/.test(cell.char))));

    if (canBatchTextRows) {
      const previousSpacing = ctx.letterSpacing;
      ctx.letterSpacing = '0px';
      const glyphWidth = ctx.measureText('M').width;
      ctx.letterSpacing = `${cellW - glyphWidth}px`;
      ctx.fillStyle = `rgb(${acR},${acG},${acB})`;
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
      for (let y = 0; y < rows; y++) {
        const rowData = frame[y];
        let line = '';
        for (let x = 0; x < cols; x++) {
          const cell = rowData[x];
          line += cell.a < 10 ? ' ' : cell.char;
        }
        if (line.trim().length === 0) continue;
        ctx.fillText(line, (cellW - glyphWidth) * 0.5, y * cellH + cellH * 0.5);
      }
      ctx.letterSpacing = previousSpacing;
      ctx.textAlign = 'center';
      ctx.globalAlpha = 1;
      return;
    }

    // ── glitchText pre-computation ───────────────────────────────────────
    // Stacks the hover-text word on multiple consecutive rows centred on the
    // cursor.  Each character scrambles (glitch) then resolves to the real
    // letter based on proximity to the cursor.  No box, no fill — only the
    // word characters themselves replace the underlying ASCII.
    const isGlitchText = hoverEffect === 'glitchText' && hoverActive;
    const GLITCH_CHARS = '!@#$%^&*<>{}[]|/\\~`0123456789';
    const glitchLen = GLITCH_CHARS.length;
    let gtWord = '';
    let gtWordLen = 0;
    let gtCursorCol = 0;
    let gtCursorRow = 0;
    let gtRepeatRows = 0;   // total rows of repeated words
    let gtStartRow = 0;     // first row of the text block
    let gtStartCol = 0;     // first col of each line (left-aligned to center)
    if (isGlitchText) {
      const rawText = options.hoverText ?? 'ASCIIFY';
      gtCursorCol = Math.round(hoverPosX * cols);
      gtCursorRow = Math.round(hoverPosY * rows);

      // Pick one word (cycle through array based on cursor region)
      if (Array.isArray(rawText)) {
        const words = rawText.filter(w => w.length > 0);
        if (words.length === 0) words.push('ASCIIFY');
        const regionX = Math.floor(gtCursorCol / Math.max(1, Math.ceil(cols / 5)));
        const regionY = Math.floor(gtCursorRow / Math.max(1, Math.ceil(rows / 3)));
        const idx = ((regionX * 7 + regionY * 13) % words.length + words.length) % words.length;
        gtWord = words[idx];
      } else {
        gtWord = rawText || 'ASCIIFY';
      }
      gtWordLen = gtWord.length;

      // Number of repeated rows — roughly proportional to hoverRadius
      gtRepeatRows = Math.max(3, Math.min(12, Math.round(rows * effectiveHoverRadius * 0.6)));
      const halfRows = Math.floor(gtRepeatRows / 2);
      gtStartRow = Math.max(0, gtCursorRow - halfRows);
      if (gtStartRow + gtRepeatRows > rows) gtStartRow = Math.max(0, rows - gtRepeatRows);

      // Center the word horizontally on the cursor
      gtStartCol = gtCursorCol - Math.floor(gtWordLen / 2);
    }

    for (let y = region?.y ?? 0; y < (region?.bottom ?? rows); y++) {
      const rowData = frame[y];
      for (let x = region?.x ?? 0; x < (region?.right ?? cols); x++) {
        const cell = rowData[x];
        if (cell.a < 10) continue;
        let drawChar = hasDyn && cell.lum != null
          ? luminanceToCharFast(cell.lum, getCharsetChars(dynCharset), isInverted)
          : cell.char;
        if (drawChar === ' ') continue;

        if (!noAnimation) sampleAmbient(ambientMode, x / cols, y / rows, time * animSpeed, ambient);
        const animMul = Math.max(0, Math.min(1, (1 + ambient[2]) * ambient[3]));
        if (animMul < 0.05) continue;

        let hoverScale = 1;
        let hoverOffX = 0;
        let hoverOffY = 0;
        let hoverGlow = 0;
        let hoverBlend = 0;

        if (hoverActive && !isGlitchText && x >= hoverMinCol && x <= hoverMaxCol && y >= hoverMinRow && y <= hoverMaxRow) {
          const fx = computeHoverEffect(
            x * invCols, y * invRows, hoverPosX, hoverPosY, hoverIntensity,
            hoverStrength, cellW, cellH, hoverEffect, hoverRadiusFactor, hoverShape, hoverPos?.trail, canvasWidth / canvasHeight
          );
          hoverScale = fx.scale;
          hoverOffX = fx.offsetX;
          hoverOffY = fx.offsetY;
          hoverGlow = fx.glow;
          hoverBlend = fx.colorBlend;
          if (hoverEffect === 'trail' && fx.proximity > 0) {
            // Sample the source field through the cursor wake; brightness also
            // changes glyph density, like a media-driven ASCII shader.
            const sx = Math.max(0, Math.min(cols - 1, Math.round(x - fx.offsetX / cellW)));
            const sy = Math.max(0, Math.min(rows - 1, Math.round(y - fx.offsetY / cellH)));
            const sample = frame[sy][sx];
            const lum = sample.lum ?? (sample.r * 0.299 + sample.g * 0.587 + sample.b * 0.114);
            drawChar = luminanceToCharFast(Math.min(255, lum + fx.proximity * hoverStrength * 65), getCharsetChars(dynCharset), isInverted);
          }
        }

        // ── glitchText character replacement ───────────────────────────
        // Only affects cells that fall on a word-character position.
        // The word is stacked on multiple rows, centered on cursor.
        // Near cursor → resolved letter.  Far → scrambled glyph.
        if (isGlitchText && y >= gtStartRow && y < gtStartRow + gtRepeatRows) {
          const charIdx = x - gtStartCol;
          if (charIdx >= 0 && charIdx < gtWordLen) {
            const targetChar = gtWord[charIdx];

            // Distance from cursor row (normalised 0..1)
            const rowDist = Math.abs(y - gtCursorRow) / Math.max(1, gtRepeatRows * 0.5);
            const colDist = Math.abs(x - gtCursorCol) / Math.max(1, gtWordLen);
            const dist = Math.max(rowDist, colDist);
            const resolveRate = Math.max(0, Math.min(1, 1 - dist * 0.9));

            // Per-cell animated hash for scramble flickering
            const h = Math.sin(x * 127.1 + y * 311.7 + Math.floor(time * 12) * 43758.5453) * 43758.5453;
            const rng = Math.abs(h - Math.floor(h));

            if (rng < resolveRate) {
              // Resolved — show the real character
              drawChar = targetChar;
            } else {
              // Scrambled — random glyph
              drawChar = GLITCH_CHARS[Math.abs(Math.floor(h * 97)) % glitchLen];
            }
            hoverGlow = 0.3 + resolveRate * 0.7;
            hoverBlend = 0.3 + resolveRate * 0.65;
          }
        }

        const px = x * cellW + cellW * 0.5 + hoverOffX + ambient[0];
        const py = y * cellH + cellH * 0.5 + hoverOffY + ambient[1];

        let color: string;
        if (hoverBlend > 0) {
          const rgb = getCellColorRGB(cell, colorMode, acR, acG, acB, isInverted);
          const cr = Math.min(255, (rgb[0] + (hcR - rgb[0]) * hoverBlend) | 0);
          const cg = Math.min(255, (rgb[1] + (hcG - rgb[1]) * hoverBlend) | 0);
          const cb = Math.min(255, (rgb[2] + (hcB - rgb[2]) * hoverBlend) | 0);
          color = `rgb(${cr},${cg},${cb})`;
        } else {
          color = getCellColorStr(cell, colorMode, acR, acG, acB, isInverted);
        }

        const alpha = Math.min(1, (cell.a * 0.00392156863) * animMul * (1 + hoverGlow));
        if (alpha !== lastAlpha) { ctx.globalAlpha = alpha; lastAlpha = alpha; }
        if (color !== lastFillStyle) { ctx.fillStyle = color; lastFillStyle = color; }
        if (hoverScale !== 1) {
          ctx.translate(px, py);
          ctx.scale(hoverScale, hoverScale);
          ctx.fillText(drawChar, 0, 0);
          ctx.setTransform(baseTransform!);
        } else {
          ctx.fillText(drawChar, px, py);
        }
      }
    }
  }

  ctx.globalAlpha = 1;
}
