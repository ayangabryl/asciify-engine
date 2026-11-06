import { checkSize, frameLimit, limitsOf, playDelay, still, type DecodedFrame, type DecodedImage, type DecodeOptions } from './common';

/*
 * GIF (87a and 89a): LZW with codes up to 12 bits and deferred clears, global and local colour tables, interlaced frames,
 * transparency, disposal methods 0–3, frame offsets, delays and the NETSCAPE2.0 / ANIMEXTS1.0 loop count. Frames are composited
 * as browsers do: on a transparent canvas, "restore to background" clears to transparent (the background colour is not
 * used), disposal 4 means 3, a first frame bigger than the screen enlarges it, later frames are clipped to it, and an index
 * with no colour (or a frame with no colour table) leaves its pixel as it was. Delays of 10 ms or less play as 100 ms. Loops
 * follow browsers too: a count of n plays n + 1 times, 0 forever, and with no count the animation plays once.
 * Not supported: plain text extensions (ignored) and the pixel aspect ratio.
 */

const u16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);

/** True if the bytes start with a GIF signature. */
export const isGif = (b: Uint8Array): boolean =>
  b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61;

// One little-endian-or-not RGBA word per colour, so a pixel is one store.
const LITTLE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const rgba = (r: number, g: number, b: number) => (LITTLE ? ((255 << 24) | (b << 16) | (g << 8) | r) : ((r << 24) | (g << 16) | (b << 8) | 255)) >>> 0;

function colourTable(b: Uint8Array, at: number, count: number): Uint32Array {
  const t = new Uint32Array(count);
  for (let i = 0; i < count; i++) t[i] = rgba(b[at + i * 3], b[at + i * 3 + 1], b[at + i * 3 + 2]);
  return t;
}

/** Skips data sub-blocks from `pos`; returns the position after the terminator (or the end). */
function skipBlocks(b: Uint8Array, pos: number): number {
  while (pos < b.length) {
    const n = b[pos++];
    if (n === 0) break;
    pos += n;
  }
  return Math.min(pos, b.length);
}

/** Decodes a GIF, still or animated. */
export function decodeGif(bytes: Uint8Array, options?: DecodeOptions): DecodedImage {
  const limits = limitsOf(options);
  if (!isGif(bytes)) throw new Error('GIF: not a GIF file');
  if (bytes.length < 13) throw new Error('GIF: file too short');
  const n = bytes.length;
  let width = u16(bytes, 6), height = u16(bytes, 8);
  const flags = bytes[10];
  let pos = 13, global: Uint32Array | null = null;
  if (flags & 0x80) {
    const count = 2 << (flags & 7);
    if (pos + count * 3 > n) throw new Error('GIF: truncated colour table');
    global = colourTable(bytes, pos, count);
    pos += count * 3;
  }
  let loop = -1, delay = 0, dispose = 0, transparent = -1;
  let canvas: Uint8Array | null = null, canvas32: Uint32Array | null = null, limit = 1;
  const frames: DecodedFrame[] = [];
  let more = false; // a frame was left out by the limits
  // The last frame's region on the canvas (clipped to it) and disposal, and what was under it for disposal 3.
  let lx0 = 0, ly0 = 0, lx1 = 0, ly1 = 0, ldispose = 0, saved: Uint32Array | null = null;
  while (pos < n) {
    const block = bytes[pos++];
    if (block === 0x3b) break;
    if (block === 0x21) {
      if (pos >= n) break;
      const label = bytes[pos++];
      if (label === 0xf9 && pos + 5 <= n && bytes[pos] >= 4) {
        const packed = bytes[pos + 1];
        const method = (packed >> 2) & 7;
        dispose = method === 4 ? 3 : method > 4 ? 0 : method;
        delay = u16(bytes, pos + 2) * 10;
        transparent = packed & 1 ? bytes[pos + 4] : -1;
      } else if (label === 0xff && pos + 12 <= n && bytes[pos] === 11) {
        const id = String.fromCharCode(...bytes.subarray(pos + 1, pos + 12));
        const sub = pos + 12;
        if ((id === 'NETSCAPE2.0' || id === 'ANIMEXTS1.0') && sub + 4 <= n && bytes[sub] >= 3 && (bytes[sub + 1] & 7) === 1 && loop < 0) {
          loop = u16(bytes, sub + 2);
        }
      }
      pos = skipBlocks(bytes, pos);
      continue;
    }
    if (block !== 0x2c) break; // Not a block: the rest is junk.
    if (pos + 9 > n) break;
    let fx = u16(bytes, pos), fy = u16(bytes, pos + 2), fw = u16(bytes, pos + 4), fh = u16(bytes, pos + 6);
    const packed = bytes[pos + 8];
    pos += 9;
    let table = global;
    if (packed & 0x80) {
      const count = 2 << (packed & 7);
      if (pos + count * 3 > n) break;
      table = colourTable(bytes, pos, count);
      pos += count * 3;
    }
    if (!canvas) {
      // Browsers grow the screen to fit the first frame, and treat a frame of no size as the whole screen.
      width = Math.max(width, fx + fw);
      height = Math.max(height, fy + fh);
      checkSize('GIF', width, height, limits.maxPixels);
      canvas = new Uint8Array(width * height * 4);
      canvas32 = new Uint32Array(canvas.buffer);
      limit = frameLimit(limits, width, height);
    }
    if (!fw || !fh) { fx = fy = 0; fw = width; fh = height; }
    if (frames.length >= limit) { more = true; break; }
    if (pos >= n) break;
    const minSize = bytes[pos++];
    const dataStart = pos;
    pos = skipBlocks(bytes, pos);
    if (minSize < 1 || minSize > 11) throw new Error(`GIF: bad LZW code size ${minSize}`);
    const data = gather(bytes, dataStart, pos);
    // k codes give at most about k² / 2 indices (each new string is one longer than one before it), so a frame that
    // claims many pixels but carries little data gets a small buffer.
    const codes = Math.floor((data.length * 8) / (minSize + 1)) + 1;
    const indices = new Uint8Array(Math.min(fw * fh, (codes * (codes + 3)) / 2 + 1));
    const count = lzw(data, minSize, indices);

    const c32 = canvas32 as Uint32Array;
    if (frames.length) {
      if (ldispose === 2) for (let y = ly0; y < ly1; y++) c32.fill(0, y * width + lx0, y * width + lx1);
      else if (ldispose === 3 && saved) for (let y = ly0; y < ly1; y++) c32.set(saved.subarray((y - ly0) * (lx1 - lx0), (y - ly0 + 1) * (lx1 - lx0)), y * width + lx0);
    }
    const x0 = Math.min(fx, width), y0 = Math.min(fy, height), x1 = Math.min(fx + fw, width), y1 = Math.min(fy + fh, height);
    saved = null;
    if (dispose === 3) {
      saved = new Uint32Array((x1 - x0) * (y1 - y0));
      for (let y = y0; y < y1; y++) saved.set(c32.subarray(y * width + x0, y * width + x1), (y - y0) * (x1 - x0));
    }
    if (table) draw(c32, width, height, indices, count, fx, fy, fw, fh, (packed & 0x40) !== 0, table, transparent);
    frames.push({ data: (canvas as Uint8Array).slice(), delay: playDelay(delay) });
    lx0 = x0; ly0 = y0; lx1 = x1; ly1 = y1; ldispose = dispose;
    delay = 0; dispose = 0; transparent = -1;
  }
  if (!canvas || !frames.length) throw new Error('GIF: no image data');
  if (frames.length === 1 && !more) return still('gif', width, height, frames[0].data);
  return { format: 'gif', width, height, frames, loop: loop < 0 ? 1 : loop === 0 ? 0 : loop + 1 };
}

