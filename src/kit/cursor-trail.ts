import { isGlyphFieldSupported, type GlyphField, type GlyphFieldOptions } from '../field';
import { watchMotionPreference, watchPointer, watchVisibility } from '../field/field-gl';
import { InkTrail } from '../surface/ink-trail';
import { hash, mergeOptions, mountSurface, prefersReduced, resolveColor, type KitHandle, type KitOptions, type PaintFrame, type Surface } from './core';

export type CursorTrailStyle = 'trail' | 'wake' | 'water' | 'sparkle' | 'spray';

export interface CursorTrailOptions extends KitOptions {
  /**
   * `trail` the ink trail of a kit field's `hover: 'trail'` (the wordmark's), `wake` a softer, wider band along the path, `water`
   * rings that spread from it, `sparkle` glints scattered along it, `spray` square patches of diagonal hatching sprayed round the
   * path (a drag draws a hairline selection box). Default `trail`.
   */
  style?: CursorTrailStyle;
  /** Characters from empty to dense; the head of the trail takes the last one. Default ` .:-=+*#%@`. */
  charset?: string;
  /** Cell width in CSS pixels. Default 9. */
  cellSize?: number;
  /** Ms a point of the path takes to fade out, for `wake`, `water` and `sparkle`. Default 800 (`water` 950). */
  life?: number;
  /**
   * The `trail` style's ink, as a kit field's `trail` setting. To match a field's trail exactly, `span` is that field's shorter
   * side and `cell` its longer side / 128, in CSS pixels. Defaults: the wordmark's strength 0.62 and radius 0.22, span 540, cell 15.
   */
  trail?: { strength?: number; radius?: number; span?: number; cell?: number };
  /** Stacking order of the layer. Keep it under your dialogs and sticky header. Default 1000. */
  zIndex?: number;
  /** More elements to stay quiet over, as a selector, on top of inputs, dialogs and `[data-ascii-cursor-skip]`. */
  skip?: string;
  /**
   * Small monospaced coordinate tags (`412, 168`) at the newest patches and a selection box's corner: the ink's text on a
   * translucent wash of the ink (`--ascii-readout-text` overrides the text colour). Decoration, hidden from assistive technology.
   * Default false.
   */
  readout?: boolean;
  /**
   * For `spray`: patches a second that appear on their own across the viewport once the pointer has first moved, with now and
   * then a hairline selection box, so the page keeps a quiet working texture between moves. 0 for none. Default 0.
   */
  ambient?: number;
}

export interface CursorTrailHandle extends KitHandle<CursorTrailOptions> {
  /** True while something is fading on screen. */
  readonly active: boolean;
  /** Drops everything on screen at once. */
  clear(): void;
}

const DEFAULTS = { style: 'trail' as CursorTrailStyle, charset: ' .:-=+*#%@', cellSize: 9, zIndex: 1000 };
const QUIET = 'input, textarea, select, [contenteditable], dialog, [role="dialog"], [role="alertdialog"], [data-ascii-cursor-skip]';
const MAX = { trail: 64, wake: 48, water: 20, sparkle: 140, spray: 90 } as const;
const RES = 0.5;
const TRAIL = { strength: 0.62, radius: 0.22, span: 540, cell: 15 };
/** Samples per ink cell along each side, so the tone is eased after interpolation, as the field's shader does. */
const SUB = 3;

export interface CursorTrailMark { x: number; y: number; t: number; seed: number; vx: number; vy: number }
/** A drag's selection box in viewport pixels; `t` is when the button came up, or 0 while it is held. */
export interface CursorTrailBox { x0: number; y0: number; x1: number; y1: number; t: number }

const grey = (v: number) => { const n = Math.round(Math.max(0, Math.min(1, v)) * 255); return `rgb(${n},${n},${n})`; };

/** The path through the midpoints, so the tail bends with the hand instead of in straight pieces. */
function stroke(pen: CanvasRenderingContext2D, marks: CursorTrailMark[], s: number, now: number, life: number, width: (k: number) => number, level: (k: number) => number) {
  for (let i = 1; i < marks.length; i++) {
    const a = marks[i - 1], b = marks[i], p = marks[i - 2] ?? a;
    const k = 1 - (now - b.t) / life;
    if (k <= 0) continue;
    pen.strokeStyle = grey(level(k));
    pen.lineWidth = Math.max(1, width(k) * s);
    pen.beginPath();
    pen.moveTo(((p.x + a.x) / 2) * s, ((p.y + a.y) / 2) * s);
    pen.quadraticCurveTo(a.x * s, a.y * s, ((a.x + b.x) / 2) * s, ((a.y + b.y) / 2) * s);
    pen.lineTo(b.x * s, b.y * s);
    pen.stroke();
  }
}

