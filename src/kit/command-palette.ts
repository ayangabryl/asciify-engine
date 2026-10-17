import type { GlyphFieldOptions } from '../field';
import { boxIn, clamp, handle, house, mountSurface, prefersReduced, styleKeeper, type Box, type KitHandle, type KitOptions, type Surface } from './core';
import { blocksOf, drawBlocks, snapshot, type Block } from './paint-dom';

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
}

export interface CommandPaletteHandle extends KitHandle<CommandPaletteOptions> {
  /** Condenses the palette out of the trigger. `focus` moves focus to the input (default true). */
  open(focus?: boolean): void;
  /** Dissolves the palette back into the trigger. */
  close(): void;
  toggle(): void;
  /** Moves the selection; the marker glides to the row. */
  select(index: number): void;
  /** Runs a row as if it were clicked. */
  run(index?: number): void;
  readonly isOpen: boolean;
  readonly selected: number;
}

const DEFAULTS = { input: 'input', rows: '[role="option"]', hotkey: 'k' as string | false, manage: true, closeOnRun: true };
const OPEN_MS = 260, CLOSE_MS = 200, RUN_MS = 240, SCALE = 2;
const HOUSE = 'cubic-bezier(.16, 1, .3, 1)';
const grey = (t: number) => { const v = Math.round(clamp(t) * 255); return `rgb(${v} ${v} ${v})`; };

/**
 * A command palette that condenses out of its trigger in blocks of characters and dissolves back into it, with a glyph marker
 * in the selected row's gutter that glides between rows.
 */
export function commandPalette(panel: HTMLElement, options: CommandPaletteOptions = {}): CommandPaletteHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  const flightStyles = styleKeeper();
  const rows = () => [...panel.querySelectorAll<HTMLElement>(state.current.rows)];
  const input = () => panel.querySelector<HTMLInputElement>(state.current.input);
  let isOpen = state.current.open ?? !panel.hasAttribute('hidden'), sel = 0, band: Box | null = null, lantern = false, glow = 0, then = 0;
  let flight: null | { snap: HTMLCanvasElement; blocks: Block[]; order: Float32Array; ox: number; oy: number; start: number; closing: boolean } = null;
  let busy = false, timer = 0, surface: Surface | null = null;
  const reduced = () => !!(state.current.reducedMotion ?? prefersReduced());
  const look = (): GlyphFieldOptions => ({
    mark: 'glyph', charset: ' .:-=+*#%@', font: '"Geist Mono", ui-monospace, monospace', fontWeight: 500,
    cellSize: 5, cellAspect: 0.62, glyphScale: 0.92, ...state.current.look,
  });

  surface = mountSurface({
    host: panel,
    // Over the content: the marker sits in the gutter on top of the row's own highlight, and flights draw while the content is hidden.
    look,
    ink: dark => state.current.ink ?? (dark ? '#d8d6cf' : '#1d1d1b'),
    kit: state,
    reducedMotion: () => state.current.reducedMotion,
    resolution: SCALE,
    onFail: () => { surface = null; },
    paint: ({ pen, now, still, box }) => {
      pen.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      const dt = then ? Math.min(48, now - then) : 16;
      then = now;
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
      const row = rows()[sel];
      if (!row) return false;
      // The row's highlight stays crisp HTML; the characters mark it from the gutter, where no text is.
      const b = box(row), was = band?.y ?? b.y;
      if (!band || still) band = { ...b };
      else { const a = 1 - Math.exp(-dt / 45); band = { x: b.x, w: b.w, y: band.y + (b.y - band.y) * a, h: band.h + (b.h - band.h) * a }; }
      glow += ((lantern ? 1 : 0) - glow) * (still ? 1 : 1 - Math.exp(-dt / 70));
      const x = band.x + 4, len = Math.max(4, band.h - 14), top = band.y + 7;
      if (Math.abs(was - band.y) > 0.5) { pen.fillStyle = grey(0.32); pen.fillRect(x, Math.min(was, band.y) + 7, 6, Math.abs(was - band.y) + len); }
      pen.fillStyle = grey(0.7 + 0.3 * glow);
      pen.beginPath(); pen.roundRect(x, top, 6, len, 3); pen.fill();
      return Math.abs(b.y - band.y) > 0.3 || Math.abs((lantern ? 1 : 0) - glow) > 0.01;
    },
  });
  if (surface) panel.dataset.gpu = '';

  const sync = () => {
    const all = rows();
    sel = all.length ? Math.min(Math.max(0, sel), all.length - 1) : 0;
    if (!state.current.manage) return;
    all.forEach((row, i) => row.setAttribute('aria-selected', String(i === sel)));
    const field = input(), id = all[sel]?.id;
    if (field && id) field.setAttribute('aria-activedescendant', id);
  };
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
    isOpen = true; busy = false; band = null; sel = 0;
    panel.removeAttribute('hidden');
    panel.dataset.open = '';
    state.current.trigger?.setAttribute('aria-expanded', 'true');
    sync();
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
    if (to !== null) { event.preventDefault(); lantern = false; select(to); return; }
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
    lantern = true;
    if (i !== sel) select(i); else surface?.kick();
  };
  const onLeave = () => { lantern = false; surface?.kick(); };
  const onClick = (event: Event) => { if (!state.current.manage) return; const i = rowOf(event); if (i >= 0) run(i); };
  const onInput = () => { if (state.current.manage) { lantern = false; band = null; select(0); } };
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
  panel.addEventListener('pointerleave', onLeave);
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
    hideContent(false);
    panel.removeEventListener('keydown', onKey);
    panel.removeEventListener('pointermove', onMove);
    panel.removeEventListener('pointerleave', onLeave);
    panel.removeEventListener('click', onClick);
    panel.removeEventListener('input', onInput);
    trigger?.removeEventListener('click', onTrigger);
    document.removeEventListener('keydown', onHotkey);
    document.removeEventListener('pointerdown', onOutside);
    delete panel.dataset.gpu; delete panel.dataset.state;
  });
}

export const COMMAND_PALETTE_DEFAULTS = DEFAULTS;
