import type { GlyphFieldOptions } from '../field';
import { clamp, handle, hash, mountSurface, prefersReduced, styleKeeper, type Box, type KitHandle, type KitOptions, type Surface } from './core';

export type LikeMark = 'heart' | 'save';

export interface LikeBurstOptions extends KitOptions {
  /** The shape that bursts: a heart or a bookmark. Default `heart`. */
  kind?: LikeMark;
  /** The icon inside the button the burst grows from and lands back in. Default: its first `svg`. */
  icon?: string;
  /** Clicking toggles `aria-pressed`, bursting on and loosening off. `false` leaves clicks to you. Default true. */
  manage?: boolean;
  /** Nothing is drawn above this element's bottom edge, so the burst never covers the copy above the button. */
  limit?: HTMLElement | null;
  /** CSS pixels the field reaches past the button on every side. Default 40; set at mount. */
  outset?: number;
  /** `under` (default) draws between the button's background and its content, so the count and label stay crisp over the sparks; `over` draws above everything. Set at mount. */
  layer?: 'over' | 'under';
  /** Called after a click toggles the button. */
  onChange?: (pressed: boolean) => void;
}

export interface LikeBurstHandle extends KitHandle<LikeBurstOptions> {
  /** The pop: the mark springs out of the icon in characters, an outline rolls out, sparks fly, and it lands back in the icon. */
  burst(): void;
  /** The soft undo: the filled mark loosens, sinks and thins out. */
  undo(): void;
  /** Sets `aria-pressed`, bursting when it turns on and loosening when it turns off. */
  toggle(pressed?: boolean): void;
  readonly pressed: boolean;
}

const DEFAULTS = { kind: 'heart' as LikeMark, icon: 'svg', manage: true, outset: 40, layer: 'under' as 'over' | 'under' };
const BURST_MS = 560, UNDO_MS = 300;
const grey = (t: number) => { const v = Math.round(clamp(t) * 255); return `rgb(${v} ${v} ${v})`; };
const outCubic = (t: number) => 1 - (1 - clamp(t)) ** 3;
const inOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
/** A damped spring's step response: overshoots by about 17% and settles at 1. */
export const springOut = (t: number) => (t >= 1 ? 1 : 1 - Math.exp(-5 * t) * Math.cos(9 * t));

function shape(pen: CanvasRenderingContext2D, kind: LikeMark, cx: number, cy: number, s: number) {
  pen.beginPath();
  if (kind === 'heart') {
    const k = s / 29;
    for (let i = 0; i <= 56; i++) {
      const t = (i / 56) * Math.PI * 2, x = 16 * Math.sin(t) ** 3, y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
      if (i === 0) pen.moveTo(cx + x * k, cy + (y - 2.5) * k); else pen.lineTo(cx + x * k, cy + (y - 2.5) * k);
    }
  } else {
    const w = s * 0.7, top = cy - s / 2, left = cx - w / 2, r = s * 0.12;
    pen.moveTo(left, top + r); pen.arcTo(left, top, left + r, top, r); pen.lineTo(left + w - r, top); pen.arcTo(left + w, top, left + w, top + r, r);
    pen.lineTo(left + w, cy + s / 2); pen.lineTo(cx, cy + s / 2 - s * 0.27); pen.lineTo(left, cy + s / 2);
  }
  pen.closePath();
}
function fillShape(pen: CanvasRenderingContext2D, kind: LikeMark, cx: number, cy: number, s: number, alpha: number) {
  const grad = pen.createRadialGradient(cx, cy - s * 0.1, 0, cx, cy, s * 0.62);
  grad.addColorStop(0, '#fff'); grad.addColorStop(0.7, '#e6e6e6'); grad.addColorStop(1, '#8c8c8c');
  pen.globalAlpha = alpha;
  pen.fillStyle = grad; pen.shadowColor = '#bbb'; pen.shadowBlur = Math.max(2, s * 0.08);
  shape(pen, kind, cx, cy, s); pen.fill();
  pen.shadowBlur = 0; pen.globalAlpha = 1;
}

/** One burst frame at `t` (0–1) round the icon box `b`. */
export function burstFrame(pen: CanvasRenderingContext2D, kind: LikeMark, b: Box, t: number, seed: number) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, base = b.h, peak = base * 1.45, grow = springOut(t / 0.3), land = inOut(clamp((t - 0.42) / 0.3));
  const size = land > 0 ? peak + (base - peak) * land : base * 0.7 + (peak - base * 0.7) * grow;
  // The pop: one outline of the mark rolling out from 1.2x to 1.7x and fading.
  const rt = clamp((t - 0.04) / 0.46);
  if (rt > 0 && rt < 1) {
    pen.strokeStyle = grey(0.8 * (1 - rt) ** 1.4); pen.lineWidth = 2.4 - 1.2 * rt; pen.lineJoin = 'round';
    shape(pen, kind, cx, cy, base * (1.2 + 0.5 * outCubic(rt))); pen.stroke();
  }
  const sparks = 7;
  pen.fillStyle = '#fff';
  for (let i = 0; i < sparks; i++) {
    const local = (t - 0.1 - hash(i, seed) * 0.05) / 0.5;
    if (local <= 0 || local >= 1) continue;
    const a = -Math.PI / 2 + ((i - (sparks - 1) / 2) / sparks) * Math.PI * 1.7 + (hash(seed + 1, i) - 0.5) * 0.3;
    const d = base * (0.75 + (0.55 + hash(i, seed + 2) * 0.35) * outCubic(local)), r = 1.8 * (1 - local * 0.6);
    pen.globalAlpha = 1 - local * local;
    pen.beginPath(); pen.arc(cx + Math.cos(a) * d * 1.15, cy + Math.sin(a) * d * 0.85, r, 0, Math.PI * 2); pen.fill();
  }
  pen.globalAlpha = 1;
  fillShape(pen, kind, cx, cy, size, 1 - clamp((t - 0.72) / 0.28));
}

