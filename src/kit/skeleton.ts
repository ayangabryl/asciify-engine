import type { GlyphFieldOptions } from '../field';
import { easeOut, handle, mountSurface, styleKeeper, type KitHandle, type KitOptions, type Surface } from './core';

export type SkeletonBlock = 'text' | 'photo' | 'avatar';

export interface SkeletonOptions extends KitOptions {
  /** Selector for the placeholder blocks inside the element. `data-block` may name the kind (`text`, `photo`, `avatar`); images default to photo. Default `[data-block]`. */
  blocks?: string;
  /** One shimmer cycle in ms: an eased sweep, then a short rest. Default 1600. */
  shimmer?: number;
  /** Each block resolves over this many ms. Default 420. */
  resolve?: number;
  /** Ms between blocks resolving, unless a block sets `data-delay`. Default 60. */
  stagger?: number;
  /** An image block develops in characters over this many ms. Default 640. */
  develop?: number;
}

export interface SkeletonHandle extends KitHandle<SkeletonOptions> {
  /** The data has landed: each block resolves into its content. Resolves when the last one has. */
  resolve(): Promise<void>;
  /** Back to the shimmering skeleton, for a reload. */
  reset(): void;
  readonly loading: boolean;
}

const DEFAULTS = { blocks: '[data-block]', shimmer: 1600, resolve: 420, stagger: 60, develop: 640 };
const gray = (tone: number) => `rgb(${tone * 255} ${tone * 255} ${tone * 255})`;
// The rest tone and the crest stay in the light end of the charset: dots and dashes, never a wall of # and @.
const REST = 0.24, CREST = 0.54, SWEEP = 0.72, FEATHER = 28;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
/** Where a block stands in its resolve, eased: 0 waiting, 1 handed over. */
const progress = (since: number, delay: number, length: number) => (since < 0 ? 0 : easeOut((since - delay) / length, 3));

/** The kind of a block: its `data-block`, or an image's shape. */
export function blockKind(element: HTMLElement): SkeletonBlock {
  const named = element.dataset.block;
  if (named === 'text' || named === 'photo' || named === 'avatar') return named;
  if (element.tagName === 'IMG' || element.tagName === 'PICTURE' || element.tagName === 'VIDEO') {
    return /^50%|^9999px/.test(getComputedStyle(element).borderTopLeftRadius) ? 'avatar' : 'photo';
  }
  return 'text';
}

