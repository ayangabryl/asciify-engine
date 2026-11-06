/**
 * What the model parsers share: bytes and text, numbers read straight from bytes, the files a model refers to and their
 * paths, base64 and data: URIs, sRGB, polygons into triangles, welding equal points, and the checks every parsed model
 * passes before it is handed out. No DOM and no Node modules: it runs wherever the parsers do.
 */
import type { AsciiModel, ModelFormat, ModelGroup, ModelMaterial, ModelTexture } from './types';

/** More vertices than this in one model is a corrupt file or one no ASCII drawing needs; refused before allocating. */
export const MAX_VERTICES = 1 << 26;

// Bytes and text.

let utf8: TextDecoder | null = null;
/** UTF-8 bytes as text (a byte-order mark dropped). */
export const decodeText = (bytes: Uint8Array): string => (utf8 ??= new TextDecoder()).decode(bytes);

/** Any of the inputs the parsers take, as bytes. Text is encoded as UTF-8. */
export function toBytes(data: Uint8Array | ArrayBuffer | ArrayBufferView | string): Uint8Array {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(data);
}

/** Whether `bytes` holds `text` (ASCII) at `at`. */
export function bytesAre(bytes: Uint8Array, at: number, text: string): boolean {
  if (at < 0 || at + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i++) if (bytes[at + i] !== text.charCodeAt(i)) return false;
  return true;
}

/** Where `text` (ASCII) first appears in `bytes` from `from` up to `to`, or -1. */
export function findBytes(bytes: Uint8Array, text: string, from = 0, to = bytes.length): number {
  const first = text.charCodeAt(0), last = Math.min(to, bytes.length) - text.length;
  for (let i = bytes.indexOf(first, from); i >= 0 && i <= last; i = bytes.indexOf(first, i + 1)) if (bytesAre(bytes, i, text)) return i;
  return -1;
}

/** Big-endian machines are rare but exist; typed-array views of file data are only taken where they read as the file does. */
let little: boolean | null = null;
export const littleEndian = (): boolean => (little ??= new Uint8Array(new Uint16Array([1]).buffer)[0] === 1);

// Growable typed arrays, for the text formats whose counts are known only at the end.

export class GrowF32 {
  a: Float32Array;
  n = 0;
  constructor(capacity = 1024) { this.a = new Float32Array(Math.max(16, Math.floor(capacity))); }
  /** Makes room for `k` more values; returns the array to write them into (it may be a new one). */
  room(k: number): Float32Array {
    if (this.n + k > this.a.length) {
      const next = new Float32Array(Math.max(this.a.length * 2, this.n + k));
      next.set(this.a.subarray(0, this.n));
      this.a = next;
    }
    return this.a;
  }
  done(): Float32Array { return this.a.length === this.n ? this.a : this.a.slice(0, this.n); }
}

export class GrowI32 {
  a: Int32Array;
  n = 0;
  constructor(capacity = 1024) { this.a = new Int32Array(Math.max(16, Math.floor(capacity))); }
  room(k: number): Int32Array {
    if (this.n + k > this.a.length) {
      const next = new Int32Array(Math.max(this.a.length * 2, this.n + k));
      next.set(this.a.subarray(0, this.n));
      this.a = next;
    }
    return this.a;
  }
  push(v: number): void { this.room(1)[this.n++] = v; }
}

// Numbers read from bytes. The text formats spend most of their time here, so it makes no strings: digits are gathered
// into an integer and scaled once, exactly for up to 15 significant digits (far past float32, which is what is kept).

const POW10 = [1, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19, 1e20, 1e21, 1e22];
const scale10 = (m: number, e: number) => (e === 0 ? m : e > 0 ? (e <= 22 ? m * POW10[e] : m * Math.pow(10, e)) : e >= -22 ? m / POW10[-e] : m / Math.pow(10, -e));

/** Spaces and tabs (and the rarer vertical tab and form feed). */
export const isBlank = (c: number) => c === 32 || c === 9 || c === 11 || c === 12;
/** Blanks and line ends. */
export const isSpace = (c: number) => c === 32 || c === 10 || c === 13 || c === 9 || c === 11 || c === 12;

