import { describe, expect, it, vi } from 'vitest';
import { decodeModelTextures, loadModel, modelFormat, parseModel, withNormals } from './parse';
import type { AsciiModel } from './types';

// Small models built here: OBJ, MTL, ASCII STL and ASCII PLY as text; binary STL, binary PLY and GLB with typed arrays.

const text = (s: string) => new TextEncoder().encode(s);
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const triangleCount = (model: AsciiModel) => model.indices.length / 3;
const vertexCount = (model: AsciiModel) => model.positions.length / 3;
const vec = (array: ArrayLike<number> | null, i: number, size = 3) => Array.from({ length: size }, (_, c) => array![i * size + c]);
/** The geometric normal of triangle t (unnormalised), from its winding. */
const faceNormal = (model: AsciiModel, t: number) => {
  const [a, b, c] = [0, 1, 2].map(k => vec(model.positions, model.indices[t * 3 + k]));
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
};
const expectClose = (actual: ArrayLike<number>, expected: number[], digits = 5) => {
  expect(actual.length).toBe(expected.length);
  expected.forEach((value, i) => expect(actual[i]).toBeCloseTo(value, digits));
};
/** Every index is in range and every group is in range, a multiple of 3, and together they cover the indices once. */
const expectWellFormed = (model: AsciiModel) => {
  const n = vertexCount(model);
  for (const index of model.indices) expect(index).toBeLessThan(n);
  let covered = 0;
  for (const group of [...model.groups].sort((a, b) => a.start - b.start)) {
    expect(group.start).toBe(covered);
    expect(group.count % 3).toBe(0);
    expect(group.material).toBeLessThan(model.materials.length);
    covered += group.count;
  }
  expect(covered).toBe(model.indices.length);
  expect(model.materials.length).toBeGreaterThan(0);
  if (model.normals) for (let i = 0; i < n; i++) expect(Math.hypot(...vec(model.normals, i))).toBeCloseTo(1, 4);
};

// A unit cube from 0 to 1, as OBJ with quads (8 positions, 6 faces wound outwards).
const CUBE_OBJ = `
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 0 0 1
v 1 0 1
v 1 1 1
v 0 1 1
f 1 4 3 2
f 5 6 7 8
f 1 2 6 5
f 2 3 7 6
f 3 4 8 7
f 4 1 5 8
`;

const ASCII_STL_CUBE = (() => {
  const p = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  let out = 'solid cube\n';
  for (const [a, b, c, d] of quads) for (const tri of [[a, b, c], [a, c, d]]) {
    out += '  facet normal 0 0 0\n    outer loop\n';
    for (const v of tri) out += `      vertex ${p[v].join(' ')}\n`;
    out += '    endloop\n  endfacet\n';
  }
  return out + 'endsolid cube\n';
})();

function binaryStl(triangles: number[][][], header = 'binary stl', attributes: number[] = []): Uint8Array {
  const out = new Uint8Array(84 + 50 * triangles.length), view = new DataView(out.buffer);
  out.set(text(header).subarray(0, 80));
  view.setUint32(80, triangles.length, true);
  triangles.forEach((tri, t) => {
    const o = 84 + t * 50;
    tri.forEach((v, k) => v.forEach((x, c) => view.setFloat32(o + 12 + k * 12 + c * 4, x, true)));
    view.setUint16(o + 48, attributes[t] ?? 0, true);
  });
  return out;
}

/** A UV sphere as OBJ, with a uv seam (the first column repeated) and one vertex at each pole. */
function sphereObj(segments = 24, rings = 12): string {
  const lines: string[] = [];
  lines.push('v 0 1 0', 'vt 0.5 1');
  for (let r = 1; r < rings; r++) for (let s = 0; s <= segments; s++) {
    const theta = (r / rings) * Math.PI, phi = (s / segments) * Math.PI * 2;
    lines.push(`v ${Math.sin(theta) * Math.cos(phi)} ${Math.cos(theta)} ${Math.sin(theta) * Math.sin(phi)}`, `vt ${s / segments} ${1 - r / rings}`);
  }
  lines.push('v 0 -1 0', 'vt 0.5 0');
  const at = (r: number, s: number) => 2 + (r - 1) * (segments + 1) + s, bottom = 2 + (rings - 1) * (segments + 1);
  for (let s = 0; s < segments; s++) lines.push(`f 1/1 ${at(1, s + 1)}/${at(1, s + 1)} ${at(1, s)}/${at(1, s)}`);
  for (let r = 1; r < rings - 1; r++) for (let s = 0; s < segments; s++) {
    lines.push(`f ${at(r, s)}/${at(r, s)} ${at(r, s + 1)}/${at(r, s + 1)} ${at(r + 1, s + 1)}/${at(r + 1, s + 1)} ${at(r + 1, s)}/${at(r + 1, s)}`);
  }
  for (let s = 0; s < segments; s++) lines.push(`f ${bottom}/${bottom} ${at(rings - 1, s)}/${at(rings - 1, s)} ${at(rings - 1, s + 1)}/${at(rings - 1, s + 1)}`);
  return lines.join('\n');
}

// glTF: a buffer of typed arrays with its bufferViews and accessors, and a GLB around JSON and that buffer.

class GltfBuffer {
  private parts: Uint8Array[] = [];
  length = 0;
  bufferViews: Record<string, unknown>[] = [];
  accessors: Record<string, unknown>[] = [];
  view(data: ArrayBufferView, extra: Record<string, unknown> = {}): number {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) { this.parts.push(new Uint8Array(pad)); this.length += pad; }
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    this.parts.push(bytes);
    this.bufferViews.push({ buffer: 0, byteOffset: this.length, byteLength: bytes.length, ...extra });
    this.length += bytes.length;
    return this.bufferViews.length - 1;
  }
  accessor(data: ArrayBufferView, componentType: number, type: string, count: number, extra: Record<string, unknown> = {}, viewExtra: Record<string, unknown> = {}): number {
    this.accessors.push({ bufferView: this.view(data, viewExtra), componentType, type, count, ...extra });
    return this.accessors.length - 1;
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let o = 0;
    for (const part of this.parts) { out.set(part, o); o += part.length; }
    return out;
  }
}

function glb(json: Record<string, unknown>, bin: Uint8Array | null): Uint8Array {
  const pad = (bytes: Uint8Array, fill: number) => { const out = new Uint8Array(Math.ceil(bytes.length / 4) * 4).fill(fill); out.set(bytes); return out; };
  const body = pad(text(JSON.stringify(json)), 0x20), data = bin ? pad(bin, 0) : null;
  const total = 12 + 8 + body.length + (data ? 8 + data.length : 0), out = new Uint8Array(total), view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, total, true);
  view.setUint32(12, body.length, true); view.setUint32(16, 0x4e4f534a, true); out.set(body, 20);
  if (data) { const o = 20 + body.length; view.setUint32(o, data.length, true); view.setUint32(o + 4, 0x004e4942, true); out.set(data, o + 8); }
  return out;
}

