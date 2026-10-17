import type { BackgroundPreset } from '../background';
import { mountCanvas } from './canvas';
import { renderMaterial, type MaterialSample } from './material';

const sample: MaterialSample = (u, v, aspect, t) => {
  const a = Math.sin(u * 7 + Math.sin(v * 5 + t * .16));
  const b = Math.cos(v * 8 + Math.cos(u * 4 - t * .12));
  const c = Math.sin((u + v) * 6 - t * .13);
  return Math.pow(Math.max(0, 1 - Math.abs(a + b + c * .5)), 7) * .85;
};

/** Fine pools of light that drift like water across stone. */
export const caustics: BackgroundPreset = {
  id: 'caustics', name: 'Caustics', description: 'Fine pools of light that drift like water across stone.', cellSize: 12, speed: 1, cursor: false,
  mount: context => mountCanvas(context, (ctx, w, h, t, _mouse, o) =>
    renderMaterial(sample, ctx, w, h, t, { ditherStrength: o.ditherStrength, fontSize: o.fontSize, chars: o.chars, lightMode: o.lightMode, color: o.ink })),
};
