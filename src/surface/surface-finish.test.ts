import { describe, expect, it } from 'vitest';
import { finishSettings, readSurfaceFinish, withSurfaceFinish } from './surface-finish';
describe('surface finishes', () => {
  it('preserves the legacy edge opt-in and makes Clean an explicit off switch', () => {
    expect(finishSettings()).toEqual({ mode: 1, amount: 0, softness: 0 });
    expect(finishSettings({ edgeEffect: .8 })).toEqual({ mode: 1, amount: .8, softness: 0 });
    expect(finishSettings({ filter: 'clean', edgeEffect: 1 }).amount).toBe(0);
    expect(finishSettings({ filter: 'signal' })).toEqual({ mode: 3, amount: 1, softness: 0 });
    expect(finishSettings({ filter: 'etch', edgeEffect: 5 })).toEqual({ mode: 2, amount: 1, softness: 0 });
  });
  it('bounds Prism softness and keeps other finishes clear', () => {
    expect(finishSettings({ filter: 'prism', edgeSoftness: 5 }).softness).toBe(1);
    expect(finishSettings({ filter: 'prism', edgeSoftness: -1 }).softness).toBe(0);
    expect(finishSettings({ filter: 'prism', edgeSoftness: NaN }).softness).toBe(0);
    expect(finishSettings({ filter: 'clean', edgeSoftness: 1 }).softness).toBe(0);
    expect(finishSettings({ filter: 'etch', edgeSoftness: 1 }).softness).toBe(0);
  });
  it('round-trips preview metadata without overwriting conversion options', () => {
    const options = { fontSize: 3, contrast: .1 };
    const next = withSurfaceFinish(options, { filter: 'prism', edgeEffect: .7, edgeSoftness: .4 });
    expect(readSurfaceFinish(next)).toEqual({ filter: 'prism', edgeEffect: .7, edgeSoftness: .4 });
    expect(next.fontSize).toBe(3); expect(options).toEqual({ fontSize: 3, contrast: .1 });
  });
});
