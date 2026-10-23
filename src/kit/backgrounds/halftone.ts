import { clearOf } from '../background';
import { FIELD_GRAPHITE, narrow, scenePreset } from './gpu';

/**
 * The drifting ground drawn as dots, clear around your content. `cellSize` is the dot spacing.
 * @deprecated The same field as `drift`: use `drift` with `mark: 'dot'` (and `cellSize: 14` for this spacing).
 */
export const halftone = scenePreset({
  id: 'halftone', name: 'Halftone', description: 'The drifting ground drawn as dots, clear around your content.',
  cellSize: 14, scene: 'drift', mark: 'dot', charset: ' .:-=+*#', hover: 'lantern', graphite: FIELD_GRAPHITE, middle: false, feather: 0.2,
  tune: (s) => ({
    scale: narrow() ? 1.8 : 1, blend: 'auto', dotScale: 0.64,
    lantern: { radius: 0.16, strength: 0.35, trail: 0.6, follow: 9 }, trail: { strength: 0.9, radius: 0.4 },
    ...(s.clear ? { clear: clearOf(s, { padding: 32, feather: 0.2, shape: 'rect' }) } : {}),
  }),
});
