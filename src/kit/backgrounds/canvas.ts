import type { BackgroundContext, BackgroundRun } from '../background';
import { boxIn, isDark, prefersReduced, resolveColor, styleKeeper } from '../core';

/** What a canvas template is drawn with each frame. */
export interface TemplateFrame {
  fontSize: number;
  chars: string | undefined;
  ditherStrength: number;
  lightMode: boolean;
  /** The ink as #rrggbb. */
  ink: string;
  /** Your accent as #rrggbb, or undefined for the template's own. */
  accent: string | undefined;
  /** Seconds since mount at speed 1, for templates that keep their own clock (Fire). */
  elapsed: number;
  speed: number;
}

export type TemplateDraw = (ctx: CanvasRenderingContext2D, width: number, height: number, time: number, mouse: { x: number; y: number }, frame: TemplateFrame) => void;

/** Graphite at full strength on either ground; each glyph's alpha carries the tone (the site's TEMPLATE_INK). */
const GRAPHITE = { light: '#6f6d67', dark: '#8f8d86' };
/** The site's stage starts every template nine seconds in, so the first frame is already developed. */
const START = 9;

/** One window listener for every canvas background; each maps the pointer into its own box. */
const pointer = { x: -1, y: -1, users: 0 };
const track = (event: PointerEvent) => { pointer.x = event.clientX; pointer.y = event.clientY; };

/**
 * Runs a canvas template under the host's content exactly as the /backgrounds stage does: the same clock, pointer smoothing,
 * pixel ratio and frame skipping. `warm` paints extra frames on mount and resize for templates that build up (Fire).
 */
