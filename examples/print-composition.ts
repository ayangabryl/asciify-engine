import { createComposition } from './studio-composition.js';

/** Live image, saved controls, and independent PNG/MP4 export in one reusable component. */
export async function createLivingPrint(canvas: HTMLCanvasElement, source: File | string, signal?: AbortSignal) {
  const composition = await createComposition(canvas, source, signal);
  composition.update({
    style: 'engraving', cellSize: 7, colorMode: 'accent', ink: '#becbbe',
    print: { angle: -35, weight: 1.1, roughness: .3 },
    backdrop: { color: '#101810' },
    motion: { type: 'sheen', speed: .5, amount: .4 },
    hover: { effect: 'water', radius: .4, strength: .5 },
  });
  // On unmount, call the returned destroy(). Export owns independent media.
  return composition;
}
