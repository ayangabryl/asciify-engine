/**
 * A full-bleed hero field in your brand's letters, with a poster until the GPU frame is ready
 * and the canvas renderer as the fallback when WebGL2 is unavailable.
 */
import { isGlyphFieldSupported, mountGlyphField, type GlyphField } from 'asciify-engine/field';

export function mountBrandField(host: HTMLElement, word: string, video: string, poster: string): () => void {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
  const still = new Image();
  still.src = poster;
  still.alt = '';
  still.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:opacity .3s';
  host.append(canvas, still);

  let field: GlyphField | null = null;
  if (isGlyphFieldSupported()) {
    try {
      field = mountGlyphField(canvas, {
        source: video,
        charset: ' .,:-+' + word.toUpperCase(),
        cellSize: 12,
        cellAspect: 0.8,
        font: 'Inter, Arial, sans-serif',
        color: 'ink',
        ink: '#f3ba32',
        shade: 1,
        vignette: 0.35,
        fluid: { radius: 0.08, refraction: 0.03, glow: 0.6 },
        interactionTarget: host,
        label: `${word}, drawn in characters`,
      });
      void field.ready.then(() => { still.style.opacity = '0'; });
    } catch {
      field = null;
    }
  }

  return () => {
    field?.destroy();
    canvas.remove();
    still.remove();
  };
}
