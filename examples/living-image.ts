import { STUDIO_ANIMATION_PRESETS } from 'asciify-engine/studio';
import { createComposition } from './studio-composition.js';

/** A live still-image composition, with settings persistence and independent export. */
export async function createLivingImage(canvas: HTMLCanvasElement, source: File | string, signal?: AbortSignal) {
  const composition=await createComposition(canvas,source,signal);
  function applyAnimation(id: string) {
    const preset=STUDIO_ANIMATION_PRESETS.find(item=>item.id===id);
    if(!preset)throw new Error(`Unknown animation preset: ${id}`);
    // Partial group updates preserve edgeSafe, the art style, source and finish.
    composition.update({motion:preset.motion,hover:preset.hover});
  }
  applyAnimation('quiet-light');
  return {...composition,applyAnimation};
}
