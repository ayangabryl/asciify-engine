import type { StudioSource } from "./renderer";
export interface StudioMedia {
  source: StudioSource;
  width: number;
  height: number;
  duration: number;
  animated: boolean;
  seek(time: number, signal?: AbortSignal): Promise<void>;
  frame(time: number): StudioSource;
  destroy(): void;
}
function waitMedia(
  element: HTMLImageElement | HTMLVideoElement,
  event: string,
  signal?: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    const done = () => {
        clean();
        resolve();
      },
      fail = () => {
        clean();
        reject(
          new Error(
            "Unable to load this media. Check its format and cross-origin permissions.",
          ),
        );
      },
      abort = () => {
        clean();
        reject(new DOMException("Cancelled", "AbortError"));
      };
    const timer = setTimeout(fail, 20000);
    const clean = () => {
      clearTimeout(timer);
      element.removeEventListener(event, done);
      element.removeEventListener("error", fail);
      signal?.removeEventListener("abort", abort);
    };
    element.addEventListener(event, done, { once: true });
    element.addEventListener("error", fail, { once: true });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
/** Local File or permitted CORS URL. Caller owns destroy; URLs created here are revoked. */
export async function loadStudioMedia(
  input: File | string,
  signal?: AbortSignal,
): Promise<StudioMedia> {
  if (typeof input === "string" && input.startsWith("blob:")) {
    const response = await fetch(input, { signal });
    const blob = await response.blob();
    return loadStudioMedia(
      new File([blob], "Imported media", { type: blob.type }),
      signal,
    );
  }
  const file = typeof input !== "string",
    name = file ? input.name : input;
  const isGif = file
    ? input.type === "image/gif"
    : /\.gif(?:[?#]|$)/i.test(name);
  if (isGif) {
    const gifModule = await import("gifuct-js");
    const { parseGIF, decompressFrames } =
      typeof gifModule.parseGIF === "function"
        ? gifModule
        : (gifModule as unknown as { default: typeof gifModule }).default;
    const bytes = file
      ? await input.arrayBuffer()
      : await fetch(input, { signal }).then((r) => {
          if (!r.ok) throw new Error("GIF download failed.");
          return r.arrayBuffer();
        });
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const gif = parseGIF(bytes),
      w = gif.lsd.width,
      h = gif.lsd.height;
    if (w * h > 4_000_000)
      throw new Error("GIF is too large. Use a smaller GIF or an MP4.");
    const imageCount = gif.frames.filter((f) => "image" in f).length;
    if (!imageCount || imageCount * w * h * 4 > 128_000_000)
      throw new Error(
        "GIF exceeds the decoded memory budget. Use MP4 for long animations.",
      );
    const frames = decompressFrames(gif, true);
    if (frames.length * w * h * 4 > 128_000_000)
      throw new Error(
        "GIF exceeds the 128 MB decoded budget. Use MP4 for long animations.",
      );
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    const patch = document.createElement("canvas"),
      pc = patch.getContext("2d")!;
    const duration =
      frames.reduce((n, f) => n + Math.max(20, f.delay), 0) / 1000;
    let last = -1,
      restore: ImageData | null = null;
    const frame = (time: number) => {
      const ms = (((time % duration) + duration) % duration) * 1000;
      let sum = 0,
        index = 0;
      for (; index < frames.length - 1; index++) {
        sum += Math.max(20, frames[index].delay);
        if (ms < sum) break;
      }
      if (index < last) {
        ctx.clearRect(0, 0, w, h);
        last = -1;
        restore = null;
      }
      for (let i = last + 1; i <= index; i++) {
        const previous = frames[i - 1];
        if (previous?.disposalType === 2)
          ctx.clearRect(
            previous.dims.left,
            previous.dims.top,
            previous.dims.width,
            previous.dims.height,
          );
        if (previous?.disposalType === 3 && restore)
          ctx.putImageData(restore, 0, 0);
        const f = frames[i];
        restore = f.disposalType === 3 ? ctx.getImageData(0, 0, w, h) : null;
        patch.width = f.dims.width;
        patch.height = f.dims.height;
        pc.putImageData(
          new ImageData(
            new Uint8ClampedArray(f.patch),
            patch.width,
            patch.height,
          ),
          0,
          0,
        );
        ctx.drawImage(patch, f.dims.left, f.dims.top);
      }
      last = index;
      return canvas;
    };
    frame(0);
    return {
      source: canvas,
      width: w,
      height: h,
      duration,
      animated: true,
      seek: async () => {},
      frame,
      destroy() {
        canvas.width = patch.width = 1;
        frames.length = 0;
        restore = null;
      },
    };
  }
  const video = file
    ? input.type.startsWith("video/")
    : /\.(mp4|webm|mov)(?:[?#]|$)/i.test(name);
  const url = file ? URL.createObjectURL(input) : input;
  const element = video ? document.createElement("video") : new Image();
  element.crossOrigin = "anonymous";
  if (element instanceof HTMLVideoElement) {
    element.muted = true;
    element.playsInline = true;
    element.preload = "auto";
  }
  const cleanup = () => {
    if (element instanceof HTMLVideoElement) {
      element.pause();
      element.removeAttribute("src");
      element.load();
    } else element.src = "";
    if (file) URL.revokeObjectURL(url);
  };
  try {
    const ready = waitMedia(element, video ? "loadeddata" : "load", signal);
    element.src = url;
    await ready;
    const w =
        element instanceof HTMLVideoElement
          ? element.videoWidth
          : element.naturalWidth,
      h =
        element instanceof HTMLVideoElement
          ? element.videoHeight
          : element.naturalHeight;
    return {
      source: element,
      width: w,
      height: h,
      duration: element instanceof HTMLVideoElement ? element.duration : 0,
      animated: video,
      async seek(time, signal) {
        if (!(element instanceof HTMLVideoElement)) return;
        if (!Number.isFinite(element.duration) || element.duration <= 0)
          throw new Error("Video duration is unavailable.");
        const target = Math.max(
          0,
          Math.min(element.duration - 0.001, time % element.duration),
        );
        if (
          Math.abs(element.currentTime - target) < 0.001 &&
          element.readyState >= 2
        )
          return;
        const ready = waitMedia(element, "seeked", signal);
        element.currentTime = target;
        await ready;
      },
      frame: () => element,
      destroy: cleanup,
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}
