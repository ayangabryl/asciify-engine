import type { GlyphFieldOptions } from '../field';
import { styleKeeper, type KitHandle, type KitOptions } from './core';
import { blank, mountPageField, pageHandle, type PageField } from './page-field';

export interface WordmarkOptions extends KitOptions {
  /** The word drawn. Default the element's own text, which stays in the DOM, transparent, for selection and screen readers. */
  text?: string;
  /** The face it is set in. Default a serif: `Georgia, "Times New Roman", serif`. */
  font?: string;
  /** Default 600. */
  fontWeight?: number;
}

export interface WordmarkHandle extends KitHandle<WordmarkOptions> {
  /** Sets the word again, as large as fits. */
  setText(text: string): void;
  readonly text: string;
}

const DEFAULTS = { font: 'Georgia, "Times New Roman", serif', fontWeight: 600 };

/** The word on an 1800 x 520 canvas, as large as fits, so the field sets it in characters. */
export function wordArt(word: string, font = DEFAULTS.font, weight = DEFAULTS.fontWeight) {
  const { canvas, pen } = blank(1800, 520);
  const size = Math.min(400, 1700 / Math.max(3, [...word].length * 0.56));
  pen.fillStyle = '#fff'; pen.textAlign = 'center'; pen.textBaseline = 'middle';
  pen.font = `${weight} ${size}px ${font}`;
  pen.fillText(word || ' ', canvas.width / 2, canvas.height / 2 + size * 0.05);
  return canvas;
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
  const draw = () => wordArt(text, state.current.font, state.current.fontWeight);
  // When the word is the element's own text, that text is the accessible name; otherwise the canvas carries it.
  const labelled = !own;

  let page: PageField | null = null;
  page = mountPageField({
    host: element,
    layer: 'over',
    look,
    ink: dark => state.current.ink ?? (dark ? '#d8d6cf' : '#1d1d1b'),
    source: draw(),
    label: labelled ? text : undefined,
    reducedMotion: () => state.current.reducedMotion,
    onFail: () => { page = null; styles.restore(); },
  });
  if (page && own) styles.set(element, 'color', 'transparent');
  if (page) void document.fonts?.load?.(`${state.current.fontWeight} 100px ${state.current.font}`).then(() => { if (page) void page.field.setSource(draw()); }, () => {});

  const setText = (next: string) => {
    if (next === text) return;
    text = next;
    if (!page) { if (own) element.textContent = text; return; }
    void page.field.setSource(draw());
    if (labelled) page.field.update({ label: text || ' ' });
    else {
      for (const node of [...element.childNodes]) if (node !== page.canvas) node.remove();
      element.prepend(document.createTextNode(text));
    }
  };

  return pageHandle(() => page, state, next => {
    if (next.text !== undefined && next.text !== text) setText(next.text);
    else if (page) void page.field.setSource(draw());
  }, { setText, get text() { return text; } }, () => styles.restore());
}
