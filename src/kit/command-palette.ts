import type { GlyphFieldOptions } from '../field';
import { boxIn, clamp, handle, hash, house, mountSurface, prefersReduced, styleKeeper, type Box, type KitHandle, type KitOptions, type Surface } from './core';
import { BLOCK_H, BLOCK_W, blocksOf, drawBlocks, snapshot, type Block } from './paint-dom';
import { injectStyle } from './capture';

export interface CommandPaletteOptions extends KitOptions {
  /** The button that opens the palette. Blocks fly out of it on open and back into it on close. */
  trigger?: HTMLElement | null;
  /** The search field inside the palette. Default: its first `input`. */
  input?: string;
  /** The command rows. Default `[role="option"]`. */
  rows?: string;
  /** Start open. Default: open unless the palette has the `hidden` attribute. */
  open?: boolean;
  /** ⌘K / Ctrl+K toggles the palette from anywhere on the page; `false` turns it off. Default `'k'`. */
  hotkey?: string | false;
  /** Wire arrow keys, Home, End, Enter, Escape, pointer hover, outside clicks and `aria-selected`. Default true. */
  manage?: boolean;
  /** Close after a command runs. Default true. */
  closeOnRun?: boolean;
  /** Called when a row is chosen with Enter or a click. */
  onRun?: (index: number, row: HTMLElement) => void;
  /** Called after the palette opens or closes. */
  onOpenChange?: (open: boolean) => void;
  /** A highlight that glides behind the selected row. `false` when your rows style `aria-selected` themselves. Default true. */
  highlight?: boolean;
  /** Rows that carry the AI signature: a sweep of characters runs through their highlight while selected. Default `[data-ai]`. */
  ai?: string;
}

export interface CommandPaletteHandle extends KitHandle<CommandPaletteOptions> {
  /** Condenses the palette out of the trigger. `focus` moves focus to the input (default true). */
  open(focus?: boolean): void;
  /** Dissolves the palette back into the trigger. */
  close(): void;
  toggle(): void;
  /** Moves the selection; the highlight glides to the row. */
  select(index: number): void;
  /** Runs a row as if it were clicked. */
  run(index?: number): void;
  readonly isOpen: boolean;
  readonly selected: number;
}

const DEFAULTS = { input: 'input', rows: '[role="option"]', hotkey: 'k' as string | false, manage: true, closeOnRun: true, highlight: true, ai: '[data-ai]' };
const OPEN_MS = 260, CLOSE_MS = 200, RUN_MS = 240, SCALE = 2;
/** New rows resolve out of characters over RESOLVE_MS, each a beat after the one above. */
const RESOLVE_MS = 280, RESOLVE_STAGGER = 28;
/** The AI shimmer: one pass takes SWEEP_MS, once every SWEEP_EVERY ms while the row stays selected; the crest is 2 × CREST px wide. */
const SWEEP_MS = 1100, SWEEP_EVERY = 3600, SWEEP_DELAY = 160, CREST = 40;
const HOUSE = 'cubic-bezier(.16, 1, .3, 1)';
const CSS = `
:where([data-ascii-cmd-highlight]){position:absolute;left:0;top:0;z-index:-1;pointer-events:none;opacity:0;background:var(--ascii-cmd-highlight,color-mix(in oklab,currentColor 7%,transparent));transition:translate 240ms ${HOUSE},width 240ms ${HOUSE},height 240ms ${HOUSE},opacity 160ms ${HOUSE}}
:where([data-ascii-cmd-highlight][data-on]){opacity:1}
@media (prefers-reduced-motion:reduce){:where([data-ascii-cmd-highlight]){transition:none}}
`;
const inOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

interface Resolve { row: HTMLElement; snap: HTMLCanvasElement; blocks: Block[]; order: Float32Array; start: number; styles: ReturnType<typeof styleKeeper> }

/**
 * A command palette that condenses out of its trigger in blocks of characters and dissolves back into it. A highlight glides
 * between rows, rows that a search brings in resolve out of characters, and an AI row's highlight carries a sweep of characters.
 */
