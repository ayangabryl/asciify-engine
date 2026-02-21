/**
 * asciiText — pure string output (no canvas required).
 * Converts an image/video/canvas element to a plain-text ASCII string
 * suitable for server-side rendering, clipboard export, or terminal output.
 */
import type { AsciiOptions } from '../types';
import { DEFAULT_OPTIONS } from '../types';
import { imageToAsciiFrame } from './renderer';

/**
 * Convert any image/video/canvas source to a plain multi-line string of ASCII.
 *
 * @example
 * ```ts
 * const text = asciiText(imgEl, { fontSize: 8, colorMode: 'grayscale' });
 * console.log(text);
 * ```
 *
 * @example SSR (Node/JSDOM)
 * ```ts
 * const { createCanvas, loadImage } = require('@napi-rs/canvas');
 * const img = await loadImage('./photo.jpg');
 * const canvas = createCanvas(img.width, img.height);
 * const ctx = canvas.getContext('2d');
 * ctx.drawImage(img, 0, 0);
 * const text = asciiText(canvas as unknown as HTMLCanvasElement, { fontSize: 10 });
 * ```
 */
export function asciiText(
  source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
  options: Partial<AsciiOptions> = {},
  targetWidth?: number,
  targetHeight?: number,
): string {
  const opts: AsciiOptions = { ...DEFAULT_OPTIONS, ...options };
  const { frame, cols } = imageToAsciiFrame(source, opts, targetWidth, targetHeight);
  if (!frame.length || cols === 0) return '';

  const lines: string[] = [];
  for (const row of frame) {
    lines.push(row.map(cell => cell.char).join(''));
  }
  return lines.join('\n');
}

/**
 * Convert any source to an ASCII string with ANSI 256-colour escape codes.
 * Works in any terminal that supports ANSI colours.
 *
 * @example
 * ```ts
 * process.stdout.write(asciiTextAnsi(imgEl, { fontSize: 8 }));
 * ```
 */
export function asciiTextAnsi(
  source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
  options: Partial<AsciiOptions> = {},
  targetWidth?: number,
  targetHeight?: number,
): string {
  const opts: AsciiOptions = { ...DEFAULT_OPTIONS, ...options };
  const { frame, cols } = imageToAsciiFrame(source, opts, targetWidth, targetHeight);
  if (!frame.length || cols === 0) return '';

  const RESET = '\x1b[0m';
  const lines: string[] = [];

  for (const row of frame) {
    let line = '';
    for (const cell of row) {
      if (cell.char === ' ' || cell.a < 10) {
        line += ' ';
      } else {
        // Truecolor ANSI: \x1b[38;2;R;G;Bm
        line += `\x1b[38;2;${cell.r};${cell.g};${cell.b}m${cell.char}${RESET}`;
      }
    }
    lines.push(line);
  }
  return lines.join('\n');
}
