import type { GlyphFieldOptions } from '../field';
import { clamp, handle, house, mountSurface, resolveColor, srOnly, styleKeeper, type KitHandle, type KitOptions, type Surface } from './core';

/** A frame to morph through: an image URL or element, a canvas, a video, or a function that draws white-on-black each frame. */
export type MorphSource = string | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement | ((pen: CanvasRenderingContext2D, w: number, h: number, now: number) => void);

export interface MorphFieldOptions extends KitOptions {
  /** The frames, in order. A function source animates every frame (a turning scene); the others are stills or video. */
  sources: MorphSource[];
  /** Ms each frame holds before the next morphs in. Default 4200. */
  hold?: number;
  /** Ms a morph takes. Default 750. */
  transition?: number;
  /**
   * A fine grid of small square dots on the element's ground under the stripes, as a printed hero's: `true` for the ink at 55%, or a CSS colour or
   * token. Set as the element's background image (restored on destroy). Default false.
   */
  grid?: boolean | string;
  /** Cycle through the frames on its own. Default true; off under reduced motion. */
  autoplay?: boolean;
  /** `cover` fills the element, cropping; `contain` fits inside it. Default `cover`. */
  fit?: 'cover' | 'contain';
  /** `under` sits below the element's content (a hero), `over` above it. Default `under`. */
  layer?: 'under' | 'over';
  /** Called as each morph starts, with the frame it is heading to: keep a caption or a counter ("2/5") in step. */
  onChange?: (index: number) => void;
  /** Read to assistive technology. Without one the field is decoration. */
  label?: string;
}

export interface MorphFieldHandle extends KitHandle<MorphFieldOptions> {
  /** Morphs to the next frame. */
  next(): void;
  /** Morphs to frame `index`. */
  go(index: number): void;
  /** The frame showing, or being morphed to. */
  readonly index: number;
}

const DEFAULTS = { hold: 4200, transition: 750, autoplay: true, fit: 'cover' as const, layer: 'under' as const, grid: false as boolean | string };

type Loaded = HTMLImageElement | HTMLCanvasElement | HTMLVideoElement | ((pen: CanvasRenderingContext2D, w: number, h: number, now: number) => void);
const size = (s: Exclude<Loaded, (...a: never[]) => void>) =>
  'videoWidth' in s ? [s.videoWidth, s.videoHeight] : 'naturalWidth' in s ? [s.naturalWidth, s.naturalHeight] : [s.width, s.height];

/** Draws one source fitted into w x h. Returns false when it has nothing to draw yet (an image still loading). Exported for tests. */
export function drawMorphSource(pen: CanvasRenderingContext2D, source: Loaded, w: number, h: number, now: number, fit: 'cover' | 'contain') {
  if (typeof source === 'function') { source(pen, w, h, now); return true; }
  const [sw, sh] = size(source);
  if (!sw || !sh) return false;
  const k = fit === 'cover' ? Math.max(w / sw, h / sh) : Math.min(w / sw, h / sh);
  pen.drawImage(source, (w - sw * k) / 2, (h - sh * k) / 2, sw * k, sh * k);
  return true;
}

/**
 * Frames that morph into one another as the field's marks: by default diagonal engraved lines whose weight follows the tone, so
 * one picture's stripes thin away as the next one's thicken. Holds each frame, then cross-fades; idles between morphs unless a
 * frame is a video or a drawing function.
 */
