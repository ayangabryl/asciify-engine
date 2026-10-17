import type { GlyphFieldOptions } from '../field';
import { clamp, handle, house, mountSurface, styleKeeper, type KitHandle, type KitOptions, type Surface } from './core';

export interface BlockChartOptions extends KitOptions {
  /** The bars, left to right. */
  values?: readonly number[];
  /** A name per bar, read by screen readers and passed to `onHover`. */
  labels?: readonly string[];
  /** The value the top of the plot stands for. Default: the largest value plus 4%. */
  max?: number;
  /** How long each bar grows, in ms. Default 520. */
  duration?: number;
  /** Ms between bars growing. Default 45 for up to 7 bars, else 9. */
  stagger?: number;
  /** Formats values for the screen reader table. Default `toLocaleString()`. */
  format?: (value: number) => string;
  /** Called as the pointer or arrow keys move onto a bar, and with `null` when they leave. */
  onHover?: (index: number | null, value: number | null, label: string | null) => void;
}

export interface BlockChartHandle extends KitHandle<BlockChartOptions> {
  /** New values (and labels); the bars grow again. */
  set(values: readonly number[], labels?: readonly string[]): void;
  /** Lights one bar and dims the rest, or `null` for the resting emphasis on the last bar. */
  highlight(index: number | null): void;
  readonly active: number | null;
  readonly values: readonly number[];
}

const DEFAULTS = { values: [] as readonly number[], duration: 520 };
const SCALE = 2;
const tone = (t: number) => { const v = Math.round(255 * clamp(t)); return `rgb(${v} ${v} ${v})`; };

/** Which bar `x` (0–1 across the plot) falls on. */
export const barAt = (x: number, n: number) => (n ? Math.min(n - 1, Math.max(0, Math.floor(x * n))) : -1);

