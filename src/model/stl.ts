/**
 * STL, binary and ASCII. Binary is told by its size (84 bytes, then 50 a triangle) even when its header starts with
 * "solid", as many exporters write it. Faces coloured in the attribute bytes (the VisCAM/SolidView and Materialise Magics
 * conventions) keep their colours. Equal corners are welded into shared vertices. The facet normals in the file are often
 * wrong and are not read: withNormals works them out. STL has no units, materials or uvs; CAD and 3D printing work z-up.
 */
import type { AsciiModel } from './types';
import { GrowF32, MAX_VERTICES, Scanner, defaultMaterial, findBytes, finishModel, isSpace, srgbByteTable, weldPoints } from './parse-util';

export function parseStl(bytes: Uint8Array): AsciiModel {
  const n = bytes.length;
  const count = n >= 84 ? (bytes[80] | (bytes[81] << 8) | (bytes[82] << 16) | (bytes[83] << 24)) >>> 0 : -1;
  if (count >= 0 && 84 + 50 * count === n) return parseBinary(bytes, count);
  const text = looksAscii(bytes);
  if (text) { const model = parseAscii(bytes); if (model) return model; }
  // Some writers leave bytes after the last triangle.
  if (count > 0 && 84 + 50 * count <= n) return parseBinary(bytes, count);
  if (text) throw new Error('STL: an ASCII STL with no facets');
  if (n < 84) throw new Error(`STL: the file is ${n} bytes, too short for binary STL (84 bytes come before the first triangle), and it is not ASCII STL`);
  throw new Error(`STL: the header says ${count} triangles (${84 + 50 * count} bytes) but the file is ${n} bytes`);
}

/** ASCII STL starts with "solid" (binary files often do too, so this alone decides nothing). */
export function looksAscii(bytes: Uint8Array): boolean {
  let i = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  while (i < bytes.length && isSpace(bytes[i])) i++;
  return wordIs(bytes, i, 5, 'solid') && (i + 5 >= bytes.length || isSpace(bytes[i + 5]));
}

function parseBinary(bytes: Uint8Array, count: number): AsciiModel {
  if (count === 0) throw new Error('STL: the file holds no triangles');
  if (count * 3 > MAX_VERTICES) throw new Error(`STL: ${count} triangles is more than this reader takes`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), corners = new Float32Array(count * 9);
  // Each triangle: a normal (skipped), three corners, two attribute bytes.
  for (let t = 0, o = 96, k = 0; t < count; t++, o += 50) {
    for (let j = 0; j < 36; j += 4) corners[k++] = view.getFloat32(o + j, true);
  }
  const colors = faceColors(bytes, view, count);
  return build(corners, count * 3, colors?.keys ?? null, colors?.color ?? null);
}

/**
 * Colours kept in the attribute bytes. Materialise Magics marks its files with "COLOR=" in the header (the whole part's
 * colour) and gives a face its own colour, red in the low bits, when bit 15 is clear. VisCAM and SolidView set bit 15 on
 * a coloured face, blue in the low bits; files from other tools often hold stray values there, so those are only read as
 * colours when every face is either 0 or marked.
 */
function faceColors(bytes: Uint8Array, view: DataView, count: number): { keys: Uint16Array; color: (key: number, out: Float32Array, at: number) => void } | null {
  const linear = srgbByteTable(), five = (v: number) => linear[Math.round((v & 31) * 255 / 31)];
  const header = findBytes(bytes, 'COLOR=', 0, 80);
  const keys = new Uint16Array(count * 3);
  let any = false;
  if (header >= 0 && header + 10 <= 80) {
    const r = linear[bytes[header + 6]], g = linear[bytes[header + 7]], b = linear[bytes[header + 8]];
    for (let t = 0; t < count; t++) {
      const attr = view.getUint16(84 + t * 50 + 48, true), key = attr & 0x8000 ? 0 : (attr & 0x7fff) + 1;
      if (key) any = true;
      keys[t * 3] = keys[t * 3 + 1] = keys[t * 3 + 2] = key;
    }
    return {
      keys,
      color: (key, out, at) => {
        if (key) { out[at] = five(key - 1); out[at + 1] = five((key - 1) >> 5); out[at + 2] = five((key - 1) >> 10); }
        else { out[at] = r; out[at + 1] = g; out[at + 2] = b; }
      },
    };
  }
  for (let t = 0; t < count; t++) {
    const attr = view.getUint16(84 + t * 50 + 48, true);
    if (attr && !(attr & 0x8000)) return null;
    const key = attr & 0x8000 ? (attr & 0x7fff) + 1 : 0;
    if (key) any = true;
    keys[t * 3] = keys[t * 3 + 1] = keys[t * 3 + 2] = key;
  }
  if (!any) return null;
  return {
    keys,
    color: (key, out, at) => {
      if (key) { out[at] = five((key - 1) >> 10); out[at + 1] = five((key - 1) >> 5); out[at + 2] = five(key - 1); }
      else out[at] = out[at + 1] = out[at + 2] = 0.8; // an uncoloured face among coloured ones: the default grey
    },
  };
}

