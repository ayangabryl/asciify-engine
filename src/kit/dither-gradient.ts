import type { GlyphFieldOptions } from '../field';
import { watchPointer } from '../field/field-gl';
import { clamp, handle, isDark, mountSurface, resolveColor, type KitHandle, type KitOptions, type Surface } from './core';

export interface DitherLight {
  /** Centre as a share of the element's width and height; may lie outside 0..1 to light from past an edge. */
  x: number;
  y: number;
  /** Radius as a share of the element's longer side. Default 0.6. */
  radius?: number;
  /** Peak tone, 0 to 1. Default 1. */
  strength?: number;
  /** Height over width of the light's ellipse: below 1 a wide, low glow like a sunrise on the edge. Default 1. */
  aspect?: number;
}

export interface DitherGradientOptions extends KitOptions {
  /** The lights the gradient is made of. Default one wide, low glow rising from just below the bottom edge. */
  lights?: DitherLight[];
  /**
   * The colour ramp the light runs through, faintest first and the core last: two to six CSS colours or tokens (`--brand`).
   * Default a warm ramp for the ground: ember to cream on a dark one, peach to flame on a light one. `false` draws in `ink` alone.
   */
  colors?: string[] | false;
  /** Tone of the ground between the lights, 0 to 1: how strongly the tick screen shows there. Default 0.14. */
  base?: number;
  /** How much the lights drift and breathe, 0 (still: draws once, then idles) to 1. Default 0.35. */
  motion?: number;
  /** How far the first light leans toward the pointer, as a share of the element; 0 for none. Default 0.05. */
  follow?: number;
  /** Strength of a soft light that trails the pointer across the element, 0 to 1; 0 for none. Default 0.4. */
  pointer?: number;
  /** `under` sits below the element's content (a hero's ground); `over` above it. Default `under`. */
  layer?: 'under' | 'over';
}

export interface DitherGradientHandle extends KitHandle<DitherGradientOptions> {
  /** Replaces the lights; the next frame draws them. */
  setLights(lights: DitherLight[]): void;
}

const DEFAULTS = { lights: [{ x: 0.5, y: 1.04, radius: 0.5, strength: 1, aspect: 0.5 }] as DitherLight[], base: 0.14, motion: 0.35, follow: 0.05, pointer: 0.4, layer: 'under' as const };
/** Warm ramps, faintest light first: ember to cream on a dark ground, peach to flame on a light one. */
export const DITHER_RAMPS = {
  dark: ['#3a0f04', '#9c2f0c', '#ee5f1c', '#ffa65a', '#ffdcab', '#fff8ec'],
  light: ['#ffe6d3', '#ffc394', '#ff9a57', '#ff7330', '#f2531a', '#d93d0b'],
} as const;
const MAX_SOURCE = 200;
const grey = (v: number) => { const n = Math.round(clamp(v) * 255); return `rgb(${n},${n},${n})`; };
// A light's falloff: a full core easing into a long, soft shoulder, sampled densely so the screen steps through every level.
const FALLOFF = Array.from({ length: 11 }, (_, i) => { const u = i / 10; return [u, Math.exp(-2.6 * u * u) * (1 - u * u) ** 1.2] as const; });

/** A light painted additively into `pen`, as tones. */
function light(pen: CanvasRenderingContext2D, x: number, y: number, r: number, s: number, aspect: number, w: number) {
  pen.save();
  pen.translate(x, y); pen.scale(1, aspect); pen.translate(-x, -y);
  const g = pen.createRadialGradient(x, y, 0, x, y, r);
  for (const [at, k] of FALLOFF) g.addColorStop(at, grey(s * k));
  pen.fillStyle = g;
  pen.fillRect(0, y - r, w, 2 * r);
  pen.restore();
}

/** One frame of the lights as tones into `pen`, white the densest; `glow` is the pointer's light. Exported for tests. */
export function ditherGradientFrame(pen: CanvasRenderingContext2D, w: number, h: number, lights: DitherLight[], base: number, motion: number, t: number, lean: { x: number; y: number }, glow?: { x: number; y: number; s: number }) {
  pen.fillStyle = grey(base);
  pen.fillRect(0, 0, w, h);
  pen.globalCompositeOperation = 'lighter';
  const side = Math.max(w, h);
  lights.forEach((l, i) => {
    // Slow, incommensurate drifts and a gentle breath, so the light never visibly loops.
    const sway = motion * 0.03, breathe = 1 + motion * 0.12 * Math.sin(t * 0.35 + i * 2.1);
    const x = (l.x + sway * Math.sin(t * 0.11 + i * 1.7) + (i === 0 ? lean.x : 0)) * w;
    const y = (l.y + sway * Math.cos(t * 0.083 + i * 2.3) + (i === 0 ? lean.y : 0)) * h;
    light(pen, x, y, Math.max(1, (l.radius ?? 0.6) * side * breathe), clamp(l.strength ?? 1), Math.max(0.05, l.aspect ?? 1), w);
  });
  if (glow && glow.s > 0.003) light(pen, glow.x * w, glow.y * h, 0.22 * side, glow.s, 1, w);
  pen.globalCompositeOperation = 'source-over';
}

