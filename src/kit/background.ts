import type { GlyphField, GlyphFieldOptions, FieldClearElement, FieldClearRects } from '../field';
import { CHARACTER_SETS, resolveCharset } from '../studio/characters';
import { mergeOptions, prefersReduced, type KitHandle, type KitOptions } from './core';
import { disposeKit, ownsCharset, setPosterSource } from './core-live';
import type { TapStyle } from '../surface/surface-tap';

/** `true` follows the pointer with the preset's own response; the GPU presets also take a named hover. */
export type BackgroundCursor = boolean | 'trail' | 'fluid' | 'lantern';
/** What the GPU presets draw in each cell: characters, or halftone dots sized by the tone. */
export type BackgroundMark = 'glyph' | 'dot';
/** A named ramp from the engine's character sets, `'dots'`, or your own characters from empty to dense. */
export type BackgroundCharset = keyof typeof CHARACTER_SETS | 'dots' | (string & {});

export interface BackgroundOptions extends KitOptions {
  /** The background to draw, imported by name: `import { background, aurora } from 'asciify-engine/kit'`. */
  preset: BackgroundPreset;
  /** The ink, one colour or one per ground. Wins over `color` and `ink`. Default: the preset's graphite for the ground. */
  palette?: string | { light?: string; dark?: string };
  /** One ink for both grounds. Same as `ink`. */
  color?: string;
  /** Peaks, heads and signals, for the presets that draw them. Default: the preset's own accent, or one mixed from the ink. */
  accent?: string;
  /** Animation speed, 0–5. Default: the preset's tuned pace (the /backgrounds page's Speed control). */
  speed?: number;
  /** Character size (dot spacing for `halftone`) in CSS pixels. Default: the preset's own. */
  cellSize?: number;
  /** Characters from empty to dense, or a named set (`blocks`, `braille`, `dots`, ...). Default: the preset's own. */
  charset?: BackgroundCharset;
  /**
   * Pointer response. `false` turns it off: the background never reacts to the pointer. `true` keeps the preset's own response;
   * the GPU presets also take a named hover. Default: on for the presets that answer the cursor.
   */
  cursor?: BackgroundCursor;
  /**
   * How a click answers, for the presets that take one (`shockwave`, `estuary`, `capillary`). `'ring'` is one clean front with
   * the same shape and timing every time: `shockwave`'s default, a crisp ring that expands fast, eases out and fades in about
   * 1.6 s (`estuary` a round glow, `capillary` a round flood). `'surface'` sends a damped wave over the preset's own field: it
   * slows and bends on dense areas and slips through open ones (`estuary`'s and `capillary`'s default).
   */
  tap?: TapStyle;
  /** GPU presets: characters (`'glyph'`) or halftone dots (`'dot'`). Default: the preset's own; a `charset` asks for characters. */
  mark?: BackgroundMark;
  /**
   * What to keep clear. An element: the field fades out in a soft oval round it. Rects (viewport CSS px), or a function
   * returning them: a text-shaped clear map, where the field quiets only right behind each rect (say every line box of a
   * headline and paragraph, from `Range.getClientRects()`) and keeps flowing round and between them, bending a little away
   * from their edges; taps and the cursor's glow pass behind the text, quieted by the same map. A function is read once per
   * drawn frame and again on scroll, so return the same array until something moves.
   */
  clear?: HTMLElement | false | BackgroundClearRects;
  /** Rects only: CSS px kept fully quiet round each rect. Default 8. */
  clearPadding?: number;
  /** Rects only: CSS px the quiet falls off over. Default 28. */
  clearSoftness?: number;
  /** Rects only: how much of the field goes right behind them, 0–1. Default 0.85. */
  clearStrength?: number;
  /** Canvas opacity, 0–1. Default 1 (`fluid` 0.7). */
  opacity?: number;
  /** Ordered dither, 0–1, for the presets that tone with density. Default 0. */
  dither?: number;
  /** `wordField` only: the word drawn. Default `ASCIIFY`. */
  text?: string;
}

/** Content rects to keep clear, in viewport CSS px, or a function that returns them. */
export type BackgroundClearRects = FieldClearRects['rects'];

