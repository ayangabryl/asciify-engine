import type { GlyphFieldOptions } from '../field';
import { handle, house, mountSurface, styleKeeper, type KitHandle, type KitOptions, type Surface } from './core';
import { driftNoise } from './decode';

/** One update from an image provider. Either may be a Blob or a URL. */
export interface ImageUpdate { preview?: Blob | string; final?: Blob | string }
export type ImageStream = AsyncIterable<ImageUpdate> | (() => AsyncIterable<ImageUpdate>);
export type GenerateState = 'idle' | 'generating' | 'done' | 'failed';

export interface ImageGenerateOptions extends KitOptions {
  /** Starts generating straight away. A function is called again by `run()` for each new request. */
  stream?: ImageStream;
  /** The photo that crossfades in over the field. Default: the first `<img>` inside the element. */
  image?: HTMLImageElement | null;
  /** Writes the elapsed time while generating, such as `4.2s`. */
  elapsed?: HTMLElement | null;
  /** Called on every state change. */
  onState?: (state: GenerateState, error?: unknown) => void;
}

export interface ImageGenerateHandle extends KitHandle<ImageGenerateOptions> {
  /** Starts a request (a finished image dissolves back into the ground first). Resolves with the final state. */
  run(stream?: ImageStream): Promise<GenerateState>;
  /** Abandons a running request and returns to the idle ground. */
  reset(): void;
  readonly state: GenerateState;
}

const STEP = 280, SEED = 3.1;
/** Share of image over ground, and the blur left on it, for each preview and the final image. */
const DEVELOP = { preview: [{ k: 0.5, blur: 9 }, { k: 0.78, blur: 4 }], final: { k: 1, blur: 0 } };
interface Layer { img: ImageBitmap | HTMLImageElement | null; k: number; blur: number }

