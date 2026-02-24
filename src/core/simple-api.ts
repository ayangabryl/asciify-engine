/**
 * Simple one-call asciify API.
 * Wraps imageToAsciiFrame + renderFrameToCanvas behind easy-to-use helpers.
 */

import type { AsciiOptions, ArtStyle } from '../types';
import { DEFAULT_OPTIONS, ART_STYLE_PRESETS } from '../types';
import { imageToAsciiFrame, videoToAsciiFrames, gifToAsciiFrames, renderFrameToCanvas } from './renderer';

export { videoToAsciiFrames, gifToAsciiFrames };

export interface AsciifySimpleOptions {
  /** Character size in pixels. Default: 10 */
  fontSize?: number;
  /**
   * Art style preset — controls charset, render mode, and color mode together.
   * Shorthand for spreading `ART_STYLE_PRESETS[artStyle]` into options.
   * Default: `'classic'`
   */
  artStyle?: ArtStyle;
  /** Extra options to merge on top of the preset */
  options?: Partial<AsciiOptions>;
}

export interface AsciifyVideoOptions extends AsciifySimpleOptions {
  /**
   * Fit the canvas to a container element, maintaining the video's aspect ratio.
   * Accepts an HTMLElement or a CSS selector string. The canvas is resized on
   * load and again whenever the container resizes (via ResizeObserver).
   * `stop()` automatically disconnects the observer.
   *
   * @example
   * // Fill the hero div, re-size on window resize automatically:
   * asciifyVideo('/clip.mp4', canvas, { fitTo: '#hero' });
   */
  fitTo?: HTMLElement | string | null;
  /**
   * Pre-extract all video frames into memory before starting playback.
   * Useful for short clips where you need frame-perfect control.
   *
   * Default: `false` — streams live directly from the playing video (instant
   * start, constant memory, unlimited duration).
   *
   * ⚠️ Memory-intensive. Capped at 10 s / 300 frames.
   */
  preExtract?: boolean;
  /**
   * Called once when the video metadata is loaded and playback has started.
   * Receives the backing video element.
   */
  onReady?: (video: HTMLVideoElement) => void;
  /** Called after every rendered frame. */
  onFrame?: () => void;
}

/** @deprecated Use {@link AsciifyVideoOptions} */
export type AsciifyLiveVideoOptions = AsciifyVideoOptions;

// ─── Internal helper ──────────────────────────────────────────────────────────
function sizeCanvasToContainer(
  canvas: HTMLCanvasElement,
  container: HTMLElement,
  aspect: number,
): void {
  const { width, height } = container.getBoundingClientRect();
  if (!width || !height) return;
  let w = width, h = w / aspect;
  if (h > height) { h = height; w = h * aspect; }
  canvas.width  = Math.round(w);
  canvas.height = Math.round(h);
}

/**
 * Convert an image/video/canvas element to ASCII art and render it onto a canvas.
 *
 * @example
 * await asciify(document.querySelector('img'), canvas);
 * await asciify(img, canvas, { fontSize: 8, artStyle: 'letters' });
 */
export async function asciify(
  source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | string,
  canvas: HTMLCanvasElement,
  { fontSize = 10, artStyle = 'classic', options = {} }: AsciifySimpleOptions = {}
): Promise<void> {
  let el: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement;
  if (typeof source === 'string') {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`Failed to load image: ${source}`));
      img.src = source;
    });
    el = img;
  } else if (source instanceof HTMLImageElement && !source.complete) {
    await new Promise<void>((resolve, reject) => {
      source.onload = () => resolve();
      source.onerror = () => reject(new Error('Image failed to load'));
    });
    el = source;
  } else {
    el = source;
  }

  const preset = ART_STYLE_PRESETS[artStyle];
  const merged: AsciiOptions = { ...DEFAULT_OPTIONS, ...preset, ...options, fontSize };

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2d context from canvas');

  const { frame } = imageToAsciiFrame(el, merged, canvas.width, canvas.height);
  renderFrameToCanvas(ctx, frame, merged, canvas.width, canvas.height);
}

/**
 * Fetch a GIF, convert it to ASCII, and start an animation loop on a canvas.
 * Returns a `stop()` function that cancels the loop.
 *
 * @example
 * const stop = await asciifyGif('animation.gif', canvas);
 * // later: stop();
 */
export async function asciifyGif(
  source: string | ArrayBuffer,
  canvas: HTMLCanvasElement,
  { fontSize = 10, artStyle = 'classic', options = {} }: AsciifySimpleOptions = {}
): Promise<() => void> {
  const buffer = typeof source === 'string'
    ? await fetch(source).then(r => r.arrayBuffer())
    : source;

  const merged: AsciiOptions = { ...DEFAULT_OPTIONS, ...ART_STYLE_PRESETS[artStyle], ...options, fontSize };
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2d context from canvas');

  const { frames, fps } = await gifToAsciiFrames(buffer, merged, canvas.width, canvas.height);

  let cancelled = false;
  let animId: number;
  let i = 0;
  let last = performance.now();
  const interval = 1000 / fps;

  const tick = (now: number) => {
    if (cancelled) return;
    if (now - last >= interval) {
      renderFrameToCanvas(ctx, frames[i], merged, canvas.width, canvas.height);
      i = (i + 1) % frames.length;
      last = now;
    }
    animId = requestAnimationFrame(tick);
  };
  animId = requestAnimationFrame(tick);

  return () => { cancelled = true; cancelAnimationFrame(animId); };
}

