/**
 * Wavefront OBJ, with its MTL materials. Reads v (with the r g b vertex colours many tools add), vt, vn, f in every index
 * form (v, v/vt, v//vn, v/vt/vn, relative indices too), usemtl and mtllib; polygons become triangles, cut ear by ear when
 * they are concave. From MTL: newmtl, Kd, d or Tr, Ke and map_Kd (its options skipped but -clamp). Not read: o, g and s
 * (they change nothing drawn), lines, points next to faces, free-form curves and surfaces, and every other MTL value or map.
 */
import type { AsciiModel, ModelMaterial } from './types';
import {
  GrowF32, GrowI32, ResourceIndex, Scanner, bytesAre, cleanPath, defaultMaterial, dirOf, findBytes, finishModel, groupTriangles,
  isBlank, isSpace, joinPath, linearizeColors, newTexture, srgbToLinear, triangulate,
} from './parse-util';

export function parseObj(bytes: Uint8Array, resources: ResourceIndex | null): AsciiModel {
  const b = joinContinuations(bytes), n = b.length, s = new Scanner(b);
  const positions = new GrowF32(), texcoords = new GrowF32(), normals = new GrowF32();
  let colors: GrowF32 | null = null;
  // Each face corner as three 0-based indices (position, uv, normal; -1 for none), then each face's corner count, material
  // and where it starts in the file (for error messages).
  const corners = new GrowI32(), faceSizes = new GrowI32(), faceMaterials = new GrowI32(), faceStarts = new GrowI32();
  const names: string[] = [], ids = new Map<string, number>(), libraries: string[] = [];
  let material = -1;
  const num = (otherwise: number) => { const v = s.float(); return s.ok ? v : otherwise; };
  const resolve = (index: number, count: number, what: string, at: number) => {
    if (index > 0) return Math.min(index - 1, 0x7fffffff);
    if (index < 0 && count + index >= 0) return count + index;
    throw new Error(`OBJ: face refers to ${what} ${index} of ${count} (line ${s.line(at)})`);
  };

  let i = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0;
  while (i < n) {
    const c = b[i];
    if (isSpace(c)) { i++; continue; }
    const c1 = i + 1 < n ? b[i + 1] : 10, c2 = i + 2 < n ? b[i + 2] : 10;
    if (c === 118 && isBlank(c1)) {
      // v x y z, then w, or r g b (0 to 1, or 0 to 255)
      s.pos = i + 2;
      const x = num(NaN), y = num(0), z = num(0);
      const at = positions.n, p = positions.room(3);
      p[at] = x; p[at + 1] = y; p[at + 2] = z;
      positions.n = at + 3;
      const r = s.float();
      if (s.ok) {
        const g = s.float(), gOk = s.ok, bl = gOk ? s.float() : 0;
        if (gOk && s.ok) {
          if (!colors) { colors = new GrowF32(positions.a.length); colors.room(at).fill(1, 0, at); colors.n = at; }
          const o = colors.room(3);
          o[at] = r; o[at + 1] = g; o[at + 2] = bl;
          colors.n = at + 3;
        }
      }
      if (colors && colors.n < at + 3) { const o = colors.room(3); o[at] = o[at + 1] = o[at + 2] = 1; colors.n = at + 3; }
    } else if (c === 118 && c1 === 116 && isBlank(c2)) {
      s.pos = i + 3;
      const u = num(0), v = num(0), at = texcoords.n, t = texcoords.room(2);
      t[at] = u;
      t[at + 1] = 1 - v; // OBJ counts v up from the bottom of the image; glTF, and the model, down from the top
      texcoords.n = at + 2;
    } else if (c === 118 && c1 === 110 && isBlank(c2)) {
      s.pos = i + 3;
      const x = num(0), y = num(0), z = num(0), at = normals.n, o = normals.room(3);
      o[at] = x; o[at + 1] = y; o[at + 2] = z;
      normals.n = at + 3;
    } else if (c === 102 && isBlank(c1)) {
      const vCount = positions.n / 3, tCount = texcoords.n / 2, nCount = normals.n / 3, start = corners.n;
      let p = i + 2, k = 0;
      for (;;) {
        let ch = p < n ? b[p] : 10;
        while (isBlank(ch)) ch = ++p < n ? b[p] : 10;
        if (ch === 10 || ch === 13 || ch === 35) break;
        s.pos = p;
        const v = s.int();
        if (v === v) {
          let t = 0, m = 0;
          if (s.at(s.pos) === 47) {
            s.pos++;
            if (s.at(s.pos) !== 47) { const x = s.int(); if (x === x) t = x; }
            if (s.at(s.pos) === 47) { s.pos++; const x = s.int(); if (x === x) m = x; }
          }
          const o = corners.room(3), at = corners.n;
          o[at] = resolve(v, vCount, 'vertex', p);
          o[at + 1] = t ? resolve(t, tCount, 'texture coordinate', p) : -1;
          o[at + 2] = m ? resolve(m, nCount, 'normal', p) : -1;
          corners.n = at + 3;
          k++;
          p = s.pos;
        }
        while (p < n && !isSpace(b[p])) p++; // the rest of a token that is not an index
      }
      if (k >= 3) { faceSizes.push(k); faceMaterials.push(material); faceStarts.push(i); } else corners.n = start;
      s.pos = p;
    } else if (c === 117 && bytesAre(b, i, 'usemtl') && isSpace(i + 6 < n ? b[i + 6] : 10)) {
      s.pos = i + 6;
      const name = s.rest() || 'default';
      let id = ids.get(name);
      if (id === undefined) { id = names.length; names.push(name); ids.set(name, id); }
      material = id;
      i = s.pos;
      continue;
    } else if (c === 109 && bytesAre(b, i, 'mtllib') && isBlank(i + 6 < n ? b[i + 6] : 10)) {
      s.pos = i + 6;
      const name = s.rest();
      if (name) libraries.push(name);
      i = s.pos;
      continue;
    } else {
      s.pos = i;
    }
    s.skipLine();
    i = s.pos;
  }

  const vertexCount = positions.n / 3;
  if (vertexCount === 0) throw new Error('OBJ: the file holds no vertices');
  const sourceColors = colors ? colors.done() : null;
  if (sourceColors) linearizeColors(sourceColors);
  const library = new Map<string, ModelMaterial>();
  if (resources) for (const name of libraries) readLibrary(name, resources, library);

  if (faceSizes.n === 0) {
    // Vertices and no faces: a point cloud, with normals when there is one for each point.
    const own = normals.n === positions.n ? normals.done() : null;
    return finishModel({
      positions: positions.done(), normals: own, colors: sourceColors, uvs: null, indices: new Uint32Array(0), groups: [],
      materials: [defaultMaterial('default', !!sourceColors)], up: 'y', format: 'obj',
    }, 'OBJ');
  }

  // One vertex per distinct position / uv / normal triple, found through a short list kept for each position.
  const cornerCount = corners.n / 3, cs = corners.a, tCount = texcoords.n / 2, nCount = normals.n / 3;
  const head = new Int32Array(vertexCount).fill(-1), link = new Int32Array(cornerCount), keyT = new Int32Array(cornerCount);
  const keyN = new Int32Array(cornerCount), source = new Int32Array(cornerCount), remap = new Uint32Array(cornerCount);
  let count = 0, anyT = false, anyN = false;
  const outOfRange = (corner: number, what: string, index: number, of: number) => {
    let face = 0;
    for (let seen = faceSizes.a[0]; seen <= corner; seen += faceSizes.a[++face]);
    return new Error(`OBJ: face refers to ${what} ${index + 1} of ${of} (line ${s.line(faceStarts.a[face])})`);
  };
  for (let c = 0; c < cornerCount; c++) {
    const v = cs[c * 3], t = cs[c * 3 + 1], m = cs[c * 3 + 2];
    if (v >= vertexCount) throw outOfRange(c, 'vertex', v, vertexCount);
    if (t >= tCount) throw outOfRange(c, 'texture coordinate', t, tCount);
    if (m >= nCount) throw outOfRange(c, 'normal', m, nCount);
    let e = head[v];
    while (e >= 0 && (keyT[e] !== t || keyN[e] !== m)) e = link[e];
    if (e < 0) {
      e = count++;
      keyT[e] = t; keyN[e] = m; source[e] = v;
      link[e] = head[v];
      head[v] = e;
      if (t >= 0) anyT = true;
      if (m >= 0) anyN = true;
    }
    remap[c] = e;
  }

  const P = positions.a, T = texcoords.a, N = normals.a;
  const outPositions = new Float32Array(count * 3), outColors = sourceColors ? new Float32Array(count * 3) : null;
  const outUvs = anyT ? new Float32Array(count * 2) : null, outNormals = anyN ? new Float32Array(count * 3) : null;
  for (let e = 0; e < count; e++) {
    const v = source[e] * 3, o = e * 3;
    outPositions[o] = P[v]; outPositions[o + 1] = P[v + 1]; outPositions[o + 2] = P[v + 2];
    if (outColors) { outColors[o] = sourceColors![v]; outColors[o + 1] = sourceColors![v + 1]; outColors[o + 2] = sourceColors![v + 2]; }
    if (outUvs && keyT[e] >= 0) { outUvs[e * 2] = T[keyT[e] * 2]; outUvs[e * 2 + 1] = T[keyT[e] * 2 + 1]; }
    // A corner with no normal gets a zero one, which finishModel works out from the faces around it.
    if (outNormals && keyN[e] >= 0) { const k = keyN[e] * 3; outNormals[o] = N[k]; outNormals[o + 1] = N[k + 1]; outNormals[o + 2] = N[k + 2]; }
  }

  // Materials in the order faces first use them; faces before any usemtl get the default one.
  const order = new Int32Array(names.length + 1).fill(-1), used: number[] = [];
  const triangles = new GrowI32(Math.ceil(cornerCount * 1.5) + 16), triangleMaterials = new GrowI32(cornerCount / 2 + 16);
  const sizes = faceSizes.a, mats = faceMaterials.a;
  for (let f = 0, at = 0; f < faceSizes.n; f++) {
    const size = sizes[f], file = mats[f] + 1;
    if (order[file] < 0) { order[file] = used.length; used.push(file - 1); }
    triangulate(remap, at, size, outPositions, triangles, order[file], triangleMaterials);
    at += size;
  }
  const materials = used.map(id => (id < 0 ? defaultMaterial('default', !!outColors) : library.get(names[id]) ?? defaultMaterial(names[id], !!outColors)));
  const indices = new Uint32Array(triangles.n);
  indices.set(triangles.a.subarray(0, triangles.n));
  const grouped = groupTriangles(indices, triangleMaterials.a, materials.length);
  return finishModel({
    positions: outPositions, normals: outNormals, colors: outColors, uvs: outUvs, indices: grouped.indices, groups: grouped.groups,
    materials, up: 'y', format: 'obj',
  }, 'OBJ');
}

