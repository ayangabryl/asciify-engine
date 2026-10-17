import type { GlyphFieldOptions } from '../field';
import { isGlyphFieldSupported } from '../field';
import { handle, hash, mountSurface, srOnly, styleKeeper, type KitHandle, type KitOptions, type Surface } from './core';

export interface ButtonLoadingOptions extends KitOptions {
  /** The idle label. Default: the label element's text. */
  text?: string;
  /** The element holding the label text. Default: the button itself. Pass it when the button also holds an icon. */
  label?: HTMLElement;
  /** Put a check (a crisp SVG) before the success label. Default true. */
  check?: boolean;
  /** Shake the button on failure (skipped under reduced motion). Default true. */
  shake?: boolean;
  /** A live region to announce each state in. Optional. */
  announce?: HTMLElement;
  /** An icon-only button's icon. Default: the first `svg` when the button has no text. One breathing cell stands in for it while loading, and a check while it shows success. */
  icon?: Element | null;
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

const EASE = 'cubic-bezier(.16, 1, .3, 1)';
const CHECK = '<svg viewBox="0 0 24 24" width="1.1em" height="1.1em" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

/**
 * A button whose label cycles through characters while its request runs, then decodes into the result.
 * The width never changes: it grows to the widest label it has shown and holds there until `destroy()`.
 * An icon-only button keeps its icon: while loading one cell over it breathes through the glyphs, and success swaps in a check.
 */
export function buttonLoading(button: HTMLElement, options: ButtonLoadingOptions = {}): ButtonLoadingHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  const styles = styleKeeper();
  const label = state.current.label ?? button;
  const idle = state.current.text ?? (label.textContent ?? '').trim();
  const original = [...label.childNodes];
  const icon = state.current.icon !== undefined ? state.current.icon : idle ? null : (button.querySelector('svg') as Element | null);
  const named = button.getAttribute('aria-label');
  let phase: ButtonState = 'idle', text = idle, at = -1e9, widest = 0, surface: Surface | null = null;
  let cell = { cw: 9, ch: 15, cellSize: 15 };
  const spoken = srOnly(idle);
  const letters = document.createElement('span');
  // A crisp check: before the success label, or in place of the icon.
  const check = document.createElement('span');
  check.setAttribute('aria-hidden', 'true');
  check.dataset.asciiCheck = '';
  check.innerHTML = CHECK;

