/**
 * Simple one-call asciify API.
 * Wraps imageToAsciiFrame + renderFrameToCanvas behind easy-to-use helpers.
 */

import type { AsciiOptions, ArtStyle } from '../types';
import { DEFAULT_OPTIONS, ART_STYLE_PRESETS } from '../types';
import { createOffscreenCanvas, parseChromaKeyColor } from './utils';
import { imageToAsciiFrame, imageToAsciiTextFrame, videoToAsciiFrames, videoToAsciiTextFrames, gifToAsciiFrames, gifToAsciiTextFrames, renderFrameToCanvas, renderTextFrameToCanvas, resolveSourceCrop } from './renderer';
import type { AsciiTextFrame } from './renderer';

export { videoToAsciiFrames, videoToAsciiTextFrames, gifToAsciiFrames, gifToAsciiTextFrames, resolveSourceCrop };

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

type ScrollTriggerInstance = { kill?: () => void };

type ScrollTriggerLike = {
  create: (vars: Record<string, unknown>) => ScrollTriggerInstance;
};

type GsapLike = {
  registerPlugin?: (...plugins: unknown[]) => void;
  ScrollTrigger?: ScrollTriggerLike;
};

export interface VideoScrollScrubOptions {
  /**
   * Element that controls scroll progress. Accepts an HTMLElement or selector.
   * When used through `asciifyVideo`, defaults to `fitTo` or the canvas.
   */
  trigger?: HTMLElement | string | null;
  /**
   * GSAP instance. Pass this with ScrollTrigger for native GSAP scrub support.
   *
   * @example
   * asciifyVideo('/hero.mp4', canvas, {
   *   fitTo: '#hero',
   *   scroll: { gsap, ScrollTrigger }
   * });
   */
  gsap?: GsapLike;
  /** GSAP ScrollTrigger plugin. Optional when available as `gsap.ScrollTrigger`. */
  ScrollTrigger?: ScrollTriggerLike;
  /** GSAP start value. Native fallback ignores this and uses viewport progress. */
  start?: string;
  /** GSAP end value. Native fallback ignores this and uses viewport progress. */
  end?: string;
  /** GSAP scrub value. Default: `true`. Native fallback always scrubs. */
  scrub?: boolean | number;
  /**
   * Multiply scroll progress before mapping it to video time.
   * `2` reaches the end of the clip in half the scroll distance, `0.5` makes it
   * take twice as much scroll. Default: `1`.
   */
  speed?: number;
  /** Video time to map from. Defaults to trim start or `0`. */
  from?: number;
  /** Video time to map to. Defaults to trim end or video duration. */
  to?: number;
  /** Optional progress transform before mapping to video time. */
  ease?: (progress: number) => number;
  /** Called whenever scroll progress updates. */
  onUpdate?: (progress: number, video: HTMLVideoElement) => void;
}

export type CanvasObjectFit = 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
export type CanvasBleed = number | string | { x?: number | string; y?: number | string };

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
   * CSS object-fit behavior for the visible canvas when `fitTo` or explicit
   * `width`/`height` is used. This controls visual framing only; ASCII sampling
   * resolution remains independent. When `options.sourceCrop` is present, the
   * engine sizes from the resolved crop aspect to avoid stretch.
   *
   * Use `'cover'` for full-bleed heroes and `'contain'` for previews.
   * Default: `'contain'`.
   */
  objectFit?: CanvasObjectFit;
  /**
   * CSS object-position for the visible canvas, e.g. `'center bottom'` or
   * `'50% 62%'`. Useful with `objectFit: 'cover'`.
   */
  objectPosition?: string;
  /**
   * Visual scale applied with the CSS individual `scale` property. This is a
   * layout-safe way to overfill a container without changing source proportions
   * or overriding an app's `transform` styles.
   */
  scale?: number;
  /**
   * Visible CSS width for the canvas. Numbers are pixels; strings are used as
   * provided (`'100%'`, `'100vw'`, `min(100vw, 1200px)`, etc.).
   */
  width?: number | string;
  /**
   * Visible CSS height for the canvas. Numbers are pixels; strings are used as
   * provided.
   */
  height?: number | string;
  /**
   * Extra visible overfill added around the fitted canvas box before
   * object-fit sizing. Useful for full-bleed ASCII heroes where glyph side
   * bearings or character-cell quantization can leave a small edge gap even
   * when the source media and canvas are full width.
   *
   * Numbers are pixels. Strings support `%`, `px`, `vw`, and `vh`. Pass an
   * object to control axes independently, e.g. `{ x: '2vw', y: 0 }`.
   */
  bleed?: CanvasBleed;
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
   * Target render FPS.
   * - In pre-extracted mode, this controls how many frames are decoded into memory.
   * - In live mode, this throttles expensive ASCII frame rendering while the
   *   backing video continues decoding normally.
   *
   * Lower values use less CPU/memory and make scroll scrubbing cheaper.
   * Defaults to `18` for pre-extracted scroll scrub and unthrottled rendering
   * for normal live playback.
   */
  fps?: number;
  /**
   * Maximum long-edge render dimension for video frame extraction.
   * Raise this for full-width or 4K heroes so the canvas is not upscaled by CSS.
   * Default: `2048`.
   */
  maxRenderDimension?: number;
  /**
   * Trim the video to a specific time range (in seconds).
   * - `start` — seek to this time before playback begins. Default: `0`
   * - `end` — loop back to `start` when this time is reached.
   *   In `preExtract` mode, only frames up to `end` are extracted.
   *
   * @example
   * // Play only seconds 2–8, looping:
   * asciifyVideo('/clip.mp4', canvas, { trim: { start: 2, end: 8 } });
   */
  trim?: { start?: number; end?: number };
  /**
   * Sync video time to scroll progress.
   *
   * - `true` uses native scroll scrubbing with `fitTo`/canvas as the trigger.
   * - Passing `gsap` + `ScrollTrigger` uses GSAP ScrollTrigger.
   *
   * @example
   * await asciifyVideo('/hero.mp4', canvas, {
   *   fitTo: '#hero',
   *   scroll: true
   * });
   *
   * @example
   * await asciifyVideo('/hero.mp4', canvas, {
   *   fitTo: '#hero',
   *   scroll: { gsap, ScrollTrigger, start: 'top bottom', end: 'bottom top', scrub: 1 }
   * });
   */
  scroll?: boolean | VideoScrollScrubOptions;
  /**
   * Called once when the video metadata is loaded and playback has started.
   * Receives the backing video element.
   */
  onReady?: (video: HTMLVideoElement) => void;
  /**
   * Maximum number of decoded text frames kept in memory for live scroll scrub.
   * The cache is nearest-frame and bounded; lower values reduce memory for long
   * clips while preserving smooth scrubbing around the current scroll position.
   * Default: `90`.
   */
  maxCachedFrames?: number;
  /** Called after every rendered frame. */
  onFrame?: () => void;
}

/** @deprecated Use {@link AsciifyVideoOptions} */
export type AsciifyLiveVideoOptions = AsciifyVideoOptions;

