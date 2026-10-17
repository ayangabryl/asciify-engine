import type { GlyphFieldOptions } from '../field';
import { clamp, handle, mixHex, mountSurface, prefersReduced, resolveColor, styleKeeper, type KitHandle, type KitOptions, type Surface } from './core';

export interface SlideToConfirmOptions extends KitOptions {
  /** Called once the slide completes, by drag, fling, Enter, Space, End or `confirm()`. */
  onConfirm?: () => void;
  /** The handle. Default: the track's `[role="slider"]`, else its first child element. */
  thumb?: string;
  /** Text that fades as the thumb travels. Default `[data-label]`. */
  label?: string;
  /** Where the fill condenses into a ring and check. Default: the middle of the track. */
  mark?: HTMLElement | null;
  /** How far, 0–1, a release must reach to confirm. Default 0.9. */
  threshold?: number;
  /** Ms after confirming before the slider resets itself; 0 keeps it confirmed until `reset()`. Default 0. */
  resetAfter?: number;
  /** The ink the field eases to on success: a CSS colour or custom property. Default `--ascii-success`. */
  color?: string;
}

export interface SlideToConfirmHandle extends KitHandle<SlideToConfirmOptions> {
  /** Completes the slide as if dragged to the end. */
  confirm(): void;
  /** Springs back to the start, unconfirmed. */
  reset(): void;
  readonly confirmed: boolean;
}

const DEFAULTS = { thumb: '[role="slider"]', label: '[data-label]', threshold: 0.9, resetAfter: 0 };
const DONE_MS = 720, RESET_MS = 260, RING = 5;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => 1 - (1 - t) ** 3;

interface Spring { x: number; v: number; to: number; k: number; z: number }
const spring = (x: number, k: number, z: number): Spring => ({ x, v: 0, to: x, k, z });
/** Semi-implicit Euler in 240 Hz substeps; returns whether the spring is still moving. */
export function stepSpring(s: Spring, dt: number, eps = 0.4) {
  const c = 2 * Math.sqrt(s.k) * s.z, n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
  for (let i = 0; i < n; i++) { s.v += (-s.k * (s.x - s.to) - c * s.v) * h; s.x += s.v * h; }
  if (Math.abs(s.x - s.to) < eps && Math.abs(s.v) < eps * 12) { s.x = s.to; s.v = 0; return false; }
  return true;
}
const snap = (s: Spring) => { s.x = s.to; s.v = 0; };

/** Velocity from the last 80ms of samples, in px/s. */
export function velocity(samples: [number, number][], now: number) {
  const recent = samples.filter(([, t]) => now - t < 80);
  if (recent.length < 2) return 0;
  const [x0, t0] = recent[0], [x1, t1] = recent[recent.length - 1];
  return t1 > t0 ? ((x1 - x0) / (t1 - t0)) * 1000 : 0;
}

function drawCheck(pen: CanvasRenderingContext2D, x: number, y: number, size: number, t: number, alpha: number, width: number) {
  if (t <= 0 || alpha <= 0) return;
  const p = [[-0.82, 0.02], [-0.26, 0.56], [0.86, -0.6]].map(([px, py]) => [x + px * size, y + py * size]);
  const length = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]) + Math.hypot(p[2][0] - p[1][0], p[2][1] - p[1][1]);
  pen.save();
  pen.globalAlpha = alpha; pen.strokeStyle = '#fff'; pen.lineWidth = width; pen.lineCap = 'round'; pen.lineJoin = 'round';
  pen.setLineDash([length * t, length]);
  pen.beginPath(); pen.moveTo(p[0][0], p[0][1]); pen.lineTo(p[1][0], p[1][1]); pen.lineTo(p[2][0], p[2][1]); pen.stroke();
  pen.restore();
}

/**
 * Slide to confirm: characters fill the track behind the thumb as it travels; on completion the fill condenses into a disc,
 * opens into a ring and a check draws inside it while the ink eases to the success colour.
 */