  const measure = () => {
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
    cell = letterCells(parseFloat(getComputedStyle(label).fontSize) || 15, ratio);
  };
  const look = (): GlyphFieldOptions => ({
    mark: 'glyph', charset: CHARSET, font: '"Geist Mono", ui-monospace, monospace', fontWeight: 500,
    cellSize: cell.cellSize, cellAspect: 2 / 3, glyphScale: 0.94, ...state.current.look,
  });
  const showCheck = (on: boolean, quiet: boolean) => {
    const fade = quiet ? 'none' : `opacity 160ms ${EASE} ${on ? 120 : 0}ms, scale 240ms ${EASE} ${on ? 120 : 0}ms`;
    check.style.transition = fade;
    check.style.opacity = on ? '1' : '0';
    check.style.scale = on ? '1' : '.5';
    if (!icon) { check.style.width = on ? '1.1em' : '0'; check.style.marginRight = on ? '.45em' : '0'; }
    if (icon && 'style' in icon) {
      const away = phase !== 'idle' && phase !== 'error';
      styles.set(icon as HTMLElement, 'transition', fade.replace(/ 120ms/g, ''));
      styles.set(icon as HTMLElement, 'opacity', away ? (quiet && phase === 'loading' ? '.4' : '0') : '1');
      styles.set(icon as HTMLElement, 'scale', away && !quiet ? '.6' : '1');
    }
  };
  const layout = () => {
    if (icon) {
      letters.replaceChildren();
      if (surface) letters.appendChild(surface.canvas);
      letters.style.width = `${cell.cw}px`;
      letters.style.height = `${cell.ch}px`;
      return;
    }
    const shown = [...text];
    // The canvas stays where it is; only the letter spans are swapped, so the field never leaves the page.
    for (const old of [...letters.children]) if (old.tagName === 'SPAN') old.remove();
    const canvas = surface && surface.canvas.parentElement === letters ? surface.canvas : null;
    for (const [i, ch] of shown.entries()) {
      const span = document.createElement('span');
      span.textContent = ch;
      span.setAttribute('style', `position:absolute;top:0;left:${i * cell.cw}px;width:${cell.cw}px;height:${cell.ch}px;line-height:${cell.ch}px;text-align:center`);
      if (canvas) letters.insertBefore(span, canvas); else letters.appendChild(span);
    }
    if (surface && !canvas) letters.appendChild(surface.canvas);
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
    const centred = 'position:absolute;left:50%;top:50%;translate:-50% -50%;pointer-events:none';
    if (icon) {
      if (getComputedStyle(button).position === 'static') styles.set(button, 'position', 'relative');
      letters.setAttribute('style', centred);
      check.setAttribute('style', `${centred};display:grid;place-items:center;opacity:0;scale:.5`);
      button.appendChild(letters); button.appendChild(check);
    } else {
      letters.setAttribute('style', 'display:inline-block;vertical-align:middle;position:relative;white-space:pre');
      check.setAttribute('style', 'display:inline-grid;place-items:center;vertical-align:middle;overflow:hidden;width:0;opacity:0;scale:.5');
      label.replaceChildren(spoken, check, letters);
    }
    layout();
  }
  surface = !supported ? null : mountSurface({
    host: letters,
    look,
    ink: () => state.current.ink ?? getComputedStyle(label).color,
    kit: state,
    reducedMotion: () => state.current.reducedMotion,
    // Two by three texels per cell, so the cell centre samples only its own texels.
    resolution: (w, h) => [Math.max(2, Math.round(w / cell.cw) * 2), Math.max(3, Math.round(h / cell.ch) * 3)],
    onFail: () => {
      surface = null; letters.remove(); check.remove(); styles.restore();
      if (!icon) { label.replaceChildren(...original); label.textContent = text; }
    },
    paint: ({ pen, now, still }) => {
      const k = now - at;
      if (icon) {
        if (phase !== 'loading' || still) return false;
        const g = 1 + Math.round((RAMP - 1) * (0.5 - 0.5 * Math.cos((2 * Math.PI * k) / 720)));
        const v = Math.round((g / RAMP) * 255);
        pen.fillStyle = `rgb(${v} ${v} ${v})`;
        pen.fillRect(0, 0, 2, 3);
        return true;
      }
      // Only the letters: the field's own canvas sits in the same box and must never be hidden with them.
      const spans = [...letters.children].filter(el => el.tagName === 'SPAN') as HTMLElement[];
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

  if (supported && !surface) { letters.remove(); check.remove(); if (!icon) label.replaceChildren(...original); styles.restore(); }

  const show = (next: ButtonState, value: string) => {
    phase = next;
    text = icon ? '' : value;
    button.dataset.state = next;
    if (next === 'loading') button.setAttribute('aria-busy', 'true'); else button.removeAttribute('aria-busy');
    if (icon && named !== null) button.setAttribute('aria-label', next === 'idle' ? named : value);
    if (state.current.announce) state.current.announce.textContent = next === 'idle' ? '' : value;
    if (!surface) { if (!icon) label.textContent = value; return; }
    at = performance.now();
    showCheck(next === 'success' && (!!icon || !!state.current.check), surface.still());
    layout();
    surface.kick();
    if (next === 'error' && state.current.shake && !surface.still() && typeof button.animate === 'function') {
      button.animate([{ translate: '0' }, { translate: '-4px 0' }, { translate: '4px 0' }, { translate: '-2px 0' }, { translate: '0' }], { duration: 280, easing: EASE });
    }
  };

  return handle(() => surface, state, () => { if (!surface) return; measure(); layout(); surface.refresh(); }, {
    start(value = icon ? named ?? '' : `${idle}…`) { show('loading', value); },
    succeed(value = 'Done') { show('success', value); },
    fail(value = 'Retry') { show('error', value); },
    reset(value = icon ? named ?? '' : idle) { show('idle', value); },
    get state() { return phase; },
  }, () => {
    if (surface) {
      letters.remove(); check.remove();
      if (!icon) label.replaceChildren(...original);
    }
    if (icon && named !== null) button.setAttribute('aria-label', named);
    delete button.dataset.state;
    button.removeAttribute('aria-busy');
    styles.restore();
  });
}

export const BUTTON_LOADING_DEFAULTS = DEFAULTS;
