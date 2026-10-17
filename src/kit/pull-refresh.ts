import type { GlyphFieldOptions } from '../field';
import { drawCover, snapshot, toneOf } from './capture';
import { clamp, easeOut, handle, mountSurface, smoothstep, srOnly, styleKeeper, type KitHandle, type KitOptions, type Surface } from './core';

export type PullState = 'idle' | 'pulling' | 'refreshing' | 'done';

export interface PullRefreshOptions extends KitOptions {
  /** Runs the refresh. The spinner turns until its promise settles. */
  onRefresh: () => unknown;
  /** The element that moves down with the pull. Default the first child. */
  content?: HTMLElement | null;
  /** Pull distance in px that triggers a refresh on release. Default 64. */
  threshold?: number;
  /** What a screen reader hears. */
  messages?: { refreshing?: string; done?: string; failed?: string };
  /** A selector for the rows `onRefresh` added, such as `'[data-new]'`: they resolve in from characters as the content springs back. Each row is revealed once. */
  reveal?: string;
}

export interface PullRefreshHandle extends KitHandle<PullRefreshOptions> {
  /** Refreshes as if pulled, for a Refresh button or a keyboard shortcut. */
  refresh(): Promise<void>;
  /** Resolves these rows in from characters: they appear as glyphs of their own text and media, then hand over to the HTML. */
  revealRows(rows: Iterable<Element>): void;
  readonly state: PullState;
}

const DEFAULTS = { threshold: 64 };
/** The indicator is iOS-sized: a 26px ring; the content rests 48px down while it spins. */
const RING = 11, STROKE = 4, REST = 48, POP_MS = 260, OPEN_MS = 240, MIN_SPIN = 600, CHECK_MS = 300, HOLD_MS = 320, REVEAL_MS = 760, HANDOVER = 0.3;
const rubber = (raw: number) => 128 * (1 - Math.exp(-Math.max(0, raw) / 128));

interface Spring { x: number; v: number; to: number }
/** Semi-implicit Euler in 240 Hz substeps; returns whether the spring is still moving. */
export function stepSpring(s: Spring, dt: number, k = 300, z = 0.86, eps = 0.2) {
  const c = 2 * Math.sqrt(k) * z, n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
  for (let i = 0; i < n; i++) { s.v += (-k * (s.x - s.to) - c * s.v) * h; s.x += s.v * h; }
  if (Math.abs(s.x - s.to) < eps && Math.abs(s.v) < eps * 12) { s.x = s.to; s.v = 0; return false; }
  return true;
}

function drawCheck(pen: CanvasRenderingContext2D, x: number, y: number, size: number, t: number) {
  if (t <= 0) return;
  const p = [[-0.82, 0.02], [-0.26, 0.56], [0.86, -0.6]].map(([px, py]) => [x + px * size, y + py * size]);
  const length = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]) + Math.hypot(p[2][0] - p[1][0], p[2][1] - p[1][1]);
  pen.save();
  pen.strokeStyle = '#fff'; pen.lineWidth = STROKE + 0.5; pen.lineCap = 'round'; pen.lineJoin = 'round';
  pen.setLineDash([length * t, length]);
  pen.beginPath(); pen.moveTo(p[0][0], p[0][1]); pen.lineTo(p[1][0], p[1][1]); pen.lineTo(p[2][0], p[2][1]); pen.stroke();
  pen.restore();
}

/**
 * Pull to refresh: dragging the content down at the top draws a small ring of characters round in the gap, closing it at the
 * threshold with a small pop. Let go past it and the ring opens into a spinning arc while `onRefresh` runs, then draws a check and springs back.
 */