/**
 * What an OBJ's mtllib lines name, as written. A line may hold one file name with spaces in it or several names: try it
 * whole, then split at spaces.
 */
export function objLibraries(bytes: Uint8Array): string[] {
  const out = new Set<string>();
  for (let i = findBytes(bytes, 'mtllib'); i >= 0; i = findBytes(bytes, 'mtllib', i + 6)) {
    let j = i - 1;
    while (j >= 0 && isBlank(bytes[j])) j--;
    if ((j >= 0 && bytes[j] !== 10 && bytes[j] !== 13) || !isBlank(bytes[i + 6] ?? 10)) continue;
    const s = new Scanner(bytes);
    s.pos = i + 6;
    const rest = s.rest();
    if (rest) out.add(rest);
  }
  return [...out];
}

/** The textures an MTL file names (map_Kd), as written. */
export function mtlTextures(text: string): string[] {
  const out: string[] = [];
  for (const line of text.replace(/\\[ \t]*(\r\n|\n|\r)/g, ' ').split(/\r\n|\n|\r/)) {
    const match = /^\s*map_kd\s+(.+)$/i.exec(line);
    const path = match ? textureArgs(match[1].trim()).path : '';
    if (path) out.push(path);
  }
  return out;
}

/** OBJ joins a line ending in a backslash to the next: those become blanks, in a copy only when there are any. */
function joinContinuations(bytes: Uint8Array): Uint8Array {
  let out: Uint8Array | null = null;
  const n = bytes.length;
  for (let i = bytes.indexOf(92); i >= 0; i = bytes.indexOf(92, i + 1)) {
    let j = i + 1;
    while (j < n && isBlank(bytes[j])) j++;
    if (j < n && bytes[j] === 13) j++;
    if (j < n && bytes[j] === 10) j++;
    else if (!(j > i + 1 && bytes[j - 1] === 13)) continue;
    (out ??= bytes.slice()).fill(32, i, j);
  }
  return out ?? bytes;
}

