import type { GlyphFieldOptions } from '../field';
import { clamp, handle, mountSurface, prefersReduced, styleKeeper, type KitHandle, type KitOptions, type Surface } from './core';
import { stepSpring, velocity } from './slide-to-confirm';

export interface SwipeDeckOptions extends KitOptions {
  /** The cards, in order. Each card's first `img` is drawn in characters. Default `[data-card]`. */
  cards?: string;
  /** Start again from the first card after the last. Default true. */
  loop?: boolean;
  /** How far, as a share of the card's width, a release must travel to fling it. Default 0.4. */
  threshold?: number;
  /** Corner radius of the drawn cards, in CSS px. Default: the deck's own border radius. */
  radius?: number;
  /** CSS pixels the field reaches past the deck for the stack and the fling. Default 56; set at mount. */
  outset?: number;
  /** The element that receives `--ascii-lean`, such as the row holding your pass and keep buttons. Default the deck. */
  leanTarget?: HTMLElement | null;
  /** Called after a card leaves: `dir` is 1 for right (keep), -1 for left (pass). */
  onSwipe?: (dir: 1 | -1, index: number, card: HTMLElement) => void;
}

export interface SwipeDeckHandle extends KitHandle<SwipeDeckOptions> {
  /** Flings the top card: 1 to the right, -1 to the left. Returns false at the end of a deck that does not loop. */
  next(dir?: 1 | -1): boolean;
  /** The index of the top card. */
  readonly index: number;
}

const DEFAULTS = { cards: '[data-card]', loop: true, threshold: 0.4, outset: 56 };
const FLY_MS = 620;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => 1 - (1 - t) ** 3;
interface Spring { x: number; v: number; to: number; k: number; z: number }
const spring = (x: number, k: number, z: number): Spring => ({ x, v: 0, to: x, k, z });
/** A fixed scatter per row, so strips leave in the same ragged order each time. */
const ROWS = Array.from({ length: 96 }, (_, i) => { const v = Math.sin(i * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); });

/**
 * A photo as tone for the field: levels stretched and, on a light page, inverted, so dark parts of the photo become dense dark ink.
 * Null when the image cannot be read (not loaded, or cross-origin without CORS).
 */
export function toneImage(img: HTMLImageElement, light: boolean, floor = 0.04) {
  if (!img.complete || !img.naturalWidth) return null;
  const s = Math.min(1, 420 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
  const pen = c.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
  if (!pen) return null;
  try {
    pen.drawImage(img, 0, 0, c.width, c.height);
    const data = pen.getImageData(0, 0, c.width, c.height), px = data.data, hist = new Uint32Array(256), n = px.length / 4;
    const lum = (i: number) => px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722;
    for (let i = 0; i < px.length; i += 4) hist[Math.round(lum(i))]++;
    let lo = 0, hi = 255, acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.02) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.02) { hi = v; break; } }
    const span = Math.max(1, hi - lo);
    for (let i = 0; i < px.length; i += 4) {
      let l = clamp((lum(i) - lo) / span);
      if (light) l = 1 - l;
      px[i] = px[i + 1] = px[i + 2] = Math.round((floor + (1 - floor) * l) * 255);
      px[i + 3] = 255;
    }
    pen.putImageData(data, 0, 0);
    return c;
  } catch {
    return null;
  }
}

