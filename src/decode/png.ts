import { checkSize, frameLimit, limitsOf, playDelay, still, type DecodedFrame, type DecodedImage, type DecodeOptions } from './common';
import { inflateInto } from './inflate';

/*
 * PNG and APNG: every colour type and bit depth, PLTE and tRNS transparency, Adam7 interlacing, all five filters, and APNG
 * animation (frame regions, dispose and blend operations, delays, play counts). 16-bit samples keep their high byte, as
 * libpng's strip and Pillow do. Image data cut short decodes as far as it goes; the rest stays transparent.
 * Not supported: colour management (gAMA, cHRM, sRGB and iCCP are ignored) and Apple's CgBI variant. CRCs are not checked.
 */

const IHDR = 0x49484452, PLTE = 0x504c5445, IDAT = 0x49444154, IEND = 0x49454e44, TRNS = 0x74524e53;
const ACTL = 0x6163544c, FCTL = 0x6663544c, FDAT = 0x66644154, CGBI = 0x43674249;
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// Adam7: x0, y0, dx, dy per pass.
const PASSES = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
const CHANNELS = [1, 0, 3, 1, 2, 0, 4];

const u32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];

/** True if the bytes start with the PNG signature. */
export const isPng = (b: Uint8Array): boolean => b.length >= 8 && SIGNATURE.every((v, i) => b[i] === v);

/** A start and end in the file: one IDAT or fdAT chunk's image data. */
type Range = [number, number];

interface Header {
  /** The whole file, which the frames' data ranges point into. */
  bytes: Uint8Array;
  width: number;
  height: number;
  depth: number;
  type: number;
  interlace: number;
  /** Palette as RGBA, 256 entries; entries the file does not give are opaque black. */
  palette: Uint8Array;
  hasPalette: boolean;
  /** The transparent grey or RGB sample for types 0 and 2 (-1 for none), at the image's bit depth. */
  tg: number;
  tr: number;
  tb: number;
}

interface Frame {
  width: number;
  height: number;
  x: number;
  y: number;
  delay: number;
  dispose: number;
  blend: number;
  parts: Range[];
}

/** Decodes a PNG or APNG. */
export function decodePng(bytes: Uint8Array, options?: DecodeOptions): DecodedImage {
  const limits = limitsOf(options);
  if (!isPng(bytes)) throw new Error('PNG: not a PNG file');
  let h: Header | null = null;
  const idat: Range[] = [];
  const frames: Frame[] = [];
  let plays = -1, frameCount = 0, idatIsFrame = false, seenIdat = false;
  const n = bytes.length;
  let pos = 8;
  while (pos + 8 <= n) {
    const len = u32(bytes, pos), type = u32(bytes, pos + 4), start = pos + 8;
    const end = Math.min(start + len, n);
    const body = bytes.subarray(start, end);
    if (type === IHDR) {
      if (h) throw new Error('PNG: more than one IHDR chunk');
      h = header(bytes, body, limits.maxPixels);
    } else if (!h) {
      throw new Error('PNG: IHDR is not the first chunk');
    } else if (type === IDAT) {
      seenIdat = true;
      idat.push([start, end]);
    } else if (type === PLTE) {
      const count = Math.min(256, Math.floor(body.length / 3));
      for (let i = 0; i < count; i++) {
        h.palette[i * 4] = body[i * 3];
        h.palette[i * 4 + 1] = body[i * 3 + 1];
        h.palette[i * 4 + 2] = body[i * 3 + 2];
      }
      h.hasPalette = count > 0;
    } else if (type === TRNS) {
      transparency(h, body);
    } else if (type === ACTL) {
      if (!seenIdat && body.length >= 8) {
        frameCount = u32(body, 0);
        plays = u32(body, 4);
      }
    } else if (type === FCTL) {
      if (body.length >= 26) {
        const num = u16(body, 20), den = u16(body, 22) || 100;
        frames.push({
          width: u32(body, 4), height: u32(body, 8), x: u32(body, 12), y: u32(body, 16),
          delay: playDelay((num * 1000) / den), dispose: body[24], blend: body[25], parts: [],
        });
        if (!seenIdat) idatIsFrame = true;
      }
    } else if (type === FDAT) {
      if (frames.length && body.length > 4 && (frames.length > 1 || !idatIsFrame)) frames[frames.length - 1].parts.push([start + 4, end]);
    } else if (type === IEND) {
      break;
    } else if (type === CGBI) {
      throw new Error("PNG: Apple's CgBI PNG variant is not supported");
    }
    pos = start + len + 4;
  }
  if (!h) throw new Error('PNG: no IHDR chunk');
  if (h.type === 3 && !h.hasPalette) throw new Error('PNG: palette image with no PLTE chunk');
  const { width, height } = h;

  if (plays >= 0 && frameCount > 0 && frames.length > 0) {
    if (idatIsFrame) {
      // The default image is the first frame, and covers the whole canvas whatever its fcTL says.
      Object.assign(frames[0], { width, height, x: 0, y: 0, parts: idat });
    }
    const list = frames.slice(0, frameCount);
    const animation = animate(h, list, frameLimit(limits, width, height));
    // An animation of one frame is a still.
    if (animation) return list.length === 1 ? still('png', width, height, animation[0].data) : { format: 'png', width, height, frames: animation, loop: plays };
  }
  if (!idat.length) throw new Error('PNG: no image data');
  const data = new Uint8Array(width * height * 4);
  pixels(h, idat, width, height, data);
  return still('png', width, height, data);
}

