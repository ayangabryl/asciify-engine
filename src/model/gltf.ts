/**
 * glTF 2.0, as .gltf (JSON) or .glb. Buffers come from the GLB's binary chunk, base64 data: URIs or the files given;
 * accessors of every component type, normalized or not, strided and sparse (so KHR_mesh_quantization works). Draws the
 * default scene's node tree (matrix or translation, rotation and scale, and EXT_mesh_gpu_instancing), each mesh once a node:
 * triangles, strips and fans, or points (lines too, as points) when there is nothing else; POSITION, NORMAL, COLOR_0 and
 * the uvs the base colour texture uses. Materials: base colour factor and texture (its sampler's wrap, KHR_texture_transform
 * baked into the uvs), emission (with KHR_materials_emissive_strength; none where it comes from an emissive texture, which
 * is not sampled), doubleSided, and the older specular-glossiness diffuse. Not read: Draco and meshopt compression (an error
 * says so), skins and morph targets (the bind pose is drawn), animations, cameras, lights and every other map.
 */
import type { AsciiModel, ModelMaterial, ModelTexture } from './types';
import { MAX_VERTICES, ResourceIndex, bytesAre, decodeDataUri, decodeText, finishModel, groupTriangles, imageMime, littleEndian, newTexture } from './parse-util';

interface TextureInfo { index?: number; texCoord?: number; extensions?: { KHR_texture_transform?: { offset?: number[]; rotation?: number; scale?: number[]; texCoord?: number } } }
interface Accessor {
  bufferView?: number; byteOffset?: number; componentType?: number; normalized?: boolean; count?: number; type?: string;
  sparse?: { count?: number; indices?: { bufferView?: number; byteOffset?: number; componentType?: number }; values?: { bufferView?: number; byteOffset?: number } };
}
interface Primitive { attributes?: Record<string, number>; indices?: number; material?: number; mode?: number }
interface Node {
  mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[];
  extensions?: { EXT_mesh_gpu_instancing?: { attributes?: Record<string, number> } };
}
interface Material {
  name?: string; alphaMode?: string; doubleSided?: boolean; emissiveFactor?: number[]; emissiveTexture?: TextureInfo;
  pbrMetallicRoughness?: { baseColorFactor?: number[]; baseColorTexture?: TextureInfo };
  extensions?: { KHR_materials_emissive_strength?: { emissiveStrength?: number }; KHR_materials_pbrSpecularGlossiness?: { diffuseFactor?: number[]; diffuseTexture?: TextureInfo } };
}
interface Gltf {
  asset?: { version?: string }; scene?: number; scenes?: { nodes?: number[] }[]; nodes?: Node[]; meshes?: { primitives?: Primitive[] }[];
  accessors?: Accessor[]; bufferViews?: { buffer?: number; byteOffset?: number; byteLength?: number; byteStride?: number }[];
  buffers?: { uri?: string; byteLength?: number }[]; materials?: Material[];
  textures?: { source?: number; sampler?: number; extensions?: Record<string, { source?: number } | undefined> }[];
  images?: { uri?: string; bufferView?: number; mimeType?: string }[]; samplers?: { wrapS?: number }[];
  extensionsRequired?: string[];
}

const COMPONENT_SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const NORMALIZE: Record<number, number> = { 5120: 1 / 127, 5121: 1 / 255, 5122: 1 / 32767, 5123: 1 / 65535, 5125: 1 / 4294967295, 5126: 1 };
const TYPE_SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const COMPRESSION = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_meshopt_compression'];
/** An accessor with no bufferView is zeros (and any sparse values): its count is not bounded by any data, so it is here. */
const MAX_UNBACKED = 1 << 20;

const list = <T>(value: unknown): T[] => (Array.isArray(value) ? value : []);
const isIndex = (value: unknown, length: number): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) < length;
const numbers = (value: unknown, n: number, fallback: number[]): number[] =>
  Array.isArray(value) && value.length >= n && value.slice(0, n).every(v => typeof v === 'number' && v - v === 0) ? value.slice(0, n) : fallback;

