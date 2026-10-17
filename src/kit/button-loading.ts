import type { GlyphFieldOptions } from '../field';
import { isGlyphFieldSupported } from '../field';
import { handle, hash, mountSurface, srOnly, styleKeeper, type KitHandle, type KitOptions, type Surface } from './core';

export interface ButtonLoadingOptions extends KitOptions {
  /** The idle label. Default: the label element's text. */
  text?: string;
  /** The element holding the label text. Default: the button itself. Pass it when the button also holds an icon. */
  label?: HTMLElement;
  /** Put a check before the success label. Default true. */
  check?: boolean;
  /** Shake the button on failure (skipped under reduced motion). Default true. */
  shake?: boolean;
  /** A live region to announce each state in. Optional. */
  announce?: HTMLElement;
}

export type ButtonState = 'idle' | 'loading' | 'success' | 'error';

export interface ButtonLoadingHandle extends KitHandle<ButtonLoadingOptions> {
  /** Busy: the label decodes in, then a wave cycles each letter through glyphs until the next call. */
  start(label?: string): void;
  /** Decodes in the success label (with a check). */
  succeed(label?: string): void;
  /** Decodes in the failure label, with a short shake. */
  fail(label?: string): void;
  /** Back to the idle label. */
  reset(label?: string): void;
  readonly state: ButtonState;
}

const DEFAULTS = { check: true, shake: true };
const CHARSET = ' .:-=+*#%@', RAMP = 9;
const STAGGER = 24, SCRAMBLE = 170, PERIOD = 1250, CREST = 0.3;

/**
 * Cell geometry for a label: whole device pixels, 2:3 cells, and the device height a multiple of three, so a source of
 * two by three texels per cell lands every cell on its own texels.
 */
export function letterCells(fontSize: number, ratio: number) {
  const height = Math.max(3, 3 * Math.round((fontSize * ratio) / 3)), width = (height / 3) * 2;
  return { cw: width / ratio, ch: height / ratio, cellSize: height / ratio };
}

/** The glyph index (0 is none) for letter `i` at `k` ms into a state whose label decodes in, then waves while loading. */
export function letterGlyph(i: number, k: number, length: number, loading: boolean, still: boolean, seed = 0) {
  const decodeEnd = length * STAGGER + SCRAMBLE;
  if (k < decodeEnd) {
    const u = (k - i * STAGGER) / SCRAMBLE;
    return u < 1 ? 1 + Math.floor(hash(i + seed, Math.floor(k / 46)) * (u < 0 ? 3 : RAMP)) : 0;
  }
  if (!loading || still) return 0;
  const p = ((((k - decodeEnd) / PERIOD - i * 0.07) % 1) + 1) % 1;
  return p < CREST ? 1 + Math.round((RAMP - 1) * Math.sin(Math.PI * (p / CREST))) : 0;
}

/**
 * A button whose label cycles through characters while its request runs, then decodes into the result.
 * The width never changes: it grows to the widest label it has shown and holds there until `destroy()`.
 */
