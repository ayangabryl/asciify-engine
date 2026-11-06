import { describe, expect, it } from 'vitest';
import { glyphInk, gridToAnsi, gridToHtml, gridToSvg, gridToText, gridsToAnimatedSvg, toAsciiGrid, toBlockGrid } from '../headless';

const picture = (w: number, h: number, paint: (x: number, y: number) => number, channels: 1 | 3 | 4 = 4) => {
  const data = new Uint8Array(w * h * channels);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = Math.round(Math.max(0, Math.min(1, paint(x, y))) * 255), i = (y * w + x) * channels;
    for (let c = 0; c < Math.min(channels, 3); c++) data[i + c] = v;
    if (channels === 4) data[i + 3] = 255;
  }
  return { data, width: w, height: h, channels };
};

describe('toAsciiGrid', () => {
  it('sizes the grid from columns and the cell aspect', () => {
    const grid = toAsciiGrid(picture(400, 200, () => 0.5), { columns: 40 });
    expect(grid.columns).toBe(40);
    expect(grid.rows).toBe(Math.round(40 * 0.5 / 1.9306));
    expect(grid.lines).toHaveLength(grid.rows);
    expect(grid.lines.every(line => line.length === 40)).toBe(true);
  });

  it('is blank for black on a dark ground and dense for white', () => {
    const black = toAsciiGrid(picture(80, 40, () => 0), { columns: 20, levels: 'none' });
    expect(gridToText(black).replace(/\s/g, '')).toBe('');
    const white = toAsciiGrid(picture(80, 40, () => 1), { columns: 20, levels: 'none' });
    const inks = gridToText(white).replace(/\n/g, '').split('').map(ch => glyphInk(ch)!);
    expect(Math.min(...inks)).toBeGreaterThan(0.15);
  });

  it('inverts for a light ground', () => {
    const white = toAsciiGrid(picture(80, 40, () => 1), { columns: 20, levels: 'none', background: 'light' });
    expect(gridToText(white).replace(/\s/g, '')).toBe('');
  });

  it('gets darker cells to sparser characters along a gradient', () => {
    const grid = toAsciiGrid(picture(400, 40, x => x / 399), { columns: 40, rows: 1, levels: 'none', dither: false });
    const inks = grid.lines[0].split('').map(ch => glyphInk(ch) ?? 0);
    const left = inks.slice(0, 10).reduce((a, b) => a + b), right = inks.slice(-10).reduce((a, b) => a + b);
    expect(right).toBeGreaterThan(left * 3);
  });

  it('draws a vertical stroke as an upright glyph and a diagonal as a slash in shape mode', () => {
    // A stroke on a cell edge, split between two cells. Each column takes an upright glyph, the same down the line; a bracket
    // rather than a bar is a known weak spot (see the benchmark report).
    const bar = toAsciiGrid(picture(60, 120, x => (x >= 29 && x <= 31 ? 1 : 0)), { columns: 10, rows: 4, levels: 'none', dither: false });
    expect(bar.lines.map(line => line[5]).join('')).toMatch(/^([|!lI1()])\1+$/);
    // A line running corner to corner through cells (0,0), (1,1) and (2,2), the slope of a backslash.
    const slash = toAsciiGrid(picture(120, 116, (x, y) => (Math.abs(x - y * (20 / 38.67)) < 2.5 ? 1 : 0)), { columns: 6, rows: 3, levels: 'none', dither: false });
    expect(slash.lines[1][1]).toBe('\\');
    const forward = toAsciiGrid(picture(120, 116, (x, y) => (Math.abs((120 - x) - y * (20 / 38.67)) < 2.5 ? 1 : 0)), { columns: 6, rows: 3, levels: 'none', dither: false });
    expect(forward.lines[1][4]).toBe('/');
  });

  it('reads RGB and grey pixels as well as RGBA, and treats transparency as the ground', () => {
    const rgba = toAsciiGrid(picture(60, 30, () => 0.8), { columns: 12, levels: 'none' });
    expect(toAsciiGrid(picture(60, 30, () => 0.8, 3), { columns: 12, levels: 'none' }).lines).toEqual(rgba.lines);
    expect(toAsciiGrid(picture(60, 30, () => 0.8, 1), { columns: 12, levels: 'none' }).lines).toEqual(rgba.lines);
    const clear = picture(60, 30, () => 1); for (let i = 3; i < clear.data.length; i += 4) clear.data[i] = 0;
    expect(gridToText(toAsciiGrid(clear, { columns: 12, levels: 'none' })).trim()).toBe('');
  });

  it('is deterministic', () => {
    const p = picture(320, 200, (x, y) => 0.5 + 0.5 * Math.sin(x / 13) * Math.cos(y / 9));
    expect(toAsciiGrid(p, { columns: 60 }).lines).toEqual(toAsciiGrid(p, { columns: 60 }).lines);
  });

  it('keeps a tone charset of non-ASCII characters in the order given', () => {
    const grid = toAsciiGrid(picture(400, 40, x => x / 399), { columns: 40, rows: 1, mode: 'tone', charset: ' ░▒▓█', levels: 'none', dither: false });
    expect(grid.lines[0][0]).toBe(' ');
    expect(grid.lines[0][39]).toBe('█');
  });

  it('rejects pixel data that is too short', () => {
    expect(() => toAsciiGrid({ data: new Uint8Array(10), width: 10, height: 10 })).toThrow(/pixel values/);
  });
});