/**
 * Soft lights drawn as a printed glow: a smooth wash through a warm colour ramp under a fine screen of upright ticks, each tick
 * stepping through its levels by an ordered dither, so the light reads crisp in the mid tones and melts into the wash at its core.
 * The lights drift and breathe slowly, the first leans toward the pointer and a soft light trails it. With `motion: 0` and the
 * pointer away it draws once and idles; reduced motion draws one still frame. A `charset` draws the same light in characters.
 */
export function ditherGradient(element: HTMLElement, options: DitherGradientOptions = {}): DitherGradientHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  const o = () => state.current;
  const lean = { x: 0, y: 0, tx: 0, ty: 0 };
  const glow = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, s: 0, ts: 0 };
  let at = 0;
  const ramp = (): string[] => {
    const colors = o().colors;
    if (colors === false) return [];
    const stops = (colors ?? DITHER_RAMPS[isDark(element) ? 'dark' : 'light']).map(c => resolveColor(c, element)).filter((c): c is string => !!c);
    return stops.length >= 2 ? stops.slice(0, 6) : [];
  };
  // 3.4 x 4.6px cells: a fine screen, a printed glow rather than a coarse dither.
  const look = (): GlyphFieldOptions => ({ mark: 'tick', charset: ' .:-=+*#%@', cellSize: 4.6, cellAspect: 0.74, contrast: 1, blend: 'off', ramp: ramp(), ...o().look });

  let surface: Surface | null = null;
  surface = mountSurface({
    host: element,
    kit: state,
    layer: o().layer,
    look,
    ink: () => o().ink ?? getComputedStyle(element).color,
    reducedMotion: () => o().reducedMotion,
    resolution: (w, h) => { const k = Math.min(1, MAX_SOURCE / Math.max(w, h)); return [Math.max(4, Math.round(w * k)), Math.max(4, Math.round(h * k))]; },
    onFail: () => { surface = null; },
    paint: ({ pen, width, height, now, still }) => {
      const dt = at ? Math.min(0.1, Math.max(0, now - at) / 1000) : 1 / 60;
      at = now;
      // Eased toward their targets at a rate set in time, not frames, so the response feels the same at any refresh rate.
      const k = 1 - Math.exp(-dt * 3.2), kg = 1 - Math.exp(-dt * 5);
      if (still) { lean.x = lean.tx = lean.y = lean.ty = 0; glow.s = glow.ts = 0; }
      else {
        lean.x += (lean.tx - lean.x) * k; lean.y += (lean.ty - lean.y) * k;
        glow.x += (glow.tx - glow.x) * kg; glow.y += (glow.ty - glow.y) * kg; glow.s += (glow.ts - glow.s) * k;
      }
      const easing = !still && (Math.abs(lean.tx - lean.x) + Math.abs(lean.ty - lean.y) + Math.abs(glow.tx - glow.x) + Math.abs(glow.ty - glow.y) + Math.abs(glow.ts - glow.s) > 0.002);
      const motion = still ? 0 : clamp(o().motion);
      ditherGradientFrame(pen, width, height, o().lights, clamp(o().base), motion, now / 1000, lean, glow);
      return !still && (motion > 0 || easing);
    },
  });

  const unwatch = surface ? watchPointer({
    target: element,
    move: (event: PointerEvent) => {
      if (!surface) return;
      const r = element.getBoundingClientRect();
      const px = clamp((event.clientX - r.left) / (r.width || 1), -0.2, 1.2), py = clamp((event.clientY - r.top) / (r.height || 1), -0.2, 1.2);
      const f = o().follow ?? 0;
      lean.tx = clamp(px - 0.5, -0.5, 0.5) * 2 * f; lean.ty = clamp(py - 0.5, -0.5, 0.5) * 2 * f;
      if (glow.s < 0.01) { glow.x = px; glow.y = py; }
      glow.tx = px; glow.ty = py; glow.ts = clamp(o().pointer ?? 0);
      surface.kick();
    },
    leave: () => { lean.tx = lean.ty = 0; glow.ts = 0; surface?.kick(); },
  }) : () => {};

  return handle(() => surface, state, () => surface?.refresh(), {
    setLights(lights: DitherLight[]) { state.current = { ...state.current, lights }; surface?.kick(); },
  }, unwatch);
}