/** One triangle in the xy plane, wound to face +z, with normals that lean +x (to see them mirrored). */
function triangleGltf(nodes: Record<string, unknown>[], extra: (b: GltfBuffer) => Record<string, unknown> = () => ({})) {
  const b = new GltfBuffer();
  const position = b.accessor(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 5126, 'VEC3', 3, { min: [0, 0, 0], max: [1, 1, 0] });
  const normal = b.accessor(new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]), 5126, 'VEC3', 3);
  const more = extra(b);
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes,
    meshes: [{ primitives: [{ attributes: { POSITION: position, NORMAL: normal } }] }],
    buffers: [{ byteLength: b.length }], bufferViews: b.bufferViews, accessors: b.accessors, ...more,
  };
  return glb({ ...json, buffers: [{ byteLength: b.length }] }, b.bytes());
}

describe('modelFormat', () => {
  it('tells formats by their signatures, then the name, then the text', () => {
    expect(modelFormat(glb({ asset: { version: '2.0' } }, null))).toBe('glb');
    expect(modelFormat(text('  {"asset": {"version": "2.0"}}'))).toBe('gltf');
    expect(modelFormat(text('{"nodes": []}'), 'scene.gltf')).toBe('gltf');
    expect(modelFormat(text('ply\nformat ascii 1.0\n'))).toBe('ply');
    expect(modelFormat(binaryStl([[[0, 0, 0], [1, 0, 0], [0, 1, 0]]], 'solid but binary'))).toBe('stl');
    expect(modelFormat(text(ASCII_STL_CUBE))).toBe('stl');
    expect(modelFormat(text(CUBE_OBJ))).toBe('obj');
    expect(modelFormat(text('# made by hand\n\nmtllib a.mtl\nv 1 2 3\n'))).toBe('obj');
    expect(modelFormat(text('just some words'), 'thing.obj')).toBe('obj');
    expect(modelFormat(text('just some words'))).toBeNull();
    expect(modelFormat(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });
});

describe('OBJ', () => {
  it('reads a cube of quads into 8 vertices and 12 triangles, without normals', () => {
    const model = parseModel(CUBE_OBJ);
    expect(model.format).toBe('obj');
    expect(model.up).toBe('y');
    expect(vertexCount(model)).toBe(8);
    expect(triangleCount(model)).toBe(12);
    expect(model.normals).toBeNull();
    expect(model.uvs).toBeNull();
    expect(model.colors).toBeNull();
    expectClose(model.bounds, [0, 0, 0, 1, 1, 1]);
    expect(model.groups).toEqual([{ start: 0, count: 36, material: 0 }]);
    expect(model.materials[0].color).toEqual([0.8, 0.8, 0.8, 1]);
    expectWellFormed(model);
    // Wound outwards, as written.
    for (let t = 0; t < 12; t++) {
      const n = faceNormal(model, t), centre = [0, 1, 2].map(c => [0, 1, 2].reduce((s, k) => s + model.positions[model.indices[t * 3 + k] * 3 + c], 0) / 3 - 0.5);
      expect(n[0] * centre[0] + n[1] * centre[1] + n[2] * centre[2]).toBeGreaterThan(0);
    }
  });

  it('reads every index form, relative indices, and makes one vertex per distinct triple', () => {
    const model = parseModel([
      'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0',
      'vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0.25 0.75',
      'vn 0 0 2', 'vn 0 0 -1',
      'f 1/1/1 2/2/1 3/3/1', // v/vt/vn
      'f -4/-4/-2 -2/-2/-2 -1/-1/-2', // relative: 1/1/1 3/3/1 4/4/1
      'f 1//2 3//2 2//2', // v//vn
      'f 1/4 2/2 3/3', // v/vt
    ].join('\n'));
    expect(triangleCount(model)).toBe(4);
    // Distinct triples: 1/1/1 2/2/1 3/3/1 4/4/1, 1//2 3//2 2//2, 1/4 (2/2 and 3/3 with no normal are new too).
    expect(vertexCount(model)).toBe(10);
    expectWellFormed(model);
    // v flipped: vt 0.25 0.75 is u 0.25, v 0.25 from the top.
    const corner = model.indices[9];
    expectClose(vec(model.uvs, corner, 2), [0.25, 0.25]);
    expectClose(vec(model.positions, corner), [0, 0, 0]);
    // The second face is the same as the first, through relative indices.
    expectClose(vec(model.positions, model.indices[3]), [0, 0, 0]);
    expectClose(vec(model.positions, model.indices[4]), [1, 1, 0]);
    expectClose(vec(model.positions, model.indices[5]), [0, 1, 0]);
    // vn 0 0 2 comes back unit length; corners with no vn get a normal from their faces.
    expectClose(vec(model.normals, model.indices[0]), [0, 0, 1]);
    expectClose(vec(model.normals, model.indices[6]), [0, 0, -1]);
    expect(Math.hypot(...vec(model.normals, corner))).toBeCloseTo(1);
  });

  it('reads vertex colours as sRGB, in 0–1 or 0–255', () => {
    const model = parseModel('v 0 0 0 1 0.5 0\nv 1 0 0 0 0 1\nv 0 1 0\nf 1 2 3\n');
    expect(model.colors).not.toBeNull();
    expectClose(vec(model.colors, 0), [1, linear(0.5), 0]);
    expectClose(vec(model.colors, 2), [1, 1, 1]); // a vertex with no colour is white
    expect(model.materials[0].color).toEqual([1, 1, 1, 1]); // white under vertex colours
    const bytes = parseModel('v 0 0 0 255 128 0\nv 1 0 0 0 0 255\nv 0 1 0 0 255 0\nf 1 2 3\n');
    expectClose(vec(bytes.colors, 0), [1, linear(128 / 255), 0]);
  });

  it('turns usemtl into groups and reads MTL colours, alpha, emission and textures', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1]);
    const mtl = [
      '# materials', 'newmtl red', 'Kd 1 0 0', 'd 0.5', 'Ke 0 0.5 0',
      'newmtl wood', 'Kd 0.5 0.5 0.5', 'Tr 0.25', 'map_Kd -s 1 1 1 -o 0.5 0 0 -bm 0.2 -clamp on textures\\wood grain.png',
      'newmtl ghost', 'Tr 1',
    ].join('\r\n');
    const model = parseModel([
      'mtllib scene.mtl', 'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0', 'vt 0 0', 'vt 1 0', 'vt 1 1',
      'f 1 2 3', 'usemtl red', 'f 1 3 4', 'usemtl wood', 'f 1/1 2/2 3/3', 'usemtl red', 'f 2 3 4', 'usemtl missing', 'f 3 4 1', 'usemtl ghost', 'f 4 1 2',
    ].join('\n'), { resources: { 'scene.mtl': mtl, 'textures/wood grain.png': png } });
    expectWellFormed(model);
    expect(model.materials.map(m => m.name)).toEqual(['default', 'red', 'wood', 'missing', 'ghost']);
    // One group a material, in the order they are first used; both red runs are one group.
    expect(model.groups.map(g => [g.material, g.count])).toEqual([[0, 3], [1, 6], [2, 3], [3, 3], [4, 3]]);
    const [none, red, wood, missing, ghost] = model.materials;
    expect(none.color).toEqual([0.8, 0.8, 0.8, 1]);
    expect(red.color).toEqual([1, 0, 0, 0.5]);
    expectClose(red.emissive, [0, linear(0.5), 0]);
    expectClose(wood.color, [linear(0.5), linear(0.5), linear(0.5), 0.75]);
    expect(wood.texture).toMatchObject({ uri: 'textures/wood grain.png', mimeType: 'image/png', wrap: 'clamp', image: null });
    expect(wood.texture!.bytes).toEqual(png);
    expect(missing.color).toEqual([0.8, 0.8, 0.8, 1]);
    expect(ghost.color[3]).toBe(1); // Tr 1 read as an exporter's mistake, not an invisible material
    expect(red.texture).toBeNull();
  });

  it('finds textures by name alone and keeps a missing one as a uri', () => {
    const mtl = 'newmtl a\nmap_Kd C:\\Users\\me\\Desktop\\Brick.PNG\nnewmtl b\nmap_Kd gone.jpg\n';
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const model = parseModel('mtllib m.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nusemtl a\nf 1 2 3\nusemtl b\nf 1 3 2\n', { resources: { 'm.mtl': mtl, 'brick.png': png } });
    expect(model.materials[0].texture!.bytes).toEqual(png);
    expect(model.materials[1].texture).toMatchObject({ bytes: null, uri: 'gone.jpg', mimeType: 'image/jpeg' });
    expect(model.materials[1].color).toEqual([1, 1, 1, 1]); // a textured material with no Kd shows its texture as it is
  });

  it('handles comments, CRLF, line continuations, o/g/s and tabs', () => {
    const model = parseModel('# a comment\r\no thing\r\ng part\r\ns 1\r\nv\t0 0 0 # inline\r\nv 1 0 0\r\nv 1 1 0\r\nv 0 1 \\\r\n 0\r\nf 1 2 \\\n 3 4\r\ns off\r\n');
    expect(vertexCount(model)).toBe(4);
    expect(triangleCount(model)).toBe(2);
    expectClose(model.bounds, [0, 0, 0, 1, 1, 0]);
  });

  it('cuts a concave polygon into triangles that stay inside it', () => {
    // An L of six corners, area 3: a fan from the first corner would cross outside it.
    const model = parseModel('v 0 0 0\nv 2 0 0\nv 2 1 0\nv 1 1 0\nv 1 2 0\nv 0 2 0\nf 2 3 4 5 6 1\n');
    expect(triangleCount(model)).toBe(4);
    let area = 0;
    for (let t = 0; t < 4; t++) {
      const n = faceNormal(model, t);
      expect(n[2]).toBeGreaterThan(0); // every piece keeps the polygon's winding
      area += n[2] / 2;
    }
    expect(area).toBeCloseTo(3);
  });

  it('splits a concave quad along its inside diagonal', () => {
    // A dart: the dent is at the second corner.
    const model = parseModel('v 0 0 0\nv 1 0.2 0\nv 2 0 0\nv 1 2 0\nf 1 2 3 4\n');
    let area = 0;
    for (let t = 0; t < 2; t++) { const n = faceNormal(model, t); expect(n[2]).toBeGreaterThan(0); area += n[2] / 2; }
    expect(area).toBeCloseTo(1.8);
  });

  it('reads vertices with no faces as a point cloud', () => {
    const model = parseModel('v 0 0 0 1 0 0\nv 1 2 3 0 1 0\nvn 0 1 0\nvn 1 0 0\n');
    expect(model.indices.length).toBe(0);
    expect(model.groups).toEqual([]);
    expect(vertexCount(model)).toBe(2);
    expectClose(model.bounds, [0, 0, 0, 1, 2, 3]);
    expectClose(vec(model.normals, 1), [1, 0, 0]);
  });

  it('says which index is out of range', () => {
    expect(() => parseModel('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\nf 1 2 120\n')).toThrow('OBJ: face refers to vertex 120 of 3 (line 5)');
    expect(() => parseModel('v 0 0 0\nf 1 -5 1\n')).toThrow(/^OBJ: face refers to vertex -5 of 1 \(line 2\)/);
    expect(() => parseModel('v 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nf 1/2 2/1 3/1\n', { name: 'bad.obj' })).toThrow('OBJ: face refers to texture coordinate 2 of 1 (bad.obj, line 5)');
    expect(() => parseModel('o nothing here\n', { format: 'obj' })).toThrow(/^OBJ: /);
  });
});

