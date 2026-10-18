import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_FIELD_SETTINGS, FIELD_MARKS, activeFieldHover, fieldClearFromRects, fieldCellLayout, fieldGlyphs, fieldLevels, fieldSourceRect, fieldSourceScale, normalizeFieldSettings, parseFieldColor } from './field-model';

describe('glyph field settings', () => {
  it('keeps words and multi-code-point glyphs as single cells', () => {
    expect(fieldGlyphs(' .:ASCIIFY')).toEqual([' ', '.', ':', 'A', 'S', 'C', 'I', 'I', 'F', 'Y']);
    expect(fieldGlyphs(' ░▒▓█')).toHaveLength(5);
    expect(fieldGlyphs(' 👍🏽x')).toEqual([' ', '👍🏽', 'x']);
  });
  it('splits common charsets without the grapheme segmenter, exactly as the segmenter would', () => {
    type Segments = { segment(input: string): Iterable<{ segment: string }> };
    const Segmenter = (Intl as unknown as { Segmenter: { new (locale: undefined, options: { granularity: 'grapheme' }): Segments; prototype: Segments } }).Segmenter;
    const graphemes = new Segmenter(undefined, { granularity: 'grapheme' });
    const segment = (charset: string) => Array.from(graphemes.segment(charset), part => part.segment);
    const common = [' .:-=+*#%@', ' ░▒▓█', ' ⠁⠃⠇⡇⣇⣧⣷⣿', ' -═╪╬', ' /╱╳', ' ·◇◈◆', ' .:+/◇#@', ' αβγδ', ' жщъ', ' ←↑→↓∑√'];
    const expected = common.map(segment);
    const spy = vi.spyOn(Segmenter.prototype, 'segment');
    try {
      expect(common.map(fieldGlyphs)).toEqual(expected);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    // No code point the fast path takes joins a neighbour or a twin.
    const wrong: string[] = [];
    for (let c = 0x20; c < 0x2c00; c++) {
      const glyph = String.fromCodePoint(c);
      for (const text of [`a${glyph}a`, glyph + glyph]) if (fieldGlyphs(text).join('|') !== segment(text).join('|')) wrong.push(c.toString(16));
    }
    expect(wrong).toEqual([]);
  });
  it('falls back to safe values and clamps ranges', () => {
    const settings = normalizeFieldSettings({ charset: 'x', cellSize: 1000, ink: 'red', contrast: -3, fluid: { radius: 9 } });
    expect(settings.charset).toBe(DEFAULT_FIELD_SETTINGS.charset);
    expect(settings.cellSize).toBe(96);
    expect(settings.ink).toBe(DEFAULT_FIELD_SETTINGS.ink);
    expect(settings.contrast).toBe(0);
    expect(settings.highlight).toBe('auto');
    expect(normalizeFieldSettings({ highlight: '#FFF' }).highlight).toBe('#fff');
    expect(settings.fluid && settings.fluid.radius).toBe(0.5);
  });
  it('merges partial updates onto the current settings', () => {
    const base = normalizeFieldSettings({ ink: '#123456', fluid: { glow: 1.2 } });
    const next = normalizeFieldSettings({ cellSize: 9, fluid: { force: 2 } }, base);
    expect(next.ink).toBe('#123456');
    expect(next.cellSize).toBe(9);
    expect(next.fluid && [next.fluid.glow, next.fluid.force, next.fluid.curl]).toEqual([1.2, 2, 24]);
    expect(normalizeFieldSettings({ fluid: { curl: 500 } }).fluid).toMatchObject({ curl: 80 });
    expect(normalizeFieldSettings({ fluid: false }, base).fluid).toBe(false);
    expect(normalizeFieldSettings({ fluid: true }, normalizeFieldSettings({ fluid: false })).fluid).toBeTruthy();
  });
});

describe('glyph field blend', () => {
  it('defaults to auto and accepts only its four modes', () => {
    expect(DEFAULT_FIELD_SETTINGS.blend).toBe('auto');
    for (const mode of ['auto', 'coarse', 'on', 'off'] as const) expect(normalizeFieldSettings({ blend: mode }).blend).toBe(mode);
    expect(normalizeFieldSettings({ blend: 'sometimes' as never }).blend).toBe('auto');
  });
});

describe('glyph field geometry', () => {
  it('covers a wide field with a tall source by cropping vertically around the focus', () => {
    const { scale, offset } = fieldSourceRect(1600, 900, 1000, 1000, 'cover', { x: 0.5, y: 0.25 });
    expect(scale[0]).toBe(1);
    expect(scale[1]).toBeCloseTo(0.5625);
    expect(offset[1]).toBeCloseTo((1 - 0.5625) * 0.25);
  });
  it('letterboxes when containing', () => {
    const { scale, offset } = fieldSourceRect(1000, 1000, 2000, 1000, 'contain');
    expect(scale).toEqual([1, 2]);
    expect(offset).toEqual([0, -0.5]);
  });
  it('lays out whole-pixel cells in a 16 column atlas', () => {
    const layout = fieldCellLayout(12, 1, 2, 40);
    expect([layout.width, layout.height, layout.columns, layout.rows]).toEqual([24, 24, 16, 3]);
    expect(fieldCellLayout(10, 0.6, 1.5, 4)).toMatchObject({ width: 9, height: 15, columns: 4, rows: 1 });
  });
  it('parses short and long hex colors', () => {
    expect(parseFieldColor('#fff')).toEqual([1, 1, 1]);
    expect(parseFieldColor('#f3ba32').map(v => Math.round(v * 255))).toEqual([243, 186, 50]);
  });
});

describe('glyph field levels', () => {
  it('stretches a dim source to its own range and ignores transparent pixels', () => {
    const pixels = new Uint8ClampedArray(400 * 4);
    for (let i = 0; i < 400; i++) { const v = 20 + (i % 100) * 0.6; pixels.set([v, v, v, 255], i * 4); }
    pixels.set([255, 255, 255, 0], 0);
    const [low, high] = fieldLevels(pixels);
    expect(low).toBeGreaterThan(0.07);
    expect(high).toBeLessThan(0.33);
  });
  it('leaves flat sources unstretched', () => {
    expect(fieldLevels(new Uint8ClampedArray([10, 10, 10, 255, 12, 12, 12, 255]))).toEqual([0, 1]);
  });
});

describe('glyph field hovers', () => {
  it('defaults to the fluid wake and keeps lantern settings in range', () => {
    const settings = normalizeFieldSettings({ hover: 'lantern', lantern: { radius: 5, trail: -1 } });
    expect(DEFAULT_FIELD_SETTINGS.hover).toBe('fluid');
    expect(settings.hover).toBe('lantern');
    expect(settings.lantern).toMatchObject({ radius: 0.6, trail: 0, strength: 0.5 });
  });
  it('treats a disabled fluid as no hover only when fluid is the chosen hover', () => {
    expect(activeFieldHover(normalizeFieldSettings({ fluid: false }))).toBe('none');
    expect(activeFieldHover(normalizeFieldSettings({ fluid: false, hover: 'lantern' }))).toBe('lantern');
    expect(normalizeFieldSettings({ hover: 'nope' as never }).hover).toBe('fluid');
    expect(activeFieldHover(normalizeFieldSettings({ hover: 'trail', fluid: false }))).toBe('trail');
    expect(normalizeFieldSettings({ hover: 'trail', trail: { strength: 2, radius: 0 } }).trail).toEqual({ strength: 1, radius: 0.1 });
  });
});

describe('glyph field halftone and clear zones', () => {
  it('normalizes the dot mark, drift scene and clear zone', () => {
    const settings = normalizeFieldSettings({ mark: 'dot', scene: 'drift', dotScale: 9, scale: 0, clear: { x: 0.2, width: 0.5, shape: 'rect' } });
    expect([settings.mark, settings.scene, settings.dotScale, settings.scale]).toEqual(['dot', 'drift', 1.4, 0.2]);
    expect(settings.clear).toMatchObject({ x: 0.2, y: 0.3, width: 0.5, height: 0.4, shape: 'rect' });
    expect(normalizeFieldSettings({ clear: false }, settings).clear).toBe(false);
  });
  it('accepts every Studio tile and print mark, and keeps the current mark for anything else', () => {
    for (const mark of FIELD_MARKS) expect(normalizeFieldSettings({ mark }).mark).toBe(mark);
    expect(FIELD_MARKS.slice(0, 2)).toEqual(['glyph', 'dot']);
    const lego = normalizeFieldSettings({ mark: 'lego' });
    expect(normalizeFieldSettings({ mark: 'bricks' as never }, lego).mark).toBe('lego');
    expect(normalizeFieldSettings({ mark: 'toString' as never }).mark).toBe('glyph');
  });
  it('keeps the current zone when given an element, which only a mounted field can measure', () => {
    const base = normalizeFieldSettings({ clear: { x: 0.1 } });
    expect(normalizeFieldSettings({ clear: { element: {} } }, base).clear).toEqual(base.clear);
  });
  it('maps an element rectangle into field fractions with padding', () => {
    const zone = fieldClearFromRects({ left: 100, top: 50, width: 1000, height: 500 }, { left: 300, top: 250, width: 400, height: 100 }, 20, 0.1, 'rect');
    expect(zone).toEqual({ x: 0.18, y: 0.36, width: 0.44, height: 0.28, feather: 0.1, shape: 'rect' });
    expect(fieldClearFromRects({ left: 0, top: 0, width: 0, height: 0 }, { left: 0, top: 0, width: 1, height: 1 })).toBe(false);
  });
});

describe('glyph field source resolution', () => {
  it('keeps about eight texels per cell, in halving steps', () => {
    // A 1280 × 1600 photo in a 440 × 550 card with 12 px cells: 34 texels per cell, a quarter is still 8.7.
    expect(fieldSourceScale(1280, 1600, 440, 550, 12, 'cover')).toBe(0.25);
    expect(fieldSourceScale(640, 640, 336, 336, 10, 'cover')).toBe(0.5);
    // A wide photo in a wider frame is cropped, so its height sets the density.
    expect(fieldSourceScale(1800, 1200, 2400, 1000, 18, 'cover')).toBe(1);
    expect(fieldSourceScale(4000, 1000, 400, 400, 10, 'contain')).toBe(0.125);
    expect(fieldSourceScale(4000, 1000, 400, 400, 10, 'cover')).toBe(0.5);
  });
  it('never scales up, and leaves images alone while the field size is unknown', () => {
    expect(fieldSourceScale(200, 200, 2000, 2000, 10, 'cover')).toBe(1);
    expect(fieldSourceScale(4000, 4000, 1, 1, 10, 'cover')).toBe(1);
    expect(fieldSourceScale(0, 0, 400, 400, 10, 'cover')).toBe(1);
  });
  it('always keeps at least the texels the cells sample', () => {
    for (const [w, h, fw, fh, cell] of [[3000, 2000, 500, 300, 9], [1024, 4096, 300, 900, 14], [5000, 5000, 100, 100, 4]]) {
      const scale = fieldSourceScale(w, h, fw, fh, cell, 'cover');
      const density = Math.min(w / fw, h / fh) * scale;
      expect(density * cell).toBeGreaterThanOrEqual(8);
      expect(density * cell).toBeLessThan(16);
    }
  });
});

describe('fieldCellPitch', () => {
  it('keeps the whole-pixel cell for pixel, and stretches a whole number of cells across the canvas for fill', async () => {
    const { fieldCellPitch, fieldCellLayout, normalizeFieldSettings } = await import('./field-model');
    const cell = fieldCellLayout(7 / 0.58, 0.58, 2, 15);
    expect(fieldCellPitch('pixel', 7 / 0.58, 0.58, 2, 2880, 1392, cell)).toEqual([cell.width, cell.height]);
    const [x, y] = fieldCellPitch('fill', 7 / 0.58, 0.58, 2, 2880, 1392, cell);
    // The site's hero: floor(1440 / 7) columns and floor(696 / 12.07) rows, filling the stage exactly.
    expect(2880 / x).toBeCloseTo(Math.floor(1440 / 7), 6);
    expect(1392 / y).toBeCloseTo(Math.floor(696 / (7 / 0.58)), 6);
    expect(normalizeFieldSettings({ cellFit: 'fill' }).cellFit).toBe('fill');
    expect(normalizeFieldSettings({ cellFit: 'nope' as 'fill' }).cellFit).toBe('pixel');
  });
});

describe('field hover scope', () => {
  it('defaults to all, accepts subject and outside, and keeps the previous scope for unknown input', () => {
    expect(DEFAULT_FIELD_SETTINGS.scope).toBe('all');
    expect(normalizeFieldSettings({ scope: 'subject' }).scope).toBe('subject');
    const outside = normalizeFieldSettings({ scope: 'outside' });
    expect(normalizeFieldSettings({ hover: 'lantern' }, outside).scope).toBe('outside');
    expect(normalizeFieldSettings({ scope: 'nope' as 'all' }).scope).toBe('all');
  });
});