export const elapsedLabel = (ms: number) => {
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

const toImage = async (src: Blob | string): Promise<ImageBitmap | HTMLImageElement> => {
  if (typeof createImageBitmap === 'function') return createImageBitmap(typeof src === 'string' ? await (await fetch(src)).blob() : src);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = typeof src === 'string' ? src : URL.createObjectURL(src);
  await img.decode();
  return img;
};

/**
 * An image being generated: the field drifts with an elapsed clock, each streamed preview develops in a step sharper,
 * then the final image, and the photo crossfades in. Works with any provider that can be wrapped as an async iterable.
 */
export function imageGenerate(element: HTMLElement, options: ImageGenerateOptions = {}): ImageGenerateHandle {
  const state = { current: { ...options } };
  const styles = styleKeeper();
  const noise = document.createElement('canvas');
  let phase: GenerateState = 'idle', start = 0, request = 0, objectUrl = '', surface: Surface | null = null;
  const view = { from: { img: null, k: 0, blur: 12 } as Layer, to: { img: null, k: 0, blur: 12 } as Layer, at: -1e6 };
  const photo = () => (state.current.image === undefined ? element.querySelector('img') : state.current.image);
  const look = (): GlyphFieldOptions => ({
    mark: 'glyph', charset: ' .:-=+*#%@', font: '"Geist", Arial, sans-serif', fontWeight: 500, cellSize: 7, cellAspect: 0.8, glyphScale: 0.8,
    contrast: 1.4, drift: 0.5, speed: 0.6, hover: 'trail', trail: { strength: 0.9, radius: 0.35 }, ...state.current.look,
  });

  const layersAt = (now: number, still: boolean): Layer[] => {
    const e = still ? 1 : house(Math.min(1, Math.max(0, (now - view.at) / STEP)));
    const blur = view.from.blur + (view.to.blur - view.from.blur) * e;
    return [{ ...view.from, k: view.from.k * (1 - e), blur }, { ...view.to, k: view.from.k + (view.to.k - view.from.k) * e, blur }];
  };
  const develop = (img: Layer['img'], k: number, blur: number) => {
    const now = performance.now(), [a, b] = layersAt(now, !!surface?.still());
    view.from = { img: b.img ?? a.img, k: a.k + b.k, blur: b.blur };
    view.to = { img, k, blur };
    view.at = now;
    surface?.kick();
  };

  surface = mountSurface({
    host: element,
    layer: 'under',
    look,
    ink: () => state.current.ink ?? '--ascii-ink-strong',
    reducedMotion: () => state.current.reducedMotion,
    resolution: (w, h) => { const W = Math.min(480, Math.max(2, Math.round(w))); return [W, Math.max(2, Math.round((W * h) / Math.max(1, w)))]; },
    onFail: () => { surface = null; styles.restore(); },
    paint: ({ pen, width: W, height: H, now, still }) => {
      const running = phase === 'generating', t = still ? 0 : (now - start) / 1000;
      if (running && state.current.elapsed) state.current.elapsed.textContent = elapsedLabel(now - start);
      // While a request runs the ground breathes on a slow, uneven beat, so a long wait never reads as a loop.
      const breathe = running && !still ? 1 + 0.12 * Math.sin(t * 2.1) * (0.7 + 0.3 * Math.sin(t * 0.37)) : 1;
      const nw = Math.max(2, Math.round(W / 20)), nh = Math.max(2, Math.ceil(H / 20));
      if (noise.width !== nw || noise.height !== nh) { noise.width = nw; noise.height = nh; }
      driftNoise(noise, SEED + (running ? t * 0.55 : 0), 0.35);
      const layers = layersAt(now, still);
      const shown = Math.min(1, layers.reduce((sum, layer) => sum + (layer.img ? layer.k : 0), 0));
      pen.imageSmoothingEnabled = true;
      pen.globalAlpha = Math.max(0, 1 - shown);
      pen.filter = `brightness(${1.7 * breathe})`;
      pen.drawImage(noise, 0, 0, W, H);
      for (const { img, k, blur } of layers) {
        if (!img || k <= 0) continue;
        // Cropped like a cover photo at 50% 45%.
        const iw = img.width, ih = img.height, sh = Math.min(ih, (iw * H) / W), sw = Math.min(iw, (ih * W) / H);
        pen.globalAlpha = Math.min(1, k * 1.25);
        pen.filter = `brightness(1.3) blur(${blur}px)`;
        pen.drawImage(img, (iw - sw) / 2, Math.max(0, (ih - sh) * 0.45), sw, sh, 0, 0, W, H);
      }
      pen.filter = 'none'; pen.globalAlpha = 1;
      return running || now - view.at < STEP;
    },
  });

  const move = (next: GenerateState, error?: unknown) => {
    phase = next;
    element.dataset.state = next;
    element.setAttribute('aria-busy', String(next === 'generating'));
    state.current.onState?.(next, error);
  };
  const showPhoto = (on: boolean) => {
    const img = photo();
    if (!img || !surface) return;
    styles.set(img, 'transition', surface.still() ? 'none' : `opacity ${STEP}ms cubic-bezier(.16, 1, .3, 1)`);
    styles.set(img, 'opacity', on ? '1' : '0');
  };
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const show = (src: Blob | string) => {
    const img = photo();
    if (!img) return;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = typeof src === 'string' ? '' : URL.createObjectURL(src);
    img.src = objectUrl || (src as string);
    if (!surface) styles.set(img, 'visibility', 'visible');
  };

  const run = async (stream: ImageStream | undefined = state.current.stream): Promise<GenerateState> => {
    if (!stream) return phase;
    const id = ++request;
    const alive = () => id === request;
    const still = !!surface?.still();
    start = performance.now();
    move('generating');
    showPhoto(false);
    develop(null, 0, 12);
    let previews = 0;
    try {
      for await (const update of typeof stream === 'function' ? stream() : stream) {
        if (!alive()) return phase;
        const src = update.final ?? update.preview;
        if (!src) continue;
        if (update.final) {
          show(update.final);
          if (surface) develop(await toImage(update.final), DEVELOP.final.k, DEVELOP.final.blur);
          break;
        }
        // Without the field the previews go straight into the photo, so the frame still shows progress.
        if (!surface) { show(update.preview!); continue; }
        const stage = DEVELOP.preview[Math.min(previews++, DEVELOP.preview.length - 1)];
        develop(await toImage(update.preview!), stage.k, stage.blur);
      }
      await wait(still ? 0 : STEP);
      if (!alive()) return phase;
      move('done');
      showPhoto(true);
      surface?.kick();
    } catch (error) {
      if (!alive()) return phase;
      develop(null, 0, 12);
      await wait(still ? 0 : STEP);
      move('failed', error);
    }
    return phase;
  };

  {
    const img = photo();
    // An <img> with no source yet would show the browser's broken-image icon in the fallback.
    if (img) styles.set(img, surface ? 'opacity' : 'visibility', surface ? '0' : img.getAttribute('src') ? 'visible' : 'hidden');
  }
  if (state.current.stream) void run();

  return handle(() => surface, state, () => surface?.refresh(), {
    run,
    reset() { request++; develop(null, 0, 12); move('idle'); showPhoto(false); },
    get state() { return phase; },
  }, () => {
    request++;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    delete element.dataset.state;
    element.removeAttribute('aria-busy');
    styles.restore();
  });
}
