import type { GlyphFieldOptions } from '../field';
import { clamp, handle, mountSurface, prefersReduced, smoothstep, styleKeeper, type KitHandle, type KitOptions, type Surface } from './core';
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
  /** Ms a panel takes to settle open; the panels move on one critically damped spring, so a change mid-move carries its speed. Default 420. */
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
:where(.ascii-acc-panel){position:relative;flex:calc(1 + 3.2 * var(--ascii-acc-open, 0)) 1 0;min-width:0;margin:0;padding:0;border:0;border-radius:12px;overflow:hidden;background:transparent;color:#fff;font:inherit;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent}
:where(.ascii-acc-panel[aria-expanded="true"]){cursor:default}
:where(.ascii-acc-photo){position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:var(--ascii-acc-photo, 0);scale:calc(1.04 - .04 * var(--ascii-acc-open, 0))}
:where(.ascii-acc-caption){position:absolute;inset:auto 0 0;display:flex;color:#fff;flex-direction:column;gap:2px;padding:28px 12px 11px;background:linear-gradient(to top, rgb(0 0 0 / .62), transparent);white-space:nowrap;opacity:var(--ascii-acc-caption, 0);translate:0 calc(6px - 6px * var(--ascii-acc-caption, 0))}
:where(.ascii-acc-title){font-size:15px;font-weight:500}
:where(.ascii-acc-meta){font-size:14px;opacity:.8}
`;

/** Ms a fast-moving pointer must rest on a panel before it opens, so sweeping across the strip does not open every panel on the way. */
const INTENT_MS = 90, SLOW = 0.3;

const normal = (image: string | AccordionImage): AccordionImage => (typeof image === 'string' ? { src: image } : image);

/**
 * A strip of image panels: the open one shows its photo, the closed ones the same photos in characters. Pointing at,
 * pressing or focusing a panel opens it. Width, photo and caption all follow one spring per panel, so the characters and the photo
 * cross over without a gap and a change of mind mid-move carries on smoothly.
 */
export function accordion(element: HTMLElement, options: AccordionOptions): AccordionHandle {
  const state = { current: { open: 0, duration: 420, label: 'Images', ...options } };
  const styles = styleKeeper();
  const images = state.current.images.map(normal);
  let open = clamp(Math.round(state.current.open), 0, Math.max(0, images.length - 1)), last = 0, loop = 0;
  const springs = images.map((_, i) => ({ x: i === open ? 1 : 0, v: 0 }));
  const pics: (Picture | null)[] = images.map(() => null), tones: (Picture | null)[] = images.map(() => null);
  let surface: Surface | null = null;
  const look = (): GlyphFieldOptions => ({ blend: 'coarse',
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
    kit: state,
    reducedMotion: () => state.current.reducedMotion,
    onFail: () => { surface = null; delete element.dataset.asciiField; },
    onTheme: retone,
    paint: ({ pen, still, now, box }) => {
      const moving = step(now, still);
      panels.forEach((panel, i) => {
        const tone = tones[i], k = springs[i].x, alpha = 1 - smoothstep(0.45, 0.95, k);
        if (!tone || alpha <= 0) return;
        const r = box(panel), radius = parseFloat(getComputedStyle(panel).borderTopLeftRadius) || 0, grow = 1.04 - 0.04 * k;
        pen.save();
        pen.beginPath(); pen.roundRect(r.x, r.y, r.w, r.h, radius); pen.clip();
        pen.globalAlpha = alpha;
        // Scaled like the photo, so characters and photo line up while they cross.
        drawCover(pen, tone, r.x - (r.w * (grow - 1)) / 2, r.y - (r.h * (grow - 1)) / 2, r.w * grow, r.h * grow, images[i].focus?.x, images[i].focus?.y);
        pen.restore();
      });
      return moving;
    },
  });

  /** Advances the springs and writes them to the panels; the field paints in the same frame, so its characters never lag the layout. */
  function step(now: number, still: boolean) {
    const dt = last ? Math.min(0.064, (now - last) / 1000) : 1 / 60;
    last = now;
    const w = 5 / (Math.max(1, state.current.duration) / 1000), n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
    let moving = false;
    springs.forEach((s, i) => {
      const to = i === open ? 1 : 0;
      if (still) { s.x = to; s.v = 0; }
      for (let j = 0; j < n && (s.x !== to || s.v); j++) { s.v += (-w * w * (s.x - to) - 2 * w * s.v) * h; s.x += s.v * h; }
      if (Math.abs(s.x - to) < 0.001 && Math.abs(s.v) < 0.01) { s.x = to; s.v = 0; } else moving = true;
      write(panels[i], s.x);
    });
    if (!moving) last = 0;
    return moving;
  }
  function write(panel: HTMLElement, k: number) {
    const css = panel.style;
    css.setProperty('--ascii-acc-open', k.toFixed(4));
    css.setProperty('--ascii-acc-photo', (surface ? smoothstep(0.15, 0.75, k) : 0.45 + 0.55 * k).toFixed(3));
    css.setProperty('--ascii-acc-caption', smoothstep(0.6, 1, k).toFixed(3));
  }
  /** Without the field nothing paints, so the springs run on a loop of their own. */
  const run = () => {
    if (surface) { surface.kick(); return; }
    if (loop || typeof requestAnimationFrame !== 'function') { if (!loop) step(performance.now(), true); return; }
    const frame = (now: number) => { loop = step(now, !!(state.current.reducedMotion ?? prefersReduced())) ? requestAnimationFrame(frame) : 0; };
    loop = requestAnimationFrame(frame);
  };

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
    sync();
    state.current.onChange?.(index);
    run();
  };
  let intent: ReturnType<typeof setTimeout> | 0 = 0, px = 0, pt = 0, speed = 0, aim = 0;
  const wait = () => { if (intent) clearTimeout(intent); intent = 0; };
  const listeners = panels.map((panel, i) => {
    // A mouse that rests or moves slowly opens the panel at once; one sweeping past waits a beat to see whether it stays.
    const hover = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      const t = event.timeStamp || performance.now(), gap = Math.max(1, t - pt);
      speed = pt && gap < 100 ? speed * 0.5 + (Math.abs(event.clientX - px) / gap) * 0.5 : 0;
      px = event.clientX; pt = t;
      if (aim !== i) wait();
      aim = i;
      if (i === open) { wait(); return; }
      if (speed < SLOW) { wait(); select(i); return; }
      if (!intent) intent = setTimeout(() => { intent = 0; select(aim); }, INTENT_MS);
    };
    const press = () => { wait(); select(i); };
    const focus = () => { if (panel.matches(':focus-visible')) select(i); };
    const keys = (event: KeyboardEvent) => {
      const by = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[event.key];
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? panels.length - 1 : by !== undefined ? (i + by + panels.length) % panels.length : null;
      if (next === null) return;
      event.preventDefault();
      select(next, true);
    };
    panel.addEventListener('pointermove', hover);
    panel.addEventListener('pointerdown', press);
    panel.addEventListener('click', press);
    panel.addEventListener('focus', focus);
    panel.addEventListener('keydown', keys);
    return () => {
      panel.removeEventListener('pointermove', hover);
      panel.removeEventListener('pointerdown', press);
      panel.removeEventListener('click', press);
      panel.removeEventListener('focus', focus);
      panel.removeEventListener('keydown', keys);
    };
  });
  const leave = () => { wait(); pt = 0; };
  element.addEventListener('pointerleave', leave);

  injectStyle('ascii-kit-accordion', CSS);
  element.dataset.asciiAccordion = '';
  if (surface) element.dataset.asciiField = '';
  const hadRole = element.getAttribute('role'), hadLabel = element.getAttribute('aria-label');
  if (!hadRole) element.setAttribute('role', 'group');
  if (!hadLabel) element.setAttribute('aria-label', state.current.label);
  panels.forEach((panel, i) => { write(panel, springs[i].x); element.appendChild(panel); });
  sync();
  panels.forEach((panel, i) => {
    const photo = panel.querySelector('img');
    if (photo) imageReady(photo).then(pic => { pics[i] = pic; tones[i] = surface ? toneOf(pic, !surface.dark()) : null; surface?.kick(); }, () => {});
  });

  return handle(() => surface, state, next => {
    if (!hadLabel) element.setAttribute('aria-label', next.label);
    surface?.refresh();
  }, {
    select,
    get open() { return open; },
  }, () => {
    listeners.forEach(off => off());
    wait();
    if (loop) cancelAnimationFrame(loop);
    element.removeEventListener('pointerleave', leave);
    panels.forEach(panel => panel.remove());
    delete element.dataset.asciiAccordion;
    delete element.dataset.asciiField;
    if (!hadRole) element.removeAttribute('role');
    if (!hadLabel) element.removeAttribute('aria-label');
    styles.restore();
  });
}
