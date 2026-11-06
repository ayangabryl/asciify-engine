/* Types and checks shared by the decoders. Nothing here touches a platform API. */

export type ImageFormat = 'png' | 'jpeg' | 'gif' | 'bmp' | 'pnm' | 'qoi';

/** One frame: the whole canvas, RGBA, 8 bits a channel, straight (not premultiplied) alpha, composited as the format says. */
export interface DecodedFrame {
  /** width × height × 4 bytes, row by row. */
  data: Uint8Array;
  /** How long the frame shows, in milliseconds. 0 for a still. */
  delay: number;
}

export interface DecodedImage {
  format: ImageFormat;
  width: number;
  height: number;
  /** Stills have one frame with delay 0. */
  frames: DecodedFrame[];
  /** Times to play: 0 forever, n plays n times. 1 for stills. */
  loop: number;
}

export interface DecodeOptions {
  /** Stop decoding after this many frames (no error). Default 500. */
  maxFrames?: number;
  /** A width × height above this throws. Default 100_000_000. Animations also stop early, without an error, once their frames hold four times this many pixels in all. */
  maxPixels?: number;
  /** Turn JPEGs upright by their EXIF orientation (1–8). Default true. */
  orientation?: boolean;
}

/** The options with their defaults filled in. @internal */
export interface Limits {
  maxFrames: number;
  maxPixels: number;
  orientation: boolean;
}

/** No side may be longer than this. @internal */
export const MAX_SIDE = 65535;

/** @internal */
export function limitsOf(options: DecodeOptions | undefined): Limits {
  const o = options ?? {};
  const maxFrames = typeof o.maxFrames === 'number' && o.maxFrames >= 1 ? Math.floor(o.maxFrames) : 500;
  const maxPixels = typeof o.maxPixels === 'number' && o.maxPixels >= 1 ? o.maxPixels : 100_000_000;
  return { maxFrames, maxPixels, orientation: o.orientation !== false };
}

/** Throws unless the size is sane and within the limits. @internal */
export function checkSize(format: string, width: number, height: number, maxPixels: number): void {
  if (!(width >= 1 && height >= 1) || width !== Math.floor(width) || height !== Math.floor(height)) {
    throw new Error(`${format}: invalid image size ${width}x${height}`);
  }
  if (width > MAX_SIDE || height > MAX_SIDE) throw new Error(`${format}: image is too large (${width}x${height}; at most ${MAX_SIDE} a side)`);
  if (width * height > maxPixels) throw new Error(`${format}: image is too large (${width}x${height} is more than maxPixels, ${maxPixels})`);
}

/** How many frames an animation of this size may keep: maxFrames, and no more than four times maxPixels pixels in all. @internal */
export function frameLimit(limits: Limits, width: number, height: number): number {
  return Math.max(1, Math.min(limits.maxFrames, Math.floor((4 * limits.maxPixels) / (width * height))));
}

/** The browser rule for frame delays: anything of 10 ms or less plays as 100 ms. @internal */
export const playDelay = (ms: number): number => (ms <= 10 ? 100 : ms);

/** A one-frame image. @internal */
export function still(format: ImageFormat, width: number, height: number, data: Uint8Array): DecodedImage {
  return { format, width, height, frames: [{ data, delay: 0 }], loop: 1 };
}