/** The JSON and binary chunk of a .glb, or the JSON of a .gltf. */
function readDocument(bytes: Uint8Array): { json: Gltf; bin: Uint8Array | null; binary: boolean } {
  if (!bytesAre(bytes, 0, 'glTF')) return { json: parseJson(bytes), bin: null, binary: false };
  if (bytes.length < 20) throw new Error('glTF: the GLB file is cut short');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), version = view.getUint32(4, true);
  if (version !== 2) throw new Error(`glTF: this is GLB version ${version}; only glTF 2.0 is read, so re-export it as glTF 2.0`);
  const length = Math.min(view.getUint32(8, true), bytes.length);
  let json: Gltf | null = null, bin: Uint8Array | null = null;
  for (let o = 12; o + 8 <= length;) {
    const size = view.getUint32(o, true), type = view.getUint32(o + 4, true), start = o + 8;
    if (start + size > length) throw new Error('glTF: a GLB chunk runs past the end of the file');
    if (type === 0x4e4f534a && !json) json = parseJson(bytes.subarray(start, start + size));
    else if (type === 0x004e4942 && !bin) bin = bytes.subarray(start, start + size);
    o = start + size;
  }
  if (!json) throw new Error('glTF: the GLB file has no JSON chunk');
  return { json, bin, binary: true };
}

function parseJson(bytes: Uint8Array): Gltf {
  let json: unknown;
  try { json = JSON.parse(decodeText(bytes)); } catch (error) { throw new Error(`glTF: the JSON does not parse (${(error as Error).message})`); }
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('glTF: the JSON is not an object');
  const version = (json as Gltf).asset?.version;
  if (typeof version === 'string' && /^1\./.test(version)) throw new Error(`glTF: this is glTF ${version}; only glTF 2.0 is read, so re-export it as glTF 2.0`);
  for (const name of list<string>((json as Gltf).extensionsRequired)) {
    if (COMPRESSION.includes(name)) throw new Error(`glTF: the file's meshes are compressed with ${name}, which this reader does not decode; re-export it without mesh compression`);
  }
  return json as Gltf;
}

/** The texture a material's base colour reads (or the older specular-glossiness diffuse). */
const baseTexture = (material: Material | null | undefined): TextureInfo | undefined => {
  const pbr = material?.pbrMetallicRoughness;
  return pbr ? pbr.baseColorTexture : material?.extensions?.KHR_materials_pbrSpecularGlossiness?.diffuseTexture;
};

/** The image a texture shows: its own source, else one an extension gives (WebP, AVIF, KTX2, DDS). */
function textureImage(json: Gltf, index: unknown): number | undefined {
  const textures = list<NonNullable<Gltf['textures']>[number]>(json.textures);
  if (!isIndex(index, textures.length) || !textures[index] || typeof textures[index] !== 'object') return undefined;
  const entry = textures[index];
  let source = entry.source;
  for (const name of ['EXT_texture_webp', 'EXT_texture_avif', 'KHR_texture_basisu', 'MSFT_texture_dds']) source ??= entry.extensions?.[name]?.source;
  return isIndex(source, list(json.images).length) ? source : undefined;
}

/**
 * The external files a glTF needs (not data: URIs), for loadModel: its buffers, and the pictures of base colour textures
 * (normal, roughness and other maps are not drawn, so not fetched). Throws as parsing would for compressed files.
 */
export function gltfReferences(bytes: Uint8Array): { buffers: string[]; images: string[] } {
  const { json } = readDocument(bytes);
  const external = (uri: unknown): uri is string => typeof uri === 'string' && uri.length > 0 && !/^data:/i.test(uri);
  const images = list<{ uri?: string }>(json.images), used = new Set<number>();
  for (const material of list<Material>(json.materials)) {
    const image = material && typeof material === 'object' ? textureImage(json, baseTexture(material)?.index) : undefined;
    if (image !== undefined) used.add(image);
  }
  return {
    buffers: list<{ uri?: string }>(json.buffers).map(buffer => buffer?.uri).filter(external),
    images: [...used].map(i => images[i]?.uri).filter(external),
  };
}

