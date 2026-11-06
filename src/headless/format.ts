import type { AsciiGrid } from './grid';

/* A grid as plain text, terminal colour, SVG or HTML. All strings, no DOM. */

/** The grid as plain text, rows joined by newlines. */
export function gridToText(grid: AsciiGrid): string {
  return grid.lines.join('\n');
}

// A row's characters, one per cell: code points, so sextants (outside the 16-bit plane) count as one cell.
const SURROGATE = /[\uD800-\uDBFF]/;
const cellsOf = (line: string) => (SURROGATE.test(line) ? Array.from(line) : line.split(''));

export interface AnsiOptions {
  /** 'truecolor' (24-bit, default when the grid has colours), '256', or false for none. */
  color?: 'truecolor' | '256' | false;
}

const cube = (v: number) => (v < 48 ? 0 : v < 115 ? 1 : Math.min(5, Math.floor((v - 35) / 40)));
const ansi = (mode: 'truecolor' | '256', colors: Uint8Array, at: number, layer: 38 | 48) => mode === 'truecolor'
  ? `${layer};2;${colors[at]};${colors[at + 1]};${colors[at + 2]}`
  : `${layer};5;${16 + 36 * cube(colors[at]) + 6 * cube(colors[at + 1]) + cube(colors[at + 2])}`;

/**
 * The grid for a terminal: each run of one colour opened once, the colour reset at the end of every row. A grid with
 * `backgrounds` (`toBlockGrid` with `color`) sets each cell's background too.
 */
