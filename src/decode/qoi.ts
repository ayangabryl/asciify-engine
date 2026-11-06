import { checkSize, limitsOf, still, type DecodedImage, type DecodeOptions } from './common';

/*
 * QOI, the whole spec: RGB, RGBA, INDEX, DIFF, LUMA and RUN chunks. The header's channel count and colour space do not change
 * the pixels (they are always RGBA; a 3-channel image simply keeps alpha 255). Pixels past the end of a cut-short file are
 * transparent.
 */

/** True if the bytes start with "qoif". */
export const isQoi = (b: Uint8Array): boolean => b.length >= 4 && b[0] === 0x71 && b[1] === 0x6f && b[2] === 0x69 && b[3] === 0x66;

/** Decodes a QOI image. */
export function decodeQoi(bytes: Uint8Array, options?: DecodeOptions): DecodedImage {
  const limits = limitsOf(options);
  if (!isQoi(bytes)) throw new Error('QOI: not a QOI file');
  if (bytes.length < 14) throw new Error('QOI: file too short');
  const width = ((bytes[4] << 24) | (bytes[5] << 16) | (bytes[6] << 8) | bytes[7]) >>> 0;
  const height = ((bytes[8] << 24) | (bytes[9] << 16) | (bytes[10] << 8) | bytes[11]) >>> 0;
  checkSize('QOI', width, height, limits.maxPixels);
  const out = new Uint8Array(width * height * 4);
  const index = new Uint8Array(256);
  const total = width * height * 4, end = bytes.length;
  let r = 0, g = 0, b = 0, a = 255, run = 0, p = 14;
  for (let o = 0; o < total; o += 4) {
    if (run > 0) {
      run--;
    } else {
      if (p >= end) break;
      const op = bytes[p++];
      if (op === 0xfe) {
        if (p + 3 > end) break;
        r = bytes[p]; g = bytes[p + 1]; b = bytes[p + 2];
        p += 3;
      } else if (op === 0xff) {
        if (p + 4 > end) break;
        r = bytes[p]; g = bytes[p + 1]; b = bytes[p + 2]; a = bytes[p + 3];
        p += 4;
      } else {
        const tag = op >> 6;
        if (tag === 0) {
          const k = op << 2;
          r = index[k]; g = index[k + 1]; b = index[k + 2]; a = index[k + 3];
        } else if (tag === 1) {
          r = (r + ((op >> 4) & 3) - 2) & 255;
          g = (g + ((op >> 2) & 3) - 2) & 255;
          b = (b + (op & 3) - 2) & 255;
        } else if (tag === 2) {
          if (p >= end) break;
          const next = bytes[p++], dg = (op & 63) - 32;
          r = (r + dg + (next >> 4) - 8) & 255;
          g = (g + dg) & 255;
          b = (b + dg + (next & 15) - 8) & 255;
        } else {
          run = op & 63;
        }
      }
      const k = ((r * 3 + g * 5 + b * 7 + a * 11) & 63) << 2;
      index[k] = r; index[k + 1] = g; index[k + 2] = b; index[k + 3] = a;
    }
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = a;
  }
  return still('qoi', width, height, out);
}