// ─── Internal helpers ─────────────────────────────────────────────────────────

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function resolveElement(target?: HTMLElement | string | null): HTMLElement | null {
  if (typeof target === 'string') return document.querySelector<HTMLElement>(target);
  return target instanceof HTMLElement ? target : null;
}

function canUseFastTextFrame(options: AsciiOptions): boolean {
  return options.renderMode === 'ascii'
    && options.animationStyle === 'none'
    && options.hoverStrength <= 0
    && !options.charsetFrames?.length;
}

function mapScrollProgress(progress: number, opts: VideoScrollScrubOptions = {}): number {
  const raw = clamp01(progress);
  const speed = opts.speed === undefined ? 1 : Math.max(0.001, opts.speed);
  const accelerated = clamp01(raw * speed);
  return clamp01(opts.ease ? opts.ease(accelerated) : accelerated);
}

function syncVideoToProgress(video: HTMLVideoElement, progress: number, opts: VideoScrollScrubOptions = {}): void {
  if (!Number.isFinite(video.duration) || video.duration <= 0) return;

  const from = opts.from ?? 0;
  const to = opts.to ?? video.duration;
  const end = Math.max(from, Math.min(to, video.duration));
  const eased = mapScrollProgress(progress, opts);
  const targetTime = from + (end - from) * eased;
  video.currentTime = Math.min(Math.max(from, targetTime), Math.max(from, end - 0.04));
  opts.onUpdate?.(eased, video);
}

function progressToVideoTime(video: HTMLVideoElement, progress: number, opts: VideoScrollScrubOptions = {}): { progress: number; time: number } | null {
  if (!Number.isFinite(video.duration) || video.duration <= 0) return null;

  const from = opts.from ?? 0;
  const to = opts.to ?? video.duration;
  const end = Math.max(from, Math.min(to, video.duration));
  const eased = mapScrollProgress(progress, opts);
  const targetTime = from + (end - from) * eased;
  const time = Math.min(Math.max(from, targetTime), Math.max(from, end - 0.04));
  return { progress: eased, time };
}

function waitForSeek(video: HTMLVideoElement, time: number): Promise<void> {
  if (Math.abs(video.currentTime - time) < 1 / 240) {
    return waitForDecodedVideoFrame(video);
  }

  return new Promise(resolve => {
    const done = () => {
      video.removeEventListener('seeked', done);
      resolve();
    };
    video.addEventListener('seeked', done, { once: true });
    const fastSeek = (video as HTMLVideoElement & { fastSeek?: (time: number) => void }).fastSeek;
    if (fastSeek) fastSeek.call(video, time);
    else video.currentTime = time;
  });
}

function waitForDecodedVideoFrame(video: HTMLVideoElement): Promise<void> {
  const requestVideoFrameCallback = (video as HTMLVideoElement & {
    requestVideoFrameCallback?: (callback: () => void) => number;
  }).requestVideoFrameCallback;

  if (requestVideoFrameCallback) {
    return new Promise(resolve => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      requestVideoFrameCallback.call(video, finish);
      window.setTimeout(finish, 32);
    });
  }

  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

function createNativeVideoScrollScrub(
  video: HTMLVideoElement,
  trigger: HTMLElement,
  opts: VideoScrollScrubOptions,
): () => void {
  let raf = 0;

  const update = () => {
    raf = 0;
    const rect = trigger.getBoundingClientRect();
    const viewport = window.innerHeight || document.documentElement.clientHeight;
    const total = rect.height + viewport;
    const progress = total > 0 ? clamp01((viewport - rect.top) / total) : 0;
    syncVideoToProgress(video, progress, opts);
  };

  const requestUpdate = () => {
    if (raf) return;
    raf = requestAnimationFrame(update);
  };

  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate);
  requestUpdate();

  return () => {
    window.removeEventListener('scroll', requestUpdate);
    window.removeEventListener('resize', requestUpdate);
    if (raf) cancelAnimationFrame(raf);
  };
}

function createNativeProgressScrollScrub(
  trigger: HTMLElement,
  onProgress: (progress: number) => void,
): () => void {
  let raf = 0;

  const update = () => {
    raf = 0;
    const rect = trigger.getBoundingClientRect();
    const viewport = window.innerHeight || document.documentElement.clientHeight;
    const total = rect.height + viewport;
    const progress = total > 0 ? clamp01((viewport - rect.top) / total) : 0;
    onProgress(progress);
  };

  const requestUpdate = () => {
    if (raf) return;
    raf = requestAnimationFrame(update);
  };

  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate);
  requestUpdate();

  return () => {
    window.removeEventListener('scroll', requestUpdate);
    window.removeEventListener('resize', requestUpdate);
    if (raf) cancelAnimationFrame(raf);
  };
}

/**
 * Sync an HTMLVideoElement's currentTime to scroll progress.
 *
 * If `gsap` and `ScrollTrigger` are supplied, the helper uses GSAP. Otherwise
 * it falls back to a tiny native scroll listener. Returns a cleanup function.
 */
export function createVideoScrollScrub(
  video: HTMLVideoElement,
  opts: VideoScrollScrubOptions = {},
): () => void {
  const trigger = resolveElement(opts.trigger) ?? video;
  video.pause();

  const gsap = opts.gsap;
  const ScrollTrigger = opts.ScrollTrigger ?? gsap?.ScrollTrigger;
  if (gsap && ScrollTrigger?.create) {
    gsap.registerPlugin?.(ScrollTrigger);
    const instance = ScrollTrigger.create({
      trigger,
      start: opts.start ?? 'top bottom',
      end: opts.end ?? 'bottom top',
      scrub: opts.scrub ?? true,
      onUpdate: (self: { progress: number }) => syncVideoToProgress(video, self.progress, opts),
    });

    return () => instance.kill?.();
  }

  return createNativeVideoScrollScrub(video, trigger, opts);
}

function createProgressScrollScrub(
  trigger: HTMLElement,
  opts: VideoScrollScrubOptions,
  onProgress: (progress: number) => void,
): () => void {
  const gsap = opts.gsap;
  const ScrollTrigger = opts.ScrollTrigger ?? gsap?.ScrollTrigger;

  if (gsap && ScrollTrigger?.create) {
    gsap.registerPlugin?.(ScrollTrigger);
    const instance = ScrollTrigger.create({
      trigger,
      start: opts.start ?? 'top bottom',
      end: opts.end ?? 'bottom top',
      scrub: opts.scrub ?? true,
      onUpdate: (self: { progress: number }) => onProgress(self.progress),
    });

    return () => instance.kill?.();
  }

  return createNativeProgressScrollScrub(trigger, onProgress);
}

/** Get the intrinsic pixel dimensions of a media source. */
function getSourceDims(el: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement): { w: number; h: number } {
  if (el instanceof HTMLVideoElement) return { w: el.videoWidth, h: el.videoHeight };
  if (el instanceof HTMLImageElement) return { w: el.naturalWidth || el.width, h: el.naturalHeight || el.height };
  return { w: el.width, h: el.height };
}

function getEffectiveSourceDims(srcW: number, srcH: number, options: AsciiOptions): { w: number; h: number } {
  if (!srcW || !srcH || !options.sourceCrop) return { w: srcW, h: srcH };
  const crop = resolveSourceCrop(options.sourceCrop, srcW, srcH);
  return {
    w: Math.max(1, Math.round(crop.width)),
    h: Math.max(1, Math.round(crop.height)),
  };
}

