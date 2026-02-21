/**
 * text-frame.ts — Build and render ASCII frames from tiling text patterns.
 *
 * Enables interactive text backgrounds with the full hover-effect system
 * (spotlight, magnify, repel, glow, colorShift, …) without needing an image
 * source.
 *
 * @example — basic usage
 * ```ts
 * import { renderTextBackground } from 'asciify-engine';
 *
 * function tick(ctx, w, h, mousePos) {
 *   renderTextBackground(ctx, w, h, 'asciify·engine·v1·', {
 *     hoverEffect: 'spotlight',
 *     hoverColor: '#d4ff00',
 *   }, mousePos);
 *   requestAnimationFrame(() => tick(ctx, w, h, mousePos));
 * }
 * ```
 *
 * @example — build the frame yourself and pass it to renderFrameToCanvas
 * ```ts
 * import { buildTextFrame, renderFrameToCanvas, DEFAULT_OPTIONS } from 'asciify-engine';
 *
 * const frame = buildTextFrame('hello world · ', 80, 24);
 * renderFrameToCanvas(ctx, frame, {
 *   ...DEFAULT_OPTIONS,
 *   hoverEffect: 'repel',
 *   hoverStrength: 0.9,
 *   hoverColor: '#a0e8ff',
 * }, width, height, 0, mousePos);
 * ```
 */

import type { AsciiFrame, AsciiOptions, HoverEffect } from '../types';
import { DEFAULT_OPTIONS } from '../types';
import { parseColor } from '../backgrounds/_shared';
import { renderFrameToCanvas } from './renderer';

// ─── Public types ──────────────────────────────────────────────────────────

export interface TextBackgroundOptions {
  /**
   * Character size in pixels.
   * Controls the grid density: smaller → more cells, finer text.
   * @default 10
   */
  fontSize?: number;

  /**
   * Line-height multiplier applied on top of `fontSize` to derive row height.
   * Matches the default monospace aspect ratio used by the renderer.
   * @default 1.6
   */
  lineHeight?: number;

  /**
   * Base colour for the text cells (inactive state).
   * Accepts any CSS hex or rgb string.
   * @default '#505050'
   */
  color?: string;

  /**
   * Base alpha for the text cells, 0–255.
   * @default 100
   */
  opacity?: number;

  /**
   * Which hover effect to activate when `hoverPos` is supplied.
   * @default 'spotlight'
   */
  hoverEffect?: HoverEffect;

  /**
   * Intensity of the hover distortion / glow, 0–1.
   * @default 0.85
   */
  hoverStrength?: number;

  /**
   * Normalised radius of the hover influence zone, 0–1.
   * @default 0.18
   */
  hoverRadius?: number;

  /**
   * Accent colour applied by the hover effect.
   * @default '#d4ff00'
   */
  hoverColor?: string;
}

// ─── buildTextFrame ────────────────────────────────────────────────────────

/**
 * Build an `AsciiFrame` filled with a tiling text pattern.
 *
 * The `text` string is repeated (wrapping at column boundaries) across every
 * cell of the `cols × rows` grid.  Each cell carries the supplied base colour
 * and opacity as `{r, g, b, a}` values.
 *
 * The returned frame can be passed directly to `renderFrameToCanvas` with any
 * `AsciiOptions` including hover effects.
 *
 * @param text    - Pattern string to tile across the grid (e.g. `'hello · '`)
 * @param cols    - Number of character columns
 * @param rows    - Number of character rows
 * @param color   - Base RGB colour string for the cells (default: `'#505050'`)
 * @param opacity - Base alpha 0–255 (default: `100`)
 */
export function buildTextFrame(
  text: string,
  cols: number,
  rows: number,
  color: string = '#505050',
  opacity: number = 100,
): AsciiFrame {
  if (!text || cols <= 0 || rows <= 0) return [];
  const parsed = parseColor(color) ?? { r: 80, g: 80, b: 80 };
  const pattern = text;
  const len = pattern.length;

  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => ({
      char: pattern[(row * cols + col) % len],
      r: parsed.r,
      g: parsed.g,
      b: parsed.b,
      a: opacity,
    }))
  );
}

// ─── renderTextBackground ─────────────────────────────────────────────────

/**
 * All-in-one: build a tiling text grid and render it to a canvas with the
 * full hover-effect system (spotlight, magnify, repel, glow, colorShift, …).
 *
 * Call this inside a `requestAnimationFrame` loop, passing updated `hoverPos`
 * each frame to get smooth interactive effects.
 *
 * @param ctx       - 2D rendering context of the target canvas
 * @param width     - Canvas logical width in pixels
 * @param height    - Canvas logical height in pixels
 * @param text      - Pattern string to tile (e.g. `'asciify·engine·v1·'`)
 * @param options   - {@link TextBackgroundOptions}
 * @param hoverPos  - Normalised mouse position `{x, y}` in 0–1 range,
 *                    optionally with an `intensity` multiplier (0–1).
 *                    Pass `null` or omit to render without hover.
 */
export function renderTextBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  text: string,
  options: TextBackgroundOptions = {},
  hoverPos?: { x: number; y: number; intensity?: number } | null,
): void {
  const {
    fontSize    = 10,
    lineHeight  = 1.6,
    color       = '#505050',
    opacity     = 100,
    hoverEffect  = 'spotlight',
    hoverStrength = 0.85,
    hoverRadius  = 0.18,
    hoverColor   = '#d4ff00',
  } = options;

  const cols = Math.max(1, Math.floor(width  / fontSize));
  const rows = Math.max(1, Math.floor(height / (fontSize * lineHeight)));

  const frame = buildTextFrame(text, cols, rows, color, opacity);

  const renderOpts: AsciiOptions = {
    ...DEFAULT_OPTIONS,
    fontSize,
    hoverEffect,
    hoverStrength,
    hoverRadius,
    hoverColor,
  };

  renderFrameToCanvas(ctx, frame, renderOpts, width, height, 0, hoverPos ?? null);
}
