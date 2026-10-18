import type { BackgroundPreset } from '../background';
import { hoverOf, mountField, narrow } from './gpu';

/** A word becomes the background, drawn by the GPU with a soft wake. Set it with `text`; `look: { scene: 'orb' }` for the orb. */
export const wordField: BackgroundPreset = {
  id: 'field', name: 'Field', description: 'A word becomes the background, drawn by the GPU with a soft wake.', cellSize: 13, speed: 1, cursor: true,
  mount: context => mountField(context, (s, dark) => ({
    scene: 'flow', levels: 'auto', charset: s.charset ?? ' .,:-+' + s.text.replace(/\s+/g, '').toUpperCase(), font: '"Geist", Arial, sans-serif', fontWeight: 500,
    cellSize: s.cellSize, cellAspect: 0.8, glyphScale: 0.76, color: 'ink', shade: dark ? (narrow() ? 0.1 : 0.4) : 0, background: 'transparent',
    // A phone's tall, narrow stage shows only a slice of the flow: finer shapes and a lift on dark keep the word present.
    contrast: 1.1, scale: narrow() ? 1.6 : 1, brightness: narrow() && dark ? 0.08 : 0, vignette: 0, speed: s.speed, maxPixelRatio: 2,
    hover: hoverOf(s, 'trail'), fluid: { radius: 0.09, refraction: 0.04, glow: 0.7, dissipation: 1.3 },
    lantern: { radius: 0.13, strength: 0.6, trail: 0.5, follow: 11 },
    trail: { strength: 0.9, radius: 0.4 },
  }), { light: '#9a9891', dark: '#7d7b75' }),
};
