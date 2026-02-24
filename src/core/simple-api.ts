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

export interface AsciifyLiveVideoOptions extends AsciifySimpleOptions {
  /**
   * When `true`, automatically sizes the canvas to the video's native pixel
   * dimensions after metadata loads, before `onReady` fires.
   * Eliminates manual canvas-sizing boilerplate for the common case.
   * Default: `false`
   */
  autoSize?: boolean;
  /**
   * Called once when the video metadata is ready and playback has started.
   * Receives the backing video element — use this to size the canvas, trigger
   * a loading state change, start a timer, etc.
   */
  onReady?: (video: HTMLVideoElement) => void;
  /** Called after every rendered frame. Useful for frame counters or timers. */
  onFrame?: () => void;
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
 * Convert a video element to ASCII art and start an animation loop on a canvas.
 * Returns a `stop()` function that cancels the loop.
 *
 * @example
 * const stop = await asciifyVideo(video, canvas);
 * // later: stop();
 */
export async function asciifyVideo(
  source: HTMLVideoElement | string,
  canvas: HTMLCanvasElement,
  { fontSize = 10, artStyle = 'classic', options = {} }: AsciifySimpleOptions = {}
): Promise<() => void> {
  let video: HTMLVideoElement;
  if (typeof source === 'string') {
    video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.src = source;
    if (video.readyState < 2) {
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error(`Failed to load video: ${source}`));
      });
    }
  } else {
    video = source;
  }

  const merged: AsciiOptions = { ...DEFAULT_OPTIONS, ...ART_STYLE_PRESETS[artStyle], ...options, fontSize };
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2d context from canvas');

  const { frames, fps } = await videoToAsciiFrames(video, merged, canvas.width, canvas.height);

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
 * Stream a video element (or URL) as live ASCII art onto a canvas — frame by
 * frame in real time, with no pre-extraction delay.
 *
 * Unlike `asciifyVideo` (which pre-processes the full clip), this renders each
 * video frame live as the video plays, making it suitable for long videos,
 * looping clips, and any case where you want instant playback.
 *
 * ⚠️ Important: never set the backing `<video>` element to `display: none` —
 * browsers skip GPU frame decoding for hidden elements, resulting in a blank
 * canvas. `asciifyLiveVideo` handles this automatically when given a URL.
 * If you supply your own video element, make sure it is visible or uses
 * `opacity: 0; position: fixed` instead.
 *
 * @returns A `stop()` function that cancels the animation loop and cleans up.
 *
 * @example
 * const stop = await asciifyLiveVideo('/clip.mp4', canvas);
 * // later: stop();
 */
export async function asciifyLiveVideo(
  source: HTMLVideoElement | string,
  canvas: HTMLCanvasElement,
  { fontSize = 10, artStyle = 'classic', options = {}, autoSize = false, onReady, onFrame }: AsciifyLiveVideoOptions = {}
): Promise<() => void> {
  let video: HTMLVideoElement;
  let ownedVideo = false;

  if (typeof source === 'string') {
    // Append to DOM but keep invisible — display:none breaks frame decoding
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
      video.onerror = () => reject(new Error(`asciifyLiveVideo: failed to load "${source}"`));
    });
    await video.play().catch(() => {});
  } else {
    video = source;
    if (video.paused) await video.play().catch(() => {});
  }

  if (autoSize) {
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
  }
  onReady?.(video);

  const merged: AsciiOptions = { ...DEFAULT_OPTIONS, ...ART_STYLE_PRESETS[artStyle], ...options, fontSize };
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('asciifyLiveVideo: could not get 2d context from canvas.');

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
    if (ownedVideo) {
      video.pause();
      video.src = '';
      document.body.removeChild(video);
    }
  };
}
