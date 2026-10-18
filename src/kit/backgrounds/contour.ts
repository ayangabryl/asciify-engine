import { scenePreset } from './gpu';

/** Survey lines over a slowly shifting terrain, one character wide at any size, every fifth an index line. */
export const contour = scenePreset({
  id: 'contour', name: 'Contour', description: 'Survey lines over a slowly shifting terrain, every fifth an index line.',
  cellSize: 11, scene: 'contour', charset: ' .·-~=', hover: 'lantern',
});
