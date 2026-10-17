import type { GlyphFieldOptions } from '../field';
import { easeOut, handle, hash, mountSurface, type Box, type KitHandle, type KitOptions, type Surface } from './core';

export type PillTone = 'green' | 'amber' | 'red' | 'neutral' | 'new';

export interface PillOptions extends KitOptions {
  /** The fill's tone. Each pill's `data-tone` wins over this. Default `neutral`. */
  tone?: PillTone;
  /** A crest sweeping across while a state is live, such as Live or Syncing. `data-shimmer` on a pill wins over this. Default false. */
  shimmer?: boolean;
  /** Glyphs flare once when the pointer enters a pill. Default true for `new` pills, false otherwise. */
  sparkle?: boolean;
  /** Tone colours to paint, as `[r, g, b]` 0–255, for the light and dark ground. */
  tones?: Partial<Record<'light' | 'dark', Partial<Record<PillTone, [number, number, number]>>>>;
}

export interface PillHandle extends KitHandle<PillOptions> {
  /** Flares the glyphs once, on one pill or all of them. */
  sparkle(pill?: HTMLElement): void;
  /** Re-reads each pill's `data-tone` and `data-shimmer`; tone changes ease over 220ms. `update()` does this too. */
  refresh(): void;
}

const DEFAULTS = { tone: 'neutral' as PillTone, shimmer: false };
export const PILL_TONES: Record<'light' | 'dark', Record<PillTone, [number, number, number]>> = {
  light: { green: [40, 168, 96], amber: [214, 150, 20], red: [222, 72, 72], neutral: [150, 150, 142], new: [120, 96, 230] },
  dark: { green: [70, 214, 132], amber: [245, 186, 64], red: [255, 112, 112], neutral: [150, 150, 142], new: [160, 140, 255] },
};
const SHIMMER = 2400, SPARKLE = 280, TONE = 220;
const mix = (a: number[], b: number[], k: number) => a.map((v, i) => v + (b[i] - v) * k);
const rgb = (c: number[], level: number) => `rgb(${c.map(v => Math.round(Math.max(0, Math.min(255, v * level)))).join(' ')})`;
const isTone = (value: unknown): value is PillTone => value === 'green' || value === 'amber' || value === 'red' || value === 'neutral' || value === 'new';

/** The tone a pill shows: its `data-tone`, else the option. */
export const pillTone = (pill: HTMLElement, fallback: PillTone): PillTone => (isTone(pill.dataset.tone) ? pill.dataset.tone : fallback);

/** The common ancestor of several elements. */
function container(elements: HTMLElement[]) {
  let root: HTMLElement | null = elements[0].parentElement;
  while (root && !elements.every(el => root!.contains(el))) root = root.parentElement;
  return root ?? document.body;
}

/**
 * Pill and badge fills drawn in characters, in their tone. One element gets a field under its text; a list of pills
 * shares one field over their common container (one WebGL context for all), with the labels kept clear.
 */
