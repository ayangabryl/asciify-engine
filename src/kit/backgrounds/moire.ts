import type { BackgroundPreset } from '../background';
import { mountCanvas } from './canvas';
import { renderMaterial, type MaterialSample } from './material';

const sample: MaterialSample = (u, v, aspect, t) => {
  const angle = .12 + .06 * Math.sin(t * .1);
  const first = Math.sin(u * 68);
  const second = Math.sin((u * Math.cos(angle) + v * Math.sin(angle)) * 68);
  return Math.pow((first + second + 2) / 4, 3) * .8;
};

/** Two fine line fields overlap into broad, shifting bands. */
export const moire: BackgroundPreset = {
  id: 'moire', name: 'Moiré', description: 'Two fine line fields overlap into broad, shifting bands.', cellSize: 12, speed: 1, cursor: false,
  mount: context => mountCanvas(context, (ctx, w, h, t, _mouse, o) =>
    renderMaterial(sample, ctx, w, h, t, { ditherStrength: o.ditherStrength, fontSize: o.fontSize, chars: o.chars, lightMode: o.lightMode, color: o.ink })),
};
