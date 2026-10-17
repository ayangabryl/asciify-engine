import type { GlyphFieldOptions } from '../field';
import { prefersReduced, styleKeeper, type KitHandle, type KitOptions } from './core';
import { mountPageField, pageHandle, type PageField } from './page-field';

export interface AsciiVideoOptions extends KitOptions {
  /** A video URL, or a `<video>` element. Default the first `<video>` inside the element, which is hidden while the field draws it. */
  src?: string | HTMLVideoElement;
  /** Starts playing at once. Default true, or false when the visitor prefers reduced motion, which shows the first frame. */
  autoplay?: boolean;
  /** An image URL shown before the first frame is drawn, and in place of the video while it is paused under reduced motion. */
  poster?: string;
  /** The canvas's accessible name. Default `Video, drawn in characters`. */
  label?: string;
}

export interface AsciiVideoHandle extends KitHandle<AsciiVideoOptions> {
  /** Plays when paused, pauses when playing; returns whether it now plays. */
  toggle(): boolean;
  readonly playing: boolean;
}

const COVER = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:inherit;pointer-events:none';

/**
 * A video drawn in characters, muted and looping, with play and pause. Without WebGL2 the video itself plays in the element,
 * with the poster until it starts.
 */
export function asciiVideo(element: HTMLElement, options: AsciiVideoOptions = {}): AsciiVideoHandle {
  const state = { current: { ...options } };
  const styles = styleKeeper();
  const added: Element[] = [];
  const inner = element.querySelector('video');
  const src = state.current.src ?? inner ?? null;
  const reduced = () => state.current.reducedMotion ?? prefersReduced();
  const look = (): GlyphFieldOptions => ({
    mark: 'glyph', scene: 'none', charset: ' .:-=+*#%@', font: '"Geist", Arial, sans-serif', fontWeight: 500, cellSize: 6, cellAspect: 0.8, glyphScale: 0.8,
    color: 'ink', shade: 0, contrast: 1.25, levels: 'auto', fit: 'cover', focus: { x: 0.5, y: 0.5 }, hover: 'trail', trail: { strength: 0.9, radius: 0.35 },
    ...state.current.look,
  });

  let page: PageField | null = null;
  page = !src ? null : mountPageField({
    host: element,
    layer: 'over',
    look,
    ink: dark => state.current.ink ?? (dark ? '#d8d6cf' : '#1d1d1b'),
    source: src,
    label: state.current.label ?? 'Video, drawn in characters',
    reducedMotion: () => state.current.reducedMotion,
    onFail: () => { page = null; styles.restore(); fallback(); },
  });
  if (page && src instanceof HTMLVideoElement) {
    if (element.contains(src)) styles.set(src, 'opacity', '0');
    src.muted = true; src.loop = true; src.playsInline = true;
  }

  let poster: HTMLImageElement | null = null;
  if (state.current.poster && src) {
    poster = Object.assign(document.createElement('img'), { alt: '', decoding: 'async' });
    poster.className = 'ascii-video-poster';
    poster.setAttribute('aria-hidden', 'true');
    poster.setAttribute('style', `${COVER};transition:opacity 280ms cubic-bezier(.16, 1, .3, 1)`);
    poster.src = state.current.poster;
    if (getComputedStyle(element).position === 'static') styles.set(element, 'position', 'relative');
    element.appendChild(poster);
    added.push(poster);
  }
  let drawn = false;
  /** The poster shows until the first frame lands, and while a reduced-motion visitor has not pressed play. */
  const syncPoster = () => { if (poster) poster.style.opacity = page && drawn && (playing || !reduced()) ? '0' : '1'; };

  // Without the field the video itself plays in the element.
  let plain: HTMLVideoElement | null = null;
  function fallback() {
    if (plain || !src) return;
    if (src instanceof HTMLVideoElement) plain = src;
    else {
      plain = document.createElement('video');
      plain.src = src;
      plain.setAttribute('style', COVER);
      plain.setAttribute('aria-label', state.current.label ?? 'Video');
      if (getComputedStyle(element).position === 'static') styles.set(element, 'position', 'relative');
      if (poster) element.insertBefore(plain, poster); else element.appendChild(plain);
      added.push(plain);
    }
    if (state.current.poster && !plain.poster) plain.poster = state.current.poster;
    plain.muted = true; plain.loop = true; plain.playsInline = true;
    if (poster) poster.style.opacity = '0';
    if (playing) void plain.play?.()?.catch?.(() => {});
  }

  let playing = state.current.autoplay ?? !(page ? page.still() : reduced());
  if (!page) fallback();
  else {
    void page.field.ready.then(() => { drawn = true; if (!playing) page?.field.pause(); syncPoster(); });
    if (playing && src instanceof HTMLVideoElement) void src.play?.()?.catch?.(() => {});
    syncPoster();
  }

  const h = pageHandle(() => page, state, () => {}, {
    toggle(): boolean { if (playing) h.pause(); else h.play(); return playing; },
    get playing() { return playing; },
  }, () => { added.forEach(el => el.remove()); styles.restore(); });
  const play = h.play, pause = h.pause;
  h.play = () => {
    if (page && !h.supported) return;
    playing = true;
    if (page) play(); else void plain?.play?.()?.catch?.(() => {});
    syncPoster();
  };
  h.pause = () => {
    if (page && !h.supported) return;
    playing = false;
    if (page) pause(); else plain?.pause?.();
    syncPoster();
  };
  return h;
}