/** A cursor over text bytes. Past the end it reads as a line end, so loops need no bounds checks of their own. */
export class Scanner {
  pos = 0;
  /** False after `float()` found no number (a word, a comment, the line's end); `pos` is then left at it. */
  ok = true;
  constructor(readonly b: Uint8Array, readonly end = b.length) {}

  at(i: number): number { return i < this.end ? this.b[i] : 10; }

  /** The number after any blanks on this line. Words like nan and inf, and broken numbers such as 1.#INF, read as not finite. */
  float(): number {
    const b = this.b, end = this.end;
    let i = this.pos, c = i < end ? b[i] : 10;
    while (c === 32 || c === 9 || c === 11 || c === 12) c = ++i < end ? b[i] : 10;
    const start = i;
    let neg = false;
    if (c === 45) { neg = true; c = ++i < end ? b[i] : 10; } else if (c === 43) c = ++i < end ? b[i] : 10;
    let m = 0, sig = 0, e = 0, digits = 0;
    while (c >= 48 && c <= 57) {
      if (sig < 15) { m = m * 10 + (c - 48); if (m !== 0) sig++; } else e++;
      digits++;
      c = ++i < end ? b[i] : 10;
    }
    if (c === 46) {
      c = ++i < end ? b[i] : 10;
      while (c >= 48 && c <= 57) {
        if (sig < 15) { m = m * 10 + (c - 48); if (m !== 0) sig++; e--; }
        digits++;
        c = ++i < end ? b[i] : 10;
      }
    }
    if (digits === 0) return this.word(start);
    if (c === 101 || c === 69) {
      let j = i + 1, d = j < end ? b[j] : 10, negative = false;
      if (d === 45) { negative = true; d = ++j < end ? b[j] : 10; } else if (d === 43) d = ++j < end ? b[j] : 10;
      if (d >= 48 && d <= 57) {
        let x = 0;
        while (d >= 48 && d <= 57) { if (x < 100000) x = x * 10 + (d - 48); d = ++j < end ? b[j] : 10; }
        e += negative ? -x : x;
        i = j;
        c = d;
      }
    }
    this.ok = true;
    if (!isSpace(c) && c !== 47) {
      // Something glued to the number (1.#INF, 1.5f): the whole token is not a number we can trust.
      while (i < end && !isSpace(b[i])) i++;
      this.pos = i;
      return NaN;
    }
    this.pos = i;
    const v = scale10(m, e);
    return neg ? -v : v;
  }

  /** A token that starts with no digit: nan, inf or infinity (any case, signed) count as numbers, anything else does not. */
  private word(start: number): number {
    const b = this.b, end = this.end;
    let i = start;
    while (i < end && !isSpace(b[i])) i++;
    let s = start, neg = false;
    if (b[s] === 45 || b[s] === 43) { neg = b[s] === 45; s++; }
    const len = i - s, c0 = b[s] | 32;
    if (len >= 3 && ((c0 === 110 && (b[s + 1] | 32) === 97 && (b[s + 2] | 32) === 110) || (c0 === 105 && (b[s + 1] | 32) === 110 && (b[s + 2] | 32) === 102))) {
      this.ok = true;
      this.pos = i;
      return c0 === 105 ? (neg ? -Infinity : Infinity) : NaN;
    }
    this.ok = false;
    this.pos = start;
    return NaN;
  }

  /** The next number anywhere ahead, line ends included (PLY and STL data), or NaN with `ok` false at a word or the end. */
  next(): number {
    const b = this.b, end = this.end;
    let i = this.pos;
    while (i < end && isSpace(b[i])) i++;
    this.pos = i;
    if (i >= end) { this.ok = false; return NaN; }
    return this.float();
  }

  /** An integer right at `pos` (optional sign, digits), or NaN when there are no digits there. */
  int(): number {
    const b = this.b, end = this.end;
    let i = this.pos, c = i < end ? b[i] : 10, neg = false;
    if (c === 45) { neg = true; c = ++i < end ? b[i] : 10; } else if (c === 43) c = ++i < end ? b[i] : 10;
    if (!(c >= 48 && c <= 57)) return NaN;
    let v = 0;
    while (c >= 48 && c <= 57) { v = v * 10 + (c - 48); c = ++i < end ? b[i] : 10; }
    this.pos = i;
    return neg ? -v : v;
  }

