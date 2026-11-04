import { describe, expect, it } from 'vitest';
import { glyphInk, gridToAnsi, gridToHtml, gridToSvg, gridToText, toAsciiGrid } from '../headless';

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

  it('draws a vertical stroke as a bar and a diagonal as a slash in shape mode', () => {
    const bar = toAsciiGrid(picture(60, 120, x => (x >= 29 && x <= 31 ? 1 : 0)), { columns: 10, rows: 4, levels: 'none', dither: false });
    expect(bar.lines.map(line => line[5]).join('')).toMatch(/^[|!lI1]+$/);
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