export function pill(target: HTMLElement | Iterable<HTMLElement>, options: PillOptions = {}): PillHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  const pills = target instanceof HTMLElement ? [target] : [...target];
  const single = pills.length === 1;
  const host = single ? pills[0] : pills.length ? container(pills) : null;
  const tones = new Map<HTMLElement, { from: PillTone; to: PillTone; at: number }>();
  const sparks = new Map<HTMLElement, number>();
  const read = (now = -1e6) => {
    for (const el of pills) {
      const next = pillTone(el, state.current.tone), seen = tones.get(el);
      if (!seen) tones.set(el, { from: next, to: next, at: -1e6 });
      else if (seen.to !== next) tones.set(el, { from: seen.to, to: next, at: now });
    }
  };
  read();
  const look = (): GlyphFieldOptions => ({
    mark: 'glyph', charset: ' .:-=+*#%@', font: '"Geist Mono", ui-monospace, monospace', fontWeight: 500,
    cellSize: 6, cellAspect: 0.62, glyphScale: 0.96, color: 'source', saturation: 1.1, ...state.current.look,
  });
  /** The label's extent in viewport px: the pill's contents, leaving out the kit's own canvas. */
  const content = (el: HTMLElement): Box | null => {
    const range = document.createRange();
    let left = Infinity, right = -Infinity;
    for (const node of el.childNodes) {
      if (node instanceof HTMLElement && node.dataset.asciiKit !== undefined) continue;
      range.selectNode(node);
      const r = range.getBoundingClientRect();
      if (r.width) { left = Math.min(left, r.left); right = Math.max(right, r.right); }
    }
    return right > left ? { x: left, y: 0, w: right - left, h: 0 } : null;
  };

  let surface: Surface | null = null;
  surface = !host ? null : mountSurface({
    host,
    layer: single ? 'under' : 'over',
    look,
    ink: () => state.current.ink,
    reducedMotion: () => state.current.reducedMotion,
    onFail: () => { surface = null; },
    paint: ({ pen, now, still, dark, box }) => {
      const o = state.current, palette = { ...PILL_TONES[dark ? 'dark' : 'light'], ...o.tones?.[dark ? 'dark' : 'light'] }, gain = dark ? 1.3 : 1;
      const origin = surface!.canvas.getBoundingClientRect(), scale = origin.width / (surface!.canvas.offsetWidth || origin.width || 1) || 1;
      let busy = false;
      for (const el of pills) {
        const b = box(el), t = tones.get(el)!, k = still ? 1 : easeOut((now - t.at) / TONE);
        if (k < 1) busy = true;
        const color = mix(palette[t.from], palette[t.to], k);
        const shimmer = !still && (el.dataset.shimmer !== undefined ? el.dataset.shimmer !== 'false' : o.shimmer);
        // Inset by a pixel so cells straddling the edge stay empty and the shape reads crisp.
        const x0 = b.x + 1, y0 = b.y + 1.5, w = b.w - 2, h = b.h - 3;
        if (w <= 0 || h <= 0) continue;
        const raw = content(el), text = raw && { x: (raw.x - origin.left) / scale, w: raw.w / scale };
        pen.save();
        pen.beginPath(); pen.roundRect(x0, y0, w, h, h / 2); pen.clip();
        const crest = ((now % SHIMMER) / SHIMMER) * (w + 80) - 40;
        for (let x = 0; x < w; x += 2) {
          const end = Math.max(0, 1 - Math.min(x, w - x) / 14);
          // Quieter behind the label so the text keeps its contrast; a shared field over the text clears it entirely.
          const under = text && b.x + x > text.x - 3 && b.x + x < text.x + text.w + 3, behind = under ? (single ? 0.55 : 0) : 1;
          let level = (0.3 + 0.3 * end) * behind;
          if (shimmer) { busy = true; level += 0.5 * behind * Math.exp(-(((x - crest) / 14) ** 2)); }
          pen.fillStyle = rgb(color, level * gain);
          pen.fillRect(x0 + x, y0, 2, h);
        }
        pen.restore();
        const spark = (now - (sparks.get(el) ?? -1e6)) / SPARKLE;
        if (spark < 1 && !still) {
          busy = true;
          for (let s = 0; s < 14; s++) {
            const life = (spark - hash(s, 3) * 0.45) / 0.55;
            if (life <= 0 || life >= 1) continue;
            const level = Math.sin(Math.PI * life);
            pen.fillStyle = rgb(mix(color, [255, 255, 255], 0.35 * level), 0.5 + 0.5 * level);
            pen.fillRect(b.x - 4 + hash(s, 7) * (b.w + 8) - 2, b.y - 3 + hash(s, 11) * (b.h + 6) - 3, 4, 6);
          }
        }
      }
      return busy;
    },
  });

  const sparkle = (el?: HTMLElement) => {
    const now = performance.now();
    for (const p of el ? [el] : pills) sparks.set(p, now);
    surface?.kick();
  };
  const enter = (event: Event) => {
    const el = event.currentTarget as HTMLElement;
    if (state.current.sparkle ?? pillTone(el, state.current.tone) === 'new') sparkle(el);
  };
  if (surface) for (const el of pills) el.addEventListener('pointerenter', enter);
  const refresh = () => { read(performance.now()); surface?.kick(); };

  return handle(() => surface, state, () => { read(performance.now()); surface?.refresh(); }, { sparkle, refresh }, () => {
    for (const el of pills) el.removeEventListener('pointerenter', enter);
  });
}

export const PILL_DEFAULTS = DEFAULTS;
