import type { GlyphFieldOptions } from '../field';
import { clamp, handle, hash, house, mountSurface, smoothstep, srOnly, styleKeeper, type KitHandle, type KitOptions, type Surface } from './core';

export interface OdometerOptions extends KitOptions {
  /** The starting value. Default 0. */
  value?: number;
  /** Turns the value into the text shown. Default `toLocaleString()`. */
  format?: (value: number) => string;
  /** Milliseconds the first changed column rolls; each column to its right rolls `stagger` ms longer. Defaults 360 and 60. */
  duration?: number;
  stagger?: number;
  /** Glyphs the columns roll through. Default `#%*+=-:`. */
  glyphs?: string;
  /** `text`: crisp text at rest, characters only while a column rolls. `glyph`: the whole figure is drawn in characters. Default `text`. */
  face?: 'text' | 'glyph';
}

export interface OdometerHandle extends KitHandle<OdometerOptions> {
  /** Shows a new value; only the changed digits roll, leftmost first. */
  set(value: number): void;
  readonly value: number;
}

const DEFAULTS = { value: 0, duration: 360, stagger: 60, glyphs: '#%*+=-:', format: (n: number) => n.toLocaleString(), face: 'text' as 'text' | 'glyph' };

/** The rightmost-indexed column where `to` first differs from `from` among digits, or -1. Columns count from the right. */
export function firstChanged(from: string, to: string) {
  const at = (s: string, r: number) => s[s.length - 1 - r] ?? '';
  for (let r = to.length - 1; r >= 0; r--) if (/\d/.test(at(to, r)) && at(from, r) !== at(to, r)) return r;
  return -1;
}

/** The kit's poster, which the element keeps when its own children are replaced. */
const posterOf = (element: HTMLElement) => [...element.children].filter(c => c.tagName === 'IMG' && (c as HTMLElement).dataset?.asciiPoster !== undefined);
/**
 * A figure in the page's own font whose changed digits roll through glyphs and land back on the crisp digit.
 * The element's text becomes one span per character; a visually hidden live copy announces each value.
 */
