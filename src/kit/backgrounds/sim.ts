import type { GlyphFieldOptions } from '../../field';
import type { BackgroundContext, BackgroundPreset, BackgroundRun, BackgroundSettings } from '../background';
import { mountSurface } from '../core';
import { FIELD_GRAPHITE, glyphCells, dotCells, markOf } from './gpu';

/**
 * A simulation drawn into a tone grid each frame. The grid is the field's source: one value per source pixel, 0 empty to 1
 * dense. `step` advances it by `dt` seconds (already scaled by speed) and returns whether it is still moving; a simulation
 * that returns false while nothing is happening costs nothing until the pointer wakes it.
 */
export interface Simulation {
  /** A new size: rebuild the grids. */
  resize(cols: number, rows: number): void;
  /** Moves the simulation on; returns true while anything still changes. */
  step(dt: number, speed: number): boolean;
  /** Writes tones (0–1) into `out`, cols × rows. */
  render(out: Float32Array): void;
  /** Pointer at a grid position, with its movement since the last event in cells. */
  move?(x: number, y: number, dx: number, dy: number): void;
  press?(x: number, y: number): void;
  leave?(): void;
}

export interface SimSpec {
  id: string; name: string; description: string;
  cellSize: number; speed?: number; charset: string; opacity?: number;
  /** Grid cells per CSS pixel along the long side, before the cap. Default 1/3. */
  detail?: number;
  create(seed: number): Simulation;
  /** The preset's own tone settings. */
  tune?: (s: BackgroundSettings) => GlyphFieldOptions;
}

const MAX_GRID = 240;
const INTERACTIVE = 'button, a, input, select, summary, textarea, label';

/** A small seeded generator, so a preset's ambient structure is the same on every visit. */
export function rng(seed: number) {
  let a = (Math.floor(seed * 2654435761) ^ 0x2545f491) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A background preset driven by a CPU simulation on a coarse grid: characters or dots in the theme's ink (or any `look.mark`),
 * the pointer and presses fed to the simulation, a still frame under reduced motion, and no frames at all once it settles.
 */
export function simPreset(spec: SimSpec): BackgroundPreset {
  return {
    id: spec.id, name: spec.name, description: spec.description, cellSize: spec.cellSize, speed: spec.speed ?? 1, cursor: true, opacity: spec.opacity,
    mount(context) { return mountSim(context, spec); },
  };
}

function mountSim(context: BackgroundContext, spec: SimSpec): BackgroundRun | null {
  const { host } = context;
  const sim = spec.create(1);
  let cols = 0, rows = 0, tones = new Float32Array(1), pixels: ImageData | null = null, last = 0, lastX = NaN, lastY = NaN, settled = false;
  const surface = mountSurface({
    host,
    kit: context.kit,
    layer: 'under',
    look: () => {
      const s = context.settings();
      const mark = markOf(s, 'glyph');
      return {
        color: 'ink', shade: 0, background: 'transparent', levels: 'none', blend: 'on', maxPixelRatio: 2, hover: 'none',
        ...(mark === 'dot' ? { mark: 'dot', ...dotCells(s) } : { mark: 'glyph', charset: s.charset ?? spec.charset, ...glyphCells(s) }),
        clear: s.clear ? { element: s.clear, padding: 0, feather: 0.3, shape: 'ellipse' } : false,
        ...spec.tune?.(s), ...s.look,
      } satisfies GlyphFieldOptions;
    },
    ink: dark => context.ink(dark) ?? (dark ? FIELD_GRAPHITE.dark : FIELD_GRAPHITE.light),
    resolution: (w, h) => {
      const k = Math.min(spec.detail ?? 1 / 3, MAX_GRID / Math.max(w, h));
      return [Math.max(8, Math.round(w * k)), Math.max(8, Math.round(h * k))];
    },
    reducedMotion: context.reducedMotion,
    onFail: () => context.onFail(),
    paint: ({ pen, width, height, now, still }) => {
      if (width !== cols || height !== rows) {
        cols = width; rows = height;
        tones = new Float32Array(cols * rows);
        pixels = pen.createImageData(cols, rows);
        sim.resize(cols, rows);
        settled = false;
      }
      const dt = last ? Math.min(0.05, Math.max(0, now - last) / 1000) : 1 / 60;
      last = now;
      const speed = context.settings().speed;
      const moving = still ? false : sim.step(dt, speed);
      sim.render(tones);
      const data = pixels!.data;
      for (let i = 0, k = 0; i < tones.length; i++, k += 4) {
        const v = tones[i] <= 0 ? 0 : tones[i] >= 1 ? 255 : (tones[i] * 255) | 0;
        data[k] = data[k + 1] = data[k + 2] = v;
        data[k + 3] = 255;
      }
      pen.putImageData(pixels!, 0, 0);
      settled = !moving;
      if (settled) last = 0;
      return moving;
    },
  });
  if (!surface) return null;

  const at = (event: PointerEvent) => {
    const box = host.getBoundingClientRect();
    return box.width && box.height ? [((event.clientX - box.left) / box.width) * cols, ((event.clientY - box.top) / box.height) * rows] : null;
  };
  const off = (event: PointerEvent) => context.settings().cursor === false || surface.still() || (typeof Element !== 'undefined' && event.target instanceof Element && !!event.target.closest(INTERACTIVE));
  const move = (event: PointerEvent) => {
    if (off(event)) return;
    const p = at(event);
    if (!p) return;
    const dx = Number.isNaN(lastX) ? 0 : p[0] - lastX, dy = Number.isNaN(lastY) ? 0 : p[1] - lastY;
    lastX = p[0]; lastY = p[1];
    sim.move?.(p[0], p[1], dx, dy);
    surface.kick();
  };
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || off(event)) return;
    const p = at(event);
    if (!p) return;
    sim.press?.(p[0], p[1]);
    surface.kick();
  };
  const leave = () => { lastX = lastY = NaN; sim.leave?.(); surface.kick(); };
  host.addEventListener('pointermove', move, { passive: true });
  host.addEventListener('pointerdown', down);
  host.addEventListener('pointerleave', leave);
  host.addEventListener('pointercancel', leave);

  return {
    get field() { return surface.field; },
    get canvas() { return surface.canvas; },
    refresh: () => surface.refresh(),
    play: () => { last = 0; surface.play(); },
    pause: () => surface.pause(),
    destroy() {
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerdown', down);
      host.removeEventListener('pointerleave', leave);
      host.removeEventListener('pointercancel', leave);
      surface.destroy();
    },
  };
}
