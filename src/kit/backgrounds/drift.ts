import { clearOf } from '../background';
import { FIELD_GRAPHITE, narrow, scenePreset } from './gpu';

/** Characters that drift slowly in broad lobes and stay clear around your content. `mark: 'dot'` draws them as a halftone. */
export const drift = scenePreset({
  id: 'drift', name: 'Drift', description: 'Characters that drift slowly in broad lobes and stay clear around your content.',
  cellSize: 11, scene: 'drift', charset: ' .:-=+*#', hover: 'trail', graphite: FIELD_GRAPHITE, middle: false, feather: 0.2,
  tune: (s) => ({
    scale: narrow() ? (s.mark === 'dot' ? 1.8 : 1.6) : 1, brightness: s.mark === 'dot' ? 0 : 0.05, blend: 'auto',
    lantern: { radius: 0.16, strength: 0.35, trail: 0.6, follow: 9 }, trail: { strength: 0.9, radius: s.mark === 'dot' ? 0.4 : 0.32 },
    ...(s.clear ? { clear: clearOf(s, { padding: 32, feather: 0.2, shape: 'rect' }) } : {}),
  }),
});
