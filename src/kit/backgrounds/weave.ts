import type { BackgroundPreset } from '../background';
import { mountCanvas } from './canvas';
import { renderMaterial, type MaterialSample } from './material';

const sample: MaterialSample = (u, v, aspect, t) => {
  const bend = .2 * Math.sin(u * 3 + v * 2 + t * .2);
  const warp = Math.pow(.5 + .5 * Math.sin((u + bend) * 45), 8);
  const weft = Math.pow(.5 + .5 * Math.sin((v - bend * .3) * 50), 10);
  return (.65 * warp + .35 * weft) * (.4 + .6 * Math.sin(v * 2 + .4));
};

/** Interlaced threads with a subtle change in tension. */
export const weave: BackgroundPreset = {
  id: 'weave', name: 'Weave', description: 'Interlaced threads with a subtle change in tension.', cellSize: 12, speed: 1, cursor: false,
  mount: context => mountCanvas(context, (ctx, w, h, t, _mouse, o) =>
    renderMaterial(sample, ctx, w, h, t, { ditherStrength: o.ditherStrength, fontSize: o.fontSize, chars: o.chars, lightMode: o.lightMode, color: o.ink })),
};
