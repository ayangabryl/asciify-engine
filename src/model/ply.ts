/**
 * PLY, ASCII and binary in either byte order, with every property type. Reads the vertex element's x y z, normals
 * (nx ny nz), colours (red green blue as bytes, shorts or floats; a Gaussian splat's f_dc_0..2 when there are none) and uvs
 * (u v, s t, texture_u texture_v); faces from vertex_indices (or vertex_index) lists, polygons cut into triangles, and
 * the older tristrips element; MeshLab's per-face texcoord lists, texnumber and TextureFile comments. Every other element
 * and property is skipped. With no faces it is a point cloud. Alpha, opacity, splat sizes and rotations are not read.
 */
import type { AsciiModel, ModelMaterial } from './types';
import {
  GrowF32, GrowI32, MAX_VERTICES, ResourceIndex, Scanner, cleanPath, decodeText, defaultMaterial, findBytes, finishModel,
  groupTriangles, isBlank, isSpace, linearizeColors, newTexture, srgbByteTable, srgbCurve, srgbFromTable, triangulate,
} from './parse-util';

const TYPES: Record<string, number> = { char: 0, int8: 0, uchar: 1, uint8: 1, short: 2, int16: 2, ushort: 3, uint16: 3, int: 4, int32: 4, uint: 5, uint32: 5, float: 6, float32: 6, double: 7, float64: 7 };
const SIZES = [1, 1, 2, 2, 4, 4, 4, 8];
const RANGES = [127, 255, 32767, 65535, 2147483647, 4294967295, 1, 1];

interface Property { name: string; type: number; countType: number; list: boolean }
interface Element { name: string; count: number; props: Property[] }
interface ListSink { values: GrowI32 | GrowF32; lengths: GrowI32 }

interface Header { format: 'ascii' | 'binary_little_endian' | 'binary_big_endian'; elements: Element[]; textures: string[]; dataStart: number }

export function readPlyHeader(bytes: Uint8Array): Header {
  if (!(bytes[0] === 112 && bytes[1] === 108 && bytes[2] === 121 && isSpace(bytes[3] ?? 0))) throw new Error('PLY: the file does not start with "ply"');
  const end = findBytes(bytes, 'end_header');
  if (end < 0) throw new Error('PLY: the header has no end_header');
  let dataStart = end + 10;
  while (dataStart < bytes.length && isBlank(bytes[dataStart])) dataStart++;
  if (bytes[dataStart] === 13) dataStart++;
  if (bytes[dataStart] === 10) dataStart++;
  let format: Header['format'] | null = null;
  const elements: Element[] = [], textures: string[] = [];
  for (const raw of decodeText(bytes.subarray(0, end)).split(/\r\n|\r|\n/)) {
    const words = raw.trim().split(/\s+/);
    if (words[0] === 'format') {
      if (words[1] !== 'ascii' && words[1] !== 'binary_little_endian' && words[1] !== 'binary_big_endian') throw new Error(`PLY: unknown format "${words[1]}"`);
      format = words[1];
    } else if (words[0] === 'element') {
      const count = Number(words[2]);
      if (!(count >= 0 && Number.isInteger(count) && count <= 0xffffffff)) throw new Error(`PLY: element ${words[1]} has a count of "${words[2]}"`);
      elements.push({ name: words[1], count, props: [] });
    } else if (words[0] === 'property') {
      const element = elements[elements.length - 1];
      if (!element) throw new Error('PLY: a property comes before any element');
      const list = words[1] === 'list';
      const type = TYPES[list ? words[3] : words[1]], countType = list ? TYPES[words[2]] : 0;
      if (type === undefined || countType === undefined) throw new Error(`PLY: unknown property type in "${raw.trim()}"`);
      element.props.push({ name: list ? words[4] : words[2], type, countType, list });
    } else if (words[0] === 'comment' && /^texturefile$/i.test(words[1] ?? '')) {
      const path = raw.trim().replace(/^comment\s+texturefile\s+/i, '');
      if (path) textures.push(path);
    }
  }
  if (!format) throw new Error('PLY: the header has no format line');
  return { format, elements, textures, dataStart };
}

/** The pictures a PLY's TextureFile comments name, for loadModel. */
export function plyTextures(bytes: Uint8Array): string[] {
  try { return readPlyHeader(bytes).textures.map(cleanPath); } catch { return []; }
}

