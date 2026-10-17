import type { BackgroundPreset } from '../background';
import { mountCanvas } from './canvas';
import { renderMaterial, type MaterialSample } from './material';

const sample: MaterialSample = (u, v, aspect, t) => {
  const grain = u * 48 + 4 * Math.sin(v * 2.6 + t * .08) + 1.5 * Math.sin(v * 7 - u * 2);
  const line = Math.pow(.5 + .5 * Math.sin(grain), 10);
  return line * (.35 + .55 * Math.pow(Math.sin(v * 2 + .4), 2));
};

/** Cut-grain lines follow a slow, sculpted current. */
export const etch: BackgroundPreset = {
  id: 'etch', name: 'Etch', description: 'Cut-grain lines follow a slow, sculpted current.', cellSize: 12, speed: 1, cursor: false,
  mount: context => mountCanvas(context, (ctx, w, h, t, _mouse, o) =>
    renderMaterial(sample, ctx, w, h, t, { ditherStrength: o.ditherStrength, fontSize: o.fontSize, chars: o.chars, lightMode: o.lightMode, color: o.ink })),
};
