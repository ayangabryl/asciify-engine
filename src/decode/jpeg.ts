import { checkSize, limitsOf, still, type DecodedImage, type DecodeOptions } from './common';

/*
 * JPEG: baseline and extended sequential (8-bit, Huffman), and progressive with spectral selection and successive
 * approximation; restart markers; any sampling factors; greyscale, YCbCr, RGB, CMYK and YCCK (by the Adobe APP14 transform,
 * CMYK read as Adobe's inverted CMYK, as Pillow and Chrome do); EXIF orientation. Each step is libjpeg-turbo's default: the
 * accurate integer IDCT, "fancy" triangle-filter upsampling for 2× chroma, its fixed-point colour conversion, the standard
 * Huffman tables for motion-JPEG frames that leave them out. So the output matches libjpeg-turbo, usually exactly. A file
 * cut short decodes as far as it goes and the rest is grey, damaged restart markers resynchronise, and junk between markers
 * is skipped, all as in libjpeg.
 * Not supported (these throw): arithmetic coding, 12- and 16-bit precision, lossless and hierarchical JPEG, a height given
 * only by a DNL marker, more than 1000 scans. Progressive files missing their last scans skip libjpeg's block smoothing, so
 * their unfinished parts look blockier than libjpeg's.
 */

// Zigzag order to natural order, with 16 spare entries so a corrupt run cannot index past the block.
const ZIGZAG = new Uint8Array(80).fill(63);
ZIGZAG.set([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
]);

// After the IDCT, a sample is looked up by (value & 1023): libjpeg's range-limit table, +128 and clamped (wrapping only for
// values no real image produces).
const LIMIT = new Uint8Array(1024);
for (let i = 0; i < 1024; i++) LIMIT[i] = i < 128 ? i + 128 : i < 512 ? 255 : i < 896 ? 0 : i - 896;

// libjpeg's YCbCr to RGB tables (16-bit fixed point, jdcolor.c).
const CR_R = new Int32Array(256), CB_B = new Int32Array(256), CR_G = new Int32Array(256), CB_G = new Int32Array(256);
for (let i = 0; i < 256; i++) {
  const x = i - 128;
  CR_R[i] = (91881 * x + 32768) >> 16;
  CB_B[i] = (116130 * x + 32768) >> 16;
  CR_G[i] = -46802 * x;
  CB_G[i] = -22554 * x + 32768;
}

// The standard Huffman tables (Annex K), for streams with no DHT of their own (motion JPEG), as libjpeg-turbo does.
const STD_DC = [[0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0]];
const STD_DC_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const STD_AC = [[0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d], [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77]];
const STD_AC_VALUES = [
  [
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32,
    0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16,
    0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45,
    0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
    0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94,
    0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
    0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8,
    0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
    0xf9, 0xfa,
  ],
  [
    0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81,
    0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34,
    0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44,
    0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
    0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92,
    0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4,
    0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6,
    0xd7, 0xd8, 0xd9, 0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
    0xf9, 0xfa,
  ],
];

const standard: (Huffman | null)[] = [null, null, null, null];
/** Standard table 0 (luminance) or 1 (chrominance), built once; null for other numbers. */
function standardTable(ac: boolean, id: number): Huffman | null {
  if (id > 1) return null;
  const k = (ac ? 2 : 0) + id;
  if (!standard[k]) standard[k] = new Huffman(ac ? STD_AC[id] : STD_DC[id], ac ? STD_AC_VALUES[id] : STD_DC_VALUES, ac);
  return standard[k];
}

/** True if the bytes start with a JPEG SOI marker. */
export const isJpeg = (b: Uint8Array): boolean => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/** A decoding table: 9-bit lookahead, the slow path for longer codes, and (AC) run, size and value in one lookup. */
class Huffman {
  /** (length << 8) | symbol for codes of 9 bits or fewer, by their next 9 bits; 0 for longer codes. */
  readonly look = new Uint16Array(512);
  /** For AC tables: (value << 16) | (run << 8) | bits used, when a code and its extra bits fit in 9 bits; else 0. */
  readonly fast = new Int32Array(512);
  readonly maxcode = new Int32Array(18);
  readonly valptr = new Int32Array(17);
  readonly values = new Uint8Array(256);

  constructor(counts: ArrayLike<number>, symbols: ArrayLike<number>, ac: boolean) {
    const sizes: number[] = [], codes: number[] = [];
    for (let l = 1; l <= 16; l++) for (let i = 0; i < counts[l - 1]; i++) sizes.push(l);
    let code = 0, si = sizes[0] ?? 0, p = 0;
    while (p < sizes.length) {
      while (sizes[p] === si) { codes[p++] = code++; }
      if (code > 1 << si) throw new Error('JPEG: bad Huffman table');
      code <<= 1;
      si++;
    }
    for (let i = 0; i < sizes.length; i++) this.values[i] = symbols[i];
    p = 0;
    for (let l = 1; l <= 16; l++) {
      if (counts[l - 1]) {
        this.valptr[l] = p - codes[p];
        p += counts[l - 1];
        this.maxcode[l] = codes[p - 1];
      } else this.maxcode[l] = -1;
    }
    this.maxcode[17] = 0x7fffffff;
    p = 0;
    for (let l = 1; l <= 9; l++) {
      for (let i = 0; i < counts[l - 1]; i++, p++) {
        const base = codes[p] << (9 - l);
        for (let k = 0; k < 1 << (9 - l); k++) this.look[base + k] = (l << 8) | symbols[p];
      }
    }
    if (ac) {
      for (let i = 0; i < 512; i++) {
        const e = this.look[i];
        if (!e) continue;
        const len = e >> 8, run = (e >> 4) & 15, size = e & 15;
        if (!size || len + size > 9) continue;
        let v = (i >> (9 - len - size)) & ((1 << size) - 1);
        if (v < 1 << (size - 1)) v -= (1 << size) - 1;
        this.fast[i] = (v * 65536) | (run << 8) | (len + size);
      }
    }
  }
}