  /** Moves past the end of this line (LF, CRLF or CR). */
  skipLine(): void {
    const b = this.b, end = this.end;
    let i = this.pos;
    while (i < end && b[i] !== 10 && b[i] !== 13) i++;
    if (i < end && b[i] === 13 && i + 1 < end && b[i + 1] === 10) i++;
    this.pos = i + 1;
  }

  /** The rest of this line, trimmed, as text; `pos` moves past its end. */
  rest(): string {
    const b = this.b, end = this.end;
    let i = this.pos;
    while (i < end && isBlank(b[i])) i++;
    let j = i;
    while (j < end && b[j] !== 10 && b[j] !== 13) j++;
    let k = j;
    while (k > i && isBlank(b[k - 1])) k--;
    this.pos = j;
    this.skipLine();
    return decodeText(b.subarray(i, k));
  }

  /** The 1-based line `pos` is on, for error messages. */
  line(at = this.pos): number {
    let n = 1;
    for (let i = this.b.indexOf(10); i >= 0 && i < at; i = this.b.indexOf(10, i + 1)) n++;
    return n;
  }
}

// Paths and the files a model refers to.

/** Forward slashes, no leading './' or surrounding quotes or blanks. */
export const cleanPath = (path: string): string => path.trim().replace(/^"(.*)"$/, '$1').replace(/\\/g, '/').replace(/^(\.\/)+/, '');
/** The folder part of a path or URL, with its trailing slash ('' for none). */
export const dirOf = (path: string): string => path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
/** The last part of a path. */
export const baseOf = (path: string): string => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
/** A path that does not depend on where the file is: a URL, a root path or a drive letter. */
export const isAbsolute = (path: string): boolean => /^([a-z][a-z0-9+.-]*:|\/|\\)/i.test(path);

/** `ref` taken from inside the folder `dir`, with `.` and `..` worked out. */
export function joinPath(dir: string, ref: string): string {
  const path = cleanPath(ref);
  if (isAbsolute(path) || !dir) return path;
  const parts = (dir.replace(/\\/g, '/') + path).split('/'), out: string[] = [];
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..' && out.length && out[out.length - 1] !== '..' && out[out.length - 1] !== '') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/** Percent-decoded, or as it is if it does not decode. */
export const safeDecode = (text: string): string => { try { return decodeURIComponent(text); } catch { return text; } };

/** What `ParseModelOptions.resources` holds. */
export type Resources = Record<string, Uint8Array | string>;

/**
 * Finds the files a model refers to among those given: by the path from the referring file's folder (an MTL file's, for
 * its textures), then as written, cleaned (slashes, './') and percent-decoded, and last by file name alone, in any case, so
 * a folder of dropped files works whatever paths the model was saved with.
 */
export class ResourceIndex {
  private readonly exact = new Map<string, Uint8Array | string>();
  private readonly names = new Map<string, Uint8Array | string>();
  constructor(resources: Resources) {
    for (const key of Object.keys(resources)) {
      const given: unknown = resources[key];
      // Bytes in any form a caller may have them (an ArrayBuffer, a Node Buffer, another typed array), or text.
      const value = typeof given === 'string' ? given : given instanceof ArrayBuffer || ArrayBuffer.isView(given) ? toBytes(given) : null;
      if (value === null) continue;
      this.exact.set(key, value);
      const clean = cleanPath(key);
      if (!this.exact.has(clean)) this.exact.set(clean, value);
      const name = baseOf(clean).toLowerCase();
      if (!this.names.has(name)) this.names.set(name, value);
    }
  }
  get(ref: string, dir = ''): Uint8Array | string | null {
    const clean = cleanPath(ref), decoded = safeDecode(clean);
    for (const key of [joinPath(dir, clean), joinPath(dir, decoded), ref, clean, decoded]) {
      const value = this.exact.get(key);
      if (value !== undefined) return value;
    }
    return this.names.get(baseOf(clean).toLowerCase()) ?? this.names.get(baseOf(decoded).toLowerCase()) ?? null;
  }
  /** A file as bytes: text given for a binary file is read as a data: URI if it is one. */
  bytes(ref: string, dir = ''): Uint8Array | null {
    const value = this.get(ref, dir);
    if (value === null || value instanceof Uint8Array) return value;
    return value.startsWith('data:') ? decodeDataUri(value)?.bytes ?? null : toBytes(value);
  }
  /** A file as text. */
  text(ref: string, dir = ''): string | null {
    const value = this.get(ref, dir);
    return value === null || typeof value === 'string' ? value : decodeText(value);
  }
}

// Base64 and data: URIs, decoded here rather than with atob or Buffer, which not every runtime has.

let BASE64: Int8Array | null = null;
const base64Table = () => {
  if (BASE64) return BASE64;
  const table = new Int8Array(256).fill(-1), letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let i = 0; i < 64; i++) table[letters.charCodeAt(i)] = i;
  table[45] = 62; // '-' and '_', the URL-safe alphabet
  table[95] = 63;
  return (BASE64 = table);
};

