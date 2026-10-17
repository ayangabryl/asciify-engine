import type { GlyphFieldOptions } from '../field';
import { easeOut, handle, hash, mountSurface, type Box, type KitHandle, type KitOptions, type Surface } from './core';

export interface TabsOptions extends KitOptions {
  /** The tab elements. Default: the tablist's `[role="tab"]` children. */
  tabs?: string;
  /** The tab shown first. Default: the one with `aria-selected="true"`, else 0. */
  active?: number;
  /** How long the indicator streams to a new tab, in ms. Default 280. */
  duration?: number;
  /** How the kit shows panels named by `aria-controls`: `hidden` toggles the attribute, `attribute` toggles `data-active`, `none` leaves them. Default `hidden`. */
  panels?: 'hidden' | 'attribute' | 'none';
  /** Wire clicks and arrow, Home and End keys, and keep `aria-selected` and roving `tabindex` in step. Default true. */
  manage?: boolean;
  /** Called after the active tab changes. */
  onChange?: (index: number, tab: HTMLElement) => void;
}

export interface TabsHandle extends KitHandle<TabsOptions> {
  /** Selects a tab; the indicator streams across to it. `focus` moves keyboard focus too. */
  select(index: number, focus?: boolean): void;
  readonly active: number;
}

const DEFAULTS = { tabs: '[role="tab"]', duration: 280, panels: 'hidden' as const, manage: true };

/** Where the stream's two ends are at `t` (0–1) between boxes `a` and `b`: the head races ahead, the tail follows late. */
export function streamSpan(a: Box, b: Box, t: number) {
  const dir = Math.sign(b.x - a.x) || 1, head = easeOut(t / 0.8), tail = easeOut((t - 0.22) / 0.78);
  const front = (dir > 0 ? a.x + a.w : a.x) + ((dir > 0 ? b.x + b.w : b.x) - (dir > 0 ? a.x + a.w : a.x)) * head;
  const back = (dir > 0 ? a.x : a.x + a.w) + ((dir > 0 ? b.x : b.x + b.w) - (dir > 0 ? a.x : a.x + a.w)) * tail;
  return { left: Math.min(front, back), right: Math.max(front, back), dir };
}

/** Segmented tabs whose active indicator is a pill of characters that streams across and condenses under the new tab. */
export function tabs(tablist: HTMLElement, options: TabsOptions = {}): TabsHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  const list = () => [...tablist.querySelectorAll<HTMLElement>(state.current.tabs)];
  const initial = list().findIndex(tab => tab.getAttribute('aria-selected') === 'true');
  let active = Math.max(0, state.current.active ?? (initial >= 0 ? initial : 0)), from = active, at = -1e6;
  const look = (): GlyphFieldOptions => ({
    mark: 'glyph', charset: ' .:-=+*#%@', font: '"Geist Mono", ui-monospace, monospace', fontWeight: 500,
    cellSize: 6, cellAspect: 0.62, glyphScale: 0.96, ...state.current.look,
  });

  let surface: Surface | null = null;
  surface = mountSurface({
    host: tablist,
    layer: 'under',
    look,
    ink: dark => state.current.ink ?? (dark ? '#7a7872' : '#76746e'),
    kit: state,
    reducedMotion: () => state.current.reducedMotion,
    onFail: () => { surface = null; },
    paint: ({ pen, now, still, box }) => {
      const all = list(), a = all[from], b = all[active];
      if (!a || !b) return false;
      const A = box(a), B = box(b), t = still ? 1 : (now - at) / state.current.duration;
      if (t >= 1) {
        // At rest: a pill of characters, denser toward its ends.
        const x0 = B.x + 1, y0 = B.y + 1.5, w = B.w - 2, h = B.h - 3;
        pen.save(); pen.beginPath(); pen.roundRect(x0, y0, Math.max(0, w), Math.max(0, h), Math.max(0, h / 2)); pen.clip();
        for (let x = 0; x < w; x += 2) {
          const v = Math.round(255 * (0.2 + 0.5 * Math.max(0, 1 - Math.min(x, w - x) / 22)));
          pen.fillStyle = `rgb(${v} ${v} ${v})`; pen.fillRect(x0 + x, y0, 2, h);
        }
        pen.restore();
        return false;
      }
      // In flight the characters string out into a trail, densest at the head, and condense into the new pill.
      const { left, right, dir } = streamSpan(A, B, t), span = Math.max(1, right - left), y = A.y, h = A.h, step = 3.72, tick = Math.floor(now / 40);
      pen.save(); pen.beginPath(); pen.roundRect(left, y + 1.5, span, Math.max(0, h - 3), Math.max(0, (h - 3) / 2)); pen.clip();
      for (let x = left; x < right; x += step) {
        const u = dir > 0 ? (x - left) / span : (right - x) / span, settle = Math.min(1, t * 1.4), density = 0.25 + 0.75 * (settle + (1 - settle) * u ** 1.6);
        for (let row = 0; row < h; row += 6) {
          if (hash(Math.round(x / step), row + tick) >= density) continue;
          const edge = row < 5 || row > h - 8, v = Math.round((edge ? 150 : 70 + 110 * (1 - settle) * u) * (0.6 + 0.4 * density));
          pen.fillStyle = `rgb(${v} ${v} ${v})`; pen.fillRect(x, y + row, step, 6);
        }
      }
      pen.restore();
      return true;
    },
  });

  const sync = () => {
    const o = state.current;
    list().forEach((tab, i) => {
      const on = i === active;
      if (o.manage) { tab.setAttribute('aria-selected', String(on)); tab.tabIndex = on ? 0 : -1; }
      const panel = tab.getAttribute('aria-controls') ? document.getElementById(tab.getAttribute('aria-controls')!) : null;
      if (!panel || o.panels === 'none') return;
      if (o.panels === 'hidden') panel.hidden = !on; else panel.toggleAttribute('data-active', on);
    });
  };
  const select = (index: number, focus = false) => {
    const all = list();
    if (!all.length) return;
    const i = ((index % all.length) + all.length) % all.length;
    if (focus) all[i].focus();
    if (i === active) return;
    from = active; active = i; at = performance.now();
    sync();
    surface?.kick();
    state.current.onChange?.(i, all[i]);
  };
  const onClick = (event: Event) => {
    if (!state.current.manage) return;
    const tab = (event.target as Element).closest?.(state.current.tabs) as HTMLElement | null;
    const i = tab ? list().indexOf(tab) : -1;
    if (i >= 0) select(i);
  };
  const onKey = (event: KeyboardEvent) => {
    if (!state.current.manage) return;
    const map: Record<string, number> = { ArrowRight: active + 1, ArrowLeft: active - 1, Home: 0, End: list().length - 1 };
    if (!(event.key in map)) return;
    event.preventDefault();
    select(map[event.key], true);
  };
  tablist.addEventListener('click', onClick);
  tablist.addEventListener('keydown', onKey);
  sync();

  return handle(() => surface, state, next => { if (next.active !== undefined && next.active !== active) select(next.active); sync(); surface?.refresh(); }, {
    select,
    get active() { return active; },
  }, () => {
    tablist.removeEventListener('click', onClick);
    tablist.removeEventListener('keydown', onKey);
  });
}

export const TABS_DEFAULTS = DEFAULTS;
