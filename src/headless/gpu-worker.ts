// The GPU converter's worker: built as a script string (gpu-worker-source.ts, tsup.config.ts) and started from a Blob URL by
// createAsciiGpu. It converts each frame it is sent (a VideoFrame or ImageBitmap, which it closes) on an OffscreenCanvas
// and posts the grid back, so the page's main thread neither uploads frames nor waits on the GPU.
import { createAsciiGpuHere } from './gpu';
import type { AsciiGridOptions } from './grid';

interface Request { id: number; frame: VideoFrame | ImageBitmap; options: AsciiGridOptions }
const scope = self as unknown as { postMessage(message: unknown, transfer?: Transferable[]): void; onmessage: ((event: MessageEvent<Request>) => void) | null };
const gpu = createAsciiGpuHere();
scope.postMessage({ ready: !!gpu });
scope.onmessage = async ({ data: { id, frame, options } }) => {
  try {
    if (!gpu) throw new Error('No WebGL2 in the worker.');
    const grid = await gpu.convert(frame, options);
    const colors = grid.colors ? grid.colors.slice() : null;
    scope.postMessage({ id, grid: { columns: grid.columns, rows: grid.rows, lines: grid.lines, colors, background: grid.background }, gpu: gpu.stats }, colors ? [colors.buffer] : []);
  } catch (error) {
    scope.postMessage({ id, error: String((error as Error)?.message ?? error) });
  } finally {
    frame.close();
  }
};