/** Reads an MTL library into `into`, trying the name whole and then each space-separated part. */
function readLibrary(name: string, resources: ResourceIndex, into: Map<string, ModelMaterial>): void {
  const whole = resources.text(name);
  if (whole !== null) { parseMtl(whole, name, resources, into); return; }
  if (/\s/.test(name)) for (const part of name.split(/\s+/)) {
    const text = resources.text(part);
    if (text !== null) parseMtl(text, part, resources, into);
  }
}

interface MtlEntry { name: string; kd: number[] | null; ke: number[] | null; d: number | null; tr: number | null; map: string | null; clamp: boolean }

function parseMtl(text: string, file: string, resources: ResourceIndex, into: Map<string, ModelMaterial>): void {
  const dir = dirOf(cleanPath(file));
  let entry: MtlEntry | null = null;
  const finish = () => { if (entry && !into.has(entry.name)) into.set(entry.name, mtlMaterial(entry, dir, resources)); };
  for (const raw of text.replace(/\\[ \t]*(\r\n|\n|\r)/g, ' ').split(/\r\n|\n|\r/)) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const space = line.search(/\s/), key = (space < 0 ? line : line.slice(0, space)).toLowerCase(), rest = space < 0 ? '' : line.slice(space + 1).trim();
    if (key === 'newmtl') {
      finish();
      entry = { name: rest || 'default', kd: null, ke: null, d: null, tr: null, map: null, clamp: false };
    } else if (entry) {
      if (key === 'kd') entry.kd = rgb(rest) ?? entry.kd;
      else if (key === 'ke') entry.ke = rgb(rest) ?? entry.ke;
      else if (key === 'd') entry.d = factor(rest) ?? entry.d;
      else if (key === 'tr') entry.tr = factor(rest) ?? entry.tr;
      else if (key === 'map_kd') {
        const args = textureArgs(rest);
        if (args.path) { entry.map = args.path; entry.clamp = args.clamp; }
      }
    }
  }
  finish();
}