export function slideToConfirm(track: HTMLElement, options: SlideToConfirmOptions = {}): SlideToConfirmHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  const styles = styleKeeper();
  const thumb = (track.querySelector<HTMLElement>(state.current.thumb) ?? track.firstElementChild) as HTMLElement | null;
  const label = () => track.querySelector<HTMLElement>(state.current.label);
  const reduced = () => !!(state.current.reducedMotion ?? prefersReduced());
  let x = spring(0, 520, 0.8), heat = spring(0, 150, 1), held = false, grab = 0, done = false, doneAt = 0, resetAt = 0, samples: [number, number][] = [];
  let raf = 0, last = 0, timer = 0, inkShown = '', pointer = -1, surface: Surface | null = null;

  const geom = () => {
    if (!thumb) return null;
    const pad = Math.max(0, (track.clientHeight - thumb.offsetHeight) / 2);
    return { pad, size: thumb.offsetHeight, max: Math.max(1, track.clientWidth - thumb.offsetWidth - pad * 2) };
  };
  const scale = () => track.getBoundingClientRect().width / (track.clientWidth || 1) || 1;
  const look = (): GlyphFieldOptions => ({
    mark: 'glyph', charset: ' .:-=+*#%@', font: '"Geist Mono", ui-monospace, monospace', fontWeight: 500,
    cellSize: 4, cellAspect: 0.62, glyphScale: 0.94, ...state.current.look,
  });
  const neutral = (dark: boolean) => (resolveColor(state.current.ink ?? '--ascii-ink-strong', track) ?? resolveColor(getComputedStyle(track).color, track) ?? (dark ? '#d8d6cf' : '#1d1d1b'));
  const success = (dark: boolean) => resolveColor(state.current.color ?? '--ascii-success', track, dark ? '#3ccf7e' : '#17844a')!;

  surface = mountSurface({
    host: track,
    layer: 'under',
    look,
    ink: neutral,
    kit: state,
    reducedMotion: () => state.current.reducedMotion,
    onFail: () => { surface = null; },
    onTheme: () => { inkShown = ''; },
    paint: ({ pen, w, h, now, still, dark, box }) => {
      const g = geom();
      if (!g) return false;
      // One 720ms moment: the fill sweeps and condenses into a disc, the disc opens into a ring, the check draws, it settles.
      const t = done ? (still ? 1 : clamp((now - doneAt) / DONE_MS)) : 0;
      const c = ease(clamp(t / 0.5)), open = ease(clamp((t - 0.36) / 0.3)), check = ease(clamp((t - 0.46) / 0.4));
      const u = clamp((t - 0.5) / 0.5), sc = 1 + 0.07 * Math.sin(Math.PI * u) * (1 - u);
      const fade = resetAt ? 1 - clamp((now - resetAt) / RESET_MS) : 1;
      const m = state.current.mark ? box(state.current.mark) : { x: w / 2 - 18, y: h / 2 - 18, w: 36, h: 36 };
      const cx = m.x + m.w / 2, cy = m.y + m.h / 2, r = Math.min(m.w / 2, h / 2 - 2) * sc;
      const ink = done ? mixHex(neutral(dark), success(dark), ease(clamp(still ? 1 : (now - doneAt) / (DONE_MS * 0.5)))) : neutral(dark);
      if (ink !== inkShown) { inkShown = ink; surface?.field.update({ ink }); }
      pen.save();
      pen.globalAlpha = fade;
      pen.beginPath();
      if (w > 4 && h > 4) pen.roundRect(2, 2, w - 4, h - 4, (h - 4) / 2);
      pen.clip();
      // The path ahead: a faint run of characters, so the track reads as somewhere to go.
      pen.fillStyle = `rgba(255,255,255,${0.1 * (1 - c)})`;
      pen.fillRect(0, 0, w, h);
      const head = g.pad + x.x + g.size / 2, hot = done ? 1 : heat.x;
      const x0 = mix(0, cx - r, c), x1 = mix(head, cx + r, c), y0 = mix(0, cy - r, c), y1 = mix(h, cy + r, c);
      if (x1 - x0 > 1 && hot > 0.004) {
        const grad = pen.createLinearGradient(x0, 0, x1, 0);
        grad.addColorStop(0, `rgba(255,255,255,${mix(0.14, 1, c) * hot})`);
        grad.addColorStop(0.62, `rgba(255,255,255,${mix(0.48, 1, c) * hot})`);
        grad.addColorStop(1, `rgba(255,255,255,${hot})`);
        pen.fillStyle = grad;
        pen.globalAlpha = fade * (1 - 0.28 * open);
        pen.beginPath(); pen.roundRect(x0, y0, x1 - x0, y1 - y0, mix(0, r, c)); pen.fill();
      }
      if (open > 0) {
        pen.globalAlpha = 1; pen.fillStyle = '#000';
        pen.beginPath(); pen.arc(cx, cy, Math.max(0, r - RING) * open, 0, Math.PI * 2); pen.fill();
      }
      pen.restore();
      if (check > 0) drawCheck(pen, cx + r * 0.02, cy + r * 0.07, r * 0.55, check, fade, 4.5);
      return false;
    },
  });

  const apply = () => {
    const g = geom();
    if (!g || !thumb) return;
    const p = x.x / g.max;
    styles.set(thumb, 'translate', `${x.x}px 0`);
    thumb.setAttribute('aria-valuenow', String(Math.round(clamp(p) * 100)));
    const l = label();
    if (l) styles.set(l, 'opacity', String(done ? 0 : 1 - clamp(p * 1.7)));
  };
  const tick = (now: number) => {
    raf = 0;
    const dt = Math.min(1 / 30, Math.max(0, (now - last) / 1000));
    last = now;
    let moving = !held && stepSpring(x, dt, 0.3);
    moving = stepSpring(heat, dt, 0.003) || moving;
    if (resetAt && (now - resetAt >= RESET_MS || reduced())) {
      resetAt = 0; done = false; x = spring(0, 520, 0.8); heat = spring(0, 150, 1);
      track.dataset.state = 'idle';
      delete track.dataset.confirmed;
      if (thumb) { styles.set(thumb, 'opacity', '1'); styles.set(thumb, 'scale', '1'); thumb.tabIndex = 0; }
    }
    if (done && now - doneAt > DONE_MS * 0.42) track.dataset.confirmed = '';
    apply();
    surface?.kick();
    if (moving || held || (done && now - doneAt < DONE_MS + 40) || resetAt > 0) raf = requestAnimationFrame(tick);
  };
  const kick = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); } };

  const confirm = () => {
    const g = geom();
    if (!g || done) return;
    const travel = g.max - x.x;
    held = false; done = true;
    x.to = g.max; heat.to = 1;
    doneAt = performance.now() + (travel > 4 ? 200 : 90);
    if (reduced()) { snap(x); snap(heat); doneAt = -1e6; track.dataset.confirmed = ''; }
    track.dataset.state = 'confirmed';
    if (thumb) {
      thumb.setAttribute('aria-valuetext', 'Confirmed');
      thumb.tabIndex = -1;
      styles.set(thumb, 'transition', 'opacity 200ms 160ms, scale 240ms 160ms');
      styles.set(thumb, 'opacity', '0'); styles.set(thumb, 'scale', '.6');
    }
    if (timer) clearTimeout(timer);
    if (state.current.resetAfter > 0) timer = setTimeout(reset, state.current.resetAfter) as unknown as number;
    apply();
    kick();
    state.current.onConfirm?.();
  };
  function reset() {
    if (timer) clearTimeout(timer);
    timer = 0;
    if (!done) { x.to = 0; heat.to = 0; kick(); return; }
    resetAt = performance.now();
    // Leaving: the done text can fade with the fill.
    track.dataset.state = 'resetting';
    thumb?.removeAttribute('aria-valuetext');
    kick();
  }

  const release = (event?: Event) => {
    const g = geom();
    if (!held || !g || (event !== undefined && (event as PointerEvent).pointerId !== undefined && (event as PointerEvent).pointerId !== pointer)) return;
    held = false;
    const v = velocity(samples, performance.now());
    if (x.x >= g.max * state.current.threshold || (v > 900 && x.x > g.max * 0.5)) { confirm(); return; }
    x.to = 0; x.v = clamp(v, -1500, 1500) * 0.25; heat.to = 0;
    if (reduced()) { snap(x); snap(heat); }
    track.dataset.state = 'idle';
    kick();
  };
  const onDown = (event: PointerEvent) => {
    if (event.button !== 0 || done || !thumb) return;
    if (thumb.contains(event.target as Node)) {
      // A pointer that is no longer active (or a scripted one) cannot be captured; the drag still follows it.
      try { thumb.setPointerCapture?.(event.pointerId); } catch { /* not capturable */ }
      pointer = event.pointerId;
      held = true; grab = event.clientX - x.x * scale(); heat.to = 1; samples = [];
      track.dataset.state = 'dragging';
      kick();
    } else if (!held && !reduced()) {
      // A press on the track, off the thumb, nudges it: the thumb hops forward and springs home.
      x.v += 420; heat.to = 0;
      kick();
    }
  };
  const onMove = (event: PointerEvent) => {
    const g = geom();
    // Only the pointer that took the thumb drags it: a second finger or a stray mouse never steals it.
    if (!held || !g || event.pointerId !== pointer) return;
    x.x = x.to = clamp((event.clientX - grab) / scale(), 0, g.max);
    x.v = 0;
    samples.push([x.x, performance.now()]);
    if (samples.length > 8) samples.shift();
    if (x.x >= g.max - 0.5) confirm(); else kick();
  };
  const onKey = (event: KeyboardEvent) => {
    const g = geom();
    if (!g || done) return;
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'End') { event.preventDefault(); confirm(); return; }
    const step = ({ ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 } as Record<string, number>)[event.key];
    const to = event.key === 'Home' ? 0 : step !== undefined ? clamp(x.to + (step * g.max) / 4, 0, g.max) : null;
    if (to === null) return;
    event.preventDefault();
    x.to = to; heat.to = to > 0 ? 1 : 0;
    if (reduced()) { snap(x); snap(heat); }
    if (to >= g.max - 0.5) confirm(); else kick();
  };

  if (thumb) {
    if (!thumb.hasAttribute('role')) thumb.setAttribute('role', 'slider');
    if (!thumb.hasAttribute('tabindex')) thumb.tabIndex = 0;
    if (!thumb.hasAttribute('aria-label')) thumb.setAttribute('aria-label', label()?.textContent?.trim() || 'Slide to confirm');
    thumb.setAttribute('aria-valuemin', '0'); thumb.setAttribute('aria-valuemax', '100'); thumb.setAttribute('aria-valuenow', '0');
    styles.set(thumb, 'touch-action', 'none');
    thumb.addEventListener('keydown', onKey);
  }
  // An image or icon in the thumb would otherwise start a native drag and cancel the slide.
  const noDrag = (event: Event) => event.preventDefault();
  track.dataset.state = 'idle';
  track.addEventListener('pointerdown', onDown);
  track.addEventListener('pointermove', onMove);
  track.addEventListener('pointerup', release);
  track.addEventListener('pointercancel', release);
  track.addEventListener('lostpointercapture', release);
  track.addEventListener('dragstart', noDrag);

  return handle(() => surface, state, () => surface?.refresh(), {
    confirm, reset,
    get confirmed() { return done; },
  }, () => {
    if (raf) cancelAnimationFrame(raf);
    if (timer) clearTimeout(timer);
    raf = timer = 0;
    thumb?.removeEventListener('keydown', onKey);
    track.removeEventListener('pointerdown', onDown);
    track.removeEventListener('pointermove', onMove);
    track.removeEventListener('pointerup', release);
    track.removeEventListener('pointercancel', release);
    track.removeEventListener('lostpointercapture', release);
    track.removeEventListener('dragstart', noDrag);
    styles.restore();
    delete track.dataset.state; delete track.dataset.confirmed;
  });
}

export const SLIDE_TO_CONFIRM_DEFAULTS = DEFAULTS;
