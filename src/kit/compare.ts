import type { GlyphFieldOptions } from '../field';
import { clamp, handle, house, mountSurface, styleKeeper, type KitHandle, type KitOptions, type Surface } from './core';
import { drawCover, imageFor, imageReady, injectStyle, type Picture } from './capture';

export interface CompareOptions extends KitOptions {
  /** The photo: a URL, or an `<img>` (one inside the element is used in place). */
  image: string | HTMLImageElement;
  /** Share of the frame showing the photo, from the left, 0–100. Default 50. */
  position?: number;
  /** The handle's accessible name. Default `Photo and ASCII split`, or your own handle's `aria-label`. */
  label?: string;
  /** Called as the split moves. */
  onChange?: (position: number) => void;
}

export interface CompareHandle extends KitHandle<CompareOptions> {
  /** Moves the split; `glide` eases it there. */
  set(position: number, glide?: boolean): void;
  readonly position: number;
}

const GLIDE_MS = 280;
const CSS = `
:where(.ascii-compare-photo){position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none;clip-path:inset(0 calc(100% - var(--ascii-pos, 50%)) 0 0)}
:where(.ascii-compare-line){position:absolute;top:0;bottom:0;left:var(--ascii-pos, 50%);width:2px;translate:-50% 0;background:#fff;box-shadow:0 0 0 .5px rgb(0 0 0 / .25),0 0 12px rgb(0 0 0 / .45);pointer-events:none}
:where(.ascii-compare-handle){position:absolute;top:50%;left:var(--ascii-pos, 50%);display:grid;place-items:center;width:40px;height:40px;translate:-50% -50%;border-radius:50%;background:#fff;color:#111;box-shadow:0 0 0 1px rgb(0 0 0 / .08),0 4px 14px rgb(0 0 0 / .4);cursor:grab;touch-action:none}
:where(.ascii-compare-handle:focus-visible){outline:2px solid #fff;outline-offset:3px}
`;
const ARROWS = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 7-5 5 5 5M15 7l5 5-5 5"/></svg>';

/**
 * A before and after slider: the photo on the left of the split and the same photo in characters, in its own colours,
 * on the right. Drag anywhere, or use the arrow keys, Page Up and Down, Home and End on the handle.
 */
