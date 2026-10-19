import { hasAnimatedEffects } from './activity';
import { AmbientTimeline } from '../surface/ambient-motion';
import { createStudioRenderer } from "./renderer";
import { createWorkerStudioRenderer, loadStudioWorker, studioWorkerSupported, type WorkerStudioRenderer } from "./worker-renderer";
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
  // The render worker's script loads while the media does.
  if (studioWorkerSupported()) void loadStudioWorker();
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
  // The page's main thread only posts input: the worker draws, so hover runs at the display's rate and never blocks the
  // page. Without OffscreenCanvas (or if the worker fails to start) the same renderer draws here, at most 60 times a second.
  type PageRenderer = ReturnType<typeof createStudioRenderer>;
  let threaded: WorkerStudioRenderer | null = null;
  let renderer: PageRenderer | WorkerStudioRenderer;
  const onPage = () => createStudioRenderer(canvas, settings, options);
  if (studioWorkerSupported()) {
    try {
      renderer = threaded = createWorkerStudioRenderer(canvas, settings, options, {
        frame: presented,
        ready: () => wake(),
        unavailable() {
          // Nothing was drawn yet: the page takes over with the same settings and budget.
          const budget = renderer.maxCells, ratio = renderer.pixelRatio;
          threaded = null;
          renderer = onPage();
          renderer.setBudget(budget);
          renderer.setPixelRatio(ratio);
          dirty = true;
          wake();
        },
        error: fault,
      }, { width, height });
    } catch {
      threaded = null;
      renderer = onPage();
    }
  } else renderer = onPage();
  const ambientClock = new AmbientTimeline();
  let frame = 0,
    disposed = false,
    dirty = true,
    paused = false,
    visible = true,
    time = 0,
    renderedMotionTime = 0,
    last = 0,
    painted = 0,
    videoFrame = -1,
    drewActive = false,
    queued = false;
  let adaptive = options.adaptive !== false;
  let samples = 0,
    costAverage = 0,
    overBudget = 0,
    underBudget = 0;
  // The resolution the caller asked for. Adaptive quality may lower the live budget while the device is
  // actually missing frames, but it always climbs back, and a still frame is always drawn at this budget.
  let targetCells = renderer.maxCells;
  const restore = () => {
    if (renderer.maxCells >= targetCells) return false;
    renderer.setBudget(targetCells);
    options.onQualityChange?.(renderer.maxCells);
    overBudget = underBudget = costAverage = samples = 0;
    return true;
  };
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
    // A worker's finished frame reaches the canvas on this display frame.
    if (threaded?.show() && threaded.drawing) wake();
    const moving = shouldPlay();
    if (moving) time += last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    const needsMotion = hasAnimatedEffects(settings);
    const animated = moving && (media.animated || needsMotion);
    const decoded = video?.getVideoPlaybackQuality?.().totalVideoFrames ?? -1;
    const sourceChanged = !video || decoded < 0 || decoded !== videoFrame;
    const interval = 1000 / Math.max(1, Math.min(60, options.fps ?? 60)) - 0.5;
    // On the page, every frame is drawn on the main thread: at most 60 a second (a 120 Hz screen would double the work
    // for no visible gain), and a slow look leaves the page at least half of the main thread instead of drawing back to
    // back. A worker draws a hover on every display frame it can keep up with.
    const due =
      dirty ||
      (renderer.active ? threaded || now - painted >= Math.max(interval, costAverage * 2) : drewActive) ||
      (animated &&
        (sourceChanged || needsMotion) &&
        now - painted >= interval);
    if (threaded) pace(now);
    if (due && threaded && !dirty && ticks % stride) queued = true;
    else if (due && threaded) {
      if (threaded.busy) queued = true;
      else {
        if (media.animated && !video) threaded.invalidate();
        const [w, h] = studioDimensions(width, height, settings);
        renderedMotionTime = ambientClock.update(time, settings.motion.type, settings.motion.speed);
        const frameTime = video?.currentTime ?? time;
        if (threaded.render(media.frame(frameTime), frameTime, w, h, renderedMotionTime, { video: !!video, time: decoded }) || dirty) {
          // The frame's time: onFrame reports it when the frame reaches the canvas.
          dirty = false;
          painted = now;
          queued = false;
          videoFrame = decoded;
        }
      }
    } else if (due) {
      const start = performance.now();
      try {
        if (media.animated && !video) renderer.invalidate();
        const [w, h] = studioDimensions(width, height, settings);
        renderedMotionTime = ambientClock.update(time, settings.motion.type, settings.motion.speed);
        (renderer as PageRenderer).render(media.frame(video?.currentTime ?? time), time, w, h, renderedMotionTime);
        const cost = performance.now() - start;
        options.onFrame?.(video?.currentTime ?? time, cost);
        measured(cost, animated);
      } catch (error) {
        fault(error);
      }
      dirty = false;
      painted = now;
      // A throttled hover still ends on its settled frame.
      drewActive = renderer.active;
      videoFrame = decoded;
    }
    if (moving && (animated || renderer.active || queued)) wake();
    // Motion has settled: draw the still again at the full requested resolution.
    else if (!animated && !renderer.active && !threaded?.drawing && restore()) {
      dirty = true;
      wake();
    }
  }
  // Frames drawn in workers cost the page nothing, but the browser still rasters and composites each one. When the display's
  // own frames slow down (the GPU process cannot keep up), a hover is drawn on every second, third or fourth display
  // frame until they recover; a step back that slows them again waits twice as long before the next try.
  let tickAt = 0, ticks = 0, short = 0, shortCount = 0, sum = 0, count = 0, fastest = Infinity, stride = 1, hold = 0, wait = 1, tried = false;
  function pace(now: number) {
    const interval = now - tickAt;
    tickAt = now;
    ticks++;
    if (interval < 3 || interval > 100) return;
    // The display's own rate: the quickest run of 8 frames (single intervals jitter around it).
    short += interval;
    if (++shortCount === 8) { fastest = Math.min(fastest, short / 8); short = shortCount = 0; }
    sum += interval;
    if (++count < 30) return;
    const mean = sum / count;
    sum = count = 0;
    if (mean > fastest * 1.25) {
      if (tried) wait = Math.min(64, wait * 2);
      stride = Math.min(4, stride + 1);
      hold = wait;
      tried = false;
    } else if (stride > 1 && mean < fastest * 1.1 && --hold <= 0) {
      stride--;
      tried = true;
    } else if (tried) {
      tried = false;
      wait = Math.max(1, wait / 2);
    }
  }
  /** Adaptive quality: only a sustained miss of the frame budget counts as struggling; a busy frame or two does not. */
  function measured(cost: number, animated: boolean) {
    costAverage = costAverage ? costAverage * 0.9 + cost * 0.1 : cost;
    if (++samples > 20 && adaptive && (animated || renderer.active)) {
      const frameBudget = 1000 / Math.max(1, Math.min(60, options.fps ?? 60));
      overBudget = costAverage > frameBudget * 1.1 ? overBudget + 1 : 0;
      underBudget = costAverage < frameBudget * 0.5 ? underBudget + 1 : 0;
      if (overBudget >= 20 && renderer.maxCells > 3000) {
        renderer.setBudget(Math.max(3000, renderer.maxCells * 0.8));
        options.onQualityChange?.(renderer.maxCells);
        overBudget = 0;
        costAverage = 0;
      } else if (underBudget >= 30 && renderer.maxCells < targetCells) {
        renderer.setBudget(Math.min(targetCells, renderer.maxCells * 1.25));
        options.onQualityChange?.(renderer.maxCells);
        underBudget = 0;
        costAverage = 0;
      }
    }
  }
  function fault(error: unknown) {
    paused = true;
    options.onError?.(error instanceof Error ? error : new Error(String(error)));
  }
  /** A worker frame reached the canvas. */
  function presented(frameTime: number, cost: number) {
    if (disposed) return;
    options.onFrame?.(frameTime, cost);
    // Workers taking turns each have that many frames' time for one.
    measured(cost / (threaded?.turns ?? 1), shouldPlay() && (media.animated || hasAnimatedEffects(settings)));
    drewActive = renderer.active;
    if (queued || drewActive || dirty || threaded?.drawing) wake();
    else if (restore()) {
      dirty = true;
      wake();
    }
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
  // A lifted finger has left the artwork; a released mouse button has not.
  const lift = (e: PointerEvent) => {
    if (e.pointerType === "touch") leave();
  };
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    motion();
  });
  observer.observe(canvas);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", lift);
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
    canvas.removeEventListener("pointerup", lift);
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
    resize(w: number, h: number, pixelRatio?: number) {
      if (pixelRatio !== undefined) renderer.setPixelRatio(pixelRatio);
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
    /** Independent serializable snapshot; edits must go through update(). */
    get settings() { return normalizeStudioSettings(settings); },
    /** Ambient phase of the last displayed frame, preserved across speed edits. */
    get motionTime() { return renderedMotionTime; },
    get paused() {
      return paused || reduced.matches;
    },
    setAdaptive(enabled: boolean) {
      adaptive = enabled;
      samples = overBudget = costAverage = 0;
    },
    setBudget(cells: number) {
      renderer.setBudget(cells);
      targetCells = renderer.maxCells;
      overBudget = underBudget = costAverage = samples = 0;
      options.onQualityChange?.(renderer.maxCells);
      dirty = true;
      wake();
    },
    get pixelRatio() { return renderer.pixelRatio; },
    get maxCells() {
      return renderer.maxCells;
    },
    get capabilities(): { gpuFinish: boolean } {
      return renderer.capabilities;
    },
    destroy,
  };
}
