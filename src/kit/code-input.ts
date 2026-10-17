import type { GlyphFieldOptions } from '../field';
import { clamp, handle, hash, house, mountSurface, prefersReduced, styleKeeper, type Box, type KitHandle, type KitOptions, type Surface } from './core';

export type CodeState = 'idle' | 'error' | 'success';

export interface CodeInputOptions extends KitOptions {
  /** How many characters the code has. Default 6. */
  length?: number;
  /** `digits` keeps only 0–9; `alphanumeric` keeps letters too, upper-cased. Default `digits`. */
  accept?: 'digits' | 'alphanumeric';
  /** The cells. Missing cells are created as `span[data-cell]`. Default `[data-cell]`. */
  cells?: string;
  /** Called once every cell is filled and has resolved. Answer with `verify(ok)`. */
  onComplete?: (code: string) => void;
}

export interface CodeInputHandle extends KitHandle<CodeInputOptions> {
  /** `true`: the digits gather into the middle and a check draws in a ring. `false`: they break up, the row shakes, and it clears. */
  verify(ok: boolean): void;
  /** Empties the code and returns to idle. */
  clear(): void;
  /** Enters a whole code, as a paste or an autofill would: the characters resolve one after another. */
  fill(code: string): void;
  readonly value: string;
  readonly state: CodeState;
}

const DEFAULTS = { length: 6, accept: 'digits' as const, cells: '[data-cell]' };
const RESOLVE_MS = 300, ERROR_MS = 560, SUCCESS_MS = 700, SCALE = 2;
const grey = (t: number) => { const v = Math.round(clamp(t) * 255); return `rgb(${v} ${v} ${v})`; };
const outCubic = (t: number) => 1 - (1 - clamp(t)) ** 3;

/** Keeps only what the code accepts, up to `length`. */
export const cleanCode = (raw: string, length: number, accept: 'digits' | 'alphanumeric' = 'digits') =>
  (accept === 'digits' ? raw.replace(/\D/g, '') : raw.replace(/[^a-z\d]/gi, '').toUpperCase()).slice(0, length);

/**
 * A one-time-code field: each digit resolves out of scattered characters, the caret is a breathing column of characters,
 * a wrong code breaks up and shakes, and a right one gathers into a check in a ring.
 */