function header(bytes: Uint8Array, b: Uint8Array, maxPixels: number): Header {
  if (b.length < 13) throw new Error('PNG: IHDR chunk too short');
  const width = u32(b, 0), height = u32(b, 4), depth = b[8], type = b[9], interlace = b[12];
  checkSize('PNG', width, height, maxPixels);
  const depths = type === 0 ? [1, 2, 4, 8, 16] : type === 3 ? [1, 2, 4, 8] : type === 2 || type === 4 || type === 6 ? [8, 16] : [];
  if (!depths.length) throw new Error(`PNG: unknown colour type ${type}`);
  if (!depths.includes(depth)) throw new Error(`PNG: bit depth ${depth} is not allowed for colour type ${type}`);
  if (b[10] !== 0 || b[11] !== 0) throw new Error('PNG: unknown compression or filter method');
  if (interlace > 1) throw new Error(`PNG: unknown interlace method ${interlace}`);
  const palette = new Uint8Array(1024);
  for (let i = 3; i < 1024; i += 4) palette[i] = 255;
  return { bytes, width, height, depth, type, interlace, palette, hasPalette: false, tg: -1, tr: -1, tb: -1 };
}

function transparency(h: Header, b: Uint8Array): void {
  // Like libpng, a sample value is matched on the bits the depth has.
  const mask = h.depth === 16 ? 0xffff : (1 << h.depth) - 1;
  if (h.type === 3) {
    for (let i = 0; i < Math.min(256, b.length); i++) h.palette[i * 4 + 3] = b[i];
  } else if (h.type === 0 && b.length >= 2) {
    h.tg = u16(b, 0) & mask;
  } else if (h.type === 2 && b.length >= 6) {
    h.tr = u16(b, 0) & mask;
    h.tg = u16(b, 2) & mask;
    h.tb = u16(b, 4) & mask;
  }
}

/** Decodes and composites the frames of an APNG, or returns null if not one can be decoded. */
function animate(h: Header, list: Frame[], limit: number): DecodedFrame[] | null {
  const { width, height } = h;
  const canvas = new Uint8Array(width * height * 4);
  const out: DecodedFrame[] = [];
  let saved: Uint8Array | null = null, last: Frame | null = null, lastDispose = 0;
  for (const f of list) {
    if (out.length >= limit) break;
    // A frame outside the canvas, or with no data, ends the animation where it is.
    if (!(f.width >= 1 && f.height >= 1) || f.x + f.width > width || f.y + f.height > height || !f.parts.length) break;
    const px = new Uint8Array(f.width * f.height * 4);
    try {
      pixels(h, f.parts, f.width, f.height, px);
    } catch (error) {
      if (!out.length) throw error;
      break;
    }
    if (last) {
      if (lastDispose === 1) fillRect(canvas, width, last, null);
      else if (lastDispose === 2 && saved) fillRect(canvas, width, last, saved);
    }
    // The first frame cannot restore to "previous": there is none, so it clears instead.
    lastDispose = f.dispose === 2 && !out.length ? 1 : f.dispose;
    saved = lastDispose === 2 ? copyRect(canvas, width, f) : null;
    if (f.blend === 1) blendOver(canvas, width, f, px);
    else fillRect(canvas, width, f, px);
    out.push({ data: canvas.slice(), delay: f.delay });
    last = f;
  }
  return out.length ? out : null;
}