export function parsePly(bytes: Uint8Array, resources: ResourceIndex | null): AsciiModel {
  const { format, elements, textures, dataStart } = readPlyHeader(bytes);
  const binary = format !== 'ascii', le = format === 'binary_little_endian', end = bytes.length;

  // Refuse counts the data cannot hold before allocating for them: each value takes a byte or more (two with a separator).
  let least = 0;
  for (const el of elements) least += el.count * (binary ? el.props.reduce((sum, p) => sum + SIZES[p.list ? p.countType : p.type], 0) : el.props.length * 2);
  if (least > end - dataStart + 1) throw new Error(`PLY: the header promises at least ${least} bytes of data, but the file holds ${end - dataStart}`);

  const vertexEl = elements.find(el => el.name === 'vertex' || el.name === 'vertices');
  if (!vertexEl) throw new Error('PLY: the file has no vertex element');
  const vc = vertexEl.count;
  if (vc > MAX_VERTICES) throw new Error(`PLY: ${vc} vertices is more than this reader takes`);
  const find = (el: Element | undefined, ...names: string[]) => (el ? el.props.findIndex(p => !p.list && names.includes(p.name)) : -1);
  const findList = (el: Element | undefined, ...names: string[]) => (el ? el.props.findIndex(p => p.list && names.includes(p.name)) : -1);
  const x = find(vertexEl, 'x'), y = find(vertexEl, 'y'), z = find(vertexEl, 'z');
  if (x < 0 || y < 0 || z < 0) throw new Error('PLY: the vertex element has no x, y and z');
  const nx = find(vertexEl, 'nx', 'normal_x'), ny = find(vertexEl, 'ny', 'normal_y'), nz = find(vertexEl, 'nz', 'normal_z');
  let r = find(vertexEl, 'red', 'r', 'diffuse_red'), g = find(vertexEl, 'green', 'g', 'diffuse_green'), b = find(vertexEl, 'blue', 'b', 'diffuse_blue');
  const splat = (r < 0 || g < 0 || b < 0) && find(vertexEl, 'f_dc_0') >= 0 && find(vertexEl, 'f_dc_1') >= 0 && find(vertexEl, 'f_dc_2') >= 0;
  if (splat) { r = find(vertexEl, 'f_dc_0'); g = find(vertexEl, 'f_dc_1'); b = find(vertexEl, 'f_dc_2'); }
  const u = find(vertexEl, 'u', 's', 'texture_u', 'texture_s'), v = find(vertexEl, 'v', 't', 'texture_v', 'texture_t');

  const positions = new Float32Array(vc * 3);
  const normals = nx >= 0 && ny >= 0 && nz >= 0 ? new Float32Array(vc * 3) : null;
  const colors = r >= 0 && g >= 0 && b >= 0 ? new Float32Array(vc * 3) : null;
  let uvs = u >= 0 && v >= 0 ? new Float32Array(vc * 2) : null;
  const store = (i: number, values: Float64Array) => {
    positions[i * 3] = values[x]; positions[i * 3 + 1] = values[y]; positions[i * 3 + 2] = values[z];
    if (normals) { normals[i * 3] = values[nx]; normals[i * 3 + 1] = values[ny]; normals[i * 3 + 2] = values[nz]; }
    if (colors) { colors[i * 3] = values[r]; colors[i * 3 + 1] = values[g]; colors[i * 3 + 2] = values[b]; }
    if (uvs) { uvs[i * 2] = values[u]; uvs[i * 2 + 1] = 1 - values[v]; } // counted up from the bottom, as in OBJ
  };

  const faceEl = elements.find(el => el.name === 'face' || el.name === 'faces');
  const stripEl = elements.find(el => el.name === 'tristrips');
  const faceIndices = findList(faceEl, 'vertex_indices', 'vertex_index'), faceTex = findList(faceEl, 'texcoord'), faceTexNumber = find(faceEl, 'texnumber');
  const stripIndices = findList(stripEl, 'vertex_indices', 'vertex_index');
  const corners = new GrowI32(), sizes = new GrowI32(), texcoords = new GrowF32(), texSizes = new GrowI32(), texNumbers = new GrowI32();
  const strips = new GrowI32(), stripSizes = new GrowI32();

  // Values a item, by property index; list properties go to their sink, or are skipped.
  const values = new Float64Array(Math.max(1, ...elements.map(el => el.props.length)));
  let p = dataStart;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const cutShort = () => new Error(binary ? 'PLY: the file ends before the data its header describes' : `PLY: the data ends early, or holds a word where a number belongs (line ${s.line()})`);
  const get = (type: number, o: number): number => {
    switch (type) {
      case 0: return view.getInt8(o);
      case 1: return view.getUint8(o);
      case 2: return view.getInt16(o, le);
      case 3: return view.getUint16(o, le);
      case 4: return view.getInt32(o, le);
      case 5: return view.getUint32(o, le);
      case 6: return view.getFloat32(o, le);
      default: return view.getFloat64(o, le);
    }
  };
  const s = new Scanner(bytes);
  s.pos = dataStart;
  const next = () => { const value = s.next(); if (!s.ok) throw cutShort(); return value; };
  const readItem = (el: Element, sinks: (ListSink | null)[]) => {
    const props = el.props;
    for (let k = 0; k < props.length; k++) {
      const prop = props[k], sink = sinks[k];
      if (prop.list) {
        let count: number;
        if (binary) {
          if (p + SIZES[prop.countType] > end) throw cutShort();
          count = get(prop.countType, p);
          p += SIZES[prop.countType];
          if (!(count >= 0) || p + count * SIZES[prop.type] > end) throw cutShort();
        } else {
          count = next();
          if (!(count >= 0 && Number.isInteger(count))) throw new Error(`PLY: a list has a length of ${count} (line ${s.line()})`);
          if (count > (end - s.pos + 1) / 2) throw cutShort(); // each value takes a character and a separator
        }
        if (sink) {
          const out = sink.values.room(count);
          let at = sink.values.n;
          if (binary) for (let j = 0; j < count; j++, p += SIZES[prop.type]) out[at++] = get(prop.type, p);
          else for (let j = 0; j < count; j++) out[at++] = next();
          sink.values.n = at;
          sink.lengths.push(count);
        } else if (binary) p += count * SIZES[prop.type];
        else for (let j = 0; j < count; j++) next();
      } else if (binary) {
        if (p + SIZES[prop.type] > end) throw cutShort();
        values[k] = get(prop.type, p);
        p += SIZES[prop.type];
      } else {
        values[k] = next();
      }
    }
  };

  for (const el of elements) {
    const sinks: (ListSink | null)[] = el.props.map(() => null);
    if (el === faceEl) {
      if (faceIndices >= 0) sinks[faceIndices] = { values: corners, lengths: sizes };
      if (faceTex >= 0) sinks[faceTex] = { values: texcoords, lengths: texSizes };
    }
    if (el === stripEl && stripIndices >= 0) sinks[stripIndices] = { values: strips, lengths: stripSizes };
    if (binary && el.props.every(prop => !prop.list)) {
      // Fixed-size items: read just the properties wanted, at their offsets.
      const stride = el.props.reduce((sum, prop) => sum + SIZES[prop.type], 0);
      if (p + el.count * stride > end) throw cutShort();
      if (el === vertexEl || (el === faceEl && faceTexNumber >= 0)) {
        const offsets: number[] = [];
        el.props.reduce((at, prop) => (offsets.push(at), at + SIZES[prop.type]), 0);
        const wanted = el === vertexEl ? [...new Set([x, y, z, nx, ny, nz, r, g, b, u, v].filter(k => k >= 0))] : [faceTexNumber];
        const types = wanted.map(k => el.props[k].type), at = wanted.map(k => offsets[k]), floats = types.every(type => type === 6);
        for (let i = 0; i < el.count; i++) {
          const base = p + i * stride;
          if (floats) for (let w = 0; w < wanted.length; w++) values[wanted[w]] = view.getFloat32(base + at[w], le);
          else for (let w = 0; w < wanted.length; w++) values[wanted[w]] = get(types[w], base + at[w]);
          if (el === vertexEl) store(i, values); else texNumbers.push(values[faceTexNumber]);
        }
      }
      p += el.count * stride;
      continue;
    }
    for (let i = 0; i < el.count; i++) {
      readItem(el, sinks);
      if (el === vertexEl) store(i, values);
      else if (el === faceEl && faceTexNumber >= 0) texNumbers.push(values[faceTexNumber]);
    }
  }

  // Colours as linear light: bytes and other integers by their range, floats as 0 to 1 (or 0 to 255 if any is past 1).
  if (colors) {
    const type = vertexEl.props[r].type;
    const curve = srgbCurve();
    if (splat) for (let i = 0; i < colors.length; i++) colors[i] = srgbFromTable(curve, 0.5 + 0.28209479 * colors[i]);
    else if (type === 1) { const table = srgbByteTable(); for (let i = 0; i < colors.length; i++) colors[i] = table[colors[i] & 255]; }
    else if (type < 6) for (let i = 0; i < colors.length; i++) colors[i] = srgbFromTable(curve, colors[i] / RANGES[type]);
    else linearizeColors(colors);
  }

  for (const list of [corners, strips]) {
    for (let i = 0; i < list.n; i++) {
      const index = list.a[i];
      if (index < 0 || index >= vc) {
        if (list === strips && index === -1) continue; // a strip restart
        throw new Error(`PLY: face refers to vertex ${index} of ${vc}`);
      }
    }
  }

  // MeshLab writes uvs a face corner (texcoord lists): corners with different uvs at one vertex become vertices of their own.
  let vertexPositions = positions, vertexNormals = normals, vertexColors = colors, faceCorners: Int32Array | Uint32Array = corners.a.subarray(0, corners.n);
  if (texcoords.n && texSizes.n === sizes.n) {
    const split = splitByUv(corners, sizes, texcoords, texSizes, vc);
    const pick = (data: Float32Array | null) => {
      if (!data) return null;
      const out = new Float32Array(split.source.length * 3);
      for (let e = 0; e < split.source.length; e++) { const o = split.source[e] * 3; out[e * 3] = data[o]; out[e * 3 + 1] = data[o + 1]; out[e * 3 + 2] = data[o + 2]; }
      return out;
    };
    vertexPositions = pick(positions)!;
    vertexNormals = pick(normals);
    vertexColors = pick(colors);
    uvs = split.uvs;
    faceCorners = split.corners;
  }

  const triangles = new GrowI32(corners.n + strips.n * 3 + 16), materialOf = new GrowI32(corners.n / 3 + strips.n + 16);
  const materialCount = Math.max(1, textures.length);
  for (let f = 0, at = 0; f < sizes.n; f++) {
    const size = sizes.a[f], number = texNumbers.n === sizes.n ? texNumbers.a[f] : 0;
    triangulate(faceCorners, at, size, vertexPositions, triangles, number >= 0 && number < materialCount ? number : 0, materialOf);
    at += size;
  }
  for (let st = 0, at = 0; st < stripSizes.n; st++) {
    // Strips run on until a -1; each triangle turns the other way from the last.
    const size = stripSizes.a[st];
    let run = 0;
    for (let k = 0; k < size; k++) {
      if (strips.a[at + k] < 0) { run = 0; continue; }
      if (++run < 3) continue;
      const c0 = strips.a[at + k - 2], c1 = strips.a[at + k - 1], c2 = strips.a[at + k];
      if (c0 === c1 || c1 === c2 || c0 === c2) continue;
      const o = triangles.room(3), n = triangles.n;
      if (run % 2) { o[n] = c0; o[n + 1] = c1; o[n + 2] = c2; } else { o[n] = c1; o[n + 1] = c0; o[n + 2] = c2; }
      triangles.n = n + 3;
      materialOf.push(0);
    }
    at += size;
  }

  const materials: ModelMaterial[] = textures.length
    ? textures.map((path, i) => {
      const clean = cleanPath(path), bytesOf = resources?.bytes(clean) ?? null;
      return { name: `texture ${i}`, color: [1, 1, 1, 1], emissive: [0, 0, 0], texture: newTexture(bytesOf, null, clean), doubleSided: false };
    })
    : [defaultMaterial('default', !!vertexColors)];
  const indices = new Uint32Array(triangles.n);
  indices.set(triangles.a.subarray(0, triangles.n));
  const grouped = groupTriangles(indices, materialOf.a, materials.length);
  return finishModel({
    positions: vertexPositions, normals: vertexNormals, colors: vertexColors, uvs, indices: grouped.indices, groups: grouped.groups,
    materials, up: 'y', format: 'ply',
  }, 'PLY');
}

