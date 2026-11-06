/**
 * A 3D model as `asciify-engine/model` draws it: one shared vertex array and triangles (or, with no triangles, a point
 * cloud), whatever file it came from. Parsers (parse.ts) fill it; renderers (render.ts in any runtime, gl.ts in the browser)
 * draw it.
 */
export interface AsciiModel {
  /** x, y, z for each vertex, in the file's own units (drawings are framed to the model's bounds). */
  positions: Float32Array;
  /** A unit normal for each vertex (x, y, z), or null to have them worked out from the triangles. */
  normals: Float32Array | null;
  /** A colour for each vertex: linear r, g, b, 0 to 1. Null when the file has none. */
  colors: Float32Array | null;
  /** u, v for each vertex (glTF's convention: v down from the top of the image), or null. */
  uvs: Float32Array | null;
  /** Triangles, three vertex indices each. Empty for a point cloud. */
  indices: Uint32Array;
  /** Runs of `indices` (in indices, not triangles) drawn with one material. Covers every index; empty for a point cloud. */
  groups: ModelGroup[];
  /** Materials by index. Always at least one. */
  materials: ModelMaterial[];
  /** Axis-aligned bounds: min x, y, z then max x, y, z. */
  bounds: Float32Array;
  /** Which axis points up in the file: glTF, OBJ and PLY are usually y-up, STL (CAD, 3D printing) z-up. */
  up: 'y' | 'z';
  /** The format it was read from. */
  format: ModelFormat;
}

export interface ModelGroup {
  /** First index in `indices` (a multiple of 3). */
  start: number;
  /** How many indices (a multiple of 3). */
  count: number;
  /** Index into `materials`. */
  material: number;
}

export interface ModelMaterial {
  name: string;
  /** Linear base colour and alpha, 0 to 1 (glTF's baseColorFactor, OBJ's Kd and d). */
  color: [number, number, number, number];
  /** Light the surface gives off itself, linear (glTF's emissiveFactor, OBJ's Ke). */
  emissive: [number, number, number];
  /** The base colour texture, if any: sampled at the vertices' uvs and multiplied by `color`. */
  texture: ModelTexture | null;
  /** Drawn from both sides (glTF's doubleSided). Renderers draw every triangle from both sides anyway; kept for reference. */
  doubleSided: boolean;
}

export interface ModelTexture {
  /** The encoded image (PNG or JPEG) when the file holds it or it was read; null until then. */
  bytes: Uint8Array | null;
  /** Its MIME type when known ('image/png', 'image/jpeg'). */
  mimeType: string | null;
  /** Its path relative to the model file, when it lives outside it. */
  uri: string | null;
  /** The decoded picture, RGBA (sRGB), once decoded (decodeModelTextures). */
  image: { width: number; height: number; data: Uint8Array } | null;
  /** How uvs outside 0 to 1 are taken: 'repeat' (default), 'clamp' or 'mirror'. */
  wrap: 'repeat' | 'clamp' | 'mirror';
}

export type ModelFormat = 'glb' | 'gltf' | 'obj' | 'stl' | 'ply' | 'shape';
