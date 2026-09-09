import { expect, it } from 'vitest';
import { normalizeStudioSettings } from './model';
import { MOTION_STYLES, sampleAmbient } from '../surface/ambient-motion';

it('restores every retired Studio motion as Off without losing other settings', () => {
  for (const type of ['breathe','wave','reveal','glitch','rainbow','hologram','fire','chrome','ripple','vapor']) {
    const state = normalizeStudioSettings({ motion: { type, speed: 1.4 }, ink: '#e8b900', hover: { effect: 'water' } });
    expect(state.motion).toEqual({ type: 'none', speed: 1.4 });
    expect(state.ink).toBe('#e8b900');
    expect(state.hover.effect).toBe('water');
  }
});
it('loops smoothly with bounded fields and no random frame flicker', () => {
  for (const { mode } of MOTION_STYLES) {
    for (const [x,y] of [[0,0],[.23,.61],[.8,.3],[1,1]]) {
      for (let time=0;time<12;time+=.125) {
        const a=sampleAmbient(mode,x,y,time,[]);
        const b=sampleAmbient(mode,x,y,time+12,[]);
        const next=sampleAmbient(mode,x,y,time+1/60,[]);
        a.forEach((v,i) => { expect(Number.isFinite(v)).toBe(true); expect(v).toBeCloseTo(b[i],8); expect(Math.abs(v-next[i])).toBeLessThan(.25); });
        expect(a[3]).toBeGreaterThanOrEqual(.1-1e-8);
        expect(a[3]).toBeLessThanOrEqual(1);
      }
    }
  }
});
