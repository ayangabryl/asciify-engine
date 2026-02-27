/**
 * Core frame-to-canvas renderer and source-to-frame converters.
 */

import type { AsciiOptions, AsciiCell, AsciiFrame } from '../types';
import { DEFAULT_OPTIONS } from '../types';
import { parseGIF, decompressFrames } from 'gifuct-js';
import {
  createOffscreenCanvas,
  adjustLuminance,
  luminanceToChar,
  customTextToChar,
  applyDither,
  getCellColorStr,
  getCellColorRGB,
  parseChromaKeyColor,
} from './utils';
import { getAnimationMultiplier, computeHoverEffect } from './animation';
import { renderWaveBackground } from '../backgrounds/wave';

// Re-export AsciiFrame for downstream consumers that import from this module
export type { AsciiFrame };
void DEFAULT_OPTIONS; // keep import alive for tree-shaking hint

/** Resolve `invert: 'auto'` to a concrete boolean using the OS color scheme. */
function resolveInvert(invert: boolean | 'auto'): boolean {
  if (invert !== 'auto') return invert;
  return typeof window !== 'undefined' && !window.matchMedia('(prefers-color-scheme: dark)').matches;
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
  if (v !== 'auto') return v.replace('#', '');

  if (typeof document !== 'undefined') {
    const rootStyle = getComputedStyle(document.documentElement);
    for (const prop of ['--accent-color', '--color-accent', '--accent', '--color-primary', '--primary', '--brand-color']) {
      const hex = cssValueToHex(rootStyle.getPropertyValue(prop).trim());
      if (hex) return hex;
    }
    const native = cssValueToHex((getComputedStyle(document.body) as CSSStyleDeclaration & { accentColor?: string }).accentColor ?? '');
    if (native) return native;
  }

  const isDark = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  return isDark ? 'faf9f7' : '0d0d0d';
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
  const maxDim = 2048;
  const ssX = Math.max(1, Math.min(Math.floor(maxDim / cols), Math.floor(srcWidth / cols)));
  const ssY = Math.max(1, Math.min(Math.floor(maxDim / rows), Math.floor(srcHeight / rows)));
  const sampleW = cols * ssX;
  const sampleH = rows * ssY;

  const { ctx } = createOffscreenCanvas(sampleW, sampleH);
  ctx.drawImage(source, 0, 0, sampleW, sampleH);
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
      const ditheredLum = applyDither(adjustedLum, x, y, options.ditherStrength);
      const char = options.customText
        ? customTextToChar(ditheredLum, options.customText, x, y, cols, invertVal)
        : luminanceToChar(ditheredLum, effectiveCharset, invertVal);

      row.push({ char, r, g, b, a, lum: ditheredLum });
    }
    frame.push(row);
  }

  return { frame, cols, rows };
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
 * Extract frames from an animated GIF file buffer.
 */
