import { isGlyphFieldSupported, mountGlyphField, type FieldSource, type GlyphField, type GlyphFieldOptions } from '../field';
import { BASE_LOOK, isDark, prefersReduced, resolveColor, styleKeeper } from './core';

/**
 * A field that lies over or under a whole element and draws its own source or scene. Unlike `mountSurface`, nothing is painted per
 * frame: the field runs its own loop, and the page helpers swap the source only while they animate.
 */
export interface PageFieldConfig {
  host: HTMLElement;
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
  readonly field: GlyphField;
  readonly canvas: HTMLCanvasElement;
  dark(): boolean;
  still(): boolean;
  /** Re-reads the look and ink. */
  refresh(): void;
  destroy(): void;
}

export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export function mountPageField(config: PageFieldConfig): PageField | null {
  const { host, layer = 'under' } = config;
  if (typeof document === 'undefined' || !isGlyphFieldSupported()) return null;
  const styles = styleKeeper();
  const canvas = document.createElement('canvas');
  if (getComputedStyle(host).position === 'static') styles.set(host, 'position', 'relative');
  if (layer === 'under') styles.set(host, 'isolation', 'isolate');
  canvas.dataset.asciiKit = '';
  canvas.setAttribute('style', `position:absolute;inset:0;width:100%;height:100%;pointer-events:none;border-radius:inherit;z-index:${layer === 'under' ? -1 : 'auto'}`);
  host.appendChild(canvas);

  let dark = isDark(host), destroyed = false;
  const still = () => !!(config.reducedMotion() ?? prefersReduced());
  const motion = (): GlyphFieldOptions => {
    const forced = config.reducedMotion();
    return forced === true ? { speed: 0, drift: 0, respectReducedMotion: true } : { respectReducedMotion: forced !== false };
  };
  const ink = () => resolveColor(config.ink(dark), host, dark ? '#d8d6cf' : '#1d1d1b') ?? '#888888';
  let field: GlyphField;
  try {
    field = mountGlyphField(canvas, {
      ...BASE_LOOK, ...config.look(dark), ...motion(), ink: ink(), source: config.source ?? null, interactionTarget: host, label: config.label ?? '',
      onError: () => { if (!destroyed) { teardown(); config.onFail?.(); } },
    });
  } catch {
    canvas.remove();
    styles.restore();
    return null;
  }
  if (!config.label) { canvas.removeAttribute('role'); canvas.removeAttribute('aria-label'); canvas.setAttribute('aria-hidden', 'true'); }

  let themeFrame = 0;
  const refresh = () => { if (destroyed) return; dark = isDark(host); field.update({ ...config.look(dark), ...motion(), ink: ink() }); };
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
    field.destroy();
    try { (canvas.getContext('webgl2') as WebGL2RenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* already gone */ }
    canvas.remove();
    styles.restore();
  }

  return { get field() { return field; }, canvas, dark: () => dark, still, refresh, destroy: teardown };
}

/** The handle shape the page helpers share, matching `KitHandle`. */
export function pageHandle<O, X extends object>(page: () => PageField | null, options: { current: O }, apply: (next: O) => void, extra: X, cleanup: () => void = () => {}) {
  let destroyed = false;
  const base = {
    get supported() { return !!page() && !destroyed; },
    get field() { return destroyed ? null : page()?.field ?? null; },
    update(next: Partial<O>) {
      if (destroyed) return;
      options.current = { ...options.current, ...next };
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
