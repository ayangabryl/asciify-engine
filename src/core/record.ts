/**
 * record() — capture a rolling frame buffer from a running ASCII canvas
 * and export it as a downloadable animated GIF or WebP data URL.
 *
 * Usage:
 * ```ts
 * const recorder = createRecorder(canvasEl, { fps: 15, maxFrames: 120 });
 * recorder.start();
 * // ... after a few seconds ...
 * const dataUrl = await recorder.stop(); // 'data:image/gif;base64,...'
 * ```
 */

export interface RecorderOptions {
  /** Target capture frame rate (default: 15) */
  fps?: number;
  /** Maximum number of frames to buffer (default: 120 → 8 s at 15 fps) */
  maxFrames?: number;
  /**
   * Output format.
   * - 'gif'  — animated GIF via gif.js worker (requires gif.worker.js in public/)
   * - 'webp' — animated WebP via MediaRecorder API (Chrome/Edge only)
   * - 'png-sequence' — returns a JSON array of PNG data URLs (universal)
   * Default: 'gif'
   */
  format?: 'gif' | 'webp' | 'png-sequence';
  /** GIF quality 1 (best) – 30 (smallest) — only used for format:'gif' (default: 10) */
  quality?: number;
  /**
   * Scale factor applied to the canvas before capture (default: 1).
   * Use 0.5 to halve dimensions and reduce file size.
   */
  scale?: number;
}

export interface Recorder {
  /** Start capturing frames from the canvas. */
  start(): void;
  /**
   * Stop capturing and encode.
   * Resolves with a data URL (gif/webp) or JSON string (png-sequence).
   */
  stop(): Promise<string>;
  /** True while recording. */
  readonly isRecording: boolean;
  /** Number of frames captured so far. */
  readonly frameCount: number;
}

/**
 * Create a Recorder bound to a canvas element.
 */
export function createRecorder(
  canvas: HTMLCanvasElement,
  options: RecorderOptions = {},
): Recorder {
  const {
    fps       = 15,
    maxFrames = 120,
    format    = 'gif',
    quality   = 10,
    scale     = 1,
  } = options;

  const interval = 1000 / fps;
  let recording  = false;
  let timerId    = -1;
  const blobs: string[] = []; // base64 PNG data URLs

  const captureFrame = () => {
    if (!recording || blobs.length >= maxFrames) return;
    let src: HTMLCanvasElement = canvas;
    if (scale !== 1) {
      const off = document.createElement('canvas');
      off.width  = Math.round(canvas.width  * scale);
      off.height = Math.round(canvas.height * scale);
      const offCtx = off.getContext('2d')!;
      offCtx.drawImage(canvas, 0, 0, off.width, off.height);
      src = off;
    }
    blobs.push(src.toDataURL('image/png'));
  };

  const encodeGif = async (frames: string[]): Promise<string> => {
    // gif.js must be loaded as a script in the page.
    // We use a dynamic import polyfill approach for the worker.
    return new Promise((resolve, reject) => {
      // @ts-ignore — GIF is a global injected by gif.js
      if (typeof GIF === 'undefined') {
        reject(new Error('[asciify recorder] gif.js not found. Add <script src="/gif.worker.js"> to your page.'));
        return;
      }
      // @ts-ignore
      const gif = new GIF({
        workers: 2,
        quality,
        workerScript: '/gif.worker.js',
      });

      let loaded = 0;
      const total = frames.length;
      frames.forEach((dataUrl) => {
        const img = new Image();
        img.onload = () => {
          gif.addFrame(img, { delay: interval, copy: true });
          loaded++;
          if (loaded === total) gif.render();
        };
        img.src = dataUrl;
      });

      gif.on('finished', (blob: Blob) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
      gif.on('error', reject);
    });
  };

  const encodeWebP = async (frames: string[], _fps: number): Promise<string> => {
    // Encode via canvas + MediaRecorder if available.
    if (typeof MediaRecorder === 'undefined') {
      throw new Error('[asciify recorder] MediaRecorder not available in this browser.');
    }
    const off = document.createElement('canvas');
    if (frames.length === 0) return '';
    const probe = new Image();
    await new Promise<void>((res) => { probe.onload = () => res(); probe.src = frames[0]; });
    off.width  = probe.naturalWidth;
    off.height = probe.naturalHeight;
    const offCtx = off.getContext('2d')!;

    const stream = off.captureStream(_fps);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);

    return new Promise((resolve, reject) => {
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      };
      recorder.onerror = reject;
      recorder.start();

      let idx = 0;
      const drawNext = () => {
        if (idx >= frames.length) { recorder.stop(); return; }
        const img = new Image();
        img.onload = () => {
          offCtx.drawImage(img, 0, 0);
          idx++;
          setTimeout(drawNext, interval);
        };
        img.src = frames[idx];
      };
      drawNext();
    });
  };

  return {
    get isRecording() { return recording; },
    get frameCount()  { return blobs.length; },

    start() {
      if (recording) return;
      blobs.length = 0;
      recording    = true;
      timerId = window.setInterval(captureFrame, interval);
    },

    async stop(): Promise<string> {
      if (!recording) return '';
      recording = false;
      clearInterval(timerId);

      const frames = blobs.slice();

      if (format === 'png-sequence') {
        return JSON.stringify(frames);
      }
      if (format === 'webp') {
        return encodeWebP(frames, fps);
      }
      // default: gif
      return encodeGif(frames);
    },
  };
}

/**
 * Convenience: record for a fixed duration and auto-download.
 *
 * @example
 * ```ts
 * await recordAndDownload(canvasEl, 3000, { fps: 15, format: 'gif' });
 * ```
 */
export async function recordAndDownload(
  canvas: HTMLCanvasElement,
  durationMs: number,
  options: RecorderOptions & { filename?: string } = {},
): Promise<void> {
  const { filename = 'asciify-recording', ...recOpts } = options;
  const recorder = createRecorder(canvas, recOpts);
  recorder.start();
  await new Promise<void>((res) => setTimeout(res, durationMs));
  const dataUrl = await recorder.stop();

  const ext = options.format === 'webp' ? 'webm'
            : options.format === 'png-sequence' ? 'json'
            : 'gif';
  const a = document.createElement('a');
  a.href     = dataUrl;
  a.download = `${filename}.${ext}`;
  a.click();
}