/** One frame of `style` into the source canvas: white is the densest character. Exported for tests. */
export function cursorTrailFrame(pen: CanvasRenderingContext2D, marks: CursorTrailMark[], style: CursorTrailStyle, now: number, life: number, cell: number, scale: number) {
  pen.lineCap = 'round';
  pen.lineJoin = 'round';
  pen.globalCompositeOperation = 'lighten';
  if (style === 'trail') {
    stroke(pen, marks, scale, now, life, k => cell * (0.5 + 0.95 * k), k => k ** 1.25);
  } else if (style === 'wake') {
    stroke(pen, marks, scale, now, life, k => cell * (2 + 3.2 * k), k => 0.34 * k ** 1.6);
    stroke(pen, marks, scale, now, life, k => cell * (0.8 + 1.4 * k), k => 0.62 * k ** 1.4);
  } else if (style === 'water') {
    for (const m of marks) {
      const age = now - m.t, k = 1 - age / life;
      if (k <= 0) continue;
      pen.strokeStyle = grey(0.9 * k ** 1.5);
      pen.lineWidth = Math.max(1, cell * (0.45 + 0.5 * k) * scale);
      pen.beginPath();
      pen.arc(m.x * scale, m.y * scale, (cell * 0.8 + age * 0.085) * scale, 0, Math.PI * 2);
      pen.stroke();
    }
  } else if (style === 'spray') {
    // Square patches snapped to the cells, an even tone each: the field's hatching mark turns each into a block of diagonal
    // strokes with a hard edge, a few cells across, that thin away as it fades. The selection box itself is a DOM hairline.
    for (const m of marks) {
      const age = now - m.t, k = 1 - age / life;
      if (k <= 0) continue;
      const n = Math.round(2 + 3 * m.seed), x = Math.round(m.x / cell - n / 2) * cell, y = Math.round(m.y / cell - n / 2) * cell;
      // Each cell of the patch at its own weight, so the hatching breaks into stepped segments as worn print does.
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        pen.fillStyle = grey(0.9 * Math.min(1, k * 1.6) ** 0.8 * (0.55 + 0.45 * hash(m.seed * 97 + i, j * 13.1)));
        pen.fillRect((x + i * cell) * scale, (y + j * cell) * scale, cell * scale, cell * scale);
      }
    }
  } else {
    for (const m of marks) {
      const age = now - m.t, k = 1 - age / life;
      if (k <= 0) continue;
      const glint = 0.55 + 0.45 * Math.sin(age * 0.028 + m.seed * 6.28);
      const size = cell * (0.55 + 0.6 * m.seed) * (0.6 + 0.4 * k) * scale;
      pen.fillStyle = grey(k ** 1.2 * glint);
      pen.fillRect((m.x + m.vx * age) * scale - size / 2, (m.y + m.vy * age) * scale - size / 2, size, size);
    }
  }
  pen.globalCompositeOperation = 'source-over';
}

/**
 * Characters that follow the pointer across the whole page: one fixed, click-through layer drawn by the shared GPU context. Nothing
 * is mounted until the pointer first moves, and nothing draws once the last character has faded, so a still pointer costs nothing.
 * Off on touch-only devices, under reduced motion and while the tab is hidden; quiet over inputs, dialogs and `[data-ascii-cursor-skip]`.
 */
