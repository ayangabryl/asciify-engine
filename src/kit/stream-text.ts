import type { GlyphFieldOptions } from '../field';
import { clamp, handle, hash, house, mountSurface, prefersReduced, smoothstep, type KitHandle, type KitOptions, type Surface } from './core';
import { injectStyle } from './capture';
import { resolveCharset } from '../studio/characters';

export type StreamState = 'idle' | 'streaming' | 'done' | 'stopped';

export interface StreamTextOptions extends KitOptions {
  /** A block caret after the last character: bright while writing, dim at rest. Default true. */
  caret?: boolean;
  /** Ms a token's first character flickers before it resolves; each following character takes `stagger` ms more. Defaults 60 and 18. */
  settle?: number;
  stagger?: number;
  /** Called on every state change. */
  onState?: (state: StreamState) => void;
  /** Reasoning lines `reasoning()` keeps in view above the reply; older ones scroll up and fade. Default 2. */
  reasoningLines?: number;
  /**
   * How characters land, set at creation. `flicker`: a glyph cell flickers, then resolves into the letter. `roll`: each
   * character rolls up through glyphs in the text's own font and settles on the crisp letter, like the odometer. Default `flicker`.
   */
  transition?: 'flicker' | 'roll';
  /** Ms one character rolls under `transition: 'roll'`; each next character starts `stagger` ms later. Default 300. */
  roll?: number;
  /** Glyphs a character rolls through. Default `#%*+=-:`, or the `charset`'s characters when one is given. */
  glyphs?: string;
}

export interface StreamTextHandle extends KitHandle<StreamTextOptions> {
  /** Appends a token: its characters land as flickering glyph cells that resolve into letters, left to right. */
  write(token: string): void;
  /** No more tokens: resolves once the last characters have landed. */
  done(): Promise<void>;
  /** Lands what has been written at once and stops. */
  stop(): void;
  /** Adds a line to the reasoning tail above the reply. The tail collapses once the reply is done or stopped. */
  reasoning(line: string): void;
  /** Clears the text and the reasoning for a new reply. */
  reset(): void;
  readonly state: StreamState;
  readonly text: string;
}

const DEFAULTS = { caret: true, settle: 60, stagger: 18, reasoningLines: 2, transition: 'flicker' as 'flicker' | 'roll', roll: 300, glyphs: '#%*+=-:' };
const rolled = new Map<string, string[]>();
/** The glyphs a roll runs through: the `charset`'s, when one is given, else `glyphs`. Split by code point, so kanji roll whole. */
const rollGlyphs = (o: { glyphs: string; charset?: string }) => {
  const key = o.charset ? resolveCharset(o.charset)!.replace(/\s/g, '') || o.glyphs : o.glyphs;
  let list = rolled.get(key);
  if (!list) rolled.set(key, (list = [...key]));
  return list;
};
const EASE = 'cubic-bezier(.16, 1, .3, 1)';
const CSS = `
:where(.ascii-reasoning){display:grid;grid-template-rows:1fr;transition:grid-template-rows 260ms ${EASE},opacity 200ms ${EASE}}
:where(.ascii-reasoning[data-collapsed]){grid-template-rows:0fr;opacity:0}
:where(.ascii-reasoning-in){min-height:0;overflow:hidden}
:where(.ascii-reasoning ol){height:calc(var(--ascii-reasoning-lines, 2) * 1.5em);margin:0 0 .5em;padding:0;list-style:none;overflow:hidden;-webkit-mask-image:linear-gradient(to bottom,transparent,#000 45%);mask-image:linear-gradient(to bottom,transparent,#000 45%)}
:where(.ascii-reasoning li){height:1.5em;line-height:1.5em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.62;translate:0 calc(var(--ascii-reasoning-shift, 0) * -1.5em);transition:translate 240ms ${EASE},opacity 200ms ${EASE}}
:where(.ascii-reasoning li[data-new]){opacity:0}
@media (prefers-reduced-motion: reduce){:where(.ascii-reasoning, .ascii-reasoning li){transition:none}}
`;
const REST_TONE = 0.7, FLICKER_MS = 48;

interface Char { span: HTMLElement; from: number; at: number; seed: number }

