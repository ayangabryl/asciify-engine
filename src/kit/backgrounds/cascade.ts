import { scenePreset } from './gpu';

/** Streaks fall in three depths: far ones fine, faint and slow, near ones rare, bright and quick. */
export const cascade = scenePreset({
  id: 'cascade', name: 'Cascade', description: 'Streaks fall in three depths: far ones faint and slow, near ones rare, bright and quick.',
  cellSize: 11, scene: 'cascade', charset: ' .:;|', hover: 'lantern', tune: () => ({ blend: 'off' }), middle: { x: 0.22, y: 0.25, width: 0.56, height: 0.5, feather: 0.3, shape: 'ellipse' },
});