export function parseGltf(bytes: Uint8Array, resources: ResourceIndex | null): AsciiModel {
  const { json, bin, binary } = readDocument(bytes);
  const buffers = new Map<number, Uint8Array>();
  const accessors = list<Accessor>(json.accessors);

  const buffer = (index: unknown): Uint8Array => {
    const cached = buffers.get(index as number);
    if (cached) return cached;
    const entries = list<{ uri?: string; byteLength?: number }>(json.buffers);
    if (!isIndex(index, entries.length) || !entries[index]) throw new Error(`glTF: buffer ${String(index)} does not exist`);
    const entry = entries[index];
    let data: Uint8Array | null;
    if (typeof entry.uri !== 'string') {
      if (index !== 0 || !bin) throw new Error(`glTF: buffer ${index} has no data (no uri, and it is not a GLB's binary chunk)`);
      data = bin;
    } else {
      data = decodeDataUri(entry.uri)?.bytes ?? resources?.bytes(entry.uri) ?? null;
      if (!data) throw new Error(`glTF: buffer ${index} (${entry.uri}) was not given; pass it in \`resources\`, or load the model with loadModel`);
    }
    const length = entry.byteLength;
    if (typeof length === 'number' && data.length < length) throw new Error(`glTF: buffer ${index} holds ${data.length} bytes of the ${length} it should`);
    buffers.set(index, data);
    return data;
  };

  const bufferView = (index: unknown): { bytes: Uint8Array; stride: number } => {
    const views = list<{ buffer?: number; byteOffset?: number; byteLength?: number; byteStride?: number }>(json.bufferViews);
    if (!isIndex(index, views.length) || !views[index]) throw new Error(`glTF: bufferView ${String(index)} does not exist`);
    const view = views[index], data = buffer(view.buffer), offset = view.byteOffset ?? 0, length = view.byteLength ?? NaN;
    if (!(Number.isInteger(offset) && offset >= 0 && Number.isInteger(length) && length >= 0 && offset + length <= data.length)) {
      throw new Error(`glTF: bufferView ${index} runs past the end of buffer ${view.buffer}`);
    }
    const stride = view.byteStride ?? 0;
    return { bytes: data.subarray(offset, offset + length), stride: Number.isInteger(stride) && stride > 0 ? stride : 0 };
  };

  /** Reads `count` elements of `size` components into `out`, as numbers (normalized integers mapped to 0–1 or -1–1). */
  const readInto = (out: Float32Array | Uint32Array, bytes: Uint8Array, offset: number, stride: number, count: number, size: number, type: number, normalized: boolean, what: string) => {
    const csize = COMPONENT_SIZE[type], element = size * csize;
    if (!(Number.isInteger(offset) && offset >= 0)) throw new Error(`glTF: ${what} has a byteOffset of ${offset}`);
    if (stride < element) throw new Error(`glTF: ${what} has a byteStride of ${stride}, less than its ${element}-byte elements`);
    if (count > 0 && offset + (count - 1) * stride + element > bytes.length) throw new Error(`glTF: ${what} reads past the end of its bufferView`);
    const at = bytes.byteOffset + offset, n = count * size, scale = normalized ? NORMALIZE[type] : 1, signed = normalized && (type === 5120 || type === 5122);
    if (stride === element && at % csize === 0 && littleEndian()) {
      const src = type === 5126 ? new Float32Array(bytes.buffer, at, n) : type === 5125 ? new Uint32Array(bytes.buffer, at, n) : type === 5123 ? new Uint16Array(bytes.buffer, at, n)
        : type === 5122 ? new Int16Array(bytes.buffer, at, n) : type === 5121 ? new Uint8Array(bytes.buffer, at, n) : new Int8Array(bytes.buffer, at, n);
      if (scale === 1) { out.set(src); return; }
      for (let i = 0; i < n; i++) { const v = src[i] * scale; out[i] = signed && v < -1 ? -1 : v; }
      return;
    }
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < count; i++) {
      for (let c = 0, o = offset + i * stride; c < size; c++, o += csize) {
        let v = type === 5126 ? dv.getFloat32(o, true) : type === 5121 ? dv.getUint8(o) : type === 5123 ? dv.getUint16(o, true) : type === 5125 ? dv.getUint32(o, true)
          : type === 5122 ? dv.getInt16(o, true) : dv.getInt8(o);
        v *= scale;
        out[i * size + c] = signed && v < -1 ? -1 : v;
      }
    }
  };

  // Read once each, however many nodes draw them (nothing here changes what an accessor holds).
  const floatCache = new Map<unknown, { data: Float32Array; size: number; count: number }>(), indexCache = new Map<unknown, { data: Uint32Array; size: number; count: number }>();
  /** An accessor as numbers: floats for attributes, integers for indices. */
  const accessor = (index: unknown, sizes: number[], what: string, integers = false): { data: Float32Array | Uint32Array; size: number; count: number } => {
    const cached = (integers ? indexCache : floatCache).get(index);
    if (cached) return cached;
    if (!isIndex(index, accessors.length) || !accessors[index]) throw new Error(`glTF: accessor ${String(index)} (${what}) does not exist`);
    const a = accessors[index], name = `accessor ${index} (${what})`;
    const size = TYPE_SIZE[a.type ?? ''], type = a.componentType ?? 0, count = a.count;
    if (!size || !sizes.includes(size)) throw new Error(`glTF: ${name} is ${a.type}, where ${sizes.map(s => (s === 1 ? 'SCALAR' : `VEC${s}`)).join(' or ')} belongs`);
    if (!COMPONENT_SIZE[type] || (integers && type !== 5121 && type !== 5123 && type !== 5125)) throw new Error(`glTF: ${name} has component type ${type}`);
    if (!(Number.isInteger(count) && count! >= 0)) throw new Error(`glTF: ${name} has a count of ${count}`);
    if (a.bufferView === undefined && count! > MAX_UNBACKED) throw new Error(`glTF: ${name} holds ${count} values with no data behind them`);
    if (count! * size > MAX_VERTICES * 4) throw new Error(`glTF: ${name} holds ${count} values, more than this reader takes`);
    const data = integers ? new Uint32Array(count! * size) : new Float32Array(count! * size);
    const normalized = !integers && a.normalized === true;
    if (a.bufferView !== undefined) {
      const view = bufferView(a.bufferView);
      readInto(data, view.bytes, a.byteOffset ?? 0, view.stride || size * COMPONENT_SIZE[type], count!, size, type, normalized, name);
    }
    if (a.sparse) {
      const sparse = a.sparse, k = sparse.count, indexType = sparse.indices?.componentType ?? 0;
      if (!(Number.isInteger(k) && k! >= 0 && k! <= count!)) throw new Error(`glTF: ${name} has ${k} sparse values for ${count} elements`);
      if (indexType !== 5121 && indexType !== 5123 && indexType !== 5125) throw new Error(`glTF: ${name}'s sparse indices have component type ${indexType}`);
      const targets = new Uint32Array(k!), values = integers ? new Uint32Array(k! * size) : new Float32Array(k! * size);
      const iv = bufferView(sparse.indices?.bufferView), vv = bufferView(sparse.values?.bufferView);
      readInto(targets, iv.bytes, sparse.indices?.byteOffset ?? 0, COMPONENT_SIZE[indexType], k!, 1, indexType, false, `${name}'s sparse indices`);
      readInto(values, vv.bytes, sparse.values?.byteOffset ?? 0, size * COMPONENT_SIZE[type], k!, size, type, normalized, `${name}'s sparse values`);
      for (let j = 0; j < k!; j++) {
        const t = targets[j];
        if (t >= count!) throw new Error(`glTF: ${name} has a sparse value for element ${t} of ${count}`);
        for (let c = 0; c < size; c++) data[t * size + c] = values[j * size + c];
      }
    }
    const result = { data, size, count: count! };
    if (integers) indexCache.set(index, result as { data: Uint32Array; size: number; count: number });
    else floatCache.set(index, result as { data: Float32Array; size: number; count: number });
    return result;
  };
  const countOf = (index: unknown, what: string) => {
    const a = isIndex(index, accessors.length) ? accessors[index] : undefined;
    if (!a || !(Number.isInteger(a.count) && a.count! >= 0)) throw new Error(`glTF: accessor ${String(index)} (${what}) does not exist or has no count`);
    return a.count!;
  };

  // The scene: the default one, else the first, else every node no other node holds.
  const nodes = list<Node>(json.nodes), scenes = list<{ nodes?: number[] }>(json.scenes);
  let roots: unknown[];
  if (scenes.length) roots = list((scenes[isIndex(json.scene, scenes.length) ? json.scene : 0] ?? {}).nodes);
  else {
    const held = new Uint8Array(nodes.length);
    for (const node of nodes) for (const child of list(node?.children)) if (isIndex(child, nodes.length)) held[child] = 1;
    roots = nodes.map((_, i) => i).filter(i => !held[i]);
  }
  const instances: { mesh: number; matrix: Float64Array }[] = [];
  const seen = new Uint8Array(nodes.length), stack: [unknown, Float64Array][] = roots.slice().reverse().map(root => [root, identity()]);
  while (stack.length) {
    const [index, parent] = stack.pop()!;
    // A node is drawn once even if a broken file lists it under two parents, or under itself.
    if (!isIndex(index, nodes.length) || seen[index]) continue;
    seen[index] = 1;
    const node = nodes[index] && typeof nodes[index] === 'object' ? nodes[index] : {};
    const world = multiply(parent, localMatrix(node));
    if (node.mesh !== undefined) for (const matrix of instanceMatrices(node, world, accessor)) instances.push({ mesh: node.mesh, matrix });
    const children = list(node.children);
    for (let c = children.length - 1; c >= 0; c--) stack.push([children[c], world]);
  }
  const meshes = list<{ primitives?: Primitive[] }>(json.meshes);
  if (!instances.length) meshes.forEach((_, mesh) => instances.push({ mesh, matrix: identity() })); // meshes no scene places: draw them as they are

  interface Draw { primitive: Primitive; matrix: Float64Array; mode: number; vertices: number; indices: number }
  const draws: Draw[] = [];
  for (const { mesh, matrix } of instances) {
    if (!isIndex(mesh, meshes.length) || !meshes[mesh]) throw new Error(`glTF: mesh ${mesh} does not exist`);
    for (const primitive of list<Primitive>(meshes[mesh].primitives)) {
      if (!primitive || typeof primitive !== 'object' || primitive.attributes?.POSITION === undefined) continue;
      const mode = primitive.mode ?? 4, vertices = countOf(primitive.attributes.POSITION, 'POSITION');
      const indices = primitive.indices !== undefined ? countOf(primitive.indices, 'indices') : vertices;
      const triangles = mode === 4 ? Math.floor(indices / 3) : mode === 5 || mode === 6 ? Math.max(0, indices - 2) : 0;
      draws.push({ primitive, matrix, mode, vertices, indices: triangles * 3 });
    }
  }
  // Triangles if there are any; otherwise points and lines are drawn as points.
  let chosen = draws.filter(draw => (draw.mode === 4 || draw.mode === 5 || draw.mode === 6) && draw.indices > 0);
  const points = !chosen.length;
  if (points) chosen = draws.filter(draw => draw.mode >= 0 && draw.mode <= 3 && draw.vertices > 0);
  const vertexCount = chosen.reduce((sum, draw) => sum + draw.vertices, 0), indexCount = points ? 0 : chosen.reduce((sum, draw) => sum + draw.indices, 0);
  // Nodes and instances repeat meshes, so a small file can ask for any number of vertices: allow 16M, or twice what it holds.
  const stored = [...new Set(chosen.map(draw => draw.primitive.attributes!.POSITION))].reduce((sum, index) => sum + countOf(index, 'POSITION'), 0);
  const limit = Math.min(MAX_VERTICES, Math.max(1 << 24, stored * 2));
  if (vertexCount > limit || indexCount > limit * 4) throw new Error(`glTF: the scene holds ${vertexCount} vertices with its instances, more than this reader takes`);

  // Materials, made as primitives use them.
  const materials: ModelMaterial[] = [], materialIndex = new Map<number, number>(), textureCache = new Map<number, ModelTexture | null>();
  const textureOf = (index: unknown): ModelTexture | null => {
    const textures = list<NonNullable<Gltf['textures']>[number]>(json.textures);
    if (!isIndex(index, textures.length) || !textures[index]) return null;
    if (textureCache.has(index)) return textureCache.get(index)!;
    const entry = textures[index], images = list<NonNullable<Gltf['images']>[number]>(json.images), source = textureImage(json, index);
    let result: ModelTexture | null = null;
    if (source !== undefined && images[source] && typeof images[source] === 'object') {
      const image = images[source];
      let bytes: Uint8Array | null = null, uri: string | null = null, mime = typeof image.mimeType === 'string' ? image.mimeType : null;
      if (image.bufferView !== undefined) {
        try { bytes = bufferView(image.bufferView).bytes.slice(); } catch { bytes = null; }
      } else if (typeof image.uri === 'string') {
        const data = decodeDataUri(image.uri);
        if (data) { bytes = data.bytes; mime ??= data.mimeType; } else { uri = image.uri; bytes = resources?.bytes(image.uri) ?? null; }
      }
      const samplers = list<{ wrapS?: number }>(json.samplers), wrapS = isIndex(entry.sampler, samplers.length) ? samplers[entry.sampler]?.wrapS : undefined;
      result = newTexture(bytes, imageMime(bytes, null) ?? mime ?? imageMime(null, uri), uri, wrapS === 33071 ? 'clamp' : wrapS === 33648 ? 'mirror' : 'repeat');
    }
    textureCache.set(index, result);
    return result;
  };
  const materialOf = (index: unknown): number => {
    const key = typeof index === 'number' ? index : -1, known = materialIndex.get(key);
    if (known !== undefined) return known;
    const entries = list<Material>(json.materials), entry = isIndex(index, entries.length) && entries[index] && typeof entries[index] === 'object' ? entries[index] : null;
    let material: ModelMaterial;
    if (!entry) material = { name: 'default', color: [1, 1, 1, 1], emissive: [0, 0, 0], texture: null, doubleSided: false };
    else {
      const pbr = entry.pbrMetallicRoughness, gloss = entry.extensions?.KHR_materials_pbrSpecularGlossiness;
      const base = numbers(pbr ? pbr.baseColorFactor : gloss?.diffuseFactor, 4, [1, 1, 1, 1]);
      // Emission from a texture is not sampled, and its factor alone (often 1, 1, 1) would light the whole surface: none.
      const strength = entry.extensions?.KHR_materials_emissive_strength?.emissiveStrength;
      const emissive = entry.emissiveTexture ? [0, 0, 0] : numbers(entry.emissiveFactor, 3, [0, 0, 0]).map(v => v * (typeof strength === 'number' && strength >= 0 ? strength : 1));
      // An opaque material ignores its alpha.
      const alpha = entry.alphaMode === 'BLEND' || entry.alphaMode === 'MASK' ? base[3] : 1;
      material = {
        name: typeof entry.name === 'string' && entry.name ? entry.name : `material ${key}`, color: [base[0], base[1], base[2], alpha],
        emissive: [emissive[0], emissive[1], emissive[2]], texture: textureOf(baseTexture(entry)?.index), doubleSided: entry.doubleSided === true,
      };
    }
    materials.push(material);
    materialIndex.set(key, materials.length - 1);
    return materials.length - 1;
  };
  /** The uv set a primitive's base colour texture reads, and the transform baked into it. */
  const uvSet = (primitive: Primitive) => {
    const entries = list<Material>(json.materials), material = isIndex(primitive.material, entries.length) ? entries[primitive.material] : undefined;
    const info = baseTexture(material), transform = info?.extensions?.KHR_texture_transform;
    const set = transform?.texCoord ?? info?.texCoord ?? 0;
    return { attribute: primitive.attributes?.[`TEXCOORD_${Number.isInteger(set) ? set : 0}`], transform };
  };

  const positions = new Float32Array(vertexCount * 3);
  const normals = chosen.some(draw => draw.primitive.attributes!.NORMAL !== undefined) ? new Float32Array(vertexCount * 3) : null;
  const colors = chosen.some(draw => draw.primitive.attributes!.COLOR_0 !== undefined) ? new Float32Array(vertexCount * 3) : null;
  const uvs = chosen.some(draw => uvSet(draw.primitive).attribute !== undefined) ? new Float32Array(vertexCount * 2) : null;
  const indices = new Uint32Array(indexCount), triangleMaterials = new Uint32Array(indexCount / 3);
  let base = 0, written = 0;
  for (const draw of chosen) {
    const { primitive, matrix, mode } = draw, attributes = primitive.attributes!;
    const position = accessor(attributes.POSITION, [3], 'POSITION'), count = position.count;
    transformPoints(position.data, matrix, positions, base, count);
    if (normals && attributes.NORMAL !== undefined) {
      // Missing ones stay zero, and finishModel works them out from the faces.
      const normal = accessor(attributes.NORMAL, [3], 'NORMAL');
      transformNormals(normal.data, matrix, normals, base, Math.min(count, normal.count));
    }
    if (colors) {
      if (attributes.COLOR_0 !== undefined) {
        const color = accessor(attributes.COLOR_0, [3, 4], 'COLOR_0'), data = color.data;
        for (let i = 0, n = Math.min(count, color.count); i < n; i++) for (let c = 0; c < 3; c++) colors[(base + i) * 3 + c] = data[i * color.size + c];
        for (let i = color.count; i < count; i++) colors[(base + i) * 3] = colors[(base + i) * 3 + 1] = colors[(base + i) * 3 + 2] = 1;
      } else colors.fill(1, base * 3, (base + count) * 3);
    }
    const set = uvSet(primitive);
    if (uvs && set.attribute !== undefined) {
      const uv = accessor(set.attribute, [2], 'TEXCOORD'), data = uv.data, t = set.transform;
      const [ox, oy] = numbers(t?.offset, 2, [0, 0]), [sx, sy] = numbers(t?.scale, 2, [1, 1]), r = typeof t?.rotation === 'number' ? t.rotation : 0;
      const cos = Math.cos(r), sin = Math.sin(r);
      for (let i = 0, n = Math.min(count, uv.count); i < n; i++) {
        const u = data[i * 2], v = data[i * 2 + 1];
        uvs[(base + i) * 2] = t ? cos * sx * u + sin * sy * v + ox : u;
        uvs[(base + i) * 2 + 1] = t ? -sin * sx * u + cos * sy * v + oy : v;
      }
    }
    if (!points) {
      const source = primitive.indices !== undefined ? accessor(primitive.indices, [1], 'indices', true).data : null;
      const at = (k: number) => (source ? source[k] : k), n = source ? source.length : count;
      const flip = determinant(matrix) < 0, material = materialOf(primitive.material), start = written;
      for (let k = 0; k + 2 < n; k += mode === 4 ? 3 : 1) {
        let a: number, b: number, c: number;
        if (mode === 4) { a = at(k); b = at(k + 1); c = at(k + 2); }
        else if (mode === 5) { a = at(k); b = at(k + 1 + (k & 1)); c = at(k + 2 - (k & 1)); }
        else { a = at(k + 1); b = at(k + 2); c = at(0); }
        if (a >= count || b >= count || c >= count) throw new Error(`glTF: a primitive refers to vertex ${Math.max(a, b, c)} of ${count}`);
        if (mode !== 4 && (a === b || b === c || a === c)) continue; // strips are often joined by empty triangles
        indices[written] = base + a;
        indices[written + 1] = base + (flip ? c : b);
        indices[written + 2] = base + (flip ? b : c);
        written += 3;
      }
      triangleMaterials.fill(material, start / 3, written / 3);
    }
    base += count;
  }
  if (!materials.length) materialOf(chosen[0]?.primitive.material); // a point cloud takes its first primitive's material
  const grouped = groupTriangles(written === indexCount ? indices : indices.slice(0, written), triangleMaterials, materials.length);
  return finishModel({
    positions, normals, colors, uvs, indices: grouped.indices, groups: grouped.groups, materials, up: 'y', format: binary ? 'glb' : 'gltf',
  }, 'glTF');
}

