/**
 * asciifyWebcam — live webcam → ASCII art on canvas.
 *
 * Requests camera access, attaches the stream to a hidden video element, and
 * runs a rAF loop that converts each frame to ASCII and renders it onto a
 * supplied canvas.
 *
 * @example
 * const stop = await asciifyWebcam(canvas);
 * // later: stop();
 *
 * @example
 * const stop = await asciifyWebcam(canvas, {
 *   fontSize: 8,
 *   style: 'terminal',
 *   mirror: true,                   // horizontal flip (selfie mode)
 *   constraints: { facingMode: 'user' },
 * });
 */

import type { AsciiOptions, ArtStyle } from '../types';
import { DEFAULT_OPTIONS, ART_STYLE_PRESETS } from '../types';
import { imageToAsciiFrame, renderFrameToCanvas } from './renderer';

export interface WebcamOptions {
  /** Character size in pixels. Default: 10 */
  fontSize?: number;
  /** Art style preset. Default: 'classic' */
  style?: ArtStyle;
  /** Extra AsciiOptions merged on top of the preset */
  options?: Partial<AsciiOptions>;
  /**
   * Flip the output horizontally so it reads like a mirror / selfie camera.
   * Default: true
   */
  mirror?: boolean;
  /**
   * Passed directly to `getUserMedia({ video: constraints })`.
   * Defaults to `{ facingMode: 'user' }`.
   */
  constraints?: MediaTrackConstraints;
}

/**
 * Start a live webcam ASCII-art loop and render it onto `canvas`.
 * Returns a `stop()` function that cancels the loop and releases the camera.
 *
 * Throws if the browser doesn't support `getUserMedia` or the user denies
 * camera permission.
 */
export async function asciifyWebcam(
  canvas: HTMLCanvasElement,
  {
    fontSize = 10,
    style = 'classic',
    options = {},
    mirror = true,
    constraints = { facingMode: 'user' },
  }: WebcamOptions = {}
): Promise<() => void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('asciifyWebcam: getUserMedia is not supported in this browser.');
  }

  const stream = await navigator.mediaDevices.getUserMedia({ video: constraints });

  const video = document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('asciifyWebcam: video stream failed to load.'));
    video.play().catch(reject);
  });

  const merged: AsciiOptions = {
    ...DEFAULT_OPTIONS,
    ...ART_STYLE_PRESETS[style],
    ...options,
    fontSize,
  };

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('asciifyWebcam: could not get 2d context from canvas.');

  let cancelled = false;
  let animId: number;

  const tick = () => {
    if (cancelled) return;

    if (video.readyState >= video.HAVE_CURRENT_DATA) {
      const { frame } = imageToAsciiFrame(video, merged, canvas.width, canvas.height);

      if (mirror) {
        ctx.save();
        ctx.scale(-1, 1);
        ctx.translate(-canvas.width, 0);
        renderFrameToCanvas(ctx, frame, merged, canvas.width, canvas.height);
        ctx.restore();
      } else {
        renderFrameToCanvas(ctx, frame, merged, canvas.width, canvas.height);
      }
    }

    animId = requestAnimationFrame(tick);
  };

  animId = requestAnimationFrame(tick);

  return () => {
    cancelled = true;
    cancelAnimationFrame(animId);
    stream.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  };
}