/** One vertex per distinct (vertex, uv) pair over the face corners, the uvs taken from each face's texcoord list. */
function splitByUv(corners: GrowI32, sizes: GrowI32, texcoords: GrowF32, texSizes: GrowI32, vertexCount: number) {
  const n = corners.n, head = new Int32Array(vertexCount).fill(-1), link = new Int32Array(n), source = new Int32Array(n);
  const us = new Float32Array(n), vs = new Float32Array(n), remap = new Uint32Array(n);
  let count = 0;
  for (let f = 0, at = 0, tex = 0; f < sizes.n; f++) {
    const size = sizes.a[f], given = texSizes.a[f] === size * 2;
    for (let k = 0; k < size; k++) {
      const vertex = corners.a[at + k], cu = given ? texcoords.a[tex + k * 2] : 0, cv = given ? 1 - texcoords.a[tex + k * 2 + 1] : 0;
      let e = head[vertex];
      while (e >= 0 && !(us[e] === cu && vs[e] === cv)) e = link[e];
      if (e < 0) { e = count++; us[e] = cu; vs[e] = cv; source[e] = vertex; link[e] = head[vertex]; head[vertex] = e; }
      remap[at + k] = e;
    }
    at += size;
    tex += texSizes.a[f];
  }
  const uvs = new Float32Array(count * 2);
  for (let e = 0; e < count; e++) { uvs[e * 2] = us[e]; uvs[e * 2 + 1] = vs[e]; }
  return { corners: remap, source: source.subarray(0, count), uvs };
}