function copyRect(canvas: Uint8Array, width: number, f: Frame): Uint8Array {
  const rect = new Uint8Array(f.width * f.height * 4), row = f.width * 4;
  for (let y = 0; y < f.height; y++) {
    const o = ((f.y + y) * width + f.x) * 4;
    rect.set(canvas.subarray(o, o + row), y * row);
  }
  return rect;
}

// Writes `src` (the frame's size) into the frame's region, or clears the region to transparent black.
function fillRect(canvas: Uint8Array, width: number, f: Frame, src: Uint8Array | null): void {
  const row = f.width * 4;
  for (let y = 0; y < f.height; y++) {
    const o = ((f.y + y) * width + f.x) * 4;
    if (src) canvas.set(src.subarray(y * row, y * row + row), o);
    else canvas.fill(0, o, o + row);
  }
}

// Source over destination with straight alpha, each result rounded to nearest.
function blendOver(canvas: Uint8Array, width: number, f: Frame, src: Uint8Array): void {
  for (let y = 0; y < f.height; y++) {
    let s = y * f.width * 4, d = ((f.y + y) * width + f.x) * 4;
    for (let x = 0; x < f.width; x++, s += 4, d += 4) {
      const sa = src[s + 3];
      if (sa === 0) continue;
      const da = canvas[d + 3];
      if (sa === 255 || da === 0) {
        canvas[d] = src[s];
        canvas[d + 1] = src[s + 1];
        canvas[d + 2] = src[s + 2];
        canvas[d + 3] = sa;
        continue;
      }
      const k = da * (255 - sa), total = sa * 255 + k, half = total >> 1, ws = sa * 255;
      canvas[d] = ((src[s] * ws + canvas[d] * k + half) / total) | 0;
      canvas[d + 1] = ((src[s + 1] * ws + canvas[d + 1] * k + half) / total) | 0;
      canvas[d + 2] = ((src[s + 2] * ws + canvas[d + 2] * k + half) / total) | 0;
      canvas[d + 3] = ((total + 127) / 255) | 0;
    }
  }
}

const rowBytes = (h: Header, width: number) => Math.ceil((width * CHANNELS[h.type] * h.depth) / 8);

