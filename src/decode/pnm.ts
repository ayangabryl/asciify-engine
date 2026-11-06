import { checkSize, limitsOf, still, type DecodedImage, type DecodeOptions } from './common';

/*
 * Netpbm: PBM, PGM and PPM, plain (P1–P3) and raw (P4–P6), with comments and any maxval up to 65535; and PAM (P7) with the
 * BLACKANDWHITE, GRAYSCALE and RGB tuple types, with or without alpha (other tuple types are read by their depth, 1 to 4).
 * Samples scale to 8 bits as round(v / maxval × 255), halves to even, as Pillow does; values above maxval count as maxval.
 * Pixels past the end of a cut-short file are transparent. Only the first image of a multi-image file is read.
 * Not supported: PFM (floating point).
 */

const SPACE = new Uint8Array(256);
for (const c of [9, 10, 11, 12, 13, 32]) SPACE[c] = 1;

/** True if the bytes start like a Netpbm file: P1 to P7 and a space or a comment. */
export const isPnm = (b: Uint8Array): boolean => b.length >= 3 && b[0] === 0x50 && b[1] >= 0x31 && b[1] <= 0x37 && (SPACE[b[2]] === 1 || b[2] === 0x23);

/** Reads whitespace- and comment-separated tokens. */
class Tokens {
  constructor(readonly b: Uint8Array, public pos: number) {}
  /** Skips spaces and # comments. */
  skip(): void {
    const b = this.b;
    while (this.pos < b.length) {
      const c = b[this.pos];
      if (SPACE[c]) this.pos++;
      else if (c === 0x23) {
        while (this.pos < b.length && b[this.pos] !== 10 && b[this.pos] !== 13) this.pos++;
      } else break;
    }
  }
  /** The next unsigned integer, or -1 at the end or on a non-digit. */
  int(): number {
    this.skip();
    const b = this.b;
    let v = -1;
    while (this.pos < b.length) {
      const d = b[this.pos] - 48;
      if (d < 0 || d > 9) break;
      v = (v < 0 ? 0 : v * 10) + d;
      if (v > 0xffffffff) v = 0xffffffff;
      this.pos++;
    }
    return v;
  }
}

/** round(v / maxval × 255) with Python's rounding (halves to even), for every v up to maxval. */
function scaleTable(maxval: number): Uint8Array {
  const t = new Uint8Array(maxval + 1);
  for (let v = 0; v <= maxval; v++) {
    const x = (v / maxval) * 255;
    let r = Math.round(x);
    if (r - x === 0.5 && r & 1) r--;
    t[v] = r;
  }
  return t;
}

/** Decodes a PBM, PGM, PPM or PAM. */
export function decodePnm(bytes: Uint8Array, options?: DecodeOptions): DecodedImage {
  const limits = limitsOf(options);
  if (bytes.length < 3 || bytes[0] !== 0x50 || bytes[1] < 0x31 || bytes[1] > 0x37) throw new Error('PNM: not a Netpbm file');
  const kind = bytes[1] - 48;
  const t = new Tokens(bytes, 2);
  let width: number, height: number, maxval = 1, depth: number, plain = kind <= 3;
  if (kind === 7) {
    ({ width, height, depth, maxval } = pamHeader(bytes, t));
    plain = false;
  } else {
    width = t.int();
    height = t.int();
    if (kind !== 1 && kind !== 4) maxval = t.int();
    depth = kind === 3 || kind === 6 ? 3 : 1;
    if (width < 0 || height < 0 || maxval < 0) throw new Error('PNM: bad header');
    // One whitespace byte ends the header of a raw file.
    if (!plain) t.pos++;
  }
  checkSize('PNM', width, height, limits.maxPixels);
  if (maxval < 1 || maxval > 65535) throw new Error(`PNM: maxval ${maxval} is out of range`);
  const bitmap = kind === 1 || kind === 4;
  const scale = scaleTable(maxval);
  const out = new Uint8Array(width * height * 4);
  const pixels = width * height;
  if (kind === 4) {
    // Raw PBM: 1 is black, rows padded to whole bytes.
    const stride = (width + 7) >> 3;
    for (let y = 0; y < height; y++) {
      const s = t.pos + y * stride;
      if (s + stride > bytes.length) break;
      for (let x = 0; x < width; x++) {
        const v = (bytes[s + (x >> 3)] >> (7 - (x & 7))) & 1 ? 0 : 255, o = (y * width + x) * 4;
        out[o] = out[o + 1] = out[o + 2] = v;
        out[o + 3] = 255;
      }
    }
  } else if (plain) {
    const sample = new Uint8Array(4);
    for (let i = 0; i < pixels; i++) {
      let ok = true;
      for (let c = 0; c < depth; c++) {
        let v: number;
        if (bitmap) {
          // Plain PBM digits need no space between them.
          t.skip();
          const d = t.pos < bytes.length ? bytes[t.pos] - 48 : -1;
          if (d !== 0 && d !== 1) { ok = false; break; }
          t.pos++;
          v = d ? 0 : 255;
        } else {
          const raw = t.int();
          if (raw < 0) { ok = false; break; }
          v = scale[Math.min(raw, maxval)];
        }
        sample[c] = v;
      }
      if (!ok) break;
      put(out, i, sample, depth);
    }
  } else {
    const wide = maxval > 255, size = wide ? 2 : 1, per = depth * size;
    const avail = Math.min(pixels, Math.floor((bytes.length - t.pos) / per));
    const s = new Uint8Array(depth);
    let p = t.pos;
    for (let i = 0; i < avail; i++) {
      for (let c = 0; c < depth; c++, p += size) {
        const v = wide ? (bytes[p] << 8) | bytes[p + 1] : bytes[p];
        s[c] = scale[v > maxval ? maxval : v];
      }
      put(out, i, s, depth);
    }
  }
  return still('pnm', width, height, out);
}

