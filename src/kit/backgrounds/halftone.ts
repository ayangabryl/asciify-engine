import type { BackgroundPreset } from '../background';
import { driftGround, FIELD_GRAPHITE, hoverOf, mountField, narrow } from './gpu';

/** The drifting ground drawn as dots, clear around your content. `cellSize` is the dot spacing. */
export const halftone: BackgroundPreset = {
  id: 'halftone', name: 'Halftone', description: 'The drifting ground drawn as dots, clear around your content.', cellSize: 14, speed: 1, cursor: true,
  mount: context => mountField(context, s => ({
    ...driftGround(s, hoverOf(s, 'lantern')),
    mark: 'dot', scale: narrow() ? 1.8 : 1, cellSize: s.cellSize, cellAspect: 1, dotScale: 0.64, trail: { strength: 0.9, radius: 0.4 },
  }), FIELD_GRAPHITE),
};