export function pullRefresh(element: HTMLElement, options: PullRefreshOptions): PullRefreshHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  const styles = styleKeeper();
  const content = () => state.current.content ?? (element.children[0] as HTMLElement | undefined) ?? null;
  const live = srOnly('', true);
  const d: Spring = { x: 0, v: 0, to: 0 };
  let phase: PullState = 'idle', held = false, pulling = false, y0 = 0, pointer = -1, spin = 0, at = 0, last = 0, ok = true, armed = 0;
  let surface: Surface | null = null;
  /** Rows resolving in: a still of each in characters, drawn where the row is now; `start` is Infinity while held back. */
  let fresh: { row: HTMLElement; snap: HTMLCanvasElement | null; start: number; opacity: string; transition: string; shown: boolean; photos: HTMLImageElement[] }[] = [];
  const revealed = new WeakSet<Element>();
  const look = (): GlyphFieldOptions => ({
    mark: 'glyph', charset: ' .:-=+*#%@', font: '"Geist Mono", ui-monospace, monospace', fontWeight: 500,
    cellSize: 5, cellAspect: 0.62, glyphScale: 0.94, ...state.current.look,
  });
  const say = (text: string) => { live.textContent = text; };

  surface = mountSurface({
    host: element,
    look,
    ink: () => state.current.ink ?? '--ascii-ink-strong',
    kit: state,
    reducedMotion: () => state.current.reducedMotion,
    resolution: 2,
    onFail: () => { surface = null; },
    paint: ({ pen, w, now, still, scale, box }) => {
      const dt = last ? Math.min(1 / 30, (now - last) / 1000) : 1 / 60;
      last = now;
      let moving = held;
      if (still) { d.x = d.to; d.v = 0; } else if (!held) moving = stepSpring(d, dt) || moving;
      if (phase === 'refreshing') { spin += dt * 6.5; moving = true; }
      if (phase === 'done' && now - at < CHECK_MS + 20) moving = true;
      const node = content();
      if (node) styles.set(node, 'translate', `0 ${Math.max(0, d.x).toFixed(2)}px`);
      pen.setTransform(scale, 0, 0, scale, 0, 0);
      const o = state.current, gap = Math.max(0, d.x), q = clamp(gap / o.threshold), rest = Math.min(o.threshold, REST);
      // The ring grows in with the first part of the pull and shrinks away with the spring back, so it is never cut by the gap.
      const size = phase === 'idle' || phase === 'pulling' ? smoothstep(0.1, 0.55, q) : clamp(gap / rest), cx = w / 2, cy = Math.min(gap, rest) / 2 + Math.max(0, gap - rest) * 0.25;
      if (phase === 'pulling' && q >= 1 && !armed) armed = now;
      if (q < 1) armed = 0;
      const pop = armed && !still && now - armed < POP_MS ? Math.sin(Math.PI * ((now - armed) / POP_MS)) * 0.14 : 0;
      if (pop) moving = true;
      if (gap > 0.5 && size > 0.01) {
        pen.save();
        pen.beginPath(); pen.rect(0, 0, w, gap); pen.clip();
        pen.translate(cx, cy); pen.scale(size * (1 + pop), size * (1 + pop));
        pen.lineWidth = STROKE; pen.lineCap = 'round';
        if (phase === 'idle' || phase === 'pulling') {
          // The arc is drawn round with the pull; past the threshold it turns on with the extra distance.
          const turn = -Math.PI / 2 + Math.max(0, gap - o.threshold) * 0.03;
          pen.strokeStyle = `rgba(255,255,255,${0.55 + 0.45 * q})`;
          pen.beginPath(); pen.arc(0, 0, RING, turn, turn + Math.PI * 2 * Math.max(0.02, q)); pen.stroke();
        } else {
          const k = phase === 'done' && ok ? (still ? 1 : easeOut((now - at) / CHECK_MS)) : 0;
          // The closed ring opens into a comet as the refresh starts, rather than switching to it.
          const open = phase === 'refreshing' && !still ? easeOut((now - at) / OPEN_MS) : 1, n = 24, span = Math.PI * 2 * (1 - 0.22 * open);
          for (let i = 0; i < n; i++) {
            const a = spin - Math.PI / 2 + (i / n) * span, fade = 1 - open * 0.85 * (1 - i / (n - 1));
            pen.strokeStyle = `rgba(255,255,255,${fade * (1 - k) * (phase === 'done' && !ok ? 0.4 : 1)})`;
            pen.beginPath(); pen.arc(0, 0, RING, a, a + span / n + 0.02); pen.stroke();
          }
          if (k > 0) drawCheck(pen, 0, 0, RING, k);
        }
        pen.restore();
      }
      fresh = fresh.filter(item => {
        if (!item.row.isConnected) { handOver(item, true); return false; }
        const k = still ? 1 : (now - item.start) / REVEAL_MS;
        if (k < 0 || !Number.isFinite(k)) { moving = moving || Number.isFinite(k); return true; }
        if (k >= HANDOVER) handOver(item);
        if (k >= 1) { handOver(item, true); return false; }
        const b = box(item.row);
        // The still is taken as the row starts to resolve, and again while the row is still opening (a height transition), so it always fits.
        if (!item.snap || Math.abs(item.snap.width / 2 - b.w) > 0.5 || Math.abs(item.snap.height / 2 - b.h) > 0.5) {
          item.snap = snapshot(item.row, b.w, b.h, el => { const e = box(el); return { x: e.x - b.x, y: e.y - b.y, w: e.w, h: e.h }; }).canvas;
          item.photos = [...item.row.querySelectorAll('img')];
        }
        const snap = item.snap;
        if (item.photos.length) tonePhotos(item, snap, box);
        pen.globalAlpha = k < HANDOVER ? easeOut(k / HANDOVER, 3) : 1 - easeOut((k - HANDOVER) / (1 - HANDOVER), 3);
        pen.drawImage(snap, b.x, b.y, b.w, b.h);
        pen.globalAlpha = 1;
        moving = true;
        return true;
      });
      if (!moving) last = 0;
      return moving;
    },
  });

  const kick = () => surface?.kick();
  /** Photos arrive as themselves in characters rather than flat tiles: each image is drawn into the row's still as tone once it has loaded. */
  function tonePhotos(item: (typeof fresh)[number], snap: HTMLCanvasElement, box: (el: Element) => { x: number; y: number; w: number; h: number }) {
    const pen = snap.getContext('2d'), o = box(item.row);
    item.photos = item.photos.filter(img => {
      if (!img.complete) return true;
      if (!pen || !img.naturalWidth) return false;
      const r = box(img), x = r.x - o.x, y = r.y - o.y, radius = Math.min(parseFloat(getComputedStyle(img).borderTopLeftRadius) || 0, r.w / 2, r.h / 2);
      pen.save();
      pen.setTransform(2, 0, 0, 2, 0, 0);
      pen.beginPath(); pen.roundRect(x, y, r.w, r.h, radius); pen.clip();
      pen.fillStyle = '#000'; pen.fillRect(x, y, r.w, r.h);
      drawCover(pen, toneOf({ image: img, width: img.naturalWidth, height: img.naturalHeight }, !(surface?.dark() ?? false)), x, y, r.w, r.h);
      pen.restore();
      return false;
    });
  }
  /** The HTML row fades back in under its characters; `done` also puts back its own transition. */
  function handOver(item: (typeof fresh)[number], done = false) {
    const css = item.row.style;
    if (!item.shown) { item.shown = true; css.transition = 'opacity 280ms cubic-bezier(.16, 1, .3, 1)'; css.opacity = item.opacity; }
    if (done) css.transition = item.transition;
  }
  /** Hides the rows now; they resolve in from `start`, as glyphs of a still taken then. */
  const hold = (rows: Iterable<Element>, start: number) => {
    const s = surface;
    if (!s || s.still()) return;
    for (const row of rows) {
      if (!(row instanceof HTMLElement) || revealed.has(row)) continue;
      revealed.add(row);
      fresh.push({ row, snap: null, start, opacity: row.style.opacity, transition: row.style.transition, shown: false, photos: [...row.querySelectorAll('img')] });
      row.style.transition = 'none';
      row.style.opacity = '0';
    }
    kick();
  };
  const revealRows = (rows: Iterable<Element>) => hold(rows, performance.now());
  const begin = () => { const now = performance.now(); fresh.forEach(item => { if (item.start === Infinity) item.start = now; }); kick(); };
  const nextFrame = () => new Promise<void>(resolve => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => resolve()) : resolve()));
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const refresh = async () => {
    if (phase === 'refreshing' || phase === 'done') return;
    const o = state.current, still = !surface || surface.still();
    phase = 'refreshing';
    held = pulling = false;
    d.to = Math.min(o.threshold, REST);
    at = performance.now();
    element.setAttribute('aria-busy', 'true');
    say(o.messages?.refreshing ?? 'Refreshing.');
    kick();
    ok = true;
    try { await Promise.all([o.onRefresh(), wait(still ? 0 : MIN_SPIN)]); } catch { ok = false; }
    if (phase !== 'refreshing') return;
    // New rows wait, hidden, behind the check; they resolve in as the content springs back.
    if (ok && o.reveal && !still) { await nextFrame(); const node = content(); if (node) hold(node.querySelectorAll(o.reveal), Infinity); }
    phase = 'done';
    at = performance.now();
    say(ok ? o.messages?.done ?? 'Updated.' : o.messages?.failed ?? 'Couldn’t refresh.');
    kick();
    await wait(still ? 0 : CHECK_MS + HOLD_MS);
    if (phase !== 'done') { begin(); return; }
    phase = 'idle';
    d.to = 0;
    begin();
    element.removeAttribute('aria-busy');
    kick();
  };

  const scaleY = () => element.getBoundingClientRect().height / (element.clientHeight || 1) || 1;
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || phase !== 'idle' || element.scrollTop > 0) return;
    held = true; pulling = false; y0 = event.clientY; pointer = event.pointerId;
  };
  const move = (event: PointerEvent) => {
    if (!held || event.pointerId !== pointer) return;
    if (event.clientY < y0) y0 = event.clientY;
    const raw = (event.clientY - y0) / scaleY();
    if (!pulling) {
      if (raw < 6) return;
      pulling = true;
      phase = 'pulling';
      // A pointer that is no longer active (or a scripted one) cannot be captured; the pull still follows it.
      try { (element as HTMLElement & { setPointerCapture?: (id: number) => void }).setPointerCapture?.(event.pointerId); } catch { /* not capturable */ }
    }
    d.x = d.to = rubber(raw - 6);
    d.v = 0;
    kick();
  };
  const up = () => {
    if (!held) return;
    held = false;
    if (!pulling) return;
    pulling = false;
    if (d.x >= state.current.threshold) { phase = 'idle'; void refresh(); return; }
    phase = 'idle';
    d.to = 0;
    kick();
  };
  // Touch scrolling would take the gesture over; while pulling, the page stays put.
  const touch = (event: TouchEvent) => { if (pulling) event.preventDefault(); };
  // A mouse pull over an image or link would start a native drag (cancelling the pull), and over text a selection.
  const noDrag = (event: Event) => { if (held) event.preventDefault(); };

  if (surface) {
    styles.set(element, 'overscroll-behavior-y', 'contain');
    element.appendChild(live);
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', up);
    element.addEventListener('touchmove', touch, { passive: false });
    element.addEventListener('dragstart', noDrag);
    element.addEventListener('selectstart', noDrag);
  } else element.appendChild(live);

  return handle(() => surface, state, () => surface?.refresh(), {
    refresh,
    revealRows,
    get state() { return phase; },
  }, () => {
    phase = 'idle';
    fresh.forEach(item => { item.row.style.opacity = item.opacity; item.row.style.transition = item.transition; });
    fresh = [];
    element.removeEventListener('pointerdown', down);
    element.removeEventListener('pointermove', move);
    element.removeEventListener('pointerup', up);
    element.removeEventListener('pointercancel', up);
    element.removeEventListener('touchmove', touch);
    element.removeEventListener('dragstart', noDrag);
    element.removeEventListener('selectstart', noDrag);
    element.removeAttribute('aria-busy');
    live.remove();
    styles.restore();
  });
}

export const PULL_REFRESH_DEFAULTS = DEFAULTS;
