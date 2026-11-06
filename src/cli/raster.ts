import { spawn } from 'node:child_process';
import { deflateSync, inflateSync } from 'node:zlib';
import { blockShape } from '../headless/format';
import type { AsciiGrid } from '../headless/grid';
import { CliError } from './args';
import { GLYPH_ATLAS } from './glyph-atlas';

/*
 * Grids drawn as pictures, for the command's PNG (APNG when animated), GIF and video output: printable ASCII from glyph
 * masks rasterised from DejaVu Sans Mono, and block elements, shades and braille drawn as exact shapes, each cell in its
 * colours over its background.
 */

export interface Raster { data: Uint8Array; width: number; height: number }
export interface RasterSettings {
  /** Cell height in pixels; the width is half of it. */
  size: number;
  /** Colours as [r, g, b]: the ink of an uncoloured grid, and the ground (null for transparent). */
  ink: [number, number, number];
  background: [number, number, number] | null;
  /** Use the grid's own colours. */
  color: boolean;
}

let atlas: Uint8Array | null = null;
const scaled = new Map<string, Uint8Array>();
/** A printable character's mask at w × h, averaged down (or up) from the atlas. */
function glyphMask(code: number, w: number, h: number): Uint8Array | null {
  if (code < GLYPH_ATLAS.first || code >= GLYPH_ATLAS.first + GLYPH_ATLAS.count) return null;
  const key = `${code}:${w}:${h}`;
  const known = scaled.get(key);
  if (known) return known;
  atlas ??= new Uint8Array(inflateSync(Buffer.from(GLYPH_ATLAS.data, 'base64')));
  const AW = GLYPH_ATLAS.width, AH = GLYPH_ATLAS.height, base = (code - GLYPH_ATLAS.first) * AW * AH;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // The atlas pixels this one covers, by area.
    const x0 = (x * AW) / w, x1 = ((x + 1) * AW) / w, y0 = (y * AH) / h, y1 = ((y + 1) * AH) / h;
    let sum = 0, area = 0;
    for (let ay = Math.floor(y0); ay < Math.ceil(y1); ay++) for (let ax = Math.floor(x0); ax < Math.ceil(x1); ax++) {
      const cover = (Math.min(ax + 1, x1) - Math.max(ax, x0)) * (Math.min(ay + 1, y1) - Math.max(ay, y0));
      if (cover <= 0) continue;
      sum += atlas[base + Math.min(AH - 1, ay) * AW + Math.min(AW - 1, ax)] * cover; area += cover;
    }
    mask[y * w + x] = area ? Math.round(sum / area) : 0;
  }
  scaled.set(key, mask);
  return mask;
}

/** A shape's mask: block elements and shades from their rectangles, braille as round dots. */
function shapeMask(ch: string, w: number, h: number): Uint8Array | null {
  const key = `${ch}:${w}:${h}`;
  const known = scaled.get(key);
  if (known) return known;
  const code = ch.codePointAt(0) ?? 0, block = blockShape(ch);
  let mask: Uint8Array | null = null;
  if (block) {
    mask = new Uint8Array(w * h);
    const level = Math.round(255 * (block.alpha ?? 1));
    for (const [x0, x1, y0, y1] of block.rects) {
      // Edges at exact fractions of the cell, partly covered pixels by their share.
      const px0 = (x0 / 8) * w, px1 = (x1 / 8) * w, py0 = (y0 / 24) * h, py1 = (y1 / 24) * h;
      for (let y = Math.floor(py0); y < Math.ceil(py1); y++) for (let x = Math.floor(px0); x < Math.ceil(px1); x++) {
        const cover = (Math.min(x + 1, px1) - Math.max(x, px0)) * (Math.min(y + 1, py1) - Math.max(y, py0));
        const i = y * w + x;
        if (i >= 0 && i < mask.length) mask[i] = Math.min(255, mask[i] + Math.round(level * cover));
      }
    }
  } else if (code >= 0x2801 && code <= 0x28ff) {
    mask = new Uint8Array(w * h);
    const bits = code - 0x2800, r = Math.max(0.6, Math.min(w / 4, h / 8) * 0.72);
    const dots: [number, number, number][] = [[0x01, 0, 0], [0x02, 0, 1], [0x04, 0, 2], [0x40, 0, 3], [0x08, 1, 0], [0x10, 1, 1], [0x20, 1, 2], [0x80, 1, 3]];
    for (const [bit, dx, dy] of dots) {
      if (!(bits & bit)) continue;
      const cx = ((dx + 0.5) / 2) * w, cy = ((dy + 0.5) / 4) * h;
      for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r); x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        // Coverage of the pixel by the disc, sampled 4 × 4.
        let inside = 0;
        for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) { const ddx = x + (sx + 0.5) / 4 - cx, ddy = y + (sy + 0.5) / 4 - cy; if (ddx * ddx + ddy * ddy <= r * r) inside++; }
        mask[y * w + x] = Math.max(mask[y * w + x], Math.round((inside / 16) * 255));
      }
    }
  }
  if (mask) scaled.set(key, mask);
  return mask;
}

