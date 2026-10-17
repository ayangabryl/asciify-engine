import type { BackgroundPreset } from '../background';
import { mountCanvas } from './canvas';
import { renderMaterial, type MaterialSample } from './material';

const sample: MaterialSample = (u, v, aspect, t) => {
  const elevation = v * 3.2 + .36 * Math.sin(u * 3.4 + t * .18)
    + .19 * Math.cos(u * 6 - v * 2 + t * .12);
  const ridge = .5 + .5 * Math.cos(elevation * Math.PI * 6);
  return Math.pow(ridge, 4) * (.35 + .65 * v);
};

/** Fine topographic lines with a slow, rolling drift. */
export const contour: BackgroundPreset = {
  id: 'contour', name: 'Contour', description: 'Fine topographic lines with a slow, rolling drift.', cellSize: 12, speed: 1, cursor: false,
  mount: context => mountCanvas(context, (ctx, w, h, t, _mouse, o) =>
    renderMaterial(sample, ctx, w, h, t, { ditherStrength: o.ditherStrength, fontSize: o.fontSize, chars: o.chars, lightMode: o.lightMode, color: o.ink })),
};
