import type { GlyphFieldOptions } from '../field';
import { clamp, handle, hash, house, mountSurface, prefersReduced, smoothstep, srOnly, styleKeeper, type KitHandle, type KitOptions, type Surface } from './core';

export type ThinkingState = 'thinking' | 'streaming' | 'done';

export interface ThinkingOptions extends KitOptions {
  /** The status element: `Thinking…` while a wave of rolling characters runs through it, then `Thought for 2s`. */
  label?: HTMLElement | null;
  /** The status texts. */
  labels?: { thinking?: string; done?: (seconds: number) => string };
  /** Start thinking at once. Default true; false waits for `think()`. */
  start?: boolean;
  /** Ms between one word of the answer and the next fading in. Default 38. */
  stagger?: number;
  /** Ms one character of the label takes to roll through its glyphs and back. Default 520. */
  roll?: number;
  /** Ms between neighbouring characters as the wave runs across the label. Default 55. */
  wave?: number;
  /** Glyphs the label rolls through. Default `#%*+=-:`. */
  glyphs?: string;
  /** Called on each state change; `seconds` is how long it thought, once known. For a status you render yourself. */
  onState?: (state: ThinkingState, seconds: number) => void;
  /** @deprecated The dot bands were removed in 4.17; ignored. */
  lines?: number;
  /** @deprecated The dotted rule was removed in 4.17; ignored. */
  rule?: boolean;
}

export interface ThinkingHandle extends KitHandle<ThinkingOptions> {
  /** Clears the answer and thinks again, as for Regenerate. */
  think(): void;
  /** Writes the answer, word by word, as the label settles. Pass a string or an async iterable of chunks. Resolves when it has settled. */
  stream(text: string | AsyncIterable<string>): Promise<void>;
  readonly state: ThinkingState;
}

const DEFAULTS = { start: true, stagger: 38, roll: 520, wave: 55, glyphs: '#%*+=-:' };
const WORD_MS = 260, REST_MS = 420;
const thinkingLabel = 'Thinking…';
const doneLabel = (s: number) => `Thought for ${s}s`;

/**
 * The thinking state of an assistant reply. While the model thinks, a wave runs through the status label: each letter in
 * turn rolls up through glyphs and lands back on itself, in the label's own font. When the answer starts, every letter rolls
 * once more into `Thought for 2s`, and the answer fades in word by word.
 */
