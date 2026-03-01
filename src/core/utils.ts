/**
 * Low-level canvas and color utilities shared across the entire engine.
 * No imports from other engine modules — pure logic.
 */

import type { AsciiCell } from '../types';

// ─── Offscreen canvas ─────────────────────────────────────────────

export function createOffscreenCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  return { canvas, ctx };
}

// ─── Luminance helpers ────────────────────────────────────────────

export function adjustLuminance(lum: number, brightness: number, contrast: number): number {
  let adjusted = lum + brightness * 255;
  const factor = (259 * (contrast * 255 + 255)) / (255 * (259 - contrast * 255));
  adjusted = factor * (adjusted - 128) + 128;
  return Math.max(0, Math.min(255, adjusted));
}

export function luminanceToChar(lum: number, charset: string, invert: boolean): string {
  const normalized = invert ? 1 - lum / 255 : lum / 255;
  const chars = [...charset]; // Unicode-aware split (handles surrogate pairs / emoji)
  const index = Math.floor(normalized * (chars.length - 1));
  return chars[Math.max(0, Math.min(chars.length - 1, index))];
}

export function customTextToChar(
  lum: number, text: string, x: number, y: number, cols: number, invert: boolean
): string {
  const normalized = invert ? 1 - lum / 255 : lum / 255;
  if (normalized < 0.12) return ' ';
  const chars = [...text];
  const pos = y * cols + x;
  return chars[pos % chars.length];
}

// ─── Dithering ────────────────────────────────────────────────────

const BAYER_4X4 = [
  [ 0, 8, 2,10],
  [12, 4,14, 6],
  [ 3,11, 1, 9],
  [15, 7,13, 5],
] as const;

export function applyDither(lum: number, x: number, y: number, strength: number): number {
  if (strength <= 0) return lum;
  const threshold = (BAYER_4X4[y % 4][x % 4] / 16 - 0.5) * strength * 128;
  return Math.max(0, Math.min(255, lum + threshold));
}

// ─── Pre-computed Color LUTs ──────────────────────────────────────

export const GRAY_LUT: string[] = new Array(256);
export const GREEN_LUT: string[] = new Array(256);
for (let _i = 0; _i < 256; _i++) {
  GRAY_LUT[_i]  = `rgb(${_i},${_i},${_i})`;
  GREEN_LUT[_i] = `rgb(0,${_i},0)`;
}

// ─── Cell color resolution ────────────────────────────────────────

export function getCellColorStr(
  cell: AsciiCell, colorMode: string, acR: number, acG: number, acB: number,
  _isInverted = false
): string {
  switch (colorMode) {
    case 'fullcolor':
      return `rgb(${cell.r},${cell.g},${cell.b})`;
    case 'matrix':
      return GREEN_LUT[(0.299 * cell.r + 0.587 * cell.g + 0.114 * cell.b) | 0];
    case 'accent': {
      // Accent mode: constant colour — the character density (chosen by
      // luminanceToChar) already encodes brightness.  Scaling the colour
      // by luminance too creates a double-emphasis that makes dark source
      // areas invisible on dark backgrounds and bright areas invisible on
      // light backgrounds.
      return `rgb(${acR},${acG},${acB})`;
    }
    default: {
      // Grayscale: always use the source luminance as-is.
      // `invert` controls character DENSITY (sparse ↔ dense) but NOT color.
      // Inverting color would cancel out the density swap (dense + bright
      // on white = invisible), defeating the purpose of light-mode invert.
      const gray = (0.299 * cell.r + 0.587 * cell.g + 0.114 * cell.b) | 0;
      return GRAY_LUT[gray];
    }
  }
}

const _colorRGB = [0, 0, 0];
export function getCellColorRGB(
  cell: AsciiCell, colorMode: string, acR: number, acG: number, acB: number,
  _isInverted = false
): number[] {
  switch (colorMode) {
    case 'fullcolor':
      _colorRGB[0] = cell.r; _colorRGB[1] = cell.g; _colorRGB[2] = cell.b;
      break;
    case 'matrix': {
      const mb = (0.299 * cell.r + 0.587 * cell.g + 0.114 * cell.b) | 0;
      _colorRGB[0] = 0; _colorRGB[1] = mb; _colorRGB[2] = 0;
      break;
    }
    case 'accent': {
      // Constant accent colour — density encodes brightness (see getCellColorStr).
      _colorRGB[0] = acR; _colorRGB[1] = acG; _colorRGB[2] = acB;
      break;
    }
    default: {
      // Grayscale: no color inversion — see getCellColorStr comment.
      const gray = (0.299 * cell.r + 0.587 * cell.g + 0.114 * cell.b) | 0;
      _colorRGB[0] = gray; _colorRGB[1] = gray; _colorRGB[2] = gray;
      break;
    }
  }
  return _colorRGB;
}

// ─── Glow sprite cache ────────────────────────────────────────────

let _glowCache: { canvas: HTMLCanvasElement; size: number; r: number; g: number; b: number } | null = null;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getGlowSprite(radius: number, r: number, g: number, b: number): HTMLCanvasElement {
  const size = Math.ceil(radius / 4) * 4;
  if (_glowCache && _glowCache.size === size && _glowCache.r === r && _glowCache.g === g && _glowCache.b === b) {
    return _glowCache.canvas;
  }
  const dim = size * 2;
  const canvas = document.createElement('canvas');
  canvas.width = dim;
  canvas.height = dim;
  const gCtx = canvas.getContext('2d')!;
  const gradient = gCtx.createRadialGradient(size, size, 0, size, size, size);
  gradient.addColorStop(0, `rgba(${r},${g},${b},1)`);
  gradient.addColorStop(0.4, `rgba(${r},${g},${b},0.4)`);
  gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
  gCtx.fillStyle = gradient;
  gCtx.fillRect(0, 0, dim, dim);
  _glowCache = { canvas, size, r, g, b };
  return canvas;
}
// ─── Chroma key ───────────────────────────────────────────────────

/**
 * Resolve a chroma-key colour spec to `{ r, g, b }`.
 * Accepts a plain RGB object (returned unchanged) or any CSS colour string
 * — the string is parsed via a temporary 1×1 canvas so it supports hex,
 * `rgb()`, named colours, etc.
 */
// ─── Dark mode detection ──────────────────────────────────────────

/**
 * Detect whether the current environment is in dark mode.
 * Checks document-level theme indicators first (`data-theme`, `class="dark"`),
 * then falls back to the OS colour-scheme media query.
 */
export function isDarkMode(): boolean {
  if (typeof document !== 'undefined') {
    const el = document.documentElement;
    const dt = (el.getAttribute('data-theme') || '').toLowerCase();
    if (dt === 'dark') return true;
    if (dt === 'light') return false;
    if (el.classList.contains('dark')) return true;
  }
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

// ─── Chroma key ───────────────────────────────────────────────────

export function parseChromaKeyColor(
  color: { r: number; g: number; b: number } | string
): { r: number; g: number; b: number } {
  if (typeof color !== 'string') return color;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return { r: d[0], g: d[1], b: d[2] };
}