describe('STL', () => {
  it('reads ASCII STL, welding equal corners, z up and no normals', () => {
    const model = parseModel(ASCII_STL_CUBE);
    expect(model.format).toBe('stl');
    expect(model.up).toBe('z');
    expect(vertexCount(model)).toBe(8);
    expect(triangleCount(model)).toBe(12);
    expect(model.normals).toBeNull();
    expectClose(model.bounds, [0, 0, 0, 1, 1, 1]);
    expectWellFormed(model);
  });

  it('reads binary STL by its size even when the header says solid', () => {
    const tris = [[[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[1, 0, 0], [1, 1, 0], [0, 1, 0]], [[-0, 0, 0], [0, 1, 0], [0, 0, 5]]];
    const model = parseModel(binaryStl(tris, 'solid this is really binary'));
    expect(triangleCount(model)).toBe(3);
    expect(vertexCount(model)).toBe(5); // -0 and 0 are the same corner
    expectClose(model.bounds, [0, 0, 0, 1, 1, 5]);
    expect(model.colors).toBeNull();
  });

  it('reads VisCAM face colours and splits vertices between colours', () => {
    const red = 0x8000 | (31 << 10), blue = 0x8000 | 31;
    const model = parseModel(binaryStl([[[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[1, 0, 0], [1, 1, 0], [0, 1, 0]]], 'colours', [red, blue]));
    expect(vertexCount(model)).toBe(6);
    expectClose(vec(model.colors, model.indices[0]), [1, 0, 0]);
    expectClose(vec(model.colors, model.indices[3]), [0, 0, 1]);
    // Stray attribute values (no colour flag) are not colours.
    expect(parseModel(binaryStl([[[0, 0, 0], [1, 0, 0], [0, 1, 0]]], 'x', [1234])).colors).toBeNull();
  });

  it('refuses cut-short and empty files', () => {
    const good = binaryStl([[[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[1, 0, 0], [1, 1, 0], [0, 1, 0]]]);
    expect(() => parseModel(good.subarray(0, 120), { format: 'stl' })).toThrow(/^STL: the header says 2 triangles/);
    expect(() => parseModel(new Uint8Array(20), { format: 'stl' })).toThrow(/^STL: /);
    expect(() => parseModel('solid empty\nendsolid empty\n', { name: 'empty.stl' })).toThrow('STL: an ASCII STL with no facets (empty.stl)');
    const huge = new Uint8Array(200);
    new DataView(huge.buffer).setUint32(80, 0xffffffff, true);
    expect(() => parseModel(huge, { format: 'stl' })).toThrow(/^STL: the header says 4294967295 triangles/);
  });
});

describe('PLY', () => {
  it('reads ASCII PLY with colours, normals, uvs and polygons', () => {
    const model = parseModel([
      'ply', 'format ascii 1.0', 'comment made by hand', 'element vertex 4',
      'property float x', 'property float y', 'property float z', 'property float nx', 'property float ny', 'property float nz',
      'property uchar red', 'property uchar green', 'property uchar blue', 'property float s', 'property float t',
      'element face 1', 'property list uchar int vertex_indices', 'end_header',
      '0 0 0 0 0 1 255 0 0 0 0', '1 0 0 0 0 1 0 255 0 1 0', '1 1 0 0 0 1 0 0 255 1 1', '0 1 0 0 0 1 128 128 128 0 1',
      '4 0 1 2 3',
    ].join('\n'));
    expect(model.format).toBe('ply');
    expect(model.up).toBe('y');
    expect(vertexCount(model)).toBe(4);
    expect(triangleCount(model)).toBe(2);
    expectClose(vec(model.colors, 0), [1, 0, 0]);
    expectClose(vec(model.colors, 3), [linear(128 / 255), linear(128 / 255), linear(128 / 255)]);
    expectClose(vec(model.normals, 2), [0, 0, 1]);
    expectClose(vec(model.uvs, 2, 2), [1, 0]); // t up from the bottom, flipped
    expectWellFormed(model);
  });

  it('reads binary PLY in both byte orders, any types, skipping other elements', () => {
    for (const le of [true, false]) {
      const header = [
        'ply', `format binary_${le ? 'little' : 'big'}_endian 1.0`,
        'element material 2', 'property uchar ambient', 'property float shine',
        'element vertex 3', 'property double x', 'property double y', 'property double z', 'property int16 flags', 'property ushort red', 'property ushort green', 'property ushort blue',
        'element edge 1', 'property list uint8 int32 path', 'property char kind',
        'element face 1', 'property uchar intensity', 'property list ushort uint vertex_index',
        'end_header', '',
      ].join('\n');
      const data = new DataView(new ArrayBuffer(2 * 5 + 3 * 32 + (1 + 8 + 1) + (1 + 2 + 12)));
      let o = 0;
      for (let m = 0; m < 2; m++) { data.setUint8(o, 9); data.setFloat32(o + 1, 0.5, le); o += 5; }
      const points = [[0, 0, 0], [2, 0, 0], [0, 3, -1]];
      for (const [x, y, z] of points) {
        data.setFloat64(o, x, le); data.setFloat64(o + 8, y, le); data.setFloat64(o + 16, z, le); data.setInt16(o + 24, -7, le);
        data.setUint16(o + 26, 65535, le); data.setUint16(o + 28, 0, le); data.setUint16(o + 30, 65535, le);
        o += 32;
      }
      data.setUint8(o, 2); data.setInt32(o + 1, 5, le); data.setInt32(o + 5, 6, le); data.setInt8(o + 9, 1); o += 10;
      data.setUint8(o, 200); data.setUint16(o + 1, 3, le); data.setUint32(o + 3, 0, le); data.setUint32(o + 7, 1, le); data.setUint32(o + 11, 2, le);
      const bytes = new Uint8Array(header.length + data.byteLength);
      bytes.set(text(header));
      bytes.set(new Uint8Array(data.buffer), header.length);
      const model = parseModel(bytes);
      expect(vertexCount(model)).toBe(3);
      expect(triangleCount(model)).toBe(1);
      expectClose(model.bounds, [0, 0, -1, 2, 3, 0]);
      expectClose(vec(model.colors, 1), [1, 0, 1]);
      expect(Array.from(model.indices)).toEqual([0, 1, 2]);
    }
  });

  it('reads faces that come before the vertices, and tristrips', () => {
    const model = parseModel('ply\nformat ascii 1.0\nelement face 1\nproperty list uchar uint vertex_indices\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nend_header\n3 0 1 2\n0 0 0\n1 0 0\n0 1 0\n');
    expect(triangleCount(model)).toBe(1);
    const strips = parseModel('ply\nformat ascii 1.0\nelement vertex 5\nproperty float x\nproperty float y\nproperty float z\nelement tristrips 1\nproperty list int int vertex_indices\nend_header\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n2 1 0\n6 0 1 2 3 -1 4\n');
    expect(triangleCount(strips)).toBe(2);
    for (let t = 0; t < 2; t++) expect(faceNormal(strips, t)[2]).toBeGreaterThan(0);
  });

  it('reads a point cloud and a Gaussian splat', () => {
    const cloud = parseModel('ply\nformat ascii 1.0\nelement vertex 2\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n1 1 1\n');
    expect(cloud.indices.length).toBe(0);
    expect(cloud.groups).toEqual([]);
    expect(cloud.materials.length).toBe(1);
    const values = [[0, 0, 0, 0, 0, 0, 1, -1, 0, 0.3], [1, 2, 3, 0, 0, 0, -10, 10, 0, -2]];
    const header = 'ply\nformat binary_little_endian 1.0\nelement vertex 2\n' + ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity'].map(p => `property float ${p}\n`).join('') + 'end_header\n';
    const bytes = new Uint8Array(header.length + 80);
    bytes.set(text(header));
    const view = new DataView(bytes.buffer, header.length);
    values.flat().forEach((v, i) => view.setFloat32(i * 4, v, true));
    const splat = parseModel(bytes);
    expect(splat.indices.length).toBe(0);
    expect(splat.normals).toBeNull(); // all zero in splat files
    const dc = (f: number) => linear(Math.min(1, Math.max(0, 0.5 + 0.28209479 * f)));
    expectClose(vec(splat.colors, 0), [dc(1), dc(-1), dc(0)]);
    expectClose(vec(splat.colors, 1), [0, 1, dc(0)]);
  });

  it('reads MeshLab texture coordinates per face corner, with their texture', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const model = parseModel([
      'ply', 'format ascii 1.0', 'comment TextureFile skin.png', 'element vertex 4', 'property float x', 'property float y', 'property float z',
      'element face 2', 'property list uchar int vertex_indices', 'property list uchar float texcoord', 'end_header',
      '0 0 0', '1 0 0', '1 1 0', '0 1 0', '3 0 1 2 6 0 0 1 0 1 1', '3 0 2 3 6 0.5 0 1 1 0 1',
    ].join('\n'), { resources: { 'skin.png': png } });
    expect(triangleCount(model)).toBe(2);
    expect(vertexCount(model)).toBe(5); // vertex 0 has two different uvs
    expect(model.materials[0].texture).toMatchObject({ uri: 'skin.png', mimeType: 'image/png' });
    expect(model.materials[0].texture!.bytes).toEqual(png);
    expectClose(vec(model.uvs, model.indices[3], 2), [0.5, 1]);
  });

  it('says what is wrong with a broken file', () => {
    const head = 'ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n';
    expect(() => parseModel(head + '0 0 0\n1 0 0\n0 1 0\n3 0 1 7\n')).toThrow('PLY: face refers to vertex 7 of 3');
    expect(() => parseModel(head + '0 0 0\n1 0 0\n0 1 0\n3 0 1\n')).toThrow(/^PLY: the data ends early/);
    expect(() => parseModel('ply\nformat binary_little_endian 1.0\nelement vertex 1000000000\nproperty float x\nproperty float y\nproperty float z\nend_header\n\0\0\0\0')).toThrow(/^PLY: the header promises/);
    expect(() => parseModel('ply\nformat ascii 1.0\nelement vertex 1\nproperty quaternion x\nend_header\n1\n')).toThrow(/^PLY: unknown property type/);
    expect(() => parseModel('ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\n')).toThrow('PLY: the header has no end_header');
  });
});

describe('glTF', () => {
  it('reads a GLB with normals, colours, uvs, indices and a textured material', () => {
    const b = new GltfBuffer();
    const position = b.accessor(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 5126, 'VEC3', 4);
    const normal = b.accessor(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 5126, 'VEC3', 4);
    const color = b.accessor(new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]), 5121, 'VEC4', 4, { normalized: true });
    const uv = b.accessor(new Float32Array([0, 0, 1, 0, 1, 1, 0.5, 0.5]), 5126, 'VEC2', 4);
    const index = b.accessor(new Uint16Array([0, 1, 2, 0, 2, 3]), 5123, 'SCALAR', 6);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 7]);
    const image = b.view(png);
    const model = parseModel(glb({
      asset: { version: '2.0' }, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: position, NORMAL: normal, COLOR_0: color, TEXCOORD_0: uv }, indices: index, material: 0 }] }],
      materials: [{
        name: 'painted', doubleSided: true, alphaMode: 'BLEND', emissiveFactor: [1, 0.5, 0],
        extensions: { KHR_materials_emissive_strength: { emissiveStrength: 2 } },
        pbrMetallicRoughness: { baseColorFactor: [0.5, 0.25, 1, 0.5], baseColorTexture: { index: 0, extensions: { KHR_texture_transform: { offset: [0.1, 0.2], scale: [2, 2] } } } },
      }],
      textures: [{ source: 0, sampler: 0 }], samplers: [{ wrapS: 33648 }], images: [{ bufferView: image, mimeType: 'image/png' }],
      buffers: [{ byteLength: b.length }], bufferViews: b.bufferViews, accessors: b.accessors,
    }, b.bytes()));
    expect(model.format).toBe('glb');
    expect(model.up).toBe('y');
    expect(vertexCount(model)).toBe(4);
    expect(triangleCount(model)).toBe(2);
    expectClose(vec(model.colors, 1), [0, 1, 0]); // already linear: not converted
    expectClose(vec(model.normals, 0), [0, 0, 1]);
    expectClose(vec(model.uvs, 3, 2), [1.1, 1.2]); // KHR_texture_transform baked in
    const [material] = model.materials;
    expect(material.name).toBe('painted');
    expect(material.color).toEqual([0.5, 0.25, 1, 0.5]);
    expect(material.emissive).toEqual([2, 1, 0]);
    expect(material.doubleSided).toBe(true);
    expect(material.texture).toMatchObject({ mimeType: 'image/png', uri: null, wrap: 'mirror', image: null });
    expect(material.texture!.bytes).toEqual(png);
    expectWellFormed(model);
  });

  it('ignores the alpha of an opaque material and gives primitives with none the default', () => {
    const b = new GltfBuffer();
    const position = b.accessor(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 5126, 'VEC3', 3);
    const model = parseModel(glb({
      asset: { version: '2.0' }, nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: position }, material: 0 }, { attributes: { POSITION: position } }] }],
      materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 0.2] } }],
      buffers: [{ byteLength: b.length }], bufferViews: b.bufferViews, accessors: b.accessors,
    }, b.bytes()));
    expect(model.materials.map(m => m.color)).toEqual([[1, 0, 0, 1], [1, 1, 1, 1]]);
    expect(model.groups.map(g => g.material)).toEqual([0, 1]);
    expect(model.normals).toBeNull();
  });

  it('gives no emission to a material whose emission comes from a texture (not sampled)', () => {
    const b = new GltfBuffer();
    const position = b.accessor(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 5126, 'VEC3', 3);
    const model = parseModel(glb({
      asset: { version: '2.0' }, nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: position }, material: 0 }, { attributes: { POSITION: position }, material: 1 }] }],
      materials: [
        // As DamagedHelmet.glb has it: a full factor that only scales its emissive map.
        { emissiveFactor: [1, 1, 1], emissiveTexture: { index: 0 }, extensions: { KHR_materials_emissive_strength: { emissiveStrength: 5 } } },
        { emissiveFactor: [0.5, 0.25, 0] },
      ],
      textures: [{ source: 0 }], images: [{ uri: 'emissive.png' }],
      buffers: [{ byteLength: b.length }], bufferViews: b.bufferViews, accessors: b.accessors,
    }, b.bytes()));
    expect(model.materials.map(m => m.emissive)).toEqual([[0, 0, 0], [0.5, 0.25, 0]]);
  });

  it('applies node transforms down the tree, once per node, flipping mirrored triangles', () => {
    const half = Math.SQRT1_2;
    const model = parseModel(triangleGltf([
      { mesh: 0, translation: [10, 0, 0] },
      { mesh: 0, scale: [-1, 1, 1] },
      { mesh: 0, rotation: [0, 0, half, half] },
      { translation: [0, 5, 0], children: [4] },
      { mesh: 0, scale: [2, 2, 2] },
      { mesh: 0, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1] },
    ], () => ({ scenes: [{ nodes: [0, 1, 2, 3, 5] }] })));
    expect(triangleCount(model)).toBe(5);
    expect(vertexCount(model)).toBe(15);
    expectClose(vec(model.positions, 1), [11, 0, 0]); // translated
    expectClose(vec(model.positions, 4), [-1, 0, 0]); // mirrored
    expectClose(vec(model.positions, 7), [0, 1, 0]); // turned 90° about z
    expectClose(vec(model.positions, 10), [2, 5, 0]); // scaled inside a translated parent
    expectClose(vec(model.positions, 13), [2, 2, 3]); // a matrix
    // Every copy still faces +z, the mirrored one through its flipped winding.
    for (let t = 0; t < 5; t++) expect(faceNormal(model, t)[2]).toBeGreaterThan(0);
    // Normals follow: mirrored in x, turned with the rotation, kept unit length under scale.
    expectClose(vec(model.normals, 0), [1, 0, 0]);
    expectClose(vec(model.normals, 3), [-1, 0, 0]);
    expectClose(vec(model.normals, 6), [0, 1, 0]);
    expectClose(vec(model.normals, 9), [1, 0, 0]);
    expectClose(model.bounds, [-1, 0, 0, 11, 7, 3]);
  });

  it('reads base64 data: URIs and external buffers given as resources', () => {
    const b = new GltfBuffer();
    const position = b.accessor(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 5126, 'VEC3', 3);
    const data = b.bytes();
    const json = (uri: string) => JSON.stringify({
      asset: { version: '2.0' }, nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: position } }] }],
      buffers: [{ uri, byteLength: data.length }], bufferViews: b.bufferViews, accessors: b.accessors,
    });
    const embedded = parseModel(json(`data:application/octet-stream;base64,${Buffer.from(data).toString('base64')}`));
    expect(embedded.format).toBe('gltf');
    expectClose(embedded.bounds, [0, 0, 0, 1, 1, 0]);
    const external = parseModel(json('mesh%20data.bin'), { resources: { 'mesh data.bin': data } });
    expect(Array.from(external.positions)).toEqual(Array.from(embedded.positions));
    expect(() => parseModel(json('mesh.bin'), { name: 'scene.gltf' })).toThrow('glTF: buffer 0 (mesh.bin) was not given; pass it in `resources`, or load the model with loadModel (scene.gltf)');
  });

  it('reads sparse accessors, strides and quantized attributes', () => {
    const b = new GltfBuffer();
    // int16 positions padded to 8 bytes a vertex (KHR_mesh_quantization), normals as normalized int8.
    const positions = new Int16Array([0, 0, 0, 0, 100, 0, 0, 0, 0, 100, 0, 0]);
    const position = b.accessor(positions, 5122, 'VEC3', 3, {}, { byteStride: 8 });
    const normal = b.accessor(new Int8Array([0, 0, 127, 0, -128, 0, 0, 0, 0, 127, 0, 0]), 5120, 'VEC3', 3, { normalized: true }, { byteStride: 4 });
    const sparseIndices = b.view(new Uint8Array([2])), sparseValues = b.view(new Int16Array([0, 0, 50]));
    b.accessors[position] = { ...b.accessors[position], sparse: { count: 1, indices: { bufferView: sparseIndices, componentType: 5121 }, values: { bufferView: sparseValues } } };
    const model = parseModel(glb({
      asset: { version: '2.0' }, extensionsRequired: ['KHR_mesh_quantization'], extensionsUsed: ['KHR_mesh_quantization'],
      nodes: [{ mesh: 0, scale: [0.01, 0.01, 0.01] }], meshes: [{ primitives: [{ attributes: { POSITION: position, NORMAL: normal } }] }],
      buffers: [{ byteLength: b.length }], bufferViews: b.bufferViews, accessors: b.accessors,
    }, b.bytes()));
    expectClose(vec(model.positions, 1), [1, 0, 0]);
    expectClose(vec(model.positions, 2), [0, 0, 0.5]); // the sparse value replaced (0, 100, 0)
    expectClose(vec(model.normals, 0), [0, 0, 1]);
    expectClose(vec(model.normals, 1), [-1, 0, 0]); // -128 clamps to -1
  });

  it('turns strips and fans into triangles that keep their facing', () => {
    const b = new GltfBuffer();
    const strip = b.accessor(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 2, 0]), 5126, 'VEC3', 5);
    const fan = b.accessor(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, -1, 0, 0]), 5126, 'VEC3', 4);
    const model = parseModel(glb({
      asset: { version: '2.0' }, nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: strip }, mode: 5 }, { attributes: { POSITION: fan }, mode: 6 }] }],
      buffers: [{ byteLength: b.length }], bufferViews: b.bufferViews, accessors: b.accessors,
    }, b.bytes()));
    expect(triangleCount(model)).toBe(3 + 2);
    for (let t = 0; t < 5; t++) expect(faceNormal(model, t)[2]).toBeGreaterThan(0);
  });

  it('keeps points only when nothing has triangles', () => {
    const b = new GltfBuffer();
    const cloud = b.accessor(new Float32Array([0, 0, 0, 1, 1, 1, 2, 0, 2]), 5126, 'VEC3', 3);
    const tri = b.accessor(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 5126, 'VEC3', 3);
    const doc = (primitives: unknown[]) => glb({
      asset: { version: '2.0' }, nodes: [{ mesh: 0 }], meshes: [{ primitives }],
      buffers: [{ byteLength: b.length }], bufferViews: b.bufferViews, accessors: b.accessors,
    }, b.bytes());
    const points = parseModel(doc([{ attributes: { POSITION: cloud }, mode: 0 }]));
    expect(vertexCount(points)).toBe(3);
    expect(points.indices.length).toBe(0);
    expect(points.groups).toEqual([]);
    const mixed = parseModel(doc([{ attributes: { POSITION: cloud }, mode: 0 }, { attributes: { POSITION: tri } }]));
    expect(vertexCount(mixed)).toBe(3);
    expect(triangleCount(mixed)).toBe(1);
    expectClose(mixed.bounds, [0, 0, 0, 1, 1, 0]);
  });

  it('draws every root node when there is no scene, and instances with EXT_mesh_gpu_instancing', () => {
    const b = new GltfBuffer();
    const position = b.accessor(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 5126, 'VEC3', 3);
    const offsets = b.accessor(new Float32Array([0, 0, 0, 0, 0, 10, 0, 0, 20]), 5126, 'VEC3', 3);
    const model = parseModel(glb({
      asset: { version: '2.0' },
      nodes: [{ children: [1] }, { mesh: 0, extensions: { EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: offsets } } } }, { mesh: 0, translation: [5, 0, 0] }],
      meshes: [{ primitives: [{ attributes: { POSITION: position } }] }],
      buffers: [{ byteLength: b.length }], bufferViews: b.bufferViews, accessors: b.accessors,
    }, b.bytes()));
    expect(triangleCount(model)).toBe(4);
    expectClose(model.bounds, [0, 0, 0, 6, 1, 20]);
  });

  it('refuses compressed meshes with a way out', () => {
    for (const name of ['KHR_draco_mesh_compression', 'EXT_meshopt_compression']) {
      const doc = { asset: { version: '2.0' }, extensionsUsed: [name], extensionsRequired: [name], meshes: [] };
      expect(() => parseModel(JSON.stringify(doc))).toThrow(new RegExp(`^glTF: .*${name}.*re-export it without mesh compression`));
      expect(() => parseModel(glb(doc, null))).toThrow(/^glTF: /);
    }
    // Other required extensions it does not know are let through.
    const b = new GltfBuffer();
    const position = b.accessor(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 5126, 'VEC3', 3);
    expect(triangleCount(parseModel(glb({
      asset: { version: '2.0' }, extensionsRequired: ['KHR_materials_volume'], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: position } }] }],
      buffers: [{ byteLength: b.length }], bufferViews: b.bufferViews, accessors: b.accessors,
    }, b.bytes())))).toBe(1);
  });

  it('says what is wrong with a broken file', () => {
    const good = triangleGltf([{ mesh: 0 }]);
    expect(() => parseModel(good.subarray(0, 60))).toThrow(/^glTF: /);
    const b = new GltfBuffer();
    const position = b.accessor(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 5126, 'VEC3', 3);
    const doc = (accessors: unknown[], extra: Record<string, unknown> = {}) => glb({
      asset: { version: '2.0' }, nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, ...extra }] }],
      buffers: [{ byteLength: b.length }], bufferViews: b.bufferViews, accessors,
    }, b.bytes());
    expect(() => parseModel(doc([{ ...b.accessors[position], count: 30 }]))).toThrow('glTF: accessor 0 (POSITION) reads past the end of its bufferView');
    expect(() => parseModel(doc([{ componentType: 5126, type: 'VEC3', count: 1e9 }]))).toThrow(/^glTF: .*1000000000/);
    expect(() => parseModel(doc([{ componentType: 5126, type: 'VEC3', count: 2e6 }]))).toThrow('glTF: accessor 0 (POSITION) holds 2000000 values with no data behind them');
    expect(() => parseModel(doc([b.accessors[position], { bufferView: 0, byteOffset: 12, componentType: 5125, type: 'SCALAR', count: 3 }], { indices: 1 }))).toThrow(/^glTF: a primitive refers to vertex \d+ of 3/);
    expect(() => parseModel(text('{"asset": {"version": "1.0"}}'))).toThrow(/^glTF: this is glTF 1.0/);
    expect(() => parseModel(text('{"asset": '), { format: 'gltf' })).toThrow(/^glTF: the JSON does not parse/);
  });
});

