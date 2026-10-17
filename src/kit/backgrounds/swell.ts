import type { BackgroundPreset } from '../background';
import { FIELD_GRAPHITE, hoverOf, mountField, narrow } from './gpu';

/** A fine dot grid that swells in slow rolling waves, quiet in the middle; dots rise under the pointer. `cellSize` is the dot spacing. */
export const swell: BackgroundPreset = {
  id: 'swell', name: 'Swell', description: 'A fine dot grid that swells in slow rolling waves, quiet in the middle.', cellSize: 10, speed: 1, cursor: true, opacity: 0.6,
  mount: context => mountField(context, s => ({
    scene: 'swell', mark: 'dot', color: 'ink', shade: 0, background: 'transparent', vignette: 0, speed: s.speed, maxPixelRatio: 2,
    scale: narrow() ? 1.5 : 1, cellSize: s.cellSize, cellAspect: 1, dotScale: 0.68,
    // Waves peak at 0.62 of full tone, so the pointer has headroom to swell dots past the crests.
    contrast: 0.62, brightness: -0.19,
    hover: hoverOf(s, 'lantern'), lantern: { radius: 0.12, strength: 0.5, trail: 1, follow: 8 }, trail: { strength: 0.7, radius: 0.35 },
    clear: s.clear
      ? { element: s.clear, padding: 0, feather: 0.3, shape: 'ellipse' }
      : { x: 0.18, y: 0.2, width: 0.64, height: 0.6, feather: 0.3, shape: 'ellipse' },
  }), FIELD_GRAPHITE),
};
