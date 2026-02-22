// ── Snapshot ─────────────────────────────────────────────────────────────

export interface SnapshotOptions {
  /**
   * Image format.
   * - 'png'  — lossless (default)
   * - 'jpeg' — smaller, no transparency
   * - 'webp' — best compression with transparency
   */
  format?: 'png' | 'jpeg' | 'webp';
  /** 0–1 quality for jpeg/webp. Default: 0.92 */
  quality?: number;
  /**
   * Scale factor applied before capture. Default: 1.
   * Use 2 for a high-resolution export at 2× the canvas size.
   */
  scale?: number;
}

/**
 * Capture a single frame from a canvas as a Blob.
 *
 * @example
 * ```ts
 * const blob = await captureSnapshot(canvas);
 * const url = URL.createObjectURL(blob);
 * ```
 */
export function captureSnapshot(
  canvas: HTMLCanvasElement,
  { format = 'png', quality = 0.92, scale = 1 }: SnapshotOptions = {},
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    let src: HTMLCanvasElement = canvas;
    if (scale !== 1) {
      const off = document.createElement('canvas');
      off.width  = Math.round(canvas.width  * scale);
      off.height = Math.round(canvas.height * scale);
      const offCtx = off.getContext('2d');
      if (!offCtx) { reject(new Error('captureSnapshot: could not get 2d context')); return; }
      offCtx.drawImage(canvas, 0, 0, off.width, off.height);
      src = off;
    }
    src.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('captureSnapshot: toBlob returned null')),
      `image/${format}`,
      quality,
    );
  });
}

/**
 * Capture a single frame and immediately trigger a browser download.
 *
 * @example
 * ```ts
 * await snapshotAndDownload(canvas);
 * await snapshotAndDownload(canvas, { format: 'jpeg', filename: 'my-art' });
 * ```
 */
export async function snapshotAndDownload(
  canvas: HTMLCanvasElement,
  options: SnapshotOptions & { filename?: string } = {},
): Promise<void> {
  const { filename = 'asciify-snapshot', format = 'png', ...snapOpts } = options;
  const blob = await captureSnapshot(canvas, { format, ...snapOpts });
  const ext = format === 'jpeg' ? 'jpg' : format;
  const a = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `${filename}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