function isChromaKeyPixel(r: number, g: number, b: number, options: AsciiOptions): boolean {
  const ck = options.chromaKey;
  if (ck == null || ck === false) return false;
  if (ck === true) return g > r * 1.4 && g > b * 1.4 && g > 80;
  if (ck === 'blue-screen') return b > r * 1.4 && b > g * 1.4 && b > 80;

  const key = parseChromaKeyColor(ck as string | { r: number; g: number; b: number });
  const tolSq = (options.chromaKeyTolerance ?? 60) ** 2;
  const dr = r - key.r;
  const dg = g - key.g;
  const db = b - key.b;
  return dr * dr + dg * dg + db * db <= tolSq;
}

function resolveChromaContentCrop(
  source: HTMLVideoElement | HTMLCanvasElement,
  options: AsciiOptions,
  targetAspect?: number,
): AsciiOptions {
  if (!options.chromaKey || !options.sourceCrop || options.chromaKeyTrimMode === 'off') return options;

  const srcW = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const srcH = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
  if (!srcW || !srcH) return options;

  const crop = resolveSourceCrop(options.sourceCrop, srcW, srcH);
  const sampleW = Math.min(360, Math.max(1, Math.round(crop.width)));
  const sampleH = Math.max(1, Math.round(sampleW * (crop.height / crop.width)));
  const { ctx } = createOffscreenCanvas(sampleW, sampleH);
  ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, sampleW, sampleH);

  const pixels = ctx.getImageData(0, 0, sampleW, sampleH).data;
  const minLuma = Math.max(0, Math.min(255, options.chromaKeyTrimLuminanceThreshold ?? 0));
  let minX = sampleW;
  let minY = sampleH;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < sampleH; y++) {
    for (let x = 0; x < sampleW; x++) {
      const i = (y * sampleW + x) * 4;
      const a = pixels[i + 3];
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (a <= 8 || luma <= minLuma || isChromaKeyPixel(r, g, b, options)) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) return options;

  const padding = Math.max(0, Math.min(0.25, options.chromaKeyTrimPadding ?? 0.002));
  const padX = Math.round(sampleW * padding);
  const padY = Math.round(sampleH * padding);
  minX = Math.max(0, minX - padX);
  minY = Math.max(0, minY - padY);
  maxX = Math.min(sampleW - 1, maxX + padX);
  maxY = Math.min(sampleH - 1, maxY + padY);

  const left = crop.x + (minX / sampleW) * crop.width;
  const top = crop.y + (minY / sampleH) * crop.height;
  const right = srcW - (crop.x + ((maxX + 1) / sampleW) * crop.width);
  const bottom = srcH - (crop.y + ((maxY + 1) / sampleH) * crop.height);
  const fitted = fitPixelInsetCropToAspect(
    { left, top, right, bottom },
    { x: crop.x, y: crop.y, width: crop.width, height: crop.height },
    srcW,
    srcH,
    targetAspect,
  );

  return {
    ...options,
    sourceCrop: {
      unit: 'pixel',
      ...fitted,
      preserveAspect: false,
    },
  };
}

function fitPixelInsetCropToAspect(
  inset: Required<Pick<NonNullable<AsciiOptions['sourceCrop']>, 'left' | 'top' | 'right' | 'bottom'>>,
  bounds: { x: number; y: number; width: number; height: number },
  srcW: number,
  srcH: number,
  targetAspect?: number,
): Required<Pick<NonNullable<AsciiOptions['sourceCrop']>, 'left' | 'top' | 'right' | 'bottom'>> {
  const aspect = targetAspect && Number.isFinite(targetAspect) && targetAspect > 0 ? targetAspect : null;
  if (!aspect) return inset;

  const minX = bounds.x;
  const minY = bounds.y;
  const maxX = bounds.x + bounds.width;
  const maxY = bounds.y + bounds.height;
  const boxLeft = Math.max(minX, inset.left);
  const boxTop = Math.max(minY, inset.top);
  const boxRight = Math.min(maxX, srcW - inset.right);
  const boxBottom = Math.min(maxY, srcH - inset.bottom);
  const boxW = Math.max(1, boxRight - boxLeft);
  const boxH = Math.max(1, boxBottom - boxTop);
  const centerX = boxLeft + boxW / 2;
  const centerY = boxTop + boxH / 2;
  let nextW = boxW;
  let nextH = boxH;

  if (nextW / nextH < aspect) {
    nextW = nextH * aspect;
  } else {
    nextH = nextW / aspect;
  }

  if (nextW > bounds.width) {
    nextW = bounds.width;
    nextH = Math.max(boxH, Math.min(bounds.height, nextW / aspect));
  }
  if (nextH > bounds.height) {
    nextH = bounds.height;
    nextW = Math.max(boxW, Math.min(bounds.width, nextH * aspect));
  }

  let x = centerX - nextW / 2;
  let y = centerY - nextH / 2;
  x = Math.max(minX, Math.min(maxX - nextW, x));
  y = Math.max(minY, Math.min(maxY - nextH, y));

  return {
    left: x,
    top: y,
    right: srcW - (x + nextW),
    bottom: srcH - (y + nextH),
  };
}

function getPixelInsetCrop(options: AsciiOptions): Required<Pick<NonNullable<AsciiOptions['sourceCrop']>, 'left' | 'top' | 'right' | 'bottom'>> | null {
  const crop = options.sourceCrop;
  if (!crop || crop.unit !== 'pixel') return null;
  if (crop.left === undefined || crop.top === undefined || crop.right === undefined || crop.bottom === undefined) return null;
  return { left: crop.left, top: crop.top, right: crop.right, bottom: crop.bottom };
}

function getVideoChromaSampleTimes(
  video: HTMLVideoElement,
  trimStart: number,
  trimEnd: number | undefined,
  scroll: AsciifyVideoOptions['scroll'],
): number[] {
  const scrollOpts = scroll === true ? {} : scroll || {};
  const start = Math.max(0, scrollOpts.from ?? trimStart);
  const rawEnd = scrollOpts.to ?? trimEnd ?? (Number.isFinite(video.duration) ? video.duration : start);
  const end = Math.max(start, rawEnd - 0.04);
  const duration = Math.max(0, end - start);
  const samples = duration > 0.1
    ? [start, start + duration * 0.25, start + duration * 0.5, start + duration * 0.75, end]
    : [start];

  return Array.from(new Set(samples.map(time => Math.max(0, Number(time.toFixed(3))))));
}

