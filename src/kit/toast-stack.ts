import type { GlyphFieldOptions } from '../field';
import { clamp, handle, hash, house, mountSurface, srOnly, styleKeeper, type KitHandle, type KitOptions, type Surface } from './core';
import { blocksOf, drawBlocks, injectStyle, snapshot, type Block } from './capture';

export interface Toast {
  title: string;
  body?: string;
  /** A node (such as an inline SVG) or a short text shown in the icon tile. */
  icon?: Node | string;
  /** A button beside the text, such as Undo. Clicking it dismisses the toast too. */
  action?: { label: string; onClick: () => void };
  /** Ms before it leaves on its own; 0 keeps it until dismissed. Default: the stack's `duration`. */
  duration?: number;
}

export interface ToastStackOptions extends KitOptions {
  /** Toasts kept at once; the oldest dissolves when another arrives. Default 3. */
  max?: number;
  /** Ms a toast stays, unless pointed at or focused. 0 keeps every toast until dismissed. Default 6000. */
  duration?: number;
  /** Your own markup for a toast. Mark parts with `data-paint` (`strong`, `text`, `meta`, `tile`, `icon`, `none`) to set how they gather. */
  render?: (toast: Toast, id: number) => HTMLElement;
  /** Accessible name of the list. Default `Notifications`. */
  label?: string;
}

export interface ToastStackHandle extends KitHandle<ToastStackOptions> {
  /** Adds a toast at the front, gathering out of scattered characters. Returns its id. */
  push(toast: Toast): number;
  /** Takes a toast out: it breaks into characters that drift up and away while the stack closes up. */
  dismiss(id: number): void;
  /** Dismisses every toast. */
  clear(): void;
  /** Ids of the toasts shown, oldest first. */
  readonly toasts: number[];
}

const DEFAULTS = { max: 3, duration: 6000, label: 'Notifications' };
const FORM_MS = 340, DISSOLVE_MS = 440, HOLD_MS = 150;
const EASE = 'cubic-bezier(.16, 1, .3, 1)';
const CSS = `
:where(.ascii-toasts){position:relative;margin:0;padding:0;list-style:none;min-height:52px}
:where(.ascii-toast){position:absolute;left:0;right:0;bottom:0;box-sizing:border-box;display:flex;align-items:center;gap:10px;min-height:52px;padding:8px 8px 8px 10px;border-radius:13px;background:var(--ascii-toast-bg,Canvas);color:var(--ascii-toast-ink,CanvasText);box-shadow:0 0 0 1px rgb(128 128 128 / .22),0 8px 24px rgb(0 0 0 / .12);z-index:calc(10 - var(--d,0));transform-origin:50% 0;translate:0 calc(var(--d,0) * -10px);scale:calc(1 - var(--d,0) * .05);transition:translate 280ms ${EASE},scale 280ms ${EASE},opacity 160ms ${EASE}}
:where(.ascii-toast) > *{transition:opacity 160ms ${EASE}}
:where(.ascii-toast[data-back]) > *{opacity:0}
:where(.ascii-toasts:not([data-open])) :where(.ascii-toast[data-back]) > *{pointer-events:none}
:where(.ascii-toasts[data-open]) :where(.ascii-toast){translate:0 calc(var(--d,0) * (-100% - 8px));scale:1}
:where(.ascii-toasts[data-open]) :where(.ascii-toast[data-back]) > *{opacity:1}
:where(.ascii-toast[data-forming]){animation:ascii-toast-in 200ms ${EASE} both}
:where(.ascii-toast[data-forming],.ascii-toast[data-gone]) > *{opacity:0;transition:none}
:where(.ascii-toast[data-gone]){opacity:0;pointer-events:none}
@keyframes ascii-toast-in{from{opacity:0}}
:where(.ascii-toast-icon){display:grid;place-items:center;flex:none;width:32px;height:32px;border-radius:8px;background:rgb(128 128 128 / .14)}
:where(.ascii-toast-text){display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}
:where(.ascii-toast-title){overflow:hidden;font-size:14px;font-weight:600;text-overflow:ellipsis;white-space:nowrap}
:where(.ascii-toast-body){overflow:hidden;font-size:13px;opacity:.68;text-overflow:ellipsis;white-space:nowrap}
:where(.ascii-toast-action,.ascii-toast-close){flex:none;border:0;background:rgb(128 128 128 / .14);color:inherit;font:inherit;cursor:pointer}
:where(.ascii-toast-action){height:32px;padding:0 12px;border-radius:999px;font-size:14px;font-weight:500}
:where(.ascii-toast-close){display:grid;place-items:center;width:28px;height:28px;border-radius:999px;background:transparent;font-size:18px;line-height:1;opacity:.6}
@media (prefers-reduced-motion:reduce){:where(.ascii-toast){transition:none}:where(.ascii-toast[data-forming]){animation:none}}
`;

