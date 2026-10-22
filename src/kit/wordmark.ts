import type { GlyphFieldOptions } from '../field';
import { requestFieldFrame } from '../field/field-gl';
import { clamp, entryProgress, hash, house, styleKeeper, type KitHandle, type KitOptions } from './core';
import { blank, mountPageField, pageHandle, type PageField } from './page-field';

export interface WordmarkOptions extends KitOptions {
  /** The word drawn. Default the element's own text, which stays in the DOM, transparent, for selection and screen readers. */
  text?: string;
  /** The face it is set in. Default a serif: `Georgia, "Times New Roman", serif`. */
  font?: string;
  /** Default 600. */
  fontWeight?: number;
  /** Height of the 1800 px wide canvas the word is set on. A shorter one sets the word larger in a wide element. Default 520. */
  artHeight?: number;
  /** The canvas's accessible name when the word is not the element's own text. Default the word. */
  label?: string;
  /**
   * The word gathers out of scattered pieces: `visible` once as it scrolls into view (over `duration`), `scroll` with scroll
   * position, scattering again as it leaves. Off under reduced motion. Default off.
   */
  assemble?: 'visible' | 'scroll' | false;
  /** Ms the `visible` assembly takes. Default 1400. */
  duration?: number;
}

export interface WordmarkHandle extends KitHandle<WordmarkOptions> {
  /** Sets the word again, as large as fits. */
  setText(text: string): void;
  readonly text: string;
}

const DEFAULTS = { font: 'Georgia, "Times New Roman", serif', fontWeight: 600 };

/** The word on an 1800 x 520 canvas (or `height`), as large as fits, so the field sets it in characters. */
export function wordArt(word: string, font = DEFAULTS.font, weight = DEFAULTS.fontWeight, height = 520) {
  const { canvas, pen } = blank(1800, Math.max(1, Math.round(height)));
  const size = Math.min(400, 1700 / Math.max(3, [...word].length * 0.56));
  pen.fillStyle = '#fff'; pen.textAlign = 'center'; pen.textBaseline = 'middle';
  pen.font = `${weight} ${size}px ${font}`;
  pen.fillText(word || ' ', canvas.width / 2, canvas.height / 2 + size * 0.05);
  return canvas;
}

/** One field cell in the art's pixels, and where the cell grid starts, so pieces move whole cells at a time. */
export interface ScatterGrid { w: number; h: number; x0: number; y0: number }

/**
 * The word's art with every piece, one field cell each, flying in from a scattered place: `progress` 0 is nothing yet, 1 the word
 * itself. Pieces leave left to right with a little jitter, ease home, and move only by whole cells, so every frame the field
 * draws whole crisp characters rather than smeared halves. Exported for tests.
 */
export function scatterFrame(art: HTMLCanvasElement, progress: number, out: HTMLCanvasElement, grid: ScatterGrid = { w: 10, h: 10, x0: 0, y0: 0 }) {
  if (out.width !== art.width || out.height !== art.height) { out.width = art.width; out.height = art.height; }
  const pen = out.getContext('2d');
  if (!pen) return out;
  pen.globalAlpha = 1;
  pen.fillStyle = '#000';
  pen.fillRect(0, 0, out.width, out.height);
  if (progress >= 1) { pen.drawImage(art, 0, 0); return out; }
  const { w, h } = grid, x0 = (grid.x0 % w) - w, y0 = (grid.y0 % h) - h;
  const cols = Math.ceil((art.width - x0) / w), rows = Math.ceil((art.height - y0) / h);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c, x = x0 + c * w, y = y0 + r * h;
    const delay = 0.5 * (c / cols) + 0.15 * hash(i, 3.7), k = house(clamp((progress - delay) / 0.35));
    if (k <= 0) continue;
    const dx = Math.round(((hash(i, 1.3) - 0.5) * art.width * 0.25 * (1 - k)) / w) * w, dy = Math.round(((hash(i, 2.9) - 0.5) * art.height * 1.6 * (1 - k)) / h) * h;
    pen.drawImage(art, x, y, w, h, x + dx, y + dy, w, h);
  }
  return out;
}

