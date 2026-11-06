import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { decodeImage, imageFormat } from '../decode';
import { decodeModelTextures, loadModel, modelFormat, withNormals } from '../model/parse';
import { MODEL_SHAPES, shapeModel, type ModelShape } from '../model/shapes';
import type { AsciiModel } from '../model/types';
import { CliError } from './args';

/* Reading what the command was given: a picture, an animation, a video, a 3D model or a built-in shape. */

export interface Picture { data: Uint8Array; width: number; height: number; delay: number }

export type Source =
  | { kind: 'image'; name: string; width: number; height: number; frames: Picture[]; loop: number }
  | { kind: 'video'; name: string; input: string[]; width: number; height: number; fps: number; live: boolean }
  | { kind: 'model'; name: string; model: AsciiModel };

const VIDEO = /\.(mp4|m4v|mov|webm|mkv|avi|wmv|flv|mpe?g|ogv|ts|m2ts|3gp|gifv)$/i;
const SHAPE_NAMES: Record<string, ModelShape> = { donut: 'torus', ...Object.fromEntries(MODEL_SHAPES.map(name => [name, name])) };

let ffmpegKnown: boolean | null = null;
/** Whether ffmpeg (and ffprobe) can be run. */
export function hasFfmpeg() {
  if (ffmpegKnown === null) {
    try { ffmpegKnown = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0 && spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0; }
    catch { ffmpegKnown = false; }
  }
  return ffmpegKnown;
}

