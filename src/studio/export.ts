import { normalizeStudioSettings, type StudioSettings } from "./model";
import { createStudioRenderer, type StudioSource } from "./renderer";
export type StudioExportFormat = "png" | "jpeg" | "mp4" | "webm" | "gif";
export interface StudioExportOptions {
  format: StudioExportFormat;
  width: number;
  height: number;
  duration?: number;
  /** Timeline position for a still image. Animations start at zero. */
  time?: number;
  fps?: number;
  quality?: number;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
  maxCells?: number;
  /** Preview canvas width, for identical cell density when upscaling. */
  referenceWidth?: number;
}
export interface StudioExportSource {
  frame(
    time: number,
    signal?: AbortSignal,
  ): StudioSource | Promise<StudioSource>;
}
const abort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
};
/** A separate renderer preserves preview state. The source callback must also be independent for video exports. */
export async function exportStudio(
  source: StudioExportSource,
  settings: StudioSettings,
  options: StudioExportOptions,
): Promise<Blob> {
  const { format, signal } = options;
  const width = Math.round(options.width),
    height = Math.round(options.height);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 2 ||
    height < 2 ||
    width > 4096 ||
    height > 4096 ||
    width * height > 16_777_216
  )
    throw new Error("Choose export dimensions between 2 and 4096 pixels.");
  if (!["png", "jpeg", "mp4", "webm", "gif"].includes(format))
    throw new Error("Unknown export format.");
  if (options.fps !== undefined && !Number.isFinite(options.fps))
    throw new Error("Frames per second must be finite.");
  const fps = Math.max(1, Math.min(60, Math.round(options.fps ?? 24))),
    duration = options.duration ?? 5;
  if (!Number.isFinite(duration) || duration <= 0 || duration > 60)
    throw new Error("Choose a duration from 0 to 60 seconds.");
  const still = format === "png" || format === "jpeg";
  const stillTime = options.time ?? 0;
  if (!Number.isFinite(stillTime) || stillTime < 0) throw new Error("Image time must be a finite non-negative number.");
  if (!still && width * height > 3840 * 2160)
    throw new Error("Video exports support up to 3840 × 2160 pixels.");
  if (format === "gif" && (width * height > 1280 * 720 || duration * fps > 600))
    throw new Error(
      "GIF export supports up to 1280 × 720 and 600 frames. Use MP4 for larger exports.",
    );
  if (
    options.referenceWidth !== undefined &&
    (!Number.isFinite(options.referenceWidth) || options.referenceWidth < 1)
  )
    throw new Error("Reference width must be a positive number.");
  if(format==="gif"&&fps>30)throw new Error("GIF exports support up to 30 fps. Choose MP4 or WebM for higher frame rates.");
  const canvas = document.createElement("canvas");
  const renderer = createStudioRenderer(
    canvas,
    normalizeStudioSettings(settings),
    {
      maxDimension: 4096,
      maxCells: options.maxCells ?? 12000,
      pixelRatio: width / (options.referenceWidth ?? Math.min(width, 960)),
    },
  );
  let cancel: (() => Promise<void>) | undefined;
  try {
    abort(signal);
    options.onProgress?.(0);
    if (still) {
      renderer.render(await source.frame(stillTime, signal), stillTime, width, height);
      if (canvas.dataset.studioFinish === "unavailable")
        throw new Error(
          "Optical effects need WebGL. Disable these effects or export in a supported browser.",
        );
      abort(signal);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Image export failed."))),
          format === "png" ? "image/png" : "image/jpeg",
          options.quality ?? 0.92,
        ),
      );
      options.onProgress?.(1);
      return blob;
    }
    const count = Math.ceil(duration * fps);
    if (format === "gif") {
      const gifModule = await import("gifenc");
      const { GIFEncoder, quantize, applyPalette } =
        typeof gifModule.GIFEncoder === "function"
          ? gifModule
          : gifModule.default;
      const gif = GIFEncoder();
      const ctx = canvas.getContext("2d")!;
      for (let i = 0; i < count; i++) {
        abort(signal);
        const t = i / fps;
        renderer.invalidate();
        renderer.render(await source.frame(t, signal), t, width, height);
        if (canvas.dataset.studioFinish === "unavailable")
          throw new Error(
            "Optical effects need WebGL. Disable these effects or export in a supported browser.",
          );
        const data = ctx.getImageData(0, 0, width, height).data;
        const palette = quantize(data, 256);
        const indexed = applyPalette(data, palette);
        gif.writeFrame(indexed, width, height, {
          palette,
          delay:
            (Math.round(Math.min((i + 1)/fps,duration)*100) - Math.round((i * 100) / fps)) *
            10,
          repeat: 0,
        });
        options.onProgress?.(((i + 1) / count) * 0.98);
        await new Promise((r) => setTimeout(r, 0));
      }
      gif.finish();
      options.onProgress?.(1);
      return new Blob([new Uint8Array(gif.bytes())], { type: "image/gif" });
    }
    const {
      Output,
      Mp4OutputFormat,
      WebMOutputFormat,
      BufferTarget,
      CanvasSource,
      canEncodeVideo,
    } = await import("mediabunny");
    const codec = format === "mp4" ? "avc" : "vp9";
    if (!(await canEncodeVideo(codec, { width, height })))
      throw new Error(
        `${format.toUpperCase()} encoding is unavailable in this browser. Try another format or a current browser with WebCodecs.`,
      );
    const output = new Output({
      format:
        format === "mp4"
          ? new Mp4OutputFormat({ fastStart: "in-memory" })
          : new WebMOutputFormat(),
      target: new BufferTarget(),
    });
    canvas.width = width;
    canvas.height = height;
    cancel = () => output.cancel();
    const video = new CanvasSource(canvas, {
      codec,
      bitrate: Math.max(500000, Math.round(width * height * fps * 0.15)),
    });
    output.addVideoTrack(video, { frameRate: fps });
    canvas.width = width;
    canvas.height = height;
    await output.start();
    for (let i = 0; i < count; i++) {
      abort(signal);
      const t = i / fps;
      renderer.invalidate();
      renderer.render(await source.frame(t, signal), t, width, height);
      if (canvas.dataset.studioFinish === "unavailable")
        throw new Error(
          "Optical effects need WebGL. Disable these effects or export in a supported browser.",
        );
      await video.add(t, Math.min(1 / fps,duration-t));
      options.onProgress?.(((i + 1) / count) * 0.98);
      if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    video.close();
    abort(signal);
    await output.finalize();
    cancel = undefined;
    options.onProgress?.(1);
    return new Blob([output.target.buffer!], {
      type: format === "mp4" ? "video/mp4" : "video/webm",
    });
  } catch (error) {
    await cancel?.().catch(() => {});
    throw error;
  } finally {
    renderer.destroy();
    canvas.width = canvas.height = 1;
  }
}