const SURROGATE = /[\uD800-\uDBFF]/;

/** One grid as RGBA pixels. */
export function rasterize(grid: AsciiGrid, s: RasterSettings): Raster {
  const ch = Math.max(4, Math.round(s.size)), cw = Math.max(2, Math.round(ch / 2));
  const width = grid.columns * cw, height = grid.rows * ch, data = new Uint8Array(width * height * 4);
  const ground = s.background;
  if (ground) for (let i = 0; i < data.length; i += 4) { data[i] = ground[0]; data[i + 1] = ground[1]; data[i + 2] = ground[2]; data[i + 3] = 255; }
  const colors = s.color ? grid.colors : null, backs = s.color ? grid.backgrounds ?? null : null, alpha = grid.alpha ?? null;
  for (let r = 0; r < grid.rows; r++) {
    const line = grid.lines[r] ?? '', cells = SURROGATE.test(line) ? Array.from(line) : line.split('');
    for (let c = 0; c < grid.columns; c++) {
      const at = (r * grid.columns + c) * 3, cover = alpha ? alpha[r * grid.columns + c] : 255;
      // The cell's background, where the grid has one and the picture covers the cell.
      if (backs && cover === 255) {
        for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
          const o = ((r * ch + y) * width + c * cw + x) * 4;
          data[o] = backs[at]; data[o + 1] = backs[at + 1]; data[o + 2] = backs[at + 2]; data[o + 3] = 255;
        }
      }
      const glyph = cells[c] ?? ' ';
      if (glyph === ' ' || cover === 0) continue;
      const code = glyph.codePointAt(0) ?? 32;
      const mask = shapeMask(glyph, cw, ch) ?? glyphMask(code, cw, ch) ?? glyphMask(63, cw, ch);
      if (!mask) continue;
      const fr = colors ? colors[at] : s.ink[0], fg = colors ? colors[at + 1] : s.ink[1], fb = colors ? colors[at + 2] : s.ink[2];
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const m = mask[y * cw + x];
        if (!m) continue;
        const o = ((r * ch + y) * width + c * cw + x) * 4, a = m / 255, under = data[o + 3] / 255;
        // Over what is there (straight alpha).
        const outA = a + under * (1 - a);
        data[o] = Math.round((fr * a + data[o] * under * (1 - a)) / outA);
        data[o + 1] = Math.round((fg * a + data[o + 1] * under * (1 - a)) / outA);
        data[o + 2] = Math.round((fb * a + data[o + 2] * under * (1 - a)) / outA);
        data[o + 3] = Math.round(outA * 255);
      }
    }
  }
  return { data, width, height };
}

// PNG and APNG.
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function chunk(type: string, body: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'latin1');
  out.set(body, 8);
  let c = -1;
  for (let i = 4; i < 8 + body.length; i++) c = CRC[(c ^ out[i]) & 255] ^ (c >>> 8);
  out.writeUInt32BE((c ^ -1) >>> 0, 8 + body.length);
  return out;
}
function scanlines(f: Raster): Buffer {
  const stride = f.width * 4, raw = Buffer.alloc((stride + 1) * f.height);
  for (let y = 0; y < f.height; y++) raw.set(f.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return deflateSync(raw, { level: 9 });
}

/** One picture as a PNG, or several as an APNG that plays in browsers and on GitHub. */
export function encodePng(frames: Raster[], delays: number[], loop: boolean): Uint8Array {
  const { width, height } = frames[0];
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0); head.writeUInt32BE(height, 4); head[8] = 8; head[9] = 6;
  const parts: Buffer[] = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head)];
  if (frames.length > 1) {
    const actl = Buffer.alloc(8);
    actl.writeUInt32BE(frames.length, 0); actl.writeUInt32BE(loop ? 0 : 1, 4);
    parts.push(chunk('acTL', actl));
  }
  let sequence = 0;
  frames.forEach((frame, i) => {
    if (frames.length > 1) {
      const fctl = Buffer.alloc(26);
      fctl.writeUInt32BE(sequence++, 0); fctl.writeUInt32BE(width, 4); fctl.writeUInt32BE(height, 8);
      fctl.writeUInt16BE(Math.max(1, Math.round(delays[i] ?? 100)), 20); fctl.writeUInt16BE(1000, 22);
      parts.push(chunk('fcTL', fctl));
    }
    const data = scanlines(frame);
    if (i === 0) parts.push(chunk('IDAT', data));
    else { const body = Buffer.alloc(4 + data.length); body.writeUInt32BE(sequence++, 0); body.set(data, 4); parts.push(chunk('fdAT', body)); }
  });
  parts.push(chunk('IEND', new Uint8Array(0)));
  return new Uint8Array(Buffer.concat(parts));
}

