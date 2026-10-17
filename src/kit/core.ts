import { isGlyphFieldSupported, type GlyphField, type GlyphFieldOptions } from '../field';
import { disposeKit, liveField, poster, setPosterSource } from './core-live';

/** Options every kit component takes. */
export interface KitOptions {
  /** The field's ink: a CSS colour, a custom property name (`--brand`) or `var(--brand, #888)`. Re-read when the theme changes. */
  ink?: string;
  /** Raw glyph-field settings layered over the component's own look, such as `charset`, `cellSize` or `font`. */
  look?: GlyphFieldOptions;
  /** `true` or `false` overrides the visitor's `prefers-reduced-motion`; leave it unset to follow it. */
  reducedMotion?: boolean;
  /**
   * Mount the field only once the element comes within half a viewport of the screen, and release it (freeing its WebGL context)
   * beyond one. The handle keeps working while released. `false` mounts at once, wherever the element is. Default true.
   */
  lazy?: boolean;
  /** A still image under the field: shown until the first GPU frame, while the field is released, and in its place without WebGL. */
  poster?: string;
  /** `false` keeps this field's own characters when `setGlobalLook` re-skins the page. Default true. */
  globalLook?: boolean;
}

/** The handle every kit component returns. Component handles add their own methods. */
export interface KitHandle<O> {
  /** False when WebGL2 is missing (or the field failed): the HTML is left as it was and drawing methods do nothing. */
  readonly supported: boolean;
  /**
   * The underlying GPU field, for anything the kit does not cover. `null` in the fallback. It stays the same object while the
   * field is released off screen; `update`, `setSource`, `play` and `pause` made meanwhile apply when it mounts again.
   */
  readonly field: GlyphField | null;
  /** Merges options (`look` key by key); the next frame draws with them. */
  update(options: Partial<O>): void;
  /** Resumes motion after `pause()`. */
  play(): void;
  /** Holds the current frame and stops drawing. */
  pause(): void;
  /** Removes the canvas, listeners and observers, and restores the element's own markup and styles. */
  destroy(): void;
}

export interface Box { x: number; y: number; w: number; h: number }

export interface PaintFrame {
  /** The source canvas, already cleared to black. White is the densest glyph; in source colour mode hue colours the glyph. */
  pen: CanvasRenderingContext2D;
  /** Source size in pixels. */
  width: number;
  height: number;
  /** Canvas size in CSS pixels, and source pixels per CSS pixel. */
  w: number;
  h: number;
  scale: number;
  now: number;
  /** Reduced motion: paint the settled state; the loop stops after this frame. */
  still: boolean;
  /** The page behind the element is dark (judged from the element's text colour). */
  dark: boolean;
  /** An element's layout box in the canvas's CSS pixels, unaffected by transforms on an ancestor. */
  box(element: Element): Box;
}

export interface SurfaceConfig {
  host: HTMLElement;
  /** The component's options, for `lazy`, `poster` and `globalLook`. Pass the same object to `handle()`. */
  kit?: { current: KitOptions };
  /** The field look; ink comes from `ink`, so leave it out here. */
  look: () => GlyphFieldOptions;
  /** CSS colour or custom property for the field ink, given whether the ground is dark. */
  ink: (dark: boolean) => string | undefined;
  /** `over` draws above the element's content; `under` sits above its background but below its content. */
  layer?: 'over' | 'under';
  /** CSS pixels the canvas reaches past the element on every side. */
  outset?: number;
  /** Source pixels per CSS pixel (default 1), or a fixed source size from the canvas's CSS size. */
  resolution?: number | ((w: number, h: number) => [number, number]);
  /** Paints one frame; return true while more frames are needed. */
  paint: (frame: PaintFrame) => boolean;
  reducedMotion: () => boolean | undefined;
  /** The field failed after mounting; the surface has already removed itself. */
  onFail?: () => void;
  /** Called when the theme changes, after the ink is re-read. */
  onTheme?: () => void;
}