/** The kit's poster, which the element keeps when its own children are replaced. */
const posterOf = (element: HTMLElement) => [...element.children].filter(c => c.tagName === 'IMG' && (c as HTMLElement).dataset?.asciiPoster !== undefined);
/**
 * Streamed text with a glyph write head: each token lands as flickering character cells that resolve into letters left
 * to right, with a block caret after the last one. The real text is in the DOM all along, for selection and screen readers.
 */
export function streamText(element: HTMLElement, options: StreamTextOptions = {}): StreamTextHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  const original = [...element.childNodes];
  let phase: StreamState = 'idle', text = '', pending: Char[] = [], last: HTMLElement | null = null, tokens = 0;
  let finish: (() => void) | null = null, finished: Promise<void> | null = null;
  let surface: Surface | null = null;
  const metrics = () => {
    const style = getComputedStyle(element), size = parseFloat(style.fontSize) || 15, lh = parseFloat(style.lineHeight);
    const line = Number.isFinite(lh) && lh > 0 ? lh : size * 1.5;
    // Cells are half a line tall and about a letter wide; the field starts a quarter line above the text, so each line's middle
    // row of cells sits on its lowercase letters and a glyph reads like a typed character rather than a block over the line.
    return { size, line, ch: line / 2, cw: Math.max(2, Math.round(size * 0.44)) };
  };
  const rolling = state.current.transition === 'roll';
  const look = (): GlyphFieldOptions => {
    if (rolling) {
      // Body text is small: finer cells than the odometer's keep a rolling letter legible rather than a smudge.
      const cell = metrics().size < 24 ? 2 : 3;
      return { mark: 'glyph', charset: ' .:-=+*#%@', font: '"Geist Mono", ui-monospace, monospace', fontWeight: 500, cellSize: cell, cellAspect: 0.66, glyphScale: 1, shade: 0.2, contrast: 1.1, ...state.current.look };
    }
    const { ch, cw } = metrics();
    return {
      mark: 'glyph', charset: '   :-=+*#%@', font: '"Geist Mono", ui-monospace, monospace', fontWeight: 500,
      cellSize: ch, cellAspect: cw / ch, glyphScale: 1, shade: 0.6, ...state.current.look,
    };
  };
  // The reasoning tail: a short list above the reply whose newest lines stay in view; it collapses when the reply ends.
  let tail: HTMLElement | null = null, list: HTMLElement | null = null;
  const reasoning = (line: string) => {
    if (!line || typeof document === 'undefined') return;
    if (!tail || !list) {
      injectStyle('ascii-kit-reasoning', CSS);
      tail = document.createElement('div');
      tail.className = 'ascii-reasoning';
      const inner = document.createElement('div');
      inner.className = 'ascii-reasoning-in';
      list = document.createElement('ol');
      inner.appendChild(list);
      tail.appendChild(inner);
      element.parentElement?.insertBefore(tail, element);
    }
    tail.removeAttribute('data-collapsed');
    tail.removeAttribute('aria-hidden');
    const lines = Math.max(1, Math.round(state.current.reasoningLines));
    tail.style.setProperty('--ascii-reasoning-lines', String(lines));
    const item = document.createElement('li');
    item.textContent = line;
    const still = state.current.reducedMotion ?? prefersReduced();
    if (!still) item.setAttribute('data-new', '');
    list.appendChild(item);
    // A frame later, so the new line fades in and every line, the new one too, slides up together rather than the new one landing
    // in place while the others are still moving.
    const box = tail, shift = String(Math.max(0, list.children.length - lines));
    if (still) box.style.setProperty('--ascii-reasoning-shift', shift);
    else {
      // The new line's starting place has to be computed before the shift changes, or it would start where it ends.
      void getComputedStyle(item).translate;
      requestAnimationFrame(() => { item.removeAttribute('data-new'); box.style.setProperty('--ascii-reasoning-shift', shift); });
    }
  };
  const collapse = () => { tail?.setAttribute('data-collapsed', ''); tail?.setAttribute('aria-hidden', 'true'); };

  const move = (next: StreamState) => {
    if (phase === next) return;
    phase = next;
    if (next === 'done' || next === 'stopped') collapse();
    if (next === 'streaming') element.setAttribute('aria-busy', 'true'); else element.removeAttribute('aria-busy');
    state.current.onState?.(next);
  };
  const land = (char: Char) => { char.span.style.removeProperty('color'); char.span.style.removeProperty('opacity'); };
  const settleAll = () => {
    pending.forEach(land);
    pending = [];
    if (phase === 'streaming' && finish) move('done');
    finish?.(); finish = null;
  };

  /** Roll: each pending character's column runs up through glyphs to its letter, in the element's own font, then hands over to the text. */
  const paintRoll = (pen: CanvasRenderingContext2D, now: number, still: boolean, box: (el: Element) => { x: number; y: number; w: number; h: number }, scale: number) => {
    const style = getComputedStyle(element), size = parseFloat(style.fontSize) || 15, { line } = metrics();
    const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    pen.setTransform(scale, 0, 0, scale, 0, 0);
    pen.textAlign = 'left'; pen.textBaseline = 'alphabetic';
    pen.font = font;
    const metric = pen.measureText('x'), ascent = metric.fontBoundingBoxAscent || size * 0.8, descent = metric.fontBoundingBoxDescent || size * 0.2;
    if (still) { pending.forEach(land); pending = []; }
    const o = state.current;
    pending = pending.filter(char => {
      if (now >= char.at) { land(char); return false; }
      const p = clamp((now - char.from) / Math.max(1, char.at - char.from)), spin = house(p), b = box(char.span);
      // The text holds the letter all along: hidden while it rolls, fading back in as the column settles, as the odometer does.
      char.span.style.setProperty('opacity', smoothstep(0.72, 1, p).toFixed(3));
      if (p <= 0) return true;
      const top = b.y + (b.h - line) / 2, mid = top + (line - ascent - descent) / 2 + ascent;
      const count = 3 + (char.seed % 3);
      const column = [...Array.from({ length: count }, (_, j) => rollGlyphs(o)[Math.floor(hash(j, char.seed) * rollGlyphs(o).length)] ?? ''), char.span.textContent ?? ''];
      const offset = (1 - spin) * (column.length - 1) * line;
      pen.save();
      pen.beginPath(); pen.rect(b.x - 2, top, b.w + 4, line); pen.clip();
      pen.globalAlpha = 1 - smoothstep(0.72, 1, p);
      column.forEach((glyph, j) => {
        const y = mid + (j - (column.length - 1)) * line + offset;
        if (y < top - line || y > top + line * 2) return;
        const last = j === column.length - 1;
        pen.font = last ? font : `600 ${size * 0.84}px "Geist Mono", ui-monospace, monospace`;
        pen.fillStyle = last ? '#fff' : '#d0d0d0';
        pen.fillText(glyph, b.x + (last ? 0 : (b.w - pen.measureText(glyph).width) / 2), y);
      });
      pen.restore();
      return true;
    });
    pen.globalAlpha = 1;
    if (!pending.length && finish) settleAll();
    if (o.caret && phase !== 'idle' && (last || phase === 'streaming')) {
      // The caret rides the front of the roll: after the last character that has started, not the last one written.
      const waiting = pending.find(char => char.from > now), front = waiting ? waiting.span.previousElementSibling as HTMLElement | null : last;
      const b = front ? box(front) : { x: 0, y: 0, w: 0, h: line }, top = b.y + (b.h - line) / 2;
      pen.fillStyle = phase === 'streaming' ? '#fff' : `rgb(${REST_TONE * 255} ${REST_TONE * 255} ${REST_TONE * 255})`;
      pen.fillRect(b.x + b.w + size * 0.18, top + line * 0.2, Math.max(2, size * 0.5), line * 0.6);
    }
    return pending.length > 0;
  };

  surface = mountSurface({
    host: element,
    look,
    ink: () => state.current.ink ?? getComputedStyle(element).color,
    kit: state,
    reducedMotion: () => state.current.reducedMotion,
    onFail: () => { surface = null; settleAll(); },
    resolution: rolling ? 2 : 1,
    paint: ({ pen, now, still, box, scale }) => {
      if (rolling) return paintRoll(pen, now, still, box, scale);
      const { line, ch, cw, size } = metrics(), step = Math.floor(now / FLICKER_MS), lead = line / 4;
      // Boxes come in canvas pixels, whose top is a quarter line above the text: each covers whole cells on its line's middle row.
      const cell = (b: { x: number; y: number; w: number; h: number }, tone: number) => {
        const row = Math.floor((b.y - lead + b.h / 2) / line) * line + lead + (line - ch) / 2, col = Math.round(b.x / cw), v = Math.round(255 * tone);
        pen.fillStyle = `rgb(${v} ${v} ${v})`;
        pen.fillRect(col * cw, row, Math.max(1, Math.round((b.x + b.w) / cw) - col) * cw, ch);
      };
      if (still) { pending.forEach(land); pending = []; }
      pending = pending.filter(char => {
        if (now >= char.at) { land(char); return false; }
        cell(box(char.span), 0.55 + 0.45 * hash(step, char.seed));
        return true;
      });
      if (!pending.length && finish) settleAll();
      if (state.current.caret && phase !== 'idle' && (last || phase === 'streaming')) {
        const b = last ? box(last) : { x: 0, y: lead, w: 0, h: line }, x = Math.round((b.x + b.w + size * 0.3) / cw) * cw;
        cell({ x, y: b.y, w: cw, h: b.h }, phase === 'streaming' ? 1 : REST_TONE);
      }
      return pending.length > 0;
    },
  });
  if (surface) {
    // The field covers the content box from a quarter line above the text to a quarter line below, so its rows line up with
    // the lines, and runs half a line past the right edge so a caret after the last word of a full line still shows.
    const style = getComputedStyle(element), css = surface.canvas.style, px = (v: string | undefined) => parseFloat(v ?? '') || 0, { line } = metrics();
    const top = px(style.paddingTop) - line / 4, right = px(style.paddingRight) - line / 2, bottom = px(style.paddingBottom) - line / 4, left = px(style.paddingLeft);
    css.top = `${top}px`; css.left = `${left}px`;
    css.width = `calc(100% - ${left + right}px)`; css.height = `calc(100% - ${top + bottom}px)`;
  }

  const begin = () => {
    if (phase === 'streaming') return;
    if (phase === 'idle') { element.replaceChildren(...posterOf(element)); if (surface) element.appendChild(surface.canvas); }
    finished = null;
    move('streaming');
  };

  const write = (token: string) => {
    if (!token) return;
    begin();
    text += token;
    const add = (node: Node) => element.appendChild(node);
    if (!surface) { add(document.createTextNode(token)); return; }
    const now = performance.now(), o = state.current, still = surface.still();
    let j = 0;
    for (const part of token.match(/\s+|\S/g) ?? []) {
      if (/^\s/.test(part)) { add(document.createTextNode(part)); continue; }
      const span = document.createElement('span');
      span.textContent = part;
      if (!still) {
        if (rolling) {
          // Each character starts a stagger after the one before it, counted from the last still rolling, so tokens flow on.
          const after = pending.length ? pending[pending.length - 1].from + o.stagger : now;
          const from = Math.max(now, after);
          span.style.setProperty('opacity', '0');
          pending.push({ span, from, at: from + o.roll, seed: tokens * 31 + j });
        } else {
          span.style.setProperty('color', 'transparent');
          pending.push({ span, from: now, at: now + o.settle + j * o.stagger, seed: tokens * 31 + j });
        }
      }
      add(span);
      last = span;
      j++;
    }
    tokens++;
    surface.kick();
  };

  const done = () => {
    if (finished) return finished;
    if (phase !== 'streaming') return Promise.resolve();
    finished = new Promise<void>(resolve => { finish = resolve; });
    if (!surface || !pending.length) settleAll();
    else surface.kick();
    return finished;
  };

  return handle(() => surface, state, () => surface?.refresh(), {
    write,
    done,
    stop() {
      // Stopped while still reasoning: the tail folds away and nothing was written.
      if (phase === 'idle' && tail) { finished = null; move('stopped'); surface?.kick(); return; }
      if (phase !== 'streaming') return;
      pending.forEach(land); pending = [];
      move('stopped');
      finish?.(); finish = null;
      surface?.kick();
    },
    reasoning,
    reset() {
      pending = []; text = ''; last = null; tokens = 0;
      tail?.remove(); tail = list = null;
      finish?.(); finish = null; finished = null;
      element.replaceChildren(...posterOf(element));
      if (surface) element.appendChild(surface.canvas);
      move('idle');
      surface?.kick();
    },
    get state() { return phase; },
    get text() { return text; },
  }, () => {
    finish?.(); finish = null;
    tail?.remove(); tail = list = null;
    element.removeAttribute('aria-busy');
    if (text) element.textContent = text; else element.replaceChildren(...original);
  });
}

export const STREAM_TEXT_DEFAULTS = DEFAULTS;
