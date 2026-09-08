import { describe, expect, it } from 'vitest';
import { WaterSurface, surfaceLight } from './water-surface';

const sample = (surface: WaterSurface, x: number, y: number) => {
  const out = [0, 0, 0]; surface.sample(x, y, out); return out;
};

describe('water-surface hero interaction', () => {
  it('bends opposite sides of a stroke in opposite directions rather than translating a patch', () => {
    const surface = new WaterSurface(1.6);
    surface.move(.3, .5); surface.move(.7, .5);
    for (let n = 0; n < 6; n++) surface.step(1 / 60);
    const above = sample(surface, .5, .46), below = sample(surface, .5, .54);
    expect(above[1] * below[1]).toBeLessThan(0);
    expect(Math.abs(above[1])).toBeGreaterThan(.001);
    expect(Math.abs(above[0])).toBeLessThan(Math.abs(above[1]) * .2);
  });
  it('propagates away from the cursor after release and settles to exact zero', () => {
    const surface = new WaterSurface(1.6);
    surface.move(.48, .5); surface.move(.52, .5); surface.step(1 / 60);
    const start = Math.abs(sample(surface, .5, .65)[1]);
    surface.leave();
    for (let n = 0; n < 30; n++) surface.step(1 / 60);
    expect(Math.abs(sample(surface, .5, .65)[1])).toBeGreaterThan(start * 2);
    for (let n = 0; n < 600; n++) surface.step(1 / 60);
    expect(surface.active).toBe(false);
    expect(sample(surface, .5, .5)).toEqual([0, 0, 0]);
  });
  it('has consistent timing at different display rates', () => {
    const surfaces = [30, 60, 120].map(hz => {
      const surface = new WaterSurface();
      surface.move(.3, .5); surface.move(.6, .5);
      for (let n = 0; n < hz; n++) surface.step(1 / hz);
      return sample(surface, .55, .55);
    });
    for (const result of surfaces) for (let n = 0; n < 3; n++) expect(result[n]).toBeCloseTo(surfaces[0][n], 6);
  });
  it('does not stamp entry dots, connect exits or accumulate stationary input', () => {
    const surface = new WaterSurface();
    surface.move(.1, .1); surface.leave(); surface.move(.9, .9);
    for (let n = 0; n < 60; n++) { surface.move(.9, .9); surface.step(1 / 60); }
    expect(surface.active).toBe(false);
  });
  it.each([.45, 1, 2.5])('stays finite and bounded under reversal, frame gaps and clear at aspect %s', aspect => {
    const surface = new WaterSurface(aspect);
    for (let n = 0; n < 40; n++) { surface.move(n % 2 ? .2 : .8, .5); surface.step(n % 8 ? 1 / 60 : 5); }
    for (let y = 0; y <= 10; y++) for (let x = 0; x <= 10; x++) {
      const value = sample(surface, x / 10, y / 10);
      expect(value.every(Number.isFinite)).toBe(true);
      expect(Math.max(...value.map(Math.abs))).toBeLessThanOrEqual(.08);
    }
    surface.clear(); expect(surface.active).toBe(false);
    expect(sample(surface, .5, .5)).toEqual([0, 0, 0]);
    expect([...surface.refraction.pixels.slice(0, 4)]).toEqual([128, 0, 128, 0]);
  });
});

describe('shared fixed-grid illumination', () => {
  it.each(['water', 'light', 'scan', 'none'] as const)('keeps all edges stationary in %s at maximum settings', mode => {
    const surface = new WaterSurface(1.6); surface.configure(mode, 1, 1);
    for (let n = 0; n < 60; n++) {
      surface.move(n % 2 ? .01 : .99, n % 3 ? .02 : .98); surface.step(1 / 60);
      for (const t of [0, .2, .5, .8, 1]) for (const [x, y] of [[0, t], [1, t], [t, 0], [t, 1]]) expect(sample(surface, x, y).slice(0,2).map(Math.abs)).toEqual([0, 0]);
    }
    expect(surface.refraction.pixels.length).toBeLessThanOrEqual(128 * 128 * 4);
  });
  it.each(['light', 'scan'] as const)('%s holds illumination without continuous simulation and fades after exit', mode => {
    const surface = new WaterSurface(); surface.configure(mode, 1, 1); surface.move(.5, .5);
    for (let n = 0; n < 90; n++) surface.step(1 / 60);
    expect(surface.active).toBe(false); expect(surface.hasRefraction).toBe(true);
    expect(sample(surface, .5, .5)[2]).toBeGreaterThan(.9);
    for (let y=0;y<=10;y++) for(let x=0;x<=10;x++) expect(sample(surface,x/10,y/10).slice(0,2)).toEqual([0,0]);
    expect(surface.refraction.strength).toBe(0);
    const before = surface.refraction.focus.slice(); surface.step(1 / 60);
    expect(surface.refraction.focus).toEqual(before);
    surface.leave(); expect(surface.active).toBe(true);
    for (let n = 0; n < 90; n++) surface.step(1 / 60);
    expect(surface.active).toBe(false); expect(sample(surface, .5, .5)).toEqual([0, 0, 0]);
  });
  it('makes Scan a narrow beam with a dim shoulder, distinct from radial Light', () => {
    const surface = new WaterSurface(); surface.configure('scan',1,.2); surface.move(.5,.5);
    for(let i=0;i<90;i++) surface.step(1/60);
    expect(surfaceLight(.5,.5,surface.refraction,1)).toBeGreaterThan(.99);
    expect(surfaceLight(.54,.5,surface.refraction,1)).toBeLessThan(0);
    expect(surfaceLight(.5,.54,surface.refraction,1)).toBeGreaterThan(.9);
  });
  it('clears old effects and rejects off/zero-strength input', () => {
    const surface = new WaterSurface(); surface.move(.3, .5); surface.move(.6, .5); surface.step(1 / 60);
    surface.setMode('light'); expect(surface.active).toBe(false); expect(sample(surface,.5,.5)).toEqual([0,0,0]);
    surface.configure('none',1,1); surface.move(.5,.5); surface.step(1/60); expect(surface.active).toBe(false);
    surface.configure('water',0,1); surface.move(.3,.5); surface.move(.6,.5); surface.step(1/60); expect(surface.active).toBe(false);
  });
});