/** Base64 text (either alphabet; padding, blanks and line breaks allowed) as bytes. */
export function decodeBase64(text: string, start = 0, end = text.length): Uint8Array {
  const table = base64Table(), out = new Uint8Array(Math.ceil(((end - start) * 3) / 4));
  let bits = 0, held = 0, n = 0;
  for (let i = start; i < end; i++) {
    const code = text.charCodeAt(i), v = code < 256 ? table[code] : -1;
    if (v < 0) { if (code === 61) break; continue; }
    bits = ((bits << 6) | v) & 0xffffff;
    held += 6;
    if (held >= 8) { held -= 8; out[n++] = (bits >> held) & 255; }
  }
  return n === out.length ? out : out.slice(0, n);
}

/** A data: URI's bytes and media type, or null if `uri` is not one. */
export function decodeDataUri(uri: string): { bytes: Uint8Array; mimeType: string | null } | null {
  if (!/^data:/i.test(uri)) return null;
  const comma = uri.indexOf(',');
  if (comma < 0) return null;
  const head = uri.slice(5, comma), base64 = /;base64$/i.test(head), type = head.replace(/;base64$/i, '').split(';')[0].trim();
  if (base64) return { bytes: decodeBase64(uri, comma + 1), mimeType: type || null };
  const raw = uri.slice(comma + 1), out = new Uint8Array(raw.length);
  let n = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c === 37 && i + 2 < raw.length && /^[0-9a-f]{2}$/i.test(raw.slice(i + 1, i + 3))) { out[n++] = parseInt(raw.slice(i + 1, i + 3), 16); i += 2; }
    else out[n++] = c & 255;
  }
  return { bytes: out.slice(0, n), mimeType: type || null };
}

/** A picture's MIME type from its first bytes, or else its file name. */
export function imageMime(bytes: Uint8Array | null, path: string | null): string | null {
  if (bytes && bytes.length >= 12) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytesAre(bytes, 0, 'RIFF') && bytesAre(bytes, 8, 'WEBP')) return 'image/webp';
    if (bytesAre(bytes, 0, 'GIF8')) return 'image/gif';
    if (bytesAre(bytes, 4, 'ftypavif')) return 'image/avif';
    if (bytes[0] === 0xab && bytesAre(bytes, 1, 'KTX 20')) return 'image/ktx2';
    if (bytesAre(bytes, 0, 'BM')) return 'image/bmp';
  }
  const ext = path ? /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(path)?.[1].toLowerCase() : undefined;
  const byExt: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', ktx2: 'image/ktx2', bmp: 'image/bmp', tga: 'image/x-tga', dds: 'image/vnd-ms.dds', tif: 'image/tiff', tiff: 'image/tiff' };
  return (ext && byExt[ext]) || null;
}

// Colour.

/** One sRGB channel, 0 to 1, as linear light. */
export const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

let BYTE_TO_LINEAR: Float32Array | null = null;
/** sRGB bytes (0–255) as linear light, a table. */
export function srgbByteTable(): Float32Array {
  if (BYTE_TO_LINEAR) return BYTE_TO_LINEAR;
  const table = new Float32Array(256);
  for (let i = 0; i < 256; i++) table[i] = srgbToLinear(i / 255);
  return (BYTE_TO_LINEAR = table);
}

