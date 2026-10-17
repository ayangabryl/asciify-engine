import type { BackgroundPreset } from '../background';
import { driftGround, FIELD_GRAPHITE, hoverOf, mountField, narrow } from './gpu';

/** Characters that drift slowly and stay clear around your content, drawn on the GPU. */
export const drift: BackgroundPreset = {
  id: 'drift', name: 'Drift', description: 'Characters that drift slowly and stay clear around your content, drawn on the GPU.', cellSize: 11, speed: 1, cursor: true,
  mount: context => mountField(context, s => ({
    ...driftGround(s, hoverOf(s, 'trail')),
    mark: 'glyph', scale: narrow() ? 1.6 : 1, charset: s.charset ?? ' .:-=+*#', font: '"Geist Mono", ui-monospace, monospace', fontWeight: 400,
    cellSize: s.cellSize, cellAspect: 0.62, glyphScale: 0.86, brightness: 0.05, trail: { strength: 0.9, radius: 0.32 },
  }), FIELD_GRAPHITE),
};
