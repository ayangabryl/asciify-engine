import type { GlyphFieldOptions } from '../field';
import { handle, mixHex, mountSurface, resolveColor, type KitHandle, type KitOptions, type Surface } from './core';

export type OrbState = 'idle' | 'loading' | 'success' | 'warning' | 'error';
type Outcome = 'success' | 'warning' | 'error';

export interface StatusOrbOptions extends KitOptions {
  /** Tint the characters with the outcome's colour. Default true. */
  colourByState?: boolean;
  /** Close the orbit into a ring around the mark; false leaves the bare mark. Default true. */
  ring?: boolean;
  /** Outcome colours: CSS colours or custom properties. Defaults read `--ascii-success`, `--ascii-warning` and `--ascii-error`. */
  colors?: Partial<Record<Outcome, string>>;
}

export interface StatusOrbHandle extends KitHandle<StatusOrbOptions> {
  idle(): void;
  loading(): void;
  success(): void;
  warning(): void;
  error(): void;
  readonly state: OrbState;
}

const DEFAULTS = { colourByState: true, ring: true };
const COLORS: Record<Outcome, [string, string, string]> = {
  success: ['--ascii-success', '#17844a', '#3ccf7e'],
  warning: ['--ascii-warning', '#9a6700', '#f5b83d'],
  error: ['--ascii-error', '#c93636', '#ff6b6b'],
};
const SIZE = 240, C = SIZE / 2, R = 78, MORPH = 280, WAVE = 520, INK_EASE = 200;
const TAIL = 3.4, TURN = Math.PI * 2, SPIN = TURN / 1050, CLOSED = 0.72;
const settle = (t: number) => 1 - (1 - t) ** 4;
const smooth = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const gray = (tone: number) => `rgb(${tone * 255} ${tone * 255} ${tone * 255})`;
const headAt = (t: number) => t * SPIN - Math.PI / 2;
const radiusAt = (t: number, k = 0) => R + Math.sin((t / 1600) * TURN) * 5 * (1 - k);

function ring(pen: CanvasRenderingContext2D, tone: number, radius = R, width = 24) {
  pen.strokeStyle = gray(tone); pen.lineWidth = width;
  pen.beginPath(); pen.arc(C, C, radius, 0, TURN); pen.stroke();
}

/** A bright head with a fading tail over a dim breathing ring; `close` grows the tail round until it meets the head. */
function orbit(pen: CanvasRenderingContext2D, head: number, radius: number, close = 0, fade = 1) {
  ring(pen, (0.3 + (radius - R) / 100) * fade, radius, 24 - 6 * close);
  if (close >= 1) { ring(pen, CLOSED * fade, radius, 18); return; }
  const length = TAIL + (TURN - TAIL) * close;
  pen.lineCap = 'round';
  for (let i = 0; i < 32; i++) {
    const k = i / 32, tone = 0.3 + 0.7 * (1 - k) ** 1.6;
    pen.strokeStyle = gray((tone + (CLOSED - tone) * close) * fade);
    pen.lineWidth = 28 - k * 6 + (18 - (28 - k * 6)) * close;
    pen.beginPath(); pen.arc(C, C, radius, head - (k + 1 / 32) * length, head - k * length); pen.stroke();
  }
}

/** The outcome's mark stroked from 0 to `k`. */
function mark(pen: CanvasRenderingContext2D, kind: Outcome, k: number, width = 30) {
  pen.strokeStyle = '#fff'; pen.lineWidth = width; pen.lineCap = 'round'; pen.lineJoin = 'round';
  const path = (points: number[][], p: number) => {
    const lengths = points.slice(1).map((pt, i) => Math.hypot(pt[0] - points[i][0], pt[1] - points[i][1]));
    let left = p * lengths.reduce((a, b) => a + b, 0);
    pen.beginPath(); pen.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length && left > 0; i++) {
      const f = Math.min(1, left / lengths[i - 1]);
      pen.lineTo(points[i - 1][0] + (points[i][0] - points[i - 1][0]) * f, points[i - 1][1] + (points[i][1] - points[i - 1][1]) * f);
      left -= lengths[i - 1];
    }
    pen.stroke();
  };
  if (kind === 'success') path([[C - 34, C + 2], [C - 10, C + 26], [C + 36, C - 24]], k);
  else if (kind === 'warning') {
    pen.lineWidth = width - 4;
    path([[C, C - 46], [C, C - 6]], Math.min(1, k / 0.7));
    if (k > 0.7) { pen.fillStyle = '#fff'; pen.beginPath(); pen.arc(C, C + 32, (width / 2) * settle((k - 0.7) / 0.3), 0, TURN); pen.fill(); }
  } else { path([[C - 28, C - 28], [C + 28, C + 28]], k); path([[C + 28, C - 28], [C - 28, C + 28]], k); }
}

