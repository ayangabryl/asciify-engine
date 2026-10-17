import type { GlyphFieldOptions } from '../field';
import { boxIn, clamp, easeOut, handle, mountSurface, smoothstep, styleKeeper, type Box, type KitHandle, type KitOptions, type Surface } from './core';

export interface TabsOptions extends KitOptions {
  /** The tab elements. Default: the tablist's `[role="tab"]` children. */
  tabs?: string;
  /** The tab shown first. Default: the one with `aria-selected="true"`, else 0. */
  active?: number;
  /** How long the indicator glides to a new tab, in ms. Default 440. */
  duration?: number;
  /** How the kit shows panels named by `aria-controls`: `hidden` toggles the attribute, `attribute` toggles `data-active`, `none` leaves them. Default `hidden`. */
  panels?: 'hidden' | 'attribute' | 'none';
  /** Wire clicks and arrow, Home and End keys, and keep `aria-selected` and roving `tabindex` in step. Default true. */
  manage?: boolean;
  /** Called after the active tab changes. */
  onChange?: (index: number, tab: HTMLElement) => void;
}

export interface TabsHandle extends KitHandle<TabsOptions> {
  /** Selects a tab; the indicator glides across to it. `focus` moves keyboard focus too. */
  select(index: number, focus?: boolean): void;
  readonly active: number;
}

const DEFAULTS = { tabs: '[role="tab"]', duration: 440, panels: 'hidden' as const, manage: true };
/** Space kept clear below the characters, in CSS pixels. */
const INSET = 7;

/** Where the indicator's two ends are at `t` (0–1) between boxes `a` and `b`: the leading end goes first and the trailing end catches up, so the pill stretches and settles. */
export function streamSpan(a: Box, b: Box, t: number) {
  const dir = Math.sign(b.x + b.w / 2 - (a.x + a.w / 2)) || 1, lead = easeOut(t / 0.78, 4), trail = easeOut((t - 0.14) / 0.86, 4);
  const left = a.x + (b.x - a.x) * (dir > 0 ? trail : lead), right = a.x + a.w + (b.x + b.w - a.x - a.w) * (dir > 0 ? lead : trail);
  return { left, right, dir };
}

/** The indicator's row of characters: as many whole cells as fit `w` less `inset` either side, centred. */
export function indicatorRow(w: number, cw: number, inset = 20) {
  const n = Math.max(0, Math.floor((w - 2 * inset) / cw));
  return { n, x0: (w - n * cw) / 2 };
}

/**
 * Segmented tabs with a gliding indicator. The pill itself is yours to style from `--tabs-x`, `--tabs-y`, `--tabs-w` and `--tabs-h`,
 * which the kit sets on the tablist every frame, so its outline stays crisp; the field draws a row of characters along its foot
 * that streaks dense toward the leading end in flight and settles into an even, tapered line as it lands.
 */