export function buttonLoading(button: HTMLElement, options: ButtonLoadingOptions = {}): ButtonLoadingHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  const styles = styleKeeper();
  const label = state.current.label ?? button;
  const idle = state.current.text ?? (label.textContent ?? '').trim();
  const original = [...label.childNodes];
  let phase: ButtonState = 'idle', text = idle, at = -1e9, widest = 0, surface: Surface | null = null;
  let cell = { cw: 9, ch: 15, cellSize: 15 };
  const spoken = srOnly(idle);
  const letters = document.createElement('span');

  const measure = () => {
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
    cell = letterCells(parseFloat(getComputedStyle(label).fontSize) || 15, ratio);
  };
  const look = (): GlyphFieldOptions => ({
    mark: 'glyph', charset: CHARSET, font: '"Geist Mono", ui-monospace, monospace', fontWeight: 500,
    cellSize: cell.cellSize, cellAspect: 2 / 3, glyphScale: 0.94, ...state.current.look,
  });
  const layout = () => {
    const shown = [...text];
    letters.replaceChildren(...shown.map((ch, i) => {
      const span = document.createElement('span');
      span.textContent = ch;
      span.setAttribute('style', `position:absolute;top:0;left:${i * cell.cw}px;width:${cell.cw}px;height:${cell.ch}px;line-height:${cell.ch}px;text-align:center`);
      return span;
    }));
    if (surface) letters.appendChild(surface.canvas);
    letters.style.width = `${shown.length * cell.cw}px`;
    letters.style.height = `${cell.ch}px`;
    spoken.textContent = text;
    // Hold the widest width seen so far, so the button never shrinks between states.
    widest = Math.max(widest, button.offsetWidth);
    if (widest) styles.set(button, 'min-width', `${widest}px`);
  };

  const supported = typeof document !== 'undefined' && isGlyphFieldSupported();
  if (supported) {
    measure();
    letters.setAttribute('aria-hidden', 'true');
    letters.setAttribute('style', 'display:inline-block;vertical-align:middle;position:relative;white-space:pre');
    label.replaceChildren(spoken, letters);
    layout();
  }
  surface = !supported ? null : mountSurface({
    host: letters,
    look,
    ink: () => state.current.ink ?? getComputedStyle(label).color,
    reducedMotion: () => state.current.reducedMotion,
    // Two by three texels per cell, so the cell centre samples only its own texels.
    resolution: (w, h) => [Math.max(2, Math.round(w / cell.cw) * 2), Math.max(3, Math.round(h / cell.ch) * 3)],
    onFail: () => { surface = null; label.replaceChildren(...original); label.textContent = text; styles.restore(); },
    paint: ({ pen, now, still }) => {
      const spans = letters.children as HTMLCollectionOf<HTMLElement>, k = now - at;
      let busy = phase === 'loading' && !still;
      for (let i = 0; i < spans.length; i++) {
        const g = still ? 0 : letterGlyph(i, k, spans.length, phase === 'loading', still, text.length);
        if (k < spans.length * STAGGER + SCRAMBLE) busy = true;
        const blank = text[i] === ' ';
        spans[i].style.visibility = g && !blank ? 'hidden' : '';
        if (!g || blank) continue;
        const v = Math.round((g / RAMP) * 255);
        pen.fillStyle = `rgb(${v} ${v} ${v})`;
        pen.fillRect(i * 2, 0, 2, 3);
      }
      return busy;
    },
  });

  if (supported && !surface) { label.replaceChildren(...original); styles.restore(); }

  const show = (next: ButtonState, value: string) => {
    phase = next;
    text = next === 'success' && state.current.check && surface ? `✓ ${value}` : value;
    button.dataset.state = next;
    if (next === 'loading') button.setAttribute('aria-busy', 'true'); else button.removeAttribute('aria-busy');
    if (state.current.announce) state.current.announce.textContent = next === 'idle' ? '' : value;
    if (!surface) { label.textContent = value; return; }
    at = performance.now();
    layout();
    surface.kick();
    if (next === 'error' && state.current.shake && !surface.still() && typeof button.animate === 'function') {
      button.animate([{ translate: '0' }, { translate: '-4px 0' }, { translate: '4px 0' }, { translate: '-2px 0' }, { translate: '0' }], { duration: 280, easing: 'cubic-bezier(.16, 1, .3, 1)' });
    }
  };

  return handle(() => surface, state, () => { if (!surface) return; measure(); layout(); surface.refresh(); }, {
    start(value = `${idle}…`) { show('loading', value); },
    succeed(value = 'Done') { show('success', value); },
    fail(value = 'Retry') { show('error', value); },
    reset(value = idle) { show('idle', value); },
    get state() { return phase; },
  }, () => {
    if (surface) label.replaceChildren(...original);
    delete button.dataset.state;
    button.removeAttribute('aria-busy');
    styles.restore();
  });
}

export const BUTTON_LOADING_DEFAULTS = DEFAULTS;