interface Effect { start: number; ms: number; snap: HTMLCanvasElement; blocks: Block[]; order: Float32Array; form: boolean; node: HTMLElement }
interface Item { id: number; node: HTMLElement; timer: ReturnType<typeof setTimeout> | 0; left: number; since: number }

function defaultToast(toast: Toast, dismiss: () => void) {
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, paint?: string) => {
    const el = document.createElement(tag);
    el.className = cls;
    if (paint) el.dataset.paint = paint;
    return el;
  };
  const li = make('li', 'ascii-toast');
  if (toast.icon !== undefined) {
    const icon = make('span', 'ascii-toast-icon', 'tile');
    icon.setAttribute('aria-hidden', 'true');
    if (typeof toast.icon === 'string') icon.textContent = toast.icon; else icon.appendChild(toast.icon);
    li.appendChild(icon);
  }
  const text = make('span', 'ascii-toast-text'), title = make('b', 'ascii-toast-title', 'strong');
  title.textContent = toast.title;
  text.appendChild(title);
  if (toast.body) { const body = make('span', 'ascii-toast-body', 'meta'); body.textContent = toast.body; text.appendChild(body); }
  li.appendChild(text);
  if (toast.action) {
    const { label, onClick } = toast.action, button = make('button', 'ascii-toast-action', 'text');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => { onClick(); dismiss(); });
    li.appendChild(button);
  }
  const close = make('button', 'ascii-toast-close', 'none');
  close.type = 'button';
  close.setAttribute('aria-label', `Dismiss ${toast.title}`);
  close.textContent = '×';
  close.addEventListener('click', dismiss);
  li.appendChild(close);
  return li;
}

/**
 * A stack of toasts: each one gathers out of scattered characters, the newest in front and the rest tucked behind,
 * fanning out while pointed at or focused. Dismissed toasts break into characters that drift up and away.
 */