describe('withNormals', () => {
  it('keeps a cube sharp: 24 vertices, each facing out of its side', () => {
    for (const cube of [parseModel(CUBE_OBJ), parseModel(ASCII_STL_CUBE)]) {
      const lit = withNormals(cube);
      expect(vertexCount(lit)).toBe(24);
      expect(triangleCount(lit)).toBe(12);
      expect(lit.groups).toEqual(cube.groups);
      expectWellFormed(lit);
      for (let t = 0; t < 12; t++) {
        const n = faceNormal(lit, t), len = Math.hypot(...n);
        for (let k = 0; k < 3; k++) expectClose(vec(lit.normals, lit.indices[t * 3 + k]), n.map(v => v / len));
      }
      expect(cube.normals).toBeNull(); // the model given is not changed
    }
  });

  it('keeps a sphere smooth, across its uv seam', () => {
    const sphere = parseModel(sphereObj());
    const lit = withNormals(sphere);
    expect(vertexCount(lit)).toBe(vertexCount(sphere));
    for (let i = 0; i < vertexCount(lit); i++) {
      const p = vec(lit.positions, i), n = vec(lit.normals, i), len = Math.hypot(...p);
      expect((p[0] * n[0] + p[1] * n[1] + p[2] * n[2]) / len).toBeGreaterThan(0.99);
    }
    expect(lit.uvs).not.toBeNull();
    expectWellFormed(lit);
  });

  it('follows the crease angle, and carries colours over', () => {
    const cube = parseModel(CUBE_OBJ.replace(/^v (.*)$/gm, 'v $1 1 0 0'));
    expect(vertexCount(withNormals(cube, 100))).toBe(8); // everything within 100° is smoothed together
    const lit = withNormals(cube);
    expect(vertexCount(lit)).toBe(24);
    for (let i = 0; i < 24; i++) expectClose(vec(lit.colors, i), [1, 0, 0]);
  });

  it('leaves models with normals and point clouds as they are', () => {
    const cloud = parseModel('v 0 0 0\nv 1 1 1\n');
    expect(withNormals(cloud).normals).toBeNull();
    const withOwn = parseModel(triangleGltf([{ mesh: 0 }]));
    expect(withNormals(withOwn).normals).toBe(withOwn.normals);
  });
});