export function gridToAnsi(grid: AsciiGrid, options: AnsiOptions = {}): string {
  const backs = grid.backgrounds ?? null, colors = grid.colors, alpha = grid.alpha ?? null;
  const mode = options.color === undefined ? (colors || backs ? 'truecolor' : false) : options.color;
  if (!mode || (!colors && !backs)) return gridToText(grid);
  return grid.lines.map((line, r) => {
    let out = '', open = '';
    const cells = cellsOf(line);
    for (let c = 0; c < cells.length; c++) {
      const at = (r * grid.columns + c) * 3, ch = cells[c];
      // Without backgrounds a space shows nothing, so the colour is left as it is across it.
      if (!backs && ch === ' ') { out += ch; continue; }
      // Where the picture does not cover a cell, the terminal's own background shows: all of it, or around the glyph.
      const cover = alpha ? alpha[r * grid.columns + c] : 255;
      const code = cover === 0 ? '0' : cover < 255 ? `49;${colors ? ansi(mode, colors, at, 38) : '39'}` : [colors ? ansi(mode, colors, at, 38) : '', backs ? ansi(mode, backs, at, 48) : ''].filter(Boolean).join(';');
      if (code !== open && !(code === '0' && open === '')) { out += `\x1b[${code}m`; open = code; }
      out += ch;
    }
    return open && open !== '0' ? `${out}\x1b[0m` : out;
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
  /** Use the grid's per-cell colours (and backgrounds) when it has them. Default true. */
  color?: boolean;
  /**
   * SVG: ink and background where the reader prefers a dark scheme (`prefers-color-scheme`), so one file suits a README in
   * either theme. Used with uncoloured grids (or `color: false`).
   */
  dark?: { ink?: string; background?: string };
  /**
   * SVG: block elements (█ ▀ ▄ ▌ ▐, quadrants, sextants, eighths) and shades (░ ▒ ▓) drawn as exact shapes rather than as
   * text, so they tile without seams or gaps in any font. Default `'shapes'`; `'text'` keeps them as characters.
   */
  blocks?: 'shapes' | 'text';
  /** SVG: an accessible name (`<title>`). Without one the SVG is marked `aria-hidden`. */
  title?: string;
}

const FONT = "ui-monospace, 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace";
const NO_COLOR = '';

// Block elements as rectangles in a cell 8 wide and 24 high (eighths across, eighths, thirds and quarters down), and shades
// as a whole cell at a coverage.
type Rect = [x0: number, x1: number, y0: number, y1: number];
const BLOCKS = new Map<string, { rects: Rect[]; alpha?: number }>();
{
  const add = (ch: string, rects: Rect[], alpha?: number) => BLOCKS.set(ch, { rects, alpha });
  add('█', [[0, 8, 0, 24]]);
  add('▀', [[0, 8, 0, 12]]); add('▄', [[0, 8, 12, 24]]); add('▌', [[0, 4, 0, 24]]); add('▐', [[4, 8, 0, 24]]);
  for (let k = 1; k <= 7; k++) add(String.fromCharCode(0x2580 + k), [[0, 8, 24 - 3 * k, 24]]); // ▁ … ▇ lower eighths
  for (let k = 1; k <= 7; k++) add(String.fromCharCode(0x2590 - k), [[0, k, 0, 24]]); // ▏ … ▉ left eighths
  add('▔', [[0, 8, 0, 3]]); add('▕', [[7, 8, 0, 24]]);
  add('░', [[0, 8, 0, 24]], 0.25); add('▒', [[0, 8, 0, 24]], 0.5); add('▓', [[0, 8, 0, 24]], 0.75);
  // Quadrants by bits: top-left 1, top-right 2, bottom-left 4, bottom-right 8.
  const QUAD = ' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█';
  const quarter: Rect[] = [[0, 4, 0, 12], [4, 8, 0, 12], [0, 4, 12, 24], [4, 8, 12, 24]];
  for (let bits = 1; bits < 16; bits++) if (!BLOCKS.has(QUAD[bits])) add(QUAD[bits], quarter.filter((_, i) => bits & (1 << i)));
  // Sextants (U+1FB00 …) by bits, rows top to bottom, left then right; four patterns are the blocks above.
  const sixth: Rect[] = [[0, 4, 0, 8], [4, 8, 0, 8], [0, 4, 8, 16], [4, 8, 8, 16], [0, 4, 16, 24], [4, 8, 16, 24]];
  let code = 0x1fb00;
  for (let bits = 1; bits < 63; bits++) if (bits !== 21 && bits !== 42) add(String.fromCodePoint(code++), sixth.filter((_, i) => bits & (1 << i)));
}

// Runs of cells that share colours, so markup stays a few spans per row rather than one per character.
function runs(grid: AsciiGrid, r: number, useColor: boolean, skip?: (ch: string) => boolean) {
  const cells = cellsOf(grid.lines[r]), out: { text: string; color: string; back: string }[] = [];
  const colors = useColor ? grid.colors : null, backs = useColor ? grid.backgrounds ?? null : null;
  for (let c = 0; c < cells.length; c++) {
    let ch = cells[c];
    if (skip?.(ch)) ch = ' ';
    const at = (r * grid.columns + c) * 3;
    const clear = grid.alpha ? grid.alpha[r * grid.columns + c] < 255 : false;
    const color = colors && ch !== ' ' ? hex(colors, at) : NO_COLOR, back = backs && !clear ? hex(backs, at) : NO_COLOR;
    const last = out[out.length - 1];
    if (last && last.back === back && (last.color === color || ch === ' ')) last.text += ch;
    else if (last && last.back === back && last.text.trim() === '') { last.text += ch; last.color = color; }
    else out.push({ text: ch, color, back });
  }
  return out;
}

/** The SVG body of one grid: backgrounds, block shapes and text, in px. @internal */
function svgBody(grid: AsciiGrid, options: MarkupOptions, width: number) {
  const { lead, advance } = cellOf(grid, options);
  const useColor = options.color !== false && !!(grid.colors || grid.backgrounds);
  const shapes = options.blocks !== 'text';
  let out = '';
  // Cell backgrounds: one rectangle per run of a colour in a row, joined into a path per colour.
  const backs = useColor ? grid.backgrounds ?? null : null, alpha = grid.alpha ?? null;
  if (backs) {
    const paths = new Map<string, string>();
    // A cell's background colour, or '' where the picture leaves it clear.
    const backAt = (r: number, c: number) => (alpha && alpha[r * grid.columns + c] < 255 ? '' : hex(backs, (r * grid.columns + c) * 3));
    for (let r = 0; r < grid.rows; r++) {
      let start = 0;
      for (let c = 1; c <= grid.columns; c++) {
        if (c < grid.columns && backAt(r, c) === backAt(r, start)) continue;
        const color = backAt(r, start);
        if (color) paths.set(color, (paths.get(color) ?? '') + `M${(start * advance).toFixed(2)} ${(r * lead).toFixed(2)}h${((c - start) * advance).toFixed(2)}v${lead.toFixed(2)}h${(-(c - start) * advance).toFixed(2)}z`);
        start = c;
      }
    }
    for (const [color, d] of paths) out += `<path fill="${color}" d="${d}"/>`;
  }
  // Block elements: per sub-row of a row, runs of covered eighths in one colour; runs that repeat down the row grow taller.
  if (shapes) {
    const colors = useColor ? grid.colors : null, paths = new Map<string, string>();
    const sx = advance / 8, sy = lead / 24;
    for (let r = 0; r < grid.rows; r++) {
      const cells = cellsOf(grid.lines[r]);
      if (!cells.some(ch => BLOCKS.has(ch))) continue;
      let open = new Map<string, { x0: number; x1: number; y0: number; key: string }>();
      const close = (rect: { x0: number; x1: number; y0: number; key: string }, y1: number) => {
        const d = `M${(rect.x0 * sx).toFixed(2)} ${(r * lead + rect.y0 * sy).toFixed(2)}h${((rect.x1 - rect.x0) * sx).toFixed(2)}v${((y1 - rect.y0) * sy).toFixed(2)}h${(-(rect.x1 - rect.x0) * sx).toFixed(2)}z`;
        paths.set(rect.key, (paths.get(rect.key) ?? '') + d);
      };
      for (let y = 0; y <= 24; y++) {
        const next = new Map<string, { x0: number; x1: number; y0: number; key: string }>();
        if (y < 24) {
          let run: { x0: number; x1: number; key: string } | null = null;
          const flush = () => {
            if (!run) return;
            const id = `${run.x0},${run.x1},${run.key}`, known = open.get(id);
            if (known) { next.set(id, known); open.delete(id); } else next.set(id, { ...run, y0: y });
            run = null;
          };
          for (let c = 0; c < cells.length; c++) {
            const block = BLOCKS.get(cells[c]);
            if (!block) { flush(); continue; }
            const color = colors ? hex(colors, (r * grid.columns + c) * 3) : NO_COLOR, key = `${color}|${block.alpha ?? 1}`;
            let covered = false;
            for (const [x0, x1, y0, y1] of block.rects) {
              if (y < y0 || y >= y1) continue;
              covered = true;
              const a = c * 8 + x0, b = c * 8 + x1;
              if (run && run.key === key && run.x1 === a) run.x1 = b;
              else { flush(); run = { x0: a, x1: b, key }; }
            }
            if (!covered) flush();
          }
          flush();
        }
        for (const rect of open.values()) close(rect, y);
        open = next;
      }
    }
    for (const [key, d] of paths) {
      const [color, alpha] = key.split('|');
      out += `<path${color ? ` fill="${color}"` : ''}${alpha !== '1' ? ` fill-opacity="${alpha}"` : ''} d="${d}"/>`;
    }
  }
  const textUses = useColor && !!grid.colors;
  for (let r = 0; r < grid.rows; r++) {
    const parts = runs(grid, r, textUses, shapes ? ch => BLOCKS.has(ch) : undefined);
    if (parts.every(run => run.text.trim() === '')) continue;
    // Spaces as no-break spaces: an SVG placed inside HTML collapses ordinary ones whatever xml:space says.
    const spans = parts.map(run => { const text = escapeXml(run.text).replace(/ /g, '\u00a0'); return run.color ? `<tspan fill="${run.color}">${text}</tspan>` : text; }).join('');
    out += `<text x="0" y="${((r + 0.8) * lead).toFixed(2)}" textLength="${width}" lengthAdjust="spacing">${spans}</text>`;
  }
  return out;
}

// A cell's size in px: a line high, and as wide as the grid's cell aspect makes it, so the picture keeps its proportions
// (characters are spread to it with textLength); a grid without one takes a monospace font's 0.6 em.
function cellOf(grid: AsciiGrid, options: MarkupOptions) {
  const size = options.fontSize ?? 12, lead = size * (options.lineHeight ?? 1);
  return { size, lead, advance: grid.cellAspect && grid.cellAspect > 0 ? lead / grid.cellAspect : size * 0.6 };
}

function svgFrame(grid: AsciiGrid, options: MarkupOptions) {
  const { size, lead, advance } = cellOf(grid, options);
  return { size, width: Math.ceil(advance * grid.columns), height: Math.ceil(lead * grid.rows) };
}

// The SVG's opening, styles and ground, shared by still and animated SVGs.
function svgOpen(grid: AsciiGrid, options: MarkupOptions, width: number, height: number, size: number, style = '') {
  const ink = options.ink ?? (grid.background === 'light' ? '#111' : '#eee');
  const dark = options.dark;
  const css = (dark ? `@media (prefers-color-scheme: dark){${dark.ink ? `.i{fill:${dark.ink}}` : ''}${dark.background ? `.b{fill:${dark.background}}` : ''}}` : '') + style;
  const label = options.title ? `<title>${escapeXml(options.title)}</title>` : '';
  const fill = options.background || dark?.background ? `<rect class="b" width="100%" height="100%" fill="${escapeXml(options.background ?? 'none')}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ${options.title ? 'role="img"' : 'aria-hidden="true"'}>`
    + label + (css ? `<style>${css.replace(/</g, '')}</style>` : '') + fill
    + `<g class="i" font-family="${escapeXml(options.fontFamily ?? FONT)}" font-size="${size}" fill="${escapeXml(ink)}" xml:space="preserve" style="white-space:pre">`;
}

/**
 * The grid as a standalone SVG, sized in px: text rows laid out by the font's own advance with `textLength`, so the art
 * keeps its shape in any monospace font, and block elements drawn as exact shapes (see `blocks`).
 */
export function gridToSvg(grid: AsciiGrid, options: MarkupOptions = {}): string {
  const { size, width, height } = svgFrame(grid, options);
  return `${svgOpen(grid, options, width, height, size)}${svgBody(grid, options, width)}</g></svg>`;
}

export interface AnimatedSvgOptions extends MarkupOptions {
  /** Frames a second, when `delays` does not say. Default 12. */
  fps?: number;
  /** How long each frame shows, in ms (a GIF's own timing); default 1000 / fps for every frame. */
  delays?: readonly number[];
  /** Play forever (default), or once and hold the last frame. */
  loop?: boolean;
}

/**
 * Grids as one animated SVG: each frame shown in turn by CSS alone, no script, so it plays where SVGs are shown as images
 * (a README, a docs page, an email client that shows SVG). Under `prefers-reduced-motion` it holds the first frame.
 */
export function gridsToAnimatedSvg(grids: readonly AsciiGrid[], options: AnimatedSvgOptions = {}): string {
  if (!grids.length) throw new Error('gridsToAnimatedSvg needs at least one grid.');
  const fps = options.fps && options.fps > 0 ? options.fps : 12, loop = options.loop !== false, n = grids.length;
  const frames = grids.map(grid => svgFrame(grid, options));
  const width = Math.max(...frames.map(f => f.width)), height = Math.max(...frames.map(f => f.height));
  const durations = grids.map((_, i) => { const d = options.delays?.[i]; return d !== undefined && d > 0 ? Math.max(10, d) : 1000 / fps; });
  const total = durations.reduce((a, b) => a + b, 0), seconds = (ms: number) => `${(ms / 1000).toFixed(4)}s`;
  // One keyframe rule for each length a frame shows: visible for its share of the loop, hidden for the rest.
  const rules = new Map<number, string>();
  for (const d of durations) if (!rules.has(d)) rules.set(d, `s${rules.size}`);
  const style = n === 1 ? '' : `.f{visibility:hidden;animation-duration:${seconds(total)};animation-iteration-count:${loop ? 'infinite' : '1'}}`
    + [...rules].map(([d, name]) => `@keyframes ${name}{0%{visibility:visible}${((d / total) * 100).toFixed(4)}%{visibility:hidden}100%{visibility:hidden}}`).join('')
    + (loop ? '' : `.l{animation:h 1s 1 forwards}@keyframes h{0%,100%{visibility:visible}}`)
    + `@media (prefers-reduced-motion: reduce){.f{animation:none}.f0{visibility:visible}}`;
  let start = 0;
  const body = grids.map((grid, i) => {
    const last = !loop && i === n - 1;
    const css = `${last ? '' : `animation-name:${rules.get(durations[i])};`}animation-delay:${seconds(start)}`;
    start += durations[i];
    const cls = n === 1 ? '' : ` class="f f${i}${last ? ' l' : ''}" style="${css}"`;
    return `<g${cls}>${svgBody(grid, options, frames[i].width)}</g>`;
  }).join('');
  return `${svgOpen(grids[0], options, width, height, frames[0].size, style)}${body}</g></svg>`;
}

/** The grid as a `<pre>`, coloured with spans when the grid has colours. Mark it `aria-hidden` or give it a label where it is used. */
export function gridToHtml(grid: AsciiGrid, options: MarkupOptions = {}): string {
  const size = options.fontSize ?? 12;
  const ink = options.ink ?? (grid.background === 'light' ? '#111' : '#eee');
  const useColor = options.color !== false && !!(grid.colors || grid.backgrounds);
  const style = [`font-family:${options.fontFamily ?? FONT}`, `font-size:${size}px`, `line-height:${options.lineHeight ?? 1}`, `color:${ink}`, 'margin:0', 'white-space:pre',
    ...(options.background ? [`background:${options.background}`] : [])].join(';');
  const body = grid.lines.map((_, r) => runs(grid, r, useColor).map(run => {
    const css = (run.color ? `color:${run.color};` : '') + (run.back ? `background:${run.back}` : '');
    return css ? `<span style="${css.replace(/;$/, '')}">${escapeXml(run.text)}</span>` : escapeXml(run.text);
  }).join('')).join('\n');
  return `<pre style="${escapeXml(style)}">${body}</pre>`;
}
