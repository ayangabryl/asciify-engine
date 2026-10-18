import { FIELD_GRAPHITE, narrow, scenePreset } from './gpu';

/**
 * A fine dot grid that swells in slow rolling waves, quiet in the middle; dots rise under the pointer. `cellSize` is the dot
 * spacing. `mark: 'glyph'` or a `charset` writes the waves in characters, and the page's global look does the same.
 */
export const swell = scenePreset({
  id: 'swell', name: 'Swell', description: 'A fine grid that swells in slow rolling waves, quiet in the middle. Dots by default, or characters.',
  cellSize: 10, opacity: 0.6, scene: 'swell', mark: 'dot', charset: ' .:-=+*#', hover: 'lantern', graphite: FIELD_GRAPHITE,
  tune: () => ({
    scale: narrow() ? 1.5 : 1,
    // Waves peak at 0.62 of full tone, so the pointer has headroom to swell marks past the crests.
    contrast: 0.62, brightness: -0.19, blend: 'auto',
    lantern: { radius: 0.12, strength: 0.5, trail: 1, follow: 8 }, trail: { strength: 0.7, radius: 0.35 },
  }),
});
