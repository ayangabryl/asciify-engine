import { gridToAnsi, gridToHtml, gridToSvg, gridToText, gridsToAnimatedSvg, toAsciiGrid, toBlockGrid, type AsciiGrid, type AsciiPixels, type MarkupOptions } from '../headless';
import type { CliFormat, CliMode } from './args';

/* Pictures to grids, and grids to what the command writes. */

export interface GridSettings {
  columns: number;
  rows: number;
  mode: CliMode;
  cellAspect: number;
  charset: string | null;
  color: boolean;
  light: boolean;
  dither: 'diffuse' | 'ordered' | false | null;
  contrast: number | null;
  brightness: number | null;
  gamma: number | null;
  invert: boolean;
}

/** Pixels across and down a cell asks for when a picture is drawn for this grid (3D models, video). */
export function pixelsPerCell(mode: CliMode, cellAspect: number): [number, number] {
  switch (mode) {
    case 'braille': return [4, 8];
    case 'half': return [2, 4];
    case 'quad': return [4, 4];
    case 'sextant': return [4, 6];
    default: return [6, Math.max(6, Math.round(6 * cellAspect))];
  }
}

function inverted(pixels: AsciiPixels): AsciiPixels {
  const channels = pixels.channels ?? 4, data = Uint8Array.from(pixels.data as ArrayLike<number>);
  for (let i = 0; i < data.length; i += channels) for (let k = 0; k < Math.min(3, channels); k++) data[i + k] = 255 - data[i + k];
  return { ...pixels, data };
}

/** One picture as a grid, in the mode asked for. `previous` keeps an animation's characters steady. */
export function toGrid(pixels: AsciiPixels, s: GridSettings, previous: AsciiGrid | null = null): AsciiGrid {
  const picture = s.invert ? inverted(pixels) : pixels;
  const background = s.light ? 'light' : 'dark';
  if (s.mode === 'braille' || s.mode === 'half' || s.mode === 'quad' || s.mode === 'sextant') {
    return toBlockGrid(picture, { columns: s.columns, rows: s.rows, mode: s.mode, color: s.color, background, cellAspect: s.cellAspect, ...(s.dither !== null ? { dither: s.dither } : {}) });
  }
  return toAsciiGrid(picture, {
    columns: s.columns, rows: s.rows, mode: s.mode, color: s.color, background, cellAspect: s.cellAspect,
    ...(s.charset ? { charset: s.charset } : {}), ...(s.dither !== null ? { dither: s.dither } : {}),
    ...(s.contrast !== null ? { contrast: s.contrast } : {}), ...(s.brightness !== null ? { brightness: s.brightness } : {}),
    ...(s.gamma !== null ? { gamma: s.gamma } : {}), ...(previous ? { previous } : {}),
  });
}

/** The grids without the rows that are empty in every one of them, above and below (a model framed in a square view). */
export function trimRows(grids: AsciiGrid[]): AsciiGrid[] {
  const { columns, rows } = grids[0];
  const blank = (g: AsciiGrid, r: number) => {
    if (g.lines[r].trim() !== '') return false;
    if (!g.backgrounds) return true;
    for (let c = 0; c < columns; c++) if (!g.alpha || g.alpha[r * columns + c] !== 0) return false;
    return true;
  };
  let first = rows, last = -1;
  for (let r = 0; r < rows; r++) if (grids.some(g => !blank(g, r))) { first = Math.min(first, r); last = r; }
  if (last < 0 || (first === 0 && last === rows - 1)) return grids;
  const cut = (data: Uint8Array | null | undefined, per: number) => (data ? data.slice(first * columns * per, (last + 1) * columns * per) : data);
  return grids.map(g => ({ ...g, rows: last - first + 1, lines: g.lines.slice(first, last + 1), colors: cut(g.colors, 3) ?? null, backgrounds: cut(g.backgrounds, 3), alpha: cut(g.alpha, 1) }));
}

export interface WriteSettings extends MarkupOptions {
  colorDepth: 'truecolor' | '256';
  color: boolean;
  fps: number;
  loop: boolean;
}

/** Grids as the chosen format: one frame, or an animation with each frame's delay in ms. */
export function formatGrids(grids: AsciiGrid[], delays: number[], format: CliFormat, s: WriteSettings): string {
  const markup: MarkupOptions = {
    ...(s.fontSize ? { fontSize: s.fontSize } : {}), ...(s.title ? { title: s.title } : {}), ...(s.background ? { background: s.background } : {}),
    ...(s.ink ? { ink: s.ink } : {}), ...(s.dark ? { dark: s.dark } : {}), color: s.color,
  };
  switch (format) {
    case 'text': return grids.map(gridToText).join('\n\f\n') + '\n';
    case 'ansi': return grids.map(grid => gridToAnsi(grid, { color: s.color ? s.colorDepth : false })).join('\n\f\n') + '\n';
    case 'svg': return grids.length === 1 ? gridToSvg(grids[0], markup) : gridsToAnimatedSvg(grids, { ...markup, fps: s.fps, loop: s.loop, delays });
    case 'html': {
      const body = grids.length === 1 ? gridToHtml(grids[0], { ...markup, background: undefined }) : gridsToAnimatedSvg(grids, { ...markup, fps: s.fps, loop: s.loop, delays });
      const ground = s.background ?? (grids[0].background === 'light' ? '#ffffff' : '#000000');
      const title = (s.title ?? 'ASCII art').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
      return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>`
        + `<style>html,body{margin:0;background:${ground}}body{display:grid;place-items:center;min-height:100vh}svg,pre{max-width:100vw;height:auto}</style></head>`
        + `<body>${body}</body></html>\n`;
    }
    case 'json': {
      const first = grids[0];
      return JSON.stringify({
        columns: first.columns, rows: first.rows, background: first.background, cellAspect: first.cellAspect ?? null,
        frames: grids.map((grid, i) => ({
          lines: grid.lines, delay: delays[i] ?? 0,
          ...(grid.colors ? { colors: Array.from(grid.colors) } : {}), ...(grid.backgrounds ? { backgrounds: Array.from(grid.backgrounds) } : {}),
        })),
      }) + '\n';
    }
  }
}
