import type { FieldMark, GlyphFieldOptions } from '../field';
import { requestFieldFrame } from '../field/field-gl';
import { clamp, entryProgress, house, prefersReduced, resolveColor, styleKeeper, type KitHandle, type KitOptions } from './core';
import { mountPageField, pageHandle, type PageField } from './page-field';

export interface DitherImageOptions extends KitOptions {
  /** The image: a URL or an `<img>`. Default the first `<img>` inside, hidden while the field draws it. */
  src?: string | HTMLImageElement;
  /**
   * The brand's two tones: `[ground, ink]`, each a CSS colour or token. The ground fills the element under the marks; leave it
   * `'transparent'` to keep the element's own background. Default `['transparent', '--ascii-ink-strong']`.
   */
  tones?: [string, string];
  /** The mark the image is drawn in: `dither` (Bayer dots), `pixel`, `mosaic`, `dot`, `engraving`, `stipple`, … Default `dither`. */
  mark?: FieldMark;
  /** Cell size in CSS px. Default 5. */
  cellSize?: number;
  /** `visible` develops the image in from blank when it scrolls into view, `scroll` ties that to scroll position, `none` shows it at once. Default `visible`. */
  reveal?: 'none' | 'visible' | 'scroll';
  /** Length of the `visible` reveal in ms. Default 1100. */
  duration?: number;
  /** Cover crop focus, 0 to 1 on each axis. Default the centre. */
  focus?: { x: number; y: number };
  /** The canvas's accessible name. Default the image's `alt`. */
  label?: string;
}

export interface DitherImageHandle extends KitHandle<DitherImageOptions> {
  /** Plays the reveal again from blank. */
  replay(): void;
}

const DEFAULTS = { tones: ['transparent', '--ascii-ink-strong'] as [string, string], mark: 'dither' as FieldMark, cellSize: 5, reveal: 'visible' as const, duration: 1100 };

/** An image drawn in a brand's two tones as dither, pixels, dots or engraving, developing in as it scrolls into view. */
export function ditherImage(element: HTMLElement, options: DitherImageOptions = {}): DitherImageHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  const o = () => state.current;
  const styles = styleKeeper();
  const own = o().src ? null : element.querySelector('img');
  const source = o().src ?? own ?? null;
  // 0 is blank, 1 fully developed. Under reduced motion, or with no reveal, the image is there at once.
  let level = o().reveal === 'none' || (o().reducedMotion ?? prefersReduced()) ? 1 : 0, start = -1, frame = false;
  const look = (dark: boolean): GlyphFieldOptions => {
    const ground = o().tones[0];
    const background = ground === 'transparent' ? 'transparent' : resolveColor(ground, element, dark ? '#000000' : '#ffffff') ?? 'transparent';
    return {
      mark: o().mark, charset: ' .:-=+*#%@', cellSize: o().cellSize, cellAspect: 1, levels: 'auto', contrast: 1.1, fit: 'cover',
      focus: o().focus ?? { x: 0.5, y: 0.5 }, background, ...o().look,
      // The reveal lowers every tone together, so the screen fills in from its lightest marks to its darkest, as a print develops.
      brightness: (o().look?.brightness ?? 0) - (1 - level),
    };
  };

  let page: PageField | null = null;
  page = mountPageField({
    host: element,
    layer: 'under',
    look,
    ink: () => o().ink ?? o().tones[1],
    source,
    label: o().label ?? (own?.alt || (typeof o().src === 'object' ? (o().src as HTMLImageElement).alt : '') || undefined),
    kit: state,
    reducedMotion: () => o().reducedMotion,
    onFail: () => { page = null; styles.restore(); },
  });
  if (page && own) styles.set(own, 'visibility', 'hidden');
  if (page?.still()) level = 1;

  const step = (now: number) => {
    frame = false;
    if (!page || start < 0) return;
    const k = clamp((now - start) / o().duration);
    level = house(k);
    page.refresh();
    if (k < 1) { frame = true; requestFieldFrame(step); } else start = -1;
  };
  const replay = () => {
    if (!page) return;
    if (page.still()) { level = 1; page.refresh(); return; }
    start = performance.now(); level = 0;
    page.refresh();
    if (!frame) { frame = true; requestFieldFrame(step); }
  };
  const onScroll = () => {
    if (!page || page.still()) return;
    const next = entryProgress(element);
    if (Math.abs(next - level) < 0.004) return;
    level = next;
    page.refresh();
  };

  let seen = false;
  const view = page && o().reveal === 'visible' && typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(([entry]) => { if (entry.isIntersecting && !seen) replay(); seen = entry.isIntersecting; }, { threshold: 0.3 })
    : null;
  view?.observe(element);
  const scrolling = !!page && o().reveal === 'scroll' && typeof window !== 'undefined';
  if (scrolling) { window.addEventListener('scroll', onScroll, { passive: true }); onScroll(); }
  page?.refresh();

  return pageHandle(() => page, state, () => {}, { replay }, () => {
    view?.disconnect();
    if (scrolling) window.removeEventListener('scroll', onScroll);
    styles.restore();
  });
}