export function toastStack(container: HTMLElement, options: ToastStackOptions = {}): ToastStackHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  const styles = styleKeeper();
  const list = document.createElement('ol');
  const live = srOnly('', false);
  live.setAttribute('role', 'status');
  let items: Item[] = [], effects: Effect[] = [], seq = 0, held = false, hover = false, focused = false, destroyed = false;
  let surface: Surface | null = null;
  const holds: ReturnType<typeof setTimeout>[] = [];
  const look = (): GlyphFieldOptions => ({
    mark: 'glyph', charset: ' .:-=+*#%@', font: '"Geist Mono", ui-monospace, monospace', fontWeight: 500,
    cellSize: 5, cellAspect: 0.62, glyphScale: 0.92, ...state.current.look,
  });

  injectStyle('ascii-kit-toast', CSS);
  list.className = 'ascii-toasts';
  list.setAttribute('aria-label', state.current.label);
  container.append(list, live);

  surface = mountSurface({
    host: container,
    look,
    outset: 24,
    resolution: 2,
    ink: () => state.current.ink ?? '--ascii-ink-strong',
    reducedMotion: () => state.current.reducedMotion,
    onFail: () => { surface = null; effects = []; for (const item of items) { delete item.node.dataset.forming; } },
    paint: ({ pen, now, scale }) => {
      pen.setTransform(scale, 0, 0, scale, 0, 0);
      effects = effects.filter(fx => {
        const t = (now - fx.start) / fx.ms;
        if (fx.form && t >= 0.62) delete fx.node.dataset.forming;
        if (t >= 1) return false;
        if (fx.form) {
          drawBlocks(pen, fx.snap, fx.blocks, fx.order, house(t) * 1.04, (b, away) => [(b.seed - 0.5) * 70 * away, (14 + hash(b.x, b.y) * 26) * away], 1 - clamp((t - 0.62) / 0.28));
        } else {
          drawBlocks(pen, fx.snap, fx.blocks, fx.order, 1 - (1 - (1 - t) ** 3) * 1.04, (b, away) => [(14 + b.seed * 34) * away, (hash(b.y, b.x) - 0.35) * 14 * away], 1 - clamp((t - 0.75) / 0.25));
        }
        return true;
      });
      return effects.length > 0;
    },
  });

  const motion = () => !!surface && !surface.still();
  const relayout = () => {
    items.forEach((item, i) => {
      const depth = items.length - 1 - i;
      styles.set(item.node, '--d', String(depth));
      if (depth === 0) { item.node.dataset.front = ''; delete item.node.dataset.back; }
      else { item.node.dataset.back = ''; delete item.node.dataset.front; }
    });
  };
  const effect = (node: HTMLElement, form: boolean) => {
    if (!surface) return;
    const w = surface.canvas.clientWidth || container.clientWidth + 48, h = surface.canvas.clientHeight || container.clientHeight + 48;
    const snap = snapshot(node, w, h, surface.box), blocks = blocksOf(snap.rects), right = Math.max(1, ...blocks.map(b => b.x));
    const order = Float32Array.from(blocks, b => (form ? 0.3 : 0.62) * (b.x / right) + (form ? 0.7 : 0.38) * b.seed);
    effects.push({ start: performance.now(), ms: form ? FORM_MS : DISSOLVE_MS, snap: snap.canvas, blocks, order, form, node });
    surface.kick();
  };

  const schedule = (item: Item) => {
    if (item.timer) clearTimeout(item.timer);
    item.timer = 0;
    if (held || item.left <= 0) return;
    item.since = performance.now();
    item.timer = setTimeout(() => dismiss(item.id), item.left);
  };
  const hold = (on: boolean) => {
    if (on === held) return;
    held = on;
    if (on) list.dataset.open = ''; else delete list.dataset.open;
    for (const item of items) {
      if (on && item.timer) { clearTimeout(item.timer); item.timer = 0; item.left = Math.max(400, item.left - (performance.now() - item.since)); }
      if (!on) schedule(item);
    }
  };
  const sync = () => hold(hover || focused);
  const onEnter = () => { hover = true; sync(); };
  const onLeave = () => { hover = false; sync(); };
  const onFocusIn = () => { focused = true; sync(); };
  const onFocusOut = (event: FocusEvent) => { if (!list.contains(event.relatedTarget as Node | null)) { focused = false; sync(); } };
  list.addEventListener('pointerenter', onEnter);
  list.addEventListener('pointerleave', onLeave);
  list.addEventListener('focusin', onFocusIn);
  list.addEventListener('focusout', onFocusOut);

  function dismiss(id: number) {
    const item = items.find(entry => entry.id === id);
    if (!item || item.node.dataset.gone !== undefined) return;
    if (item.timer) clearTimeout(item.timer);
    const take = () => {
      items = items.filter(entry => entry !== item);
      effects = effects.filter(fx => fx.node !== item.node);
      item.node.remove();
      relayout();
      if (!items.length) { hover = focused = false; sync(); }
    };
    const front = items[items.length - 1] === item;
    if (motion() && (front || held)) {
      delete item.node.dataset.forming;
      effect(item.node, false);
      item.node.dataset.gone = '';
      // Its place is held a beat, so the characters drift clear before the stack closes up.
      holds.push(setTimeout(take, HOLD_MS));
    } else take();
  }

  const push = (toast: Toast) => {
    if (destroyed) return -1;
    const id = ++seq;
    const shown = items.filter(item => item.node.dataset.gone === undefined);
    const over = shown.length + 1 - Math.max(1, state.current.max);
    if (over > 0) shown.slice(0, over).forEach(old => dismiss(old.id));
    const node = state.current.render ? state.current.render(toast, id) : defaultToast(toast, () => dismiss(id));
    node.dataset.toast = String(id);
    const item: Item = { id, node, timer: 0, left: toast.duration ?? state.current.duration, since: 0 };
    items.push(item);
    list.appendChild(node);
    relayout();
    live.textContent = toast.body ? `${toast.title}. ${toast.body}` : toast.title;
    if (motion()) { node.dataset.forming = ''; effect(node, true); }
    schedule(item);
    return id;
  };

  return handle(() => surface, state, next => { list.setAttribute('aria-label', next.label); surface?.refresh(); }, {
    push,
    dismiss,
    clear() { [...items].forEach(item => dismiss(item.id)); },
    get toasts() { return items.filter(item => item.node.dataset.gone === undefined).map(item => item.id); },
  }, () => {
    destroyed = true;
    for (const item of items) if (item.timer) clearTimeout(item.timer);
    holds.forEach(clearTimeout);
    list.removeEventListener('pointerenter', onEnter);
    list.removeEventListener('pointerleave', onLeave);
    list.removeEventListener('focusin', onFocusIn);
    list.removeEventListener('focusout', onFocusOut);
    items = []; effects = [];
    list.remove(); live.remove();
    styles.restore();
  });
}

export const TOAST_DEFAULTS = DEFAULTS;
