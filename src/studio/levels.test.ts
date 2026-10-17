import { describe, expect, it } from 'vitest';
import { inkIndexLookup, studioLevels, studioToneGamma } from './renderer';
import { normalizeStudioSettings } from './model';

const gray = (values: number[]) => new Uint8ClampedArray(values.flatMap(v => [v, v, v, 255]));

describe('auto levels', () => {
  it('stretches a low-contrast source to its 1st–99th percentile', () => {
    const values = Array.from({ length: 1000 }, (_, i) => 80 + (i % 120));
    const [low, high] = studioLevels(gray(values));
    expect(low).toBeCloseTo(81 / 255, 2);
    expect(high).toBeCloseTo(198 / 255, 2);
  });
  it('never stretches a near-flat source by more than about 3x', () => {
    const [low, high] = studioLevels(gray(Array.from({ length: 1000 }, (_, i) => 140 + (i % 20))));
    expect(high - low).toBeCloseTo(0.32, 5);
    expect((low + high) / 2).toBeCloseTo(149.5 / 255, 1);
  });
  it('ignores a few outliers and transparent cells', () => {
    const values = [...Array.from({ length: 990 }, () => 100), ...Array.from({ length: 5 }, () => 0), ...Array.from({ length: 5 }, () => 255)];
    const pixels = gray(values);
    pixels.set([255, 255, 255, 0], 0);
    const [low, high] = studioLevels(pixels);
    expect(high - low).toBeGreaterThanOrEqual(0.32 - 1e-9);
    expect(low).toBeGreaterThan(0);
    expect(high).toBeLessThan(1);
  });
  it('is on by default and can be turned off', () => {
    expect(normalizeStudioSettings({}).color.levels).toBe('auto');
    expect(normalizeStudioSettings({ color: { levels: 'none' } }).color.levels).toBe('none');
  });
});

describe('ink-aware glyph mapping', () => {
  it('lifts a dark subject toward half ink, gently, and never darkens a bright one', () => {
    // A lit subject on black: dark ground, mid-tone fur, and a few bright highlights that set the top of the range.
    const dark = gray([...Array.from({ length: 560 }, () => 4), ...Array.from({ length: 400 }, (_, i) => 30 + (i % 70)), ...Array.from({ length: 40 }, () => 230)]);
    const bright = gray(Array.from({ length: 1000 }, (_, i) => 150 + (i % 100)));
    const [dl, dh] = studioLevels(dark), [bl, bh] = studioLevels(bright);
    expect(studioToneGamma(dark, dl, dh)).toBeLessThan(0.9);
    expect(studioToneGamma(dark, dl, dh)).toBeGreaterThanOrEqual(0.6);
    expect(studioToneGamma(bright, bl, bh)).toBe(0.9);
  });
  it('maps tone to the glyph with the nearest measured ink and lifts mid-tones', () => {
    // Coverage of " .:-=+*#%@" in a monospace face: thin glyphs crowd the low end.
    const coverage = [0, 0.05, 0.07, 0.06, 0.12, 0.11, 0.15, 0.24, 0.2, 0.28];
    const lookup = inkIndexLookup(coverage, 0.9)!;
    expect(lookup[0]).toBe(0);
    expect(lookup[12]).toBe(0);
    expect(lookup[255]).toBe(9);
    // A linear ramp would put mid-grey on '=' or '+'; by ink it lands on a denser glyph.
    expect([6, 8]).toContain(lookup[128]);
    for (let t = 1; t < 256; t++) expect(coverage[lookup[t]]).toBeGreaterThanOrEqual(coverage[lookup[t - 1]]);
  });
  it('falls back when coverage cannot be measured', () => {
    expect(inkIndexLookup([1, 1, 1])).toBeNull();
  });
});
