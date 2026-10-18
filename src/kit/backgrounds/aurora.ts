import { scenePreset } from './gpu';

/**
 * Curtains of light at three depths hang from the top in vertical rays, the nearest tallest and brightest, folding slowly.
 * @deprecated Retired from the curated set; kept so existing code still runs. `mesh` is the closest current preset.
 */
export const aurora = scenePreset({
  id: 'aurora', name: 'Aurora', description: 'Curtains of light at three depths hang from the top in tall vertical rays, brightest along their hems.',
  cellSize: 11, scene: 'aurora', charset: ' .:¦|', hover: 'lantern', tune: () => ({ blend: 'off' }), middle: { x: 0.2, y: 0.42, width: 0.6, height: 0.5, feather: 0.3, shape: 'ellipse' },
});