// 4 by 4 matrices, column by column as glTF writes them.

const identity = () => new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

function multiply(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return out;
}

/** Translation, then rotation (a quaternion), then scale, as one matrix. */
function compose(t: ArrayLike<number>, q: ArrayLike<number>, s: ArrayLike<number>): Float64Array {
  let x = q[0], y = q[1], z = q[2], w = q[3];
  const len = Math.sqrt(x * x + y * y + z * z + w * w);
  if (len > 0) { x /= len; y /= len; z /= len; w /= len; } else w = 1;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return new Float64Array([
    (1 - 2 * (yy + zz)) * s[0], 2 * (xy + wz) * s[0], 2 * (xz - wy) * s[0], 0,
    2 * (xy - wz) * s[1], (1 - 2 * (xx + zz)) * s[1], 2 * (yz + wx) * s[1], 0,
    2 * (xz + wy) * s[2], 2 * (yz - wx) * s[2], (1 - 2 * (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ]);
}

function localMatrix(node: Node): Float64Array {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) return new Float64Array(numbers(node.matrix, 16, Array.from(identity())));
  return compose(numbers(node.translation, 3, [0, 0, 0]), numbers(node.rotation, 4, [0, 0, 0, 1]), numbers(node.scale, 3, [1, 1, 1]));
}

/** A node's matrix once per EXT_mesh_gpu_instancing instance, or just its own. */
function instanceMatrices(node: Node, world: Float64Array, accessor: (index: unknown, sizes: number[], what: string) => { data: Float32Array | Uint32Array; size: number; count: number }): Float64Array[] {
  const attributes = node.extensions?.EXT_mesh_gpu_instancing?.attributes;
  if (!attributes || typeof attributes !== 'object') return [world];
  const t = attributes.TRANSLATION !== undefined ? accessor(attributes.TRANSLATION, [3], 'TRANSLATION') : null;
  const r = attributes.ROTATION !== undefined ? accessor(attributes.ROTATION, [4], 'ROTATION') : null;
  const s = attributes.SCALE !== undefined ? accessor(attributes.SCALE, [3], 'SCALE') : null;
  const count = Math.min(t?.count ?? Infinity, r?.count ?? Infinity, s?.count ?? Infinity);
  if (!(count < Infinity)) return [world];
  if (count > MAX_VERTICES) throw new Error(`glTF: ${count} instances is more than this reader takes`);
  const out: Float64Array[] = [];
  for (let i = 0; i < count; i++) {
    out.push(multiply(world, compose(t ? t.data.subarray(i * 3, i * 3 + 3) : [0, 0, 0], r ? r.data.subarray(i * 4, i * 4 + 4) : [0, 0, 0, 1], s ? s.data.subarray(i * 3, i * 3 + 3) : [1, 1, 1])));
  }
  return out;
}

const determinant = (m: Float64Array) =>
  m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);