/** A like or save button that pops its mark in characters on press and loosens it on undo. */
export function likeBurst(button: HTMLElement, options: LikeBurstOptions = {}): LikeBurstHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  const styles = styleKeeper();
  const icon = () => button.querySelector<HTMLElement>(state.current.icon) ?? button;
  const reduced = () => !!(state.current.reducedMotion ?? prefersReduced());
  let pressed = button.getAttribute('aria-pressed') === 'true', effects: { kind: 'burst' | 'undo'; start: number; seed: number }[] = [];
  let timers: number[] = [], surface: Surface | null = null;
  const look = (): GlyphFieldOptions => ({
    mark: 'glyph', charset: ' .:-=+*#%@', font: '"Geist Mono", ui-monospace, monospace', fontWeight: 500,
    cellSize: 4, cellAspect: 0.62, glyphScale: 0.92, ...state.current.look,
  });

  surface = mountSurface({
    host: button,
    outset: state.current.outset,
    layer: state.current.layer,
    look,
    ink: dark => state.current.ink ?? (state.current.kind === 'heart' ? `var(--ascii-like, ${dark ? '#ff6b70' : '#e5484d'})` : '--ascii-ink-strong'),
    kit: state,
    reducedMotion: () => state.current.reducedMotion,
    onFail: () => { surface = null; },
    paint: ({ pen, w, now, box }) => {
      const b = box(icon()), kind = state.current.kind;
      effects = effects.filter(effect => {
        const t = (now - effect.start) / (effect.kind === 'burst' ? BURST_MS : UNDO_MS);
        if (t >= 1) return false;
        if (t < 0) return true;
        pen.save();
        if (effect.kind === 'burst') burstFrame(pen, kind, b, t, effect.seed);
        else {
          const cx = b.x + b.w / 2, cy = b.y + b.h / 2 + 3 * outCubic(t), s = b.h * (1 + 0.12 * outCubic(t));
          fillShape(pen, kind, cx, cy, s, (1 - t) ** 1.4);
          pen.fillStyle = '#000';
          for (let y = cy - s / 2; y < cy + s / 2; y += 3) for (let x = cx - s / 2; x < cx + s / 2; x += 2) if (hash(x, y) < t * 1.15) pen.fillRect(x, y, 2, 3);
        }
        pen.restore();
        return true;
      });
      const limit = state.current.limit;
      if (limit && effects.length) {
        // Above the copy the field stays empty, with a short fade so nothing ends on a hard edge.
        const l = box(limit), top = l.y + l.h, fade = pen.createLinearGradient(0, top - 2, 0, top + 8);
        fade.addColorStop(0, '#000'); fade.addColorStop(1, 'rgb(0 0 0 / 0)');
        pen.fillStyle = '#000'; pen.fillRect(0, 0, w, top - 2);
        pen.fillStyle = fade; pen.fillRect(0, top - 2, w, 10);
      }
      return effects.length > 0;
    },
  });

  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
  const burst = () => {
    clearTimers();
    styles.restore();
    if (!surface || reduced()) return;
    const now = performance.now(), el = icon();
    effects = effects.filter(e => e.kind !== 'undo');
    effects.push({ kind: 'burst', start: now, seed: Math.floor(now) % 97 });
    // The crisp icon hides while the characters pop, and takes over as they condense into it.
    if (el !== button) styles.set(el, 'opacity', '0');
    timers.push(setTimeout(() => {
      styles.restore();
      // It fades up as it springs from 0.7x, so the hand-over from characters to the crisp icon has no hard cut.
      if (el !== button && typeof el.animate === 'function') el.animate({ opacity: ['0', '1'], scale: ['.7', '1'] }, { duration: 220, easing: 'cubic-bezier(.34, 1.42, .64, 1)' });
    }, BURST_MS * 0.62) as unknown as number);
    surface.kick();
  };
  const undo = () => {
    clearTimers();
    styles.restore();
    if (!surface || reduced()) return;
    effects = effects.filter(e => e.kind !== 'burst');
    effects.push({ kind: 'undo', start: performance.now(), seed: 0 });
    surface.kick();
  };
  const toggle = (next = !pressed) => {
    pressed = next;
    button.setAttribute('aria-pressed', String(pressed));
    if (pressed) burst(); else undo();
  };
  const onClick = () => {
    if (!state.current.manage) return;
    toggle();
    state.current.onChange?.(pressed);
  };
  if (!button.hasAttribute('aria-pressed') && state.current.manage) button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', onClick);

  return handle(() => surface, state, () => surface?.refresh(), {
    burst, undo, toggle,
    get pressed() { return pressed; },
  }, () => {
    clearTimers();
    styles.restore();
    button.removeEventListener('click', onClick);
  });
}

export const LIKE_BURST_DEFAULTS = DEFAULTS;