describe('decodeModelTextures', () => {
  it('decodes each texture once and leaves those it cannot', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const model = parseModel('mtllib m.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nusemtl a\nf 1/1 2/1 3/1\nusemtl b\nf 1/1 3/1 2/1\nusemtl c\nf 2/1 3/1 1/1\n', {
      resources: { 'm.mtl': 'newmtl a\nmap_Kd t.png\nnewmtl b\nmap_Kd broken.png\nnewmtl c\nKd 1 1 1\n', 't.png': png, 'broken.png': new Uint8Array([1, 2, 3]) },
    });
    const decode = vi.fn((bytes: Uint8Array) => (bytes[0] === 0x89 ? { width: 1, height: 1, data: new Uint8Array([255, 0, 0, 255]) } : null));
    const decoded = decodeModelTextures(model, decode);
    expect(decode).toHaveBeenCalledTimes(2);
    expect(decoded.materials[0].texture!.image).toEqual({ width: 1, height: 1, data: new Uint8Array([255, 0, 0, 255]) });
    expect(decoded.materials[1].texture!.image).toBeNull();
    expect(model.materials[0].texture!.image).toBeNull(); // the model given is not changed
    expect(decodeModelTextures(model, () => { throw new Error('no'); }).materials[0].texture!.image).toBeNull();
  });
});