/** A deck of cards drawn in characters: drag or press the arrow keys to fling the top card, which breaks into rows of characters along the swipe. */
export function swipeDeck(deck: HTMLElement, options: SwipeDeckOptions = {}): SwipeDeckHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  const styles = styleKeeper();
  const reduced = () => !!(state.current.reducedMotion ?? prefersReduced());
  const cards = () => [...deck.querySelectorAll<HTMLElement>(state.current.cards)];
  let i = 0, dx = spring(0, 380, 0.72), dy = spring(0, 380, 0.8), promote = spring(0, 260, 0.9), held = false, gx = 0, gy = 0;
  let fly: null | { dir: 1 | -1; start: number; x0: number; y0: number } = null, samples: [number, number][] = [], raf = 0, last = 0, pointer = -1;
  let cut = new Map<HTMLElement, { key: string; canvas: HTMLCanvasElement }>(), grainCanvas: HTMLCanvasElement | null = null, surface: Surface | null = null;
  const look = (): GlyphFieldOptions => ({ blend: 'coarse',
    mark: 'glyph', charset: ' .:-=+*#%@', font: '"Geist Mono", ui-monospace, monospace', fontWeight: 500,
    cellSize: 4, cellAspect: 0.62, glyphScale: 0.94, contrast: 1.3, ...state.current.look,
  });
  const at = (k: number) => cards()[norm(k)] ?? null;
  const width = () => deck.clientWidth || 160;
  const norm = (k: number) => { const n = cards().length; return n ? ((k % n) + n) % n : 0; };

  /** Each card pre-cut to the deck's size and corners, so a frame only moves and slices bitmaps. */
  const card = (k: number, w: number, h: number, light: boolean) => {
    const el = at(k);
    if (!el || (!state.current.loop && k >= cards().length)) return null;
    const img = el.tagName === 'IMG' ? el as HTMLImageElement : el.querySelector('img');
    const key = `${img?.currentSrc || img?.src || ''}|${img?.complete}|${Math.round(w)}x${Math.round(h)}|${light}`, kept = cut.get(el);
    if (kept?.key === key) return kept.canvas;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    const pen = c.getContext('2d');
    if (!pen) return null;
    const radius = state.current.radius ?? (parseFloat(getComputedStyle(deck).borderTopLeftRadius) || 16);
    pen.beginPath(); pen.roundRect(0, 0, c.width, c.height, Math.min(radius, c.width / 2, c.height / 2)); pen.clip();
    const src = img ? toneImage(img, light) : null;
    if (src) {
      const s = Math.max(c.width / src.width, c.height / src.height), sw = c.width / s, sh = c.height / s;
      pen.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, c.width, c.height);
    } else { pen.fillStyle = 'rgb(60 60 60)'; pen.fillRect(0, 0, c.width, c.height); }
    // A rim of mid-density characters, so each card reads as a card at any photo tone.
    pen.strokeStyle = 'rgb(150 150 150)'; pen.lineWidth = 6; pen.stroke();
    cut.set(el, { key, canvas: c });
    return c;
  };
  /** Scattered cells that thin a card that is still arriving. */
  const grain = (w: number, h: number) => {
    let c = grainCanvas;
    if (!c || c.width !== Math.round(w) || c.height !== Math.round(h)) {
      c = grainCanvas = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
      const pen = c.getContext('2d');
      if (pen) for (let y = 0; y < c.height; y += 6) for (let x = 0; x < c.width; x += 4) {
        const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        if (v - Math.floor(v) < 0.55) { pen.fillStyle = '#000'; pen.fillRect(x, y, 4, 6); }
      }
    }
    return c;
  };

  surface = mountSurface({
    host: deck,
    outset: state.current.outset,
    look,
    ink: () => state.current.ink ?? '--ascii-ink-strong',
    kit: state,
    reducedMotion: () => state.current.reducedMotion,
    onFail: () => { surface = null; styles.restore(); hideRest(); },
    onTheme: () => { cut = new Map(); },
    paint: ({ pen, w: fw, now, dark, box }) => {
      const r = box(deck), W = r.w, H = r.h, cx = r.x + W / 2, cy = r.y + H / 2, p = clamp(promote.x);
      const place = (k: number, scale: number, oy: number, alpha: number, thin = 0) => {
        const c = card(k, W, H, !dark);
        if (!c || alpha <= 0) return;
        pen.save();
        pen.translate(cx, cy + oy); pen.scale(scale, scale); pen.globalAlpha = alpha;
        pen.drawImage(c, -W / 2, -H / 2);
        if (thin > 0) { pen.globalCompositeOperation = 'destination-out'; pen.globalAlpha = thin; pen.drawImage(grain(W, H), -W / 2, -H / 2); }
        pen.restore();
      };
      place(i + 2, mix(0.86, 0.93, p), mix(24, 12, p), mix(0.3, 0.55, p), 0.3);
      place(i + 1, mix(0.93, 1, p), mix(12, 0, p), mix(0.55, 1, p), (1 - p) * 0.4);
      const top = card(i, W, H, !dark);
      if (!top) return false;
      const k = fly ? clamp((now - fly.start) / FLY_MS) : 0, dir = fly?.dir ?? 1;
      const x = fly ? fly.x0 + dir * W * 0.9 * ease(k) : dx.x, y = fly ? fly.y0 : dy.x;
      pen.save();
      pen.translate(cx + x, cy + y);
      pen.rotate(clamp(x / W, -1.6, 1.6) * 0.22);
      if (!fly) { pen.drawImage(top, -W / 2, -H / 2); pen.restore(); return false; }
      // The card breaks into rows of characters that stream out along the swipe, the ragged ones first.
      const band = 6, rows = Math.ceil(H / band);
      for (let j = 0; j < rows; j++) {
        const rnd = ROWS[j % ROWS.length], kj = clamp(k * 1.55 - rnd * 0.55);
        if (kj >= 1) continue;
        const shift = dir * kj * kj * W * (0.5 + rnd * 0.9), row = j * band, sh = Math.min(band, H - row);
        // Rows thin out before they reach the field's edge, so nothing leaves cut off.
        const lead = dir > 0 ? cx + x + shift + W * 0.62 : cx + x + shift - W * 0.62, room = dir > 0 ? fw - 4 - lead : lead - 4;
        pen.globalAlpha = (1 - kj * kj) * clamp(room / 56);
        pen.drawImage(top, 0, row, W, sh, -W / 2 + shift, -H / 2 + row, W, sh);
      }
      pen.restore();
      return false;
    },
  });

  /** Only the top card is in the page's flow and the accessibility tree; with the field, it is drawn rather than shown. */
  function hideRest() {
    // While a card streams away the deck has already moved on: the next card is the one in the flow.
    const all = cards(), top = i + (fly ? 1 : 0), el = !state.current.loop && top >= all.length ? null : at(top);
    all.forEach(card => {
      // With the field every card stays rendered (a lazy image in a hidden card never loads) but invisible, and only the top one is read.
      if (surface) { styles.set(card, 'opacity', '0'); if (card !== el) card.setAttribute('aria-hidden', 'true'); else card.removeAttribute('aria-hidden'); } else card.hidden = card !== el;
    });
    deck.setAttribute('aria-label', el ? `${el.getAttribute('aria-label') || el.querySelector('img')?.alt || el.textContent?.trim() || 'Card'}. Left arrow to pass, right arrow to keep.` : 'No more cards');
  }
  const apply = () => {
    (state.current.leanTarget ?? deck).style.setProperty('--ascii-lean', String(fly ? 0 : clamp(dx.x / (width() * 0.4), -1, 1)));
    // Without the field the HTML card itself follows the drag.
    const el = at(i);
    if (!surface && el) styles.set(el, 'transform', `translate(${dx.x}px, ${dy.x}px) rotate(${clamp(dx.x / width(), -1.6, 1.6) * 0.22}rad)`);
  };
  const tick = (now: number) => {
    raf = 0;
    const dt = Math.min(1 / 30, Math.max(0, (now - last) / 1000));
    last = now;
    let moving = false;
    if (!held && !fly) { moving = stepSpring(dx, dt, 0.3); moving = stepSpring(dy, dt, 0.3) || moving; }
    moving = stepSpring(promote, dt, 0.002) || moving;
    if (fly && now - fly.start >= FLY_MS) { fly = null; i += 1; settle(); }
    apply();
    surface?.kick();
    if (moving || held || fly) raf = requestAnimationFrame(tick);
  };
  const kick = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); } };
  const settle = () => { dx = spring(0, 380, 0.72); dy = spring(0, 380, 0.8); promote = spring(0, 260, 0.9); };

  const next = (dir: 1 | -1 = 1) => {
    const all = cards();
    if (fly || !all.length || (!state.current.loop && i >= all.length)) return false;
    const leaving = at(i)!, index = norm(i);
    held = false;
    if (reduced() || !surface) { i += 1; settle(); if (!surface) styles.set(leaving, 'transform', ''); }
    else { fly = { dir, start: performance.now(), x0: dx.x, y0: dy.x }; promote.to = 1; }
    hideRest();
    kick();
    state.current.onSwipe?.(dir, index, leaving);
    return true;
  };
  const release = (event?: Event) => {
    if (!held || (event !== undefined && (event as PointerEvent).pointerId !== undefined && (event as PointerEvent).pointerId !== pointer)) return;
    held = false;
    const v = velocity(samples, performance.now()), W = width();
    if (Math.abs(dx.x) > W * state.current.threshold || (Math.abs(v) > 650 && Math.sign(v) === Math.sign(dx.x) && Math.abs(dx.x) > 16)) { next(dx.x < 0 ? -1 : 1); return; }
    dx.to = 0; dy.to = 0; promote.to = 0;
    dx.v = clamp(v, -1600, 1600) * 0.2;
    if (reduced()) { dx.x = dy.x = promote.x = 0; dx.v = dy.v = promote.v = 0; }
    kick();
  };
  const scale = () => deck.getBoundingClientRect().width / (deck.clientWidth || 1) || 1;
  const onDown = (event: PointerEvent) => {
    if (event.button !== 0 || fly) return;
    // A pointer that is no longer active (or a scripted one) cannot be captured; the drag still follows it.
    try { deck.setPointerCapture?.(event.pointerId); } catch { /* not capturable */ }
    pointer = event.pointerId;
    const s = scale();
    held = true; gx = event.clientX - dx.x * s; gy = event.clientY - (dy.x / 0.3) * s; samples = [];
    kick();
  };
  const onMove = (event: PointerEvent) => {
    // Only the pointer that took the card drags it.
    if (!held || event.pointerId !== pointer) return;
    const s = scale();
    dx.x = dx.to = (event.clientX - gx) / s;
    dy.x = dy.to = ((event.clientY - gy) / s) * 0.3;
    dx.v = dy.v = 0;
    promote.to = clamp(Math.abs(dx.x) / width()) * 0.5;
    samples.push([dx.x, performance.now()]);
    if (samples.length > 8) samples.shift();
    kick();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    next(event.key === 'ArrowRight' ? 1 : -1);
  };
  const onLoad = () => surface?.kick();
  // An image under the pointer would otherwise start a native drag, which cancels the pointer stream.
  const noDrag = (event: Event) => event.preventDefault();

  if (!deck.hasAttribute('tabindex')) deck.tabIndex = 0;
  deck.setAttribute('role', deck.getAttribute('role') ?? 'group');
  deck.setAttribute('aria-roledescription', 'card');
  styles.set(deck, 'touch-action', 'none');
  hideRest();
  deck.addEventListener('pointerdown', onDown);
  deck.addEventListener('pointermove', onMove);
  deck.addEventListener('pointerup', release);
  deck.addEventListener('pointercancel', release);
  deck.addEventListener('lostpointercapture', release);
  deck.addEventListener('keydown', onKey);
  deck.addEventListener('load', onLoad, true);
  deck.addEventListener('dragstart', noDrag);

  return handle(() => surface, state, () => { cut = new Map(); hideRest(); surface?.refresh(); }, {
    next,
    get index() { return norm(i + (fly ? 1 : 0)); },
  }, () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    styles.restore();
    cards().forEach(el => { el.hidden = false; el.removeAttribute('aria-hidden'); });
    (state.current.leanTarget ?? deck).style.removeProperty('--ascii-lean');
    deck.removeAttribute('aria-roledescription');
    deck.removeEventListener('pointerdown', onDown);
    deck.removeEventListener('pointermove', onMove);
    deck.removeEventListener('pointerup', release);
    deck.removeEventListener('pointercancel', release);
    deck.removeEventListener('lostpointercapture', release);
    deck.removeEventListener('keydown', onKey);
    deck.removeEventListener('load', onLoad, true);
    deck.removeEventListener('dragstart', noDrag);
  });
}

export const SWIPE_DECK_DEFAULTS = DEFAULTS;
