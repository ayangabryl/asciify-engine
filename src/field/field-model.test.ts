import { describe, expect, it } from 'vitest';
import { DEFAULT_FIELD_SETTINGS, activeFieldHover, fieldCellLayout, fieldGlyphs, fieldLevels, fieldSourceRect, normalizeFieldSettings, parseFieldColor } from './field-model';

describe('glyph field settings', () => {
  it('keeps words and multi-code-point glyphs as single cells', () => {
    expect(fieldGlyphs(' .:ASCIIFY')).toEqual([' ', '.', ':', 'A', 'S', 'C', 'I', 'I', 'F', 'Y']);
    expect(fieldGlyphs(' ░▒▓█')).toHaveLength(5);
    expect(fieldGlyphs(' 👍🏽x')).toEqual([' ', '👍🏽', 'x']);
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