function transformPoints(src: Float32Array | Uint32Array, m: Float64Array, out: Float32Array, base: number, count: number): void {
  const m0 = m[0], m1 = m[1], m2 = m[2], m4 = m[4], m5 = m[5], m6 = m[6], m8 = m[8], m9 = m[9], m10 = m[10], m12 = m[12], m13 = m[13], m14 = m[14];
  for (let i = 0, o = base * 3; i < count; i++, o += 3) {
    const x = src[i * 3], y = src[i * 3 + 1], z = src[i * 3 + 2];
    out[o] = m0 * x + m4 * y + m8 * z + m12;
    out[o + 1] = m1 * x + m5 * y + m9 * z + m13;
    out[o + 2] = m2 * x + m6 * y + m10 * z + m14;
  }
}

/** Normals through the inverse transpose of the matrix's 3 by 3 part (its cofactors, signed by its determinant). */
function transformNormals(src: Float32Array | Uint32Array, m: Float64Array, out: Float32Array, base: number, count: number): void {
  const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10];
  const c00 = e * i - f * h, c01 = f * g - d * i, c02 = d * h - e * g;
  const c10 = c * h - b * i, c11 = a * i - c * g, c12 = b * g - a * h;
  const c20 = b * f - c * e, c21 = c * d - a * f, c22 = a * e - b * d;
  const sign = a * c00 + b * c01 + c * c02 < 0 ? -1 : 1;
  for (let k = 0, o = base * 3; k < count; k++, o += 3) {
    const x = src[k * 3], y = src[k * 3 + 1], z = src[k * 3 + 2];
    out[o] = sign * (c00 * x + c01 * y + c02 * z);
    out[o + 1] = sign * (c10 * x + c11 * y + c12 * z);
    out[o + 2] = sign * (c20 * x + c21 * y + c22 * z);
  }
}
