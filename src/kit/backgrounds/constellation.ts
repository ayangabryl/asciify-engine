import { scenePreset } from './gpu';

/** Points wander in their own cells, and neighbours close enough are linked by fine lines that come and go. */
export const constellation = scenePreset({
  id: 'constellation', name: 'Constellation', description: 'Points wander and neighbours close enough are linked by fine lines that come and go.',
  cellSize: 11, scene: 'constellation', charset: ' .·:+*#', hover: 'lantern', tune: () => ({ blend: 'off' }),
});
