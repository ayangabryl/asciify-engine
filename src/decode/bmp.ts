import { checkSize, limitsOf, still, type DecodedImage, type DecodeOptions } from './common';

/*
 * BMP: Windows BITMAPINFOHEADER, V2 to V5 and OS/2 1.x and 2.x headers; 1, 2, 4, 8, 16, 24 and 32 bits a pixel; BI_RGB,
 * BI_BITFIELDS and BI_ALPHABITFIELDS masks of any width (n-bit fields scale to 8 bits as v × 255 / max, rounded down, as
 * Pillow does); RLE8 and RLE4; bottom-up and top-down rows. 32-bit pixels have alpha only when a mask says so, else they are
 * opaque. Pixels an RLE bitmap skips, and rows past the end of a cut-short file, are transparent, as in browsers.
 * Not supported: embedded JPEG or PNG (BI_JPEG, BI_PNG), OS/2 Huffman and RLE24, CMYK variants, 64-bit pixels and colour
 * profiles (ignored).
 */

const u16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const s32 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24);

const HEADERS = [12, 16, 40, 52, 56, 64, 108, 124];

/** True if the bytes look like a BMP: "BM" and a known header size. */
export const isBmp = (b: Uint8Array): boolean => b.length >= 18 && b[0] === 0x42 && b[1] === 0x4d && HEADERS.includes(u32(b, 14));

const RGB = 0, RLE8 = 1, RLE4 = 2, BITFIELDS = 3, JPEG = 4, PNG = 5, ALPHABITFIELDS = 6;

/** One mask's field: where it is and how its values map to 8 bits. */
interface Field {
  mask: number;
  shift: number;
  max: number;
  table: Uint8Array | null;
}

function field(mask: number): Field {
  mask >>>= 0;
  if (!mask) return { mask: 0, shift: 0, max: 0, table: null };
  let shift = 0;
  while (!((mask >>> shift) & 1)) shift++;
  const max = mask >>> shift;
  let table: Uint8Array | null = null;
  if (max <= 0xffff) {
    table = new Uint8Array(max + 1);
    for (let i = 0; i <= max; i++) table[i] = Math.floor((i * 255) / max);
  }
  return { mask, shift, max, table };
}

const fieldValue = (f: Field, px: number) => {
  const v = ((px & f.mask) >>> f.shift);
  return f.table ? f.table[v] : Math.floor((v * 255) / f.max);
};