/** Frames as a GIF (through gifenc, which comes with the engine): a palette of up to 256 colours a frame. */
export async function encodeGif(frames: Raster[], delays: number[], loop: boolean): Promise<Uint8Array> {
  type Gifenc = {
    GIFEncoder(): { writeFrame(index: Uint8Array, w: number, h: number, options: Record<string, unknown>): void; finish(): void; bytes(): Uint8Array };
    quantize(rgba: Uint8Array, colors: number, options?: Record<string, unknown>): number[][];
    applyPalette(rgba: Uint8Array, palette: number[][], format?: string): Uint8Array;
  };
  // gifenc is CommonJS: under Node's ESM its functions sit on the default export.
  const loaded = await import('gifenc') as unknown as Partial<Gifenc> & { default?: Gifenc };
  const { GIFEncoder, quantize, applyPalette } = (typeof loaded.GIFEncoder === 'function' ? loaded : loaded.default) as Gifenc;
  const gif = GIFEncoder();
  frames.forEach((frame, i) => {
    const palette = quantize(frame.data, 256, { format: 'rgba4444', oneBitAlpha: true });
    const index = applyPalette(frame.data, palette, 'rgba4444');
    const transparent = palette.findIndex(colour => colour[3] === 0);
    gif.writeFrame(index, frame.width, frame.height, {
      palette, delay: Math.max(20, Math.round(delays[i] ?? 100)), ...(i === 0 ? { repeat: loop ? 0 : -1 } : {}),
      ...(transparent >= 0 ? { transparent: true, transparentIndex: transparent } : {}),
    });
  });
  gif.finish();
  return gif.bytes();
}

/** Frames as an MP4 (H.264) or WebM (VP9) through ffmpeg. */
export function encodeVideo(frames: Raster[], fps: number, file: string, format: 'mp4' | 'webm'): Promise<void> {
  const { width, height } = frames[0];
  const codec = format === 'mp4' ? ['-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-movflags', '+faststart', '-pix_fmt', 'yuv420p'] : ['-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0', '-pix_fmt', 'yuv420p'];
  const args = ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-framerate', String(fps), '-i', 'pipe:0', '-an',
    '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', ...codec, file];
  return new Promise((done, fail) => {
    let child;
    try { child = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] }); } catch { fail(new CliError('Writing video needs ffmpeg on your PATH (https://ffmpeg.org/download.html).')); return; }
    let errors = '';
    child.stderr.on('data', chunk => { errors += chunk; });
    child.on('error', () => fail(new CliError('Writing video needs ffmpeg on your PATH (https://ffmpeg.org/download.html).')));
    child.on('close', code => (code === 0 ? done() : fail(new CliError(`ffmpeg could not write ${file}: ${errors.trim().split('\n').pop() ?? code}`))));
    // Transparent pixels over black: video has no alpha.
    const flat = (f: Raster) => { const d = Buffer.from(f.data); for (let i = 3; i < d.length; i += 4) if (d[i] < 255) { const a = d[i] / 255; d[i - 3] *= a; d[i - 2] *= a; d[i - 1] *= a; d[i] = 255; } return d; };
    (async () => {
      for (const frame of frames) if (!child.stdin.write(flat(frame))) await new Promise(r => child.stdin.once('drain', r));
      child.stdin.end();
    })().catch(fail);
  });
}

/** A CSS hex colour as [r, g, b]. */
export function rgbOf(hex: string): [number, number, number] {
  const s = hex.replace('#', ''), full = s.length === 3 ? s.replace(/./g, c => c + c) : s;
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}
