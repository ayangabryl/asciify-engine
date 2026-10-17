import type { GlyphFieldOptions } from '../field';
import { clamp, house, mountSurface, styleKeeper, type KitOptions } from './core';
import { snapshot } from './capture';

export interface DisintegrateOptions extends KitOptions {
  /** Ms the characters take to drift away. Default 620. */
  duration?: number;
  /** Close the row's height once the characters are on their way. Default true. */
  collapse?: boolean;
  /** Remove the row from the DOM at the end. Default false: it is left hidden and collapsed, for your framework to remove. */
  remove?: boolean;
  /** The element the field is drawn over. Default the row's parent, so the characters can drift past the row's own box. */
  host?: HTMLElement;
}

const DEFAULTS = { duration: 620, collapse: true, remove: false };
const CLOSE_AT = 300, CLOSE_MS = 260, OUTSET = 16;
const running = new WeakMap<HTMLElement, Promise<void>>();

/**
 * Deletes a row into characters: its text and icons become glyphs that thin out from the right and drift up and away,
 * while the row closes up. Resolves when it is done. Without WebGL2, or under reduced motion, the row closes at once.
 */
export function disintegrate(row: HTMLElement, options: DisintegrateOptions = {}): Promise<void> {
  const ongoing = running.get(row);
  if (ongoing) return ongoing;
  const o = { ...DEFAULTS, ...options };
  const styles = styleKeeper();
  const height = row.offsetHeight;
  const hide = () => {
    for (const child of row.children) styles.set(child as HTMLElement, 'opacity', '0');
    styles.set(row, 'color', 'transparent');
    styles.set(row, 'pointer-events', 'none');
    row.setAttribute('aria-hidden', 'true');
  };
  const close = (k: number) => {
    if (!o.collapse) return;
    styles.set(row, 'box-sizing', 'border-box');
    styles.set(row, 'overflow', 'hidden');
    styles.set(row, 'min-height', '0');
    styles.set(row, 'height', `${(height * (1 - k)).toFixed(2)}px`);
    if (k >= 1) { styles.set(row, 'padding-block', '0'); styles.set(row, 'margin-block', '0'); styles.set(row, 'border-width', '0'); }
  };
  const end = () => { close(1); if (o.remove) row.remove(); };

  const host = o.host ?? row.parentElement ?? row;
  const look = (): GlyphFieldOptions => ({
    mark: 'glyph', charset: ' .:-=+*#%@', font: '"Geist Mono", ui-monospace, monospace', fontWeight: 500,
    cellSize: 5, cellAspect: 0.62, glyphScale: 0.92, contrast: 1.6,
    // The glyphs shimmer as they go, so the row reads as breaking up rather than fading.
    drift: 5, ...o.look,
  });
  let start = 0, started = false, snap: HTMLCanvasElement | null = null, from = { x: 0, y: 0, w: 0, h: 0 };
  let finish: () => void = () => {};
  const surface = mountSurface({
    host,
    look,
    outset: OUTSET,
    resolution: 2,
    ink: () => o.ink ?? '--ascii-ink-strong',
    kit: { current: { lazy: false, globalLook: o.globalLook } },
    reducedMotion: () => o.reducedMotion,
    onFail: () => finish(),
    paint: ({ pen, now, still, scale }) => {
      if (still) { queueMicrotask(finish); return false; }
      if (!snap || !started) return false;
      const ms = now - start, k = clamp(ms / o.duration);
      pen.setTransform(scale, 0, 0, scale, 0, 0);
      if (ms >= CLOSE_AT) close(house(clamp((ms - CLOSE_AT) / CLOSE_MS)));
      // The whole row drifts up and fades while a soft edge eats it from the right.
      pen.save();
      pen.globalAlpha = clamp((1 - k) * 2.2) * (1 - 0.9 * k * k);
      pen.translate(k * 8, k * -14);
      pen.drawImage(snap, 0, 0, snap.width / 2, snap.height / 2);
      pen.globalCompositeOperation = 'destination-out';
      const right = from.x + from.w, solid = right - (k * 1.3 - 0.3) * from.w, soft = right - k * 1.3 * from.w;
      const edge = pen.createLinearGradient(soft, 0, Math.max(soft + 1, solid), 0);
      edge.addColorStop(0, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(0,0,0,1)');
      pen.globalAlpha = 1;
      pen.fillStyle = edge;
      pen.fillRect(from.x - OUTSET, from.y - OUTSET, from.w + OUTSET * 2, from.h + OUTSET * 2);
      pen.restore();
      const done = ms >= Math.max(o.duration, o.collapse ? CLOSE_AT + CLOSE_MS : 0);
      if (done) queueMicrotask(finish);
      return !done;
    },
  });

  const promise = new Promise<void>(resolve => {
    let over = false;
    finish = () => {
      if (over) return;
      over = true;
      surface?.destroy();
      end();
      running.delete(row);
      resolve();
    };
    if (!surface || surface.still()) { hide(); finish(); return; }
    from = surface.box(row);
    snap = snapshot(row, surface.canvas.clientWidth || from.w + OUTSET * 2, surface.canvas.clientHeight || from.h + OUTSET * 2, surface.box).canvas;
    // The row stays as it is until the field can draw its first frame, so a slow mount never shows a gap.
    const go = () => { if (over || started) return; hide(); started = true; start = performance.now(); surface.kick(); };
    void surface.field.ready.then(go, () => { hide(); finish(); });
  });
  running.set(row, promise);
  return promise;
}

export const DISINTEGRATE_DEFAULTS = DEFAULTS;