async function resolveVideoChromaContentCrop(
  video: HTMLVideoElement,
  options: AsciiOptions,
  trimStart: number,
  trimEnd: number | undefined,
  scroll: AsciifyVideoOptions['scroll'],
): Promise<AsciiOptions> {
  if (!options.chromaKey || !options.sourceCrop || options.chromaKeyTrimMode !== 'range') return options;

  const originalTime = video.currentTime;
  const sampleTimes = getVideoChromaSampleTimes(video, trimStart, trimEnd, scroll);
  let union: Required<Pick<NonNullable<AsciiOptions['sourceCrop']>, 'left' | 'top' | 'right' | 'bottom'>> | null = null;

  for (const time of sampleTimes) {
    await waitForSeek(video, time);
    await waitForDecodedVideoFrame(video);
    const measured = getPixelInsetCrop(resolveChromaContentCrop(video, options));
    if (!measured) continue;
    union = union
      ? {
        left: Math.min(union.left, measured.left),
        top: Math.min(union.top, measured.top),
        right: Math.min(union.right, measured.right),
        bottom: Math.min(union.bottom, measured.bottom),
      }
      : measured;
  }

  await waitForSeek(video, originalTime);
  await waitForDecodedVideoFrame(video);

  if (!union) return options;
  return {
    ...options,
    sourceCrop: {
      unit: 'pixel',
      ...union,
      preserveAspect: true,
    },
  };
}

/**
 * Compute high-quality render dimensions from source dims.
 * Returns render dimensions (capped at 2048 by default on the longer edge) that should be
 * used as the coordinate space for both `imageToAsciiFrame` and
 * `renderFrameToCanvas`.
 */
function computeRenderDims(srcW: number, srcH: number, maxRenderDimension: number = 2048): { renderW: number; renderH: number } {
  return computeCanvasRenderSize({
    sourceWidth: srcW,
    sourceHeight: srcH,
    maxRenderDimension,
  });
}

export interface CanvasRenderSizeInput {
  sourceWidth: number;
  sourceHeight: number;
  cssWidth?: number;
  cssHeight?: number;
  /** Accepted for callers that pass complete display context; DPR is applied separately by the canvas backing buffer. */
  dpr?: number;
  maxRenderDimension?: number;
}

export function computeCanvasRenderSize({
  sourceWidth,
  sourceHeight,
  cssWidth = 0,
  cssHeight = 0,
  maxRenderDimension = 2048,
}: CanvasRenderSizeInput): { renderW: number; renderH: number } {
  const srcW = Math.max(1, sourceWidth);
  const srcH = Math.max(1, sourceHeight);
  const aspect = srcW / srcH;
  const maxLongEdge = Math.max(1, maxRenderDimension);
  const sourceScale = Math.min(1, maxLongEdge / Math.max(srcW, srcH));
  const sourceLongEdge = Math.max(srcW, srcH) * sourceScale;
  const displayLongEdge = Math.max(0, cssWidth, cssHeight);
  const targetLongEdge = Math.min(maxLongEdge, Math.max(sourceLongEdge, displayLongEdge));

  if (aspect >= 1) {
    return {
      renderW: Math.round(targetLongEdge),
      renderH: Math.round(targetLongEdge / aspect),
    };
  }

  return {
    renderW: Math.round(targetLongEdge * aspect),
    renderH: Math.round(targetLongEdge),
  };
}

type CanvasLayoutOptions = Pick<AsciifyVideoOptions, 'objectFit' | 'objectPosition' | 'scale' | 'width' | 'height' | 'bleed'>;

function toCssLength(value: number | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'number' ? `${value}px` : value;
}

function resolveLayoutLength(
  value: number | string | undefined,
  containerLength: number,
  viewportW: number,
  viewportH: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return value;

  const trimmed = value.trim();
  if (trimmed.endsWith('%')) {
    const ratio = Number.parseFloat(trimmed) / 100;
    return Number.isFinite(ratio) ? containerLength * ratio : undefined;
  }
  if (trimmed.endsWith('px')) {
    const px = Number.parseFloat(trimmed);
    return Number.isFinite(px) ? px : undefined;
  }
  if (trimmed.endsWith('vw')) {
    const ratio = Number.parseFloat(trimmed) / 100;
    return Number.isFinite(ratio) ? viewportW * ratio : undefined;
  }
  if (trimmed.endsWith('vh')) {
    const ratio = Number.parseFloat(trimmed) / 100;
    return Number.isFinite(ratio) ? viewportH * ratio : undefined;
  }
  return undefined;
}

function resolveCanvasBleed(
  bleed: CanvasBleed | undefined,
  containerW: number,
  containerH: number,
  viewportW: number,
  viewportH: number,
): { x: number; y: number } {
  const resolveX = (value: number | string | undefined): number => {
    const resolved = resolveLayoutLength(value, containerW, viewportW, viewportH);
    return resolved && resolved > 0 ? resolved : 0;
  };
  const resolveY = (value: number | string | undefined): number => {
    const resolved = resolveLayoutLength(value, containerH, viewportW, viewportH);
    return resolved && resolved > 0 ? resolved : 0;
  };

  if (bleed === undefined) return { x: 0, y: 0 };
  if (typeof bleed === 'number' || typeof bleed === 'string') {
    return { x: resolveX(bleed), y: resolveY(bleed) };
  }

  return {
    x: resolveX(bleed.x),
    y: resolveY(bleed.y),
  };
}

function hasLayoutOptions(opts: CanvasLayoutOptions): boolean {
  return opts.objectFit !== undefined
    || opts.objectPosition !== undefined
    || opts.scale !== undefined
    || opts.width !== undefined
    || opts.height !== undefined
    || opts.bleed !== undefined;
}

function applyCanvasLayout(canvas: HTMLCanvasElement, opts: CanvasLayoutOptions): () => void {
  if (!hasLayoutOptions(opts)) return () => {};

  const previous = {
    width: canvas.style.width,
    height: canvas.style.height,
    objectFit: canvas.style.objectFit,
    objectPosition: canvas.style.objectPosition,
    maxWidth: canvas.style.maxWidth,
    maxHeight: canvas.style.maxHeight,
    transformOrigin: canvas.style.transformOrigin,
    scale: canvas.style.getPropertyValue('scale'),
  };

  if (opts.objectFit) canvas.style.objectFit = opts.objectFit;
  if (opts.objectPosition) {
    canvas.style.objectPosition = opts.objectPosition;
    canvas.style.transformOrigin = opts.objectPosition;
  }
  if (opts.scale !== undefined || opts.bleed !== undefined) {
    canvas.style.maxWidth = 'none';
    canvas.style.maxHeight = 'none';
  }
  if (opts.scale !== undefined) {
    const scale = Number.isFinite(opts.scale) && opts.scale > 0 ? opts.scale : 1;
    canvas.style.setProperty('scale', String(scale));
    canvas.style.transformOrigin ||= opts.objectPosition ?? 'center center';
  }

  return () => {
    canvas.style.width = previous.width;
    canvas.style.height = previous.height;
    canvas.style.objectFit = previous.objectFit;
    canvas.style.objectPosition = previous.objectPosition;
    canvas.style.maxWidth = previous.maxWidth;
    canvas.style.maxHeight = previous.maxHeight;
    canvas.style.transformOrigin = previous.transformOrigin;
    if (previous.scale) canvas.style.setProperty('scale', previous.scale);
    else canvas.style.removeProperty('scale');
  };
}

