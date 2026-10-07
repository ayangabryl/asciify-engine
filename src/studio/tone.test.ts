import { describe, expect, it } from 'vitest';
import { createToneLookup, applyToneLookup } from './tone';
import { normalizeStudioSettings, parseStudioSettings, serializeStudioSettings } from './model';

describe('pre-conversion tonal detail', () => {
  it('skips the identity transform for old saved settings and defaults', () => {
    expect(createToneLookup({})).toBeNull();
    expect(createToneLookup(normalizeStudioSettings({}).color)).toBeNull();
  });
  it('maps input endpoints and preserves the expected gamma midpoint', () => {
    const levels = createToneLookup({blackPoint:51/255,whitePoint:204/255})!;
    expect(levels[51]).toBe(0); expect(levels[204]).toBe(255);
    expect(levels[127]).toBeCloseTo(127, 0);
    expect(createToneLookup({gamma:2})![64]).toBe(128);
  });
  it('adjusts shadows and highlights separately without moving their endpoints', () => {
    const shadows = createToneLookup({shadows:1})!, highlights = createToneLookup({highlights:-1})!;
    expect(shadows[64]).toBeGreaterThan(100); expect(shadows[191]).toBe(191);
    expect(highlights[191]).toBeLessThan(151); expect(highlights[64]).toBe(64);
    for (const curve of [shadows, highlights]) {
      expect(curve[0]).toBe(0); expect(curve[255]).toBe(255);
    }
  });
  it('is monotone and bounded across extreme combinations and malformed levels', () => {
    for (const shadows of [-1,-.5,0,.5,1]) for (const highlights of [-1,-.5,0,.5,1])
      for (const gamma of [.25,1,4]) for (const points of [[0,1],[.2,.8],[1,0]]) {
        const color = normalizeStudioSettings({color:{shadows,highlights,gamma,blackPoint:points[0],whitePoint:points[1]}}).color;
        expect(color.whitePoint! - color.blackPoint!).toBeGreaterThanOrEqual(1/255-1e-12);
        const curve = createToneLookup(color);
        if (!curve) continue;
        for (let i=1;i<256;i++) expect(curve[i]).toBeGreaterThanOrEqual(curve[i-1]);
      }
  });
  it('preserves alpha and hidden transparent RGB bytes', () => {
    const pixels = new Uint8ClampedArray([64,100,200,128,64,100,200,0]);
    applyToneLookup(pixels,createToneLookup({gamma:2})!);
    expect([...pixels]).toEqual([128,160,226,128,64,100,200,0]);
  });
  it('normalizes invalid inputs and round-trips every tonal control', () => {
    const state = normalizeStudioSettings({color:{blackPoint:.12,whitePoint:.92,gamma:1.3,shadows:.4,highlights:-.3}});
    expect(parseStudioSettings(serializeStudioSettings(state)).color).toEqual(state.color);
    expect(normalizeStudioSettings({color:{gamma:NaN,shadows:Infinity,highlights:'x'}}).color.gamma).toBe(1);
  });
});