export async function gifToAsciiFrames(
  buffer: ArrayBuffer,
  options: AsciiOptions,
  targetWidth: number,
  targetHeight: number,
  onProgress?: (progress: number) => void
): Promise<{ frames: AsciiFrame[]; cols: number; rows: number; fps: number }> {
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

    const frameImageData = new ImageData(new Uint8ClampedArray(patch.buffer), dims.width, dims.height);
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = dims.width;
    tempCanvas.height = dims.height;
    const tempCtx = tempCanvas.getContext('2d')!;
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
 * Render an ASCII frame to a canvas context.
 * Supports both ASCII text mode and Dots mode.
 */
export function renderFrameToCanvas(
  ctx: CanvasRenderingContext2D,
  frame: AsciiFrame,
  options: AsciiOptions,
  canvasWidth: number,
  canvasHeight: number,
  time: number = 0,
  hoverPos?: { x: number; y: number; intensity?: number } | null
) {
  // waveField short-circuit
  if (options.animationStyle === 'waveField') {
    const mouseNorm = hoverPos ? { x: hoverPos.x, y: hoverPos.y } : { x: 0.5, y: 0.5 };
    const acHexWF = options.accentColor ? resolveAccentHex(options.accentColor) : 'd4ff00';
    renderWaveBackground(ctx, canvasWidth, canvasHeight, time, mouseNorm, {
      accentColor: `#${acHexWF}`,
      accentThreshold: 0.52,
      mouseInfluence: options.hoverStrength > 0 ? Math.min(1, 0.3 + options.hoverStrength * 0.5) : 0.55,
      mouseFalloff: 2.8,
      speed: options.animationSpeed,
      vortex: options.hoverStrength > 0,
      sparkles: true,
      breathe: true,
    });
    return;
  }

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

  if (!hasTransparency) {
    // Fill based on the OS colour scheme so the canvas background matches
    // the page regardless of the `invert` setting (which controls char
    // density / accent brightness, NOT background colour).
    const isDarkScheme = typeof window !== 'undefined'
      && window.matchMedia('(prefers-color-scheme: dark)').matches;
    ctx.fillStyle = isDarkScheme ? '#0a0a0a' : '#faf9f7';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  }

  const cellW = canvasWidth / cols;
  const cellH = canvasHeight / rows;
  const totalCells = rows * cols;

  const hoverIntensity = hoverPos?.intensity ?? 1;
  const animationActive = options.animationStyle !== 'none';
  const suppressHover = animationActive && totalCells > 5_000;
  const hoverActive = !suppressHover && !!(hoverPos && options.hoverStrength > 0 && hoverIntensity > 0.005);

  const hc = options.hoverColor || '#ffffff';
  const hcR = parseInt(hc.slice(1, 3), 16) || 255;
  const hcG = parseInt(hc.slice(3, 5), 16) || 255;
  const hcB = parseInt(hc.slice(5, 7), 16) || 255;

  const acHex = resolveAccentHex(options.accentColor);
  const acR = parseInt(acHex.substring(0, 2), 16) || 255;
  const acG = parseInt(acHex.substring(2, 4), 16) || 255;
  const acB = parseInt(acHex.substring(4, 6), 16) || 255;

  const radiusScale = totalCells > 30_000 ? 0.25
                    : totalCells > 15_000 ? 0.4
                    : totalCells > 5_000  ? 0.6
                    : 1;
  const effectiveHoverRadius = options.hoverRadius * radiusScale;

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

  const animStyle = options.animationStyle;
  const animSpeed = options.animationSpeed;
  const noAnimation = animStyle === 'none';
  const hoverStrength = options.hoverStrength;
  const hoverEffect = options.hoverEffect;
  const hoverRadiusFactor = effectiveHoverRadius;
  const isInverted = resolveInvert(options.invert);
  const colorMode = options.colorMode;
  const TWO_PI = Math.PI * 2;
  const invCols = 1 / cols;
  const invRows = 1 / rows;

  let lastFillStyle = '';
  let lastAlpha = -1;

  if (options.renderMode === 'dots') {
    const maxRadius = Math.min(cellW, cellH) * 0.5 * options.dotSizeRatio;

    for (let y = 0; y < rows; y++) {
      const rowData = frame[y];
      for (let x = 0; x < cols; x++) {
        const cell = rowData[x];
        if (cell.a < 10) continue;

        const lum = (0.299 * cell.r + 0.587 * cell.g + 0.114 * cell.b) * 0.00392156863;
        const intensity = isInverted ? 1 - lum : lum;
        if (intensity < 0.02) continue;

        const animMul = noAnimation ? 1
          : getAnimationMultiplier(x, y, cols, rows, time, animStyle, animSpeed);

        let hoverMul = 1;
        let hoverOffX = 0;
        let hoverOffY = 0;
        let hoverGlow = 0;
        let hoverBlend = 0;

        if (hoverActive && x >= hoverMinCol && x <= hoverMaxCol && y >= hoverMinRow && y <= hoverMaxRow) {
          const fx = computeHoverEffect(
            x * invCols, y * invRows, hoverPosX, hoverPosY, hoverIntensity,
            hoverStrength, cellW, cellH, hoverEffect, hoverRadiusFactor
          );
          hoverMul = fx.scale;
          hoverOffX = fx.offsetX;
          hoverOffY = fx.offsetY;
          hoverGlow = fx.glow;
          hoverBlend = fx.colorBlend;
        }

        const radius = maxRadius * intensity * animMul * hoverMul;
        if (radius < 0.3) continue;

        const px = x * cellW + cellW * 0.5 + hoverOffX;
        const py = y * cellH + cellH * 0.5 + hoverOffY;

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
    const useFastRect = fontSize < 6;

    if (!useFastRect) {
      const isEmoji = options.artStyle === 'emoji';
      ctx.font = isEmoji
        ? `${fontSize}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif`
        : `${fontSize}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
    }

    let charWeights: Record<string, number> | null = null;
    // ── Dynamic charset (charsetFrames) ──────────────────────────────────
    const dynFrms = options.charsetFrames;
    const hasDyn = !!dynFrms?.length;
    const dynCharset = hasDyn
      ? dynFrms![Math.floor(Math.max(0, time) * (options.charsetFps ?? 2)) % dynFrms!.length]
      : options.charset;

    if (useFastRect) {
      charWeights = {};
      const csChars = [...dynCharset]; // Unicode-aware
      const csLen = csChars.length;
      for (let i = 0; i < csLen; i++) {
        charWeights[csChars[i]] = Math.max(0.1, (i + 0.3) / csLen);
      }
    }

    const baseTransform = !useFastRect ? ctx.getTransform() : null;

    // ── glitchText pre-computation ───────────────────────────────────────
    // Resolve the text string(s) and cursor grid position once before the loop.
    const isGlitchText = hoverEffect === 'glitchText' && hoverActive;
    const GLITCH_CHARS = '!@#$%^&*<>{}[]|/\\~`0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const glitchLen = GLITCH_CHARS.length;
    let gtText = '';
    let gtLines: string[] = [];
    let gtCursorCol = 0;
    let gtCursorRow = 0;
    if (isGlitchText) {
      const rawText = options.hoverText ?? 'ASCIIFY';
      gtCursorCol = Math.round(hoverPosX * cols);
      gtCursorRow = Math.round(hoverPosY * rows);
      if (Array.isArray(rawText)) {
        // Pick from pool via spatial hash based on cursor grid region
        const regionX = Math.floor(gtCursorCol / Math.max(1, Math.ceil(cols / 5)));
        const regionY = Math.floor(gtCursorRow / Math.max(1, Math.ceil(rows / 3)));
        const hash = ((regionX * 7 + regionY * 13) % rawText.length + rawText.length) % rawText.length;
        gtText = rawText[hash] || rawText[0] || 'ASCIIFY';
      } else {
        gtText = rawText || 'ASCIIFY';
      }
      gtLines = gtText.split('\n');
    }

    for (let y = 0; y < rows; y++) {
      const rowData = frame[y];
      for (let x = 0; x < cols; x++) {
        const cell = rowData[x];
        if (cell.a < 10) continue;
        let drawChar = hasDyn && cell.lum != null
          ? luminanceToChar(cell.lum, dynCharset, isInverted)
          : cell.char;
        if (drawChar === ' ') continue;

        const animMul = noAnimation ? 1
          : getAnimationMultiplier(x, y, cols, rows, time, animStyle, animSpeed);
        if (animMul < 0.05) continue;

        let hoverScale = 1;
        let hoverOffX = 0;
        let hoverOffY = 0;
        let hoverGlow = 0;
        let hoverBlend = 0;
        let hoverProximity = 0;

        if (hoverActive && x >= hoverMinCol && x <= hoverMaxCol && y >= hoverMinRow && y <= hoverMaxRow) {
          const fx = computeHoverEffect(
            x * invCols, y * invRows, hoverPosX, hoverPosY, hoverIntensity,
            hoverStrength, cellW, cellH, hoverEffect, hoverRadiusFactor
          );
          hoverScale = fx.scale;
          hoverOffX = fx.offsetX;
          hoverOffY = fx.offsetY;
          hoverGlow = fx.glow;
          hoverBlend = fx.colorBlend;
          hoverProximity = fx.proximity;
        }

        // ── glitchText character replacement ───────────────────────────
        // Cells near the cursor scramble into random chars then resolve
        // into characters from hoverText, centered on the cursor position.
        if (isGlitchText && hoverProximity > 0) {
          // Determine which line (relative to cursor row) and column
          const halfH = Math.floor(gtLines.length / 2);
          const lineIdx = y - (gtCursorRow - halfH);
          const line = gtLines[lineIdx];

          if (line != null) {
            const halfW = Math.floor(line.length / 2);
            const charIdx = x - (gtCursorCol - halfW);

            if (charIdx >= 0 && charIdx < line.length && line[charIdx] !== ' ') {
              // This cell maps to a text character — resolve based on proximity.
              // proximity 0→1 (edge→center). Higher = more resolved.
              const resolve = Math.max(0, (hoverProximity - 0.15) / 0.55);
              // Use a per-cell hash seeded with time so the scramble animates
              const h = Math.sin(x * 127.1 + y * 311.7 + Math.floor(time * 10) * 43758.5453) * 43758.5453;
              const rng = h - Math.floor(h);
              if (rng < resolve) {
                drawChar = line[charIdx];
              } else {
                // Scrambled — pick a random glitch character
                drawChar = GLITCH_CHARS[Math.abs(Math.floor(h * 97)) % glitchLen];
              }
              // Boost glow/color on text cells for visibility
              hoverGlow = Math.max(hoverGlow, hoverProximity * 0.9);
              hoverBlend = Math.max(hoverBlend, hoverProximity * 0.85);
            } else {
              // Not part of the text but within radius — occasional glitch chars
              const h2 = Math.sin(x * 43.7 + y * 29.3 + Math.floor(time * 6) * 17.89) * 43758.5453;
              const rng2 = h2 - Math.floor(h2);
              if (rng2 < hoverProximity * 0.35) {
                drawChar = GLITCH_CHARS[Math.abs(Math.floor(h2 * 71)) % glitchLen];
              }
            }
          } else {
            // Row outside text lines — scattered glitch chars
            const h3 = Math.sin(x * 43.7 + y * 29.3 + Math.floor(time * 6) * 17.89) * 43758.5453;
            const rng3 = h3 - Math.floor(h3);
            if (rng3 < hoverProximity * 0.25) {
              drawChar = GLITCH_CHARS[Math.abs(Math.floor(h3 * 53)) % glitchLen];
            }
          }
        }

        const px = x * cellW + cellW * 0.5 + hoverOffX;
        const py = y * cellH + cellH * 0.5 + hoverOffY;

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

        if (useFastRect) {
          const weight = charWeights![drawChar] ?? 0.5;
          const effAlpha = Math.min(1, (cell.a * 0.00392156863) * animMul * (1 + hoverGlow)) * weight;
          if (effAlpha < 0.02) continue;
          if (effAlpha !== lastAlpha) { ctx.globalAlpha = effAlpha; lastAlpha = effAlpha; }
          if (color !== lastFillStyle) { ctx.fillStyle = color; lastFillStyle = color; }
          const rw = cellW * hoverScale;
          const rh = cellH * hoverScale;
          ctx.fillRect(px - rw * 0.5, py - rh * 0.5, rw, rh);
        } else {
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
  }

  ctx.globalAlpha = 1;
}