function computeFitSize(
  boxW: number,
  boxH: number,
  aspect: number,
  objectFit: CanvasObjectFit = 'contain',
): { cssW: number; cssH: number } {
  if (objectFit === 'fill') return { cssW: boxW, cssH: boxH };

  let cssW = boxW;
  let cssH = cssW / aspect;
  const shouldCover = objectFit === 'cover';
  const overflowsY = cssH > boxH;

  if ((shouldCover && !overflowsY) || (!shouldCover && overflowsY)) {
    cssH = boxH;
    cssW = cssH * aspect;
  }

  if (objectFit === 'scale-down') {
    cssW = Math.min(cssW, boxW);
    cssH = Math.min(cssH, boxH);
  }

  return { cssW: Math.round(cssW), cssH: Math.round(cssH) };
}

/**
 * Size the canvas to fit a container while maintaining aspect ratio.
 *
 * **Quality approach (matching the playground):**
 * - The canvas _buffer_ is set to source dimensions × DPR so characters are
 *   rendered at their natural font size (well above the 6 px fast-rect cutoff).
 * - `ctx.scale(dpr)` maps the source-sized coordinate space into the DPR-scaled
 *   buffer for crisp Retina text.
 * - CSS `width`/`height` is the container-fitted display size — the browser's
 *   compositor handles the high-quality visual down-scale.
 *
 * Returns the render dimensions and DPR factor the caller should use for
 * all subsequent `imageToAsciiFrame` / `renderFrameToCanvas` calls.
 */
function sizeCanvasToContainer(
  canvas: HTMLCanvasElement,
  container: HTMLElement,
  aspect: number,
  srcW?: number,
  srcH?: number,
  maxRenderDimension: number = 2048,
  layoutOptions: CanvasLayoutOptions = {},
): { renderW: number; renderH: number; dpr: number } {
  const { width: containerW, height: containerH } = container.getBoundingClientRect();
  if (!containerW || !containerH) return { renderW: 0, renderH: 0, dpr: 1 };

  // CSS display size — computed in the engine so crop/layout never stretches.
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : containerW;
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : containerH;
  const baseBoxW = resolveLayoutLength(layoutOptions.width, containerW, viewportW, viewportH) ?? containerW;
  const baseBoxH = resolveLayoutLength(layoutOptions.height, containerH, viewportW, viewportH) ?? containerH;
  const bleed = resolveCanvasBleed(layoutOptions.bleed, containerW, containerH, viewportW, viewportH);
  const boxW = baseBoxW + bleed.x * 2;
  const boxH = baseBoxH + bleed.y * 2;
  const { cssW, cssH } = computeFitSize(boxW, boxH, aspect, layoutOptions.objectFit ?? 'contain');

  const rawDpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;

  // Render dimensions = source/canvas display size (capped) for high-quality frame generation.
  // Fall back to CSS size when no source dims are available.
  let renderW: number, renderH: number;
  if (srcW && srcH) {
    ({ renderW, renderH } = computeCanvasRenderSize({
      sourceWidth: srcW,
      sourceHeight: srcH,
      cssWidth: cssW,
      cssHeight: cssH,
      dpr: rawDpr,
      maxRenderDimension,
    }));
  } else {
    renderW = cssW;
    renderH = cssH;
  }

  // DPR for crisp Retina text, capped so the total buffer stays ≤ ~8 MP.
  const MAX_PX = 8_000_000;
  const cappedDpr = (renderW * rawDpr * renderH * rawDpr > MAX_PX)
    ? Math.sqrt(MAX_PX / (renderW * renderH))
    : rawDpr;

  canvas.width  = Math.round(renderW * cappedDpr);
  canvas.height = Math.round(renderH * cappedDpr);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;

  return { renderW, renderH, dpr: cappedDpr };
}

/**
 * Convert an image/video/canvas element to ASCII art and render it onto a canvas.
 *
 * When hover options are active (`hoverStrength > 0` in `options`), the engine
 * automatically sets up mouse tracking and a `requestAnimationFrame` loop so
 * the hover effect works out of the box. In that case, a `stop()` function is
 * returned to tear down the loop and listeners.
 *
 * @example
 * // Static (no hover):
 * await asciify('/photo.jpg', canvas);
 *
 * // With hover — returns a cleanup handle:
 * const stop = await asciify('/photo.jpg', canvas, {
 *   options: { hoverEffect: 'glitchText', hoverStrength: 0.8, hoverText: 'HI' }
 * });
 * // later: stop?.();
 */