describe('loadModel', () => {
  it('reads a glTF with its external buffer and image, from paths resolved against the model', async () => {
    const b = new GltfBuffer();
    const position = b.accessor(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 5126, 'VEC3', 3);
    const uv = b.accessor(new Float32Array([0, 0, 1, 0, 0, 1]), 5126, 'VEC2', 3);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const files: Record<string, Uint8Array> = {
      'models/duck.gltf': text(JSON.stringify({
        asset: { version: '2.0' }, nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: position, TEXCOORD_0: uv }, material: 0 }] }],
        materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } }, normalTexture: { index: 1 } }],
        textures: [{ source: 0 }, { source: 1 }], images: [{ uri: 'textures/duck%20skin.png' }, { uri: 'textures/normals.png' }],
        buffers: [{ uri: '../shared/duck.bin', byteLength: b.length }], bufferViews: b.bufferViews, accessors: b.accessors,
      })),
      'shared/duck.bin': b.bytes(),
      'models/textures/duck skin.png': png,
    };
    const read = vi.fn(async (path: string) => { if (!files[path]) throw new Error(`no ${path}`); return files[path]; });
    const model = await loadModel('models/duck.gltf', { read });
    // The normal map is not drawn, so not fetched.
    expect(read.mock.calls.map(call => call[0]).sort()).toEqual(['models/duck.gltf', 'models/textures/duck skin.png', 'shared/duck.bin']);
    expect(triangleCount(model)).toBe(1);
    expect(model.materials[0].texture).toMatchObject({ uri: 'textures/duck%20skin.png', mimeType: 'image/png' });
    expect(model.materials[0].texture!.bytes).toEqual(png);
  });

  it('fetches against a URL, and an OBJ with its MTL and texture', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const files: Record<string, string | Uint8Array> = {
      'https://example.com/m/chair.obj?v=2': 'mtllib chair parts.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nusemtl wood\nf 1/1 2/1 3/1\nusemtl legs\nf 1/1 3/1 2/1\n',
      'https://example.com/m/chair%20parts.mtl': 'newmtl wood\nKd 1 1 1\nmap_Kd -s 2 2 tex/oak.png\nnewmtl legs\nmap_Kd tex/oak.png\n',
      'https://example.com/m/tex/oak.png': png,
    };
    const fetch = vi.fn(async (url: string | URL | Request) => {
      const body = files[String(url)];
      return body === undefined ? new Response('missing', { status: 404 }) : new Response(typeof body === 'string' ? body : body.slice().buffer);
    });
    const model = await loadModel(new URL('https://example.com/m/chair.obj?v=2'), { fetch: fetch as unknown as typeof globalThis.fetch });
    expect(model.format).toBe('obj');
    expect(model.materials[0].name).toBe('wood');
    expect(model.materials[0].texture!.bytes).toEqual(png);
    expect(model.materials[0].texture!.uri).toBe('tex/oak.png');
    expect(model.materials[1].texture!.bytes).toEqual(png);
    // One request a file, though two materials use the texture.
    expect(fetch.mock.calls.map(call => String(call[0])).sort()).toEqual(['https://example.com/m/chair%20parts.mtl', 'https://example.com/m/chair.obj?v=2', 'https://example.com/m/tex/oak.png']);
  });

  it('reads Blobs and bytes, and says when a buffer cannot be read', async () => {
    const stl = binaryStl([[[0, 0, 0], [1, 0, 0], [0, 1, 0]]]);
    const fromFile = await loadModel(new File([stl.slice().buffer], 'part.stl'));
    expect(fromFile.format).toBe('stl');
    const fromBytes = await loadModel(stl.slice().buffer, { name: 'part.stl' });
    expect(triangleCount(fromBytes)).toBe(1);
    const gltf = JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'gone.bin', byteLength: 4 }] });
    await expect(loadModel(text(gltf), { name: 'scene.gltf', read: async () => { throw new Error('404'); } })).rejects.toThrow('glTF: could not read buffer gone.bin (404)');
    await expect(loadModel('https://example.com/x.glb', { fetch: (async () => new Response('', { status: 500 })) as unknown as typeof fetch })).rejects.toThrow(/^loadModel: could not read https:\/\/example.com\/x.glb \(500/);
  });
});

