import type { GlyphFieldOptions } from '../field';
import { handle, mountSurface, styleKeeper, type KitHandle, type KitOptions, type Surface } from './core';
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

/** Ms every change takes to develop, whenever it arrives: a preview, the final image, or a reset to the ground. */
const DEV = 680, SEED = 3.1, BLUR0 = 12;
/** Share of image over ground, and the blur left on it, for each preview and the final image. */
const DEVELOP = { preview: [{ k: 0.55, blur: 6 }, { k: 0.8, blur: 2.5 }], final: { k: 1, blur: 0 } };
/** Between updates a preview keeps sharpening toward this share of its blur, so a slow provider never leaves the frame still. */
const SETTLE = 0.45, SETTLE_MS = 1600;
/** The photo fades in once the characters nearly hold the final image, and back out over them on a new request, on one curve. */
const PHOTO = 560, PHOTO_OUT = 440;
interface Layer { img: ImageBitmap | HTMLImageElement | null; k: number; blur: number; mix?: number }
/** Sine in-out: every develop leaves and lands at rest, so back-to-back updates join without a kink. */
const ease = (k: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, k)));

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
  const view = { from: { img: null, k: 0, blur: BLUR0 } as Layer, to: { img: null, k: 0, blur: BLUR0 } as Layer, at: -1e6 };
  const photo = () => (state.current.image === undefined ? element.querySelector('img') : state.current.image);
  const look = (): GlyphFieldOptions => ({ blend: 'coarse',
    mark: 'glyph', charset: ' .:-=+*#%@', font: '"Geist", Arial, sans-serif', fontWeight: 500, cellSize: 7, cellAspect: 0.8, glyphScale: 0.8,
    contrast: 1.4, drift: 0.5, speed: 0.6, hover: 'trail', trail: { strength: 0.9, radius: 0.35 }, ...state.current.look,
  });

  const layersAt = (now: number, still: boolean): Layer[] => {
    const e = still ? 1 : ease((now - view.at) / DEV);
    const settle = phase === 'generating' && !still && view.to.img ? 1 - SETTLE * (1 - Math.exp(-Math.max(0, now - view.at) / SETTLE_MS)) : 1;
    const blur = (view.from.blur + (view.to.blur - view.from.blur) * e) * settle;
    // One share of image over the ground, eased; the incoming picture is laid over the outgoing one by `mix`, so the total never jumps.
    const k = (view.from.img ? view.from.k : 0) + ((view.to.img ? view.to.k : 0) - (view.from.img ? view.from.k : 0)) * e;
    const img = view.to.img ?? view.from.img;
    return img ? [{ img: view.from.img, k, blur, mix: 1 }, { img: view.to.img, k, blur, mix: view.from.img ? e : 1 }].filter(l => l.img) : [];
  };
  const develop = (img: Layer['img'], k: number, blur: number) => {
    const now = performance.now(), e = surface?.still() ? 1 : ease((now - view.at) / DEV), [a] = layersAt(now, !!surface?.still());
    // A develop that lands mid-way through another carries on from the picture that already dominates.
    view.from = { img: (e >= 0.5 ? view.to.img : view.from.img) ?? view.to.img ?? view.from.img, k: a?.k ?? 0, blur: a?.blur ?? BLUR0 };
    view.to = { img, k, blur };
    view.at = now;
    surface?.kick();
  };

  surface = mountSurface({
    host: element,
    layer: 'under',
    look,
    ink: () => state.current.ink ?? '--ascii-ink-strong',
    kit: state,
    reducedMotion: () => state.current.reducedMotion,
    resolution: (w, h) => { const W = Math.min(480, Math.max(2, Math.round(w))); return [W, Math.max(2, Math.round((W * h) / Math.max(1, w)))]; },
    onFail: () => { surface = null; styles.restore(); },
    paint: ({ pen, width: W, height: H, now, still }) => {
      const running = phase === 'generating', t = still ? 0 : (now - start) / 1000;
      if (running && state.current.elapsed) state.current.elapsed.textContent = elapsedLabel(now - start);
      // While a request runs the ground breathes on a slow, uneven beat, so a long wait never reads as a loop.
      const breathe = running && !still ? 1 + 0.12 * Math.sin(t * 2.1) * (0.7 + 0.3 * Math.sin(t * 0.37)) : 1;
      // The ground's grain is fixed to the frame, not its pixels: 24 noise cells across at any size.
      const nw = 24, nh = Math.max(2, Math.ceil((24 * H) / Math.max(1, W)));
      if (noise.width !== nw || noise.height !== nh) { noise.width = nw; noise.height = nh; }
      driftNoise(noise, SEED + (running ? t * 0.55 : 0), 0.35);
      const layers = layersAt(now, still);
      const shown = Math.min(1, layers[0]?.k ?? 0);
      pen.imageSmoothingEnabled = true;
      pen.globalAlpha = Math.max(0, 1 - shown);
      pen.filter = `brightness(${1.7 * breathe})`;
      pen.drawImage(noise, 0, 0, W, H);
      for (const { img, k, blur, mix = 1 } of layers) {
        if (!img || k <= 0 || mix <= 0) continue;
        // Cropped like a cover photo at 50% 45%.
        const iw = img.width, ih = img.height, sh = Math.min(ih, (iw * H) / W), sw = Math.min(iw, (ih * W) / H);
        pen.globalAlpha = Math.min(1, k * 1.25) * mix;
        pen.filter = `brightness(1.3) blur(${(blur * W) / 480}px)`;
        pen.drawImage(img, (iw - sw) / 2, Math.max(0, (ih - sh) * 0.45), sw, sh, 0, 0, W, H);
      }
      // While it runs, the drifting ground stays faintly over a preview, so the image keeps moving until the final lands.
      const veil = running && !still ? 0.6 * Math.min(1, shown) * (1 - Math.max(0, shown - 0.8) / 0.2) : 0;
      if (veil > 0.01) {
        pen.globalCompositeOperation = 'lighter';
        pen.globalAlpha = veil;
        pen.filter = `brightness(${0.9 * breathe})`;
        pen.drawImage(noise, 0, 0, W, H);
        pen.globalCompositeOperation = 'source-over';
      }
      pen.filter = 'none'; pen.globalAlpha = 1;
      return running || now - view.at < DEV;
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
    // The characters already hold the image, so the photo crossfades in on an even curve; the house curve's fast start reads as a pop.
    styles.set(img, 'transition', surface.still() ? 'none' : `opacity ${on ? PHOTO : PHOTO_OUT}ms cubic-bezier(.45, 0, .25, 1)`);
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
    develop(null, 0, BLUR0);
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
      // The photo starts in while the characters are still settling on the final, so the hand-off has no hold.
      await wait(still ? 0 : DEV * 0.8);
      if (!alive()) return phase;
      move('done');
      showPhoto(true);
      surface?.kick();
    } catch (error) {
      if (!alive()) return phase;
      develop(null, 0, BLUR0);
      await wait(still ? 0 : DEV / 2);
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
    reset() { request++; develop(null, 0, BLUR0); move('idle'); showPhoto(false); },
    get state() { return phase; },
  }, () => {
    request++;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    delete element.dataset.state;
    element.removeAttribute('aria-busy');
    styles.restore();
  });
}