export function mountCanvas(context: BackgroundContext, draw: TemplateDraw, warmFrames = 0): BackgroundRun | null {
  if (typeof document === 'undefined') return null;
  const { host } = context;
  const canvas = document.createElement('canvas');
  let ctx: CanvasRenderingContext2D | null = null;
  try { ctx = canvas.getContext('2d'); } catch { ctx = null; }
  if (!ctx) return null;
  const pen = ctx;
  const styles = styleKeeper();
  if (getComputedStyle(host).position === 'static') styles.set(host, 'position', 'relative');
  styles.set(host, 'isolation', 'isolate');
  canvas.dataset.asciiKit = '';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;border-radius:inherit;z-index:-1');
  host.appendChild(canvas);

  let dark = isDark(host), ink = '', accent: string | undefined;
  const readInk = () => {
    ink = resolveColor(context.ink(dark), host, dark ? GRAPHITE.dark : GRAPHITE.light) ?? GRAPHITE.dark;
    const chosen = context.settings().accent;
    accent = chosen ? resolveColor(chosen, host) ?? undefined : undefined;
  };
  readInk();

  let raf = 0, visible = true, paused = false, destroyed = false, last = 0, previous = 0, cost = 0, odd = false;
  let phase = START, elapsed = START, w = 1, h = 1, warm = warmFrames;
  const smooth = { x: 0.5, y: 0.5 };
  const still = () => !!(context.reducedMotion() ?? prefersReduced());

  const clearZone = (element: HTMLElement | false) => {
    if (!element || !element.isConnected) return;
    const box = boxIn(canvas, element);
    if (!box.w || !box.h) return;
    // A soft ellipse round the element's box: fully clear over the content, feathering out past its edges.
    const pad = 32, rx = box.w * 0.71 + pad, ry = box.h * 0.71 + pad;
    const ratio = canvas.width / w || 1;
    pen.save();
    pen.setTransform(ratio * rx, 0, 0, ratio * ry, ratio * (box.x + box.w / 2), ratio * (box.y + box.h / 2));
    const fade = pen.createRadialGradient(0, 0, 0, 0, 0, 1);
    fade.addColorStop(0, 'rgba(0,0,0,1)');
    fade.addColorStop(0.72, 'rgba(0,0,0,1)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    pen.globalCompositeOperation = 'destination-out';
    pen.fillStyle = fade;
    pen.fillRect(-1, -1, 2, 2);
    pen.restore();
  };
  const paint = () => {
    const s = context.settings(), begin = performance.now();
    const frame: TemplateFrame = { fontSize: s.cellSize, chars: s.charset, ditherStrength: s.dither, lightMode: !dark, ink, accent, elapsed, speed: s.speed };
    pen.globalAlpha = 1;
    pen.globalCompositeOperation = 'source-over';
    for (; warm > 0; warm--) draw(pen, w, h, phase, smooth, frame);
    draw(pen, w, h, phase, smooth, frame);
    clearZone(s.clear);
    cost = cost * 0.9 + (performance.now() - begin) * 0.1;
    canvas.dataset.painted = '';
  };
  const tick = (now: number) => {
    raf = 0;
    if (destroyed || paused || !visible || (typeof document !== 'undefined' && document.hidden)) { last = previous = 0; return; }
    const rest = still(), s = context.settings();
    // On high-refresh screens a heavy template draws every other frame, so scrolling keeps the full rate.
    const gap = previous ? now - previous : 17;
    previous = now;
    if (!rest && cost > 4.5 && gap < 12 && (odd = !odd)) { raf = requestAnimationFrame(tick); return; }
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    if (!rest) { phase += dt * s.speed; elapsed += dt; }
    if (s.cursor && pointer.x >= 0) {
      const box = canvas.getBoundingClientRect();
      if (box.width && box.height) {
        smooth.x += ((pointer.x - box.left) / box.width - smooth.x) * 0.07;
        smooth.y += ((pointer.y - box.top) / box.height - smooth.y) * 0.07;
      }
    } else if (!s.cursor) {
      smooth.x += (0.5 - smooth.x) * 0.07;
      smooth.y += (0.5 - smooth.y) * 0.07;
    }
    paint();
    if (!rest) raf = requestAnimationFrame(tick);
  };
  const kick = () => { if (!raf && !destroyed && !paused && visible) raf = requestAnimationFrame(tick); };

  const resize = () => {
    if (destroyed) return;
    const ratio = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
    w = Math.max(1, canvas.clientWidth || host.clientWidth || 1);
    h = Math.max(1, canvas.clientHeight || host.clientHeight || 1);
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
    pen.setTransform(ratio, 0, 0, ratio, 0, 0);
    warm = warmFrames;
    if (visible && !paused) paint();
    kick();
  };
  resize();

  const sizer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  sizer?.observe(host);
  const seen = typeof IntersectionObserver === 'function' ? new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    last = 0;
    if (visible) kick(); else if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }, { rootMargin: '64px' }) : null;
  seen?.observe(host);
  const resume = () => { last = 0; kick(); };
  document.addEventListener('visibilitychange', resume);
  const motion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  motion?.addEventListener?.('change', resume);
  if (pointer.users++ === 0 && typeof addEventListener === 'function') addEventListener('pointermove', track, { passive: true });
  // Glyphs drawn before the page's fonts arrive are drawn again in them; a still frame would otherwise keep the fallback.
  const fonts = typeof document.fonts === 'object' ? document.fonts : null;
  const fontsReady = () => { if (!destroyed && visible && !paused) { paint(); kick(); } };
  fonts?.addEventListener?.('loadingdone', fontsReady);
  void fonts?.ready?.then(fontsReady, () => {});

  let themeFrame = 0;
  const retheme = () => {
    if (themeFrame || destroyed) return;
    themeFrame = requestAnimationFrame(() => {
      themeFrame = 0;
      if (destroyed) return;
      dark = isDark(host);
      readInk();
      if (still()) paint();
      kick();
    });
  };
  const scheme = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  scheme?.addEventListener?.('change', retheme);
  // Class or attribute themes (`.dark`, `data-theme`) change no media query, so watch the root for them.
  const themes = typeof MutationObserver === 'function' ? new MutationObserver(retheme) : null;
  for (const root of [document.documentElement, document.body]) if (root) themes?.observe(root, { attributes: true, attributeFilter: ['class', 'data-theme', 'data-mode', 'style'] });

  return {
    field: null,
    canvas,
    refresh() {
      if (destroyed) return;
      dark = isDark(host);
      readInk();
      if (still() && visible && !paused) paint();
      kick();
    },
    play() { if (!paused) return; paused = false; last = 0; kick(); },
    pause() { paused = true; if (raf) cancelAnimationFrame(raf); raf = 0; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      if (themeFrame) cancelAnimationFrame(themeFrame);
      raf = themeFrame = 0;
      sizer?.disconnect();
      seen?.disconnect();
      themes?.disconnect();
      document.removeEventListener('visibilitychange', resume);
      motion?.removeEventListener?.('change', resume);
      scheme?.removeEventListener?.('change', retheme);
      fonts?.removeEventListener?.('loadingdone', fontsReady);
      if (--pointer.users === 0 && typeof removeEventListener === 'function') removeEventListener('pointermove', track);
      canvas.remove();
      canvas.width = canvas.height = 0;
      styles.restore();
    },
  };
}