/** Placeholder blocks drawn in characters with a shimmer sweeping across; on `resolve()` each block hands over to its content. */
export function skeleton(element: HTMLElement, options: SkeletonOptions = {}): SkeletonHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  const styles = styleKeeper();
  let started = 0, arrived: number | null = null, done: (() => void) | null = null, finished: Promise<void> | null = null, surface: Surface | null = null;
  const look = (): GlyphFieldOptions => ({
    mark: 'glyph', charset: ' .:-=+*#%@', cellSize: 5, cellAspect: 0.62, glyphScale: 0.92,
    font: '"Geist Mono", ui-monospace, monospace', fontWeight: 500, contrast: 1.15, shade: 0.35, ...state.current.look,
  });
  const blocks = () => [...element.querySelectorAll<HTMLElement>(state.current.blocks)].map((el, i) => ({
    el, kind: blockKind(el), delay: el.dataset.delay !== undefined ? Number(el.dataset.delay) : 80 + i * state.current.stagger,
  }));
  const end = () => Math.max(state.current.develop, ...blocks().map(b => b.delay + state.current.resolve));

  const MASK = ['mask-image', '-webkit-mask-image'] as const;
  const hide = () => { for (const { el } of blocks()) { styles.set(el, 'opacity', '0'); for (const m of MASK) el.style.removeProperty(m); } };
  const reveal = (since: number) => {
    for (const { el, kind, delay } of blocks()) {
      const p = progress(since, delay, state.current.resolve);
      styles.set(el, 'opacity', String(kind === 'text' ? Math.min(1, p * 1.6) : p));
      // Words come in behind a feathered edge rather than a hard cut.
      if (kind === 'text') {
        const edge = p * (100 + FEATHER) - FEATHER / 2;
        for (const m of MASK) styles.set(el, m, p >= 1 ? 'none' : `linear-gradient(90deg, #000 ${edge - FEATHER / 2}%, transparent ${edge + FEATHER / 2}%)`);
      }
    }
  };
  const settleAll = () => { styles.restore(); element.removeAttribute('aria-busy'); done?.(); done = null; };

  surface = mountSurface({
    host: element,
    look,
    ink: () => state.current.ink ?? '--ascii-ink-strong',
    kit: state,
    reducedMotion: () => state.current.reducedMotion,
    onFail: () => { surface = null; settleAll(); },
    paint: ({ pen, now, still, box, w }) => {
      if (arrived !== null && still) { settleAll(); return false; }
      const o = state.current, since = arrived === null ? -1 : now - arrived;
      if (arrived !== null && since > end() + 16) { settleAll(); return false; }
      if (arrived !== null) reveal(since);
      // One eased pass, then a rest off the far edge, so the shimmer breathes instead of scrolling.
      const cycle = still ? 0.4 : (((now - started) / o.shimmer) % 1);
      const span = Math.max(160, w * 0.45);
      const at = -span + easeInOut(Math.min(1, cycle / SWEEP)) * (w + span * 2);
      const intro = still ? 1 : easeOut((now - started) / 280, 3);
      const band = pen.createLinearGradient(at - span, 0, at + span, span * 0.18);
      for (let k = 0; k <= 8; k++) band.addColorStop(k / 8, gray(REST + (CREST - REST) * (0.5 - 0.5 * Math.cos((k / 8) * Math.PI * 2))));
      const round = (x: number, y: number, bw: number, bh: number, r: number) => { pen.beginPath(); pen.roundRect(x, y, Math.max(0, bw), bh, Math.min(r, bh / 2, Math.max(0, bw) / 2)); };
      for (const { el, kind, delay } of blocks()) {
        const { x, y, w: bw, h: bh } = box(el);
        const p = progress(since, delay, o.resolve);
        pen.fillStyle = band;
        if (kind === 'photo') {
          const develop = since < 0 ? 0 : easeOut(since / o.develop, 4);
          pen.globalAlpha = (1 - p) * intro;
          round(x, y, bw, bh, 10); pen.fill();
          const img = el instanceof HTMLImageElement ? el : el.querySelector('img');
          if (develop > 0 && img?.complete && img.naturalWidth) {
            const k = Math.max(bw / img.naturalWidth, bh / img.naturalHeight), iw = img.naturalWidth * k, ih = img.naturalHeight * k;
            pen.save(); round(x, y, bw, bh, 10); pen.clip();
            pen.globalAlpha = develop * (1 - p); pen.drawImage(img, x + (bw - iw) / 2, y + (bh - ih) / 2, iw, ih);
            pen.restore();
          }
        } else if (kind === 'avatar') {
          pen.globalAlpha = (1 - p) * intro;
          pen.beginPath(); pen.arc(x + bw / 2, y + bh / 2, Math.min(bw, bh) / 2, 0, Math.PI * 2); pen.fill();
        } else {
          // A text bar that recedes to the right and fades as its words come in behind it.
          const barH = Math.min(bh * 0.62, 12), by = y + (bh - barH) / 2, edge = x + bw * p;
          pen.globalAlpha = intro * (1 - p);
          round(edge, by, x + bw - edge, barH, barH / 2); pen.fill();
        }
        pen.globalAlpha = 1;
      }
      return true;
    },
  });

  const reset = () => {
    const shown = arrived !== null;
    started = performance.now(); arrived = null;
    element.setAttribute('aria-busy', 'true');
    if (!surface) return;
    // Loaded content fades out as the skeleton comes up over it, rather than cutting.
    if (shown && !surface.still()) for (const { el } of blocks()) el.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: 240, easing: 'cubic-bezier(.16, 1, .3, 1)' });
    hide();
    surface.kick();
  };
  reset();

  return handle(() => surface, state, () => surface?.refresh(), {
    resolve() {
      if (!surface) { element.removeAttribute('aria-busy'); return Promise.resolve(); }
      if (arrived !== null && finished) return finished;
      arrived = performance.now();
      finished = new Promise<void>(resolve => { done = resolve; });
      surface.kick();
      return finished;
    },
    reset() { done?.(); done = null; finished = null; reset(); },
    get loading() { return arrived === null; },
  }, () => { settleAll(); });
}

export const SKELETON_DEFAULTS = DEFAULTS;