/** r g b (g and b default to r); null for the spectral and xyz forms. */
function rgb(text: string): number[] | null {
  const parts = text ? text.split(/\s+/).map(Number) : [];
  if (!parts.length || !(parts[0] === parts[0])) return null;
  const r = parts[0], g = parts.length > 1 && parts[1] === parts[1] ? parts[1] : r, b = parts.length > 2 && parts[2] === parts[2] ? parts[2] : r;
  return [r, g, b];
}

/** A single value, skipping d's -halo flag. */
function factor(text: string): number | null {
  const first = text.replace(/^-halo\s+/i, '').split(/\s+/)[0], value = first ? Number(first) : NaN;
  return value === value ? value : null;
}

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

/** A texture statement's file, past its options (-s 1 1 1, -o …, -bm 0.5, -blendu on …); -clamp on is kept. */
function textureArgs(text: string): { path: string; clamp: boolean } {
  const tokens = text.split(/\s+/).filter(Boolean);
  let i = 0, clamp = false;
  while (i < tokens.length - 1 && tokens[i][0] === '-' && !NUMBER.test(tokens[i])) {
    const option = tokens[i++].toLowerCase();
    if (option === '-clamp') clamp = tokens[i++].toLowerCase() === 'on';
    else if (option === '-blendu' || option === '-blendv' || option === '-cc' || option === '-imfchan' || option === '-type' || option === '-colorspace') i++;
    else for (let k = 0; k < 3 && i < tokens.length - 1 && NUMBER.test(tokens[i]); k++) i++;
  }
  return { path: tokens.slice(i).join(' '), clamp };
}

const clamp01 = (v: number) => (v > 0 ? (v < 1 ? v : 1) : 0);

function mtlMaterial(entry: MtlEntry, dir: string, resources: ResourceIndex): ModelMaterial {
  // d is opacity. Tr is meant as transparency (1 - d), but some exporters write it as opacity, so a Tr that would make the
  // material vanish is taken as that mistake; d wins where both are given.
  const alpha = entry.d !== null ? clamp01(entry.d) : entry.tr !== null && entry.tr > 0 && entry.tr < 1 ? 1 - entry.tr : 1;
  const linear = (c: number[]) => [srgbToLinear(clamp01(c[0])), srgbToLinear(clamp01(c[1])), srgbToLinear(clamp01(c[2]))];
  const base = entry.kd ? linear(entry.kd) : entry.map ? [1, 1, 1] : [0.8, 0.8, 0.8];
  const emissive = entry.ke ? linear(entry.ke) : [0, 0, 0];
  let texture = null;
  if (entry.map) {
    const path = cleanPath(entry.map), bytes = resources.bytes(path, dir);
    texture = newTexture(bytes, null, joinPath(dir, path), entry.clamp ? 'clamp' : 'repeat');
  }
  return { name: entry.name, color: [base[0], base[1], base[2], alpha], emissive: [emissive[0], emissive[1], emissive[2]], texture, doubleSided: false };
}