export function codeInput(element: HTMLElement, options: CodeInputOptions = {}): CodeInputHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  const styles = styleKeeper(), digitStyles = styleKeeper(), made: HTMLElement[] = [];
  const reduced = () => !!(state.current.reducedMotion ?? prefersReduced());
  const length = () => Math.max(1, Math.round(state.current.length));
  let value = '', phase: CodeState = 'idle', focused = false, resolve: number[] = [], err = '', errAt = -1e9, ok = '', okAt = -1e9, okBoxes: Box[] = [];
  let timers: number[] = [], stagger = 0, surface: Surface | null = null;
  const art = new Map<string, HTMLCanvasElement>();

  if (getComputedStyle(element).position === 'static') styles.set(element, 'position', 'relative');
  let input = element.querySelector('input');
  if (!input) {
    input = document.createElement('input');
    input.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0;border:0;opacity:0;font-size:16px;cursor:text');
    element.appendChild(input);
    made.push(input);
  }
  const field = input;
  field.setAttribute('inputmode', state.current.accept === 'digits' ? 'numeric' : 'text');
  field.setAttribute('autocomplete', 'one-time-code');
  field.setAttribute('maxlength', String(length()));
  if (state.current.accept === 'digits') field.setAttribute('pattern', '[0-9]*');
  if (!field.hasAttribute('aria-label') && !field.hasAttribute('aria-labelledby')) field.setAttribute('aria-label', `Verification code, ${length()} ${state.current.accept === 'digits' ? 'digits' : 'characters'}`);

  const cells = () => {
    const list = [...element.querySelectorAll<HTMLElement>(state.current.cells)];
    while (list.length < length()) {
      const cell = document.createElement('span');
      cell.dataset.cell = '';
      cell.setAttribute('aria-hidden', 'true');
      if (field.parentElement === element) element.insertBefore(cell, field); else element.appendChild(cell);
      made.push(cell);
      list.push(cell);
    }
    return list.slice(0, length());
  };
  const digitOf = (cell: HTMLElement) => {
    let d = cell.querySelector<HTMLElement>('[data-digit]');
    if (!d) { d = document.createElement('span'); d.dataset.digit = ''; cell.appendChild(d); made.push(d); }
    return d;
  };

  /** A character drawn once per cell size, white on black, for the field to resolve. */
  const glyph = (ch: string, w: number, h: number, font: string) => {
    const key = `${ch}|${Math.round(w)}x${Math.round(h)}|${font}`;
    let c = art.get(key);
    if (!c) {
      c = document.createElement('canvas');
      c.width = Math.max(2, Math.round(w * 2)); c.height = Math.max(2, Math.round(h * 2));
      const pen = c.getContext('2d');
      if (pen) {
        pen.scale(2, 2);
        pen.fillStyle = '#fff'; pen.shadowColor = '#fff'; pen.shadowBlur = 3;
        pen.font = `600 ${Math.round(h * 0.6)}px ${font}`;
        pen.textAlign = 'center'; pen.textBaseline = 'middle';
        pen.fillText(ch, w / 2, h / 2 + 1);
      }
      art.set(key, c);
    }
    return c;
  };
  /** A character partway in: blocks of it arrive in a scattered order, jittering until they land. */
  const digit = (pen: CanvasRenderingContext2D, ch: string, b: Box, k: number, step: number, index: number, font: string, alpha = 1, dx = 0, dy = 0, scale = 1) => {
    const c = glyph(ch, b.w, b.h, font);
    pen.globalAlpha = alpha;
    const w = b.w * scale, h = b.h * scale, ox = b.x + (b.w - w) / 2 + dx, oy = b.y + (b.h - h) / 2 + dy;
    for (let y = 0; y < b.h; y += 4) for (let x = 0; x < b.w; x += 3) {
      if (hash(x + index * 31, y) > k * 1.3 - 0.12) continue;
      const j = (1 - k) * 3;
      pen.drawImage(c, x * 2, y * 2, 6, 8, ox + x * scale + (hash(x, y + step) - 0.5) * j, oy + y * scale + (hash(y, x + step) - 0.5) * j, 3 * scale, 4 * scale);
    }
    pen.globalAlpha = 1;
  };
  const check = (pen: CanvasRenderingContext2D, cx: number, cy: number, c: number) => {
    if (c <= 0) return;
    const pts = [[cx - 20, cy + 1], [cx - 7, cy + 14], [cx + 21, cy - 14]], l1 = Math.hypot(13, 13), l2 = Math.hypot(28, 28);
    let left = c * (l1 + l2);
    pen.strokeStyle = '#fff'; pen.lineWidth = 8; pen.lineCap = 'round'; pen.lineJoin = 'round'; pen.shadowColor = '#fff'; pen.shadowBlur = 4;
    pen.beginPath(); pen.moveTo(pts[0][0], pts[0][1]);
    const a = Math.min(1, left / l1);
    pen.lineTo(pts[0][0] + (pts[1][0] - pts[0][0]) * a, pts[0][1] + (pts[1][1] - pts[0][1]) * a);
    left -= l1;
    if (left > 0) { const q = Math.min(1, left / l2); pen.lineTo(pts[1][0] + (pts[2][0] - pts[1][0]) * q, pts[1][1] + (pts[2][1] - pts[1][1]) * q); }
    pen.stroke();
    pen.shadowBlur = 0;
  };
  const show = (cell: HTMLElement, on: boolean) => { cell.toggleAttribute('data-shown', on); digitStyles.set(digitOf(cell), 'opacity', on ? '1' : '0'); };
  const look = (): GlyphFieldOptions => ({
    mark: 'glyph', charset: ' .:-=+*#%@', font: '"Geist Mono", ui-monospace, monospace', fontWeight: 500,
    cellSize: 4, cellAspect: 0.62, glyphScale: 0.92, ...state.current.look,
  });

  surface = mountSurface({
    host: element,
    outset: 16,
    look,
    ink: () => state.current.ink ?? '--ascii-ink-strong',
    kit: state,
    reducedMotion: () => state.current.reducedMotion,
    resolution: SCALE,
    onFail: () => { surface = null; digitStyles.restore(); cells().forEach(c => show(c, true)); },
    paint: ({ pen, w, h, now, still, box }) => {
      pen.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      const all = cells(), step = still ? 0 : Math.floor(now / 110), font = getComputedStyle(element).fontFamily || 'sans-serif';
      const since = now - okAt;
      if (phase === 'success') {
        const t = still ? 1 : since / SUCCESS_MS, cx = w / 2, cy = h / 2;
        all.forEach(c => show(c, false));
        if (t < 0.55) {
          // The digits are drawn in toward the middle, accelerating, and shrink as they arrive.
          const q = (t / 0.55) ** 2;
          okBoxes.forEach((b, i) => ok[i] && digit(pen, ok[i], b, 1, step, i, font, 1 - q ** 3, (cx - b.x - b.w / 2) * q, (cy - b.y - b.h / 2) * q, 1 - 0.65 * q));
        }
        const rt = clamp((t - 0.45) / 0.55);
        if (rt > 0 && rt < 1) { pen.strokeStyle = grey(0.55 * (1 - rt)); pen.lineWidth = 3; pen.beginPath(); pen.arc(cx, cy, 18 + 44 * outCubic(rt), 0, Math.PI * 2); pen.stroke(); }
        check(pen, cx, cy + 1, house(clamp((t - 0.4) / 0.45)));
        return t < 1;
      }
      let moving = false;
      const e = now - errAt;
      all.forEach((cell, i) => {
        const b = box(cell), ch = value[i];
        if (e < ERROR_MS && err[i]) { show(cell, false); digit(pen, err[i], b, 1 - e / ERROR_MS, step, i, font); moving = true; return; }
        if (ch) {
          const k = still ? 1 : (now - resolve[i]) / RESOLVE_MS;
          show(cell, k >= 0.7);
          if (k >= 1) return;
          moving = true;
          if (k > 0) digit(pen, ch, b, k, step, i, font, k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1);
          return;
        }
        show(cell, false);
        if (focused && i === value.length && e >= ERROR_MS) {
          // The caret: a faint column of characters that breathes slowly instead of blinking.
          const breath = still ? 0.6 : 0.5 - 0.5 * Math.cos((now / 1600) * Math.PI * 2);
          pen.fillStyle = grey(0.2 + 0.26 * breath);
          pen.beginPath(); pen.roundRect(b.x + b.w / 2 - 1.5, b.y + b.h / 2 - 11, 3, 22, 1.5); pen.fill();
          moving = true;
        }
      });
      return moving;
    },
  });

  const later = (ms: number, run: () => void) => { timers.push(setTimeout(run, ms) as unknown as number); };
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
  const sync = () => {
    element.dataset.state = phase;
    if (phase === 'error') field.setAttribute('aria-invalid', 'true'); else field.removeAttribute('aria-invalid');
    const active = focused && phase !== 'success' ? Math.min(value.length, length() - 1) : -1;
    cells().forEach((cell, i) => {
      digitOf(cell).textContent = value[i] ?? '';
      cell.toggleAttribute('data-active', i === active);
      if (!surface) show(cell, true);
      if (phase === 'success' && surface) { styles.set(cell, 'transition', 'opacity 200ms, scale 240ms cubic-bezier(.16, 1, .3, 1)'); styles.set(cell, 'opacity', '0'); styles.set(cell, 'scale', '.86'); }
      else { cell.style.removeProperty('opacity'); cell.style.removeProperty('scale'); }
    });
    if (field.value !== value) field.value = value;
    surface?.kick();
  };

  const accept = (raw: string) => {
    clearTimers();
    if (phase !== 'idle') { phase = 'idle'; okAt = -1e9; }
    err = ''; errAt = -1e9;
    const next = cleanCode(raw, length(), state.current.accept), now = performance.now();
    let n = 0;
    for (let i = 0; i < next.length; i++) if (next[i] !== value[i]) resolve[i] = reduced() ? -1e9 : now + stagger * n++;
    value = next;
    sync();
    if (next.length === length()) later(reduced() || !surface ? 0 : RESOLVE_MS + stagger * Math.max(0, n - 1) + 80, () => state.current.onComplete?.(next));
    stagger = 0;
  };
  const verify = (good: boolean) => {
    clearTimers();
    const now = performance.now();
    if (good) {
      ok = value;
      okBoxes = surface ? cells().map(cell => surface!.box(cell)) : [];
      okAt = now; phase = 'success';
      sync();
      return;
    }
    err = value; errAt = reduced() || !surface ? now - ERROR_MS : now;
    phase = 'error';
    sync();
    if (!reduced() && typeof element.animate === 'function') {
      element.animate([{ translate: '0' }, { translate: '-9px' }, { translate: '7px' }, { translate: '-4px' }, { translate: '2px' }, { translate: '0' }], { duration: 380, easing: 'ease-out' });
    }
    const wrong = value;
    later(reduced() || !surface ? 0 : ERROR_MS, () => { if (err === wrong) { err = ''; value = ''; sync(); } });
  };
  const clear = () => { clearTimers(); err = ''; errAt = -1e9; okAt = -1e9; value = ''; phase = 'idle'; sync(); };

  const onInput = () => accept(field.value);
  const onPaste = () => { stagger = 55; };
  const onFocus = () => { focused = true; sync(); };
  const onBlur = () => { focused = false; sync(); };
  field.addEventListener('input', onInput);
  field.addEventListener('paste', onPaste);
  field.addEventListener('focus', onFocus);
  field.addEventListener('blur', onBlur);
  if (field.value) accept(field.value); else sync();

  return handle(() => surface, state, () => { field.setAttribute('maxlength', String(length())); sync(); surface?.refresh(); }, {
    verify, clear,
    fill(code: string) { stagger = 55; accept(code); },
    get value() { return value; },
    get state() { return phase; },
  }, () => {
    clearTimers();
    field.removeEventListener('input', onInput);
    field.removeEventListener('paste', onPaste);
    field.removeEventListener('focus', onFocus);
    field.removeEventListener('blur', onBlur);
    digitStyles.restore();
    styles.restore();
    for (const el of made) el.remove();
    for (const cell of element.querySelectorAll<HTMLElement>(state.current.cells)) { cell.removeAttribute('data-shown'); cell.removeAttribute('data-active'); }
    delete element.dataset.state;
  });
}

export const CODE_INPUT_DEFAULTS = DEFAULTS;