export function tabs(tablist: HTMLElement, options: TabsOptions = {}): TabsHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  const list = () => [...tablist.querySelectorAll<HTMLElement>(state.current.tabs)];
  const initial = list().findIndex(tab => tab.getAttribute('aria-selected') === 'true');
  let active = Math.max(0, state.current.active ?? (initial >= 0 ? initial : 0)), at = -1e6;
  let from: Box | null = null, shown: Box | null = null;
  const styles = styleKeeper();
  const look = (): GlyphFieldOptions => ({
    mark: 'glyph', charset: ' .:-=+*#%@', font: '"Geist Mono", ui-monospace, monospace', fontWeight: 500,
    cellSize: 6, cellAspect: 0.62, glyphScale: 0.96, blend: 'off', ...state.current.look,
  });
  const boxOf = (el: HTMLElement) => { const b = boxIn(tablist, el); return { ...b, x: b.x - tablist.clientLeft, y: b.y - tablist.clientTop }; };
  const publish = (b: Box) => {
    shown = b;
    const px = (v: number) => `${Math.round(v * 100) / 100}px`;
    styles.set(tablist, '--tabs-x', px(b.x)); styles.set(tablist, '--tabs-y', px(b.y));
    styles.set(tablist, '--tabs-w', px(b.w)); styles.set(tablist, '--tabs-h', px(b.h));
  };
  const settle = () => { const tab = list()[active]; if (tab) publish(boxOf(tab)); };

  let surface: Surface | null = null;
  surface = mountSurface({
    host: tablist,
    layer: 'under',
    look,
    ink: () => state.current.ink ?? '--ascii-ink',
    kit: state,
    reducedMotion: () => state.current.reducedMotion,
    onFail: () => { surface = null; settle(); },
    paint: ({ pen, now, still }) => {
      const tab = list()[active];
      if (!tab) return false;
      const B = boxOf(tab), t = still || !from ? 1 : clamp((now - at) / state.current.duration);
      const s = t < 1 ? streamSpan(from!, B, t) : { left: B.x, right: B.x + B.w, dir: 1 };
      const span = { x: s.left, y: B.y, w: s.right - s.left, h: B.h };
      publish(span);
      if (t >= 1) from = null;

      // The cell grid is moved under the indicator, so its characters glide with it instead of stepping from cell to cell.
      const L = look(), ratio = Math.min(2, globalThis.devicePixelRatio || 1), device = Math.max(2, Math.round((L.cellSize ?? 6) * ratio));
      const ch = device / ratio, cw = Math.max(2, Math.round(device * (L.cellAspect ?? 0.62))) / ratio;
      const { n, x0 } = indicatorRow(span.w, cw);
      const snap = (v: number) => (t < 1 ? v : Math.round(v * ratio) / ratio);
      const bx = snap(span.x + x0), by = snap(span.y + span.h - INSET - ch);
      const tx = ((bx % cw) + cw) % cw - cw, ty = ((by % ch) + ch) % ch - ch;
      const canvas = surface!.canvas, move = `${tx.toFixed(3)}px ${ty.toFixed(3)}px`;
      if (canvas.style.translate !== move) canvas.style.translate = move;
      // Only the row shows, so the faint spill the field's sampling picks up in the cells around it never reaches the pill's edge.
      const f = (v: number) => `${Math.max(0, v).toFixed(2)}px`, cx = bx - tx, cy = by - ty;
      const clip = `inset(${f(cy)} ${f(canvas.clientWidth - cx - n * cw)} ${f(canvas.clientHeight - cy - ch)} ${f(cx)})`;
      if (canvas.style.clipPath !== clip) canvas.style.clipPath = clip;

      // At rest a row that tapers at both ends; in flight it runs dense toward the leading end, then settles as it lands.
      const flight = t < 1 ? 1 - easeOut(t, 2) : 0;
      for (let i = 0; i < n; i++) {
        const u = n > 1 ? i / (n - 1) : 0.5, lead = s.dir > 0 ? u : 1 - u, taper = smoothstep(0, 0.42, 1 - Math.abs(2 * u - 1));
        const v = taper * (0.5 + flight * (0.5 * lead ** 1.4 - 0.2));
        pen.fillStyle = `rgb(${Math.round(255 * v)} ${Math.round(255 * v)} ${Math.round(255 * v)})`;
        pen.fillRect(bx - tx + i * cw, by - ty, cw, ch);
      }
      return t < 1;
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
    // A new choice mid-glide leaves from where the indicator is, not from the last tab.
    from = shown ?? boxOf(all[active]); active = i; at = performance.now();
    sync();
    if (surface && !surface.still()) surface.kick(); else { from = null; settle(); surface?.kick(); }
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
  // Without a field nothing paints, so the indicator's box follows layout here.
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (!surface?.live) settle(); }) : null;
  resize?.observe(tablist);
  tablist.addEventListener('click', onClick);
  tablist.addEventListener('keydown', onKey);
  sync();
  settle();

  return handle(() => surface, state, next => { if (next.active !== undefined && next.active !== active) select(next.active); sync(); surface?.refresh(); }, {
    select,
    get active() { return active; },
  }, () => {
    tablist.removeEventListener('click', onClick);
    tablist.removeEventListener('keydown', onKey);
    resize?.disconnect();
    styles.restore();
  });
}

export const TABS_DEFAULTS = DEFAULTS;
