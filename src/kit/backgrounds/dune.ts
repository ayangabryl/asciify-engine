import type { BackgroundPreset } from '../background';
import { mountCanvas } from './canvas';
import { renderMaterial, type MaterialSample } from './material';

const sample: MaterialSample = (u, v, aspect, t) => {
  const ridge = v * 7 + .55 * Math.sin(u * 2.2 + t * .09) + .22 * Math.sin(u * 4.8 - t * .07);
  const slope = .5 + .5 * Math.sin(ridge);
  const crest = Math.pow(slope, 5);
  return crest * (.35 + .65 * v) + .08 * Math.pow(.5 + .5 * Math.sin(ridge * 17), 3) * slope;
};

/** Layered sand ridges with slow-moving light and fine grain. */
export const dune: BackgroundPreset = {
  id: 'dune', name: 'Dune', description: 'Layered sand ridges with slow-moving light and fine grain.', cellSize: 12, speed: 1, cursor: false,
  mount: context => mountCanvas(context, (ctx, w, h, t, _mouse, o) =>
    renderMaterial(sample, ctx, w, h, t, { ditherStrength: o.ditherStrength, fontSize: o.fontSize, chars: o.chars, lightMode: o.lightMode, color: o.ink })),
};
