import type { AsciiGrid } from './grid';

/* A grid as plain text, terminal colour, SVG or HTML. All strings, no DOM. */

/** The grid as plain text, rows joined by newlines. */
export function gridToText(grid: AsciiGrid): string {
  return grid.lines.join('\n');
}

export interface AnsiOptions {
  /** 'truecolor' (24-bit, default when the grid has colours), '256', or false for none. */
  color?: 'truecolor' | '256' | false;
}

const cube = (v: number) => (v < 48 ? 0 : v < 115 ? 1 : Math.min(5, Math.floor((v - 35) / 40)));

/** The grid for a terminal: each run of one colour opened once, the colour reset at the end of every row. */
export function gridToAnsi(grid: AsciiGrid, options: AnsiOptions = {}): string {
  const mode = options.color === undefined ? (grid.colors ? 'truecolor' : false) : options.color;
  if (!mode || !grid.colors) return gridToText(grid);
  const colors = grid.colors;
  return grid.lines.map((line, r) => {
    let out = '', open = '';
    for (let c = 0; c < line.length; c++) {
      const at = (r * grid.columns + c) * 3, red = colors[at], green = colors[at + 1], blue = colors[at + 2];
      const code = mode === 'truecolor' ? `38;2;${red};${green};${blue}` : `38;5;${16 + 36 * cube(red) + 6 * cube(green) + cube(blue)}`;
      if (line[c] !== ' ' && code !== open) { out += `\x1b[${code}m`; open = code; }
      out += line[c];
    }
    return open ? `${out}\x1b[0m` : out;
  }).join('\n');
}

const escapeXml = (text: string) => text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const hex = (colors: Uint8Array, at: number) => `#${[0, 1, 2].map(k => colors[at + k].toString(16).padStart(2, '0')).join('')}`;

export interface MarkupOptions {
  /** CSS font family. Default a monospace stack. */
  fontFamily?: string;
  /** Font size in px. Default 12. */
  fontSize?: number;
  /** Line height as a multiple of the font size. Default 1 (characters touch, as the grid was measured). */
  lineHeight?: number;
  /** Ink when the grid has no colours, or with `color: false`. Default: light on a dark grid, dark on a light one. */
  ink?: string;
  /** A background fill; omit for transparent. */
  background?: string;
  /** Use the grid's per-cell colours when it has them. Default true. */
  color?: boolean;
}

const FONT = "ui-monospace, 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace";
// Runs of cells that share a colour, so markup stays a few spans per row rather than one per character.
function runs(grid: AsciiGrid, r: number, useColor: boolean) {
  const line = grid.lines[r], out: { text: string; color: string | null }[] = [];
  for (let c = 0; c < line.length; c++) {
    const color = useColor && grid.colors && line[c] !== ' ' ? hex(grid.colors, (r * grid.columns + c) * 3) : null;
    const last = out[out.length - 1];
    if (last && (last.color === color || line[c] === ' ')) last.text += line[c];
    else out.push({ text: line[c], color });
  }
  return out;
}

/**
 * The grid as a standalone SVG of text rows, sized in px. Characters are laid out by the font's own advance with
 * `textLength`, so the art keeps its shape in any monospace font.
 */
export function gridToSvg(grid: AsciiGrid, options: MarkupOptions = {}): string {
  const size = options.fontSize ?? 12, lead = size * (options.lineHeight ?? 1);
  const advance = size * 0.6, width = Math.ceil(advance * grid.columns), height = Math.ceil(lead * grid.rows);
  const ink = options.ink ?? (grid.background === 'light' ? '#111' : '#eee');
  const useColor = options.color !== false && !!grid.colors;
  const rows = grid.lines.map((_, r) => {
    const spans = runs(grid, r, useColor).map(run => run.color ? `<tspan fill="${run.color}">${escapeXml(run.text)}</tspan>` : escapeXml(run.text)).join('');
    return `<text x="0" y="${((r + 0.8) * lead).toFixed(2)}" textLength="${width}" lengthAdjust="spacing">${spans}</text>`;
  }).join('');
  const fill = options.background ? `<rect width="100%" height="100%" fill="${escapeXml(options.background)}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`
    + `${fill}<g font-family="${escapeXml(options.fontFamily ?? FONT)}" font-size="${size}" fill="${escapeXml(ink)}" xml:space="preserve">${rows}</g></svg>`;
}

/** The grid as a `<pre>`, coloured with spans when the grid has colours. Mark it `aria-hidden` or give it a label where it is used. */
export function gridToHtml(grid: AsciiGrid, options: MarkupOptions = {}): string {
  const size = options.fontSize ?? 12;
  const ink = options.ink ?? (grid.background === 'light' ? '#111' : '#eee');
  const useColor = options.color !== false && !!grid.colors;
  const style = [`font-family:${options.fontFamily ?? FONT}`, `font-size:${size}px`, `line-height:${options.lineHeight ?? 1}`, `color:${ink}`, 'margin:0', 'white-space:pre',
    ...(options.background ? [`background:${options.background}`] : [])].join(';');
  const body = grid.lines.map((_, r) => runs(grid, r, useColor).map(run => run.color ? `<span style="color:${run.color}">${escapeXml(run.text)}</span>` : escapeXml(run.text)).join('')).join('\n');
  return `<pre style="${escapeXml(style)}">${body}</pre>`;
}