export function compare(element: HTMLElement, options: CompareOptions): CompareHandle {
  const state = { current: { position: 50, ...options } };
  const styles = styleKeeper();
  let position = clamp(state.current.position, 0, 100), pic: Picture | null = null, surface: Surface | null = null;
  let glide = { from: position, to: position, at: -1e9 }, raf = 0, dragging = false;
  const added: Element[] = [];
  let optionPosition = state.current.position;
  const look = (): GlyphFieldOptions => ({ blend: 'coarse',
    mark: 'glyph', charset: ' .:-=+*#%@', font: '"Geist", Arial, sans-serif', fontWeight: 600, cellSize: 6, cellAspect: 0.8, glyphScale: 0.96,
    color: 'source', levels: 'auto', saturation: 1.3, contrast: 1.45, gamma: 0.85, brightness: 0.14, hover: 'trail', trail: { strength: 0.7, radius: 0.3 }, ...state.current.look,
  });

  surface = mountSurface({
    host: element,
    layer: 'under',
    look,
    ink: () => state.current.ink ?? '--ascii-ink-strong',
    kit: state,
    reducedMotion: () => state.current.reducedMotion,
    // Two source pixels per CSS pixel (up to 1600 wide), downscaled smoothly, so fine detail survives into the cells as it does from the photo itself.
    resolution: (w, h) => { const W = Math.min(1600, Math.max(2, Math.round(w * 2))); return [W, Math.max(2, Math.round((W * h) / Math.max(1, w)))]; },
    onFail: () => { surface = null; },
    paint: ({ pen, width, height }) => {
      pen.imageSmoothingQuality = 'high';
      if (pic) drawCover(pen, pic, 0, 0, width, height);
      return false;
    },
  });

  const photo = typeof state.current.image === 'string' ? imageFor(state.current.image) : state.current.image;
  // Your own handle (any `[role="slider"]`) and divider (`[data-compare-line]`) inside the frame are used in place.
  const ownHandle = element.querySelector<HTMLElement>('[role="slider"]'), ownLine = element.querySelector<HTMLElement>('[data-compare-line]');
  const handleEl = ownHandle ?? document.createElement('div');
  const line = ownLine ?? document.createElement('span');
  /** Your own handle keeps its name unless `label` is given. */
  const nameHandle = (label?: string) => { if (label !== undefined || !handleEl.hasAttribute('aria-label')) handleEl.setAttribute('aria-label', label ?? 'Photo and ASCII split'); };
  const apply = () => {
    const value = Math.round(position);
    styles.set(element, '--ascii-pos', `${position}%`);
    handleEl.setAttribute('aria-valuenow', String(value));
    handleEl.setAttribute('aria-valuetext', `${value}% photo, ${100 - value}% ASCII`);
  };
  const set = (next: number, ease = false) => {
    next = clamp(next, 0, 100);
    if (!surface) { position = next; return; }
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (!ease || surface.still() || Math.abs(next - position) < 0.5) {
      position = next; apply(); state.current.onChange?.(position);
      return;
    }
    glide = { from: position, to: next, at: performance.now() };
    const step = (now: number) => {
      const t = clamp((now - glide.at) / GLIDE_MS);
      position = glide.from + (glide.to - glide.from) * house(t);
      apply();
      state.current.onChange?.(position);
      raf = t < 1 ? requestAnimationFrame(step) : 0;
    };
    raf = requestAnimationFrame(step);
  };

  const at = (clientX: number) => {
    const box = element.getBoundingClientRect();
    return box.width ? ((clientX - box.left) / box.width) * 100 : position;
  };
  const down = (event: PointerEvent) => {
    if (event.button !== 0) return;
    (element as HTMLElement & { setPointerCapture?: (id: number) => void }).setPointerCapture?.(event.pointerId);
    dragging = true;
    element.dataset.dragging = '';
    const next = at(event.clientX);
    set(next, Math.abs(next - position) > 3);
    handleEl.focus({ preventScroll: true });
  };
  const moveTo = (event: PointerEvent) => { if (dragging) set(at(event.clientX)); };
  const up = () => { dragging = false; delete element.dataset.dragging; };
  const keys = (event: KeyboardEvent) => {
    const step = ({ ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, PageDown: -20, PageUp: 20 } as Record<string, number>)[event.key];
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 100 : step !== undefined ? Math.round(position / 5) * 5 + step : null;
    if (next === null) return;
    event.preventDefault();
    set(next, true);
  };

  let restorePhoto = () => {};
  if (surface) {
    injectStyle('ascii-kit-compare', CSS);
    styles.set(element, 'overflow', 'hidden');
    styles.set(element, 'touch-action', 'pan-y');
    styles.set(element, 'user-select', 'none');
    styles.set(element, 'cursor', 'ew-resize');
    const own = { className: photo.className, hidden: photo.getAttribute('aria-hidden') };
    restorePhoto = () => {
      photo.className = own.className;
      if (own.hidden === null) photo.removeAttribute('aria-hidden'); else photo.setAttribute('aria-hidden', own.hidden);
    };
    photo.className = `${own.className ? `${own.className} ` : ''}ascii-compare-photo`;
    photo.setAttribute('aria-hidden', 'true');
    photo.draggable = false;
    if (!ownLine) { line.className = 'ascii-compare-line'; line.setAttribute('aria-hidden', 'true'); }
    if (!ownHandle) {
      handleEl.className = 'ascii-compare-handle';
      handleEl.innerHTML = ARROWS;
      handleEl.setAttribute('role', 'slider');
      handleEl.tabIndex = 0;
    }
    nameHandle(state.current.label);
    handleEl.setAttribute('aria-valuemin', '0');
    handleEl.setAttribute('aria-valuemax', '100');
    handleEl.setAttribute('aria-orientation', 'horizontal');
    for (const el of [photo, line, handleEl]) if (!element.contains(el)) { element.appendChild(el); added.push(el); }
    apply();
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', moveTo);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', up);
    handleEl.addEventListener('keydown', keys);
    imageReady(photo).then(p => { pic = p; surface?.kick(); }, () => {});
  } else if (!element.contains(photo)) {
    // Without the field there is nothing to compare against, but the frame still shows the photo it was given.
    if (getComputedStyle(element).position === 'static') styles.set(element, 'position', 'relative');
    photo.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:inherit');
    element.appendChild(photo);
    added.push(photo);
  }

  return handle(() => surface, state, next => {
    nameHandle(next.label);
    if (next.position !== optionPosition) { optionPosition = next.position; set(next.position, true); }
    surface?.refresh();
  }, {
    set,
    get position() { return position; },
  }, () => {
    if (raf) cancelAnimationFrame(raf);
    element.removeEventListener('pointerdown', down);
    element.removeEventListener('pointermove', moveTo);
    element.removeEventListener('pointerup', up);
    element.removeEventListener('pointercancel', up);
    handleEl.removeEventListener('keydown', keys);
    delete element.dataset.dragging;
    added.forEach(el => el.remove());
    restorePhoto();
    styles.restore();
  });
}