export function morphField(element: HTMLElement, options: MorphFieldOptions): MorphFieldHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  const o = () => state.current;
  let loaded: Loaded[] = [], sources = o().sources;
  let index = 0, from = 0, start = -1, timer: ReturnType<typeof setTimeout> | undefined;
  const label = o().label ? srOnly(o().label) : null;
  const load = () => {
    loaded = o().sources.map(source => {
      if (typeof source !== 'string') return source;
      const image = document.createElement('img');
      image.crossOrigin = 'anonymous';
      image.decoding = 'async';
      image.onload = () => surface?.kick();
      image.src = source;
      return image;
    });
  };
  load();
  const look = (): GlyphFieldOptions => ({
    // One bold cut a 6px cell, about 8.5px apart along a row at 45 degrees; the width steps cell by cell with the tone, and a
    // few lit cells catch a twinkling speck.
    mark: 'engraving', markAngle: -45, charset: ' .:-=+*#%@', cellSize: 6, cellAspect: 1, linePitch: 1, lineWeight: 1.1, sparkle: 0.006, contrast: 1.4, levels: 'none', ...o().look,
  });
  const styles = styleKeeper();
  const paintGrid = () => {
    const g = o().grid;
    if (!g) { styles.restore(); return; }
    const ink = typeof g === 'string' ? resolveColor(g, element) ?? g : resolveColor(o().ink ?? '--ascii-ink-strong', element) ?? '#ffffff';
    // Small square dots on a 9px pitch, as an SVG tile so the squares stay crisp at any zoom.
    const rect = `<rect x='3.25' y='3.25' width='2.5' height='2.5' fill='${ink}'${typeof g === 'string' ? '' : " fill-opacity='.55'"}/>`;
    styles.set(element, 'background-image', `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='9' height='9'>${rect}</svg>`)}")`);
    styles.set(element, 'background-size', '9px 9px');
  };
  const animated = (s: Loaded | undefined) => typeof s === 'function' || (!!s && 'videoWidth' in s && !s.paused);

  let surface: Surface | null = null;
  surface = mountSurface({
    host: element,
    kit: state,
    layer: o().layer,
    look,
    ink: () => o().ink ?? '--ascii-ink-strong',
    reducedMotion: () => o().reducedMotion,
    onFail: () => { surface = null; },
    paint: ({ pen, width, height, now, still }) => {
      const count = loaded.length;
      if (!count) return false;
      const k = start < 0 || still ? 1 : house(clamp((now - start) / o().transition));
      const fit = o().fit;
      if (k < 1) {
        drawMorphSource(pen, loaded[from], width, height, now, fit);
        pen.globalAlpha = k;
        pen.fillStyle = '#000';
        pen.fillRect(0, 0, width, height);
        pen.globalAlpha = 1;
        // The incoming frame is laid over a darkened outgoing one, so lines thin away under it rather than doubling.
        pen.globalCompositeOperation = 'lighter';
        pen.globalAlpha = k;
        drawMorphSource(pen, loaded[index], width, height, now, fit);
        pen.globalAlpha = 1;
        pen.globalCompositeOperation = 'source-over';
        return true;
      }
      if (start >= 0) { start = -1; schedule(); }
      const ready = drawMorphSource(pen, loaded[index], width, height, now, fit);
      return !still && (animated(loaded[index]) || !ready);
    },
  });

  const go = (next: number) => {
    const count = loaded.length;
    if (!count) return;
    next = ((next % count) + count) % count;
    if (next === index && start < 0) return;
    clearTimeout(timer);
    from = index; index = next;
    o().onChange?.(index);
    start = surface && !surface.still() ? performance.now() : -1;
    surface?.kick();
    if (start < 0) schedule();
  };
  function schedule() {
    clearTimeout(timer);
    if (!surface || !o().autoplay || surface.still() || loaded.length < 2) return;
    timer = setTimeout(() => go(index + 1), o().hold);
  }
  if (surface) {
    if (label) element.appendChild(label);
    paintGrid();
    schedule();
  }

  return handle(() => surface, state, next => {
    if (next.sources !== sources) { sources = next.sources; load(); index = Math.min(index, Math.max(0, loaded.length - 1)); }
    if (label) label.textContent = next.label ?? '';
    if (surface) paintGrid();
    schedule();
    surface?.refresh();
  }, {
    next: () => go(index + 1),
    go,
    get index() { return index; },
  }, () => { clearTimeout(timer); label?.remove(); styles.restore(); });
}
