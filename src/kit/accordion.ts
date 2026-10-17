import type { GlyphFieldOptions } from '../field';
import { clamp, easeOut, handle, mountSurface, styleKeeper, type KitHandle, type KitOptions, type Surface } from './core';
import { drawCover, imageFor, imageReady, injectStyle, toneOf, type Picture } from './capture';

export interface AccordionImage {
  src: string;
  /** Read with the title as the panel's accessible name. */
  alt?: string;
  title?: string;
  meta?: string;
  /** Crop focus, 0–1 on each axis. Default the centre. */
  focus?: { x: number; y: number };
}

export interface AccordionOptions extends KitOptions {
  images: (string | AccordionImage)[];
  /** The panel open at first. Default 0. */
  open?: number;
  /** Ms a panel takes to open. Default 280. */
  duration?: number;
  /** Accessible name of the group. Default `Images`. */
  label?: string;
  onChange?: (index: number) => void;
}

export interface AccordionHandle extends KitHandle<AccordionOptions> {
  /** Opens a panel; `focus` moves focus to it too. */
  select(index: number, focus?: boolean): void;
  readonly open: number;
}

const CSS = `
:where([data-ascii-accordion]){display:flex;gap:6px}
:where(.ascii-acc-panel){position:relative;flex:1 1 0;min-width:0;margin:0;padding:0;border:0;border-radius:12px;overflow:hidden;background:transparent;color:#fff;font:inherit;text-align:left;cursor:pointer;transition:flex-grow var(--ascii-acc-ms, 280ms) cubic-bezier(.16, 1, .3, 1)}
:where(.ascii-acc-panel[aria-expanded="true"]){flex-grow:4.2;cursor:default}
:where(.ascii-acc-photo){position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;scale:1.04;transition:opacity 160ms cubic-bezier(.16, 1, .3, 1),scale var(--ascii-acc-ms, 280ms) cubic-bezier(.16, 1, .3, 1)}
:where([data-ascii-accordion]:not([data-ascii-field])) :where(.ascii-acc-photo){opacity:.45}
:where(.ascii-acc-panel[aria-expanded="true"]) :where(.ascii-acc-photo){opacity:1;scale:1;transition:opacity 240ms cubic-bezier(.16, 1, .3, 1) 40ms,scale var(--ascii-acc-ms, 280ms) cubic-bezier(.16, 1, .3, 1)}
:where(.ascii-acc-caption){position:absolute;inset:auto 0 0;display:flex;color:#fff;flex-direction:column;gap:2px;padding:28px 12px 11px;background:linear-gradient(to top, rgb(0 0 0 / .62), transparent);white-space:nowrap;opacity:0;translate:0 6px;transition:opacity 120ms,translate 200ms}
:where(.ascii-acc-panel[aria-expanded="true"]) :where(.ascii-acc-caption){opacity:1;translate:0 0;transition-delay:160ms}
:where(.ascii-acc-title){font-size:15px;font-weight:500}
:where(.ascii-acc-meta){font-size:14px;opacity:.8}
@media (prefers-reduced-motion:reduce){:where(.ascii-acc-panel,.ascii-acc-photo,.ascii-acc-caption){transition:none}}
`;

const normal = (image: string | AccordionImage): AccordionImage => (typeof image === 'string' ? { src: image } : image);

/**
 * A strip of image panels: the open one shows its photo, the closed ones the same photos in characters. Pointing at,
 * pressing or focusing a panel opens it, and as it opens its characters flare denser for a beat, then give way to the photo.
 */
