import type { GlyphFieldOptions } from '../field';
import { clamp, handle, house, mountSurface, styleKeeper, type KitHandle, type KitOptions, type Surface } from './core';

export interface BlockChartOptions extends KitOptions {
  /** The bars, left to right. */
  values?: readonly number[];
  /** A name per bar, read by screen readers and passed to `onHover`. `set()` matches old and new bars by label, so shared bars glide into place. */
  labels?: readonly string[];
  /** The value the top of the plot stands for. Default: the largest value plus 4%. */
  max?: number;
  /** How long bars grow, glide and resize, in ms. Default 560. */
  duration?: number;
  /** Grow the bars in the first time the chart comes into view. `false` draws them in place at once, as in a view that is swapped in. Default true. */
  intro?: boolean;
  /** Ms between bars growing. Default 45 for up to 7 bars, else 12. */
  stagger?: number;
  /** Formats values for the screen reader table. Default `toLocaleString()`. */
  format?: (value: number) => string;
  /** Called as the pointer or arrow keys move onto a bar, and with `null` when they leave. */
  onHover?: (index: number | null, value: number | null, label: string | null) => void;
}

export interface BlockChartHandle extends KitHandle<BlockChartOptions> {
  /** New values (and labels); bars with a matching label glide and resize, new ones grow in, dropped ones sink away. */
  set(values: readonly number[], labels?: readonly string[]): void;
  /** Lights one bar and fades the rest, or `null` for the resting emphasis on the last bar. */
  highlight(index: number | null): void;
  readonly active: number | null;
  readonly values: readonly number[];
}

const DEFAULTS = { values: [] as readonly number[], duration: 560 };

/**
 * Tones on the 0–1 ramp, picked so every charset draws distinct glyphs for them: the baseline, then each bar's body and cap
 * when faded (another bar is lit), resting, and lit. The cap is one denser row, so every bar ends on a clean edge.
 */
const BASE = 0.16, FADED = 0.3, REST = 0.46, LIT = 0.8, CAP = 0.2;

interface Geo { x0: number; x1: number; h: number }

/** Which bar `x` (0–1 across the plot) falls on. */
export const barAt = (x: number, n: number) => (n ? Math.min(n - 1, Math.max(0, Math.floor(x * n))) : -1);

/** Bar width, gap and left edge in whole cells: the widest bars whose gaps stay at least about half a bar, centred. */
export function barLayout(cols: number, n: number) {
  if (!n) return { bar: 0, gap: 0, left: 0 };
  const ratio = n <= 7 ? 0.5 : 0.6;
  let bar = Math.max(1, Math.floor(cols / n));
  while (bar > 1 && n * bar + (n - 1) * Math.max(1, Math.round(bar * ratio)) > cols) bar--;
  const gap = n > 1 ? Math.max(0, Math.min(Math.ceil(bar * ratio * 1.6), Math.floor((cols - n * bar) / (n - 1)))) : 0;
  return { bar, gap, left: Math.max(0, Math.floor((cols - n * bar - (n - 1) * gap) / 2)) };
}

