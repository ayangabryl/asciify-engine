import type { GlyphFieldOptions } from '../field';
import { handle, hash, house, mountSurface, prefersReduced, styleKeeper, type KitHandle, type KitOptions, type Surface } from './core';
import { snapshot } from './paint-dom';

export interface PageDissolveOptions extends KitOptions {
  /** Where the wave starts: an element (such as the tab that was clicked) or a point in the container's CSS pixels. Default: top centre. */
  origin?: HTMLElement | { x: number; y: number } | null;
  /** Ms the old view takes to break up from the origin outward. Default 300. */
  dissolve?: number;
  /** Ms the new view takes to condense in behind it, from the same origin. Default 300. */
  condense?: number;
}

export interface PageDissolveHandle extends KitHandle<PageDissolveOptions> {
  /**
   * The crisp view hands over to its own characters, a wave from `origin` breaks it up, `render` swaps the content underneath and the
   * new view condenses in behind the same wave, then hands back to crisp HTML. Swaps queue; each promise resolves once its view is crisp.
   */
  swap(render: () => void | Promise<void>, origin?: HTMLElement | { x: number; y: number } | null): Promise<void>;
  readonly busy: boolean;
}

const DEFAULTS = { dissolve: 300, condense: 300 };
/** Ms of crossfade between the HTML and its characters, at each end. The new view renders once the old HTML has faded out. */
const HAND = 110;
const SCALE = 2, CW = 10, CH = 16;
/** Sine in-out: the wave front leaves without a jolt. */
const smooth = (k: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, k)));
const land = (k: number) => 1 - (1 - Math.min(1, Math.max(0, k))) ** 2;
/** The handoffs answer the click at once: the house curve, in CSS for the HTML and solved here for the characters. */
const hand$ = (k: number) => house(Math.min(1, Math.max(0, k)));
const HAND_CSS = 'cubic-bezier(.16, 1, .3, 1)';
const signal = () => { let fire = () => {}; const p = new Promise<void>(resolve => { fire = resolve; }); return [p, fire] as const; };

/**
 * One frame of the wave, in source pixels: the view in blocks the size of a field cell, each placed by its distance from `origin`
 * plus a little noise. Leaving (the default), `p` 0 shows every block and 1.12 none: the front glows and sheds drifting fragments.
 * Arriving, `p` 0 shows none and 1.12 every block: fragments drift in and settle just behind the front.
 */
