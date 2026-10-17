import type { GlyphFieldOptions } from '../field';
import { clamp, easeOut, handle, hash, mountSurface, styleKeeper, type KitHandle, type KitOptions, type Surface } from './core';
import { driftNoise } from './decode';

export type ThinkingState = 'thinking' | 'streaming' | 'done';

export interface ThinkingOptions extends KitOptions {
  /** Line-shaped bands of drifting dots shown while thinking. Default 3. */
  lines?: number;
  /** An element to write the status into: `Thinking…`, then `Thought for 2s`. */
  label?: HTMLElement | null;
  /** The status texts. */
  labels?: { thinking?: string; done?: (seconds: number) => string };
  /** Start thinking at once. Default true; false waits for `think()`. */
  start?: boolean;
  /** Ms between one word and the next fading in. Default 38. */
  stagger?: number;
  /** A dotted rule under the finished answer. Default true. */
  rule?: boolean;
}

export interface ThinkingHandle extends KitHandle<ThinkingOptions> {
  /** Clears the answer and thinks again, as for Regenerate. */
  think(): void;
  /** Writes the answer, word by word, as the dots give way. Pass a string or an async iterable of chunks. Resolves when it has settled. */
  stream(text: string | AsyncIterable<string>): Promise<void>;
  readonly state: ThinkingState;
}

const DEFAULTS = { lines: 3, start: true, stagger: 38, rule: true };
const FADE_MS = 420, RULE_DELAY = 280, WORD_MS = 260;
const thinkingLabel = 'Thinking…';
const doneLabel = (s: number) => `Thought for ${s}s`;

/**
 * The thinking state of an assistant reply: line-shaped bands of drifting dots while the model thinks, then the answer
 * fades in word by word as the dots give way, leaving a quiet dotted rule under it.
 */
export function thinking(element: HTMLElement, options: ThinkingOptions = {}): ThinkingHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  const styles = styleKeeper();
  const original = [...element.childNodes];
  let phase: ThinkingState = 'done', started = 0, answered = -1e9, settled = -1e9, run = 0, written = '';
  let surface: Surface | null = null;
  const look = (): GlyphFieldOptions => ({ mark: 'dot', cellSize: 5, cellAspect: 1, dotScale: 0.86, contrast: 1.2, ...state.current.look });
  const noise = document.createElement('canvas');
  const lineHeight = () => {
    const style = getComputedStyle(element), lh = parseFloat(style.lineHeight);
    return Number.isFinite(lh) && lh > 0 ? lh : (parseFloat(style.fontSize) || 15) * 1.45;
  };
  const label = (text: string) => { if (state.current.label) state.current.label.textContent = text; };

  surface = mountSurface({
    host: element,
    layer: 'under',
    look,
    ink: () => state.current.ink ?? '--ascii-ink',
    reducedMotion: () => state.current.reducedMotion,
    onFail: () => { surface = null; },
    paint: ({ pen, w, h, now, still }) => {
      const o = state.current, lh = lineHeight();
      const bands = phase === 'thinking' ? 1 : still ? 0 : 1 - easeOut((now - answered) / FADE_MS);
      const rule = phase !== 'done' || !o.rule ? 0 : still ? 0.7 : 0.7 * easeOut((now - settled - RULE_DELAY) / FADE_MS);
      const t = still ? 0 : (now - started) / 1000;
      if (bands > 0) {
        const nw = Math.max(2, Math.round(w / 10)), nh = Math.max(2, Math.round(h / 10));
        if (noise.width !== nw || noise.height !== nh) { noise.width = nw; noise.height = nh; }
        driftNoise(noise, 1.7 + t * 0.45, 0.15);
        pen.save();
        pen.beginPath();
        for (let i = 0; i < o.lines; i++) {
          const width = i === o.lines - 1 && o.lines > 1 ? 0.62 : 0.92 - 0.06 * hash(i, 2);
          pen.rect(0, i * lh + lh * 0.22, w * width, lh * 0.56);
        }
        pen.clip();
        pen.globalAlpha = bands;
        pen.imageSmoothingEnabled = true;
        // The noise is faint by design; laid on twice, its peaks reach the larger dots.
        pen.globalCompositeOperation = 'lighter';
        pen.drawImage(noise, 0, 0, w, h);
        pen.drawImage(noise, 0, 0, w, h);
        // A floor, so every band reads as a line of dots even where the noise is quiet.
        pen.fillStyle = 'rgb(46 46 46)';
        pen.fillRect(0, 0, w, h);
        pen.restore();
      }
      if (rule > 0) {
        pen.globalAlpha = rule;
        pen.fillStyle = '#fff';
        pen.fillRect(0, h - 5, w, 4);
        pen.globalAlpha = 1;
      }
      if (bands > 0 || rule > 0) {
        // Both fade out to the right, so the band never ends on a hard edge.
        const fade = pen.createLinearGradient(w * 0.6, 0, w * 0.98, 0);
        fade.addColorStop(0, '#fff'); fade.addColorStop(1, '#000');
        pen.globalCompositeOperation = 'multiply';
        pen.fillStyle = fade;
        pen.fillRect(0, 0, w, h);
        pen.globalCompositeOperation = 'source-over';
      }
      return phase === 'thinking' || (!still && (now - answered < FADE_MS || (phase === 'done' && now - settled < RULE_DELAY + FADE_MS)));
    },
  });
  const words = document.createElement('span');
  const think = () => {
    run++;
    phase = 'thinking';
    started = performance.now();
    answered = settled = -1e9;
    written = '';
    words.replaceChildren();
    element.replaceChildren(words);
    if (surface) element.appendChild(surface.canvas);
    styles.set(element, 'min-height', `${Math.round(state.current.lines * lineHeight())}px`);
    element.setAttribute('aria-busy', 'true');
    label(state.current.labels?.thinking ?? thinkingLabel);
    surface?.kick();
  };

  /** Adds whole words as spans that fade in one after another. */
  let shown = 0, firstAt = 0;
  const addWords = (text: string) => {
    const fade = !!surface && !surface.still();
    for (const part of text.match(/\s+|\S+/g) ?? []) {
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

  const stream = async (text: string | AsyncIterable<string>) => {
    if (phase !== 'thinking') think();
    const id = run;
    shown = 0;
    let pending = '';
    const begin = () => {
      if (phase !== 'thinking') return;
      phase = 'streaming';
      answered = firstAt = performance.now();
      styles.set(element, 'min-height', '');
      label((state.current.labels?.done ?? doneLabel)(Math.max(1, Math.round((answered - started) / 1000))));
      surface?.kick();
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
    if (typeof text === 'string') feed(text, true);
    else {
      for await (const chunk of text) { if (id !== run) return; feed(chunk, false); }
      if (id !== run) return;
      feed('', true);
    }
    begin();
    const still = !surface || surface.still();
    const left = still ? 0 : Math.max(0, shown * state.current.stagger - (performance.now() - firstAt)) + WORD_MS;
    await new Promise(resolve => setTimeout(resolve, left));
    if (id !== run) return;
    phase = 'done';
    settled = performance.now();
    element.setAttribute('aria-busy', 'false');
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
  });
}

export const THINKING_DEFAULTS = DEFAULTS;
