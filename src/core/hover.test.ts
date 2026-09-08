import { describe, expect, it } from 'vitest';
import { advanceHover, createHoverState } from './hover';
import { computeHoverEffect } from './animation';

describe('cursor motion', () => {
  it('follows the same motion at 60 and 120 Hz', () => {
    const sample = (hz: number) => {
      const state = createHoverState();
      advanceHover(state, { x: 0.1, y: 0.5 }, 0);
      for (let index = 1; index <= hz; index++) advanceHover(state, { x: 0.8, y: 0.5 }, index * 1000 / hz);
      return state;
    };
    expect(sample(60).x).toBeCloseTo(sample(120).x, 5);
    expect(sample(60).intensity).toBeCloseTo(sample(120).intensity, 5);
  });
  it('bounds the trail and releases it after leaving', () => {
    const state = createHoverState();
    for (let i = 0; i < 300; i++) advanceHover(state, { x: 0.5 + Math.sin(i / 5) * 0.3, y: 0.5 }, i * 17);
    expect(state.points.length).toBeLessThanOrEqual(12);
    expect(state.points.length).toBeGreaterThan(0);
    for (let i = 300; i < 500; i++) advanceHover(state, null, i * 17);
    expect(advanceHover(state, null, 8500)).toBeNull();
    expect(state.points).toHaveLength(0);
  });
  it('keeps a wake at the old pointer position', () => {
    const fx = computeHoverEffect(0.2, 0.5, 0.9, 0.5, 1, 0.7, 10, 18, 'trail', 0.18, 'circle',
      [{ x: 0.2, y: 0.5, intensity: 0.8, vx: 0.6, vy: 0 }], 16 / 9);
    expect(fx.proximity).toBeGreaterThan(0);
    expect(fx.offsetX).toBeGreaterThan(0);
    expect(Number.isFinite(fx.offsetY)).toBe(true);
  });
});