describe('grid output', () => {
  const grid = toAsciiGrid(picture(120, 60, (x, y) => (x + y) / 180), { columns: 12, color: true });
  it('writes ANSI colour once per run and resets each row', () => {
    const ansi = gridToAnsi(grid);
    expect(ansi.split('\n')).toHaveLength(grid.rows);
    expect(ansi).toMatch(/\x1b\[38;2;\d+;\d+;\d+m/);
    expect(gridToAnsi(grid, { color: '256' })).toMatch(/\x1b\[38;5;\d+m/);
    expect(gridToAnsi(grid, { color: false })).toBe(gridToText(grid));
  });
  it('escapes markup in SVG and HTML', () => {
    const tricky = { ...grid, lines: grid.lines.map(() => '<&>"\'' + ' '.repeat(grid.columns - 5)) };
    for (const markup of [gridToSvg(tricky, { color: false }), gridToHtml(tricky, { color: false })]) {
      expect(markup).not.toMatch(/<&>/);
      expect(markup).toContain('&lt;&amp;&gt;');
    }
    expect(gridToSvg(grid)).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="\d+" height="\d+"/);
    expect(gridToHtml(grid, { background: '#000' })).toMatch(/^<pre style="[^"]*background:#000/);
  });
});

describe('video settings', () => {
  const frame = (shift: number) => picture(320, 200, (x, y) => 0.5 + 0.5 * Math.sin((x + shift) / 17) * Math.cos(y / 11));
  it('ordered dither leaves exact black and white alone', () => {
    expect(gridToText(toAsciiGrid(picture(80, 40, () => 0), { columns: 20, levels: 'none', dither: 'ordered' })).trim()).toBe('');
  });
  it('a previous frame keeps still cells still', () => {
    const a = toAsciiGrid(frame(0), { columns: 60, dither: 'ordered' });
    const same = toAsciiGrid(frame(0), { columns: 60, dither: 'ordered', previous: a });
    expect(same.lines).toEqual(a.lines);
    const moved = toAsciiGrid(frame(0.4), { columns: 60, dither: 'ordered' }), kept = toAsciiGrid(frame(0.4), { columns: 60, dither: 'ordered', previous: a });
    const changes = (g: { lines: readonly string[] }) => g.lines.reduce((n, line, r) => n + [...line].filter((ch, c) => ch !== a.lines[r][c]).length, 0);
    expect(changes(kept)).toBeLessThanOrEqual(changes(moved));
  });
  it('ignores a previous grid of another size', () => {
    const a = toAsciiGrid(frame(0), { columns: 40 });
    expect(toAsciiGrid(frame(0), { columns: 60, previous: a }).lines).toEqual(toAsciiGrid(frame(0), { columns: 60 }).lines);
  });
});

describe('fast paths', () => {
  it('reads a frame drawn down to one pixel a cell as that pixel in every part of the cell', () => {
    const small = picture(40, 12, (x, y) => ((x * 7 + y * 3) % 10) / 10);
    const tone = toAsciiGrid(small, { columns: 40, rows: 12, mode: 'tone', levels: 'none' });
    expect(tone.lines).toHaveLength(12);
    expect(tone.lines.every(line => line.length === 40)).toBe(true);
    // A flat picture at one pixel a cell gives one character throughout, as it does at full size.
    const flat = toAsciiGrid(picture(40, 12, () => 0.6), { columns: 40, rows: 12, mode: 'tone', levels: 'none', dither: false });
    expect(new Set(flat.lines.join('')).size).toBe(1);
  });
  it('says what to do instead when imageToAsciiGrid runs without a canvas', async () => {
    const { imageToAsciiGrid } = await import('../headless');
    expect(() => imageToAsciiGrid({ width: 10, height: 10 } as unknown as CanvasImageSource)).toThrow(/toAsciiGrid/);
  });
  it('has no GPU converter without a canvas, so callers fall back', async () => {
    const { createAsciiGpu } = await import('../headless');
    expect(createAsciiGpu()).toBeNull();
  });
});

describe('sub-cell grids', () => {
  // Left half black, right half white; a light square at the top left of the black half.
  const split = picture(80, 80, (x, y) => (x >= 40 ? 1 : x < 10 && y < 20 ? 1 : 0));
  it('lights braille dots by tone, eight to a cell', () => {
    const grid = toBlockGrid(split, { columns: 8, rows: 4, mode: 'braille', dither: false, levels: 'none' });
    expect(grid.lines).toHaveLength(4);
    expect(grid.lines[0][7]).toBe('⣿');
    expect(grid.lines[3][0]).toBe('⠀');
    expect(grid.cellAspect).toBe(2);
    // Dots are lit where it is light: the square fills the top-left cell.
    expect(grid.lines[0][0]).toBe('⣿');
    expect(grid.lines[3][3]).toBe('⠀');
  });
  it('draws half, quadrant and sextant blocks', () => {
    const half = toBlockGrid(picture(40, 40, (_, y) => (y < 20 ? 1 : 0)), { columns: 4, rows: 2, mode: 'half', dither: false, levels: 'none' });
    expect(half.lines).toEqual(['████', '    ']);
    const steps = picture(40, 40, (_, y) => (y % 20 < 10 ? 1 : 0));
    expect(toBlockGrid(steps, { columns: 4, rows: 2, mode: 'half', dither: false, levels: 'none' }).lines).toEqual(['▀▀▀▀', '▀▀▀▀']);
    const quad = toBlockGrid(picture(20, 20, (x, y) => (x < 10 && y < 10 ? 1 : 0)), { columns: 1, rows: 1, mode: 'quad', dither: false, levels: 'none' });
    expect(quad.lines).toEqual(['▘']);
    const sextant = toBlockGrid(picture(20, 30, (x, y) => (x >= 10 && y < 10 ? 1 : 0)), { columns: 1, rows: 1, mode: 'sextant', dither: false, levels: 'none' });
    expect(sextant.lines).toEqual(['\u{1FB01}']);
    expect(gridToText(sextant)).toBe('🬁');
  });
  it('splits each cell into two colours with color', () => {
    const red = picture(20, 20, () => 0, 4);
    for (let i = 0; i < 400; i++) if (Math.floor(i / 20) < 10) { red.data[i * 4] = 255; red.data[i * 4 + 1] = 40; red.data[i * 4 + 2] = 40; }
    const grid = toBlockGrid(red, { columns: 1, rows: 1, mode: 'half', color: true });
    expect(grid.lines).toEqual(['▀']);
    expect([...grid.colors!]).toEqual([255, 40, 40]);
    expect([...grid.backgrounds!]).toEqual([0, 0, 0]);
    // Terminal: foreground and background set together.
    expect(gridToAnsi(grid)).toBe('\x1b[38;2;255;40;40;48;2;0;0;0m▀\x1b[0m');
    expect(gridToHtml(grid)).toContain('color:#ff2828;background:#000000');
    const svg = gridToSvg(grid);
    expect(svg).toContain('<path fill="#000000"');
    expect(svg).toContain('<path fill="#ff2828"');
    expect(svg).not.toContain('<text');
  });
  it('counts sextants as one cell each in colour output', () => {
    const grid = toBlockGrid(picture(60, 30, x => (x % 20) / 20), { columns: 3, rows: 1, mode: 'sextant', color: true });
    const cells = gridToAnsi(grid).replace(/\x1b\[[\d;]*m/g, '');
    expect([...cells]).toHaveLength(3);
  });
});

describe('SVG writers', () => {
  const grid = toAsciiGrid(picture(160, 80, (x, y) => (x + y) / 240), { columns: 20, mode: 'tone', charset: ' ░▒▓█' });
  it('keeps the picture\'s proportions', () => {
    const svg = gridToSvg(toAsciiGrid(picture(400, 200, x => x / 400), { columns: 40 }), { fontSize: 10 });
    const [, w, h] = svg.match(/width="(\d+)" height="(\d+)"/)!.map(Number);
    expect(w / h).toBeGreaterThan(1.9);
    expect(w / h).toBeLessThan(2.1);
  });
  it('draws blocks and shades as shapes, or as text when asked', () => {
    const svg = gridToSvg(grid);
    expect(svg).toMatch(/<path fill-opacity="0.5" d="M/);
    expect(svg).not.toMatch(/[░▒▓█]/);
    expect(gridToSvg(grid, { blocks: 'text' })).toMatch(/[░▒▓█]/);
  });
  it('follows the reader\'s scheme and names itself', () => {
    const svg = gridToSvg(grid, { title: 'A gradient', ink: '#111', dark: { ink: '#eee', background: '#000' } });
    expect(svg).toContain('role="img"><title>A gradient</title>');
    expect(svg).toContain('@media (prefers-color-scheme: dark){.i{fill:#eee}.b{fill:#000}}');
    expect(gridToSvg(grid)).toContain('aria-hidden="true"');
  });
  it('animates frames with CSS alone and holds the first under reduced motion', () => {
    const frames = [0, 1, 2].map(k => toAsciiGrid(picture(80, 40, x => ((x + k * 20) % 80) / 80), { columns: 10 }));
    const svg = gridsToAnimatedSvg(frames, { fps: 6 });
    expect(svg.match(/<g class="f f\d/g)).toHaveLength(3);
    expect(svg).toContain('animation-duration:0.5000s;animation-iteration-count:infinite');
    expect(svg).toContain('@keyframes s0{0%{visibility:visible}33.3333%{visibility:hidden}');
    expect(svg).toContain('animation-name:s0;animation-delay:0.3333s');
    // A GIF's own timing: frames held for different lengths.
    const timed = gridsToAnimatedSvg(frames, { delays: [100, 300, 100] });
    expect(timed).toContain('animation-duration:0.5000s');
    expect(timed).toContain('@keyframes s1{0%{visibility:visible}60.0000%{visibility:hidden}');
    expect(timed).toContain('animation-name:s0;animation-delay:0.4000s');
    expect(svg).toContain('@media (prefers-reduced-motion: reduce){.f{animation:none}.f0{visibility:visible}}');
    expect(svg).not.toContain('<script');
    const once = gridsToAnimatedSvg(frames, { fps: 6, loop: false });
    expect(once).toContain('class="f f2 l"');
    expect(gridsToAnimatedSvg(frames.slice(0, 1))).not.toContain('@keyframes');
    expect(() => gridsToAnimatedSvg([])).toThrow();
  });
});

describe('transparent pictures in two colours', () => {
  it('leaves cells the picture does not cover unpainted', () => {
    // An opaque red square in the left half; the right half fully transparent.
    const data = new Uint8Array(40 * 20 * 4);
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) data.set([255, 0, 0, 255], (y * 40 + x) * 4);
    const grid = toBlockGrid({ data, width: 40, height: 20 }, { columns: 4, rows: 2, mode: 'half', color: true });
    expect(grid.lines).toEqual(['██  ', '██  ']);
    expect(Array.from(grid.alpha!)).toEqual([255, 255, 0, 0, 255, 255, 0, 0]);
    const ansi = gridToAnsi(grid);
    expect(ansi.split('\n')[0]).toBe('\x1b[38;2;255;0;0;48;2;255;0;0m██\x1b[0m  ');
    expect(gridToSvg(grid).match(/<path fill="#ff0000"/g)?.length).toBe(2);
    expect(gridToSvg(grid)).not.toContain('#000000');
    expect(gridToHtml(grid)).not.toContain('background:#000000');
  });
  it('draws a partly covered cell as its covered pixels, over the terminal\'s own background', () => {
    // The top half of the picture red, the bottom half transparent: one ▀ in red with no background.
    const data = new Uint8Array(10 * 20 * 4);
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) data.set([255, 0, 0, 255], (y * 10 + x) * 4);
    const grid = toBlockGrid({ data, width: 10, height: 20 }, { columns: 1, rows: 1, mode: 'half', color: true });
    expect(grid.lines).toEqual(['▀']);
    expect(grid.alpha![0]).toBe(128);
    expect(gridToAnsi(grid)).toBe('\x1b[49;38;2;255;0;0m▀\x1b[0m');
    const svg = gridToSvg(grid);
    expect(svg).toContain('<path fill="#ff0000"');
    expect(svg.match(/<path/g)?.length).toBe(1);
  });
});
