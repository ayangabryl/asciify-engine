import type { GlyphFieldOptions } from '../field';
import { watchPointer } from '../field/field-gl';
import { clamp, handle, mountSurface, type KitHandle, type KitOptions, type Surface } from './core';

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
  /** Tone of the ground between the lights, 0 to 1: with the default `tick` mark it sets how strongly the fine screen shows there. Default 0.12. */
  base?: number;
  /** How much the lights drift and breathe, 0 (still: draws once, then idles) to 1. Default 0.35. */
  motion?: number;
  /** How far the first light leans toward the pointer, as a share of the element; 0 for none. Default 0.06. */
  follow?: number;
  /** `under` sits below the element's content (a hero's ground); `over` above it. Default `under`. */
  layer?: 'under' | 'over';
}

export interface DitherGradientHandle extends KitHandle<DitherGradientOptions> {
  /** Replaces the lights; the next frame draws them. */
  setLights(lights: DitherLight[]): void;
}

const DEFAULTS = { lights: [{ x: 0.5, y: 1.02, radius: 0.44, strength: 1, aspect: 0.52 }] as DitherLight[], base: 0.12, motion: 0.35, follow: 0.06, layer: 'under' as const };
const MAX_SOURCE = 180;
const grey = (v: number) => { const n = Math.round(clamp(v) * 255); return `rgb(${n},${n},${n})`; };

/** One frame of the lights as tones into `pen`, white the densest. Exported for tests. */
export function ditherGradientFrame(pen: CanvasRenderingContext2D, w: number, h: number, lights: DitherLight[], base: number, motion: number, t: number, lean: { x: number; y: number }) {
  pen.fillStyle = grey(base);
  pen.fillRect(0, 0, w, h);
  pen.globalCompositeOperation = 'lighter';
  const side = Math.max(w, h);
  lights.forEach((light, i) => {
    const sway = motion * 0.035, breathe = 1 + motion * 0.14 * Math.sin(t * 0.55 + i * 2.1);
    const x = (light.x + sway * Math.sin(t * 0.17 + i * 1.7) + (i === 0 ? lean.x : 0)) * w;
    const y = (light.y + sway * Math.cos(t * 0.13 + i * 2.3) + (i === 0 ? lean.y : 0)) * h;
    const r = Math.max(1, (light.radius ?? 0.6) * side * breathe), s = clamp(light.strength ?? 1);
    const a = Math.max(0.05, light.aspect ?? 1);
    pen.save();
    pen.translate(x, y); pen.scale(1, a); pen.translate(-x, -y);
    const g = pen.createRadialGradient(x, y, 0, x, y, r);
    // A soft-shouldered falloff, so the dither steps through every level rather than banding at the rim.
    g.addColorStop(0, grey(s));
    g.addColorStop(0.35, grey(s * 0.62));
    g.addColorStop(0.7, grey(s * 0.2));
    g.addColorStop(1, grey(0));
    pen.fillStyle = g;
    pen.fillRect(0, y - r, w, 2 * r);
    pen.restore();
  });
  pen.globalCompositeOperation = 'source-over';
}

/**
 * A gradient of soft lights drawn as a smooth wash under a fine screen of upright ticks (the `tick` mark; `look.mark: 'dither'` for a
 * two-tone Bayer dither): the field's ink on the element's own background. The lights drift and
 * breathe gently and the first leans toward the pointer. With `motion: 0` and the pointer away it draws once and idles; reduced
 * motion draws one still frame.
 */
export function ditherGradient(element: HTMLElement, options: DitherGradientOptions = {}): DitherGradientHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  const o = () => state.current;
  const lean = { x: 0, y: 0, tx: 0, ty: 0 };
  // A fine screen of upright ticks over a smooth wash: 4.4 x 6.5px cells, a printed glow rather than a coarse dither.
  const look = (): GlyphFieldOptions => ({ mark: 'tick', charset: ' .:-=+*#%@', cellSize: 6.5, cellAspect: 0.68, contrast: 1, ...o().look });

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
      const easing = !still && (Math.abs(lean.tx - lean.x) > 0.001 || Math.abs(lean.ty - lean.y) > 0.001);
      if (still) { lean.x = lean.tx = lean.y = lean.ty = 0; }
      else { lean.x += (lean.tx - lean.x) * 0.08; lean.y += (lean.ty - lean.y) * 0.08; }
      const motion = still ? 0 : clamp(o().motion);
      ditherGradientFrame(pen, width, height, o().lights, clamp(o().base), motion, now / 1000, lean);
      return !still && (motion > 0 || easing);
    },
  });

  const unwatch = surface ? watchPointer({
    target: element,
    move: (event: PointerEvent) => {
      const f = o().follow;
      if (!f || !surface) return;
      const r = element.getBoundingClientRect();
      lean.tx = clamp((event.clientX - r.left) / (r.width || 1) - 0.5, -0.5, 0.5) * 2 * f;
      lean.ty = clamp((event.clientY - r.top) / (r.height || 1) - 0.5, -0.5, 0.5) * 2 * f;
      surface.kick();
    },
    leave: () => { lean.tx = lean.ty = 0; surface?.kick(); },
  }) : () => {};

  return handle(() => surface, state, () => surface?.refresh(), {
    setLights(lights: DitherLight[]) { state.current = { ...state.current, lights }; surface?.kick(); },
  }, unwatch);
}