let CURVE: Float32Array | null = null;
/**
 * The sRGB curve as a table, for colours by the million: 1024 steps, read between them, within 1e-6 of `srgbToLinear`.
 * `srgbFromTable(table, c)` reads it, clamping to 0–1.
 */
export function srgbCurve(): Float32Array {
  if (CURVE) return CURVE;
  const table = new Float32Array(1026);
  for (let i = 0; i <= 1024; i++) table[i] = srgbToLinear(i / 1024);
  table[1025] = 1;
  return (CURVE = table);
}
export const srgbFromTable = (table: Float32Array, c: number): number => {
  if (!(c > 0)) return 0;
  if (c >= 1) return 1;
  const x = c * 1024, i = x | 0;
  return table[i] + (table[i + 1] - table[i]) * (x - i);
};

/** sRGB colours in place as linear light; values past 1 are taken as 0–255 when any of them is. */
export function linearizeColors(colors: Float32Array): void {
  let max = 0;
  for (let i = 0; i < colors.length; i++) if (colors[i] > max) max = colors[i];
  const scale = max > 1.001 ? 1 / 255 : 1, table = srgbCurve();
  for (let i = 0; i < colors.length; i++) colors[i] = srgbFromTable(table, colors[i] * scale);
}

/** The material a model gets when it names none: a light grey, or white over vertex colours so they show as they are. */
export const defaultMaterial = (name = 'default', white = false): ModelMaterial => {
  const v = white ? 1 : 0.8;
  return { name, color: [v, v, v, 1], emissive: [0, 0, 0], texture: null, doubleSided: false };
};

/** A base colour texture, its type sniffed from its bytes when not given. */
export const newTexture = (bytes: Uint8Array | null, mimeType: string | null, uri: string | null, wrap: ModelTexture['wrap'] = 'repeat'): ModelTexture =>
  ({ bytes, mimeType: mimeType ?? imageMime(bytes, uri), uri, image: null, wrap });

// Polygons into triangles.

/**
 * Appends polygon `corners[at .. at + n]` (vertex indices into `positions`) to `out` as triangles, in its own winding. Convex
 * polygons are fanned; concave ones (a quad with a dent, an L or a star) are cut ear by ear in the polygon's plane, up to
 * 128 corners, beyond which they are fanned too.
 */
export function triangulate(corners: ArrayLike<number>, at: number, n: number, positions: Float32Array, out: GrowI32, material: number, materials: GrowI32): void {
  if (n < 3) return;
  if (n === 3) { emit(out, materials, material, corners[at], corners[at + 1], corners[at + 2]); return; }
  // The polygon's normal by Newell's method: robust for polygons that are not quite flat.
  let nx = 0, ny = 0, nz = 0;
  for (let k = 0; k < n; k++) {
    const p = corners[at + k] * 3, q = corners[at + (k + 1 === n ? 0 : k + 1)] * 3;
    const px = positions[p], py = positions[p + 1], pz = positions[p + 2], qx = positions[q], qy = positions[q + 1], qz = positions[q + 2];
    nx += (py - qy) * (pz + qz);
    ny += (pz - qz) * (px + qx);
    nz += (px - qx) * (py + qy);
  }
  if (n === 4) {
    // A quad: fan from the first corner unless that cuts outside it (a dent at the second or fourth), then from the second.
    const a = corners[at], b = corners[at + 1], c = corners[at + 2], d = corners[at + 3];
    if (facing(positions, a, b, c, nx, ny, nz) >= 0 && facing(positions, a, c, d, nx, ny, nz) >= 0) { emit(out, materials, material, a, b, c); emit(out, materials, material, a, c, d); }
    else { emit(out, materials, material, b, c, d); emit(out, materials, material, b, d, a); }
    return;
  }
  let convex = true;
  for (let k = 0; k < n && convex; k++) convex = facing(positions, corners[at + k], corners[at + (k + 1) % n], corners[at + (k + 2) % n], nx, ny, nz) >= 0;
  if (convex || n > 128 || !(nx * nx + ny * ny + nz * nz > 0)) {
    for (let k = 1; k < n - 1; k++) emit(out, materials, material, corners[at], corners[at + k], corners[at + k + 1]);
    return;
  }
  earClip(corners, at, n, positions, nx, ny, nz, out, material, materials);
}

