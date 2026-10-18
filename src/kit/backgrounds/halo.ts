import { scenePreset } from './gpu';

/** A corona breathes slowly round the middle of the page, its rays turning; the centre stays empty for a headline. */
export const halo = scenePreset({
  id: 'halo', name: 'Halo', description: 'A corona breathes slowly round the middle, its rays turning; the centre stays empty for a headline.',
  cellSize: 11, scene: 'halo', charset: ' .·:-=+*', hover: 'lantern', middle: false, feather: 0.12,
});
