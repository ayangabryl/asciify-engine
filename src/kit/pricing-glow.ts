import type { GlyphFieldOptions } from '../field';
import type { KitHandle, KitOptions } from './core';
import { blank, mountPageField, pageHandle, pulseAt, sleep, type PageField } from './page-field';

export interface PricingGlowOptions extends KitOptions {
  /** A saving, such as `−25%`, set large in dots in the open space above the price. Default none. */
  saving?: string | null;
  /** The price element the open space ends at. Default the card's `[data-price]`. */
  price?: Element | string;
  /** The face the saving is set in. Default `600 … "Geist", Arial, sans-serif`. */
  font?: string;
}

export interface PricingGlowHandle extends KitHandle<PricingGlowOptions> {
  /** A lit band crosses the card once, the halftone redrawn behind it. */
  sweep(): Promise<void>;
  /** Shows a saving (or none) in dots: the band sweeps the old art out and the new one in. */
  saving(text: string | null): Promise<void>;
  /** Sends a ring through the halftone from an element, such as the plan's button. Default strength 1.6. */
  pulse(from?: Element | { x: number; y: number }, strength?: number): void;
}

const SCALE = 2, STEPS = 9, FRAME = 48;
const DEFAULTS = { saving: null as string | null, font: '"Geist", Arial, sans-serif' };

/** The open space between the card's copy and its price, in CSS px from the card's top; layout px, so a transform doesn't skew it. */
export function savingRoom(card: HTMLElement, price: Element | null) {
  const box = card.getBoundingClientRect(), k = box.height ? card.offsetHeight / box.height : 1;
  const below = price?.getBoundingClientRect().top ?? box.top + box.height;
  let child: Element | null = price;
  while (child && child.parentElement !== card) child = child.parentElement;
  let above = box.top;
  for (const el of Array.from(card.children)) {
    if (el === child) break;
    if ((el as HTMLElement).dataset?.asciiKit !== undefined) continue;
    const r = el.getBoundingClientRect();
    if (r.height) above = Math.max(above, r.top + r.height);
  }
  return { middle: ((above + below) / 2 - box.top) * k, height: (below - above) * k };
}

/** The card's halftone source: a soft light from the top corner, and the saving set in the open space above the price. */
export function planArt(card: HTMLElement, saving: string | null, price: Element | null, font = DEFAULTS.font) {
  const w = Math.max(2, Math.round(card.offsetWidth * SCALE)), h = Math.max(2, Math.round(card.offsetHeight * SCALE));
  const { canvas, pen } = blank(w, h);
  const light = pen.createRadialGradient(w, 0, 0, w, 0, Math.hypot(w, h) * 0.52);
  light.addColorStop(0, 'rgb(150 150 150)'); light.addColorStop(0.4, 'rgb(64 64 64)'); light.addColorStop(1, 'rgb(0 0 0)');
  pen.fillStyle = light; pen.fillRect(0, 0, w, h);
  const room = saving ? savingRoom(card, price) : null;
  if (saving && room && room.height >= 30) {
    const size = Math.min(room.height * SCALE * 0.9, w * 0.34), x = w - w * 0.07, y = room.middle * SCALE + size * 0.04;
    pen.font = `600 ${size}px ${font}`;
    pen.letterSpacing = `${-size * 0.04}px`;
    pen.textAlign = 'right'; pen.textBaseline = 'middle';
    // A dark keyline keeps the numerals apart from the light behind them.
    pen.lineJoin = 'round'; pen.lineWidth = size * 0.28; pen.strokeStyle = 'rgb(0 0 0 / .85)';
    pen.strokeText(saving, x, y);
    pen.fillStyle = '#fff';
    pen.fillText(saving, x, y);
  }
  return canvas;
}

/** The recommended plan's halftone glow: light from the corner, a lantern under the pointer, and the yearly saving set in dots. */
export function pricingGlow(element: HTMLElement, options: PricingGlowOptions = {}): PricingGlowHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  const priceEl = () => {
    const p = state.current.price;
    return typeof p === 'string' ? element.querySelector(p) : p ?? element.querySelector('[data-price]');
  };
  const draw = (saving = state.current.saving) => planArt(element, saving, priceEl(), state.current.font);
  const look = (): GlyphFieldOptions => ({
    mark: 'dot', scene: 'drift', scale: typeof innerWidth === 'number' && innerWidth < 760 ? 1.7 : 1, cellSize: 4, cellAspect: 1, dotScale: 0.92,
    color: 'ink', shade: 0, fit: 'cover', focus: { x: 0.5, y: 0.5 }, levels: 'none', contrast: 1.1, brightness: -0.04, drift: 0.5,
    hover: 'lantern', lantern: { radius: 0.26, strength: 0.4, trail: 0.7, follow: 8 }, trail: { strength: 0.9, radius: 0.4 }, fluid: { radius: 0.09, refraction: 0.03, glow: 0.6 },
    ...state.current.look,
  });

  let shown: HTMLCanvasElement | null = null, run = 0, width = 0, height = 0;
  let page: PageField | null = null;
  page = mountPageField({
    host: element,
    look,
    // The dots read against the card's own ground: lighter on a dark card, darker on a light one.
    ink: dark => state.current.ink ?? (dark ? '#aeaca5' : '#5c5a55'),
    source: (shown = draw()),
    reducedMotion: () => state.current.reducedMotion,
    onFail: () => { page = null; resize?.disconnect(); },
  });
  width = element.offsetWidth; height = element.offsetHeight;
  const resize = page && typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    if (!page || (Math.abs(element.offsetWidth - width) < 2 && Math.abs(element.offsetHeight - height) < 2)) return;
    width = element.offsetWidth; height = element.offsetHeight;
    run++;
    void page.field.setSource((shown = draw()));
  }) : null;
  resize?.observe(element);

  /** A lit band crosses the card: the old halftone ahead of it, the new one behind it. */
  const cross = async (to: HTMLCanvasElement) => {
    const f = page?.field, from = shown;
    shown = to;
    if (!f) return;
    const id = ++run;
    if (!from || page!.still()) { await f.setSource(to); return; }
    const work = blank(to.width, to.height), pen = work.pen, w = to.width, h = to.height, band = w * 0.34;
    for (let i = 1; i <= STEPS && id === run; i++) {
      const t = performance.now(), x = -band + (i / STEPS) * (w + band * 2), edge = Math.max(0, Math.min(w, x));
      pen.globalCompositeOperation = 'source-over';
      pen.drawImage(from, 0, 0, w, h);
      if (edge > 0) pen.drawImage(to, 0, 0, edge, h, 0, 0, edge, h);
      const light = pen.createLinearGradient(x - band, 0, x + band * 0.4, 0);
      light.addColorStop(0, 'rgb(0 0 0 / 0)'); light.addColorStop(0.72, 'rgb(255 255 255 / .5)'); light.addColorStop(1, 'rgb(0 0 0 / 0)');
      pen.globalCompositeOperation = 'lighter';
      pen.fillStyle = light; pen.fillRect(0, 0, w, h);
      await f.setSource(work.canvas);
      await sleep(Math.max(0, FRAME - (performance.now() - t)));
    }
    if (id === run && page?.field === f) await f.setSource(to);
  };

  const saving = (text: string | null) => { state.current = { ...state.current, saving: text }; return cross(draw(text)); };
  const pulse = (from?: Element | { x: number; y: number }, strength = 1.6) => { if (page && !page.still()) pulseAt(page.field, from, strength); };

  return pageHandle(() => page, state, () => { void cross(draw()); }, { sweep: () => cross(draw()), saving, pulse }, () => { run++; resize?.disconnect(); });
}
