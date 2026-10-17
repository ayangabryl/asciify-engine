import type { GlyphFieldOptions } from '../field';
import { easeOut, handle, mountSurface, styleKeeper, type KitHandle, type KitOptions, type Surface } from './core';

export type SkeletonBlock = 'text' | 'photo' | 'avatar';

export interface SkeletonOptions extends KitOptions {
  /** Selector for the placeholder blocks inside the element. `data-block` may name the kind (`text`, `photo`, `avatar`); images default to photo. Default `[data-block]`. */
  blocks?: string;
  /** One shimmer pass in ms. The wave loops without a pause until `resolve()`. Default 1400. */
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

const DEFAULTS = { blocks: '[data-block]', shimmer: 1400, resolve: 420, stagger: 60, develop: 640 };
const gray = (tone: number) => `rgb(${tone * 255} ${tone * 255} ${tone * 255})`;
// The rest tone and the crest stay in the light end of the charset: dots and dashes, never a wall of # and @.
const REST = 0.24, CREST = 0.54, FEATHER = 28;
/** Where a block stands in its resolve, eased: 0 waiting, 1 handed over. */
const progress = (since: number, delay: number, length: number) => (since < 0 ? 0 : easeOut((since - delay) / length, 3));

const px = (value: string) => parseFloat(value) || 0;

/**
 * A block's shape, read from its own CSS rather than assumed: its corner radius (a percentage resolved against its
 * size), and for text, one bar per rendered line, as wide as the words and as tall as the font's x-height, centred
 * in the line box. `scale` maps CSS px to the paint box.
 */
export function blockShape(element: HTMLElement, kind: SkeletonBlock, scale = 1) {
  const css = getComputedStyle(element), rect = element.getBoundingClientRect();
  const corner = css.borderTopLeftRadius;
  const radius = corner.endsWith('%') ? (px(corner) / 100) * Math.min(rect.width, rect.height) : px(corner);
  if (kind !== 'text') return { radius: radius / scale, lines: [] as { x: number; y: number; w: number; h: number }[] };
  const size = px(css.fontSize) || 14;
  const lineHeight = css.lineHeight === 'normal' ? size * 1.2 : px(css.lineHeight);
  const bar = Math.min(lineHeight, size * 0.62);
  const rows = new Map<number, { left: number; right: number; top: number; bottom: number }>();
  const range = typeof document !== 'undefined' && typeof document.createRange === 'function' ? document.createRange() : null;
  range?.selectNodeContents(element);
  for (const r of range ? [...range.getClientRects()] : []) {
    if (!r.width) continue;
    const key = Math.round((r.top + r.bottom) / 2 / Math.max(1, lineHeight / 2));
    const row = rows.get(key);
    rows.set(key, row ? { left: Math.min(row.left, r.left), right: Math.max(row.right, r.right), top: Math.min(row.top, r.top), bottom: Math.max(row.bottom, r.bottom) } : { left: r.left, right: r.right, top: r.top, bottom: r.bottom });
  }
  const lines = [...rows.values()].map(row => {
    // Clipped or ellipsised text measures past its box; the bar stops at the box.
    const left = Math.max(row.left, rect.left), right = Math.min(row.right, rect.right), mid = (row.top + row.bottom) / 2;
    return { x: (left - rect.left) / scale, y: (mid - bar / 2 - rect.top) / scale, w: Math.max(0, right - left) / scale, h: bar / scale };
  }).filter(line => line.w > 0);
  if (!lines.length) lines.push({ x: 0, y: (rect.height - bar) / 2 / scale, w: rect.width / scale, h: bar / scale });
  return { radius: (radius || bar / 2) / scale, lines };
}

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
      // A continuous wave: crests a fixed distance apart travel at one speed, so one enters as the last leaves and the
      // loop never pauses or visibly restarts.
      const span = Math.max(140, w * 0.42), period = w + span;
      const at = -span + (still ? 0.4 : (((now - started) / o.shimmer) % 1)) * period;
      const intro = still ? 1 : easeOut((now - started) / 280, 3);
      // Two periods of a raised-cosine wave, drawn from one crest behind to one ahead.
      const band = pen.createLinearGradient(at - period, 0, at + period, period * 0.08);
      for (let k = 0; k <= 32; k++) {
        const d = Math.abs(k / 16 - 1) * period, near = Math.min(d, Math.abs(period - d));
        const lift = near < span ? 0.5 + 0.5 * Math.cos((near / span) * Math.PI) : 0;
        band.addColorStop(k / 32, gray(REST + (CREST - REST) * lift));
      }
      const round = (x: number, y: number, bw: number, bh: number, r: number) => { pen.beginPath(); pen.roundRect(x, y, Math.max(0, bw), bh, Math.min(r, bh / 2, Math.max(0, bw) / 2)); };
      for (const { el, kind, delay } of blocks()) {
        const { x, y, w: bw, h: bh } = box(el);
        const css = el.getBoundingClientRect().width, shape = blockShape(el, kind, css && bw ? css / bw : 1);
        const p = progress(since, delay, o.resolve);
        pen.fillStyle = band;
        if (kind === 'photo') {
          const develop = since < 0 ? 0 : easeOut(since / o.develop, 4);
          pen.globalAlpha = (1 - p) * intro;
          round(x, y, bw, bh, shape.radius); pen.fill();
          const img = el instanceof HTMLImageElement ? el : el.querySelector('img');
          if (develop > 0 && img?.complete && img.naturalWidth) {
            const k = Math.max(bw / img.naturalWidth, bh / img.naturalHeight), iw = img.naturalWidth * k, ih = img.naturalHeight * k;
            pen.save(); round(x, y, bw, bh, shape.radius); pen.clip();
            pen.globalAlpha = develop * (1 - p); pen.drawImage(img, x + (bw - iw) / 2, y + (bh - ih) / 2, iw, ih);
            pen.restore();
          }
        } else if (kind === 'avatar') {
          pen.globalAlpha = (1 - p) * intro;
          pen.beginPath(); pen.arc(x + bw / 2, y + bh / 2, Math.min(bw, bh) / 2, 0, Math.PI * 2); pen.fill();
        } else {
          // One bar per line of the real text, receding to the right and fading as the words come in behind it.
          pen.globalAlpha = intro * (1 - p);
          for (const line of shape.lines) {
            const lx = x + line.x, edge = lx + line.w * p;
            round(edge, y + line.y, lx + line.w - edge, line.h, shape.radius); pen.fill();
          }
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