function parseAscii(bytes: Uint8Array): AsciiModel | null {
  const n = bytes.length, s = new Scanner(bytes), corners = new GrowF32(), facet: number[] = [];
  const flush = () => {
    // A facet's loop is a triangle; a longer one (some writers) is fanned.
    const k = facet.length / 3;
    for (let t = 1; t + 1 < k; t++) {
      const o = corners.room(9), at = corners.n;
      for (let c = 0; c < 3; c++) { o[at + c] = facet[c]; o[at + 3 + c] = facet[t * 3 + c]; o[at + 6 + c] = facet[t * 3 + 3 + c]; }
      corners.n = at + 9;
    }
    facet.length = 0;
  };
  let i = 0;
  while (i < n) {
    if (isSpace(bytes[i])) { i++; continue; }
    let j = i;
    while (j < n && !isSpace(bytes[j])) j++;
    const len = j - i;
    if (len === 6 && wordIs(bytes, i, 6, 'vertex')) {
      s.pos = j;
      const x = s.next(), y = s.ok ? s.next() : NaN, z = s.ok ? s.next() : NaN;
      if (!s.ok) throw new Error(`STL: a vertex needs three numbers (line ${s.line(i)})`);
      facet.push(x, y, z);
      i = s.pos;
      continue;
    }
    if ((len === 5 && wordIs(bytes, i, 5, 'facet')) || (len === 7 && wordIs(bytes, i, 7, 'endloop')) || (len === 8 && wordIs(bytes, i, 8, 'endfacet'))) flush();
    else if ((len === 5 && wordIs(bytes, i, 5, 'solid')) || (len === 8 && wordIs(bytes, i, 8, 'endsolid'))) {
      // The name runs to the end of the line, whatever words it holds.
      flush();
      s.pos = j;
      s.skipLine();
      i = s.pos;
      continue;
    }
    i = j;
  }
  flush();
  if (corners.n === 0) return null;
  if (corners.n / 3 > MAX_VERTICES) throw new Error(`STL: ${corners.n / 9} triangles is more than this reader takes`);
  return build(corners.a, corners.n / 3, null, null);
}

function build(corners: Float32Array, cornerCount: number, keys: Uint16Array | null, color: ((key: number, out: Float32Array, at: number) => void) | null): AsciiModel {
  const { ids, firsts, count } = weldPoints(corners, cornerCount, keys);
  const positions = new Float32Array(count * 3), colors = keys && color ? new Float32Array(count * 3) : null;
  for (let v = 0; v < count; v++) {
    const f = firsts[v];
    positions[v * 3] = corners[f * 3]; positions[v * 3 + 1] = corners[f * 3 + 1]; positions[v * 3 + 2] = corners[f * 3 + 2];
    if (colors) color!(keys![f], colors, v * 3);
  }
  return finishModel({
    positions, normals: null, colors, uvs: null, indices: ids, groups: [], materials: [defaultMaterial('default', !!colors)], up: 'z', format: 'stl',
  }, 'STL');
}

/** Whether the `len` bytes at `at` spell `word`, in any case. */
function wordIs(bytes: Uint8Array, at: number, len: number, word: string): boolean {
  if (at + len > bytes.length) return false;
  for (let k = 0; k < len; k++) if ((bytes[at + k] | 32) !== word.charCodeAt(k)) return false;
  return true;
}