/** One orb frame: `t` the clock, `e` ms since the outcome landed, `head` where the orbit's head was then. */
export function orbFrame(pen: CanvasRenderingContext2D, state: OrbState, t: number, e = MORPH + WAVE, head = 0, withRing = true) {
  if (state === 'idle') { ring(pen, 0.34); return; }
  if (state === 'loading') { orbit(pen, headAt(t), radiusAt(t)); return; }
  // The head keeps its speed and eases to a stop over MORPH, so the sweep never jumps from the loader's last frame.
  const k = smooth(Math.min(1, e / MORPH)), still = Math.min(e, MORPH), turn = head + SPIN * (still - (still * still) / (2 * MORPH));
  if (withRing) orbit(pen, turn, radiusAt(t, k), k);
  else if (k < 1) orbit(pen, turn, radiusAt(t, k), 0, 1 - k);
  const wave = (e - MORPH * 0.7) / WAVE;
  if (withRing && wave > 0 && wave < 1) ring(pen, 0.5 * (1 - wave) ** 2, R + 10 + wave * 24, 16 - wave * 8);
  mark(pen, state, settle(Math.min(1, Math.max(0, (e - 40) / (MORPH - 20)))), withRing ? 24 : 30);
}

/** An orb of characters: it orbits while work runs, then closes into a ring around a check, '!' or X, tinted by the outcome. */
export function statusOrb(element: HTMLElement, options: StatusOrbOptions = {}): StatusOrbHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  let phase: OrbState = 'idle', at = 0, head = 0, inkFrom = '', inkTo = '', inkAt = -1e9, inkShown = '', surface: Surface | null = null;
  const look = (): GlyphFieldOptions => ({
    mark: 'glyph', fit: 'contain', charset: ' .:-=+*#%@', cellSize: 5, cellAspect: 0.62, glyphScale: 0.94,
    font: '"Geist Mono", ui-monospace, monospace', fontWeight: 600, contrast: 1.1, shade: 0.5, ...state.current.look,
  });
  const neutral = (dark: boolean) => resolveColor(state.current.ink ?? '--ascii-ink-strong', element, dark ? '#d8d6cf' : '#1d1d1b')!;
  const target = (dark: boolean) => {
    if (!state.current.colourByState || phase === 'idle' || phase === 'loading') return neutral(dark);
    const [token, light, night] = COLORS[phase];
    return resolveColor(state.current.colors?.[phase] ?? token, element, dark ? night : light)!;
  };

  surface = mountSurface({
    host: element,
    look,
    ink: dark => target(dark),
    kit: state,
    reducedMotion: () => state.current.reducedMotion,
    resolution: () => [SIZE, SIZE],
    onFail: () => { surface = null; },
    onTheme: () => { inkAt = -1e9; inkShown = ''; },
    paint: ({ pen, now, still, dark }) => {
      const e = now - at;
      orbFrame(pen, phase, still ? 380 : now, still ? MORPH + WAVE : e, head, state.current.ring);
      // The ink eases to the outcome's colour over INK_EASE ms.
      const to = target(dark);
      if (to !== inkTo) { inkFrom = inkTo || to; inkTo = to; inkAt = now; }
      const k = still ? 1 : settle(Math.min(1, (now - inkAt) / INK_EASE));
      const ink = k < 1 ? mixHex(inkFrom, inkTo, k) : inkTo;
      if (ink !== inkShown) { inkShown = ink; surface?.field.update({ ink }); }
      return phase === 'loading' || e < MORPH + WAVE || k < 1;
    },
  });

  const show = (next: OrbState) => {
    const now = performance.now();
    if (phase === 'loading' && next !== 'loading') head = headAt(now);
    phase = next; at = now;
    element.dataset.state = next;
    if (next === 'error' && surface && !surface.still() && typeof element.animate === 'function') {
      element.animate({ translate: ['0', '-5px 0', '4px 0', '-2px 0', '0'] }, { duration: 260, easing: 'cubic-bezier(.16, 1, .3, 1)' });
    }
    surface?.kick();
  };

  return handle(() => surface, state, () => surface?.refresh(), {
    idle: () => show('idle'),
    loading: () => show('loading'),
    success: () => show('success'),
    warning: () => show('warning'),
    error: () => show('error'),
    get state() { return phase; },
  }, () => { delete element.dataset.state; });
}

export const STATUS_ORB_DEFAULTS = DEFAULTS;