export function accordion(element: HTMLElement, options: AccordionOptions): AccordionHandle {
  const state = { current: { open: 0, duration: 280, label: 'Images', ...options } };
  const styles = styleKeeper();
  const images = state.current.images.map(normal);
  let open = clamp(Math.round(state.current.open), 0, Math.max(0, images.length - 1)), last = 0, changed = performance.now();
  let vis = images.map((_, i): number => (i === open ? 1 : 0));
  const pics: (Picture | null)[] = images.map(() => null), tones: (Picture | null)[] = images.map(() => null);
  let surface: Surface | null = null;
  const look = (): GlyphFieldOptions => ({
    mark: 'glyph', charset: ' .:-=+*#%@', font: '"Geist Mono", ui-monospace, monospace', fontWeight: 500,
    cellSize: 6, cellAspect: 0.62, glyphScale: 0.94, hover: 'trail', trail: { strength: 0.5, radius: 0.25 }, ...state.current.look,
  });
  const retone = () => { pics.forEach((pic, i) => { tones[i] = pic && surface ? toneOf(pic, !surface.dark()) : null; }); surface?.kick(); };

  const panels = images.map(image => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ascii-acc-panel';
    button.setAttribute('aria-label', [image.title ?? image.alt, image.meta].filter(Boolean).join(', ') || image.src);
    const photo = imageFor(image.src);
    photo.className = 'ascii-acc-photo';
    photo.alt = '';
    photo.draggable = false;
    if (image.focus) photo.style.setProperty('object-position', `${image.focus.x * 100}% ${image.focus.y * 100}%`);
    button.appendChild(photo);
    if (image.title || image.meta) {
      const caption = document.createElement('span');
      caption.className = 'ascii-acc-caption';
      caption.setAttribute('aria-hidden', 'true');
      for (const [cls, text] of [['ascii-acc-title', image.title], ['ascii-acc-meta', image.meta]]) {
        if (!text) continue;
        const span = document.createElement('span');
        span.className = cls!;
        span.textContent = text;
        caption.appendChild(span);
      }
      button.appendChild(caption);
    }
    return button;
  });

  surface = mountSurface({
    host: element,
    layer: 'under',
    look,
    ink: () => state.current.ink ?? '--ascii-ink-strong',
    reducedMotion: () => state.current.reducedMotion,
    onFail: () => { surface = null; delete element.dataset.asciiField; },
    onTheme: retone,
    paint: ({ pen, now, still, box }) => {
      const dt = last ? Math.min(64, now - last) : 16;
      last = now;
      let moving = false;
      vis = vis.map((v, i) => {
        const to = i === open ? 1 : 0, next = still ? to : v + Math.sign(to - v) * Math.min(Math.abs(to - v), dt / Math.max(1, state.current.duration));
        if (next !== to) moving = true;
        return next;
      });
      panels.forEach((panel, i) => {
        const tone = tones[i], v = easeOut(vis[i]);
        if (!tone || v >= 1) return;
        const r = box(panel), radius = parseFloat(getComputedStyle(panel).borderTopLeftRadius) || 0;
        pen.save();
        pen.beginPath(); pen.roundRect(r.x, r.y, r.w, r.h, radius); pen.clip();
        pen.globalAlpha = 1 - v;
        drawCover(pen, tone, r.x, r.y, r.w, r.h, images[i].focus?.x, images[i].focus?.y);
        const flare = Math.sin(Math.PI * clamp(v * 1.4)) * 0.4;
        if (flare > 0.01) { pen.globalCompositeOperation = 'lighter'; pen.globalAlpha = flare; pen.fillStyle = '#fff'; pen.fillRect(r.x, r.y, r.w, r.h); }
        pen.restore();
      });
      // Panels resize with a CSS transition, so keep drawing until it has run.
      if (now - changed < state.current.duration + 60) moving = true;
      if (!moving) last = 0;
      return moving;
    },
  });

  const sync = () => {
    panels.forEach((panel, i) => {
      panel.setAttribute('aria-expanded', String(i === open));
      panel.tabIndex = i === open ? 0 : -1;
    });
  };
  const select = (index: number, focus = false) => {
    index = clamp(Math.round(index), 0, panels.length - 1);
    if (focus) panels[index]?.focus();
    if (index === open) return;
    open = index;
    changed = performance.now();
    sync();
    state.current.onChange?.(index);
    surface?.kick();
  };
  const listeners = panels.map((panel, i) => {
    const show = () => select(i);
    const focus = () => { if (panel.matches(':focus-visible')) select(i); };
    const keys = (event: KeyboardEvent) => {
      const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[event.key];
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? panels.length - 1 : step !== undefined ? (i + step + panels.length) % panels.length : null;
      if (next === null) return;
      event.preventDefault();
      select(next, true);
    };
    panel.addEventListener('pointermove', show);
    panel.addEventListener('pointerdown', show);
    panel.addEventListener('click', show);
    panel.addEventListener('focus', focus);
    panel.addEventListener('keydown', keys);
    return () => {
      panel.removeEventListener('pointermove', show);
      panel.removeEventListener('pointerdown', show);
      panel.removeEventListener('click', show);
      panel.removeEventListener('focus', focus);
      panel.removeEventListener('keydown', keys);
    };
  });

  injectStyle('ascii-kit-accordion', CSS);
  element.dataset.asciiAccordion = '';
  if (surface) element.dataset.asciiField = '';
  const hadRole = element.getAttribute('role'), hadLabel = element.getAttribute('aria-label');
  if (!hadRole) element.setAttribute('role', 'group');
  if (!hadLabel) element.setAttribute('aria-label', state.current.label);
  styles.set(element, '--ascii-acc-ms', `${state.current.duration}ms`);
  panels.forEach(panel => element.appendChild(panel));
  sync();
  panels.forEach((panel, i) => {
    const photo = panel.querySelector('img');
    if (photo) imageReady(photo).then(pic => { pics[i] = pic; tones[i] = surface ? toneOf(pic, !surface.dark()) : null; surface?.kick(); }, () => {});
  });

  return handle(() => surface, state, next => {
    styles.set(element, '--ascii-acc-ms', `${next.duration}ms`);
    if (!hadLabel) element.setAttribute('aria-label', next.label);
    surface?.refresh();
  }, {
    select,
    get open() { return open; },
  }, () => {
    listeners.forEach(off => off());
    panels.forEach(panel => panel.remove());
    delete element.dataset.asciiAccordion;
    delete element.dataset.asciiField;
    if (!hadRole) element.removeAttribute('role');
    if (!hadLabel) element.removeAttribute('aria-label');
    styles.restore();
  });
}