/** Inflates, unfilters and converts one image (the default image or a frame) into `out`, width × height RGBA. */
function pixels(h: Header, parts: Range[], width: number, height: number, out: Uint8Array): void {
  const bpp = Math.max(1, (CHANNELS[h.type] * h.depth) >> 3);
  const passes = h.interlace ? PASSES : [[0, 0, 1, 1]];
  let total = 0;
  for (const [x0, y0, dx, dy] of passes) {
    const pw = Math.ceil((width - x0) / dx), ph = Math.ceil((height - y0) / dy);
    if (pw > 0 && ph > 0) total += ph * (rowBytes(h, pw) + 1);
  }
  const raw = new Uint8Array(total);
  let got: number;
  try {
    got = inflateInto(h.bytes, parts.flat(), raw);
  } catch (error) {
    throw new Error(`PNG: corrupt image data (${(error as Error).message})`);
  }
  let p = 0;
  for (const [x0, y0, dx, dy] of passes) {
    const pw = Math.ceil((width - x0) / dx), ph = Math.ceil((height - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const rb = rowBytes(h, pw);
    let prev = -1;
    for (let j = 0; j < ph; j++) {
      if (p + 1 + rb > got) return; // Cut short: the rest stays transparent.
      unfilter(raw, p + 1, prev, rb, bpp, raw[p]);
      row(h, raw, p + 1, pw, out, ((y0 + j * dy) * width + x0) * 4, dx * 4);
      prev = p + 1;
      p += rb + 1;
    }
  }
}

function unfilter(raw: Uint8Array, p: number, q: number, n: number, bpp: number, type: number): void {
  switch (type) {
    case 0:
      return;
    case 1:
      for (let i = p + bpp, stop = p + n; i < stop; i++) raw[i] += raw[i - bpp];
      return;
    case 2:
      if (q >= 0) for (let i = 0; i < n; i++) raw[p + i] += raw[q + i];
      return;
    case 3:
      if (q < 0) {
        for (let i = p + bpp, stop = p + n; i < stop; i++) raw[i] += raw[i - bpp] >> 1;
        return;
      }
      for (let i = 0; i < bpp; i++) raw[p + i] += raw[q + i] >> 1;
      for (let i = bpp; i < n; i++) raw[p + i] += (raw[p + i - bpp] + raw[q + i]) >> 1;
      return;
    case 4:
      if (q < 0) {
        for (let i = p + bpp, stop = p + n; i < stop; i++) raw[i] += raw[i - bpp];
        return;
      }
      paeth(raw, p, q, n, bpp);
      return;
    default:
      throw new Error(`PNG: bad filter type ${type}`);
  }
}

/*
 * Paeth, branch-free: on photographs the predictor's choice is a coin toss, and mispredicted branches cost more than the
 * arithmetic. The choice runs in libpng's order (a, then b if nearer, then c if nearer still), which is the spec's. For 3- and
 * 4-byte pixels the left pixel's results and the pixel above-left stay in locals, a channel each.
 */
function paeth(raw: Uint8Array, p: number, q: number, n: number, bpp: number): void {
  if (bpp === 3 || bpp === 4) {
    const four = bpp === 4;
    let a0 = 0, a1 = 0, a2 = 0, a3 = 0, c0 = 0, c1 = 0, c2 = 0, c3 = 0;
    for (let j = p, k = q, stop = p + n; j < stop; j += bpp, k += bpp) {
      let b = raw[k], x = a0, pa = b - c0, pb = x - c0, pc = pa + pb, m: number;
      pa = (pa ^ (pa >> 31)) - (pa >> 31); pb = (pb ^ (pb >> 31)) - (pb >> 31); pc = (pc ^ (pc >> 31)) - (pc >> 31);
      m = (pb - pa) >> 31; x ^= (x ^ b) & m; pa ^= (pa ^ pb) & m; x ^= (x ^ c0) & ((pc - pa) >> 31);
      a0 = (raw[j] + x) & 255; raw[j] = a0; c0 = b;
      b = raw[k + 1]; x = a1; pa = b - c1; pb = x - c1; pc = pa + pb;
      pa = (pa ^ (pa >> 31)) - (pa >> 31); pb = (pb ^ (pb >> 31)) - (pb >> 31); pc = (pc ^ (pc >> 31)) - (pc >> 31);
      m = (pb - pa) >> 31; x ^= (x ^ b) & m; pa ^= (pa ^ pb) & m; x ^= (x ^ c1) & ((pc - pa) >> 31);
      a1 = (raw[j + 1] + x) & 255; raw[j + 1] = a1; c1 = b;
      b = raw[k + 2]; x = a2; pa = b - c2; pb = x - c2; pc = pa + pb;
      pa = (pa ^ (pa >> 31)) - (pa >> 31); pb = (pb ^ (pb >> 31)) - (pb >> 31); pc = (pc ^ (pc >> 31)) - (pc >> 31);
      m = (pb - pa) >> 31; x ^= (x ^ b) & m; pa ^= (pa ^ pb) & m; x ^= (x ^ c2) & ((pc - pa) >> 31);
      a2 = (raw[j + 2] + x) & 255; raw[j + 2] = a2; c2 = b;
      if (four) {
        b = raw[k + 3]; x = a3; pa = b - c3; pb = x - c3; pc = pa + pb;
        pa = (pa ^ (pa >> 31)) - (pa >> 31); pb = (pb ^ (pb >> 31)) - (pb >> 31); pc = (pc ^ (pc >> 31)) - (pc >> 31);
        m = (pb - pa) >> 31; x ^= (x ^ b) & m; pa ^= (pa ^ pb) & m; x ^= (x ^ c3) & ((pc - pa) >> 31);
        a3 = (raw[j + 3] + x) & 255; raw[j + 3] = a3; c3 = b;
      }
    }
    return;
  }
  for (let i = 0; i < bpp; i++) raw[p + i] += raw[q + i];
  for (let i = bpp; i < n; i++) {
    let a = raw[p + i - bpp];
    const b = raw[q + i], c = raw[q + i - bpp];
    let pa = b - c, pb = a - c, pc = pa + pb;
    pa = (pa ^ (pa >> 31)) - (pa >> 31);
    pb = (pb ^ (pb >> 31)) - (pb >> 31);
    pc = (pc ^ (pc >> 31)) - (pc >> 31);
    const m = (pb - pa) >> 31;
    a ^= (a ^ b) & m;
    pa ^= (pa ^ pb) & m;
    raw[p + i] += a ^ ((a ^ c) & ((pc - pa) >> 31));
  }
}

/** Converts one unfiltered row of `n` pixels to RGBA, pixel i landing at out[o + i * step]. */
function row(h: Header, raw: Uint8Array, s: number, n: number, out: Uint8Array, o: number, step: number): void {
  const { depth, tg, tr, tb } = h;
  switch (h.type) {
    case 0: {
      if (depth === 16) {
        for (let i = 0; i < n; i++, s += 2, o += step) {
          const v = raw[s];
          out[o] = out[o + 1] = out[o + 2] = v;
          out[o + 3] = ((v << 8) | raw[s + 1]) === tg ? 0 : 255;
        }
      } else if (depth === 8) {
        for (let i = 0; i < n; i++, o += step) {
          const v = raw[s + i];
          out[o] = out[o + 1] = out[o + 2] = v;
          out[o + 3] = v === tg ? 0 : 255;
        }
      } else {
        const mask = (1 << depth) - 1, scale = 255 / mask;
        for (let i = 0; i < n; i++, o += step) {
          const bit = i * depth, v = (raw[s + (bit >> 3)] >> (8 - depth - (bit & 7))) & mask;
          out[o] = out[o + 1] = out[o + 2] = v * scale;
          out[o + 3] = v === tg ? 0 : 255;
        }
      }
      return;
    }
    case 2: {
      if (depth === 16) {
        for (let i = 0; i < n; i++, s += 6, o += step) {
          out[o] = raw[s];
          out[o + 1] = raw[s + 2];
          out[o + 2] = raw[s + 4];
          out[o + 3] = tr >= 0 && ((raw[s] << 8) | raw[s + 1]) === tr && ((raw[s + 2] << 8) | raw[s + 3]) === tg && ((raw[s + 4] << 8) | raw[s + 5]) === tb ? 0 : 255;
        }
      } else if (tr >= 0) {
        for (let i = 0; i < n; i++, s += 3, o += step) {
          const r = raw[s], g = raw[s + 1], b = raw[s + 2];
          out[o] = r;
          out[o + 1] = g;
          out[o + 2] = b;
          out[o + 3] = r === tr && g === tg && b === tb ? 0 : 255;
        }
      } else {
        for (let i = 0; i < n; i++, s += 3, o += step) {
          out[o] = raw[s];
          out[o + 1] = raw[s + 1];
          out[o + 2] = raw[s + 2];
          out[o + 3] = 255;
        }
      }
      return;
    }
    case 3: {
      const pal = h.palette;
      if (depth === 8) {
        for (let i = 0; i < n; i++, o += step) {
          const k = raw[s + i] << 2;
          out[o] = pal[k];
          out[o + 1] = pal[k + 1];
          out[o + 2] = pal[k + 2];
          out[o + 3] = pal[k + 3];
        }
      } else {
        const mask = (1 << depth) - 1;
        for (let i = 0; i < n; i++, o += step) {
          const bit = i * depth, k = ((raw[s + (bit >> 3)] >> (8 - depth - (bit & 7))) & mask) << 2;
          out[o] = pal[k];
          out[o + 1] = pal[k + 1];
          out[o + 2] = pal[k + 2];
          out[o + 3] = pal[k + 3];
        }
      }
      return;
    }
    case 4: {
      const size = depth === 16 ? 4 : 2, alpha = depth === 16 ? 2 : 1;
      for (let i = 0; i < n; i++, s += size, o += step) {
        const v = raw[s];
        out[o] = out[o + 1] = out[o + 2] = v;
        out[o + 3] = raw[s + alpha];
      }
      return;
    }
    default: {
      if (depth === 8) {
        if (step === 4) out.set(raw.subarray(s, s + n * 4), o);
        else {
          for (let i = 0; i < n; i++, s += 4, o += step) {
            out[o] = raw[s];
            out[o + 1] = raw[s + 1];
            out[o + 2] = raw[s + 2];
            out[o + 3] = raw[s + 3];
          }
        }
      } else {
        for (let i = 0; i < n; i++, s += 8, o += step) {
          out[o] = raw[s];
          out[o + 1] = raw[s + 2];
          out[o + 2] = raw[s + 4];
          out[o + 3] = raw[s + 6];
        }
      }
    }
  }
}
