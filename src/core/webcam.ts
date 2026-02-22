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
   * Called every frame to get the latest options. Takes priority over `options`.
   * Use this to keep the rendering in sync with live UI controls without
   * restarting the camera.
   *
   * @example
   * const optionsRef = useRef(currentOptions);
   * optionsRef.current = currentOptions;
   * asciifyWebcam(canvas, { liveOptions: () => optionsRef.current });
   */
  liveOptions?: () => Partial<AsciiOptions>;
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
  /**
   * Device pixel ratio used to compute logical render dimensions from the
   * canvas's physical pixel size. Defaults to `window.devicePixelRatio ?? 1`.
   * Set this when you size the canvas at physical resolution (e.g. width × dpr)
   * so that ASCII column/row counts are based on CSS pixels, not physical ones.
   */
  dpr?: number;
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
    liveOptions,
    mirror = true,
    constraints = { facingMode: 'user' },
    dpr: dprOverride,
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

  // ── DPR — scale ctx once so renderFrameToCanvas uses CSS (logical) pixels ──
  const deviceRatio = dprOverride ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1) ?? 1;
  if (deviceRatio !== 1) {
    ctx.scale(deviceRatio, deviceRatio);
  }

  // ── Hover tracking ────────────────────────────────────────────────────────
  let hoverPos: { x: number; y: number } | null = null;
  const smoothHover = { x: 0.5, y: 0.5, intensity: 0 };

  const onMouseMove = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    hoverPos = {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  };
  const onMouseLeave = () => { hoverPos = null; };

  if (merged.hoverStrength > 0) {
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseleave', onMouseLeave);
  }

  let cancelled = false;
  let animId: number;
  const startTime = performance.now();

  const tick = (timestamp: number) => {
    if (cancelled) return;

    if (video.readyState >= video.HAVE_CURRENT_DATA) {
      // Logical (CSS) dimensions — used for ASCII column/row count
      const displayW = canvas.width / deviceRatio;
      const displayH = canvas.height / deviceRatio;
      const elapsed = (timestamp - startTime) / 1000;

      // Merge live options on top of base if a getter was provided
      const frameOptions: AsciiOptions = liveOptions
        ? { ...merged, ...liveOptions() }
        : merged;

      // Sync hover listeners when hoverStrength changes via liveOptions
      const wantsHover = frameOptions.hoverStrength > 0;
      if (wantsHover) {
        canvas.addEventListener('mousemove', onMouseMove);
        canvas.addEventListener('mouseleave', onMouseLeave);
      } else {
        canvas.removeEventListener('mousemove', onMouseMove);
        canvas.removeEventListener('mouseleave', onMouseLeave);
      }

      const { frame } = imageToAsciiFrame(video, frameOptions, displayW, displayH);

      // Smooth hover interpolation
      if (hoverPos) {
        const dx = hoverPos.x - smoothHover.x;
        const dy = hoverPos.y - smoothHover.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const speed = Math.min(0.25, 0.06 + dist * 0.8);
        smoothHover.x += dx * speed;
        smoothHover.y += dy * speed;
        smoothHover.intensity += (1 - smoothHover.intensity) * 0.12;
      } else {
        smoothHover.intensity *= 0.965;
        if (smoothHover.intensity < 0.003) smoothHover.intensity = 0;
      }

      const hoverArg = smoothHover.intensity > 0.003
        ? { x: smoothHover.x, y: smoothHover.y, intensity: smoothHover.intensity }
        : null;

      if (mirror) {
        ctx.save();
        ctx.scale(-1, 1);
        ctx.translate(-displayW, 0);
        renderFrameToCanvas(ctx, frame, frameOptions, displayW, displayH, elapsed, hoverArg);
        ctx.restore();
      } else {
        renderFrameToCanvas(ctx, frame, frameOptions, displayW, displayH, elapsed, hoverArg);
      }
    }

    animId = requestAnimationFrame(tick);
  };

  animId = requestAnimationFrame(tick);

  return () => {
    cancelled = true;
    cancelAnimationFrame(animId);
    canvas.removeEventListener('mousemove', onMouseMove);
    canvas.removeEventListener('mouseleave', onMouseLeave);
    stream.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  };
}