const emit = (out: GrowI32, materials: GrowI32, material: number, a: number, b: number, c: number) => {
  const o = out.room(3), i = out.n;
  o[i] = a; o[i + 1] = b; o[i + 2] = c;
  out.n = i + 3;
  materials.push(material);
};

/** How far triangle a b c turns the polygon's way (its normal against n): negative where the polygon bends back. */
const facing = (p: Float32Array, a: number, b: number, c: number, nx: number, ny: number, nz: number) => {
  const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
  const ux = p[b * 3] - ax, uy = p[b * 3 + 1] - ay, uz = p[b * 3 + 2] - az, vx = p[c * 3] - ax, vy = p[c * 3 + 1] - ay, vz = p[c * 3 + 2] - az;
  return (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz;
};

function earClip(corners: ArrayLike<number>, at: number, n: number, p: Float32Array, nx: number, ny: number, nz: number, out: GrowI32, material: number, materials: GrowI32): void {
  // Flatten onto the plane the normal faces most, keeping the polygon counter-clockwise there.
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  const [i0, i1, flip] = az >= ax && az >= ay ? [0, 1, nz < 0] : ax >= ay ? [1, 2, nx < 0] : [2, 0, ny < 0];
  const xs = new Float64Array(n), ys = new Float64Array(n), prev = new Int32Array(n), next = new Int32Array(n);
  for (let k = 0; k < n; k++) {
    const v = corners[at + k] * 3;
    xs[k] = p[v + i0];
    ys[k] = flip ? -p[v + i1] : p[v + i1];
    prev[k] = k === 0 ? n - 1 : k - 1;
    next[k] = k === n - 1 ? 0 : k + 1;
  }
  const cross = (a: number, b: number, c: number) => (xs[b] - xs[a]) * (ys[c] - ys[a]) - (ys[b] - ys[a]) * (xs[c] - xs[a]);
  let left = n, k = 0, misses = 0;
  while (left > 3) {
    const a = prev[k], c = next[k];
    let ear = cross(a, k, c) > 0;
    for (let j = next[c]; ear && j !== a; j = next[j]) {
      if ((xs[j] === xs[a] && ys[j] === ys[a]) || (xs[j] === xs[k] && ys[j] === ys[k]) || (xs[j] === xs[c] && ys[j] === ys[c])) continue;
      if (cross(a, k, j) >= 0 && cross(k, c, j) >= 0 && cross(c, a, j) >= 0) ear = false;
    }
    if (ear) {
      emit(out, materials, material, corners[at + a], corners[at + k], corners[at + c]);
      next[a] = c;
      prev[c] = a;
      left--;
      k = c;
      misses = 0;
    } else if (++misses > left) {
      break; // no ear left (a self-crossing or degenerate polygon): fan what remains
    } else {
      k = next[k];
    }
  }
  const first = k;
  for (let j = next[first]; next[j] !== first; j = next[j]) emit(out, materials, material, corners[at + first], corners[at + j], corners[at + next[j]]);
}

// Welding: one id per distinct point.

/**
 * Gives points with exactly the same coordinates (and the same `keys` value, when given) one id: `ids[i]` for point i,
 * `firsts[id]` the first point with that id, `count` ids in all. -0 and 0 are the same point.
 */
export function weldPoints(positions: Float32Array, n: number, keys: ArrayLike<number> | null): { ids: Uint32Array; firsts: Uint32Array; count: number } {
  const bits = new Uint32Array(positions.buffer, positions.byteOffset, n * 3);
  let size = 16;
  while (size < n * 2) size *= 2;
  const mask = size - 1, table = new Int32Array(size).fill(-1), ids = new Uint32Array(n), firsts = new Uint32Array(n);
  let count = 0;
  for (let i = 0; i < n; i++) {
    let x = bits[i * 3], y = bits[i * 3 + 1], z = bits[i * 3 + 2];
    if (x === 0x80000000) x = 0;
    if (y === 0x80000000) y = 0;
    if (z === 0x80000000) z = 0;
    const key = keys ? keys[i] : 0;
    let h = Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77) ^ Math.imul(z, 0xc2b2ae3d) ^ Math.imul(key, 0x27d4eb2f);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = (h ^ (h >>> 12)) & mask;
    let id = -1;
    for (;;) {
      const e = table[h];
      if (e < 0) break;
      const f = firsts[e] * 3;
      let fx = bits[f], fy = bits[f + 1], fz = bits[f + 2];
      if (fx === 0x80000000) fx = 0;
      if (fy === 0x80000000) fy = 0;
      if (fz === 0x80000000) fz = 0;
      if (fx === x && fy === y && fz === z && (!keys || keys[firsts[e]] === key)) { id = e; break; }
      h = (h + 1) & mask;
    }
    if (id < 0) {
      id = count++;
      table[h] = id;
      firsts[id] = i;
    }
    ids[i] = id;
  }
  return { ids, firsts: firsts.subarray(0, count), count };
}