/** The settings a preset draws with, resolved from the options and the preset's defaults. */
export interface BackgroundSettings {
  speed: number;
  cellSize: number;
  charset: string | undefined;
  cursor: BackgroundCursor;
  /** The asked-for tap, or undefined for the preset's own default. */
  tap: TapStyle | undefined;
  mark: BackgroundMark | undefined;
  clear: HTMLElement | false | BackgroundClearRects;
  /** The text-shaped clear map's tuning, when `clear` is rects. */
  clearMap: { padding: number; softness: number; strength: number };
  dither: number;
  accent: string | undefined;
  text: string;
  look: GlyphFieldOptions | undefined;
}

/** What `background()` hands a preset when it mounts. Settings and ink are read live, so `update()` needs no remount. */
export interface BackgroundContext {
  readonly host: HTMLElement;
  /** The live options, for the GPU presets' lazy mounting, context budget, poster and `globalLook`. */
  readonly kit: { current: KitOptions };
  settings(): BackgroundSettings;
  /** The chosen ink token for the ground, or undefined for the preset's own default. */
  ink(dark: boolean): string | undefined;
  reducedMotion(): boolean | undefined;
  /** The preset failed after mounting and has already removed itself. */
  onFail(): void;
}

export interface BackgroundRun {
  /** The GPU field for field-driven presets; `null` for the canvas templates. */
  readonly field: GlyphField | null;
  readonly canvas: HTMLCanvasElement;
  /** Re-reads settings and ink, and draws. */
  refresh(): void;
  play(): void;
  pause(): void;
  destroy(): void;
}

/** One background. Each is its own export, so a page pays only for the presets it imports. */
export interface BackgroundPreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Default character size in CSS pixels. */
  readonly cellSize: number;
  /** Default speed. */
  readonly speed: number;
  /** Whether the preset answers the pointer by default. */
  readonly cursor: boolean;
  readonly opacity?: number;
  /** Mounts under the host's content; null when it cannot draw (no 2D canvas, or no WebGL2 for GPU presets). */
  mount(context: BackgroundContext): BackgroundRun | null;
}

export interface BackgroundHandle extends KitHandle<BackgroundOptions> {
  /** The preset on screen. */
  readonly preset: BackgroundPreset;
  /** Cross-fades to another preset, keeping your options. Speed and size return to the new preset's defaults unless you set them. */
  setPreset(preset: BackgroundPreset): void;
}

const DOTS = ' ·∙•●';
const FADE_MS = 340;

