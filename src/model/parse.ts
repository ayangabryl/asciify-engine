/**
 * Reading models for asciify-engine/model: glTF 2.0 (.gltf and .glb), OBJ with its MTL, STL and PLY, from bytes or text,
 * into one `AsciiModel`; loadModel also fetches (or reads) the files a model refers to. Plain code over bytes, with no DOM
 * and no Node modules, so it runs in Node, browsers, workers and edge runtimes alike, and does nothing at import.
 */
import type { AsciiModel, ModelFormat, ModelTexture } from './types';
import { parseGltf, gltfReferences } from './gltf';
import { mtlTextures, objLibraries, parseObj } from './obj';
import { parsePly, plyTextures } from './ply';
import { looksAscii, parseStl } from './stl';
import {
  ResourceIndex, baseOf, bytesAre, cleanPath, decodeText, dirOf, findBytes, isBlank, isSpace, joinPath, safeDecode, toBytes, type Resources,
} from './parse-util';

export { withNormals } from './normals';

const EXTENSIONS: Record<string, ModelFormat> = { glb: 'glb', vrm: 'glb', gltf: 'gltf', obj: 'obj', stl: 'stl', ply: 'ply' };
const LABELS: Record<string, string> = { glb: 'glTF', gltf: 'glTF', obj: 'OBJ', stl: 'STL', ply: 'PLY' };
const OBJ_KEYWORDS = new Set(['v', 'vt', 'vn', 'vp', 'f', 'o', 'g', 's', 'l', 'p', 'mtllib', 'usemtl']);