// Groups and the last checks.

/**
 * Orders triangles by material (keeping their order within each) so each material is one group, as few draws as there
 * are materials. `materialOf` holds one material index a triangle.
 */
export function groupTriangles(indices: Uint32Array, materialOf: ArrayLike<number>, materialCount: number): { indices: Uint32Array; groups: ModelGroup[] } {
  const triangles = indices.length / 3;
  if (triangles === 0) return { indices, groups: [] };
  const counts = new Uint32Array(materialCount);
  const first = materialOf[0];
  let mixed = false;
  for (let t = 0; t < triangles; t++) { const m = materialOf[t]; counts[m]++; if (m !== first) mixed = true; }
  if (!mixed) return { indices, groups: [{ start: 0, count: indices.length, material: first }] };
  const starts = new Uint32Array(materialCount), groups: ModelGroup[] = [];
  for (let m = 0, at = 0; m < materialCount; m++) {
    starts[m] = at;
    if (counts[m]) groups.push({ start: at * 3, count: counts[m] * 3, material: m });
    at += counts[m];
  }
  const out = new Uint32Array(indices.length);
  for (let t = 0; t < triangles; t++) {
    const o = starts[materialOf[t]]++ * 3, i = t * 3;
    out[o] = indices[i]; out[o + 1] = indices[i + 1]; out[o + 2] = indices[i + 2];
  }
  return { indices: out, groups };
}

/** The model's parts before its last checks. */
export interface ModelParts {
  positions: Float32Array;
  normals: Float32Array | null;
  colors: Float32Array | null;
  uvs: Float32Array | null;
  indices: Uint32Array;
  groups: ModelGroup[];
  materials: ModelMaterial[];
  up: 'y' | 'z';
  format: ModelFormat;
}

/**
 * The checks every parser's model passes: something to draw; triangles that touch a point with no position (NaN or
 * infinite) dropped, and such points left out of a point cloud; unit normals, with any missing or zero ones worked out
 * from the faces around them (a point cloud with any loses them all); colours within 0 to 1; a material for everything,
 * and groups that cover every index; the bounds.
 */
