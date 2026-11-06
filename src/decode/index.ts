import { decodeBmp, isBmp } from './bmp';
import type { DecodedImage, DecodeOptions, ImageFormat } from './common';
import { decodeGif, isGif } from './gif';
import { decodeJpeg, isJpeg } from './jpeg';
import { decodePng, isPng } from './png';
import { decodePnm, isPnm } from './pnm';
import { decodeQoi, isQoi } from './qoi';

/*
 * Image bytes in, RGBA pixels out: PNG (and APNG), JPEG, GIF, BMP, PNM and QOI, in plain TypeScript with no dependencies, no
 * native code and no platform API, so the same code runs in Node, Deno, Bun, browsers, workers and edge runtimes. Decoding is
 * synchronous. Not supported: WebP, AVIF, HEIC, TIFF, ICO, SVG, and colour management (ICC profiles and gamma are ignored).
 */

export type { DecodedFrame, DecodedImage, DecodeOptions, ImageFormat } from './common';
export { inflate, inflateRaw } from './inflate';
export { decodeBmp, decodeGif, decodeJpeg, decodePng, decodePnm, decodeQoi };

/** The format of an image, by its first bytes; null if it is none this module decodes. */
export function imageFormat(bytes: Uint8Array): ImageFormat | null {
  if (isPng(bytes)) return 'png';
  if (isJpeg(bytes)) return 'jpeg';
  if (isGif(bytes)) return 'gif';
  if (isQoi(bytes)) return 'qoi';
  if (isBmp(bytes)) return 'bmp';
  if (isPnm(bytes)) return 'pnm';
  return null;
}

/**
 * Decodes an image to RGBA frames: one for a still, every frame (composited) for an animated GIF or APNG. JPEGs are turned
 * upright by their EXIF orientation unless `orientation` is false. Throws an Error for a format it does not know, a file
 * too corrupt to read, or an image above `maxPixels`; a file cut short decodes as far as it goes.
 */
export function decodeImage(bytes: Uint8Array | ArrayBuffer, options?: DecodeOptions): DecodedImage {
  // Any view (a Node Buffer, a Uint8Array from another realm) is read in place; an ArrayBuffer is wrapped.
  const b = ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new Uint8Array(bytes);
  switch (imageFormat(b)) {
    case 'png': return decodePng(b, options);
    case 'jpeg': return decodeJpeg(b, options);
    case 'gif': return decodeGif(b, options);
    case 'bmp': return decodeBmp(b, options);
    case 'pnm': return decodePnm(b, options);
    case 'qoi': return decodeQoi(b, options);
    default: throw new Error('decodeImage: not an image format this decoder knows (PNG, JPEG, GIF, BMP, PNM or QOI)');
  }
}