export interface Surface {
  /** The same object across release and remount. */
  readonly field: GlyphField;
  /** The current canvas. A remount swaps in a copy of it, with its attributes and inline styles, in the same place. */
  readonly canvas: HTMLCanvasElement;
  /** True while the field holds a WebGL context. */
  readonly live: boolean;
  /** Starts the frame loop if it is not running. */
  kick(): void;
  /** Re-reads the look and ink, then kicks. */
  refresh(): void;
  still(): boolean;
  dark(): boolean;
  box(element: Element): Box;
  play(): void;
  pause(): void;
  destroy(): void;
}

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const hash = (a: number, b: number) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
export const easeOut = (t: number, power = 3) => 1 - (1 - clamp(t)) ** power;
export const smoothstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
/** cubic-bezier(.16, 1, .3, 1), the house curve, solved by bisection. */
export const house = (x: number) => {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const axis = (t: number, a: number, b: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  let lo = 0, hi = 1, t = x;
  for (let i = 0; i < 22; i++) { t = (lo + hi) / 2; if (axis(t, 0.16, 0.3) < x) lo = t; else hi = t; }
  return axis(t, 1, 1);
};

export const prefersReduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const reducedFrom = (option: boolean | undefined) => option ?? prefersReduced();

/** The base look shared by every kit field: transparent, still, no pointer response, and the source read as is. */
export const BASE_LOOK: GlyphFieldOptions = {
  scene: 'none', background: 'transparent', color: 'ink', levels: 'none', fit: 'cover', focus: { x: 0.5, y: 0.5 },
  vignette: 0, drift: 0, hover: 'none', shade: 0, contrast: 1, brightness: 0, gamma: 1, maxPixelRatio: 2, clear: false,
};

let probe: CanvasRenderingContext2D | null | undefined;
/** Any CSS colour as #rrggbb, or null. Custom properties are read from `from`. */
export function resolveColor(token: string | undefined, from: Element, fallback?: string): string | null {
  let value = (token ?? '').trim();
  const custom = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(value);
  if (custom) value = readVar(from, custom[1]) || (custom[2] ?? '').trim();
  else if (value.startsWith('--')) value = readVar(from, value);
  if (!value) return fallback ? resolveColor(fallback, from) : null;
  if (/^#[\da-f]{6}$/i.test(value)) return value.toLowerCase();
  if (/^#[\da-f]{3}$/i.test(value)) return `#${[...value.slice(1)].map(c => c + c).join('')}`.toLowerCase();
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(value);
  if (rgb) return toHex([+rgb[1], +rgb[2], +rgb[3]]);
  // Anything else (named colours, oklch, color-mix): let a 1x1 canvas resolve it to pixels.
  if (probe === undefined) {
    try { probe = typeof document === 'undefined' ? null : Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true }); }
    catch { probe = null; }
  }
  if (!probe) return fallback ? resolveColor(fallback, from) : null;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = '#000';
  probe.fillStyle = value;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
  return toHex([r, g, b]);
}
const readVar = (from: Element, name: string) => (typeof getComputedStyle === 'function' ? getComputedStyle(from).getPropertyValue(name).trim() : '');
export const toHex = (rgb: number[]) => `#${rgb.map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')}`;
export const hexRgb = (hex: string) => { const n = parseInt(hex.slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const mixHex = (a: string, b: string, k: number) => { const x = hexRgb(a), y = hexRgb(b); return toHex(x.map((v, i) => v + (y[i] - v) * k)); };

/** True when the element sits on a dark ground: its own opaque background if it has one, else light text. */
export function isDark(element: Element) {
  const style = typeof getComputedStyle === 'function' ? getComputedStyle(element) : null;
  // A video player or a dark card on a light page has a dark ground of its own, whatever colour its text inherits.
  const ground = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?/i.exec(style?.backgroundColor ?? '');
  if (ground) {
    const alpha = ground[4] === undefined ? 1 : ground[4].endsWith('%') ? parseFloat(ground[4]) / 100 : parseFloat(ground[4]);
    if (alpha >= 0.5) return 0.2126 * +ground[1] + 0.7152 * +ground[2] + 0.0722 * +ground[3] < 128;
  }
  const color = resolveColor(style?.color ?? '', element);
  if (!color) return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  const [r, g, b] = hexRgb(color);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140;
}

/** Saves inline styles before the kit changes them, and puts them back. */
export function styleKeeper() {
  const saved: [HTMLElement, string, string][] = [];
  return {
    set(element: HTMLElement, property: string, value: string) {
      if (!saved.some(([el, prop]) => el === element && prop === property)) saved.push([element, property, element.style.getPropertyValue(property)]);
      element.style.setProperty(property, value);
    },
    restore() {
      for (const [element, property, value] of saved.reverse()) {
        if (value) element.style.setProperty(property, value); else element.style.removeProperty(property);
      }
      saved.length = 0;
    },
  };
}

/** Visually hidden but read by assistive technology. */
export function srOnly(text = '', live = false) {
  const span = document.createElement('span');
  span.setAttribute('style', 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0');
  if (live) span.setAttribute('aria-live', 'polite');
  span.textContent = text;
  return span;
}

/** An element's box relative to `root`, in `root`'s own CSS pixels. */
export function boxIn(root: Element, element: Element): Box {
  const r = root.getBoundingClientRect(), b = element.getBoundingClientRect();
  const s = r.width / ((root as HTMLElement).offsetWidth || r.width || 1) || 1;
  return { x: (b.left - r.left) / s, y: (b.top - r.top) / s, w: b.width / s, h: b.height / s };
}

/** Merges kit options; `look` merges key by key, so tuning one setting keeps the others. A look key set to `undefined` is removed. */
export function mergeOptions<O>(current: O, next: Partial<O>): O {
  const out = { ...current, ...next } as O & { look?: GlyphFieldOptions };
  const was = (current as { look?: GlyphFieldOptions }).look, add = (next as { look?: GlyphFieldOptions }).look;
  if (add) out.look = Object.fromEntries(Object.entries({ ...was, ...add }).filter(([, value]) => value !== undefined)) as GlyphFieldOptions;
  return out;
}

const settledSources = new WeakMap<HTMLCanvasElement, () => HTMLCanvasElement | null>();
/** A kit canvas's settled frame, white on black at the canvas's own place, or null for any other canvas. */
export const settledSource = (canvas: HTMLCanvasElement) => settledSources.get(canvas)?.() ?? null;

/**
 * Mounts a field over or inside `host` and feeds it a canvas painted each frame. Returns null without WebGL2 or when
 * mounting fails, having changed nothing (but a `poster`), so the caller can keep its HTML as the fallback. The field mounts near
 * the viewport and is released far from it (see `KitOptions.lazy`); every frame paints the component's current state, so a remount
 * picks up where the component is.
 */
export function mountSurface(config: SurfaceConfig): Surface | null {
  const { host, layer = 'over', outset = 0, kit } = config;
  if (typeof document === 'undefined') return null;
  const place = `position:absolute;left:${-outset}px;top:${-outset}px;width:calc(100% + ${outset * 2}px);height:calc(100% + ${outset * 2}px);pointer-events:none;z-index:${layer === 'under' ? -1 : 'auto'}`;
  if (!isGlyphFieldSupported()) {
    if (kit?.current.poster) poster(host, kit.current.poster, place, kit);
    return null;
  }
  const styles = styleKeeper();
  const first = document.createElement('canvas');
  const art = document.createElement('canvas');
  const pen = art.getContext('2d');
  if (!pen) return null;

  const computed = getComputedStyle(host);
  if (computed.position === 'static') styles.set(host, 'position', 'relative');
  if (layer === 'under') styles.set(host, 'isolation', 'isolate');
  first.setAttribute('aria-hidden', 'true');
  first.dataset.asciiKit = '';
  const css = first.style;
  css.position = 'absolute';
  css.left = css.top = `${-outset}px`;
  css.width = css.height = `calc(100% + ${outset * 2}px)`;
  css.pointerEvents = 'none';
  css.zIndex = layer === 'under' ? '-1' : '';
  host.appendChild(first);
  const followRadius = () => {
    const style = getComputedStyle(host);
    const radius = (value: string) => (outset && /^[\d.]+px$/.test(value) ? `${parseFloat(value) + outset}px` : value);
    live.canvas.style.borderRadius = [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius].map(radius).join(' ');
  };

  let dark = isDark(host);
  // An unset token falls back to the host's own text colour, which already follows the page's design tokens.
  const ink = () => resolveColor(config.ink(dark), host) ?? resolveColor(getComputedStyle(host).color, host) ?? (dark ? '#d8d6cf' : '#1d1d1b');
  let raf = 0, paused = false, visible = true, destroyed = false;
  const live = liveField({
    host, canvas: first, kit, place,
    options: () => ({ ...BASE_LOOK, ...config.look(), ink: ink(), interactionTarget: host, label: '' }),
    onMount: (mounted, canvas) => {
      settledSources.set(canvas, settled);
      canvas.removeAttribute('role');
      canvas.removeAttribute('aria-label');
      void mounted.ready.then(kick, () => {});
      kick();
    },
    onRelease: () => { if (raf) cancelAnimationFrame(raf); raf = 0; },
    onFail: () => { teardown(); config.onFail?.(); },
  });
  const field = live.field;
  followRadius();

  const still = () => !!(config.reducedMotion() ?? prefersReduced());
  const box = (element: Element) => boxIn(live.canvas, element);
  const paintNow = (now: number) => {
    const canvas = live.canvas;
    const w = Math.max(1, canvas.clientWidth || host.clientWidth + outset * 2), h = Math.max(1, canvas.clientHeight || host.clientHeight + outset * 2);
    const res = config.resolution ?? 1;
    const [sw, sh] = typeof res === 'function' ? res(w, h) : [Math.max(1, Math.round(w * res)), Math.max(1, Math.round(h * res))];
    if (art.width !== sw || art.height !== sh) { art.width = sw; art.height = sh; }
    pen.setTransform(1, 0, 0, 1, 0, 0);
    pen.globalAlpha = 1; pen.globalCompositeOperation = 'source-over'; pen.filter = 'none';
    pen.fillStyle = '#000';
    pen.fillRect(0, 0, sw, sh);
    let more = false;
    try {
      more = config.paint({ pen, width: sw, height: sh, w, h, scale: sw / w, now, still: still(), dark, box });
    } catch (error) {
      if (typeof console !== 'undefined') console.error(error);
    }
    // The canvas goes in directly and the field draws in the same task, so HTML and field never disagree for a frame.
    void field.setSource(art).then(() => { if (!destroyed) field.redraw(); });
    return more;
  };
  /** The component's settled frame as a fresh source canvas, for a parent that draws this field into its own (pageDissolve). */
  function settled() {
    const canvas = live.canvas;
    const w = Math.max(1, canvas.clientWidth || host.clientWidth + outset * 2), h = Math.max(1, canvas.clientHeight || host.clientHeight + outset * 2);
    const res = config.resolution ?? 1;
    const [sw, sh] = typeof res === 'function' ? res(w, h) : [Math.max(1, Math.round(w * res)), Math.max(1, Math.round(h * res))];
    const out = document.createElement('canvas');
    out.width = sw; out.height = sh;
    const p = out.getContext('2d');
    if (!p) return null;
    p.fillStyle = '#000'; p.fillRect(0, 0, sw, sh);
    try { config.paint({ pen: p, width: sw, height: sh, w, h, scale: sw / w, now: performance.now(), still: true, dark, box }); } catch { return null; }
    return out;
  }
  settledSources.set(first, settled);
  const step = (now: number) => {
    raf = 0;
    if (destroyed || paused || !live.live) return;
    const more = paintNow(now);
    if (more && !still() && visible && !(typeof document !== 'undefined' && document.hidden)) raf = requestAnimationFrame(step);
  };
  function kick() { if (!raf && !destroyed && !paused && live.live) raf = requestAnimationFrame(step); }

  // A resize clears the canvas; repaint in the same frame so a size change (a label growing) never shows a blank frame.
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    followRadius(); field.resize();
    if (live.live && !destroyed && !paused) paintNow(performance.now());
    kick();
  }) : null;
  resize?.observe(host);
  const view = typeof IntersectionObserver === 'function' ? new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) kick();
  }, { rootMargin: '64px' }) : null;
  view?.observe(host);
  const onVisibility = () => { if (!document.hidden) kick(); };
  document.addEventListener('visibilitychange', onVisibility);

  let themeFrame = 0;
  const retheme = () => {
    if (themeFrame || destroyed) return;
    themeFrame = requestAnimationFrame(() => {
      themeFrame = 0;
      if (destroyed) return;
      dark = isDark(host);
      field.update({ ink: ink() });
      config.onTheme?.();
      kick();
    });
  };
  const scheme = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  scheme?.addEventListener?.('change', retheme);
  const motion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  motion?.addEventListener?.('change', kick);
  // Class or attribute themes (`.dark`, `data-theme`) change no media query, so watch the root for them.
  const themes = typeof MutationObserver === 'function' ? new MutationObserver(retheme) : null;
  for (const root of [document.documentElement, document.body]) if (root) themes?.observe(root, { attributes: true, attributeFilter: ['class', 'data-theme', 'data-mode', 'style'] });

  function teardown() {
    if (destroyed) return;
    destroyed = true;
    if (raf) cancelAnimationFrame(raf);
    if (themeFrame) cancelAnimationFrame(themeFrame);
    raf = themeFrame = 0;
    resize?.disconnect();
    view?.disconnect();
    themes?.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    scheme?.removeEventListener?.('change', retheme);
    motion?.removeEventListener?.('change', kick);
    live.destroy();
    styles.restore();
    art.width = art.height = 1;
  }

  live.start();
  if (live.failed) { teardown(); return null; }
  return {
    field,
    get canvas() { return live.canvas; },
    get live() { return live.live; },
    kick,
    refresh() { if (destroyed) return; dark = isDark(host); field.update({ ...BASE_LOOK, ...config.look(), ink: ink() }); kick(); },
    still,
    dark: () => dark,
    box,
    play() { if (!paused) return; paused = false; field.play(); kick(); },
    pause() { paused = true; if (raf) cancelAnimationFrame(raf); raf = 0; field.pause(); },
    destroy: teardown,
  };
}

/** Builds the handle shape every component shares; `extra` adds the component's own methods. */
export function handle<O, X extends object>(surface: () => Surface | null, options: { current: O }, apply: (next: O) => void, extra: X, cleanup: () => void = () => {}): KitHandle<O> & NoInfer<X> {
  let destroyed = false;
  const base: KitHandle<O> = {
    get supported() { return !!surface() && !destroyed; },
    get field() { return destroyed ? null : surface()?.field ?? null; },
    update(next) {
      if (destroyed) return;
      options.current = mergeOptions(options.current, next);
      const still = (next as { poster?: string }).poster;
      if (still) setPosterSource(options, still);
      apply(options.current);
    },
    play() { if (!destroyed) surface()?.play(); },
    pause() { if (!destroyed) surface()?.pause(); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      surface()?.destroy();
      disposeKit(options);
      cleanup();
    },
  };
  return Object.defineProperties(extra, Object.getOwnPropertyDescriptors(base)) as KitHandle<O> & X;
}