/** The image data's sub-blocks, joined. */
function gather(b: Uint8Array, from: number, to: number): Uint8Array {
  let size = 0;
  for (let p = from; p < to;) {
    const len = b[p++];
    if (!len) break;
    size += Math.min(len, to - p);
    p += len;
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (let p = from; p < to;) {
    const len = b[p++];
    if (!len) break;
    const take = Math.min(len, to - p);
    out.set(b.subarray(p, p + take), o);
    o += take;
    p += len;
  }
  return out;
}

let entryStart: Int32Array | null = null, entryLength: Uint16Array | null = null;

/**
 * LZW decoding into `out`; returns how many indices came out. Each dictionary entry is kept as a place and length in the
 * output already written, so a code is one copy. An invalid code ends the frame where it is, as in browsers.
 */
export function lzw(data: Uint8Array, minSize: number, out: Uint8Array): number {
  if (!entryStart || !entryLength) { entryStart = new Int32Array(4096); entryLength = new Uint16Array(4096); }
  const starts = entryStart, lengths = entryLength;
  const n = out.length, end = data.length, clear = 1 << minSize, eoi = clear + 1;
  let size = minSize + 1, mask = (1 << size) - 1, avail = clear + 2;
  let old = -1, oldStart = 0, oldLength = 0, datum = 0, bits = 0, ip = 0, op = 0;
  while (op < n) {
    while (bits < size) {
      if (ip >= end) return op;
      datum |= data[ip++] << bits;
      bits += 8;
    }
    const code = datum & mask;
    datum >>= size;
    bits -= size;
    if (code === clear) {
      size = minSize + 1;
      mask = (1 << size) - 1;
      avail = clear + 2;
      old = -1;
      continue;
    }
    if (code === eoi) break;
    const start = op;
    if (code < clear) {
      out[op++] = code;
    } else if (code < avail || (code === avail && old >= 0)) {
      // A known string, or (code === avail) the one being defined: the last string and its own first index.
      let from = code === avail ? oldStart : starts[code], len = code === avail ? oldLength + 1 : lengths[code];
      if (op + len > n) len = n - op;
      for (const stop = op + len; op < stop;) out[op++] = out[from++];
    } else {
      break;
    }
    if (old >= 0 && avail < 4096) {
      starts[avail] = oldStart;
      lengths[avail] = oldLength + 1;
      avail++;
      if ((avail & mask) === 0 && avail < 4096) {
        size++;
        mask = (1 << size) - 1;
      }
    }
    old = code;
    oldStart = start;
    oldLength = op - start;
  }
  return op;
}

// Interlaced rows come in four passes: every 8th from 0, every 8th from 4, every 4th from 2, every 2nd from 1.
function rowOrder(h: number, interlaced: boolean): Int32Array {
  const order = new Int32Array(h);
  if (!interlaced) {
    for (let i = 0; i < h; i++) order[i] = i;
    return order;
  }
  let i = 0;
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = start; y < h; y += step) order[i++] = y;
  return order;
}

function draw(c: Uint32Array, width: number, height: number, idx: Uint8Array, count: number, fx: number, fy: number, fw: number, fh: number, interlaced: boolean, table: Uint32Array, transparent: number): void {
  const order = rowOrder(fh, interlaced), colours = table.length, xEnd = Math.min(fw, width - fx);
  for (let i = 0; i < fh; i++) {
    const y = fy + order[i];
    if (y >= height) continue;
    const s = i * fw, stop = Math.min(xEnd, count - s);
    if (stop <= 0) break;
    let d = y * width + fx;
    for (let x = 0; x < stop; x++, d++) {
      const v = idx[s + x];
      if (v !== transparent && v < colours) c[d] = table[v];
    }
  }
}
