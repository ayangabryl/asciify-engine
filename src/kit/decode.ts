import type { GlyphFieldOptions } from '../field';
import { handle, hash, house, mountSurface, styleKeeper, type KitHandle, type KitOptions, type Surface } from './core';

export interface DecodeOptions extends KitOptions {
  /** Text to draw instead of the element's own, centred and as large as fits; `\n` breaks lines. By default the element's text is drawn exactly where the browser lays it out. */
  text?: string;
  /** Total length in ms: the first 30% is drift alone, then the words resolve left to right. Default 900. */
  duration?: number;
  /** `visible` decodes when the element scrolls into view; `manual` waits for `replay()`. Default `visible`. */
  trigger?: 'visible' | 'manual';
  /** Decode again when the pointer enters. Default true. */
  replayOnHover?: boolean;
  /** `glyphs` keeps the headline in characters; `text` hands back to the crisp HTML text at the end. Default `glyphs`. */
  settle?: 'glyphs' | 'text';
}

export interface DecodeHandle extends KitHandle<DecodeOptions> {
  /** Plays the decode again from the drift. */
  replay(): void;
}

const DEFAULTS = { duration: 900, trigger: 'visible' as const, replayOnHover: true, settle: 'glyphs' as const };
const RESOLUTION = 2;

/** A soft value-noise cloud that drifts with `t`, feathered toward the edges. */
export function driftNoise(noise: HTMLCanvasElement, t: number, feather = 0.82) {
  const ctx = noise.getContext('2d');
  if (!ctx) return;
  const w = noise.width, h = noise.height, img = ctx.createImageData(w, h);
  const smooth = (x: number) => x * x * (3 - 2 * x);
  const value = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = smooth(x - xi), yf = smooth(y - yi);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const n = value(x / 6 + t * 2.4, y / 3.5 - t * 0.8) * 0.6 + value(x / 2.5 - t * 3, y / 2) * 0.4;
    const edge = Math.min(1, (1 - Math.hypot((x / w - 0.5) * 2, (y / h - 0.5) * 2) * feather) * 2.4);
    const v = Math.max(0, n - 0.42) * 0.72 * Math.max(0, edge) * 255, i = (y * w + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/** Paints the element's text white on black where the browser laid each word out. */
function paintOwnText(pen: CanvasRenderingContext2D, element: HTMLElement, origin: DOMRect, scale: number) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  pen.fillStyle = '#fff';
  pen.textAlign = 'left';
  pen.textBaseline = 'alphabetic';
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const parent = node.parentElement;
    if (!parent) continue;
    const style = getComputedStyle(parent);
    pen.font = `${style.fontStyle} ${style.fontWeight} ${parseFloat(style.fontSize) * scale}px ${style.fontFamily}`;
    if ('letterSpacing' in pen) (pen as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${(parseFloat(style.letterSpacing) || 0) * scale}px`;
    const metric = pen.measureText('Hg'), ascent = metric.fontBoundingBoxAscent || parseFloat(style.fontSize) * scale * 0.8, descent = metric.fontBoundingBoxDescent || parseFloat(style.fontSize) * scale * 0.2;
    const transform = style.textTransform === 'uppercase' ? (s: string) => s.toUpperCase() : style.textTransform === 'lowercase' ? (s: string) => s.toLowerCase() : (s: string) => s;
    for (const word of node.data.matchAll(/\S+/g)) {
      range.setStart(node, word.index!);
      range.setEnd(node, word.index! + word[0].length);
      const rect = range.getClientRects()[0];
      if (!rect) continue;
      const top = (rect.top - origin.top) * scale, height = rect.height * scale;
      pen.fillText(transform(word[0]), (rect.left - origin.left) * scale, top + (height - ascent - descent) / 2 + ascent);
    }
  }
  range.detach?.();
}

/** Lines of `text` centred and as large as fits, in the element's font. */
function paintGivenText(pen: CanvasRenderingContext2D, element: HTMLElement, text: string, w: number, h: number) {
  const style = getComputedStyle(element), lines = text.split('\n');
  pen.fillStyle = '#fff'; pen.textAlign = 'center'; pen.textBaseline = 'middle';
  pen.font = `${style.fontWeight} 100px ${style.fontFamily}`;
  const widest = Math.max(1, ...lines.map(line => pen.measureText(line).width));
  const size = Math.min(((w * 0.94) / widest) * 100, (h * 0.9) / lines.length);
  pen.font = `${style.fontWeight} ${size}px ${style.fontFamily}`;
  lines.forEach((line, i) => pen.fillText(line, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.04));
}

/** A headline that condenses out of a drifting field of characters, left to right through a flickering band. */
export function decode(element: HTMLElement, options: DecodeOptions = {}): DecodeHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  const styles = styleKeeper();
  const art = document.createElement('canvas'), noise = document.createElement('canvas');
  let start = -1, artKey = '', showing = false, ran = false, surface: Surface | null = null;
  const look = (): GlyphFieldOptions => ({
    mark: 'glyph', charset: ' .:-=+*#%@', font: '"Geist Mono", ui-monospace, monospace', fontWeight: 500,
    cellSize: 4.5, cellAspect: 0.62, glyphScale: 0.92, contrast: 1.35, hover: 'trail', trail: { strength: 0.6, radius: 0.2 },
    ...state.current.look,
  });

  const buildArt = (w: number, h: number) => {
    const key = `${w}x${h}:${state.current.text ?? ''}:${element.textContent}`;
    if (key === artKey) return;
    artKey = key;
    art.width = w; art.height = h;
    const pen = art.getContext('2d')!;
    pen.fillStyle = '#000'; pen.fillRect(0, 0, w, h);
    if (state.current.text !== undefined) paintGivenText(pen, element, state.current.text, w, h);
    else paintOwnText(pen, element, element.getBoundingClientRect(), (w / (element.getBoundingClientRect().width || 1)));
  };

  surface = mountSurface({
    host: element,
    look,
    // Text fill is hidden while the field draws, but `color` still holds the theme's text colour.
    ink: () => state.current.ink ?? getComputedStyle(element).color,
    reducedMotion: () => state.current.reducedMotion,
    resolution: RESOLUTION,
    onFail: () => { surface = null; styles.restore(); },
    paint: ({ pen, width: w, height: h, now, still }) => {
      buildArt(w, h);
      const o = state.current, textEnd = o.settle === 'text';
      if (start < 0 || still) {
        // Waiting to scroll into view: an empty field, so the first decode starts from nothing.
        if (!ran && o.trigger === 'visible' && !still) return false;
        if (!(textEnd && start >= 0)) pen.drawImage(art, 0, 0);
        if (start >= 0) finish();
        return false;
      }
      const t = now - start, drift = o.duration * 0.3, sweep = o.duration * 0.7;
      const nw = Math.max(2, Math.ceil(w / 20)), nh = Math.max(2, Math.ceil(h / 20));
      if (noise.width !== nw || noise.height !== nh) { noise.width = nw; noise.height = nh; }
      driftNoise(noise, t / 1000);
      pen.imageSmoothingEnabled = true;
      if (t < drift) {
        pen.drawImage(noise, 0, 0, w, h);
        if (showing) { pen.globalAlpha = 1 - house(t / drift); pen.drawImage(art, 0, 0); pen.globalAlpha = 1; }
        return true;
      }
      const p = Math.min(1, (t - drift) / sweep), edge = (p * 1.18 - 0.02) * w, band = w * 0.14;
      const cw = 4.5 * 0.62 * RESOLUTION, ch = 4.5 * RESOLUTION, step = Math.floor(now / 16);
      if (p >= 1) {
        if (!textEnd) pen.drawImage(art, 0, 0);
        finish();
        return false;
      }
      pen.drawImage(noise, 0, 0, w, h);
      if (edge > 0) pen.drawImage(art, 0, 0, edge, h, 0, 0, edge, h);
      for (let x = Math.max(0, Math.floor(edge / cw) * cw); x < edge + band; x += cw) {
        const depth = (x - edge) / band;
        for (let y = 0; y < h; y += ch) {
          if (hash(x + step * 13, y) < depth) continue;
          pen.globalAlpha = 0.35 + 0.65 * hash(y + step * 7, x);
          pen.fillStyle = '#000'; pen.fillRect(x, y, cw, ch);
          pen.drawImage(art, x, y, cw, ch, x, y, cw, ch);
        }
      }
      pen.globalAlpha = 1;
      return true;
    },
  });

  const finish = () => {
    start = -1;
    showing = state.current.settle !== 'text';
    if (!showing) styles.restore();
  };
  const run = () => {
    if (!surface) return;
    styles.set(element, '-webkit-text-fill-color', 'transparent');
    ran = true;
    start = performance.now();
    surface.kick();
  };

  let seen = false;
  const view = surface && state.current.trigger === 'visible' && typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(([entry]) => { if (entry.isIntersecting && !seen) run(); seen = entry.isIntersecting; }, { threshold: 0.5 })
    : null;
  if (surface) {
    if (state.current.settle !== 'text') styles.set(element, '-webkit-text-fill-color', 'transparent');
    showing = state.current.settle !== 'text' && state.current.trigger === 'manual';
    if (view) view.observe(element);
    else if (state.current.trigger === 'visible') run();
  }
  const onEnter = () => { if (state.current.replayOnHover && start < 0) run(); };
  if (surface) element.addEventListener('pointerenter', onEnter);
  if (surface) void document.fonts?.ready.then(() => { artKey = ''; surface?.kick(); });

  return handle(() => surface, state, () => { artKey = ''; surface?.refresh(); }, {
    replay: run,
  }, () => {
    view?.disconnect();
    element.removeEventListener('pointerenter', onEnter);
    styles.restore();
  });
}

export const DECODE_DEFAULTS = DEFAULTS;
