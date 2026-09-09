import { createStudioRenderer } from "./renderer";
import { loadStudioMedia, type StudioMedia } from "./media";
import {
  normalizeStudioSettings,
  studioDimensions,
  type StudioInput,
  updateStudioSettings,
} from "./model";
export interface MountStudioOptions {
  settings?: StudioInput;
  width?: number;
  height?: number;
  fps?: number;
  maxDimension?: number;
  maxCells?: number;
  adaptive?: boolean;
  onQualityChange?: (maxCells: number) => void;
  signal?: AbortSignal;
  onError?: (error: Error) => void;
  onFrame?: (time: number, costMs: number) => void;
}
/** Mount one source, update serializable settings, and destroy on unmount. */
export async function mountStudio(
  canvas: HTMLCanvasElement,
  source: File | string,
  options: MountStudioOptions = {},
) {
  const media = await loadStudioMedia(source, options.signal);
  try {
    return mountStudioMedia(canvas, media, options);
  } catch (error) {
    media.destroy();
    throw error;
  }
}
/** Takes ownership of media. Use a second media instance for export. */
export function mountStudioMedia(
  canvas: HTMLCanvasElement,
  media: StudioMedia,
  options: MountStudioOptions = {},
) {
  let settings = normalizeStudioSettings(options.settings),
    width = options.width ?? media.width,
    height = options.height ?? media.height;
  const renderer = createStudioRenderer(canvas, settings, options);
  let frame = 0,
    disposed = false,
    dirty = true,
    paused = false,
    visible = true,
    time = 0,
    last = 0,
    painted = 0,
    videoFrame = -1;
  let samples = 0,
    costAverage = 0,
    overBudget = 0;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const video = media.source instanceof HTMLVideoElement ? media.source : null;
  const wake = () => {
    if (!disposed && !frame && visible && !document.hidden)
      frame = requestAnimationFrame(tick);
  };
  const shouldPlay = () =>
    !paused && !reduced.matches && visible && !document.hidden;
  const motion = () => {
    if (video) {
      video.loop = true;
      if (shouldPlay())
        void video.play().catch(() => {
          paused = true;
          dirty = true;
          wake();
        });
      else video.pause();
    }
    last = 0;
    dirty = true;
    wake();
  };
  function tick(now: number) {
    frame = 0;
    if (disposed || !visible || document.hidden) return;
    const moving = shouldPlay();
    if (moving) time += last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    const animated =
      moving &&
      (media.animated ||
        settings.motion.type !== "none" ||
        settings.dither.motion !== "none" ||
        settings.effects.grain > 0 ||
        settings.effects.dust > 0 ||
        settings.effects.glitch > 0);
    const decoded = video?.getVideoPlaybackQuality?.().totalVideoFrames ?? -1;
    const needsMotion =
      settings.motion.type !== "none" ||
      settings.dither.motion !== "none" ||
      settings.effects.grain > 0 ||
      settings.effects.dust > 0 ||
      settings.effects.glitch > 0;
    const sourceChanged = !video || decoded < 0 || decoded !== videoFrame;
    const due =
      dirty ||
      renderer.active ||
      (animated &&
        (sourceChanged || needsMotion) &&
        now - painted >=
          1000 / Math.max(1, Math.min(60, options.fps ?? 60)) - 0.5);
    if (due) {
      const start = performance.now();
      try {
        if (media.animated && !video) renderer.invalidate();
        const [w, h] = studioDimensions(width, height, settings);
        renderer.render(media.frame(video?.currentTime ?? time), time, w, h);
        const cost = performance.now() - start;
        options.onFrame?.(video?.currentTime ?? time, cost);
        costAverage = costAverage ? costAverage * 0.9 + cost * 0.1 : cost;
        if (++samples > 20 && options.adaptive !== false) {
          overBudget = costAverage > 13 ? overBudget + 1 : 0;
          if (overBudget >= 12 && renderer.maxCells > 3000) {
            renderer.setBudget(Math.max(3000, renderer.maxCells * 0.8));
            options.onQualityChange?.(renderer.maxCells);
            overBudget = 0;
            costAverage = 0;
          }
        }
      } catch (error) {
        paused = true;
        options.onError?.(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
      dirty = false;
      painted = now;
      videoFrame = decoded;
    }
    if (moving && (animated || renderer.active)) wake();
  }
  const move = (e: PointerEvent) => {
    if (!shouldPlay()) return;
    const rect = canvas.getBoundingClientRect();
    renderer.pointer(
      (e.clientX - rect.left) / rect.width,
      (e.clientY - rect.top) / rect.height,
      e.timeStamp,
    );
    wake();
  };
  const leave = () => {
    renderer.leave();
    wake();
  };
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    motion();
  });
  observer.observe(canvas);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerleave", leave);
  canvas.addEventListener("pointercancel", leave);
  document.addEventListener("visibilitychange", motion);
  reduced.addEventListener("change", motion);
  const destroy = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerleave", leave);
    canvas.removeEventListener("pointercancel", leave);
    document.removeEventListener("visibilitychange", motion);
    reduced.removeEventListener("change", motion);
    options.signal?.removeEventListener("abort", destroy);
    renderer.destroy();
    media.destroy();
  };
  options.signal?.addEventListener("abort", destroy, { once: true });
  if (options.signal?.aborted) {
    destroy();
    throw new DOMException("Cancelled", "AbortError");
  }
  motion();
  return {
    canvas,
    media,
    update(next: StudioInput) {
      settings = updateStudioSettings(settings, next);
      renderer.configure(settings);
      dirty = true;
      wake();
    },
    resize(w: number, h: number) {
      width = Math.max(2, w);
      height = Math.max(2, h);
      dirty = true;
      wake();
    },
    pause(value = true) {
      paused = value;
      motion();
    },
    async seek(seconds: number) {
      time = Math.max(0, seconds);
      await media.seek(time);
      renderer.invalidate();
      dirty = true;
      wake();
    },
    redraw() {
      renderer.invalidate();
      dirty = true;
      wake();
    },
    get time() {
      return video?.currentTime ?? time;
    },
    get paused() {
      return paused || reduced.matches;
    },
    get maxCells() {
      return renderer.maxCells;
    },
    get capabilities() {
      return renderer.capabilities;
    },
    destroy,
  };
}