/** Entropy-coded data, read MSB first. Past a marker or the end it reads zeros and counts them in `pad`. */
class Bits {
  buf = 0;
  bits = 0;
  pad = 0;
  hit = false;
  /** Set once a block has needed bits past the data: the rest of the segment is left as zeros, as libjpeg does. */
  short = false;
  constructor(readonly data: Uint8Array, public pos: number) {}

  /** Tops the buffer up to more than 24 bits. */
  fill(): void {
    const data = this.data, end = data.length;
    let buf = this.buf, bits = this.bits, pos = this.pos;
    while (bits <= 24) {
      let b = 0;
      if (!this.hit) {
        if (pos < end) {
          b = data[pos];
          if (b !== 0xff) pos++;
          else {
            let q = pos + 1;
            while (q < end && data[q] === 0xff) q++;
            if (q < end && data[q] === 0) pos = q + 1;
            else { this.hit = true; b = 0; }
          }
        } else this.hit = true;
      }
      if (this.hit) this.pad += 8;
      buf = (buf << 8) | b;
      bits += 8;
    }
    this.buf = buf;
    this.bits = bits;
    this.pos = pos;
  }

  decode(t: Huffman): number {
    if (this.bits < 16) this.fill();
    const e = t.look[(this.buf >>> (this.bits - 9)) & 511];
    if (e) {
      this.bits -= e >> 8;
      return e & 255;
    }
    return this.slow(t);
  }

  /** Codes longer than 9 bits. A code that is in no table reads as 0, as in libjpeg. */
  slow(t: Huffman): number {
    const buf = this.buf, bits = this.bits;
    let l = 10, code = (buf >>> (bits - 10)) & 1023;
    while (l <= 16 && code > t.maxcode[l]) {
      l++;
      code = (buf >>> (bits - l)) & ((1 << l) - 1);
    }
    if (l > 16) {
      this.bits = bits - 16;
      return 0;
    }
    this.bits = bits - l;
    return t.values[(t.valptr[l] + code) & 255];
  }

  get(n: number): number {
    if (this.bits < n) this.fill();
    this.bits -= n;
    return (this.buf >>> this.bits) & ((1 << n) - 1);
  }

  /** A value of `s` bits, sign-extended the JPEG way. */
  receive(s: number): number {
    const v = this.get(s);
    return v < 1 << (s - 1) ? v - (1 << s) + 1 : v;
  }

  /** Drops the bit buffer, ready to read on from a byte boundary at `pos`. */
  reset(): void {
    this.buf = this.bits = this.pad = 0;
    this.hit = false;
  }
}

interface Component {
  id: number;
  h: number;
  v: number;
  tq: number;
  /** Samples across and down: the component's own size. */
  sw: number;
  sh: number;
  /** Blocks across and down that hold the component's samples. */
  bw: number;
  bh: number;
  /** Blocks across in storage (whole MCUs). */
  stride: number;
  /** Progressive files: every block's coefficients until the last scan, taken at the component's first scan. */
  coefs: Int16Array | null;
  /** Per block: 1 once any AC coefficient is non-zero, so DC-only blocks skip the IDCT. */
  nz: Uint8Array | null;
  /** Sequential files: the samples, each block put through the IDCT as it is decoded (grey until then). */
  samples: Uint8Array | null;
  /** The quantisation table in natural order, taken at the component's first scan. */
  quant: Int32Array | null;
  dc: Huffman | null;
  ac: Huffman | null;
  pred: number;
}

interface Frame {
  progressive: boolean;
  width: number;
  height: number;
  comps: Component[];
  maxH: number;
  maxV: number;
  mcusX: number;
  mcusY: number;
}

const BASELINE = 0, DC_FIRST = 1, DC_REFINE = 2, AC_FIRST = 3, AC_REFINE = 4;
const MAX_SCANS = 1000;

