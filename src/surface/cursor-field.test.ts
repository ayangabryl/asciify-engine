import { describe, expect, it } from 'vitest';
import { WaterSurface } from './water-surface';
import { CURSOR_MODES } from './cursor-field';
import { buildHoverGuide, scopeWeight, guideAt } from './hover-guide';
import { resolveSurfaceHover, SURFACE_HOVERS } from './hover-catalog';
import { normalizeStudioSettings, serializeStudioSettings } from '../studio/model';

const magnitude = (f: WaterSurface, x = .5, y = .5) => { const v = [0, 0, 0]; f.sample(x, y, v); return Math.abs(v[0]) + Math.abs(v[1]) + Math.abs(v[2]); };
const near = (f: WaterSurface) => Math.max(magnitude(f, .5, .5), magnitude(f, .56, .5), magnitude(f, .5, .42), magnitude(f, .6, .5));

describe('cursor hovers', () => {
  it.each(CURSOR_MODES)('%s eases in, holds while hovering and settles after leaving', mode => {
    const f = new WaterSurface(1.5); f.configure(mode, .6, .4);
    f.move(.5, .5, 0); f.step(1 / 120);
    const first = near(f);
    for (let i = 1; i <= 30; i++) { f.move(.5 + i * .002, .5, i * 16); f.step(1 / 60); }
    const held = near(f);
    expect(held).toBeGreaterThan(first);
    expect(f.engaged).toBe(true);
    f.leave();
    for (let i = 0; i < 600; i++) f.step(1 / 60);
    expect(f.active).toBe(false);
    expect(near(f)).toBeLessThan(held * .02 + 1e-4);
  });

  it('settles alike at 30, 60 and 120 steps per second', () => {
    const values = [30, 60, 120].map(fps => {
      const f = new WaterSurface(1); f.configure('loupe', .6, .4);
      f.move(.5, .5, 0);
      for (let i = 0; i < fps / 2; i++) f.step(1 / fps);
      return magnitude(f, .55, .5);
    });
    for (const v of values) expect(v).toBeCloseTo(values[0], 3);
  });

  it('lets decay shorten or lengthen the release', () => {
    const remaining = (decay: number) => {
      const f = new WaterSurface(1); f.configure('smudge', .7, .4, false, decay);
      f.move(.3, .5); f.move(.7, .5); f.step(1 / 60); f.leave();
      for (let i = 0; i < 40; i++) f.step(1 / 60);
      return magnitude(f, .5, .5);
    };
    expect(remaining(0)).toBeLessThan(remaining(.5));
    expect(remaining(1)).toBeGreaterThan(remaining(.5));
  });

  it('bleeds outward while the pointer rests, then dries back', () => {
    const f = new WaterSurface(1); f.configure('bleed', .7, .4);
    f.move(.5, .5, 0); f.step(1 / 60);
    const early = magnitude(f, .62, .5);
    for (let i = 0; i < 60; i++) { f.move(.5, .5, i * 16); f.step(1 / 60); }
    expect(magnitude(f, .62, .5)).toBeGreaterThan(early);
    f.leave(); for (let i = 0; i < 400; i++) f.step(1 / 60);
    expect(f.active).toBe(false);
  });

  it('moves no geometry for Reveal and writes a GPU spotlight', () => {
    const f = new WaterSurface(1); f.configure('reveal', .6, .4);
    f.move(.4, .6, 0); for (let i = 0; i < 30; i++) f.step(1 / 60);
    const v = [0, 0, 0]; f.sample(.4, .6, v);
    expect(v[0]).toBe(0); expect(v[1]).toBe(0); expect(v[2]).toBeGreaterThan(.5);
    expect(f.spotlight![0]).toBeCloseTo(.4, 2);
    expect(f.refraction.focus[2]).toBeGreaterThan(.3);
  });
});

describe('hover scope', () => {
  const image = (w: number, h: number, paint: (x: number, y: number) => [number, number, number, number]) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(paint(x, y), (y * w + x) * 4);
    return data;
  };
  const disc = (x: number, y: number) => Math.hypot(x - 32, y - 24) < 12;

  it('reads the subject from source alpha, softly at the edge', () => {
    const g = buildHoverGuide(image(64, 48, (x, y) => disc(x, y) ? [200, 90, 40, 255] : [0, 0, 0, 0]), 64, 48);
    expect(g.key).toBe('alpha');
    expect(guideAt(g, 'subject', .5, .5)).toBeGreaterThan(.95);
    expect(guideAt(g, 'subject', .02, .02)).toBeLessThan(.05);
    const edge = g.subject[24 * 64 + 44];
    expect(edge).toBeGreaterThan(.05); expect(edge).toBeLessThan(.95);
  });

  it('keys an opaque subject on a plain ground by its distance from the ground tone', () => {
    const g = buildHoverGuide(image(64, 48, (x, y) => disc(x, y) ? [230, 230, 230, 255] : [8, 8, 8, 255]), 64, 48);
    expect(g.key).toBe('ground');
    expect(scopeWeight('subject', guideAt(g, 'subject', .5, .5), g.key)).toBeGreaterThan(.9);
    expect(scopeWeight('outside', guideAt(g, 'subject', .5, .5), g.key)).toBeLessThan(.1);
  });

  it('acts everywhere on a busy photo rather than guessing a subject', () => {
    const g = buildHoverGuide(image(64, 48, (x, y) => { const v = (x * 37 + y * 91) % 255; return [v, 255 - v, v, 255]; }), 64, 48);
    expect(g.key).toBe('none');
    for (const scope of ['all', 'subject', 'outside'] as const) expect(scopeWeight(scope, .3, g.key)).toBe(1);
  });

  it('multiplies a drawn mask into the subject', () => {
    const mask = new Float32Array(64 * 48).map((_, i) => (i % 64) < 32 ? 1 : 0);
    const g = buildHoverGuide(image(64, 48, () => [120, 120, 120, 255]), 64, 48, mask);
    expect(guideAt(g, 'subject', .2, .5)).toBeGreaterThan(.9);
    expect(guideAt(g, 'subject', .8, .5)).toBeLessThan(.1);
  });
});

describe('hover catalog', () => {
  it('maps retired IDs to their closest current effect', () => {
    expect(resolveSurfaceHover('rake')).toBe('silk');
    expect(normalizeStudioSettings({ hover: { effect: 'rake' } }).hover.effect).toBe('silk');
    expect(SURFACE_HOVERS.some(h => (h.value as string) === 'rake')).toBe(false);
    expect(resolveSurfaceHover('nope')).toBeUndefined();
  });

  it('round-trips scope and decay and leaves defaults out of saved settings', () => {
    const state = normalizeStudioSettings({ hover: { effect: 'loupe', scope: 'subject', decay: .8 } });
    expect(state.hover.scope).toBe('subject'); expect(state.hover.decay).toBe(.8);
    expect(serializeStudioSettings(normalizeStudioSettings({}))).not.toContain('scope');
    expect(normalizeStudioSettings({ hover: { scope: 'sideways' as never } }).hover.scope).toBeUndefined();
  });
});
