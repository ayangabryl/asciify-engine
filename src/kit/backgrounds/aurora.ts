import { scenePreset } from './gpu';

/** Three curtains of light fold slowly across the top of the page, sharp along their hems and soft above them. */
export const aurora = scenePreset({
  id: 'aurora', name: 'Aurora', description: 'Curtains of light fold slowly across the top of the page, sharp along their hems.',
  cellSize: 11, scene: 'aurora', charset: ' .:¦|', hover: 'lantern', tune: () => ({ blend: 'off' }), middle: { x: 0.2, y: 0.42, width: 0.6, height: 0.5, feather: 0.3, shape: 'ellipse' },
});