export function finishModel(parts: ModelParts, label: string): AsciiModel {
  let { positions, normals, colors, uvs, indices, groups, materials } = parts;
  let n = positions.length / 3;
  if (n === 0) throw new Error(`${label}: the file holds no geometry`);
  if (!materials.length) materials = [defaultMaterial('default', !!colors)];
  if (indices.length && !groups.length) groups = [{ start: 0, count: indices.length, material: 0 }];
  for (const group of groups) if (!(group.material >= 0 && group.material < materials.length)) group.material = 0;

  // Points with no position.
  let bad: Uint8Array | null = null;
  for (let i = 0; i < n * 3; i++) {
    const v = positions[i];
    if (v - v !== 0) (bad ??= new Uint8Array(n))[(i / 3) | 0] = 1;
  }
  if (bad) {
    if (indices.length) {
      const kept = new Uint32Array(indices.length), next: ModelGroup[] = [];
      let o = 0;
      for (const group of groups) {
        const start = o;
        for (let i = group.start; i < group.start + group.count; i += 3) {
          const a = indices[i], b = indices[i + 1], c = indices[i + 2];
          if (bad[a] || bad[b] || bad[c]) continue;
          kept[o++] = a; kept[o++] = b; kept[o++] = c;
        }
        if (o > start) next.push({ start, count: o - start, material: group.material });
      }
      if (o === 0) throw new Error(`${label}: no triangle has a usable position (NaN or infinite coordinates)`);
      indices = kept.slice(0, o);
      groups = next;
      positions = positions.slice();
      for (let i = 0; i < n; i++) if (bad[i]) positions[i * 3] = positions[i * 3 + 1] = positions[i * 3 + 2] = 0;
    } else {
      let kept = 0;
      for (let i = 0; i < n; i++) if (!bad[i]) kept++;
      if (kept === 0) throw new Error(`${label}: no point has a usable position (NaN or infinite coordinates)`);
      const pick = (data: Float32Array | null, size: number) => {
        if (!data) return null;
        const out = new Float32Array(kept * size);
        for (let i = 0, o = 0; i < n; i++) if (!bad![i]) for (let c = 0; c < size; c++) out[o++] = data[i * size + c];
        return out;
      };
      positions = pick(positions, 3)!;
      normals = pick(normals, 3);
      colors = pick(colors, 3);
      uvs = pick(uvs, 2);
      n = kept;
    }
  }
  for (let i = 0; i < indices.length; i++) if (indices[i] >= n) throw new Error(`${label}: a triangle refers to vertex ${indices[i]} of ${n}`);

  if (normals) normals = unitNormals(normals, positions, indices, n);
  if (colors) for (let i = 0; i < colors.length; i++) { const c = colors[i]; colors[i] = c > 0 ? (c < 1 ? c : 1) : 0; }
  if (uvs) for (let i = 0; i < uvs.length; i++) if (uvs[i] - uvs[i] !== 0) uvs[i] = 0;

  const bounds = new Float32Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
  for (let i = 0; i < n; i++) {
    if (bad && bad[i] && indices.length) continue;
    for (let c = 0; c < 3; c++) {
      const v = positions[i * 3 + c];
      if (v < bounds[c]) bounds[c] = v;
      if (v > bounds[c + 3]) bounds[c + 3] = v;
    }
  }
  return { positions, normals, colors, uvs, indices, groups, materials, bounds, up: parts.up, format: parts.format };
}

/** Normals at unit length. Zero, missing (NaN) ones are made from the faces at that vertex, weighted by area. */
function unitNormals(normals: Float32Array, positions: Float32Array, indices: Uint32Array, n: number): Float32Array | null {
  let broken: Uint8Array | null = null;
  for (let i = 0; i < n; i++) {
    const x = normals[i * 3], y = normals[i * 3 + 1], z = normals[i * 3 + 2], len = Math.sqrt(x * x + y * y + z * z);
    if (len > 1e-20 && len - len === 0) {
      if (Math.abs(len - 1) > 1e-6) { normals[i * 3] = x / len; normals[i * 3 + 1] = y / len; normals[i * 3 + 2] = z / len; }
    } else {
      (broken ??= new Uint8Array(n))[i] = 1;
      normals[i * 3] = normals[i * 3 + 1] = normals[i * 3 + 2] = 0;
    }
  }
  if (!broken) return normals;
  if (!indices.length) return null;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    if (!(broken[a] || broken[b] || broken[c])) continue;
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const ux = positions[b * 3] - ax, uy = positions[b * 3 + 1] - ay, uz = positions[b * 3 + 2] - az;
    const vx = positions[c * 3] - ax, vy = positions[c * 3 + 1] - ay, vz = positions[c * 3 + 2] - az;
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    for (const v of [a, b, c]) if (broken[v]) { normals[v * 3] += fx; normals[v * 3 + 1] += fy; normals[v * 3 + 2] += fz; }
  }
  for (let i = 0; i < n; i++) {
    if (!broken[i]) continue;
    const x = normals[i * 3], y = normals[i * 3 + 1], z = normals[i * 3 + 2], len = Math.sqrt(x * x + y * y + z * z);
    if (len > 1e-30 && len - len === 0) { normals[i * 3] = x / len; normals[i * 3 + 1] = y / len; normals[i * 3 + 2] = z / len; }
    else { normals[i * 3] = 0; normals[i * 3 + 1] = 0; normals[i * 3 + 2] = 1; }
  }
  return normals;
}
