import { scenePreset } from './gpu';

/** Four soft lights on slow paths: a gradient mesh written in characters, the whole ramp from empty to dense. */
export const mesh = scenePreset({
  id: 'mesh', name: 'Mesh', description: 'Four soft lights on slow paths: a gradient mesh written in characters.',
  cellSize: 11, scene: 'mesh', charset: ' .:-=+*#%@', hover: 'trail',
});
