import type { BackgroundPreset } from '../background';
import { mountCanvas } from './canvas';
import { renderMaterial, type MaterialSample } from './material';

const sample: MaterialSample = (u, v, aspect, t) => {
  const fold = (u - aspect * .5) * 5.5 + .65 * Math.sin(v * 3.2 + t * .2) + t * .12;
  return Math.pow(.5 + .5 * Math.cos(fold), 7)
    * (.45 + .55 * Math.sin(v * 2.4 + .2));
};

/**
 * Tall folds of light drifting across a quiet ground.
 * @deprecated Retired from the curated set; kept so existing code still runs. `aurora` is the closest current preset.
 */
export const veil: BackgroundPreset = {
  id: 'veil', name: 'Veil', description: 'Tall folds of light drifting across a quiet ground.', cellSize: 12, speed: 1, cursor: false,
  mount: context => mountCanvas(context, (ctx, w, h, t, _mouse, o) =>
    renderMaterial(sample, ctx, w, h, t, { ditherStrength: o.ditherStrength, fontSize: o.fontSize, chars: o.chars, lightMode: o.lightMode, color: o.ink })),
};