export function dissolveFrame(pen: CanvasRenderingContext2D, art: HTMLCanvasElement, p: number, origin: { x: number; y: number }, step: number, arrive = false) {
  const w = art.width, h = art.height, crest: [number, number][] = [];
  const reach = Math.max(...[[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => Math.hypot(x - origin.x, y - origin.y))) || 1;
  for (let y = 0; y < h; y += CH) {
    for (let x = 0; x < w; x += CW) {
      const at = (Math.hypot(x + CW / 2 - origin.x, y + CH / 2 - origin.y) / reach) * 0.72 + hash(x, y) * 0.28;
      const gap = arrive ? p - at - 0.12 : at - p;
      if (gap > 0) pen.drawImage(art, x, y, CW, CH, x, y, CW, CH);
      if (gap > 0 && gap < 0.07) crest.push([x, y]);
      else if (gap <= 0 && gap > -0.12) {
        const lift = -gap / 0.12;
        pen.globalAlpha = (1 - lift) * (arrive ? 0.7 : 1);
        pen.drawImage(art, x, y, CW, CH, x + (hash(y, x + step) - 0.5) * 18 * lift, y - 10 * lift * (arrive ? -0.6 : 1), CW, CH);
        pen.globalAlpha = 1;
      }
    }
  }
  pen.globalCompositeOperation = 'lighter';
  pen.globalAlpha = arrive ? 0.5 : 1;
  for (const [x, y] of crest) pen.drawImage(art, x, y, CW, CH, x, y, CW, CH);
  pen.globalAlpha = 1;
  pen.globalCompositeOperation = 'source-over';
}

interface Run {
  at: { x: number; y: number }; start: number; hand: number;
  out: HTMLCanvasElement; outMs: number;
  next: HTMLCanvasElement | null; nextAt: number; nextMs: number;
  handed: () => void; landing: () => void; done: () => void; stage: 0 | 1 | 2;
}

/** A page or panel transition: one wave of characters from where the user clicked carries the old view out and the next one in. */
export function pageDissolve(container: HTMLElement, options: PageDissolveOptions = {}): PageDissolveHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  const hidden = styleKeeper();
  let run: Run | null = null;
  let step = 0, queue: Promise<void> = Promise.resolve(), pending = 0, surface: Surface | null = null;
  const reduced = () => !!(state.current.reducedMotion ?? prefersReduced());
  const look = (): GlyphFieldOptions => ({
    mark: 'glyph', charset: ' .:-=+*#%@', font: '"Geist Mono", ui-monospace, monospace', fontWeight: 500,
    cellSize: 8, cellAspect: 0.6, glyphScale: 0.9, contrast: 1.15, shade: 0.55, ...state.current.look,
  });
  const finish = (r: Run) => { r.handed(); r.landing(); r.done(); };

  surface = mountSurface({
    host: container,
    look,
    ink: () => state.current.ink ?? '--ascii-ink-strong',
    // At rest the field is blank over live HTML, so a poster would only cover the real view while it waits for a context.
    kit: { get current() { return { ...state.current, poster: undefined }; } },
    reducedMotion: () => state.current.reducedMotion,
    resolution: SCALE,
    onFail: () => { surface = null; const r = run; run = null; hidden.restore(); if (r) finish(r); },
    paint: ({ pen, width, height, now }) => {
      const r = run;
      if (!r) return false;
      const t = now - r.start, kOut = t / r.outMs, kIn = r.next ? (now - r.nextAt) / r.nextMs : 0;
      if (kOut < 1) dissolveFrame(pen, r.out, smooth(kOut) * 1.12, r.at, ++step);
      // The new view decelerates in from just behind the front, so there is never a frame with neither view on screen.
      if (r.next && kIn > 0) dissolveFrame(pen, r.next, 0.1 + land(kIn) * 1.14, r.at, step, true);
      // The characters fade up over the HTML as it fades out, and back down as the new HTML fades in: one crossfade, no cut.
      const tail = r.next ? (now - r.nextAt - r.nextMs + r.hand) / r.hand : -1;
      const shown = hand$(t / r.hand) * (1 - hand$(tail));
      if (shown < 1) { pen.globalAlpha = 1 - shown; pen.fillStyle = '#000'; pen.fillRect(0, 0, width, height); pen.globalAlpha = 1; }
      // The field dims a little while the view is in pieces.
      surface?.field.update({ brightness: -0.16 * smooth(kOut * 2) * (r.next ? 1 - smooth(kIn) : 1) });
      if (r.stage === 0 && t >= r.hand) { r.stage = 1; r.handed(); }
      if (r.stage === 1 && tail >= 0) { r.stage = 2; r.landing(); }
      if (tail >= 1) { run = null; r.done(); return false; }
      return true;
    },
  });

  // The view, without the kit's own canvas or the poster that stands in for it.
  const content = () => ([...container.children] as HTMLElement[]).filter(el => el.dataset.asciiKit === undefined && el.dataset.asciiPoster === undefined);
  const originOf = (origin: PageDissolveOptions['origin'], s: Surface) => {
    if (origin && 'getBoundingClientRect' in origin) { const b = s.box(origin); return { x: (b.x + b.w / 2) * SCALE, y: (b.y + b.h / 2) * SCALE }; }
    if (origin) return { x: origin.x * SCALE, y: origin.y * SCALE };
    return { x: (container.offsetWidth / 2) * SCALE, y: 0 };
  };
  const picture = (s: Surface) => snapshot(container, s.box, container.offsetWidth, container.offsetHeight, SCALE, { skip: s.canvas });
  const fade = (on: boolean, ms: number) => {
    for (const el of content()) { hidden.set(el, 'transition', ms ? `opacity ${ms}ms ${HAND_CSS}` : 'none'); hidden.set(el, 'opacity', on ? '1' : '0'); }
  };

  const once = async (render: () => void | Promise<void>, origin: PageDissolveOptions['origin']) => {
    const s = surface;
    // Without a live field (reduced motion, or waiting its turn for a context) nothing would drive the wave: swap at once.
    if (!s || reduced() || !s.live) { await render(); return; }
    const { dissolve, condense } = state.current, hand = Math.max(1, Math.min(HAND, dissolve / 2, condense / 2));
    const [handed, handedFn] = signal(), [landing, landingFn] = signal(), [done, doneFn] = signal();
    const r: Run = run = { at: originOf(origin ?? state.current.origin, s), start: performance.now(), hand, out: picture(s), outMs: Math.max(1, dissolve),
      next: null, nextAt: 0, nextMs: Math.max(1, condense), handed: handedFn, landing: landingFn, done: doneFn, stage: 0 };
    container.dataset.state = 'out';
    fade(false, hand);
    s.kick();
    await handed;
    if (run !== r) return;
    try { await render(); } catch (error) { if (run === r) { run = null; hidden.restore(); surface?.field.update({ brightness: 0 }); } throw error; }
    if (!surface || run !== r) return;
    // A render that replaces the container's children (innerHTML, a framework root) takes the canvas with it; put it back.
    if (!s.canvas.isConnected || s.canvas.parentElement !== container) container.appendChild(s.canvas);
    // The new content is laid out but still hidden; it is measured for the condense, and fades in as the wave lands.
    fade(false, 0);
    container.dataset.state = 'in';
    r.next = picture(s);
    r.nextAt = performance.now();
    s.kick();
    await landing;
    if (run === r) fade(true, hand);
    await done;
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
    if (r) finish(r);
  });
}

export const PAGE_DISSOLVE_DEFAULTS = DEFAULTS;
