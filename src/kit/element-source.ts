import type { Box } from './core';
import { paintTree } from './paint-dom';

/* A live HTML element as a field source: its real pixels where the browser can draw HTML into a canvas, a painted likeness elsewhere. */

export interface ElementSourceOptions {
  /** Source pixels per CSS pixel. A field samples a few pixels per cell, so 1 (the default) is plenty; 2 for small type. */
  scale?: number;
  /**
   * 'auto' (default) draws the element's real pixels where the browser supports HTML-in-Canvas and the element is the child of
   * a `<canvas layoutsubtree>`; otherwise, and with 'painted', it paints a likeness: boxes, borders, media blocks and each
   * word of text where the browser laid it out.
   */
  mode?: 'auto' | 'painted';
  /** Called after each new frame of the source, for example to `redraw()` a field that reads it. */
  onFrame?: () => void;
}

export interface ElementSource {
  /** The source: pass it to a field with `live: true` (`mountGlyphField(c, { source: s.canvas, live: true })`). */
  readonly canvas: HTMLCanvasElement;
  /** 'native' when the element's real pixels are drawn, 'painted' for the likeness. */
  readonly mode: 'native' | 'painted';
  /** Draws the element again now. Both modes also redraw on their own when the element changes. */
  update(): void;
  destroy(): void;
}

/** True when this browser can draw HTML into a canvas (the WICG HTML-in-Canvas API, behind a flag in Chromium for now). */
export function supportsHtmlInCanvas(): boolean {
  return typeof CanvasRenderingContext2D !== 'undefined' && 'drawElementImage' in CanvasRenderingContext2D.prototype;
}

type DrawElement = CanvasRenderingContext2D & { drawElementImage(element: Element, dx: number, dy: number): unknown };
type PaintingCanvas = HTMLCanvasElement & { requestPaint?(): void; onpaint: ((event: Event) => void) | null };

/**
 * Turns a live element into a source for a glyph field, so a card, a form or a whole view can be drawn in characters, and
 * kept in step as it changes. For the element's real pixels, place it as the only child of a `<canvas layoutsubtree>` (the
 * canvas then shows the element, still interactive, and is the source); the element is drawn on every paint the browser
 * reports. Anywhere else, or where the API is missing, it paints a likeness of the element on a canvas of its own, again
 * when the element's size, content or attributes change.
 */
export function elementSource(element: HTMLElement, options: ElementSourceOptions = {}): ElementSource {
  const scale = Math.max(0.25, Math.min(4, options.scale ?? 1));
  const host = element.parentElement;
  const native = options.mode !== 'painted' && supportsHtmlInCanvas() && host instanceof HTMLCanvasElement;
  const canvas = native ? (host as PaintingCanvas) : document.createElement('canvas');
  const pen = canvas.getContext('2d', { willReadFrequently: false });
  if (!pen) throw new Error('elementSource needs a 2D canvas context.');
  let destroyed = false, queued = 0;
  const size = () => {
    const w = Math.max(1, Math.round(element.offsetWidth * scale)), h = Math.max(1, Math.round(element.offsetHeight * scale));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return { w: element.offsetWidth, h: element.offsetHeight };
  };
  const frame = () => { if (!destroyed) options.onFrame?.(); };

  if (native) {
    // Both spellings of the opt-in: `layoutsubtree` (current Chromium) and `content="drawable"` with `drawable` (the explainer).
    canvas.setAttribute('layoutsubtree', '');
    canvas.setAttribute('content', 'drawable');
    element.setAttribute('drawable', '');
    const draw = () => {
      if (destroyed) return;
      size();
      pen.setTransform(1, 0, 0, 1, 0, 0);
      pen.clearRect(0, 0, canvas.width, canvas.height);
      pen.setTransform(scale, 0, 0, scale, 0, 0);
      try { (pen as DrawElement).drawElementImage(element, 0, 0); } catch { return; }
      frame();
    };
    const target = canvas as PaintingCanvas;
    target.onpaint = draw;
    const resize = new ResizeObserver(() => target.requestPaint?.());
    resize.observe(element);
    target.requestPaint?.();
    return {
      canvas, mode: 'native',
      update() { target.requestPaint?.(); },
      destroy() { destroyed = true; target.onpaint = null; resize.disconnect(); },
    };
  }

  const paint = () => {
    queued = 0;
    if (destroyed) return;
    const { w, h } = size();
    pen.setTransform(scale, 0, 0, scale, 0, 0);
    pen.fillStyle = '#000'; pen.fillRect(0, 0, w, h);
    const origin = element.getBoundingClientRect();
    const k = origin.width / (element.offsetWidth || origin.width || 1) || 1;
    const box = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { x: (r.left - origin.left) / k, y: (r.top - origin.top) / k, w: r.width / k, h: r.height / k };
    };
    paintTree(pen, element, box);
    frame();
  };
  // Changes to size, text, attributes or form values repaint once, on the next frame.
  const schedule = () => { if (!queued && !destroyed) queued = requestAnimationFrame(paint); };
  const resize = new ResizeObserver(schedule), mutation = new MutationObserver(schedule);
  resize.observe(element);
  mutation.observe(element, { subtree: true, childList: true, characterData: true, attributes: true });
  element.addEventListener('input', schedule);
  paint();
  return {
    canvas, mode: 'painted',
    update: paint,
    destroy() {
      destroyed = true;
      if (queued) cancelAnimationFrame(queued);
      resize.disconnect(); mutation.disconnect();
      element.removeEventListener('input', schedule);
    },
  };
}
