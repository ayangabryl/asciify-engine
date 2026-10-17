import type { BackgroundPreset } from '../background';
import { mountCanvas } from './canvas';
import { renderMaterial, type MaterialSample } from './material';

const sample: MaterialSample = (u, v, aspect, t) => {
  const a = u * 2.8 + v * 1.8 + t * .018;
  const b = u * 1.2 - v * 3.2;
  const foldA = Math.abs((a - Math.floor(a)) * 2 - 1);
  const foldB = Math.abs((b - Math.floor(b)) * 2 - 1);
  return Math.pow(Math.min(foldA, foldB), 1.8) * .85;
};

/** Quiet folded planes catch light along their edges. */
export const facet: BackgroundPreset = {
  id: 'facet', name: 'Facet', description: 'Quiet folded planes catch light along their edges.', cellSize: 12, speed: 1, cursor: false,
  mount: context => mountCanvas(context, (ctx, w, h, t, _mouse, o) =>
    renderMaterial(sample, ctx, w, h, t, { ditherStrength: o.ditherStrength, fontSize: o.fontSize, chars: o.chars, lightMode: o.lightMode, color: o.ink })),
};
