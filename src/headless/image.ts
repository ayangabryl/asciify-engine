import { toAsciiGrid, type AsciiGrid, type AsciiGridOptions } from './grid';
import { GLYPH_CELL_ASPECT, GLYPH_COLS, GLYPH_ROWS } from './glyph-table';

/** Anything the browser can draw: a video frame, an image, a canvas (a WebGL or three.js one included), an ImageBitmap. */
export type AsciiImageSource = CanvasImageSource;

type Pen = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
let pen: Pen | null = null;

const sizeOf = (source: AsciiImageSource): [number, number] => {
  const s = source as { videoWidth?: number; videoHeight?: number; naturalWidth?: number; naturalHeight?: number; displayWidth?: number; displayHeight?: number; width?: number | { baseVal: { value: number } }; height?: number | { baseVal: { value: number } } };
  const num = (v: unknown) => (typeof v === 'number' ? v : (v as { baseVal?: { value: number } })?.baseVal?.value ?? 0);
  return [s.videoWidth || s.naturalWidth || s.displayWidth || num(s.width), s.videoHeight || s.naturalHeight || s.displayHeight || num(s.height)];
};

/**
 * `toAsciiGrid` for a picture the browser can draw, in a page or a worker. The frame is first drawn down on the GPU to
 * `detail` pixels per part of a cell (each cell is read in 3 by 5 parts), so only those pixels come back to the CPU, not the
 * whole frame: a 1080p or 4K video frame costs about what its grid does. In `mode: 'tone'` it reads one pixel a cell, the
 * fastest path; in shape mode `detail` 2 (default) matches `toAsciiGrid` on the full frame within the benchmark's noise, and 1
 * is faster still. Not for Node: there is no canvas to draw on, so pass pixels to
 * `toAsciiGrid` instead.
 */
export function imageToAsciiGrid(source: AsciiImageSource, options: AsciiGridOptions & { detail?: 1 | 2 } = {}): AsciiGrid {
  const [width, height] = sizeOf(source);
  if (!(width > 0 && height > 0)) throw new Error('imageToAsciiGrid needs a source with a size (a decoded image, a playing video, a canvas).');
  const cellAspect = typeof options.cellAspect === 'number' && options.cellAspect > 0 ? options.cellAspect : GLYPH_CELL_ASPECT;
  const columns = Math.max(1, Math.round(options.columns ?? 80));
  const rows = Math.max(1, Math.round(options.rows ?? Math.max(1, Math.round(columns * (height / width) / cellAspect))));
  // Tone mode looks only at each cell's average, so the frame is drawn down to one pixel a cell; shape mode reads each cell's
  // parts, at `detail` pixels a part. Never enlarged: a source smaller than that is read as it is.
  const tone = options.mode === 'tone', detail = options.detail === 1 ? 1 : 2;
  const w = tone ? Math.min(width, columns) : Math.min(width, columns * GLYPH_COLS * detail);
  const h = tone ? Math.min(height, rows) : Math.min(height, rows * GLYPH_ROWS * detail);
  if (!pen || pen.canvas.width < w || pen.canvas.height < h) {
    // A page canvas where there is a page (drawn down on the GPU with the frame); an OffscreenCanvas in a worker.
    const canvas = typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: w, height: h }) : typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(w, h) : null;
    if (!canvas) throw new Error('imageToAsciiGrid needs a browser or a worker; in Node, pass pixels to toAsciiGrid.');
    // Not willReadFrequently: that keeps the canvas on the CPU, so drawing a GPU-held frame into it would read back the whole
    // frame. On the GPU the frame is drawn down there and only the small result comes back.
    pen = canvas.getContext('2d') as Pen | null;
    if (!pen) throw new Error('imageToAsciiGrid could not get a 2D canvas.');
  }
  pen.imageSmoothingEnabled = true;
  pen.imageSmoothingQuality = 'high';
  pen.clearRect(0, 0, w, h);
  pen.drawImage(source, 0, 0, w, h);
  const { data } = pen.getImageData(0, 0, w, h);
  return toAsciiGrid({ data, width: w, height: h }, { ...options, columns, rows });
}