/** A bar chart drawn in columns of characters: bars grow in staggered, the last is emphasised, and hover lights one and dims the rest. */
export function blockChart(element: HTMLElement, options: BlockChartOptions = {}): BlockChartHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  let drawn = state.current.values, active: number | null = null, t0 = performance.now(), emph: number[] = [], then = 0, seen = false, surface: Surface | null = null;
  const values = () => state.current.values ?? [];
  const look = (): GlyphFieldOptions => ({
    mark: 'glyph', charset: ' .:-=+*#%@', font: '"Geist Mono", ui-monospace, monospace', fontWeight: 500,
    cellSize: 7, cellAspect: 0.6, glyphScale: 0.95, shade: 0.35, ...state.current.look,
  });

  surface = mountSurface({
    host: element,
    look,
    ink: dark => state.current.ink ?? (dark ? '#d8d6cf' : '#1d1d1b'),
    reducedMotion: () => state.current.reducedMotion,
    resolution: SCALE,
    onFail: () => { surface = null; },
    paint: ({ pen, w, h, now, still }) => {
      pen.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      const list = values(), n = list.length;
      if (!n) return false;
      const dt = then ? Math.min(64, now - then) : 16;
      then = now;
      const slot = w / n, width = Math.max(3, slot * (n <= 7 ? 0.56 : 0.64)), max = state.current.max ?? Math.max(...list, 0) * 1.04;
      const stagger = state.current.stagger ?? (n <= 7 ? 45 : 9);
      let busy = false;
      for (let i = 0; i < n; i++) {
        const local = still ? 1 : clamp((now - t0 - i * stagger) / state.current.duration);
        if (local < 1) busy = true;
        const want = active === null ? (i === n - 1 ? 1 : 0.55) : i === active ? 1 : 0.3, e = emph[i] ?? want;
        emph[i] = still ? want : e + (want - e) * (1 - Math.exp(-dt / 90));
        if (Math.abs(emph[i] - want) > 0.01) busy = true;
        const height = (max > 0 ? Math.max(0, list[i]) / max : 0) * (h - 2) * house(local), top = h - height, x = slot * (i + 0.5) - width / 2;
        if (height <= 0) continue;
        const k = 0.16 + 0.84 * emph[i], grad = pen.createLinearGradient(0, top, 0, h);
        grad.addColorStop(0, tone(k)); grad.addColorStop(1, tone(k * 0.5));
        pen.fillStyle = grad;
        pen.fillRect(x, top, width, height);
      }
      return busy;
    },
  });

  // Without the field the bars are plain blocks in the text colour, so the chart still reads.
  const styles = styleKeeper();
  const plain = surface ? null : document.createElement('div');
  const drawPlain = () => {
    if (!plain) return;
    const list = values(), n = list.length, max = state.current.max ?? Math.max(...list, 0) * 1.04;
    plain.replaceChildren(...list.map((v, i) => {
      const bar = document.createElement('div');
      const lit = active === null ? (i === n - 1 ? 1 : 0.55) : i === active ? 1 : 0.3;
      bar.setAttribute('style', `flex:1 1 0;height:${max > 0 ? (clamp(v / max) * 100).toFixed(2) : 0}%;margin:0 ${n <= 7 ? 22 : 18}%;background:currentColor;opacity:${(0.16 + 0.84 * lit) * 0.9}`);
      return bar;
    }));
  };
  if (plain) {
    if (getComputedStyle(element).position === 'static') styles.set(element, 'position', 'relative');
    plain.setAttribute('aria-hidden', 'true');
    plain.setAttribute('style', 'position:absolute;inset:0;display:flex;align-items:flex-end;pointer-events:none');
    element.appendChild(plain);
  }

  // A screen reader reads the numbers as a table; the bars themselves are decoration.
  const table = document.createElement('table');
  table.setAttribute('style', 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0');
  const fill = () => {
    const fmt = state.current.format ?? ((v: number) => v.toLocaleString()), labels = state.current.labels ?? [];
    const body = document.createElement('tbody');
    values().forEach((v, i) => {
      const tr = document.createElement('tr'), th = document.createElement('th'), td = document.createElement('td');
      th.setAttribute('scope', 'row'); th.textContent = labels[i] ?? String(i + 1); td.textContent = fmt(v);
      tr.appendChild(th); tr.appendChild(td); body.appendChild(tr);
    });
    table.replaceChildren(body);
  };
  fill();
  element.appendChild(table);
  const ownTab = !element.hasAttribute('tabindex'), ownRole = !element.hasAttribute('role');
  if (ownTab) element.tabIndex = 0;
  if (ownRole) element.setAttribute('role', 'group');

  const highlight = (index: number | null) => {
    const n = values().length;
    const next = index === null || !n ? null : Math.min(n - 1, Math.max(0, Math.round(index)));
    if (next === active) return;
    active = next;
    surface?.kick();
    drawPlain();
    state.current.onHover?.(active, active === null ? null : values()[active], active === null ? null : state.current.labels?.[active] ?? null);
  };
  const grow = () => { drawn = values(); t0 = performance.now(); emph = values().map((_, i, all) => (i === all.length - 1 ? 1 : 0.55)); surface?.kick(); drawPlain(); };
  drawPlain();
  const onMove = (event: PointerEvent) => {
    const b = element.getBoundingClientRect();
    if (!b.width) return;
    const x = (event.clientX - b.left) / b.width, y = event.clientY - b.top;
    if (x < 0 || x > 1 || y < 0 || y > b.height) { highlight(null); return; }
    highlight(barAt(x, values().length));
  };
  const onLeave = () => highlight(null);
  const onKey = (event: KeyboardEvent) => {
    const n = values().length;
    const next = event.key === 'ArrowRight' ? (active === null ? 0 : Math.min(n - 1, active + 1))
      : event.key === 'ArrowLeft' ? (active === null ? n - 1 : Math.max(0, active - 1))
        : event.key === 'Home' ? 0 : event.key === 'End' ? n - 1 : event.key === 'Escape' ? null : undefined;
    if (next === undefined || !n) return;
    event.preventDefault();
    highlight(next);
  };
  element.addEventListener('pointermove', onMove);
  element.addEventListener('pointerdown', onMove);
  element.addEventListener('pointerleave', onLeave);
  element.addEventListener('keydown', onKey);
  element.addEventListener('blur', onLeave);
  // The bars grow the first time the chart comes into view, not off screen where nobody sees them.
  const view = typeof IntersectionObserver === 'function' ? new IntersectionObserver(([entry]) => {
    if (entry?.isIntersecting && !seen) { seen = true; grow(); }
  }, { threshold: 0.4 }) : null;
  view?.observe(element);

  return handle(() => surface, state, next => { fill(); if (next.values !== drawn) grow(); surface?.refresh(); }, {
    set(next: readonly number[], labels?: readonly string[]) {
      state.current = { ...state.current, values: [...next], ...(labels ? { labels: [...labels] } : {}) };
      if (active !== null && active >= next.length) highlight(null);
      fill();
      grow();
    },
    highlight,
    get active() { return active; },
    get values() { return values(); },
  }, () => {
    view?.disconnect();
    table.remove();
    plain?.remove();
    styles.restore();
    element.removeEventListener('pointermove', onMove);
    element.removeEventListener('pointerdown', onMove);
    element.removeEventListener('pointerleave', onLeave);
    element.removeEventListener('keydown', onKey);
    element.removeEventListener('blur', onLeave);
    if (ownTab) element.removeAttribute('tabindex');
    if (ownRole) element.removeAttribute('role');
  });
}

export const BLOCK_CHART_DEFAULTS = DEFAULTS;
