/** Time-based pointer motion. No DOM dependency; the trail has a fixed budget. */
export interface HoverPoint {
  x: number;
  y: number;
  intensity?: number;
}
export interface TrailPoint extends HoverPoint {
  intensity: number;
  vx: number;
  vy: number;
}
export interface HoverState {
  x: number;
  y: number;
  intensity: number;
  time: number;
  emittedAt: number;
  points: TrailPoint[];
}
export interface RenderHover extends HoverPoint { trail?: readonly TrailPoint[] }

export function createHoverState(): HoverState {
  return { x: 0.5, y: 0.5, intensity: 0, time: -1, emittedAt: -1, points: [] };
}

export function advanceHover(state: HoverState, target: HoverPoint | null, now: number): RenderHover | null {
  const dt = state.time < 0 ? 1 / 60 : Math.max(0, Math.min(0.1, (now - state.time) / 1000));
  state.time = now;
  const wasIdle = state.intensity < 0.003;
  const px = state.x, py = state.y;
  if (target) {
    if (wasIdle) { state.x = target.x; state.y = target.y; }
    const follow = 1 - Math.exp(-dt / 0.055);
    state.x += (target.x - state.x) * follow;
    state.y += (target.y - state.y) * follow;
  }
  state.intensity += ((target?.intensity ?? (target ? 1 : 0)) - state.intensity) *
    (1 - Math.exp(-dt / (target ? 0.09 : 0.18)));
  const decay = Math.exp(-dt / 0.22);
  for (const point of state.points) point.intensity *= decay;
  while (state.points.length && state.points[0].intensity < 0.01) state.points.shift();
  if (target && !wasIdle && now - state.emittedAt >= 24 && Math.hypot(state.x - px, state.y - py) > 0.0005) {
    state.points.push({ x: state.x, y: state.y, intensity: state.intensity,
      vx: Math.max(-1, Math.min(1, (state.x - px) / Math.max(dt, 0.001))),
      vy: Math.max(-1, Math.min(1, (state.y - py) / Math.max(dt, 0.001))) });
    if (state.points.length > 12) state.points.shift();
    state.emittedAt = now;
  }
  if (!target && state.intensity < 0.003 && !state.points.length) {
    state.intensity = 0;
    return null;
  }
  return { x: state.x, y: state.y, intensity: state.intensity, trail: state.points };
}

/** Render only while visible, with an event-driven wakeup for still images. */
export function createRenderLoop(canvas: HTMLCanvasElement, draw: (time: number, hover: HoverPoint | null) => void,
  { continuous = false, interactive = false }: { continuous?: boolean; interactive?: boolean } = {}) {
  const pointerTarget = canvas.parentElement ?? canvas;
  let pointer: HoverPoint | null = null;
  let raf = 0, stopped = false, visible = true, dirty = true, lastInput = -Infinity;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const wake = () => {
    dirty = true;
    if (!stopped && visible && !document.hidden && !raf) raf = requestAnimationFrame(tick);
  };
  const tick = (time: number) => {
    raf = 0;
    if (stopped || !visible || document.hidden) return;
    const moving = !reduced.matches && (continuous || time - lastInput < 1500);
    if (dirty || moving) { draw(time, reduced.matches ? null : pointer); dirty = false; }
    if (moving) raf = requestAnimationFrame(tick);
  };
  const move = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = (event.clientX - rect.left) / rect.width, y = (event.clientY - rect.top) / rect.height;
    pointer = x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
    lastInput = performance.now(); wake();
  };
  const leave = () => { pointer = null; lastInput = performance.now(); wake(); };
  const visibility = () => {
    if (document.hidden && raf) { cancelAnimationFrame(raf); raf = 0; }
    else wake();
  };
  const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) wake();
    else if (raf) { cancelAnimationFrame(raf); raf = 0; }
  });
  observer?.observe(canvas);
  if (interactive) { pointerTarget.addEventListener('pointermove', move); pointerTarget.addEventListener('pointerleave', leave); }
  document.addEventListener('visibilitychange', visibility);
  reduced.addEventListener('change', wake);
  wake();
  return { wake, stop: () => {
    stopped = true; cancelAnimationFrame(raf); observer?.disconnect();
    pointerTarget.removeEventListener('pointermove', move); pointerTarget.removeEventListener('pointerleave', leave);
    document.removeEventListener('visibilitychange', visibility); reduced.removeEventListener('change', wake);
  } };
}
