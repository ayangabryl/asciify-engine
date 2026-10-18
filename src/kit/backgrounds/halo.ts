import { scenePreset } from './gpu';

/** A corona breathes slowly round the middle of the page, shaped to the stage (wide on desktop, tall on a phone); the centre stays empty. */
export const halo = scenePreset({
  id: 'halo', name: 'Halo', description: 'A corona breathes slowly round the middle, its rays turning; the centre stays empty for a headline.',
  cellSize: 11, scene: 'halo', charset: ' .·:-=+*', hover: 'lantern', middle: false, feather: 0.12,
});
