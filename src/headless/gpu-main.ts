import { createAsciiGpuHere, type AsciiGpu } from './gpu';
import type { AsciiGrid, AsciiGridOptions } from './grid';
import { imageToAsciiGrid, type AsciiImageSource } from './image';

/** How a GPU converter runs. */
export interface AsciiGpuOptions {
  /**
   * Convert in a worker (default true where the browser can: Worker, OffscreenCanvas with WebGL2, VideoFrame or
   * createImageBitmap). The page only hands each frame over; uploading it and reading the result back happen off the main
   * thread. `false` keeps everything on this thread.
   */
  worker?: boolean;
}

type Pending = { resolve(grid: AsciiGrid): void; reject(error: Error): void; start: number; busy: number };
type Reply = { ready?: boolean; id?: number; grid?: AsciiGrid; error?: string };

/**
 * The frame as something a worker can take. A video's current frame as a VideoFrame (it wraps the decoded frame, no copy); a
 * VideoFrame given is cloned (the caller keeps theirs); anything else as an ImageBitmap, which the browser copies off the
 * main thread (a VideoFrame of a canvas costs the main thread several times as much).
 */
function capture(source: AsciiImageSource): VideoFrame | Promise<ImageBitmap> {
  if (typeof VideoFrame === 'function') {
    if (source instanceof VideoFrame) return source.clone();
    if (typeof HTMLVideoElement === 'function' && source instanceof HTMLVideoElement) {
      try { return new VideoFrame(source); } catch { /* a bitmap instead */ }
    }
  }
  return createImageBitmap(source as ImageBitmapSource);
}

let script: Promise<string | null> | null = null;
const loadScript = () => script ??= import('./gpu-worker-source').then(({ default: source }) => source || null, () => null);

/** A converter whose work happens in a worker, falling back to this thread if the worker cannot start or has no WebGL2. */
function workerGpu(): AsciiGpu {
  const stats = { mainThreadMs: 0, totalMs: 0 };
  const waiting = new Map<number, Pending>();
  let worker: Worker | null = null, url = '', destroyed = false, next = 0;
  let here: AsciiGpu | null | undefined;
  const local = () => (here === undefined ? (here = createAsciiGpuHere()) : here);
  const fail = (message: string) => { for (const job of waiting.values()) job.reject(new Error(message)); waiting.clear(); };
  const receive = ({ data }: MessageEvent<Reply>) => {
    const begin = performance.now(), job = data.id === undefined ? undefined : waiting.get(data.id);
    if (!job) return;
    waiting.delete(data.id!);
    if (data.error || !data.grid) { job.reject(new Error(data.error ?? 'The ASCII GPU worker sent no grid.')); return; }
    const end = performance.now();
    stats.mainThreadMs = job.busy + end - begin; stats.totalMs = end - job.start;
    job.resolve(data.grid);
  };
  // Started once: the script (its own chunk), a Blob URL, and a reply saying the worker has WebGL2. Anything else (a
  // content policy without blob: workers, no WebGL2 in workers) leaves this thread to do the work.
  const ready: Promise<boolean> = loadScript().then(source => new Promise<boolean>(resolve => {
    if (!source || destroyed) { resolve(false); return; }
    try { url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' })); worker = new Worker(url); } catch { resolve(false); return; }
    const timer = setTimeout(() => resolve(false), 10000);
    worker.onmessage = ({ data }: MessageEvent<Reply>) => { if (data.ready === undefined) return; clearTimeout(timer); resolve(data.ready); };
    worker.onerror = event => { event.preventDefault(); clearTimeout(timer); resolve(false); };
  })).then(ok => {
    if (ok && worker && !destroyed) {
      worker.onmessage = receive;
      worker.onerror = event => { event.preventDefault(); stop(); fail('The ASCII GPU worker stopped.'); };
      return true;
    }
    stop();
    return false;
  });
  const stop = () => { worker?.terminate(); worker = null; if (url) URL.revokeObjectURL(url); url = ''; };
  const onThisThread = async (frame: VideoFrame | ImageBitmap, options: AsciiGridOptions) => {
    const start = performance.now();
    try {
      const gpu = local(), grid = gpu ? await gpu.convert(frame, options) : imageToAsciiGrid(frame, options);
      if (gpu) Object.assign(stats, gpu.stats); else stats.mainThreadMs = stats.totalMs = performance.now() - start;
      return grid;
    } finally { frame.close(); }
  };
  return {
    convert(source, options = {}) {
      if (destroyed) return Promise.reject(new Error('The ASCII GPU converter was destroyed.'));
      // The frame is taken now, as the call happens; only grid-sized data goes with it.
      const start = performance.now();
      let frame: VideoFrame | Promise<ImageBitmap>;
      try { frame = capture(source); } catch (error) { return Promise.reject(error); }
      const previous = options.previous ? { columns: options.previous.columns, rows: options.previous.rows, lines: options.previous.lines } : undefined;
      const sent = { ...options, previous } as AsciiGridOptions;
      let busy = performance.now() - start;
      return Promise.all([frame, ready]).then(([taken, ok]) => {
        if (destroyed) { taken.close(); throw new Error('The ASCII GPU converter was destroyed.'); }
        if (!ok || !worker) return onThisThread(taken, sent);
        return new Promise<AsciiGrid>((resolve, reject) => {
          const post = performance.now(), id = next++;
          waiting.set(id, { resolve, reject, start, busy: 0 });
          worker!.postMessage({ id, frame: taken, options: sent }, [taken as Transferable]);
          busy += performance.now() - post;
          waiting.get(id)!.busy = busy;
        });
      });
    },
    get stats() { return { ...stats }; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
      fail('The ASCII GPU converter was destroyed.');
      here?.destroy();
    },
  };
}

/**
 * A converter that turns frames into character grids on the GPU: the same options and, within rounding, the same characters
 * as `toAsciiGrid`. By default it works in a worker, so the page's main thread only hands each frame over. Returns null
 * where WebGL2 is missing (use `imageToAsciiGrid` there) and outside a browser.
 */
export function createAsciiGpu(options: AsciiGpuOptions = {}): AsciiGpu | null {
  const page = typeof document !== 'undefined';
  const canWork = options.worker !== false && page && typeof Worker === 'function' && typeof OffscreenCanvas === 'function' &&
    typeof URL.createObjectURL === 'function' && (typeof VideoFrame === 'function' || typeof createImageBitmap === 'function');
  if (!canWork) return createAsciiGpuHere();
  // No WebGL2 on the page means none in a worker either: say so now, as the converter on this thread does.
  let gl: WebGL2RenderingContext | null = null;
  try { gl = document.createElement('canvas').getContext('webgl2'); } catch { gl = null; }
  if (!gl) return null;
  (gl.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
  return workerGpu();
}

let shared: AsciiGpu | null | undefined;
/**
 * `imageToAsciiGrid` on the GPU, for live video and large grids in a page or worker: the page's shared converter, made on
 * first use (in a worker where it can). Falls back to `imageToAsciiGrid` on the CPU where WebGL2 is missing.
 */
export async function imageToAsciiGridGPU(source: AsciiImageSource, options: AsciiGridOptions = {}): Promise<AsciiGrid> {
  if (shared === undefined) shared = createAsciiGpu();
  return shared ? shared.convert(source, options) : imageToAsciiGrid(source, options);
}