export async function asciify(
  source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | string,
  canvas: HTMLCanvasElement,
  { fontSize, artStyle = 'classic', options = {} }: AsciifySimpleOptions = {}
): Promise<(() => void) | void> {
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
  const resolvedFontSize = fontSize ?? options.fontSize ?? 10;
  const merged: AsciiOptions = { ...DEFAULT_OPTIONS, ...preset, ...options, fontSize: resolvedFontSize };

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2d context from canvas');

  // Use source dims for frame gen → maximum detail.
  const { w: srcW, h: srcH } = getSourceDims(el);
  const { renderW, renderH } = computeRenderDims(srcW, srcH);

  // DPR scaling for crisp Retina text
  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
  const MAX_PX = 8_000_000;
  const cappedDpr = (renderW * dpr * renderH * dpr > MAX_PX)
    ? Math.sqrt(MAX_PX / (renderW * renderH))
    : dpr;

  if (canvas.width < renderW || canvas.height < renderH) {
    canvas.width  = Math.round(renderW * cappedDpr);
    canvas.height = Math.round(renderH * cappedDpr);
  }

  // ── Hover-interactive mode ──────────────────────────────────────────
  // When hoverStrength > 0, set up mouse tracking + RAF loop automatically.
  if (merged.hoverStrength > 0) {
    const { frame } = imageToAsciiFrame(el, merged, renderW, renderH);
    let hoverPos: { x: number; y: number } | null = null;
    let cancelled = false;
    let rafId = 0;

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      hoverPos = {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
      };
    };
    const onMouseLeave = () => { hoverPos = null; };

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseleave', onMouseLeave);

    const tick = (t: number) => {
      if (cancelled) return;
      ctx.save();
      ctx.setTransform(cappedDpr, 0, 0, cappedDpr, 0, 0);
      renderFrameToCanvas(ctx, frame, merged, renderW, renderH, t / 1000, hoverPos);
      ctx.restore();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', onMouseLeave);
    };
  }

  // ── Static mode (no hover) ─────────────────────────────────────────
  ctx.save();
  ctx.setTransform(cappedDpr, 0, 0, cappedDpr, 0, 0);
  if (canUseFastTextFrame(merged)) {
    const frame = imageToAsciiTextFrame(el, merged, renderW, renderH);
    renderTextFrameToCanvas(ctx, frame, merged, renderW, renderH);
  } else {
    const { frame } = imageToAsciiFrame(el, merged, renderW, renderH);
    renderFrameToCanvas(ctx, frame, merged, renderW, renderH);
  }
  ctx.restore();
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
  { fontSize, artStyle = 'classic', options = {} }: AsciifySimpleOptions = {}
): Promise<() => void> {
  const buffer = typeof source === 'string'
    ? await fetch(source).then(r => r.arrayBuffer())
    : source;

  const resolvedFontSize = fontSize ?? options.fontSize ?? 10;
  let merged: AsciiOptions = { ...DEFAULT_OPTIONS, ...ART_STYLE_PRESETS[artStyle], ...options, fontSize: resolvedFontSize };
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2d context from canvas');

  if (canUseFastTextFrame(merged)) {
    const { frames, fps } = await gifToAsciiTextFrames(buffer, merged, canvas.width, canvas.height);
    let cancelled = false;
    let animId: number;
    let i = 0;
    let last = performance.now();
    const interval = 1000 / fps;

    const tick = (now: number) => {
      if (cancelled) return;
      if (now - last >= interval) {
        renderTextFrameToCanvas(ctx, frames[i], merged, canvas.width, canvas.height);
        i = (i + 1) % frames.length;
        last = now;
      }
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);

    return () => { cancelled = true; cancelAnimationFrame(animId); };
  }

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
  {
    fontSize,
    artStyle = 'classic',
    options = {},
    fitTo,
    objectFit,
    objectPosition,
    scale,
    width,
    height,
    bleed,
    preExtract = false,
    fps,
    maxRenderDimension = 2048,
    trim,
    scroll,
    maxCachedFrames = 90,
    onReady,
    onFrame,
  }: AsciifyVideoOptions = {}
): Promise<() => void> {
  const trimStart = trim?.start ?? 0;
  const trimEnd   = trim?.end;
  const resolvedFontSize = fontSize ?? options.fontSize ?? 10;
  let merged: AsciiOptions = { ...DEFAULT_OPTIONS, ...ART_STYLE_PRESETS[artStyle], ...options, fontSize: resolvedFontSize };
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('asciifyVideo: could not get 2d context from canvas.');
  const container: HTMLElement | null =
    typeof fitTo === 'string' ? document.querySelector<HTMLElement>(fitTo) :
    fitTo instanceof HTMLElement ? fitTo : null;
  const layoutOptions: CanvasLayoutOptions = { objectFit, objectPosition, scale, width, height, bleed };
  const restoreCanvasLayout = applyCanvasLayout(canvas, layoutOptions);
  const withCanvasLayoutCleanup = (cleanup: () => void): (() => void) => {
    return () => {
      cleanup();
      restoreCanvasLayout();
    };
  };

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

    merged = await resolveVideoChromaContentCrop(video, merged, trimStart, trimEnd, scroll);
    const effectivePreExtractSource = getEffectiveSourceDims(video.videoWidth, video.videoHeight, merged);
    if (container) sizeCanvasToContainer(canvas, container, effectivePreExtractSource.w / effectivePreExtractSource.h, effectivePreExtractSource.w, effectivePreExtractSource.h, maxRenderDimension, layoutOptions);

    // Render dimensions = effective cropped source size for maximum detail without stretching
    const { renderW, renderH } = computeRenderDims(effectivePreExtractSource.w, effectivePreExtractSource.h, maxRenderDimension);

    // Compute DPR for the canvas buffer
    const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
    const MAX_PX = 8_000_000;
    const cappedDpr = (renderW * dpr * renderH * dpr > MAX_PX)
      ? Math.sqrt(MAX_PX / (renderW * renderH))
      : dpr;

    // Ensure buffer is large enough
    if (canvas.width < Math.round(renderW * cappedDpr)) {
      canvas.width  = Math.round(renderW * cappedDpr);
      canvas.height = Math.round(renderH * cappedDpr);
    }

    const maxDur = trimEnd !== undefined ? trimEnd - trimStart : 10;
    const extractFps = fps ?? (scroll ? 18 : undefined);

    if (canUseFastTextFrame(merged)) {
      const { frames, fps: extractedFps } = await videoToAsciiTextFrames(video, merged, renderW, renderH, extractFps, maxDur, undefined, trimStart);
      const renderFrame = (index: number) => {
        const frame = frames[index];
        if (!frame) return;
        ctx.save();
        ctx.setTransform(cappedDpr, 0, 0, cappedDpr, 0, 0);
        renderTextFrameToCanvas(ctx, frame, merged, renderW, renderH);
        ctx.restore();
        onFrame?.();
      };

      if (scroll) {
        let ready = false;
        let lastIndex = -1;
        const scrollOpts: VideoScrollScrubOptions = scroll === true ? {} : scroll;
        const trigger = resolveElement(scrollOpts.trigger) ?? container ?? canvas;
        const cleanup = createProgressScrollScrub(trigger, scrollOpts, progress => {
          const eased = mapScrollProgress(progress, scrollOpts);
          const index = Math.max(0, Math.min(frames.length - 1, Math.round(eased * (frames.length - 1))));
          if (index === lastIndex) return;
          lastIndex = index;
          renderFrame(index);
          if (!ready) { ready = true; onReady?.(video); }
          scrollOpts.onUpdate?.(eased, video);
        });
        renderFrame(0);
        ready = true;
        onReady?.(video);
        return withCanvasLayoutCleanup(cleanup);
      }

      let cancelled = false, animId: number, i = 0, last = performance.now();
      let firstFrame = true;
      const interval = 1000 / extractedFps;
      const tick = (now: number) => {
        if (cancelled) return;
        if (now - last >= interval) {
          renderFrame(i);
          i = (i + 1) % frames.length;
          last = now;
          if (firstFrame) { firstFrame = false; onReady?.(video); }
        }
        animId = requestAnimationFrame(tick);
      };
      animId = requestAnimationFrame(tick);
      return withCanvasLayoutCleanup(() => { cancelled = true; cancelAnimationFrame(animId); });
    }

    const { frames, fps: extractedFps } = await videoToAsciiFrames(video, merged, renderW, renderH, extractFps, maxDur, undefined, trimStart);
    const renderFrame = (index: number) => {
      const frame = frames[index];
      if (!frame) return;
      ctx.save();
      ctx.setTransform(cappedDpr, 0, 0, cappedDpr, 0, 0);
      renderFrameToCanvas(ctx, frame, merged, renderW, renderH);
      ctx.restore();
      onFrame?.();
    };

    if (scroll) {
      let ready = false;
      let lastIndex = -1;
      const scrollOpts: VideoScrollScrubOptions = scroll === true ? {} : scroll;
      const trigger = resolveElement(scrollOpts.trigger) ?? container ?? canvas;
      const cleanup = createProgressScrollScrub(trigger, scrollOpts, progress => {
        const eased = mapScrollProgress(progress, scrollOpts);
        const index = Math.max(0, Math.min(frames.length - 1, Math.round(eased * (frames.length - 1))));
        if (index === lastIndex) return;
        lastIndex = index;
        renderFrame(index);
        if (!ready) { ready = true; onReady?.(video); }
        scrollOpts.onUpdate?.(eased, video);
      });
      renderFrame(0);
      ready = true;
      onReady?.(video);
      return withCanvasLayoutCleanup(cleanup);
    }

    let cancelled = false, animId: number, i = 0, last = performance.now();
    let firstFrame = true;
    const interval = 1000 / extractedFps;
    const tick = (now: number) => {
      if (cancelled) return;
      if (now - last >= interval) {
        renderFrame(i);
        i = (i + 1) % frames.length;
        last = now;
        if (firstFrame) { firstFrame = false; onReady?.(video); }
      }
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
    return withCanvasLayoutCleanup(() => { cancelled = true; cancelAnimationFrame(animId); });
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
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          video.removeEventListener('loadedmetadata', onLoaded);
          video.removeEventListener('error', onError);
        };
        const onLoaded = () => { cleanup(); resolve(); };
        const onError = () => {
          cleanup();
          reject(new Error('asciifyVideo: provided video element failed to load metadata.'));
        };
        video.addEventListener('loadedmetadata', onLoaded);
        video.addEventListener('error', onError);
        video.load();
      });
    }
    if (video.paused) await video.play().catch(() => {});
  }

  // Apply trim start
  if (trimStart > 0) {
    video.currentTime = trimStart;
    await new Promise<void>(resolve => {
      const h = () => { video.removeEventListener('seeked', h); resolve(); };
      video.addEventListener('seeked', h);
    });
    await waitForDecodedVideoFrame(video);
  }

  // Enforce trim bounds — seek back to trimStart when the video loops to 0
  // or when currentTime exceeds trimEnd.
  let timeupdateHandler: (() => void) | null = null;
  if (trimStart > 0 || trimEnd !== undefined) {
    timeupdateHandler = () => {
      if (trimEnd !== undefined && video.currentTime >= trimEnd) { video.currentTime = trimStart; }
      else if (trimStart > 0 && video.currentTime < trimStart)  { video.currentTime = trimStart; }
    };
    video.addEventListener('timeupdate', timeupdateHandler);
  }

  merged = await resolveVideoChromaContentCrop(video, merged, trimStart, trimEnd, scroll);

  let ro: ResizeObserver | null = null;
  // Render dimensions = effective cropped source size for maximum detail without stretching.
  const effectiveLiveSource = getEffectiveSourceDims(video.videoWidth, video.videoHeight, merged);
  const { renderW, renderH } = computeRenderDims(effectiveLiveSource.w, effectiveLiveSource.h, maxRenderDimension);
  const trimFrameToRenderAspect = (sourceFrame: HTMLVideoElement): AsciiOptions =>
    merged.chromaKeyTrimMode === 'frame'
      ? resolveChromaContentCrop(sourceFrame, merged, renderW / renderH)
      : merged;

  if (container) {
    const aspect = effectiveLiveSource.w / effectiveLiveSource.h;
    const vw = effectiveLiveSource.w, vh = effectiveLiveSource.h;
    const sizing = sizeCanvasToContainer(canvas, container, aspect, vw, vh, maxRenderDimension, layoutOptions);
    // Apply DPR scale transform once — will be refreshed on resize
    const sCtx = canvas.getContext('2d');
    if (sCtx) sCtx.setTransform(sizing.dpr, 0, 0, sizing.dpr, 0, 0);

    ro = new ResizeObserver(() => {
      const s = sizeCanvasToContainer(canvas, container, aspect, vw, vh, maxRenderDimension, layoutOptions);
      const rCtx = canvas.getContext('2d');
      if (rCtx) rCtx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    });
    ro.observe(container);
  } else {
    // No container — set up buffer at source dims for quality
    const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
    const MAX_PX = 8_000_000;
    const cappedDpr = (renderW * dpr * renderH * dpr > MAX_PX)
      ? Math.sqrt(MAX_PX / (renderW * renderH))
      : dpr;
    if (canvas.width < Math.round(renderW * cappedDpr)) {
      canvas.width  = Math.round(renderW * cappedDpr);
      canvas.height = Math.round(renderH * cappedDpr);
    }
    ctx.setTransform(cappedDpr, 0, 0, cappedDpr, 0, 0);
  }

  let cancelled = false;
  let animId: number;
  let firstFrame = true;
  let scrollCleanup: (() => void) | null = null;
  const enableScrollScrub = scroll && !preExtract;
  const renderInterval = fps && fps > 0 ? 1000 / fps : 0;
  let lastRenderAt = 0;
  let lastRenderedVideoTime = -1;

  const canUseFastLiveTextFrames = !enableScrollScrub && canUseFastTextFrame(merged);

  const canUseTextFrameCache =
    enableScrollScrub &&
    merged.renderMode === 'ascii' &&
    merged.animationStyle === 'none' &&
    merged.hoverStrength <= 0 &&
    !merged.charsetFrames?.length;

  if (canUseTextFrameCache) {
    const scrollOpts: VideoScrollScrubOptions = scroll === true ? {} : scroll;
    const trigger = resolveElement(scrollOpts.trigger) ?? container ?? canvas;
    const from = scrollOpts.from ?? trimStart;
    const to = scrollOpts.to ?? trimEnd ?? video.duration;
    const end = Math.max(from, Math.min(to, video.duration));
    const duration = Math.max(0.001, end - from);
    const cacheFps = Math.min(60, Math.max(12, fps ?? 30));
    const totalFrames = Math.max(2, Math.ceil(duration * cacheFps) + 1);
    const frames: Array<AsciiTextFrame | undefined> = new Array(totalFrames);
    const cachedIndices: number[] = [];
    const cacheLimit = Math.max(2, Math.min(totalFrames, Math.floor(maxCachedFrames)));
    const evictStaleFrames = () => {
      while (cachedIndices.length > cacheLimit) {
        const staleIndex = cachedIndices.findIndex(index => index !== desiredIndex && Math.abs(index - desiredIndex) > 2);
        const removeAt = staleIndex >= 0 ? staleIndex : 0;
        const stale = cachedIndices.splice(removeAt, 1)[0];
        if (stale !== undefined) frames[stale] = undefined;
      }
    };

    const markCached = (index: number) => {
      const existing = cachedIndices.indexOf(index);
      if (existing >= 0) cachedIndices.splice(existing, 1);
      cachedIndices.push(index);
      evictStaleFrames();
    };

    let desiredIndex = 0;
    let desiredProgress = 0;
    let lastPaintedIndex = -1;
    let raf = 0;
    let cancelledCache = false;
    let extracting = false;
    let ready = false;
    const queued = new Set<number>();

    const cacheVideo = document.createElement('video');
    cacheVideo.muted = true;
    cacheVideo.playsInline = true;
    cacheVideo.preload = 'auto';
    cacheVideo.crossOrigin = video.crossOrigin || 'anonymous';
    cacheVideo.src = video.currentSrc || video.src;
    Object.assign(cacheVideo.style, {
      position: 'fixed', top: '0', left: '0',
      width: '1px', height: '1px',
      opacity: '0', pointerEvents: 'none', zIndex: '-1',
    });
    document.body.appendChild(cacheVideo);
    if (cacheVideo.readyState < HTMLMediaElement.HAVE_METADATA) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          cacheVideo.removeEventListener('loadedmetadata', onLoaded);
          cacheVideo.removeEventListener('error', onError);
        };
        const onLoaded = () => { cleanup(); resolve(); };
        const onError = () => {
          cleanup();
          reject(new Error('asciifyVideo: cache video failed to load metadata.'));
        };
        cacheVideo.addEventListener('loadedmetadata', onLoaded);
        cacheVideo.addEventListener('error', onError);
        cacheVideo.load();
      });
    }
    cacheVideo.pause();
    if (video.paused) await video.play().catch(() => {});

    const frameTime = (index: number) => from + (duration * index) / Math.max(1, totalFrames - 1);
    const indexForProgress = (progress: number) => Math.max(0, Math.min(totalFrames - 1, Math.round(progress * (totalFrames - 1))));

    const initialOptions = trimFrameToRenderAspect(video);
    const initial = imageToAsciiTextFrame(video, initialOptions, renderW, renderH);
    if (initial.rows.length > 0) {
      frames[0] = initial;
      markCached(0);
      renderTextFrameToCanvas(ctx, initial, initialOptions, renderW, renderH);
      ready = true;
      onReady?.(video);
      onFrame?.();
    }

    const nearestCachedIndex = (index: number): number => {
      if (frames[index]) return index;
      for (let radius = 1; radius < totalFrames; radius++) {
        const left = index - radius;
        const right = index + radius;
        if (left >= 0 && frames[left]) return left;
        if (right < totalFrames && frames[right]) return right;
      }
      return -1;
    };

    const pickNextIndex = (): number => {
      if (!frames[desiredIndex]) return desiredIndex;
      for (const index of queued) {
        if (!frames[index]) return index;
      }
      for (let radius = 1; radius < totalFrames; radius++) {
        const left = desiredIndex - radius;
        const right = desiredIndex + radius;
        if (left >= 0 && !frames[left]) return left;
        if (right < totalFrames && !frames[right]) return right;
      }
      return -1;
    };

    const requestIndex = (index: number) => {
      if (index < 0 || index >= totalFrames || frames[index]) return;
      queued.add(index);
      void pump();
    };

    const pump = async () => {
      if (cancelledCache || extracting) return;
      const index = pickNextIndex();
      if (index < 0) return;
      queued.delete(index);
      extracting = true;
      try {
        await waitForSeek(cacheVideo, frameTime(index));
        if (!cancelledCache) {
          const frameOptions = trimFrameToRenderAspect(cacheVideo);
          const frame = imageToAsciiTextFrame(cacheVideo, frameOptions, renderW, renderH);
          if (frame.rows.length > 0) {
            frames[index] = frame;
            markCached(index);
          }
        }
      } finally {
        extracting = false;
        if (!cancelledCache) requestAnimationFrame(() => void pump());
      }
    };

    const paint = () => {
      if (cancelledCache) return;
      const index = nearestCachedIndex(desiredIndex);
      if (index >= 0 && index !== lastPaintedIndex) {
        const frame = frames[index];
        if (frame) {
          renderTextFrameToCanvas(ctx, frame, merged, renderW, renderH);
          lastPaintedIndex = index;
          if (!ready) { ready = true; onReady?.(video); }
          onFrame?.();
        }
      } else if (index < 0 || lastPaintedIndex < 0) {
        const now = performance.now();
        if (renderInterval <= 0 || now - lastRenderAt >= renderInterval) {
          const liveOptions = trimFrameToRenderAspect(video);
          const liveFrame = imageToAsciiTextFrame(video, liveOptions, renderW, renderH);
          if (liveFrame.rows.length > 0) {
            renderTextFrameToCanvas(ctx, liveFrame, liveOptions, renderW, renderH);
            lastRenderAt = now;
            if (!ready) { ready = true; onReady?.(video); }
            onFrame?.();
          }
        }
      }
      requestIndex(desiredIndex);
      raf = requestAnimationFrame(paint);
    };

    scrollCleanup = createProgressScrollScrub(trigger, scrollOpts, progress => {
      const mapped = progressToVideoTime(video, progress, { ...scrollOpts, from, to: end });
      desiredProgress = mapped?.progress ?? clamp01(progress);
      desiredIndex = indexForProgress(desiredProgress);
      requestIndex(desiredIndex);
      requestIndex(desiredIndex - 1);
      requestIndex(desiredIndex + 1);
      requestIndex(desiredIndex - 2);
      requestIndex(desiredIndex + 2);
      requestIndex(desiredIndex - 3);
      requestIndex(desiredIndex + 3);
      scrollOpts.onUpdate?.(desiredProgress, video);
    });

    requestIndex(0);
    requestIndex(1);
    raf = requestAnimationFrame(paint);

    return withCanvasLayoutCleanup(() => {
      cancelledCache = true;
      cancelAnimationFrame(raf);
      scrollCleanup?.();
      ro?.disconnect();
      queued.clear();
      cachedIndices.length = 0;
      frames.fill(undefined);
      cacheVideo.pause();
      cacheVideo.src = '';
      cacheVideo.removeAttribute('src');
      cacheVideo.load();
      if (cacheVideo.isConnected) cacheVideo.remove();
      if (timeupdateHandler) video.removeEventListener('timeupdate', timeupdateHandler);
      if (ownedVideo) {
        video.pause();
        video.src = '';
        video.removeAttribute('src');
        video.load();
        if (video.isConnected) video.remove();
      }
    });
  }

  if (enableScrollScrub) {
    const scrollOpts: VideoScrollScrubOptions = scroll === true ? {} : scroll;
    scrollCleanup = createVideoScrollScrub(video, {
      ...scrollOpts,
      trigger: scrollOpts.trigger ?? container ?? canvas,
      from: scrollOpts.from ?? trimStart,
      to: scrollOpts.to ?? trimEnd,
    });
  }

  const tick = (now: number) => {
    if (cancelled) return;
    animId = requestAnimationFrame(tick);
    if (video.readyState < 2 || canvas.width === 0 || canvas.height === 0) return;
    if (renderInterval > 0 && now - lastRenderAt < renderInterval) return;
    // Skip frames outside trim window (prevents flash at time 0 on loop)
    if (trimStart > 0 && video.currentTime < trimStart) return;
    if (trimEnd !== undefined && video.currentTime >= trimEnd) return;
    if (enableScrollScrub && Math.abs(video.currentTime - lastRenderedVideoTime) < 1 / 240) return;

    if (canUseFastLiveTextFrames) {
      const frameOptions = trimFrameToRenderAspect(video);
      const frame = imageToAsciiTextFrame(video, frameOptions, renderW, renderH);
      if (frame.rows.length > 0) {
        renderTextFrameToCanvas(ctx, frame, frameOptions, renderW, renderH);
        lastRenderAt = now;
        lastRenderedVideoTime = video.currentTime;
        if (firstFrame) { firstFrame = false; onReady?.(video); }
        onFrame?.();
      }
      return;
    }

    const frameOptions = trimFrameToRenderAspect(video);
    const { frame } = imageToAsciiFrame(video, frameOptions, renderW, renderH);
    if (frame.length > 0) {
      renderFrameToCanvas(ctx, frame, merged, renderW, renderH, 0, null);
      lastRenderAt = now;
      lastRenderedVideoTime = video.currentTime;
      if (firstFrame) { firstFrame = false; onReady?.(video); }
      onFrame?.();
    }
  };
  animId = requestAnimationFrame(tick);

  return withCanvasLayoutCleanup(() => {
    cancelled = true;
    cancelAnimationFrame(animId);
    scrollCleanup?.();
    ro?.disconnect();
    if (timeupdateHandler) video.removeEventListener('timeupdate', timeupdateHandler);
    if (ownedVideo) {
      video.pause();
      video.src = '';
      video.removeAttribute('src');
      video.load();
      if (video.isConnected) video.remove();
    }
  });
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
