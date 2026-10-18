import { isGlyphFieldSupported, type FieldSource, type GlyphField, type GlyphFieldOptions } from '../field';
import { BASE_LOOK, isDark, mergeOptions, prefersReduced, resolveColor, styleKeeper, type KitOptions } from './core';
import { disposeKit, liveField, poster, setPosterSource } from './core-live';

/**
 * A field that lies over or under a whole element and draws its own source or scene. Unlike `mountSurface`, nothing is painted per
 * frame: the field runs its own loop, and the page helpers swap the source only while they animate.
 */
export interface PageFieldConfig {
  host: HTMLElement;
  /** The component's options, for `lazy`, `poster` and `globalLook`. Pass the same object to `pageHandle()`. */
  kit?: { current: KitOptions };
  /** The component draws a poster of its own, so `kit.current.poster` is left to it. */
  ownPoster?: boolean;
  /** A halftone field that takes the global look: what it draws with once a look gives it characters. */
  glyphs?: () => GlyphFieldOptions;
  /** After each mount, the first included. */
  onMount?: () => void;
  /** After the field is released off screen or past the context budget. */
  onRelease?: () => void;
  look: (dark: boolean) => GlyphFieldOptions;
  ink: (dark: boolean) => string | undefined;
  /** `under` sits above the element's background but below its content; `over` above everything. Default `under`. */
  layer?: 'under' | 'over';
  source?: FieldSource | null;
  /** The canvas's accessible name; without one the canvas is hidden from assistive technology. */
  label?: string;
  reducedMotion: () => boolean | undefined;
  /** The field failed after mounting; it has already removed itself. */
  onFail?: () => void;
}

export interface PageField {
  /** The same object across release and remount; the source and settings set meanwhile apply when it mounts again. */
  readonly field: GlyphField;
  /** The current canvas. */
  readonly canvas: HTMLCanvasElement;
  /** True while the field holds a WebGL context. */
  readonly live: boolean;
  dark(): boolean;
  still(): boolean;
  /** Re-reads the look and ink. */
  refresh(): void;
  destroy(): void;
}

export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export function mountPageField(config: PageFieldConfig): PageField | null {
  const { host, layer = 'under', kit } = config;
  if (typeof document === 'undefined') return null;
  const place = `position:absolute;inset:0;width:100%;height:100%;pointer-events:none;border-radius:inherit;z-index:${layer === 'under' ? -1 : 'auto'}`;
  if (!isGlyphFieldSupported()) {
    if (kit?.current.poster && !config.ownPoster) poster(host, kit.current.poster, place, kit);
    return null;
  }
  const styles = styleKeeper();
  const canvas = document.createElement('canvas');
  if (getComputedStyle(host).position === 'static') styles.set(host, 'position', 'relative');
  if (layer === 'under') styles.set(host, 'isolation', 'isolate');
  canvas.dataset.asciiKit = '';
  canvas.setAttribute('style', place);
  host.appendChild(canvas);

  let dark = isDark(host), destroyed = false;
  const still = () => !!(config.reducedMotion() ?? prefersReduced());
  const motion = (): GlyphFieldOptions => {
    const forced = config.reducedMotion();
    return forced === true ? { speed: 0, drift: 0, respectReducedMotion: true } : { respectReducedMotion: forced !== false };
  };
  const ink = () => resolveColor(config.ink(dark), host, dark ? '#d8d6cf' : '#1d1d1b') ?? '#888888';
  const live = liveField({
    host, canvas, kit, place, ownPoster: config.ownPoster, glyphs: config.glyphs, source: config.source ?? null,
    options: () => ({ ...BASE_LOOK, ...config.look(dark), ...motion(), ink: ink(), interactionTarget: host, label: config.label ?? '' }),
    onMount: (_, mounted) => {
      if (!config.label) { mounted.removeAttribute('role'); mounted.removeAttribute('aria-label'); mounted.setAttribute('aria-hidden', 'true'); }
      config.onMount?.();
    },
    onRelease: config.onRelease,
    onFail: () => { teardown(); config.onFail?.(); },
  });
  const field = live.field;

  let themeFrame = 0;
  const refresh = () => { if (destroyed) return; dark = isDark(host); field.update({ ...BASE_LOOK, ...config.look(dark), ...motion(), ink: ink() }); };
  const retheme = () => {
    if (themeFrame || destroyed) return;
    themeFrame = requestAnimationFrame(() => { themeFrame = 0; refresh(); });
  };
  const scheme = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  scheme?.addEventListener?.('change', retheme);
  // Class or attribute themes (`.dark`, `data-theme`) change no media query, so watch the root for them.
  const themes = typeof MutationObserver === 'function' ? new MutationObserver(retheme) : null;
  for (const root of [document.documentElement, document.body]) if (root) themes?.observe(root, { attributes: true, attributeFilter: ['class', 'data-theme', 'data-mode', 'style'] });

  function teardown() {
    if (destroyed) return;
    destroyed = true;
    if (themeFrame) cancelAnimationFrame(themeFrame);
    themes?.disconnect();
    scheme?.removeEventListener?.('change', retheme);
    live.destroy();
    styles.restore();
  }

  live.start();
  if (live.failed) { teardown(); return null; }
  return { field, get canvas() { return live.canvas; }, get live() { return live.live; }, dark: () => dark, still, refresh, destroy: teardown };
}

/** The handle shape the page helpers share, matching `KitHandle`. */
export function pageHandle<O, X extends object>(page: () => PageField | null, options: { current: O }, apply: (next: O) => void, extra: X, cleanup: () => void = () => {}) {
  let destroyed = false;
  const base = {
    get supported() { return !!page() && !destroyed; },
    get field() { return destroyed ? null : page()?.field ?? null; },
    update(next: Partial<O>) {
      if (destroyed) return;
      options.current = mergeOptions(options.current, next);
      const still = (next as { poster?: string }).poster;
      if (still) setPosterSource(options, still);
      apply(options.current);
      page()?.refresh();
    },
    play() { if (!destroyed) page()?.field.play(); },
    pause() { if (!destroyed) page()?.field.pause(); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cleanup();
      page()?.destroy();
      disposeKit(options);
    },
  };
  return Object.defineProperties(extra, Object.getOwnPropertyDescriptors(base)) as typeof base & X;
}

/** A canvas of the given size, cleared to black, and its pen. */
export function blank(width: number, height: number) {
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const pen = canvas.getContext('2d')!;
  pen.fillStyle = '#000';
  pen.fillRect(0, 0, width, height);
  return { canvas, pen };
}

/** Pulse options from an element or a point in viewport pixels, relative to the field's canvas. */
export function pulseAt(field: GlyphField, at: Element | { x: number; y: number } | undefined, strength: number) {
  if (!at) { field.pulse({ strength }); return; }
  if ('getBoundingClientRect' in at) { field.pulse({ element: at, strength }); return; }
  const box = field.canvas.getBoundingClientRect();
  field.pulse({ x: at.x - box.left, y: at.y - box.top, strength });
}