/** Decodes a BMP. */
export function decodeBmp(bytes: Uint8Array, options?: DecodeOptions): DecodedImage {
  const limits = limitsOf(options);
  const n = bytes.length;
  if (n < 26 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) throw new Error('BMP: not a BMP file');
  const hsize = u32(bytes, 14);
  if (!HEADERS.includes(hsize)) throw new Error(`BMP: unknown header size ${hsize}`);
  if (14 + Math.min(hsize, 40) > n) throw new Error('BMP: file too short');
  let width: number, height: number, bpp: number, compression = RGB, colours = 0, entry = 4;
  let rMask = 0, gMask = 0, bMask = 0, aMask = 0, masksAt = 0;
  const at = (i: number) => (i + 4 <= hsize && 14 + i + 4 <= n ? u32(bytes, 14 + i) : 0);
  if (hsize === 12) {
    width = u16(bytes, 18);
    height = u16(bytes, 20);
    bpp = u16(bytes, 24);
    entry = 3;
  } else {
    width = s32(bytes, 18);
    height = s32(bytes, 22);
    bpp = u16(bytes, 28);
    compression = at(16);
    colours = at(32);
    if (hsize === 16 || hsize === 64) {
      // OS/2 2.x: its 3 and 4 are Huffman and RLE24, not bitfields and JPEG.
      if (compression === 3 || compression === 4) throw new Error('BMP: OS/2 Huffman and RLE24 compression are not supported');
    } else if (hsize >= 52) {
      rMask = at(40);
      gMask = at(44);
      bMask = at(48);
      if (hsize >= 56) aMask = at(52);
    } else if (compression === BITFIELDS || compression === ALPHABITFIELDS) {
      // A 40-byte header keeps its masks after it: three, or four with alpha.
      masksAt = compression === ALPHABITFIELDS ? 16 : 12;
      const m = 14 + hsize;
      if (m + masksAt > n) throw new Error('BMP: file too short');
      rMask = u32(bytes, m);
      gMask = u32(bytes, m + 4);
      bMask = u32(bytes, m + 8);
      if (compression === ALPHABITFIELDS) aMask = u32(bytes, m + 12);
    }
  }
  if (compression === JPEG || compression === PNG) throw new Error('BMP: embedded JPEG and PNG data are not supported');
  if (compression > ALPHABITFIELDS) throw new Error(`BMP: unknown compression ${compression}`);
  const topDown = height < 0;
  if (topDown) height = -height;
  checkSize('BMP', width, height, limits.maxPixels);
  const rle = compression === RLE8 || compression === RLE4;
  if (rle ? bpp !== (compression === RLE8 ? 8 : 4) : ![1, 2, 4, 8, 16, 24, 32].includes(bpp)) {
    throw new Error(`BMP: ${bpp} bits a pixel is not supported${rle ? ' with RLE' : ''}`);
  }

  // Where the pixels start: the header's offset if it is sane (one that points at the palette means just after it).
  const paletteAt = 14 + hsize + masksAt;
  let count = bpp <= 8 ? (colours > 0 ? Math.min(colours, 65536) : 1 << bpp) : 0;
  let offset = u32(bytes, 10);
  if (count && offset === 14 + hsize) offset += count * entry;
  if (offset < paletteAt || offset >= n) offset = paletteAt + count * entry;
  if (offset >= n) throw new Error('BMP: no pixel data');
  if (count && offset > paletteAt) count = Math.min(count, Math.floor((offset - paletteAt) / entry));
  // The palette, as RGBA: the colours the file gives, the rest opaque black.
  const palette = new Uint8Array(1024);
  for (let i = 3; i < 1024; i += 4) palette[i] = 255;
  for (let i = 0; i < Math.min(count, 256); i++) {
    const q = paletteAt + i * entry;
    if (q + 3 > n) break;
    palette[i * 4] = bytes[q + 2];
    palette[i * 4 + 1] = bytes[q + 1];
    palette[i * 4 + 2] = bytes[q];
  }

  const out = new Uint8Array(width * height * 4);
  if (rle) {
    rleDecode(bytes, offset, compression === RLE4, width, height, topDown, palette, out);
    return still('bmp', width, height, out);
  }
  const stride = Math.floor((width * bpp + 31) / 32) * 4;
  if (bpp <= 8) {
    const mask = (1 << bpp) - 1;
    for (let y = 0; y < height; y++) {
      const s = offset + y * stride;
      if (s + Math.ceil((width * bpp) / 8) > n) break;
      let o = (topDown ? y : height - 1 - y) * width * 4;
      for (let x = 0; x < width; x++, o += 4) {
        const bit = x * bpp, k = ((bytes[s + (bit >> 3)] >> (8 - bpp - (bit & 7))) & mask) << 2;
        out[o] = palette[k];
        out[o + 1] = palette[k + 1];
        out[o + 2] = palette[k + 2];
        out[o + 3] = 255;
      }
    }
    return still('bmp', width, height, out);
  }
  const masked = compression === BITFIELDS || compression === ALPHABITFIELDS;
  if (!masked) {
    // BI_RGB: 5-5-5 for 16 bits, BGR(X) for 24 and 32, no alpha.
    if (bpp === 16) { rMask = 0x7c00; gMask = 0x3e0; bMask = 0x1f; } else { rMask = 0xff0000; gMask = 0xff00; bMask = 0xff; }
    aMask = 0;
  }
  const bytesPer = bpp >> 3;
  if (bpp >= 24 && rMask === 0xff0000 && gMask === 0xff00 && bMask === 0xff && (aMask === 0 || aMask === 0xff000000)) {
    // The common layouts, byte by byte.
    const alpha = bpp === 32 && aMask !== 0;
    for (let y = 0; y < height; y++) {
      let s = offset + y * stride;
      if (s + width * bytesPer > n) break;
      let o = (topDown ? y : height - 1 - y) * width * 4;
      for (let x = 0; x < width; x++, s += bytesPer, o += 4) {
        out[o] = bytes[s + 2];
        out[o + 1] = bytes[s + 1];
        out[o + 2] = bytes[s];
        out[o + 3] = alpha ? bytes[s + 3] : 255;
      }
    }
    return still('bmp', width, height, out);
  }
  const r = field(rMask), g = field(gMask), b = field(bMask), a = field(aMask);
  for (let y = 0; y < height; y++) {
    let s = offset + y * stride;
    if (s + width * bytesPer > n) break;
    let o = (topDown ? y : height - 1 - y) * width * 4;
    for (let x = 0; x < width; x++, s += bytesPer, o += 4) {
      const px = bpp === 16 ? u16(bytes, s) : bpp === 24 ? bytes[s] | (bytes[s + 1] << 8) | (bytes[s + 2] << 16) : u32(bytes, s);
      out[o] = r.mask ? fieldValue(r, px) : 0;
      out[o + 1] = g.mask ? fieldValue(g, px) : 0;
      out[o + 2] = b.mask ? fieldValue(b, px) : 0;
      out[o + 3] = a.mask ? fieldValue(a, px) : 255;
    }
  }
  return still('bmp', width, height, out);
}

/** RLE8 and RLE4: runs, end-of-line, end-of-bitmap, deltas and absolute runs. Pixels never set stay transparent. */
function rleDecode(b: Uint8Array, p: number, four: boolean, width: number, height: number, topDown: boolean, palette: Uint8Array, out: Uint8Array): void {
  const n = b.length;
  let x = 0, y = 0;
  while (p + 1 < n && y < height) {
    const count = b[p], value = b[p + 1];
    p += 2;
    if (count === 0 && value < 3) {
      if (value === 1) break;
      if (value === 0) {
        x = 0;
        y++;
      } else {
        if (p + 1 >= n) break;
        x += b[p];
        y += b[p + 1];
        p += 2;
      }
      continue;
    }
    // A run of `count` pixels of one value (two alternating nibbles for RLE4), or an absolute run of `value` pixels.
    const absolute = count === 0, pixels = absolute ? value : count, size = absolute ? (four ? (value + 1) >> 1 : value) : 0;
    if (absolute && p + size > n) break;
    const o = (topDown ? y : height - 1 - y) * width;
    for (let i = 0; i < pixels; i++, x++) {
      if (x >= width) continue;
      const v = absolute ? (four ? (i & 1 ? b[p + (i >> 1)] & 15 : b[p + (i >> 1)] >> 4) : b[p + i]) : four ? (i & 1 ? value & 15 : value >> 4) : value;
      const d = (o + x) * 4, k = v << 2;
      out[d] = palette[k];
      out[d + 1] = palette[k + 1];
      out[d + 2] = palette[k + 2];
      out[d + 3] = 255;
    }
    if (absolute) p += size + (size & 1);
  }
}