export function thinking(element: HTMLElement, options: ThinkingOptions = {}): ThinkingHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  const styles = styleKeeper();
  const original = [...element.childNodes];
  const host = state.current.label ?? null;
  const labelOriginal = host ? [...host.childNodes] : [];
  let phase: ThinkingState = 'done', took = 0, started = 0, settledAt = -1e9, run = 0, written = '';
  let surface: Surface | null = null;
  // The label: a live copy for screen readers, and one span per character the field rolls.
  const live = host ? srOnly('', true) : null;
  const chars = document.createElement('span');
  let text = '', previous = '';
  const look = (): GlyphFieldOptions => ({
    mark: 'glyph', charset: ' .:-=+*#%@', font: '"Geist Mono", ui-monospace, monospace', fontWeight: 500,
    cellSize: 2, cellAspect: 0.66, glyphScale: 1, shade: 0.2, contrast: 1.1, ...state.current.look,
  });
  const quiet = () => state.current.reducedMotion ?? prefersReduced();
  const setLabel = (next: string, settle: boolean) => {
    previous = text; text = next;
    if (!host) return;
    if (live) live.textContent = next;
    if (!surface) { host.textContent = next; return; }
    chars.replaceChildren(...[...next].map(ch => Object.assign(document.createElement('span'), { textContent: ch })));
    settledAt = settle ? performance.now() : -1e9;
    surface.kick();
  };

  if (host) {
    surface = mountSurface({
      host,
      look,
      ink: () => state.current.ink ?? getComputedStyle(host).color,
      kit: state,
      reducedMotion: () => state.current.reducedMotion,
      resolution: 2,
      onFail: () => { surface = null; host.textContent = text; styles.restore(); },
      paint: ({ pen, now, still, box, scale }) => {
        const style = getComputedStyle(chars), size = parseFloat(style.fontSize) || 14;
        const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        pen.setTransform(scale, 0, 0, scale, 0, 0);
        pen.textAlign = 'center'; pen.textBaseline = 'alphabetic'; pen.font = font;
        const metric = pen.measureText('x'), ascent = metric.fontBoundingBoxAscent || size * 0.8, descent = metric.fontBoundingBoxDescent || size * 0.2;
        const o = state.current, cells = [...chars.children] as HTMLElement[];
        // While thinking the wave loops: it crosses the label, rests, and crosses again. Settling rolls every letter once.
        const settling = now - settledAt < o.roll + cells.length * o.wave;
        const period = cells.length * o.wave + o.roll + REST_MS;
        let moving = false;
        cells.forEach((cell, i) => {
          let p = 1;
          if (!still && settling) p = clamp((now - settledAt - i * o.wave) / o.roll);
          else if (!still && phase === 'thinking') { const local = ((now - started) % period) - i * o.wave; p = local < 0 || local > o.roll ? 1 : local / o.roll; }
          const opacity = p < 1 ? smoothstep(0.7, 1, p).toFixed(3) : '';
          if (cell.style.opacity !== opacity) cell.style.opacity = opacity;
          if (p >= 1 || !cell.textContent?.trim()) return;
          moving = true;
          const b = box(cell), mid = b.y + (b.h - ascent - descent) / 2 + ascent, x = b.x + b.w / 2;
          // Settling runs from the old letter to the new one; the wave runs from a letter back to itself.
          const from = settling ? (previous[i] ?? ' ') : cell.textContent, to = cell.textContent;
          const column = [from, ...Array.from({ length: 3 }, (_, j) => o.glyphs[Math.floor(hash(j + i * 7, Math.floor(started)) * o.glyphs.length)] ?? ''), to];
          const offset = house(p) * (column.length - 1) * b.h;
          pen.save();
          pen.beginPath(); pen.rect(b.x - 2, b.y, b.w + 4, b.h); pen.clip();
          pen.globalAlpha = 1 - smoothstep(0.7, 1, p);
          column.forEach((glyph, j) => {
            const y = mid + j * b.h - offset;
            if (y < b.y - b.h || y > b.y + b.h * 2) return;
            const letter = j === 0 || j === column.length - 1;
            pen.font = letter ? font : `600 ${size * 0.86}px "Geist Mono", ui-monospace, monospace`;
            pen.fillStyle = letter ? '#fff' : '#d0d0d0';
            pen.fillText(glyph, x, y);
          });
          pen.restore();
        });
        pen.globalAlpha = 1;
        return moving || (!still && (phase === 'thinking' || settling));
      },
    });
    if (surface && live) {
      styles.set(chars, 'display', 'inline-flex');
      styles.set(chars, 'white-space', 'pre');
      chars.setAttribute('aria-hidden', 'true');
      host.replaceChildren(live, chars, surface.canvas);
    }
  }

  const words = document.createElement('span');
  const think = () => {
    run++;
    phase = 'thinking';
    started = performance.now();
    written = '';
    words.replaceChildren();
    element.replaceChildren(words);
    element.setAttribute('aria-busy', 'true');
    setLabel(state.current.labels?.thinking ?? thinkingLabel, false);
    state.current.onState?.('thinking', 0);
    surface?.kick();
  };

  /** Adds whole words as spans that fade in one after another. */
  let shown = 0, firstAt = 0;
  const addWords = (chunk: string) => {
    const fade = !quiet() && !(surface?.still() ?? false);
    for (const part of chunk.match(/\s+|\S+/g) ?? []) {
      if (/^\s/.test(part)) { words.append(part); continue; }
      const span = document.createElement('span');
      span.textContent = part;
      if (fade) {
        styles.set(span, 'opacity', '0');
        const delay = Math.max(0, shown * state.current.stagger - (performance.now() - firstAt));
        styles.set(span, 'transition', `opacity ${WORD_MS}ms cubic-bezier(.16, 1, .3, 1) ${Math.round(delay)}ms`);
        requestAnimationFrame(() => requestAnimationFrame(() => span.style.setProperty('opacity', '1')));
      }
      shown++;
      words.appendChild(span);
    }
  };

  const stream = async (input: string | AsyncIterable<string>) => {
    if (phase !== 'thinking') think();
    const id = run;
    shown = 0;
    let pending = '';
    const begin = () => {
      if (phase !== 'thinking') return;
      phase = 'streaming';
      firstAt = performance.now();
      took = Math.max(1, Math.round((firstAt - started) / 1000));
      setLabel((state.current.labels?.done ?? doneLabel)(took), true);
      state.current.onState?.('streaming', took);
    };
    const feed = (chunk: string, last: boolean) => {
      pending += chunk;
      const cut = last ? pending.length : pending.search(/\s\S*$/) + 1;
      if (cut <= 0) return;
      begin();
      written += pending.slice(0, cut);
      addWords(pending.slice(0, cut));
      pending = pending.slice(cut);
    };
    if (typeof input === 'string') feed(input, true);
    else {
      for await (const chunk of input) { if (id !== run) return; feed(chunk, false); }
      if (id !== run) return;
      feed('', true);
    }
    begin();
    const left = quiet() ? 0 : Math.max(0, shown * state.current.stagger - (performance.now() - firstAt)) + WORD_MS;
    await new Promise(resolve => setTimeout(resolve, left));
    if (id !== run) return;
    phase = 'done';
    element.setAttribute('aria-busy', 'false');
    state.current.onState?.('done', took);
    surface?.kick();
  };

  if (state.current.start) think();

  return handle(() => surface, state, () => surface?.refresh(), {
    think,
    stream,
    get state() { return phase; },
  }, () => {
    run++;
    styles.restore();
    element.removeAttribute('aria-busy');
    if (written) element.textContent = written;
    else element.replaceChildren(...original);
    if (host) { if (text) host.textContent = text; else host.replaceChildren(...labelOriginal); }
  });
}

export const THINKING_DEFAULTS = DEFAULTS;