export function odometer(element: HTMLElement, options: OdometerOptions = {}): OdometerHandle {
  const parsed = parseFloat((element.textContent ?? '').replace(/[^\d.-]/g, ''));
  const state = { current: { ...DEFAULTS, ...options, value: options.value ?? (Number.isFinite(parsed) ? parsed : 0) } };
  const styles = styleKeeper();
  let value = state.current.value;
  let text = state.current.format(value);
  let roll = { from: text, to: text, t0: -1e9, up: true, first: -1 };
  let surface: Surface | null = null;
  const live = srOnly(text, true);
  const digits = document.createElement('span');
  const look = (): GlyphFieldOptions => ({
    mark: 'glyph', charset: ' .:-=+*#%@', font: '"Geist Mono", ui-monospace, monospace', fontWeight: 500,
    cellSize: 3, cellAspect: 0.66, glyphScale: 1, shade: 0.2, contrast: 1.1, ...state.current.look,
  });
  const render = () => {
    digits.replaceChildren(...[...text].map(ch => Object.assign(document.createElement('span'), { textContent: ch })));
    live.textContent = text;
  };

  surface = mountSurface({
    host: element,
    look,
    ink: () => state.current.ink ?? getComputedStyle(element).color,
    kit: state,
    reducedMotion: () => state.current.reducedMotion,
    resolution: 2,
    onFail: () => { surface = null; element.textContent = text; styles.restore(); },
    paint: ({ pen, now, still, box, scale }) => {
      const style = getComputedStyle(digits), size = parseFloat(style.fontSize), spacing = parseFloat(style.letterSpacing) || 0;
      const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      pen.setTransform(scale, 0, 0, scale, 0, 0);
      pen.font = font; pen.textAlign = 'center'; pen.textBaseline = 'alphabetic';
      // CSS centres the font's content area in the line box; the painted digit has to sit on the same baseline.
      const metric = pen.measureText('0'), ascent = metric.fontBoundingBoxAscent || size * 0.8, descent = metric.fontBoundingBoxDescent || size * 0.2;
      const { from, to, t0, up, first } = roll, cells = [...digits.children] as HTMLElement[], o = state.current, glyph = o.face === 'glyph';
      const at = (s: string, r: number) => s[s.length - 1 - r] ?? '';
      let moving = false;
      cells.forEach((cell, i) => {
        const r = cells.length - 1 - i, b = box(cell);
        const x = b.x + (b.w - spacing) / 2, top = b.y, slot = b.h, mid = top + (slot - ascent - descent) / 2 + ascent;
        const next = at(to, r), order = first - r;
        const p = !still && first >= 0 && order >= 0 && /\d/.test(next) ? clamp((now - t0) / (o.duration + order * o.stagger)) : 1, spin = house(p);
        // Text face: the text already holds the new digit, so it steps aside at once and fades back in as the column settles.
        // Glyph face: the text stays hidden and every character is drawn, at rest too.
        const opacity = p < 1 && !glyph ? smoothstep(0.72, 1, p).toFixed(3) : '';
        if (cell.style.opacity !== opacity) cell.style.opacity = opacity;
        if (p >= 1) {
          if (glyph) { pen.globalAlpha = 1; pen.font = font; pen.fillStyle = '#fff'; pen.fillText(next, x, mid); }
          return;
        }
        moving = true;
        pen.globalAlpha = glyph ? 1 : 1 - smoothstep(0.72, 1, p);
        const prev = at(from, r), count = 5 + order * 2;
        const line = [prev, ...Array.from({ length: count }, (_, j) => o.glyphs[Math.floor(hash(j + r * 7, t0) * o.glyphs.length)] ?? ''), next];
        if (!up) line.reverse();
        const travel = (line.length - 1) * slot, offset = up ? spin * travel : travel - spin * travel;
        pen.save();
        pen.beginPath(); pen.rect(x - b.w, top, b.w * 2, slot); pen.clip();
        line.forEach((ch, j) => {
          const y = mid + j * slot - offset;
          if (y < top - slot || y > top + slot * 2) return;
          const glyph = j > 0 && j < line.length - 1;
          pen.font = glyph ? `600 ${size * 0.84}px "Geist Mono", ui-monospace, monospace` : font;
          pen.fillStyle = glyph ? '#d0d0d0' : '#fff';
          pen.fillText(ch, x, y);
        });
        pen.restore();
      });
      pen.globalAlpha = 1;
      return moving;
    },
  });

  const showFace = () => { if (surface) styles.set(digits, 'color', state.current.face === 'glyph' ? 'transparent' : 'inherit'); };
  if (surface) {
    styles.set(digits, 'display', 'inline-flex');
    showFace();
    digits.setAttribute('aria-hidden', 'true');
    element.replaceChildren(live, digits, ...posterOf(element), surface.canvas);
    render();
    void document.fonts?.ready.then(() => surface?.kick());
  }

  const set = (next: number) => {
    if (!Number.isFinite(next)) return;
    const before = value, from = text;
    // Kept in the options too, so a later update({ ink }) does not roll the figure back to its first value.
    value = state.current.value = next;
    text = state.current.format(next);
    if (!surface) { element.textContent = text; return; }
    if (from === text) return;
    roll = { from, to: text, up: next >= before, first: firstChanged(from, text), t0: performance.now() };
    render();
    surface.kick();
  };

  return handle(() => surface, state, next => {
    showFace();
    if (next.value !== value) set(next.value);
    else { text = next.format(value); render(); surface?.refresh(); }
  }, {
    set,
    get value() { return value; },
  }, () => {
    if (surface) element.textContent = text;
    styles.restore();
  });
}

export const ODOMETER_DEFAULTS = DEFAULTS;