export function commandPalette(panel: HTMLElement, options: CommandPaletteOptions = {}): CommandPaletteHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  const flightStyles = styleKeeper();
  const rows = () => [...panel.querySelectorAll<HTMLElement>(state.current.rows)];
  const input = () => panel.querySelector<HTMLInputElement>(state.current.input);
  const panelStyles = styleKeeper();
  let isOpen = state.current.open ?? !panel.hasAttribute('hidden'), sel = 0;
  let flight: null | { snap: HTMLCanvasElement; blocks: Block[]; order: Float32Array; ox: number; oy: number; start: number; closing: boolean } = null;
  let busy = false, timer = 0, surface: Surface | null = null, resolves: Resolve[] = [], sweepRow: HTMLElement | null = null, sweepFrom = 0, sweepTimer = 0;
  const seen = new WeakMap<HTMLElement, number>();
  const reduced = () => !!(state.current.reducedMotion ?? prefersReduced());
  const look = (): GlyphFieldOptions => ({
    mark: 'glyph', charset: ' .:-=+*#%@', font: '"Geist Mono", ui-monospace, monospace', fontWeight: 500,
    cellSize: 5, cellAspect: 0.62, glyphScale: 0.92, ...state.current.look,
  });

  injectStyle('ascii-kit-command', CSS);
  if (getComputedStyle(panel).position === 'static') panelStyles.set(panel, 'position', 'relative');
  // Its own stacking context, so the highlight and the field can sit under the rows' text and still above the panel's fill.
  panelStyles.set(panel, 'isolation', 'isolate');
  const hl = document.createElement('div');
  hl.setAttribute('aria-hidden', 'true');
  hl.dataset.asciiCmdHighlight = '';
  if (state.current.highlight) panel.insertBefore(hl, panel.firstElementChild);

  /** A row's layout box in the panel, untouched by a pressed row's scale. */
  const layoutBox = (row: HTMLElement): Box => {
    if (row.offsetParent === undefined) return boxIn(panel, row);
    let x = 0, y = 0;
    for (let n: HTMLElement | null = row; n && n !== panel; n = n.offsetParent as HTMLElement | null) { x += n.offsetLeft; y += n.offsetTop; }
    for (let n = row.parentElement; n && n !== panel; n = n.parentElement) { x -= n.scrollLeft; y -= n.scrollTop; }
    return { x, y, w: row.offsetWidth, h: row.offsetHeight };
  };
  const place = (glide: boolean) => {
    const row = rows()[sel];
    if (!hl.parentElement) return;
    if (!row || !isOpen) { delete hl.dataset.on; return; }
    const b = layoutBox(row), snap = !glide || hl.dataset.on === undefined || reduced();
    if (snap) hl.style.transition = 'none';
    hl.style.translate = `${b.x}px ${b.y}px`;
    hl.style.width = `${b.w}px`;
    hl.style.height = `${b.h}px`;
    hl.style.borderRadius = getComputedStyle(row).borderTopLeftRadius;
    hl.dataset.on = '';
    if (snap) { void hl.offsetWidth; hl.style.removeProperty('transition'); }
  };

  /** Rows a search brings in or moves resolve out of characters; rows that stay where they were are left alone. */
  const resolveRows = () => {
    const s = surface, all = rows();
    const fresh = all.filter(row => { const y = layoutBox(row).y, was = seen.get(row); seen.set(row, y); return was === undefined || Math.abs(was - y) > 1; });
    for (const fx of resolves) if (!all.includes(fx.row) || fresh.includes(fx.row)) fx.styles.restore();
    resolves = resolves.filter(fx => all.includes(fx.row) && !fresh.includes(fx.row));
    if (!s || !s.live || s.still() || busy || !isOpen) return;
    const w = s.canvas.clientWidth || panel.offsetWidth, h = s.canvas.clientHeight || panel.offsetHeight, now = performance.now();
    fresh.forEach((row, i) => {
      const snap = snapshot(row, s.box, w, h, SCALE), blocks = blocksOf(snap, SCALE);
      if (!blocks.length) return;
      const left = Math.min(...blocks.map(b => b.x)), span = Math.max(1, Math.max(...blocks.map(b => b.x)) - left);
      const styles = styleKeeper();
      for (const child of [...row.children] as HTMLElement[]) styles.set(child, 'opacity', '0');
      resolves.push({ row, snap, blocks, order: Float32Array.from(blocks, b => 0.72 * ((b.x - left) / span) + 0.28 * b.seed), start: now + i * RESOLVE_STAGGER, styles });
    });
    s.kick();
  };

  /**
   * The AI row's shimmer: a crest crosses the row and the letters under it turn to characters and back. The row is masked
   * out under the crest, so the HTML text and the characters never draw over each other.
   */
  let aiSnap: { row: HTMLElement; key: string; snap: HTMLCanvasElement; blocks: Block[] } | null = null;
  const aiMask = styleKeeper();
  const shimmer = (pen: CanvasRenderingContext2D, row: HTMLElement, b: Box, t: number, now: number) => {
    const s = surface!, key = `${row.textContent}|${b.x}|${b.y}|${b.w}`;
    if (aiSnap?.row !== row || aiSnap.key !== key) {
      const snap = snapshot(row, s.box, s.canvas.clientWidth || panel.offsetWidth, s.canvas.clientHeight || panel.offsetHeight, SCALE);
      aiSnap = { row, key, snap, blocks: blocksOf(snap, SCALE) };
    }
    const cx = b.x - CREST + (b.w + CREST * 2) * inOut(t), tick = Math.floor(now / 70);
    for (const block of aiSnap.blocks) {
      const d = (block.x + 2 - cx) / CREST;
      if (d <= -1 || d >= 1) continue;
      const strength = 1 - d * d;
      // A few blocks drop out each tick, so the crest reads as characters turning over rather than a moving stamp.
      if (hash(block.x + tick, block.y) > 0.35 + 0.65 * strength) continue;
      pen.globalAlpha = Math.min(1, strength * 1.6);
      pen.drawImage(aiSnap.snap, block.x * SCALE, block.y * SCALE, BLOCK_W * SCALE, BLOCK_H * SCALE, block.x, block.y, BLOCK_W, BLOCK_H);
    }
    pen.globalAlpha = 1;
    const l = cx - b.x;
    aiMask.set(row, 'mask-image', `linear-gradient(90deg, #000 ${l - CREST}px, transparent ${l - CREST * 0.35}px, transparent ${l + CREST * 0.35}px, #000 ${l + CREST}px)`);
  };

  surface = mountSurface({
    host: panel,
    // Under the content, over the panel's fill and the highlight: the sweep lies behind the text, and flights draw while the content is hidden.
    layer: 'under',
    look,
    ink: () => state.current.ink ?? '--ascii-ink-strong',
    kit: state,
    reducedMotion: () => state.current.reducedMotion,
    resolution: SCALE,
    onFail: () => { surface = null; },
    paint: ({ pen, now, still, box }) => {
      pen.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      if (flight) {
        const f = flight, k = (now - f.start) / (f.closing ? CLOSE_MS : OPEN_MS);
        // A finished flight falls through, so an opened palette draws its marker in the same frame.
        if (k >= 1 || still) flight = null;
        else {
          const p = f.closing ? 1 - house(k) * 1.02 : house(k) * 1.04;
          drawBlocks(pen, f.snap, f.blocks, f.order, p, (b, away) => [(f.ox - b.x) * away * 0.9, (f.oy - b.y) * away * 0.9], f.closing ? 1 : 1 - clamp((k - 0.72) / 0.28), 0.4);
          return true;
        }
      }
      if (!isOpen || busy) return false;
      let more = false;
      resolves = resolves.filter(fx => {
        const k = (now - fx.start) / RESOLVE_MS;
        if (k >= 0.7 || still) fx.styles.restore();
        if (k >= 1 || still || !panel.contains(fx.row)) { fx.styles.restore(); return false; }
        more = true;
        if (k > 0) drawBlocks(pen, fx.snap, fx.blocks, fx.order, house(k) * 1.04, (_, away) => [14 * away, 0], 1 - clamp((k - 0.7) / 0.3), 0.42);
        return true;
      });
      const row = rows()[sel];
      if (row && !still && row.matches(state.current.ai)) {
        if (row !== sweepRow) { sweepRow = row; sweepFrom = now + SWEEP_DELAY; }
        const since = now - sweepFrom, t = since >= 0 ? (since % SWEEP_EVERY) / SWEEP_MS : -1;
        if (t >= 0 && t < 1 && !resolves.some(fx => fx.row === row)) { shimmer(pen, row, box(row), t, now); more = true; }
        else {
          aiMask.restore();
          if (more) return true;
          // Between passes nothing moves: wake for the next one instead of drawing empty frames.
          if (sweepTimer) clearTimeout(sweepTimer);
          const wait = since >= 0 ? SWEEP_EVERY - (since % SWEEP_EVERY) : -since;
          sweepTimer = setTimeout(() => { sweepTimer = 0; surface?.kick(); }, Math.max(16, wait)) as unknown as number;
        }
      } else { sweepRow = null; aiMask.restore(); }
      return more;
    },
  });
  if (surface) panel.dataset.gpu = '';

  const sync = (glide = true) => {
    const all = rows();
    sel = all.length ? Math.min(Math.max(0, sel), all.length - 1) : 0;
    place(glide);
    if (!state.current.manage) return;
    all.forEach((row, i) => row.setAttribute('aria-selected', String(i === sel)));
    const field = input(), id = all[sel]?.id;
    if (field && id) field.setAttribute('aria-activedescendant', id);
  };
  const remember = () => { for (const row of rows()) seen.set(row, layoutBox(row).y); };
  const full = () => `inset(0 round ${getComputedStyle(panel).borderTopLeftRadius || '0px'})`;
  const triggerInset = () => {
    const t = state.current.trigger, W = panel.offsetWidth, H = panel.offsetHeight;
    if (!t) return `inset(0 ${Math.max(0, W / 2 - 40)}px ${Math.max(0, H - 36)}px round 18px)`;
    const b = boxIn(panel, t);
    return `inset(${b.y}px ${W - b.x - b.w}px ${H - b.y - b.h}px ${b.x}px round ${b.h / 2}px)`;
  };
  /** Blocks of the palette fly between the trigger and their places. */
  const fly = (closing: boolean) => {
    const s = surface;
    if (!s) return;
    const w = panel.offsetWidth, h = panel.offsetHeight, snap = snapshot(panel, s.box, w, h, SCALE), blocks = blocksOf(snap, SCALE);
    const t = state.current.trigger, tb = t ? s.box(t) : { x: w / 2, y: 0, w: 0, h: 0 }, ox = tb.x + tb.w / 2, oy = tb.y + tb.h / 2, reach = Math.hypot(w, h) || 1;
    flight = { snap, blocks, order: Float32Array.from(blocks, b => 0.7 * (Math.hypot(b.x - ox, b.y - oy) / reach) + 0.3 * b.seed), ox, oy, start: performance.now(), closing };
    s.kick();
  };
  const hideContent = (on: boolean) => {
    if (!on) { flightStyles.restore(); return; }
    for (const child of [...panel.children] as HTMLElement[]) if (!(child.tagName === 'CANVAS' && child.dataset.asciiKit !== undefined)) flightStyles.set(child, 'opacity', '0');
  };
  const clip = (frames: string[], ms: number, fill: FillMode = 'none') => {
    if (typeof panel.animate !== 'function') return null;
    return panel.animate(frames.map(clipPath => ({ clipPath })), { duration: ms, easing: HOUSE, fill });
  };
  const clearTimer = () => { if (timer) clearTimeout(timer); timer = 0; };

  const open = (focus = true) => {
    if (isOpen && !busy) { if (focus) input()?.focus({ preventScroll: true }); return; }
    clearTimer();
    isOpen = true; busy = false; sel = 0;
    panel.removeAttribute('hidden');
    panel.dataset.open = '';
    state.current.trigger?.setAttribute('aria-expanded', 'true');
    sync(false);
    remember();
    if (focus) input()?.focus({ preventScroll: true });
    state.current.onOpenChange?.(true);
    if (reduced()) { surface?.kick(); return; }
    panel.dataset.state = 'opening';
    clip([triggerInset(), full()], OPEN_MS);
    if (surface) { busy = true; hideContent(true); fly(false); }
    timer = setTimeout(() => { timer = 0; delete panel.dataset.state; busy = false; hideContent(false); surface?.kick(); }, OPEN_MS * 0.55);
  };
  const close = () => {
    if (!isOpen) return;
    clearTimer();
    const refocus = panel.contains(document.activeElement);
    const done = () => {
      timer = 0; busy = false; isOpen = false; flight = null;
      delete panel.dataset.state; delete panel.dataset.open;
      hideContent(false);
      place(false);
      for (const fx of resolves) fx.styles.restore();
      resolves = []; aiMask.restore(); aiSnap = null;
      panel.setAttribute('hidden', '');
      state.current.trigger?.setAttribute('aria-expanded', 'false');
      if (refocus) state.current.trigger?.focus({ preventScroll: true });
      surface?.kick();
      state.current.onOpenChange?.(false);
    };
    if (reduced()) { done(); return; }
    busy = true;
    panel.dataset.state = 'closing';
    if (surface) { fly(true); hideContent(true); }
    const anim = clip([full(), triggerInset()], CLOSE_MS, 'forwards');
    // The panel's surface fades out as its clip lands on the trigger, so the trigger shows through instead of a blank pill.
    const fade = typeof panel.animate === 'function' ? panel.animate([{ opacity: 1 }, { opacity: 1, offset: 0.4 }, { opacity: 0 }], { duration: CLOSE_MS, fill: 'forwards' }) : null;
    timer = setTimeout(() => { done(); anim?.cancel(); fade?.cancel(); }, CLOSE_MS);
  };
  const select = (index: number) => {
    const n = rows().length;
    if (!n) return;
    sel = ((Math.round(index) % n) + n) % n;
    sync();
    surface?.kick();
  };
  const run = (index = sel) => {
    const row = rows()[index];
    if (!row || busy) return;
    select(index);
    surface?.field.pulse({ element: row, strength: 0.6 });
    if (row.matches(state.current.ai)) { sweepRow = row; sweepFrom = performance.now(); }
    row.dataset.run = '';
    state.current.onRun?.(index, row);
    const finish = () => { delete row.dataset.run; if (state.current.closeOnRun) close(); };
    if (reduced()) finish(); else setTimeout(finish, RUN_MS);
  };

  const onKey = (event: KeyboardEvent) => {
    if (!state.current.manage) return;
    const n = rows().length;
    if (event.key === 'Escape' && isOpen) { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.target !== input() && !rows().includes(event.target as HTMLElement)) return;
    const to = event.key === 'ArrowDown' ? sel + 1 : event.key === 'ArrowUp' ? sel - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? n - 1 : null;
    if (to !== null) { event.preventDefault(); select(to); return; }
    if (event.key === 'Enter') { event.preventDefault(); run(); }
  };
  const rowOf = (event: Event) => {
    const row = (event.target as Element | null)?.closest?.(state.current.rows) as HTMLElement | null;
    return row ? rows().indexOf(row) : -1;
  };
  const onMove = (event: Event) => {
    if (!state.current.manage) return;
    const i = rowOf(event);
    if (i < 0) return;
    if (i !== sel) select(i);
  };
  const onClick = (event: Event) => { if (!state.current.manage) return; const i = rowOf(event); if (i >= 0) run(i); };
  const onInput = () => { if (state.current.manage) { sel = 0; sync(false); } };
  // A framework renders the search's rows after the input event, so the rows are watched rather than read on input.
  const watch = typeof MutationObserver === 'function' ? new MutationObserver(() => { if (!isOpen) return; sync(false); resolveRows(); }) : null;
  watch?.observe(panel, { childList: true, subtree: true });
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => place(false)) : null;
  resize?.observe(panel);
  const onTrigger = () => { if (isOpen) close(); else open(true); };
  const onHotkey = (event: KeyboardEvent) => {
    const key = state.current.hotkey;
    if (!key || event.key?.toLowerCase() !== key.toLowerCase() || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    if (isOpen) { if (document.activeElement === input()) close(); else input()?.focus(); } else open(true);
  };
  const onOutside = (event: Event) => {
    if (!state.current.manage || !isOpen || busy) return;
    const target = event.target as Node;
    if (!panel.contains(target) && !state.current.trigger?.contains(target)) close();
  };

  panel.addEventListener('keydown', onKey);
  panel.addEventListener('pointermove', onMove);
  panel.addEventListener('click', onClick);
  panel.addEventListener('input', onInput);
  const trigger = state.current.trigger;
  trigger?.addEventListener('click', onTrigger);
  trigger?.setAttribute('aria-expanded', String(isOpen));
  trigger?.setAttribute('aria-haspopup', 'dialog');
  document.addEventListener('keydown', onHotkey);
  document.addEventListener('pointerdown', onOutside);
  if (!isOpen) panel.setAttribute('hidden', ''); else panel.dataset.open = '';
  sync();

  return handle(() => surface, state, () => { sync(); surface?.refresh(); }, {
    open, close, select, run,
    toggle() { if (isOpen) close(); else open(true); },
    get isOpen() { return isOpen; },
    get selected() { return sel; },
  }, () => {
    clearTimer();
    if (sweepTimer) clearTimeout(sweepTimer);
    hideContent(false);
    for (const fx of resolves) fx.styles.restore();
    aiMask.restore();
    watch?.disconnect();
    resize?.disconnect();
    hl.remove();
    panelStyles.restore();
    panel.removeEventListener('keydown', onKey);
    panel.removeEventListener('pointermove', onMove);
    panel.removeEventListener('click', onClick);
    panel.removeEventListener('input', onInput);
    trigger?.removeEventListener('click', onTrigger);
    document.removeEventListener('keydown', onHotkey);
    document.removeEventListener('pointerdown', onOutside);
    delete panel.dataset.gpu; delete panel.dataset.state;
  });
}

export const COMMAND_PALETTE_DEFAULTS = DEFAULTS;