export function cursorTrail(options: CursorTrailOptions = {}): CursorTrailHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  const o = () => state.current;
  const life = () => o().life ?? (o().style === 'water' ? 950 : 800);
  let marks: CursorTrailMark[] = [], box: CursorTrailBox | null = null;
  const tags: HTMLElement[] = [];
  let tagAt = -Infinity, tagNext = 0;
  /** Shows a coordinate tag at a viewport point; the oldest of four is reused. */
  const tag = (x: number, y: number, now: number, slot?: number) => {
    if (!o().readout || !host) return;
    const i = slot ?? (tagNext++ % 6) + 2;
    let el = tags[i];
    if (!el) {
      el = document.createElement('span');
      tags[i] = el;
      host.appendChild(el);
    }
    el.textContent = `${Math.round(x)}, ${Math.round(y)}`;
    el.style.cssText = `position:absolute;left:${Math.round(x)}px;top:${Math.round(y - 14)}px;padding:0 4px;font:500 9px/14px ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.02em;white-space:nowrap;${readoutInk()};opacity:1;transition:opacity ${life()}ms linear ${life() * 0.8}ms`;
    tagAt = now;
    // Next frame, start the fade: the transition runs from full to clear over the marks' life.
    requestAnimationFrame?.(() => { if (el) el.style.opacity = '0'; });
  };
  const inkColor = () => resolveColor(o().ink ?? '--ascii-ink', document.body, '#1d1d1b') ?? '#1d1d1b';
  const readoutInk = () => { const ink = inkColor(); return `color:var(--ascii-readout-text,${ink});background:color-mix(in srgb,${ink} 28%,transparent)`; };
  /** Hairline selection boxes: slot 0 follows a drag, the others are ambient. Each carries its corner tag. */
  const frames: HTMLElement[] = [];
  const frameBox = (slot: number, x0: number, y0: number, x1: number, y1: number, fade: boolean) => {
    if (!host) return;
    let el = frames[slot];
    if (!el) { el = frames[slot] = document.createElement('div'); host.appendChild(el); }
    const x = Math.min(x0, x1), y = Math.min(y0, y1);
    el.style.cssText = `position:absolute;left:${Math.round(x)}px;top:${Math.round(y)}px;width:${Math.round(Math.abs(x1 - x0))}px;height:${Math.round(Math.abs(y1 - y0))}px;border:1px solid color-mix(in srgb,${inkColor()} 55%,transparent);box-sizing:border-box;opacity:1;transition:opacity ${life()}ms linear ${life()}ms`;
    if (fade) requestAnimationFrame?.(() => { if (el) el.style.opacity = '0'; });
  };
  const dropTags = () => { for (const el of tags) el?.remove(); tags.length = 0; for (const el of frames) el?.remove(); frames.length = 0; };
  let surface: Surface | null = null, host: HTMLElement | null = null, failed = false, destroyed = false, paused = false, last = 0;
  const ok = typeof document !== 'undefined' && typeof window !== 'undefined' && isGlyphFieldSupported();
  const touchOnly = () => typeof matchMedia === 'function' && matchMedia('(hover: none)').matches && matchMedia('(pointer: coarse)').matches;
  const reduced = () => !!(o().reducedMotion ?? prefersReduced());
  const quiet = (target: EventTarget | null) => {
    const el = target as Element | null;
    if (!el?.closest) return false;
    return !!el.closest(o().skip ? `${QUIET}, ${o().skip}` : QUIET);
  };

  // `trail` takes the wordmark's own glyphs, so its tail and a field's trail read as one.
  const look = (): GlyphFieldOptions => ({
    mark: 'glyph', charset: o().charset, cellSize: o().cellSize,
    ...(o().style === 'trail' ? { font: '"Geist", Arial, sans-serif', fontWeight: 500, cellAspect: 0.8, glyphScale: 0.8, shade: 0, levels: 'none' as const }
      : o().style === 'spray' ? { mark: 'engraving' as const, markAngle: -45, cellAspect: 1, shade: 0, sample: 'point' as const } : { cellAspect: 0.62, glyphScale: 0.92, shade: 0.6 }),
    contrast: 1, ...o().look,
  });
  const ink = { trail: null as InkTrail | null, cols: 0, rows: 0, at: 0, moved: 0, lit: false, art: null as HTMLCanvasElement | null };
  const trailOf = () => ({ ...TRAIL, ...o().trail });
  const inkGrid = () => {
    const { cell, span } = trailOf(), w = window.innerWidth || 1280, h = window.innerHeight || 800;
    const cols = Math.ceil(w / cell) + 2, rows = Math.ceil(h / cell) + 2;
    if (!ink.trail || ink.cols !== cols || ink.rows !== rows || ink.trail.span !== span / cell) {
      ink.trail = new InkTrail(cols, rows, span / cell);
      ink.cols = cols; ink.rows = rows;
    }
    return ink.trail;
  };
  const paintInk = ({ pen, now, scale }: PaintFrame) => {
    const trail = inkGrid();
    // A frame's timestamp can be earlier than the move that asked for it: that step is empty, not negative.
    const dt = ink.at ? Math.max(0, now - ink.at) / 1000 : 1 / 60;
    ink.at = Math.max(ink.at, now);
    trail.step(dt);
    if (!trail.active) { ink.at = 0; return (ink.lit = false); }
    const { cols, rows } = ink, { strength, cell } = trailOf(), d = trail.pixels;
    const art = (ink.art ??= document.createElement('canvas'));
    const sw = cols * SUB, sh = rows * SUB;
    if (art.width !== sw || art.height !== sh) { art.width = sw; art.height = sh; }
    const p = art.getContext('2d');
    if (!p) { ink.at = 0; return (ink.lit = false); }
    const image = p.createImageData(sw, sh), out = image.data;
    const at = (i: number) => (d[i * 4] * 256 + d[i * 4 + 1]) / 65535;
    let peak = 0;
    for (let y = 0; y < sh; y++) {
      const fy = Math.min(rows - 1.001, Math.max(0, (y + 0.5) / SUB - 0.5)), iy = fy | 0, ty = fy - iy;
      for (let x = 0; x < sw; x++) {
        const fx = Math.min(cols - 1.001, Math.max(0, (x + 0.5) / SUB - 0.5)), ix = fx | 0, tx = fx - ix, i = iy * cols + ix;
        const density = ((at(i) * (1 - tx) + at(i + 1) * tx) * (1 - ty) + (at(i + cols) * (1 - tx) + at(i + cols + 1) * tx) * ty) * strength;
        const t = Math.min(1, density / 0.38), tone = t * t * (3 - 2 * t);
        if (tone > peak) peak = tone;
        const n = Math.round(tone * 255), k = (y * sw + x) * 4;
        out[k] = out[k + 1] = out[k + 2] = n; out[k + 3] = 255;
      }
    }
    // Below a twentieth nothing but the charset's blank would show: once the pointer has rested, the trail is done and the page idles.
    if (peak < 0.05 && now - ink.moved > 150) { trail.clear(); ink.at = 0; return (ink.lit = false); }
    p.putImageData(image, 0, 0);
    pen.imageSmoothingEnabled = true;
    // Ink cell i is centred on pixel i * cell.
    pen.drawImage(art, (-cell / 2) * scale, (-cell / 2) * scale, cols * cell * scale, rows * cell * scale);
    return (ink.lit = true);
  };
  const place = (el: HTMLElement) => {
    el.style.cssText = `position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:${o().zIndex};contain:strict`;
  };
  const paint = (frame: PaintFrame) => {
    if (o().style === 'trail') return paintInk(frame);
    const { pen, now, scale } = frame;
    const span = life();
    marks = marks.filter(m => now - m.t < span);
    if (box && box.t && now - box.t > span) box = null;
    if (!marks.length && !box) return false;
    cursorTrailFrame(pen, marks, o().style, now, span, o().cellSize, scale);
    return true;
  };
  const mount = () => {
    if (surface || failed || destroyed || !ok) return;
    host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.dataset.asciiCursor = '';
    place(host);
    document.body.appendChild(host);
    surface = mountSurface({
      host,
      kit: { get current() { return { lazy: false, globalLook: o().globalLook ?? false }; } },
      look,
      ink: () => o().ink ?? '--ascii-ink',
      resolution: RES,
      paint,
      reducedMotion: () => o().reducedMotion,
      onFail: () => { failed = true; surface = null; host?.remove(); host = null; },
    });
    if (!surface) { failed = true; host.remove(); host = null; }
  };

  const move = (event: PointerEvent) => {
    if (destroyed || paused || event.pointerType === 'touch' || touchOnly() || reduced() || quiet(event.target)) { ink.trail?.leave(); return; }
    const now = performance.now(), x = event.clientX, y = event.clientY, style = o().style;
    if (style === 'trail') {
      const { cell, radius } = trailOf();
      const trail = inkGrid();
      ink.at ||= now;
      ink.moved = now;
      trail.move(x / (cell * (ink.cols - 1)), y / (cell * (ink.rows - 1)), radius, now);
      ink.lit = true;
      mount();
      surface?.kick();
      return;
    }
    if (style === 'spray') {
      const held = (event.buttons & 1) === 1;
      if (held) {
        if (!box || box.t) { box = { x0: x, y0: y, x1: x, y1: y, t: 0 }; mount(); }
        box.x1 = x; box.y1 = y;
        frameBox(0, box.x0, box.y0, x, y, false);
        tag(Math.min(box.x0, x), Math.min(box.y0, y), now, 0);
        if (tags[0]) tags[0].style.opacity = '1';
      } else if (box && !box.t) { box.t = now; fadeDrag(); }
    }
    const prev = marks[marks.length - 1];
    const gap = prev ? Math.hypot(x - prev.x, y - prev.y) : Infinity;
    // Rings and glints are spaced out; the path keeps every move that goes somewhere.
    if (style === 'water' ? gap < o().cellSize * 2.6 && now - last < 90 : style === 'spray' ? gap < o().cellSize * 2.2 : gap < 2) { if (box) surface?.kick(); return; }
    last = now;
    if (style === 'sparkle') {
      for (let i = 0; i < 2; i++) {
        const seed = hash(now + i * 17, x + y), turn = hash(y + i, now) * Math.PI * 2, reach = o().cellSize * 1.4 * hash(x, now + i);
        marks.push({ x: x + Math.cos(turn) * reach, y: y + Math.sin(turn) * reach, t: now, seed, vx: Math.cos(turn) * 0.012, vy: Math.sin(turn) * 0.012 + 0.01 });
      }
    } else if (style === 'spray') {
      const turn = hash(now, x) * Math.PI * 2, reach = o().cellSize * 2.6 * hash(y, now);
      marks.push({ x: x + Math.cos(turn) * reach, y: y + Math.sin(turn) * reach, t: now, seed: hash(x + now, y), vx: 0, vy: 0 });
      if (!box && now - tagAt > 140) { mount(); const m = marks[marks.length - 1]; tag(m.x, m.y, now); }
      startAmbient();
    } else marks.push({ x, y, t: now, seed: 0, vx: 0, vy: 0 });
    while (marks.length > MAX[style]) marks.shift();
    mount();
    surface?.kick();
  };

  const dropAll = () => { marks = []; box = null; dropTags(); ink.trail?.clear(); ink.lit = false; ink.at = 0; };

  const fadeDrag = () => { const el = frames[0]; if (el) el.style.opacity = '0'; if (tags[0]) tags[0].style.opacity = '0'; };
  const release = () => { if (box && !box.t) { box.t = performance.now(); fadeDrag(); surface?.kick(); } };
  // Ambient spray: patches (and now and then a box) at random places, paced by `ambient`, while the page is visible.
  let ambientTimer: ReturnType<typeof setTimeout> | undefined, ambientBox = 1;
  const startAmbient = () => {
    if (ambientTimer !== undefined || !(o().ambient! > 0) || o().style !== 'spray') return;
    const tick = () => {
      ambientTimer = undefined;
      const rate = o().ambient ?? 0;
      if (destroyed || paused || !(rate > 0) || o().style !== 'spray') return;
      ambientTimer = setTimeout(tick, 1000 / rate);
      if (reduced() || (typeof document !== 'undefined' && document.hidden) || !host) return;
      const now = performance.now(), w = window.innerWidth || 1280, h = window.innerHeight || 800;
      const x = hash(now, 3.1) * w, y = hash(now, 7.7) * h;
      // Ambient patches linger about twice as long as the pointer's: born a little in the future, they hold full before fading.
      marks.push({ x, y, t: now + life() * 0.8, seed: hash(now, 1.9), vx: 0, vy: 0 });
      while (marks.length > MAX.spray) marks.shift();
      if (hash(now, 5.3) < 0.5) tag(x, y, now);
      if (hash(now, 9.1) < 0.2) {
        const bw = 120 + 240 * hash(now, 2.2), bh = 80 + 140 * hash(now, 4.4);
        ambientBox = ambientBox % 2 + 1;
        frameBox(ambientBox, x, y, x + bw, y + bh, true);
        tag(x, y, now);
      }
      surface?.kick();
    };
    ambientTimer = setTimeout(tick, 1000 / (o().ambient ?? 1));
  };
  const stopAmbient = () => { clearTimeout(ambientTimer); ambientTimer = undefined; };
  if (ok) window.addEventListener('pointerup', release, true);
  const unwatch = ok ? [
    () => window.removeEventListener('pointerup', release, true),
    watchPointer({ target: window, move, leave() {} }),
    watchVisibility(() => { if (document.hidden) dropAll(); }),
    watchMotionPreference(() => { if (reduced()) dropAll(); surface?.kick(); }),
  ] : [];

  return {
    get supported() { return ok && !failed && !destroyed; },
    get field(): GlyphField | null { return destroyed ? null : surface?.field ?? null; },
    get active() { return marks.length > 0 || !!box || ink.lit; },
    clear() { dropAll(); surface?.kick(); },
    update(next) {
      if (destroyed) return;
      const style = o().style;
      state.current = { ...DEFAULTS, ...mergeOptions<CursorTrailOptions>(state.current, next) };
      if (o().style !== style) dropAll();
      stopAmbient();
      if (host) startAmbient();
      if (host) place(host);
      surface?.refresh();
    },
    play() { if (!destroyed) { paused = false; surface?.play(); } },
    pause() { if (!destroyed) { paused = true; dropAll(); surface?.pause(); } },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopAmbient();
      for (const off of unwatch) off();
      dropAll();
      surface?.destroy();
      surface = null;
      host?.remove();
      host = null;
    },
  };
}