/** Decodes a JPEG. */
export function decodeJpeg(bytes: Uint8Array, options?: DecodeOptions): DecodedImage {
  const limits = limitsOf(options);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('JPEG: not a JPEG file');
  const n = bytes.length;
  const quant: (Int32Array | null)[] = [null, null, null, null];
  const dcTables: (Huffman | null)[] = [null, null, null, null], acTables: (Huffman | null)[] = [null, null, null, null];
  let frame: Frame | null = null, restart = 0, adobe = -1, jfif = false, orientation = 1, scans = 0;
  let pos = 2;
  markers: while (pos < n) {
    if (bytes[pos] !== 0xff) { pos++; continue; } // Junk between markers.
    const m = bytes[pos + 1];
    if (m === 0xff) { pos++; continue; } // Fill bytes.
    pos += 2;
    if (m === 0xd8 || m === 0x01 || m === 0 || (m >= 0xd0 && m <= 0xd7)) continue;
    if (m === 0xd9) break;
    const len = pos + 2 <= n ? (bytes[pos] << 8) | bytes[pos + 1] : 0;
    // A segment the end of the file cuts short ends the file.
    if (pos + len > n || pos + 2 > n) break;
    if (len < 2) throw new Error('JPEG: bad marker length');
    const s = pos + 2, e = pos + len;
    pos += len;
    switch (m) {
      case 0xc0: case 0xc1: case 0xc2:
        if (frame) throw new Error('JPEG: more than one frame');
        frame = frameHeader(bytes, s, e, m === 0xc2, limits.maxPixels);
        break;
      case 0xc3:
        throw new Error('JPEG: lossless JPEG is not supported');
      case 0xc5: case 0xc6: case 0xc7: case 0xde: case 0xdf:
        throw new Error('JPEG: hierarchical JPEG is not supported');
      case 0xc9: case 0xca: case 0xcb: case 0xcd: case 0xce: case 0xcf:
        throw new Error('JPEG: arithmetic coding is not supported');
      case 0xc4:
        huffmanTables(bytes, s, e, dcTables, acTables);
        break;
      case 0xdb:
        quantTables(bytes, s, e, quant);
        break;
      case 0xdd:
        if (e - s >= 2) restart = (bytes[s] << 8) | bytes[s + 1];
        break;
      case 0xe0:
        if (e - s >= 5 && bytes[s] === 0x4a && bytes[s + 1] === 0x46 && bytes[s + 2] === 0x49 && bytes[s + 3] === 0x46 && bytes[s + 4] === 0) jfif = true;
        break;
      case 0xe1:
        if (orientation === 1) orientation = exifOrientation(bytes, s, e);
        break;
      case 0xee:
        if (e - s >= 12 && bytes[s] === 0x41 && bytes[s + 1] === 0x64 && bytes[s + 2] === 0x6f && bytes[s + 3] === 0x62 && bytes[s + 4] === 0x65) adobe = bytes[s + 11];
        break;
      case 0xda: {
        if (!frame) throw new Error('JPEG: scan before the frame header');
        // Each scan walks the whole image, so a file of many tiny scans could take very long; real ones have a few dozen.
        if (scans >= MAX_SCANS) throw new Error(`JPEG: more than ${MAX_SCANS} scans`);
        const r = new Bits(bytes, Math.min(pos, n));
        scan(frame, bytes, s, e, dcTables, acTables, quant, restart, r);
        scans++;
        pos = r.pos;
        if (r.pos >= n) break markers;
        break;
      }
      default:
        // APPn, COM and the rest: skipped.
        break;
    }
  }
  if (!frame) throw new Error('JPEG: no frame header');
  if (!scans) throw new Error('JPEG: no image data');
  let { data, width, height } = render(frame, adobe, jfif);
  if (limits.orientation && orientation > 1) ({ data, width, height } = orient(data, width, height, orientation));
  return still('jpeg', width, height, data);
}

function frameHeader(b: Uint8Array, s: number, e: number, progressive: boolean, maxPixels: number): Frame {
  if (e - s < 6) throw new Error('JPEG: frame header too short');
  const precision = b[s], height = (b[s + 1] << 8) | b[s + 2], width = (b[s + 3] << 8) | b[s + 4], count = b[s + 5];
  if (precision !== 8) throw new Error(`JPEG: ${precision}-bit precision is not supported`);
  if (height === 0) throw new Error('JPEG: images whose height is given by a DNL marker are not supported');
  checkSize('JPEG', width, height, maxPixels);
  if (count !== 1 && count !== 3 && count !== 4) throw new Error(`JPEG: ${count}-component images are not supported`);
  if (e - s < 6 + count * 3) throw new Error('JPEG: frame header too short');
  const comps: Component[] = [];
  let maxH = 1, maxV = 1;
  for (let i = 0; i < count; i++) {
    const p = s + 6 + i * 3, h = b[p + 1] >> 4, v = b[p + 1] & 15;
    if (h < 1 || h > 4 || v < 1 || v > 4) throw new Error('JPEG: bad sampling factors');
    maxH = Math.max(maxH, h);
    maxV = Math.max(maxV, v);
    comps.push({ id: b[p], h, v, tq: b[p + 2] & 3, sw: 0, sh: 0, bw: 0, bh: 0, stride: 0, coefs: null, nz: null, samples: null, quant: null, dc: null, ac: null, pred: 0 });
  }
  const mcusX = Math.ceil(width / (8 * maxH)), mcusY = Math.ceil(height / (8 * maxV));
  for (const c of comps) {
    c.sw = Math.ceil((width * c.h) / maxH);
    c.sh = Math.ceil((height * c.v) / maxV);
    c.bw = Math.ceil(c.sw / 8);
    c.bh = Math.ceil(c.sh / 8);
    c.stride = mcusX * c.h;
  }
  return { progressive, width, height, comps, maxH, maxV, mcusX, mcusY };
}

function huffmanTables(b: Uint8Array, s: number, e: number, dc: (Huffman | null)[], ac: (Huffman | null)[]): void {
  while (s + 17 <= e) {
    const tc = b[s] >> 4, th = b[s] & 15;
    const counts = b.subarray(s + 1, s + 17);
    let total = 0;
    for (let i = 0; i < 16; i++) total += counts[i];
    if (total > 256 || s + 17 + total > e || tc > 1 || th > 3) throw new Error('JPEG: bad Huffman table');
    const symbols = b.subarray(s + 17, s + 17 + total);
    if (tc === 0) {
      for (let i = 0; i < total; i++) if (symbols[i] > 15) throw new Error('JPEG: bad Huffman table');
      dc[th] = new Huffman(counts, symbols, false);
    } else ac[th] = new Huffman(counts, symbols, true);
    s += 17 + total;
  }
}

function quantTables(b: Uint8Array, s: number, e: number, quant: (Int32Array | null)[]): void {
  while (s < e) {
    const wide = b[s] >> 4, id = b[s] & 15;
    if (id > 3 || wide > 1 || s + 1 + (wide ? 128 : 64) > e) throw new Error('JPEG: bad quantisation table');
    const t = new Int32Array(64);
    for (let k = 0; k < 64; k++) t[ZIGZAG[k]] = wide ? (b[s + 1 + k * 2] << 8) | b[s + 2 + k * 2] : b[s + 1 + k];
    quant[id] = t;
    s += 1 + (wide ? 128 : 64);
  }
}