/** A bar chart drawn in columns of characters on a whole-cell grid: bars grow in staggered, the last is lit, hover lights one and fades the rest. */
export function blockChart(element: HTMLElement, options: BlockChartOptions = {}): BlockChartHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  let drawn = state.current.values, active: number | null = null, emph: number[] = [], then = 0, seen = false, surface: Surface | null = null;
  // Where each bar starts its current move (null grows from the baseline), and bars a set() dropped, sinking from where they were.
  let t0 = state.current.intro === false ? -1e9 : performance.now(), from: (Geo | null)[] = [], delay: number[] = [], ghosts: Geo[] = [];
  let grid = { cols: 0, rows: 0 };
  const values = () => state.current.values ?? [];
  const look = (): GlyphFieldOptions => ({
    mark: 'glyph', charset: ' .:-=+*#%@', font: '"Geist Mono", ui-monospace, monospace', fontWeight: 500,
    cellSize: 7, cellAspect: 1, glyphScale: 1.1, shade: 0.5, blend: 'off', ...state.current.look,
  });
  /**
   * Square cells of whole device pixels, and the canvas trimmed to a whole number of them (and of CSS pixels), centred and
   * resting on the baseline. The field reads each cell from the source's mip levels, so with exactly 2 × 2 texels per cell
   * both levels it blends sit on the cell: every cell reads back exactly the tone painted for it, nothing bleeds from its neighbours.
   */
  const gridOf = (w: number, h: number) => {
    const { cellSize = 7, maxPixelRatio = 2 } = look();
    const ratio = Math.min(typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1, maxPixelRatio);
    const c = Math.max(2, Math.round(cellSize * ratio)), cell = c / ratio;
    const fit = (size: number) => {
      const most = Math.max(1, Math.floor((size * ratio) / c));
      for (let n = most; n > 1 && n > most - 8; n--) if (Math.abs(n * cell - Math.round(n * cell)) < 0.01) return n;
      return most;
    };
    const cols = fit(w), rows = Math.max(2, fit(h));
    return { cols, rows, cell, gw: Math.round(cols * cell), gh: Math.round(rows * cell) };
  };
  let frame = { left: 0, cell: 0 };
  /** Fits the canvas to the grid; true when it moved, so the field must measure again before the grid holds. */
  const trim = () => {
    const canvas = surface?.canvas;
    if (!canvas || !element.offsetWidth) return false;
    const { gw, gh, cell } = gridOf(element.offsetWidth, element.offsetHeight), left = Math.round((element.offsetWidth - gw) / 2);
    const box = [`${left}px`, `${element.offsetHeight - gh}px`, `${gw}px`, `${gh}px`];
    frame = { left, cell };
    let moved = false;
    (['left', 'top', 'width', 'height'] as const).forEach((key, i) => { if (canvas.style[key] !== box[i]) { canvas.style[key] = box[i]; moved = true; } });
    if (moved) surface?.field.resize();
    return moved;
  };
  const rest = (i: number, n: number) => (active === null ? (i === n - 1 ? LIT : REST) : i === active ? LIT : FADED);
  const target = (i: number, list: readonly number[], cols: number, rows: number): Geo => {
    const { bar, gap, left } = barLayout(cols, list.length), max = state.current.max ?? Math.max(...list, 0) * 1.04;
    const v = max > 0 ? clamp(Math.max(0, list[i]) / max) * (rows - 1) : 0;
    const x0 = left + i * (bar + gap);
    return { x0, x1: x0 + bar, h: v > 0 ? Math.max(1, Math.round(v)) : 0 };
  };
  const progress = (i: number, now: number) => house((now - t0 - (delay[i] ?? 0)) / state.current.duration);
  const geoAt = (i: number, list: readonly number[], now: number, still: boolean): Geo => {
    const to = target(i, list, grid.cols, grid.rows);
    if (still) return to;
    const a = from[i] ?? { ...to, h: 0 }, p = progress(i, now);
    return { x0: a.x0 + (to.x0 - a.x0) * p, x1: a.x1 + (to.x1 - a.x1) * p, h: a.h + (to.h - a.h) * p };
  };

  surface = mountSurface({
    host: element,
    look,
    ink: () => state.current.ink ?? '--ascii-ink-strong',
    kit: state,
    reducedMotion: () => state.current.reducedMotion,
    resolution: (w, h) => { const { cell } = gridOf(w, h); return [Math.max(2, Math.round(w / cell) * 2), Math.max(4, Math.round(h / cell) * 2)]; },
    onFail: () => { surface = null; },
    paint: ({ pen, width, height, now, still }) => {
      const moved = trim(), cols = width / 2, rows = height / 2;
      grid = { cols, rows };
      const list = values(), n = list.length;
      const dt = then ? Math.min(64, now - then) : 16;
      then = now;
      const tone = new Float32Array(cols * rows);
      const put = (c: number, r: number, t: number) => { const k = (rows - 1 - r) * cols + c; if (t > tone[k]) tone[k] = t; };
      for (let c = 0; c < cols; c++) put(c, 0, BASE);
      // A bar is painted by coverage, so mid-move edges land on lighter glyphs and settle to whole, crisp cells.
      const draw = ({ x0, x1, h }: Geo, body: number) => {
        if (h <= 0.01) return;
        const top = Math.ceil(h) - 1;
        for (let c = Math.max(0, Math.floor(x0)); c < Math.min(cols, Math.ceil(x1)); c++) {
          const cx = clamp(Math.min(c + 1, x1) - Math.max(c, x0));
          for (let r = 0; r <= top && r < rows - 1; r++) put(c, r + 1, (r === top ? Math.min(1, body + CAP) : body) * cx * clamp(h - r));
        }
      };
      let busy = false;
      const ghostP = still ? 1 : house((now - t0) / state.current.duration);
      if (ghostP < 1) busy = true;
      for (const g of ghosts) draw({ ...g, h: g.h * (1 - ghostP) }, REST);
      if (ghostP >= 1) ghosts = [];
      for (let i = 0; i < n; i++) {
        if (!still && progress(i, now) < 1) busy = true;
        const want = rest(i, n), e = emph[i] ?? want;
        emph[i] = still ? want : e + (want - e) * (1 - Math.exp(-dt / 70));
        if (Math.abs(emph[i] - want) > 0.004) busy = true;
        draw(geoAt(i, list, now, still), emph[i]);
      }
      for (let k = 0; k < tone.length; k++) {
        if (tone[k] <= 0) continue;
        const v = Math.round(255 * tone[k]);
        pen.fillStyle = `rgb(${v} ${v} ${v})`;
        pen.fillRect((k % cols) * 2, Math.floor(k / cols) * 2, 2, 2);
      }
      // A still frame ends the loop, so the frame that trimmed the canvas asks for the one that fills it.
      if (moved && still) surface?.kick();
      return busy || moved;
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
      bar.setAttribute('style', `flex:1 1 0;height:${max > 0 ? (clamp(v / max) * 100).toFixed(2) : 0}%;margin:0 ${n <= 7 ? 22 : 18}%;background:currentColor;opacity:${(0.16 + 0.84 * rest(i, n)) * 0.9}`);
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
      // Row headers keep the page's weight: a hidden table should not add a bold weight to the page's type.
      th.setAttribute('scope', 'row'); th.setAttribute('style', 'font-weight:inherit'); th.textContent = labels[i] ?? String(i + 1); td.textContent = fmt(v);
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
  const stagger = (n: number) => state.current.stagger ?? (n <= 7 ? 45 : 12);
  const grow = () => {
    const n = values().length;
    drawn = values(); t0 = performance.now(); from = []; ghosts = [];
    delay = Array.from({ length: n }, (_, i) => i * stagger(n));
    emph = values().map((_, i, all) => rest(i, all.length));
    surface?.kick(); drawPlain();
  };
  /** From what is on screen now to `next`: bars that share a label (or, without labels, a place from the right) glide; the rest grow or sink. */
  const morph = (prev: readonly number[], prevLabels: readonly string[] | undefined) => {
    const list = values(), labels = state.current.labels, now = performance.now(), still = !!surface?.still();
    const was = grid.cols && !still ? prev.map((_, i) => geoAt(i, prev, now, false)) : [];
    const sinking = still ? [] : ghosts.map(g => ({ ...g, h: g.h * (1 - house((now - t0) / state.current.duration)) }));
    const before = new Map<string, number>(), key = (i: number, n: number, names?: readonly string[]) => (labels && prevLabels ? names?.[i] ?? `#${i}` : `#${n - 1 - i}`);
    prev.forEach((_, i) => before.set(key(i, prev.length, prevLabels), i));
    const used = new Set<number>(), oldEmph = emph;
    let fresh = 0;
    const n = list.length;
    from = list.map((_, i) => { const j = before.get(key(i, n, labels)); if (j === undefined || !was[j]) return null; used.add(j); return was[j]; });
    emph = list.map((_, i) => { const j = before.get(key(i, n, labels)); return j !== undefined ? oldEmph[j] ?? REST : REST; });
    delay = from.map(f => (f ? 0 : fresh++ * stagger(n) * 0.6));
    ghosts = [...sinking, ...was.filter((_, j) => !used.has(j))].filter(g => g.h > 0.01);
    drawn = list; t0 = now;
    surface?.kick(); drawPlain();
  };
  drawPlain();
  const onMove = (event: PointerEvent) => {
    const b = element.getBoundingClientRect(), n = values().length;
    if (!b.width) return;
    const x = (event.clientX - b.left) / b.width, y = event.clientY - b.top;
    if (x < 0 || x > 1 || y < 0 || y > b.height) { highlight(null); return; }
    if (!grid.cols) { highlight(barAt(x, n)); return; }
    // The nearest bar by its centre, so the gaps and the margins scrub too.
    const { bar, gap, left } = barLayout(grid.cols, n);
    highlight(Math.round(((event.clientX - b.left - frame.left) / frame.cell - left - bar / 2) / Math.max(1, bar + gap)));
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
  element.addEventListener('pointercancel', onLeave);
  element.addEventListener('keydown', onKey);
  element.addEventListener('blur', onLeave);
  // The bars grow the first time the chart comes into view, not off screen where nobody sees them.
  const view = typeof IntersectionObserver === 'function' ? new IntersectionObserver(([entry]) => {
    if (entry?.isIntersecting && !seen) { seen = true; if (state.current.intro !== false) grow(); }
  }, { threshold: 0.4 }) : null;
  view?.observe(element);

  let shownLabels = state.current.labels;
  return handle(() => surface, state, next => {
    fill();
    if (next.values !== drawn) { morph(drawn, shownLabels); shownLabels = next.labels; }
    surface?.refresh();
  }, {
    set(next: readonly number[], labels?: readonly string[]) {
      const prev = drawn, prevLabels = shownLabels;
      state.current = { ...state.current, values: [...next], ...(labels ? { labels: [...labels] } : {}) };
      shownLabels = state.current.labels;
      if (active !== null && active >= next.length) highlight(null);
      fill();
      morph(prev, prevLabels);
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
    element.removeEventListener('pointercancel', onLeave);
    element.removeEventListener('keydown', onKey);
    element.removeEventListener('blur', onLeave);
    if (ownTab) element.removeAttribute('tabindex');
    if (ownRole) element.removeAttribute('role');
  });
}

export const BLOCK_CHART_DEFAULTS = DEFAULTS;
