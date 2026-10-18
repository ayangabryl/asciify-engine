import { scenePreset } from './gpu';

/** Two fine ring grids from slowly orbiting centres; where they cross, broad moiré bands open and close. */
export const interference = scenePreset({
  id: 'interference', name: 'Interference', description: 'Two fine ring grids from slowly orbiting centres; where they cross, moiré bands open and close.',
  cellSize: 11, scene: 'interference', charset: ' .:-=+*#', hover: 'lantern',
});