/**
 * Render a video as ASCII art on a canvas. Defaults to live streaming —
 * instant start, constant memory, unlimited duration.
 *
 * Pass `{ preExtract: true }` to pre-decode all frames before playback starts
 * (useful for short clips that need frame-perfect looping).
 *
 * Pass `{ fitTo: '#container' }` to automatically size and re-size the canvas
 * to fill a container element, maintaining the video's aspect ratio.
 *
 * Returns a `stop()` function that cancels the loop and cleans up.
 *
 * ⚠️ Never set the backing `<video>` to `display: none` — browsers skip GPU
 * frame decoding for hidden elements. When given a URL string, this function
 * handles that automatically.
 *
 * @example
 * // Minimal
 * const stop = await asciifyVideo('/clip.mp4', canvas);
 *
 * // Fit to container, re-size on window resize:
 * const stop = await asciifyVideo('/clip.mp4', canvas, { fitTo: '#hero' });
 *
 * // Pre-extract frames (old behavior):
 * const stop = await asciifyVideo('/clip.mp4', canvas, { preExtract: true });
 */
export async function asciifyVideo(
  source: HTMLVideoElement | string,
  canvas: HTMLCanvasElement,
  { fontSize = 10, artStyle = 'classic', options = {}, fitTo, preExtract = false, onReady, onFrame }: AsciifyVideoOptions = {}
): Promise<() => void> {
  const merged: AsciiOptions = { ...DEFAULT_OPTIONS, ...ART_STYLE_PRESETS[artStyle], ...options, fontSize };
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('asciifyVideo: could not get 2d context from canvas.');

  const container: HTMLElement | null =
    typeof fitTo === 'string' ? document.querySelector<HTMLElement>(fitTo) :
    fitTo instanceof HTMLElement ? fitTo : null;

  // ── Pre-extract mode ─────────────────────────────────────────────────────
  if (preExtract) {
    let video: HTMLVideoElement;
    if (typeof source === 'string') {
      video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.src = source;
      if (video.readyState < 2) {
        await new Promise<void>((resolve, reject) => {
          video.onloadeddata = () => resolve();
          video.onerror = () => reject(new Error(`asciifyVideo: failed to load "${source}"`));
        });
      }
    } else {
      video = source;
    }

    if (container) sizeCanvasToContainer(canvas, container, video.videoWidth / video.videoHeight);
    onReady?.(video);

    const { frames, fps } = await videoToAsciiFrames(video, merged, canvas.width, canvas.height);
    let cancelled = false, animId: number, i = 0, last = performance.now();
    const interval = 1000 / fps;
    const tick = (now: number) => {
      if (cancelled) return;
      if (now - last >= interval) {
        renderFrameToCanvas(ctx, frames[i], merged, canvas.width, canvas.height);
        i = (i + 1) % frames.length;
        last = now;
        onFrame?.();
      }
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
    return () => { cancelled = true; cancelAnimationFrame(animId); };
  }

  // ── Live streaming mode (default) ────────────────────────────────────────
  let video: HTMLVideoElement;
  let ownedVideo = false;

  if (typeof source === 'string') {
    // Keep off-screen but not display:none — browsers skip GPU decoding for hidden elements
    video = document.createElement('video');
    video.src = source;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    Object.assign(video.style, {
      position: 'fixed', top: '0', left: '0',
      width: '1px', height: '1px',
      opacity: '0', pointerEvents: 'none', zIndex: '-1',
    });
    document.body.appendChild(video);
    ownedVideo = true;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error(`asciifyVideo: failed to load "${source}"`));
    });
    await video.play().catch(() => {});
  } else {
    video = source;
    if (video.paused) await video.play().catch(() => {});
  }

  let ro: ResizeObserver | null = null;
  if (container) {
    const aspect = video.videoWidth / video.videoHeight;
    sizeCanvasToContainer(canvas, container, aspect);
    ro = new ResizeObserver(() => sizeCanvasToContainer(canvas, container, aspect));
    ro.observe(container);
  }
  onReady?.(video);

  let cancelled = false;
  let animId: number;
  const tick = () => {
    if (cancelled) return;
    animId = requestAnimationFrame(tick);
    if (video.readyState < 2 || canvas.width === 0 || canvas.height === 0) return;
    const { frame } = imageToAsciiFrame(video, merged, canvas.width, canvas.height);
    if (frame.length > 0) {
      renderFrameToCanvas(ctx, frame, merged, canvas.width, canvas.height, 0, null);
      onFrame?.();
    }
  };
  animId = requestAnimationFrame(tick);

  return () => {
    cancelled = true;
    cancelAnimationFrame(animId);
    ro?.disconnect();
    if (ownedVideo) {
      video.pause();
      video.src = '';
      document.body.removeChild(video);
    }
  };
}

/**
 * @deprecated Use {@link asciifyVideo} instead — it now defaults to live streaming
 * and accepts the same options including `fitTo` and `preExtract`.
 */
export function asciifyLiveVideo(
  source: HTMLVideoElement | string,
  canvas: HTMLCanvasElement,
  opts?: AsciifyVideoOptions,
): Promise<() => void> {
  return asciifyVideo(source, canvas, opts);
}