/** The EXIF orientation (1–8) in an APP1 segment, or 1. */
function exifOrientation(b: Uint8Array, s: number, e: number): number {
  if (e - s < 14 || b[s] !== 0x45 || b[s + 1] !== 0x78 || b[s + 2] !== 0x69 || b[s + 3] !== 0x66 || b[s + 4] !== 0 || b[s + 5] !== 0) return 1;
  const t = s + 6, le = b[t] === 0x49 && b[t + 1] === 0x49;
  if (!le && !(b[t] === 0x4d && b[t + 1] === 0x4d)) return 1;
  const u16 = (i: number) => (le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
  const u32 = (i: number) => (le ? (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0 : ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0);
  if (u16(t + 2) !== 42) return 1;
  const ifd = t + u32(t + 4);
  if (ifd + 2 > e) return 1;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const p = ifd + 2 + i * 12;
    if (p + 12 > e) break;
    if (u16(p) !== 0x0112) continue;
    const type = u16(p + 2), v = type === 3 ? u16(p + 8) : type === 4 ? u32(p + 8) : 0;
    return v >= 1 && v <= 8 ? v : 1;
  }
  return 1;
}

/** Reads a scan header and decodes the scan's entropy-coded data, which `r` starts at. */
function scan(f: Frame, b: Uint8Array, s: number, e: number, dcTables: (Huffman | null)[], acTables: (Huffman | null)[], quant: (Int32Array | null)[], interval: number, r: Bits): void {
  const count = b[s];
  if (count < 1 || count > 4 || s + 1 + count * 2 + 3 > e) throw new Error('JPEG: bad scan header');
  const comps: Component[] = [];
  for (let i = 0; i < count; i++) {
    const id = b[s + 1 + i * 2], tables = b[s + 2 + i * 2];
    const c = f.comps.find(x => x.id === id);
    if (!c) throw new Error('JPEG: scan names an unknown component');
    const td = tables >> 4, ta = tables & 15;
    if (td > 3 || ta > 3) throw new Error('JPEG: bad Huffman table number');
    // A missing table is taken from the standard ones, as libjpeg-turbo does for motion JPEG.
    c.dc = dcTables[td] ?? standardTable(false, td);
    c.ac = acTables[ta] ?? standardTable(true, ta);
    if (!c.quant) {
      const q = quant[c.tq];
      if (!q) throw new Error('JPEG: missing quantisation table');
      c.quant = q.slice();
    }
    comps.push(c);
  }
  const p = s + 1 + count * 2;
  const ss = b[p], se = b[p + 1], ah = b[p + 2] >> 4, al = b[p + 2] & 15;
  let mode = BASELINE;
  if (f.progressive) {
    if (ss === 0) {
      if (se !== 0) throw new Error('JPEG: bad progressive scan');
      mode = ah ? DC_REFINE : DC_FIRST;
    } else {
      if (ss > se || se > 63 || count !== 1) throw new Error('JPEG: bad progressive scan');
      mode = ah ? AC_REFINE : AC_FIRST;
    }
    if (al > 13 || (ah && al !== ah - 1)) throw new Error('JPEG: bad progressive scan');
  }
  if (count > 1) {
    let blocks = 0;
    for (const c of comps) blocks += c.h * c.v;
    if (blocks > 10) throw new Error('JPEG: too many blocks in an MCU');
  }
  for (const c of comps) {
    if (!c.dc && mode !== AC_FIRST && mode !== AC_REFINE && mode !== DC_REFINE) throw new Error('JPEG: missing Huffman table');
    if (!c.ac && (mode === BASELINE || mode === AC_FIRST || mode === AC_REFINE)) throw new Error('JPEG: missing Huffman table');
    c.pred = 0;
    // Storage, made when a scan first needs it, so a header alone allocates nothing.
    if (mode === BASELINE) {
      if (!c.samples) c.samples = new Uint8Array(c.bw * 8 * c.bh * 8).fill(128);
    } else if (!c.coefs) {
      const blocks = c.stride * f.mcusY * c.v;
      c.coefs = new Int16Array(blocks * 64);
      c.nz = new Uint8Array(blocks);
    }
  }

  const single = count === 1, one = comps[0];
  const across = single ? one.bw : f.mcusX, total = single ? one.bw * one.bh : f.mcusX * f.mcusY;
  const eob = { run: 0 };
  let toGo = interval, next = 0;
  for (let m = 0; m < total; m++) {
    // Did the last MCU read past the data? Then, as in libjpeg, the rest of the segment is left as zeros.
    if (!r.short && r.bits < r.pad) r.short = true;
    if (interval) {
      if (toGo === 0) {
        next = restartMarker(r, next);
        toGo = interval;
        for (const c of comps) c.pred = 0;
        eob.run = 0;
      }
      toGo--;
    }
    if (r.short) {
      // Nothing more comes before a restart marker; with none due, or another marker ahead, the scan is over.
      if (!interval || !restartAhead(r)) break;
      continue;
    }
    const mx = m % across, my = (m - mx) / across;
    if (single) {
      block(mode, r, one, mx, my, ss, se, al, eob);
    } else {
      for (const c of comps) {
        for (let v = 0; v < c.v; v++) for (let h = 0; h < c.h; h++) block(mode, r, c, mx * c.h + h, my * c.v + v, ss, se, al, eob);
      }
    }
  }
  // Leave `pos` on the marker after the scan, or wherever the data stopped.
  if (!r.hit) r.pos = Math.min(r.pos, b.length);
}

/**
 * Reads the restart marker due next, with libjpeg's rules for damaged files (jpeg_resync_to_restart): the expected marker,
 * or one too far off to judge, is read past; one of the next two is left for later, the segment before it read as empty;
 * an earlier one is skipped; any other marker ends the scan's data. Returns the number of the marker due after it.
 */
function restartMarker(r: Bits, expected: number): number {
  const b = r.data, n = b.length;
  r.reset();
  let p = r.pos;
  for (;;) {
    while (p < n && !(b[p] === 0xff && p + 1 < n && b[p + 1] !== 0 && b[p + 1] !== 0xff)) p++;
    if (p + 1 >= n) {
      r.pos = n;
      r.hit = true;
      break;
    }
    const m = b[p + 1];
    if (m < 0xc0) {
      // Not a valid marker: look on.
      p += 2;
      continue;
    }
    if (m < 0xd0 || m > 0xd7) {
      r.pos = p;
      r.hit = true;
      break;
    }
    const d = (m - 0xd0 - expected) & 7;
    if (d === 1 || d === 2) {
      r.pos = p;
      r.hit = true;
      break;
    }
    if (d === 6 || d === 7) {
      p += 2;
      continue;
    }
    r.pos = p + 2;
    r.short = false;
    break;
  }
  return (expected + 1) & 7;
}

/** True if the marker the data stopped at could be a restart marker (or an invalid one, which libjpeg looks past). */
function restartAhead(r: Bits): boolean {
  const b = r.data;
  let p = r.pos;
  while (p + 1 < b.length && b[p + 1] === 0xff) p++;
  return p + 1 < b.length && b[p] === 0xff && (b[p + 1] < 0xc0 || (b[p + 1] >= 0xd0 && b[p + 1] <= 0xd7));
}

const scratch = new Int16Array(64), workspace = new Int32Array(64);

/** Decodes block (bx, by) of a component: straight to its samples in a sequential scan, else into its coefficients. */
function block(mode: number, r: Bits, c: Component, bx: number, by: number, ss: number, se: number, al: number, eob: { run: number }): void {
  if (mode === BASELINE) {
    const any = baseline(r, c, scratch, 0);
    // Blocks that only pad out the last MCUs are decoded (the data must be read) and dropped.
    if (bx < c.bw && by < c.bh) {
      const stride = c.bw * 8, o = by * 8 * stride + bx * 8, q = c.quant as Int32Array, out = c.samples as Uint8Array;
      if (any) idct(scratch, 0, q, out, o, stride, workspace);
      else {
        const v = LIMIT[((scratch[0] * q[0] + 4) >> 3) & 1023];
        for (let y = 0, p = o; y < 8; y++, p += stride) out.fill(v, p, p + 8);
      }
    }
    scratch.fill(0);
    return;
  }
  const off = (by * c.stride + bx) * 64, coefs = c.coefs as Int16Array;
  switch (mode) {
    case DC_FIRST: {
      const s = r.decode(c.dc as Huffman);
      if (s) c.pred += r.receive(s);
      coefs[off] = c.pred * (1 << al);
      return;
    }
    case DC_REFINE:
      if (r.get(1)) coefs[off] |= 1 << al;
      return;
    case AC_FIRST:
      acFirst(r, c, off, ss, se, al, eob);
      return;
    default:
      acRefine(r, c, off, ss, se, al, eob);
  }
}

/** A sequential block's coefficients into coefs[off..]; returns 1 if any AC coefficient is non-zero. */
function baseline(r: Bits, c: Component, coefs: Int16Array, off: number): number {
  const ac = c.ac as Huffman;
  const s = r.decode(c.dc as Huffman);
  if (s) c.pred += r.receive(s);
  coefs[off] = c.pred;
  const fast = ac.fast, look = ac.look;
  let k = 1, any = 0, buf = r.buf, bits = r.bits;
  while (k < 64) {
    if (bits < 16) {
      r.bits = bits;
      r.fill();
      buf = r.buf;
      bits = r.bits;
    }
    const peek = (buf >>> (bits - 9)) & 511, f = fast[peek];
    if (f !== 0) {
      k += (f >> 8) & 15;
      bits -= f & 255;
      coefs[off + ZIGZAG[k]] = f >> 16;
      k++;
      any = 1;
      continue;
    }
    let rs: number;
    const e = look[peek];
    if (e !== 0) {
      bits -= e >> 8;
      rs = e & 255;
    } else {
      r.bits = bits;
      rs = r.slow(ac);
      bits = r.bits;
    }
    const size = rs & 15, run = rs >> 4;
    if (size === 0) {
      if (run !== 15) break;
      k += 16;
      continue;
    }
    k += run;
    if (bits < size) {
      r.bits = bits;
      r.fill();
      buf = r.buf;
      bits = r.bits;
    }
    bits -= size;
    const v = (buf >>> bits) & ((1 << size) - 1);
    coefs[off + ZIGZAG[k]] = v < 1 << (size - 1) ? v - (1 << size) + 1 : v;
    k++;
    any = 1;
  }
  r.bits = bits;
  return any;
}

function acFirst(r: Bits, c: Component, off: number, ss: number, se: number, al: number, eob: { run: number }): void {
  if (eob.run > 0) {
    eob.run--;
    return;
  }
  const coefs = c.coefs as Int16Array, nz = c.nz as Uint8Array, ac = c.ac as Huffman, fast = ac.fast, scale = 1 << al;
  for (let k = ss; k <= se; k++) {
    if (r.bits < 16) r.fill();
    const f = fast[(r.buf >>> (r.bits - 9)) & 511];
    if (f !== 0) {
      k += (f >> 8) & 15;
      r.bits -= f & 255;
      coefs[off + ZIGZAG[k]] = (f >> 16) * scale;
      nz[off >> 6] = 1;
      continue;
    }
    const rs = r.decode(ac), run = rs >> 4, s = rs & 15;
    if (s) {
      k += run;
      coefs[off + ZIGZAG[k]] = r.receive(s) * scale;
      nz[off >> 6] = 1;
    } else if (run === 15) {
      k += 15;
    } else {
      let n = 1 << run;
      if (run) n += r.get(run);
      eob.run = n - 1;
      break;
    }
  }
}

function acRefine(r: Bits, c: Component, off: number, ss: number, se: number, al: number, eob: { run: number }): void {
  const coefs = c.coefs as Int16Array, ac = c.ac as Huffman, p1 = 1 << al, m1 = -1 << al;
  let k = ss;
  if (eob.run === 0) {
    for (; k <= se; k++) {
      const rs = r.decode(ac);
      let run = rs >> 4;
      const s = rs & 15;
      let value = 0;
      if (s) {
        value = r.get(1) ? p1 : m1;
      } else if (run !== 15) {
        eob.run = 1 << run;
        if (run) eob.run += r.get(run);
        break;
      }
      // Step over coefficients already non-zero (refining each) and `run` zero ones.
      while (k <= se) {
        const z = off + ZIGZAG[k], cur = coefs[z];
        if (cur !== 0) {
          if (r.get(1) && (cur & p1) === 0) coefs[z] = cur >= 0 ? cur + p1 : cur + m1;
        } else {
          if (run === 0) break;
          run--;
        }
        k++;
      }
      if (value) {
        coefs[off + ZIGZAG[k]] = value;
        (c.nz as Uint8Array)[off >> 6] = 1;
      }
    }
  }
  if (eob.run > 0) {
    for (; k <= se; k++) {
      const z = off + ZIGZAG[k], cur = coefs[z];
      if (cur !== 0 && r.get(1) && (cur & p1) === 0) coefs[z] = cur >= 0 ? cur + p1 : cur + m1;
    }
    eob.run--;
  }
}

/** libjpeg's jpeg_idct_islow: the accurate integer IDCT, exactly, writing 8 × 8 samples. */
function idct(coefs: Int16Array, off: number, q: Int32Array, out: Uint8Array, o: number, stride: number, ws: Int32Array): void {
  for (let c = 0; c < 8; c++) {
    const i = off + c;
    if (coefs[i + 8] === 0 && coefs[i + 16] === 0 && coefs[i + 24] === 0 && coefs[i + 32] === 0 && coefs[i + 40] === 0 && coefs[i + 48] === 0 && coefs[i + 56] === 0) {
      const dc = (coefs[i] * q[c]) << 2;
      ws[c] = ws[c + 8] = ws[c + 16] = ws[c + 24] = ws[c + 32] = ws[c + 40] = ws[c + 48] = ws[c + 56] = dc;
      continue;
    }
    let z2 = coefs[i + 16] * q[c + 16], z3 = coefs[i + 48] * q[c + 48];
    let z1 = (z2 + z3) * 4433;
    let tmp2 = z1 - z3 * 15137, tmp3 = z1 + z2 * 6270;
    z2 = coefs[i] * q[c];
    z3 = coefs[i + 32] * q[c + 32];
    let tmp0 = (z2 + z3) * 8192, tmp1 = (z2 - z3) * 8192;
    const tmp10 = tmp0 + tmp3, tmp13 = tmp0 - tmp3, tmp11 = tmp1 + tmp2, tmp12 = tmp1 - tmp2;
    tmp0 = coefs[i + 56] * q[c + 56];
    tmp1 = coefs[i + 40] * q[c + 40];
    tmp2 = coefs[i + 24] * q[c + 24];
    tmp3 = coefs[i + 8] * q[c + 8];
    z1 = tmp0 + tmp3;
    z2 = tmp1 + tmp2;
    z3 = tmp0 + tmp2;
    let z4 = tmp1 + tmp3;
    const z5 = (z3 + z4) * 9633;
    tmp0 *= 2446;
    tmp1 *= 16819;
    tmp2 *= 25172;
    tmp3 *= 12299;
    z1 *= -7373;
    z2 *= -20995;
    z3 = z3 * -16069 + z5;
    z4 = z4 * -3196 + z5;
    tmp0 += z1 + z3;
    tmp1 += z2 + z4;
    tmp2 += z2 + z3;
    tmp3 += z1 + z4;
    ws[c] = (tmp10 + tmp3 + 1024) >> 11;
    ws[c + 56] = (tmp10 - tmp3 + 1024) >> 11;
    ws[c + 8] = (tmp11 + tmp2 + 1024) >> 11;
    ws[c + 48] = (tmp11 - tmp2 + 1024) >> 11;
    ws[c + 16] = (tmp12 + tmp1 + 1024) >> 11;
    ws[c + 40] = (tmp12 - tmp1 + 1024) >> 11;
    ws[c + 24] = (tmp13 + tmp0 + 1024) >> 11;
    ws[c + 32] = (tmp13 - tmp0 + 1024) >> 11;
  }
  for (let rw = 0; rw < 64; rw += 8, o += stride) {
    if (ws[rw + 1] === 0 && ws[rw + 2] === 0 && ws[rw + 3] === 0 && ws[rw + 4] === 0 && ws[rw + 5] === 0 && ws[rw + 6] === 0 && ws[rw + 7] === 0) {
      const v = LIMIT[((ws[rw] + 16) >> 5) & 1023];
      out[o] = out[o + 1] = out[o + 2] = out[o + 3] = out[o + 4] = out[o + 5] = out[o + 6] = out[o + 7] = v;
      continue;
    }
    let z2 = ws[rw + 2], z3 = ws[rw + 6];
    let z1 = (z2 + z3) * 4433;
    let tmp2 = z1 - z3 * 15137, tmp3 = z1 + z2 * 6270;
    let tmp0 = (ws[rw] + ws[rw + 4]) * 8192, tmp1 = (ws[rw] - ws[rw + 4]) * 8192;
    const tmp10 = tmp0 + tmp3, tmp13 = tmp0 - tmp3, tmp11 = tmp1 + tmp2, tmp12 = tmp1 - tmp2;
    tmp0 = ws[rw + 7];
    tmp1 = ws[rw + 5];
    tmp2 = ws[rw + 3];
    tmp3 = ws[rw + 1];
    z1 = tmp0 + tmp3;
    z2 = tmp1 + tmp2;
    z3 = tmp0 + tmp2;
    let z4 = tmp1 + tmp3;
    const z5 = (z3 + z4) * 9633;
    tmp0 *= 2446;
    tmp1 *= 16819;
    tmp2 *= 25172;
    tmp3 *= 12299;
    z1 *= -7373;
    z2 *= -20995;
    z3 = z3 * -16069 + z5;
    z4 = z4 * -3196 + z5;
    tmp0 += z1 + z3;
    tmp1 += z2 + z4;
    tmp2 += z2 + z3;
    tmp3 += z1 + z4;
    out[o] = LIMIT[((tmp10 + tmp3 + 131072) >> 18) & 1023];
    out[o + 7] = LIMIT[((tmp10 - tmp3 + 131072) >> 18) & 1023];
    out[o + 1] = LIMIT[((tmp11 + tmp2 + 131072) >> 18) & 1023];
    out[o + 6] = LIMIT[((tmp11 - tmp2 + 131072) >> 18) & 1023];
    out[o + 2] = LIMIT[((tmp12 + tmp1 + 131072) >> 18) & 1023];
    out[o + 5] = LIMIT[((tmp12 - tmp1 + 131072) >> 18) & 1023];
    out[o + 3] = LIMIT[((tmp13 + tmp0 + 131072) >> 18) & 1023];
    out[o + 4] = LIMIT[((tmp13 - tmp0 + 131072) >> 18) & 1023];
  }
}

/** A component's samples after the IDCT, and how to bring a row of them to full size. */
interface Plane {
  data: Uint8Array;
  stride: number;
  sw: number;
  sh: number;
  method: number;
  /** Upsampled row, and the vertical sums the 2 × 2 filter keeps. */
  row: Uint8Array;
  sums: Int32Array;
  h: number;
  v: number;
  /** For the generic methods: the source column of each output column. */
  cols: Int32Array | null;
}

const FULL = 0, H2V1 = 1, H1V2 = 2, H2V2 = 3, H2V1_BOX = 4, H2V2_BOX = 5, GENERIC = 6;

function plane(c: Component, f: Frame): Plane {
  const stride = c.bw * 8;
  let data = c.samples;
  if (!data) {
    // Progressive: the IDCT of every block now. A component no scan reached is grey, as all-zero coefficients give.
    data = new Uint8Array(stride * c.bh * 8);
    const coefs = c.coefs, nz = c.nz, q = c.quant;
    if (!coefs || !nz || !q) data.fill(128);
    else {
      for (let by = 0; by < c.bh; by++) {
        for (let bx = 0; bx < c.bw; bx++) {
          const blk = by * c.stride + bx, off = blk * 64, o = by * 8 * stride + bx * 8;
          if (nz[blk]) idct(coefs, off, q, data, o, stride, workspace);
          else {
            // DC only: the IDCT gives one value, exactly.
            const v = LIMIT[((coefs[off] * q[0] + 4) >> 3) & 1023];
            for (let y = 0, p = o; y < 8; y++, p += stride) data.fill(v, p, p + 8);
          }
        }
      }
    }
  }
  const rh = f.maxH / c.h, rv = f.maxV / c.v;
  let method = GENERIC;
  if (rh === 1 && rv === 1) method = FULL;
  else if (rh === 2 && rv === 1) method = c.sw > 2 ? H2V1 : H2V1_BOX;
  else if (rh === 1 && rv === 2) method = H1V2;
  else if (rh === 2 && rv === 2) method = c.sw > 2 ? H2V2 : H2V2_BOX;
  let cols: Int32Array | null = null;
  if (method === GENERIC) {
    // Integral factors replicate (libjpeg's int_upsample); others, which libjpeg refuses, take the nearest sample.
    cols = new Int32Array(f.width);
    for (let x = 0; x < f.width; x++) cols[x] = Math.min(c.sw - 1, Math.floor((x * c.h) / f.maxH));
  }
  return { data, stride, sw: c.sw, sh: c.sh, method, row: new Uint8Array(Math.max(f.width, c.sw * 2)), sums: new Int32Array(c.sw), h: c.h, v: c.v, cols };
}

/** Puts row y of the component at full size in p.row (or returns the plane's own row offset when no work is needed). */
function upsample(p: Plane, y: number, f: Frame): number {
  const d = p.data, s = p.stride, out = p.row, w = p.sw;
  switch (p.method) {
    case FULL:
      return y * s;
    case H2V1: {
      // libjpeg's h2v1_fancy_upsample: 3/4 of the nearer sample and 1/4 of the further one.
      let i = y * s;
      out[0] = d[i];
      out[1] = (d[i] * 3 + d[i + 1] + 2) >> 2;
      let o = 2;
      for (let x = 1; x < w - 1; x++) {
        i++;
        const v = d[i] * 3;
        out[o++] = (v + d[i - 1] + 1) >> 2;
        out[o++] = (v + d[i + 1] + 2) >> 2;
      }
      i++;
      out[o++] = (d[i] * 3 + d[i - 1] + 1) >> 2;
      out[o] = d[i];
      return -1;
    }
    case H1V2: {
      const r = y >> 1, near = r * s, far = (y & 1 ? Math.min(r + 1, p.sh - 1) : Math.max(r - 1, 0)) * s, bias = y & 1 ? 2 : 1;
      for (let x = 0; x < w; x++) out[x] = (d[near + x] * 3 + d[far + x] + bias) >> 2;
      return -1;
    }
    case H2V2: {
      // libjpeg's h2v2_fancy_upsample: 9/16, 3/16, 3/16, 1/16 of the four nearest samples.
      const r = y >> 1, near = r * s, far = (y & 1 ? Math.min(r + 1, p.sh - 1) : Math.max(r - 1, 0)) * s, sums = p.sums;
      for (let x = 0; x < w; x++) sums[x] = d[near + x] * 3 + d[far + x];
      let last = sums[0], self = sums[0], next = sums[1];
      out[0] = (self * 4 + 8) >> 4;
      out[1] = (self * 3 + next + 7) >> 4;
      let o = 2;
      for (let x = 1; x < w - 1; x++) {
        last = self;
        self = next;
        next = sums[x + 1];
        out[o++] = (self * 3 + last + 8) >> 4;
        out[o++] = (self * 3 + next + 7) >> 4;
      }
      last = self;
      self = next;
      out[o++] = (self * 3 + last + 8) >> 4;
      out[o] = (self * 4 + 7) >> 4;
      return -1;
    }
    case H2V1_BOX:
    case H2V2_BOX: {
      const i = (p.method === H2V2_BOX ? y >> 1 : y) * s;
      for (let x = 0; x < w; x++) out[x * 2] = out[x * 2 + 1] = d[i + x];
      return -1;
    }
    default: {
      const i = Math.min(p.sh - 1, Math.floor((y * p.v) / f.maxV)) * s, cols = p.cols as Int32Array;
      for (let x = 0; x < f.width; x++) out[x] = d[i + cols[x]];
      return -1;
    }
  }
}

const muldiv255 = (a: number, b: number) => {
  const t = a * b + 128;
  return ((t >> 8) + t) >> 8;
};

/** IDCT, upsampling and colour conversion to RGBA. */
function render(f: Frame, adobe: number, jfif: boolean): { data: Uint8Array; width: number; height: number } {
  const { width, height, comps } = f;
  const planes = comps.map(c => plane(c, f));
  const out = new Uint8Array(width * height * 4), clamped = new Uint8ClampedArray(out.buffer);
  const count = comps.length;
  // libjpeg's choice of colour space.
  let transform: 'grey' | 'ycc' | 'rgb' | 'cmyk' | 'ycck';
  if (count === 1) transform = 'grey';
  else if (count === 3) {
    if (jfif) transform = 'ycc';
    else if (adobe >= 0) transform = adobe === 0 ? 'rgb' : 'ycc';
    else transform = comps[0].id === 82 && comps[1].id === 71 && comps[2].id === 66 ? 'rgb' : 'ycc';
  } else transform = adobe >= 0 ? (adobe === 0 ? 'cmyk' : 'ycck') : 'cmyk';
  const rows: Uint8Array[] = new Array(count), offs = new Int32Array(count);
  for (let y = 0; y < height; y++) {
    for (let i = 0; i < count; i++) {
      const o = upsample(planes[i], y, f);
      if (o >= 0) { rows[i] = planes[i].data; offs[i] = o; } else { rows[i] = planes[i].row; offs[i] = 0; }
    }
    let o = y * width * 4;
    const r0 = rows[0], o0 = offs[0];
    if (transform === 'grey') {
      for (let x = 0; x < width; x++, o += 4) {
        const v = r0[o0 + x];
        out[o] = out[o + 1] = out[o + 2] = v;
        out[o + 3] = 255;
      }
      continue;
    }
    const r1 = rows[1], o1 = offs[1], r2 = rows[2], o2 = offs[2];
    if (transform === 'ycc') {
      for (let x = 0; x < width; x++, o += 4) {
        const Y = r0[o0 + x], cb = r1[o1 + x], cr = r2[o2 + x];
        clamped[o] = Y + CR_R[cr];
        clamped[o + 1] = Y + ((CB_G[cb] + CR_G[cr]) >> 16);
        clamped[o + 2] = Y + CB_B[cb];
        out[o + 3] = 255;
      }
    } else if (transform === 'rgb') {
      for (let x = 0; x < width; x++, o += 4) {
        out[o] = r0[o0 + x];
        out[o + 1] = r1[o1 + x];
        out[o + 2] = r2[o2 + x];
        out[o + 3] = 255;
      }
    } else {
      // libjpeg's CMYK out (YCCK converted the way jdcolor.c does), then Pillow's inverted-CMYK to RGB.
      const r3 = rows[3], o3 = offs[3], ycck = transform === 'ycck';
      for (let x = 0; x < width; x++, o += 4) {
        let c = r0[o0 + x], m = r1[o1 + x], ye = r2[o2 + x];
        const k = r3[o3 + x];
        if (ycck) {
          const Y = c, cb = m, cr = ye;
          c = clamp255(255 - (Y + CR_R[cr]));
          m = clamp255(255 - (Y + ((CB_G[cb] + CR_G[cr]) >> 16)));
          ye = clamp255(255 - (Y + CB_B[cb]));
        }
        out[o] = k - muldiv255(255 - c, k);
        out[o + 1] = k - muldiv255(255 - m, k);
        out[o + 2] = k - muldiv255(255 - ye, k);
        out[o + 3] = 255;
      }
    }
  }
  return { data: out, width, height };
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Turns the picture upright for an EXIF orientation of 2–8 (mirror, rotate, or both; 5–8 swap width and height). */
export function orient(data: Uint8Array, w: number, h: number, orientation: number): { data: Uint8Array; width: number; height: number } {
  const swap = orientation >= 5, W = swap ? h : w, H = swap ? w : h;
  // Source index = base + x × dx + y × dy for output pixel (x, y).
  const plan: Record<number, [number, number, number]> = {
    2: [w - 1, -1, w],
    3: [(h - 1) * w + w - 1, -1, -w],
    4: [(h - 1) * w, 1, -w],
    5: [0, w, 1],
    6: [(h - 1) * w, -w, 1],
    7: [(h - 1) * w + w - 1, -w, -1],
    8: [w - 1, w, -1],
  };
  const [base, dx, dy] = plan[orientation] ?? [0, 1, w];
  const src = new Uint32Array(data.buffer, data.byteOffset, w * h), out = new Uint8Array(W * H * 4), dst = new Uint32Array(out.buffer);
  for (let y = 0, o = 0; y < H; y++) {
    let i = base + y * dy;
    for (let x = 0; x < W; x++, i += dx) dst[o++] = src[i];
  }
  return { data: out, width: W, height: H };
}