/** Grey, grey + alpha, RGB or RGBA from `depth` 8-bit samples, to pixel i. */
function put(out: Uint8Array, i: number, s: Uint8Array, depth: number): void {
  const o = i * 4;
  if (depth >= 3) {
    out[o] = s[0];
    out[o + 1] = s[1];
    out[o + 2] = s[2];
  } else out[o] = out[o + 1] = out[o + 2] = s[0];
  out[o + 3] = depth === 2 || depth === 4 ? s[depth - 1] : 255;
}

function pamHeader(b: Uint8Array, t: Tokens): { width: number; height: number; depth: number; maxval: number } {
  let width = -1, height = -1, depth = -1, maxval = -1, tuple = '';
  for (;;) {
    t.skip();
    if (t.pos >= b.length) throw new Error('PNM: PAM header has no ENDHDR');
    let start = t.pos;
    while (t.pos < b.length && !SPACE[b[t.pos]]) t.pos++;
    const key = String.fromCharCode(...b.subarray(start, t.pos));
    if (key === 'ENDHDR') {
      // The raster starts after the end of this line.
      while (t.pos < b.length && b[t.pos] !== 10) t.pos++;
      t.pos++;
      break;
    }
    if (key === 'WIDTH') width = t.int();
    else if (key === 'HEIGHT') height = t.int();
    else if (key === 'DEPTH') depth = t.int();
    else if (key === 'MAXVAL') maxval = t.int();
    else if (key === 'TUPLTYPE') {
      while (t.pos < b.length && (b[t.pos] === 32 || b[t.pos] === 9)) t.pos++;
      start = t.pos;
      while (t.pos < b.length && b[t.pos] !== 10 && b[t.pos] !== 13) t.pos++;
      tuple = String.fromCharCode(...b.subarray(start, t.pos)).trim();
    } else {
      // Unknown header lines are skipped.
      while (t.pos < b.length && b[t.pos] !== 10) t.pos++;
    }
  }
  if (width < 0 || height < 0 || depth < 0 || maxval < 0) throw new Error('PNM: PAM header is missing WIDTH, HEIGHT, DEPTH or MAXVAL');
  const known: Record<string, number> = { BLACKANDWHITE: 1, GRAYSCALE: 1, RGB: 3, BLACKANDWHITE_ALPHA: 2, GRAYSCALE_ALPHA: 2, RGB_ALPHA: 4 };
  if (tuple in known && known[tuple] !== depth) throw new Error(`PNM: PAM tuple type ${tuple} needs depth ${known[tuple]}, not ${depth}`);
  if (depth < 1 || depth > 4) throw new Error(`PNM: PAM depth ${depth} is not supported`);
  return { width, height, depth, maxval };
}
