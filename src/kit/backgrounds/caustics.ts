import { scenePreset } from './gpu';

/** Light focused by moving water: fine bright lines that fold, part and meet again across the page. */
export const caustics = scenePreset({
  id: 'caustics', name: 'Caustics', description: 'Light focused by moving water: fine bright lines that fold, part and meet again.',
  cellSize: 11, scene: 'caustics', charset: ' .:-=+*#', hover: 'lantern', tune: () => ({ blend: 'off', lantern: { radius: 0.14, strength: 0.22, trail: 0.8, follow: 9 } }),
});