const extensionOf = (name: string | undefined) => (name ? /\.([a-z0-9]+)$/i.exec(name.replace(/[?#].*$/, ''))?.[1].toLowerCase() : undefined);

/**
 * Which format `bytes` hold, or null. Signatures decide first (a GLB's magic, a PLY header, a binary STL's size, glTF JSON
 * with "asset"), then the name's extension, then the text: ASCII STL's solid and facet, OBJ's keywords.
 */
export function modelFormat(bytes: Uint8Array, name?: string): ModelFormat | null {
  const n = bytes.length;
  if (bytesAre(bytes, 0, 'glTF')) return 'glb';
  if (bytesAre(bytes, 0, 'ply') && isSpace(bytes[3] ?? 0)) return 'ply';
  if (n >= 84 && 84 + 50 * ((bytes[80] | (bytes[81] << 8) | (bytes[82] << 16) | (bytes[83] << 24)) >>> 0) === n) return 'stl';
  const ext = extensionOf(name);
  let i = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  while (i < n && isSpace(bytes[i])) i++;
  if (bytes[i] === 123 && (ext === 'gltf' || findBytes(bytes, '"asset"', i) >= 0)) return 'gltf';
  if (ext && EXTENSIONS[ext]) return EXTENSIONS[ext];
  if (looksAscii(bytes) && findBytes(bytes, 'facet', 0, Math.min(n, 1 << 16)) >= 0) return 'stl';
  // OBJ: the first line that is not blank or a comment starts with one of its keywords.
  for (let lines = 0; i < n && lines < 1000; lines++) {
    let end = i;
    while (end < n && bytes[end] !== 10 && bytes[end] !== 13) end++;
    if (bytes[i] !== 35) {
      let word = i;
      while (word < end && !isBlank(bytes[word])) word++;
      return word < end && OBJ_KEYWORDS.has(decodeText(bytes.subarray(i, word))) ? 'obj' : null;
    }
    i = end;
    while (i < n && isSpace(bytes[i])) i++;
  }
  return null;
}

export interface ParseModelOptions {
  /** Skip sniffing: read the data as this format. */
  format?: ModelFormat;
  /** The file's name, for the extension hint and error messages. */
  name?: string;
  /**
   * Other files the model refers to, by the path written in it (glTF .bin buffers and images, OBJ .mtl files and
   * textures). Found by that path, cleaned of `./` and backslashes, percent-decoded, or by file name alone.
   */
  resources?: Record<string, Uint8Array | string>;
}

/**
 * Reads a model from its bytes (or text, for OBJ, ASCII STL, ASCII PLY and .gltf JSON). Files it refers to come from
 * `resources`; a glTF buffer that is missing is an error, a missing MTL or texture is not (the model is drawn without it).
 * Errors start with the format: `OBJ: face refers to vertex 120 of 100 (line 7)`.
 */
export function parseModel(data: Uint8Array | ArrayBuffer | string, options: ParseModelOptions = {}): AsciiModel {
  const bytes = toBytes(data), name = options.name;
  const format = options.format ?? modelFormat(bytes, name);
  if (!format) throw new Error(`Not a model asciify-engine can read${name ? ` (${name})` : ''}: it reads glTF and GLB, OBJ, STL and PLY`);
  const resources = options.resources ? new ResourceIndex(options.resources as Resources) : null, label = LABELS[format];
  try {
    switch (format) {
      case 'glb':
      case 'gltf': return parseGltf(bytes, resources);
      case 'obj': return parseObj(bytes, resources);
      case 'stl': return parseStl(bytes);
      case 'ply': return parsePly(bytes, resources);
      default: throw new Error(`parseModel reads glTF, GLB, OBJ, STL and PLY, not "${format}"`);
    }
  } catch (error) {
    if (!label || !(error instanceof Error)) throw error;
    // A message not worded by a parser (a RangeError from a broken file, say) is still put to the format, and the name added.
    let message = error.message.startsWith(`${label}:`) ? error.message : `${label}: ${error.message}`;
    if (name) message = / \(line \d+\)$/.test(message) ? message.replace(/ \(line (\d+)\)$/, ` (${name}, line $1)`) : `${message} (${name})`;
    if (message === error.message) throw error;
    throw new Error(message);
  }
}

export interface LoadModelOptions {
  /** Skip sniffing: read the data as this format. */
  format?: ModelFormat;
  /** The file's name, for the format hint and error messages; taken from the URL or the File when not given. */
  name?: string;
  /**
   * Reads a file, given its path resolved against the model's (default: fetch): the model itself when `source` is a path or
   * URL, and the files it refers to. In Node, pass one that reads from disk: `read: path => readFile(path)`.
   */
  read?: (uri: string) => Promise<Uint8Array>;
  /** The fetch to read with when `read` is not given (default: the global one). */
  fetch?: typeof fetch;
}

/**
 * Fetches (or reads) a model and everything it refers to: external glTF buffers and images, OBJ's .mtl files and their
 * textures, a PLY's texture. `source` is a URL or path, a File or Blob, or the model's bytes (pass `name` and `read` so its
 * references can be found). References are followed wherever the model points, absolute URLs and parent folders included:
 * for models from people you do not trust, on a server, pass a `read` that refuses what it should not serve.
 */
export async function loadModel(source: string | URL | Uint8Array | ArrayBuffer | Blob, options: LoadModelOptions = {}): Promise<AsciiModel> {
  const fetcher = options.fetch ?? (typeof fetch === 'function' ? fetch : undefined);
  const read = options.read ?? (fetcher ? (uri: string) => fetchBytes(fetcher, uri) : undefined);
  let bytes: Uint8Array, base: string | null, name = options.name;
  if (typeof source === 'string' || (typeof URL === 'function' && source instanceof URL)) {
    const href = typeof source === 'string' ? source : source.href;
    if (!read) throw new Error(`loadModel: there is no fetch here to read ${href}; pass \`read\``);
    try { bytes = toBytes(await read(href)); } catch (error) { throw new Error(`loadModel: could not read ${href} (${messageOf(error)})`); }
    base = href;
    name ??= fileName(href);
  } else if (isBlob(source)) {
    bytes = new Uint8Array(await source.arrayBuffer());
    const fileName = (source as { name?: unknown }).name;
    name ??= typeof fileName === 'string' && fileName ? fileName : undefined;
    base = name ?? null;
  } else {
    bytes = toBytes(source as Uint8Array | ArrayBuffer);
    base = name ?? null;
  }
  const format = options.format ?? modelFormat(bytes, name);
  if (!format) throw new Error(`Not a model asciify-engine can read${name ? ` (${name})` : ''}: it reads glTF and GLB, OBJ, STL and PLY`);

  // Each file is read once, however many references lead to it.
  const resources: Record<string, Uint8Array> = {}, reads = new Map<string, Promise<Uint8Array>>();
  const readOnce = (uri: string) => {
    let pending = reads.get(uri);
    if (!pending) reads.set(uri, (pending = read!(uri).then(toBytes)));
    return pending;
  };
  const fetchRef = async (ref: string, encoded: boolean): Promise<Uint8Array | null> => {
    if (!read) return null;
    try { return await readOnce(resolveRef(base, ref, encoded)); } catch { return null; }
  };
  if (format === 'gltf' || format === 'glb') {
    const refs = gltfReferences(bytes);
    await Promise.all([
      ...refs.buffers.map(async ref => {
        if (!read) throw new Error(`glTF: buffer ${ref} is a file of its own and there is no fetch here to read it; pass \`read\``);
        try { resources[ref] = await readOnce(resolveRef(base, ref, true)); } catch (error) { throw new Error(`glTF: could not read buffer ${ref} (${messageOf(error)})`); }
      }),
      ...refs.images.map(async ref => { const data = await fetchRef(ref, true); if (data) resources[ref] = data; }),
    ]);
  } else if (format === 'obj') {
    await Promise.all(objLibraries(bytes).map(async line => {
      // A library line holds one name (spaces and all) or several.
      let found: [string, Uint8Array][] = [];
      const whole = await fetchRef(line, false);
      if (whole) found = [[line, whole]];
      else if (/\s/.test(line)) for (const part of line.split(/\s+/)) { const data = await fetchRef(part, false); if (data) found.push([part, data]); }
      await Promise.all(found.map(async ([library, data]) => {
        resources[library] = data;
        const dir = dirOf(cleanPath(library));
        await Promise.all(mtlTextures(decodeText(data)).map(async texture => {
          // A texture the MTL names by a path that is not there (an absolute path from the author's disk, often) is
          // looked for next to the model too.
          const key = joinPath(dir, cleanPath(texture));
          const image = (await fetchRef(key, false)) ?? (baseOf(key) !== key ? await fetchRef(baseOf(key), false) : null);
          if (image) resources[key] = image;
        }));
      }));
    }));
  } else if (format === 'ply') {
    await Promise.all(plyTextures(bytes).map(async texture => { const data = await fetchRef(texture, false); if (data) resources[texture] = data; }));
  }
  return parseModel(bytes, { format, name, resources });
}

/**
 * Decodes each texture's bytes into `image` with the decoder given (asciify-engine/decode's, or your own). Textures it
 * cannot decode (it returns null or throws) are left without an image; one texture shared by several materials is decoded
 * once. Returns a new model; the one given is not changed.
 */
export function decodeModelTextures(model: AsciiModel, decode: (bytes: Uint8Array, mimeType: string | null) => { width: number; height: number; data: Uint8Array } | null): AsciiModel {
  const done = new Map<ModelTexture, ModelTexture>();
  const materials = model.materials.map(material => {
    const texture = material.texture;
    if (!texture || texture.image || !texture.bytes) return material;
    let next = done.get(texture);
    if (!next) {
      let image: ModelTexture['image'] = null;
      try {
        const out = decode(texture.bytes, texture.mimeType);
        if (out && Number.isInteger(out.width) && Number.isInteger(out.height) && out.width > 0 && out.height > 0 && out.data && out.data.length >= out.width * out.height * 4) {
          image = { width: out.width, height: out.height, data: out.data instanceof Uint8Array ? out.data : new Uint8Array(out.data) };
        }
      } catch {
        image = null;
      }
      next = image ? { ...texture, image } : texture;
      done.set(texture, next);
    }
    return next === texture ? material : { ...material, texture: next };
  });
  return { ...model, materials };
}

async function fetchBytes(fetcher: typeof fetch, uri: string): Promise<Uint8Array> {
  const response = await fetcher(uri);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
  return new Uint8Array(await response.arrayBuffer());
}

const URL_LIKE = /^[a-z][a-z0-9+.-]*:/i, DRIVE = /^[a-z]:[\\/]/i;

/**
 * Where a reference points, from the model's location: a URL against a URL base (glTF's references are percent-encoded
 * already; OBJ's and PLY's are plain names), a file path against a file path.
 */
function resolveRef(base: string | null, ref: string, encoded: boolean): string {
  const clean = ref.trim().replace(/\\/g, '/');
  if (URL_LIKE.test(clean) && !DRIVE.test(clean)) return clean;
  if (base && URL_LIKE.test(base) && !DRIVE.test(base)) {
    try { return new URL(clean, base).href; } catch { /* a base such as blob: takes no relative paths; read it as a path */ }
  }
  return joinPath(dirOf(base ?? ''), encoded ? safeDecode(clean) : clean);
}

/** The file name at the end of a URL or path (none for data: URLs). */
function fileName(href: string): string | undefined {
  if (/^data:/i.test(href)) return undefined;
  const name = safeDecode(baseOf(href.replace(/[?#].*$/, '')));
  return name || undefined;
}

const isBlob = (value: unknown): value is Blob =>
  (typeof Blob === 'function' && value instanceof Blob) ||
  (!!value && typeof value === 'object' && !ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer) && typeof (value as Blob).arrayBuffer === 'function');

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
