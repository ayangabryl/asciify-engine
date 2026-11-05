import { mountFieldInWorker } from './field-offscreen';
import { mountGlyphField as mountHere, type GlyphField, type GlyphFieldOptions } from './glyph-field';

/**
 * Mounts a glyph field on `canvas`: on the page, or with `worker: true` in a worker where the browser and the options allow
 * (see `GlyphFieldOptions.worker`).
 */
export function mountGlyphField(canvas: HTMLCanvasElement, options: GlyphFieldOptions = {}): GlyphField {
  if (options.worker) {
    const field = mountFieldInWorker(canvas, options);
    if (field) return field;
  }
  return mountHere(canvas, options);
}
