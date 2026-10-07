import { expect, it } from 'vitest';
import { hasAnimatedEffects, hasPatternMotion } from './activity';
import { DITHER_ALGORITHMS, normalizeStudioSettings, STUDIO_STYLES } from './model';
import { MOTION_STYLES } from '../surface/ambient-motion';

it('only animates pattern settings in the dither renderer', () => {
  for(const style of STUDIO_STYLES) for(const motion of ['drift','shimmer'] as const) {
    expect(hasAnimatedEffects(normalizeStudioSettings({style,dither:{motion,algorithm:'bayer4'}}))).toBe(style==='dither');
  }
});
it('zero motion strength lets a still sleep but keeps selected motion settings', () => {
  for(const {mode} of MOTION_STYLES) {
    const state=normalizeStudioSettings({motion:{type:mode,amount:0}});
    expect(hasAnimatedEffects(state)).toBe(false);
    expect(state.motion.type).toBe(mode);
    expect(hasAnimatedEffects(normalizeStudioSettings({motion:{type:mode,amount:.5}}))).toBe(mode!=='none');
  }
});
it('shimmer animates thresholds while diffusion and zero-amount drift remain stationary', () => {
  const drift=new Set(['bayer2','bayer4','bayer8','bayer16','halftone','lines','vertical-lines','diagonal-lines','radial','noise','blue-noise']);
  for(const algorithm of DITHER_ALGORITHMS) {
    expect(hasPatternMotion(normalizeStudioSettings({style:'dither',dither:{algorithm,motion:'drift'}}))).toBe(drift.has(algorithm));
    expect(hasPatternMotion(normalizeStudioSettings({style:'dither',dither:{algorithm,motion:'drift',amount:0}}))).toBe(false);
    expect(hasPatternMotion(normalizeStudioSettings({style:'dither',dither:{algorithm,motion:'shimmer'}}))).toBe(true);
  }
});
it('finishing noise and glitch stay animated without disturbing stationary effects', () => {
  for(const effect of ['grain','dust','glitch','prism','bloom','blur','sharpen','rgbSplit'] as const) {
    expect(hasAnimatedEffects(normalizeStudioSettings({effects:{[effect]:.4}}))).toBe(['grain','dust','glitch'].includes(effect));
  }
});
