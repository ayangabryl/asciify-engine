import type { GlyphFieldOptions } from '../field';
import { handle, hash, house, mountSurface, prefersReduced, styleKeeper, type KitHandle, type KitOptions, type Surface } from './core';
import { snapshot } from './paint-dom';

export interface PageDissolveOptions extends KitOptions {
  /** Where the dissolve starts: an element (such as the tab that was clicked) or a point in the container's CSS pixels. Default: top centre. */
  origin?: HTMLElement | { x: number; y: number } | null;
  /** Ms the old view takes to break up. Default 140. */
  dissolve?: number;
  /** Ms the new view takes to condense. Default 160. */
  condense?: number;
}

export interface PageDissolveHandle extends KitHandle<PageDissolveOptions> {
  /**
   * The view breaks into its own characters from `origin`, `render` swaps the content underneath, and the new view condenses
   * out of characters. Swaps queue; each promise resolves once its view is crisp again.
   */
  swap(render: () => void | Promise<void>, origin?: HTMLElement | { x: number; y: number } | null): Promise<void>;
  readonly busy: boolean;
}

const DEFAULTS = { dissolve: 140, condense: 160 };
const SCALE = 2, CW = 10, CH = 16;

/**
 * One frame of the dissolve, in source pixels: the view in blocks the size of a field cell, each kept or dropped by its distance
 * from `origin` plus a little noise. `p` 0 shows every block; 1 shows none. The front glows and sheds drifting fragments.
 */
export function dissolveFrame(pen: CanvasRenderingContext2D, art: HTMLCanvasElement, p: number, origin: { x: number; y: number }, step: number) {
  const w = art.width, h = art.height, crest: [number, number][] = [];
  const reach = Math.max(...[[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => Math.hypot(x - origin.x, y - origin.y))) || 1;
  for (let y = 0; y < h; y += CH) {
    for (let x = 0; x < w; x += CW) {
      const gap = (Math.hypot(x + CW / 2 - origin.x, y + CH / 2 - origin.y) / reach) * 0.72 + hash(x, y) * 0.28 - p;
      if (gap > 0) pen.drawImage(art, x, y, CW, CH, x, y, CW, CH);
      if (gap > 0 && gap < 0.07) crest.push([x, y]);
      else if (gap <= 0 && gap > -0.12) {
        const lift = -gap / 0.12;
        pen.globalAlpha = 1 - lift;
        pen.drawImage(art, x, y, CW, CH, x + (hash(y, x + step) - 0.5) * 18 * lift, y - 10 * lift, CW, CH);
        pen.globalAlpha = 1;
      }
    }
  }
  pen.globalCompositeOperation = 'lighter';
  for (const [x, y] of crest) pen.drawImage(art, x, y, CW, CH, x, y, CW, CH);
  pen.globalCompositeOperation = 'source-over';
}

/** A page or panel transition: the view dissolves into characters from where the user clicked and the next view condenses in. */
export function pageDissolve(container: HTMLElement, options: PageDissolveOptions = {}): PageDissolveHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  const hidden = styleKeeper();
  let run: null | { art: HTMLCanvasElement; from: number; to: number; start: number; ms: number; at: { x: number; y: number }; done: () => void } = null;
  let step = 0, queue: Promise<void> = Promise.resolve(), pending = 0, surface: Surface | null = null;
  const reduced = () => !!(state.current.reducedMotion ?? prefersReduced());
  const look = (): GlyphFieldOptions => ({
    mark: 'glyph', charset: ' .:-=+*#%@', font: '"Geist Mono", ui-monospace, monospace', fontWeight: 500,
    cellSize: 8, cellAspect: 0.6, glyphScale: 0.9, contrast: 1.15, shade: 0.55, ...state.current.look,
  });

  surface = mountSurface({
    host: container,
    look,
    ink: dark => state.current.ink ?? (dark ? '#d8d6cf' : '#1d1d1b'),
    reducedMotion: () => state.current.reducedMotion,
    resolution: SCALE,
    onFail: () => { surface = null; const r = run; run = null; hidden.restore(); r?.done(); },
    paint: ({ pen, now }) => {
      const r = run;
      if (!r) return false;
      const k = Math.min(1, (now - r.start) / r.ms), e = r.from < r.to ? k * k : house(k), p = r.from + (r.to - r.from) * e;
      dissolveFrame(pen, r.art, p, r.at, ++step);
      // The field dims a little as the view breaks up, and brightens back as the next one condenses.
      surface?.field.update({ brightness: -0.22 * (r.from < r.to ? e : 1 - e) });
      if (k >= 1) { run = null; r.done(); return false; }
      return true;
    },
  });

  const content = () => ([...container.children] as HTMLElement[]).filter(el => !(el.tagName === 'CANVAS' && el.dataset.asciiKit !== undefined));
  const originOf = (origin: PageDissolveOptions['origin'], s: Surface) => {
    if (origin && 'getBoundingClientRect' in origin) { const b = s.box(origin); return { x: (b.x + b.w / 2) * SCALE, y: (b.y + b.h / 2) * SCALE }; }
    if (origin) return { x: origin.x * SCALE, y: origin.y * SCALE };
    return { x: (container.offsetWidth / 2) * SCALE, y: 0 };
  };
  const phase = (s: Surface, art: HTMLCanvasElement, from: number, to: number, ms: number, at: { x: number; y: number }) => new Promise<void>(resolve => {
    run = { art, from, to, start: performance.now(), ms: Math.max(1, ms), at, done: resolve };
    s.kick();
  });
  const picture = (s: Surface) => snapshot(container, s.box, container.offsetWidth, container.offsetHeight, SCALE);

  const once = async (render: () => void | Promise<void>, origin: PageDissolveOptions['origin']) => {
    const s = surface;
    if (!s || reduced()) { await render(); return; }
    const at = originOf(origin ?? state.current.origin, s), out = picture(s);
    container.dataset.state = 'out';
    for (const el of content()) hidden.set(el, 'opacity', '0');
    await phase(s, out, 0, 1.12, state.current.dissolve, at);
    await render();
    if (!surface) return;
    // A render that replaces the container's children (innerHTML, a framework root) takes the canvas with it; put it back.
    if (!s.canvas.isConnected || s.canvas.parentElement !== container) container.appendChild(s.canvas);
    // The new content is laid out but still hidden; it is measured for the condense, then shown crisp.
    for (const el of content()) hidden.set(el, 'opacity', '0');
    container.dataset.state = 'in';
    await phase(s, picture(s), 0.92, -0.12, state.current.condense, at);
    hidden.restore();
    surface?.field.update({ brightness: 0 });
    surface?.kick();
  };

  return handle(() => surface, state, () => surface?.refresh(), {
    swap(render: () => void | Promise<void>, origin?: PageDissolveOptions['origin']) {
      pending++;
      const next = queue.then(() => once(render, origin)).finally(() => { if (--pending === 0) delete container.dataset.state; });
      queue = next.catch(() => {});
      return next;
    },
    get busy() { return pending > 0; },
  }, () => {
    const r = run;
    run = null;
    hidden.restore();
    delete container.dataset.state;
    r?.done();
  });
}

export const PAGE_DISSOLVE_DEFAULTS = DEFAULTS;