const num = (value: number | undefined, fallback: number, lo: number, hi: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : fallback;

/** A named set, or your own characters; a custom ramp gains the empty first step the templates expect. */
export function backgroundCharset(charset: string | undefined): string | undefined {
  return charset === 'dots' ? DOTS : resolveCharset(charset);
}

/**
 * An animated ASCII background under an element's content: any of the /backgrounds presets, drawn the same way as on the site.
 * The curated presets drive the GPU glyph field, so they follow `setGlobalLook`; the deprecated canvas templates draw with a 2D canvas.
 */
export function background(element: HTMLElement, options: BackgroundOptions): BackgroundHandle {
  if (!options || !options.preset || typeof options.preset.mount !== 'function') {
    throw new TypeError('background() needs a preset, such as `aurora` imported from asciify-engine/kit.');
  }
  // A poster is a still of one preset: once another is on screen it would cover it whenever a field waits or is released.
  const pictured = options.preset;
  let picture = options.poster;
  const framed = (next: BackgroundOptions): BackgroundOptions => ({ ...next, poster: next.preset === pictured ? picture : undefined });
  const state = { current: framed({ ...options }) };
  ownsCharset(state);
  let run: BackgroundRun | null = null, paused = false, destroyed = false;
  const leaving = new Set<{ run: BackgroundRun; timer: ReturnType<typeof setTimeout> }>();

  const settings = (): BackgroundSettings => {
    const o = state.current, p = o.preset;
    return {
      speed: num(o.speed, p.speed, 0, 5),
      cellSize: num(o.cellSize, p.cellSize, 3, 96),
      charset: backgroundCharset(o.charset),
      // A `look.hover` of 'none' (the components dialog's Cursor: Off) turns the response off for every preset, canvas ones too.
      cursor: o.look?.hover === 'none' ? false : o.cursor ?? p.cursor,
      tap: o.tap === 'ring' || o.tap === 'surface' ? o.tap : undefined,
      mark: o.mark === 'glyph' || o.mark === 'dot' ? o.mark : undefined,
      clear: o.clear ?? false,
      clearMap: { padding: num(o.clearPadding, 8, 0, 400), softness: num(o.clearSoftness, 28, 0, 600), strength: num(o.clearStrength, 0.85, 0, 1) },
      dither: num(o.dither, 0, 0, 1),
      accent: o.accent,
      text: o.text?.trim() || 'ASCIIFY',
      look: o.look,
    };
  };
  const ink = (dark: boolean) => {
    const o = state.current, p = o.palette;
    return (typeof p === 'string' ? p : p?.[dark ? 'dark' : 'light']) ?? o.color ?? o.ink;
  };
  const opacity = () => String(num(state.current.opacity, state.current.preset.opacity ?? 1, 0, 1));
  const still = () => !!(state.current.reducedMotion ?? prefersReduced());

  const mount = (fadeIn: boolean) => {
    let mounted: BackgroundRun | null = null;
    mounted = state.current.preset.mount({
      host: element,
      kit: state,
      settings,
      ink,
      reducedMotion: () => state.current.reducedMotion,
      onFail: () => { if (run === mounted) run = null; },
    });
    if (!mounted) return null;
    const css = mounted.canvas.style;
    if (fadeIn) {
      css.opacity = '0';
      css.transition = `opacity ${FADE_MS - 20}ms cubic-bezier(.16, 1, .3, 1)`;
      void mounted.canvas.offsetWidth;
    }
    css.opacity = opacity();
    if (paused) mounted.pause();
    return mounted;
  };
  // Each run restores the host's position and isolation as it found them, so an outgoing run would strip the incoming one's.
  const own = { position: element.style.getPropertyValue('position'), isolation: element.style.getPropertyValue('isolation') };
  const restyle = (name: 'position' | 'isolation', value: string) => { if (value) element.style.setProperty(name, value); else element.style.removeProperty(name); };
  let swapped = false;
  const leave = (old: BackgroundRun) => {
    swapped = true;
    old.destroy();
    if (!run || destroyed) return;
    if (typeof getComputedStyle === 'function' && getComputedStyle(element).position === 'static') element.style.setProperty('position', 'relative');
    element.style.setProperty('isolation', 'isolate');
  };
  const retire = (old: BackgroundRun) => {
    if (still()) { leave(old); return; }
    old.canvas.style.transition = `opacity ${FADE_MS - 20}ms cubic-bezier(.16, 1, .3, 1)`;
    old.canvas.style.opacity = '0';
    const entry = { run: old, timer: setTimeout(() => { leaving.delete(entry); leave(old); }, FADE_MS) };
    leaving.add(entry);
  };
  const setPreset = (preset: BackgroundPreset) => {
    if (destroyed || !preset || typeof preset.mount !== 'function' || preset === state.current.preset) return;
    state.current = framed({ ...state.current, preset });
    const old = run;
    run = mount(!!old && !still());
    if (old) retire(old);
  };

  run = mount(false);

  const handle: BackgroundHandle = {
    get supported() { return !!run && !destroyed; },
    get field() { return destroyed ? null : run?.field ?? null; },
    get preset() { return state.current.preset; },
    update(next) {
      if (destroyed || !next) return;
      const { preset, ...rest } = next;
      if ('poster' in rest) picture = rest.poster;
      state.current = framed(mergeOptions(state.current, rest));
      if (rest.poster && state.current.poster) setPosterSource(state, rest.poster);
      if (preset && preset !== state.current.preset) { setPreset(preset); return; }
      if (!run) return;
      run.canvas.style.opacity = opacity();
      run.refresh();
    },
    play() { if (destroyed || !paused) return; paused = false; run?.play(); },
    pause() { if (destroyed) return; paused = true; run?.pause(); },
    setPreset,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const entry of leaving) { clearTimeout(entry.timer); entry.run.destroy(); swapped = true; }
      leaving.clear();
      run?.destroy();
      run = null;
      if (swapped) { restyle('position', own.position); restyle('isolation', own.isolation); }
      disposeKit(state);
    },
  };
  return handle;
}

/** The field's `clear` for a preset: a text-shaped map for rects, a soft oval round an element, or the preset's own. */
export function clearOf(s: BackgroundSettings, zone: Omit<FieldClearElement, 'element'>, fallback: GlyphFieldOptions['clear'] = false): GlyphFieldOptions['clear'] {
  const clear = s.clear;
  if (typeof clear === 'function' || Array.isArray(clear)) return { rects: clear as BackgroundClearRects, ...s.clearMap };
  return clear ? { element: clear as HTMLElement, ...zone } : fallback;
}