describe('corrupt input', () => {
  // Random damage to good files: every parse either works or throws an Error naming the format, and none hangs.
  const samples: [string, Uint8Array][] = [
    ['OBJ', text(CUBE_OBJ + 'vt 0 0\nvn 0 1 0\nusemtl x\nf 1/1/1 2/1/1 3/1/1\n')],
    ['STL', binaryStl([[[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[1, 0, 0], [1, 1, 0], [0, 1, 0]]])],
    ['STL', text(ASCII_STL_CUBE)],
    ['PLY', text('ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n')],
    ['glTF', triangleGltf([{ mesh: 0, translation: [1, 2, 3] }, { mesh: 0 }])],
  ];
  let seed = 12345;
  const random = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  for (const [label, good] of samples) {
    it(`${label} files with random damage throw ${label} errors`, () => {
      const format = label === 'glTF' ? 'glb' : (label.toLowerCase() as 'obj' | 'stl' | 'ply');
      for (let round = 0; round < 300; round++) {
        const bad = good.slice(0, round % 7 === 0 ? Math.floor(random() * good.length) : good.length);
        for (let k = 0, hits = 1 + Math.floor(random() * 8); k < hits && bad.length; k++) bad[Math.floor(random() * bad.length)] = Math.floor(random() * 256);
        try {
          const model = parseModel(bad, { format });
          expectWellFormed(model);
          expect(model.bounds.every(v => Number.isFinite(v))).toBe(true);
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).message.startsWith(`${label}: `)).toBe(true);
        }
      }
    });
  }

  it('refuses data that is no model at all', () => {
    expect(() => parseModel(new Uint8Array([0, 1, 2, 3, 4, 5]))).toThrow(/^Not a model asciify-engine can read/);
    expect(() => parseModel(new Uint8Array(64), { format: 'gltf' })).toThrow(/^glTF: /);
    expect(() => parseModel(new Uint8Array(64), { format: 'ply' })).toThrow(/^PLY: /);
    expect(() => parseModel(new Uint8Array(64), { format: 'obj' })).toThrow(/^OBJ: /);
  });
});