/** A name or a word set in characters, with a trail under the pointer. */
export function wordmark(element: HTMLElement, options: WordmarkOptions = {}): WordmarkHandle {
  const own = (element.textContent ?? '').trim();
  const state = { current: { ...DEFAULTS, ...options } };
  let text = state.current.text ?? own;
  const styles = styleKeeper();
  const look = (): GlyphFieldOptions => ({
    mark: 'glyph', scene: 'none', charset: ' .:-=+*#%@', font: '"Geist", Arial, sans-serif', fontWeight: 500, cellSize: 7, cellAspect: 0.8, glyphScale: 0.8,
    color: 'ink', shade: 0, contrast: 1.3, levels: 'auto', fit: 'contain', focus: { x: 0.5, y: 0.5 }, hover: 'trail', trail: { strength: 0.62, radius: 0.22 },
    ...state.current.look,
  });
  const draw = () => wordArt(text, state.current.font, state.current.fontWeight, state.current.artHeight);
  // When the word is the element's own text, that text is the accessible name; otherwise the canvas carries it.
  const labelled = !own;

  let page: PageField | null = null;
  page = mountPageField({
    host: element,
    layer: 'over',
    look,
    ink: () => state.current.ink ?? '--ascii-ink-strong',
    source: draw(),
    label: labelled ? state.current.label ?? text : undefined,
    kit: state,
    reducedMotion: () => state.current.reducedMotion,
    onFail: () => { page = null; styles.restore(); },
  });
  if (page && own) styles.set(element, 'color', 'transparent');
  // Assembly: the source is the scattered word until it has gathered.
  const scattered = document.createElement('canvas');
  let progress = 1, start = -1, frame = false;
  // The field's cell in the art's pixels under the contain fit, so the scatter moves pieces by whole cells.
  const gridOf = (art: HTMLCanvasElement): ScatterGrid => {
    const rect = element.getBoundingClientRect(), lk = look(), ch = lk.cellSize ?? 7, cw = ch * (lk.cellAspect ?? 0.8);
    const k = Math.min(rect.width / art.width, rect.height / art.height) || 1;
    return { w: cw / k, h: ch / k, x0: -((rect.width - art.width * k) / 2) / k, y0: -((rect.height - art.height * k) / 2) / k };
  };
  const assembling = () => !!state.current.assemble && !!page && !page.still();
  const show = () => {
    if (!page) return;
    const art = draw();
    if (!assembling() || progress >= 1) { void page.field.setSource(art); return; }
    void page.field.setSource(scatterFrame(art, progress, scattered, gridOf(art)));
    page.field.redraw();
  };
  const step = (now: number) => {
    frame = false;
    if (!page || start < 0) return;
    progress = clamp((now - start) / (state.current.duration ?? 1400));
    show();
    if (progress < 1) { frame = true; requestFieldFrame(step); } else start = -1;
  };
  const gather = () => { if (!assembling()) return; start = performance.now(); progress = 0; if (!frame) { frame = true; requestFieldFrame(step); } };
  const onScroll = () => {
    const next = entryProgress(element);
    if (Math.abs(next - progress) < 0.004) return;
    progress = next;
    show();
  };
  let seen = false;
  const mode = assembling() ? state.current.assemble : false;
  const view = mode === 'visible' && typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(([entry]) => { if (entry.isIntersecting && !seen) gather(); seen = entry.isIntersecting; }, { threshold: 0.35 })
    : null;
  if (mode) { progress = 0; show(); }
  view?.observe(element);
  if (mode === 'scroll' && typeof window !== 'undefined') { window.addEventListener('scroll', onScroll, { passive: true }); onScroll(); }

  if (page) void document.fonts?.load?.(`${state.current.fontWeight} 100px ${state.current.font}`).then(() => show(), () => {});

  const setText = (next: string) => {
    if (next === text) return;
    text = next;
    // The word set here is the word from now on, so a later `update()` (a new ink, say) keeps it.
    if (state.current.text !== undefined) state.current = { ...state.current, text };
    if (!page) { if (own) element.textContent = text; return; }
    show();
    if (labelled) page.field.update({ label: state.current.label ?? (text || ' ') });
    else {
      for (const node of [...element.childNodes]) if (node !== page.canvas) node.remove();
      element.prepend(document.createTextNode(text));
    }
  };

  return pageHandle(() => page, state, next => {
    if (next.text !== undefined && next.text !== text) setText(next.text);
    else show();
  }, { setText, get text() { return text; } }, () => {
    view?.disconnect();
    if (mode === 'scroll') window.removeEventListener('scroll', onScroll);
    styles.restore();
  });
}
