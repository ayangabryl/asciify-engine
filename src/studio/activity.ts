import type { StudioSettings } from './model';
const stationaryPatterns = new Set(['none','floyd-steinberg','atkinson','stucki','sierra','sierra-lite','burkes','jarvis']);

/** Hidden settings for another style must not keep a static preview awake. */
export function hasPatternMotion(settings: StudioSettings) {
  return settings.style === 'dither' && (
    settings.dither.motion === 'shimmer' ||
    settings.dither.motion === 'drift' && settings.dither.amount > 0 && !stationaryPatterns.has(settings.dither.algorithm)
  );
}
export function hasAmbientMotion(settings: StudioSettings) {
  return settings.motion.type !== 'none' && (settings.motion.amount ?? 1) > 0;
}
export function hasAnimatedEffects(settings: StudioSettings) {
  return hasAmbientMotion(settings) || hasPatternMotion(settings) ||
    settings.effects.grain > 0 || settings.effects.dust > 0 || settings.effects.glitch > 0;
}
