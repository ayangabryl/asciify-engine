import { asciifyVideo } from 'asciify-engine/core';

/** Copy this into your app. The host should be position: relative; overflow: hidden. */
export function mountMediaBackground(host: HTMLElement, src: string) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
    pointerEvents: 'none', opacity: '0.55',
    maskImage: 'linear-gradient(black, black 65%, transparent)',
  });
  host.prepend(canvas);
  let disposed = false;
  let stop: (() => void) | undefined;
  const ready = asciifyVideo(src, canvas, {
    fitTo: host, objectFit: 'cover', maxRenderDimension: 960, fontSize: 10, fps: 30,
    options: { colorMode: 'accent', accentColor: '#a9b39a',
      hoverEffect: 'trail', hoverStrength: 0.65, hoverRadius: 0.18, hoverColor: '#d4ff00' },
  }).then(cleanup => { if (disposed) cleanup(); else stop = cleanup; })
    .catch(error => { canvas.remove(); throw error; });
  return { ready, destroy() { disposed = true; stop?.(); canvas.remove(); } };
}