async function readStdin(): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return new Uint8Array(Buffer.concat(chunks));
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new CliError(`Could not fetch ${url}: ${response.status} ${response.statusText}.`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Reads the input named on the command line. */
export async function openSource(input: string, options: { webcam: boolean; maxFrames: number }): Promise<Source> {
  if (options.webcam) return camera();
  const remote = /^https?:\/\//i.test(input);
  if (!remote && input !== '-' && !existsSync(input)) {
    const shape = SHAPE_NAMES[input.toLowerCase()];
    if (shape) return { kind: 'model', name: input, model: shapeModel(shape) };
    throw new CliError(`No such file: ${input}`);
  }
  if (!remote && input !== '-' && VIDEO.test(input)) return video(input);
  const bytes = input === '-' ? await readStdin() : remote ? await fetchBytes(input) : new Uint8Array(await readFile(input));
  const name = input === '-' ? 'stdin' : input;
  if (!bytes.length) throw new CliError(`${name} is empty.`);

  const model = modelFormat(bytes, name === 'stdin' ? undefined : name);
  if (model) {
    const read = remote
      ? (uri: string) => fetchBytes(new URL(uri, input).href)
      : async (uri: string) => {
        if (input === '-') throw new CliError(`The model refers to ${uri}; read it from a file rather than standard input.`);
        return new Uint8Array(await readFile(resolve(dirname(input), decodeURIComponent(uri))));
      };
    let loaded = await loadModel(bytes, { format: model, name, read });
    if (!loaded.normals && loaded.indices.length) loaded = withNormals(loaded);
    loaded = decodeModelTextures(loaded, bytes => { try { const image = decodeImage(bytes, { maxFrames: 1 }); return { width: image.width, height: image.height, data: image.frames[0].data }; } catch { return null; } });
    return { kind: 'model', name, model: loaded };
  }

  if (imageFormat(bytes)) {
    const image = decodeImage(bytes, { maxFrames: options.maxFrames });
    return { kind: 'image', name, width: image.width, height: image.height, frames: image.frames.map(f => ({ ...f, width: image.width, height: image.height })), loop: image.loop };
  }
  // Formats of our own decoders' reach: sharp if installed, then ffmpeg.
  const viaSharp = await withSharp(bytes, options.maxFrames);
  if (viaSharp) return { ...viaSharp, name };
  if (hasFfmpeg() && input !== '-' && !remote) {
    const probed = probe(['-i', input]);
    if (probed && probed.frames !== 1) return { kind: 'video', name, input: ['-i', input], width: probed.width, height: probed.height, fps: probed.fps, live: false };
    if (probed) {
      const frame = await firstFrame(['-i', input], probed.width, probed.height);
      return { kind: 'image', name, width: probed.width, height: probed.height, frames: [{ data: frame, width: probed.width, height: probed.height, delay: 0 }], loop: 1 };
    }
  }
  throw new CliError(`Cannot read ${name}: not a format asciify-engine decodes (PNG, JPEG, GIF, BMP, PNM, QOI; glTF, OBJ, STL, PLY). Install sharp (npm i sharp) or ffmpeg for others.`);
}

// sharp, when the user has it: WebP, AVIF, HEIF, TIFF, SVG and animated WebP.
async function withSharp(bytes: Uint8Array, maxFrames: number): Promise<Omit<Extract<Source, { kind: 'image' }>, 'name'> | null> {
  let sharp: Sharp | null = null;
  try {
    const name = 'sharp';
    sharp = ((await import(/* @vite-ignore */ name)) as { default: Sharp }).default;
  } catch { return null; }
  if (!sharp) return null;
  try {
    const meta = await sharp(bytes).metadata();
    const pages = Math.min(maxFrames, meta.pages ?? 1);
    const { data, info } = await sharp(bytes, { animated: pages > 1, pages }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const height = info.pageHeight ?? info.height, width = info.width, frameBytes = width * height * 4;
    const frames: Picture[] = [];
    for (let i = 0; i < pages && (i + 1) * frameBytes <= data.length; i++) {
      frames.push({ data: new Uint8Array(data.buffer, data.byteOffset + i * frameBytes, frameBytes), width, height, delay: meta.delay?.[i] ?? (pages > 1 ? 100 : 0) });
    }
    return { kind: 'image', width, height, frames, loop: meta.loop ?? 0 };
  } catch { return null; }
}
type Sharp = (input: Uint8Array, options?: Record<string, unknown>) => SharpImage;
interface SharpImage {
  metadata(): Promise<{ pages?: number; delay?: number[]; loop?: number }>;
  ensureAlpha(): SharpImage;
  raw(): SharpImage;
  toBuffer(options: { resolveWithObject: true }): Promise<{ data: Buffer; info: { width: number; height: number; pageHeight?: number } }>;
}

interface Probed { width: number; height: number; fps: number; frames: number | null }
function probe(input: string[]): Probed | null {
  const result = spawnSync('ffprobe', ['-v', 'error', ...input.slice(0, -2), '-select_streams', 'v:0', '-show_entries', 'stream=width,height,avg_frame_rate,r_frame_rate,nb_frames:stream_side_data=rotation:stream_tags=rotate', '-of', 'json', input[input.length - 1]], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  try {
    const stream = JSON.parse(result.stdout).streams?.[0];
    if (!stream?.width) return null;
    const rate = (text: string | undefined) => { const [a, b] = (text ?? '').split('/').map(Number); return a > 0 && b > 0 ? a / b : 0; };
    const fps = rate(stream.avg_frame_rate) || rate(stream.r_frame_rate) || 25;
    const rotation = Math.abs(Number(stream.side_data_list?.[0]?.rotation ?? stream.tags?.rotate ?? 0)) % 180;
    const turned = rotation === 90;
    return { width: turned ? stream.height : stream.width, height: turned ? stream.width : stream.height, fps, frames: stream.nb_frames ? Number(stream.nb_frames) : null };
  } catch { return null; }
}

function video(path: string): Source {
  if (!hasFfmpeg()) throw new CliError(`Playing video needs ffmpeg on your PATH (https://ffmpeg.org/download.html).`);
  const probed = probe(['-i', path]);
  if (!probed) throw new CliError(`ffmpeg could not read ${path}.`);
  return { kind: 'video', name: path, input: ['-i', path], width: probed.width, height: probed.height, fps: probed.fps, live: false };
}

function camera(): Source {
  if (!hasFfmpeg()) throw new CliError('The webcam needs ffmpeg on your PATH (https://ffmpeg.org/download.html).');
  const input = process.platform === 'darwin' ? ['-f', 'avfoundation', '-framerate', '30', '-i', '0']
    : process.platform === 'linux' ? ['-f', 'v4l2', '-i', '/dev/video0']
      : null;
  if (!input) throw new CliError('--webcam works on macOS and Linux. Elsewhere, pass ffmpeg\'s camera input as a video file.');
  const probed = probe(input) ?? { width: 640, height: 480, fps: 30, frames: null };
  return { kind: 'video', name: 'webcam', input, width: probed.width, height: probed.height, fps: Math.min(30, probed.fps), live: true };
}

function firstFrame(input: string[], width: number, height: number): Promise<Uint8Array> {
  return new Promise((done, fail) => {
    const child = spawn('ffmpeg', ['-v', 'error', ...input, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.on('error', fail);
    child.on('close', () => {
      const data = Buffer.concat(chunks);
      if (data.length < width * height * 4) fail(new CliError('ffmpeg returned no picture.'));
      else done(new Uint8Array(data.buffer, data.byteOffset, width * height * 4));
    });
  });
}

/**
 * A video's frames through ffmpeg, scaled to `width` × `height`, at `fps` if given. Ends when the video does (or never,
 * with `loop` or a camera). `stop()` ends it early.
 */
export function videoFrames(source: Extract<Source, { kind: 'video' }>, width: number, height: number, options: { fps?: number | null; loop?: boolean; limit?: number }) {
  const filters = [...(options.fps ? [`fps=${options.fps}`] : []), `scale=${width}:${height}:flags=area`].join(',');
  const args = ['-v', 'error', ...(options.loop && !source.live ? ['-stream_loop', '-1'] : []), ...source.input, '-an', '-vf', filters, ...(options.limit ? ['-frames:v', String(options.limit)] : []), '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'];
  const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  const size = width * height * 4;
  async function* frames(): AsyncGenerator<Uint8Array> {
    let pending = Buffer.alloc(0);
    for await (const chunk of child.stdout) {
      pending = pending.length ? Buffer.concat([pending, chunk as Buffer]) : (chunk as Buffer);
      while (pending.length >= size) {
        yield new Uint8Array(pending.buffer.slice(pending.byteOffset, pending.byteOffset + size));
        pending = pending.subarray(size);
      }
    }
    const code: number | null = child.exitCode ?? await new Promise(r => child.once('close', r));
    if (code && code !== 255 && errors.trim()) throw new CliError(`ffmpeg: ${errors.trim().split('\n').pop()}`);
  }
  return { frames: frames(), stop: () => { if (child.exitCode === null) child.kill('SIGTERM'); } };
}
