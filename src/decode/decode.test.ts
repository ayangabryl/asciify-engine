import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { constants, deflateRawSync, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodeGif, decodeImage, decodeJpeg, decodePng, imageFormat, inflate, inflateRaw, type DecodedImage, type ImageFormat } from './index';

// Fixtures and expected results come from tests/decode-reference.py --fixtures (Pillow), so CI needs no Pillow.
const DIR = new URL('../../tests/fixtures/decode/', import.meta.url);
const read = (name: string) => new Uint8Array(readFileSync(new URL(name, DIR)));

interface Lossless { covers: string; width: number; height: number; loop: number; delays: number[]; sha256: string[] }
interface Lossy { covers: string; width: number; height: number; reference: string }
const expected = JSON.parse(readFileSync(new URL('expected.json', DIR), 'utf8')) as Record<string, Lossless | Lossy> & { '_motion-still': { sha256: string } };
const fixtures = Object.keys(expected).filter(name => !name.startsWith('_'));
const lossless = fixtures.filter(name => 'sha256' in expected[name]);
const jpegs = fixtures.filter(name => 'reference' in expected[name]);

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const FORMAT: Record<string, ImageFormat> = { png: 'png', gif: 'gif', bmp: 'bmp', pnm: 'pnm', qoi: 'qoi', jpeg: 'jpeg' };

/** PSNR and mean absolute difference over the RGB channels of two RGBA buffers. */
function compareRgb(a: Uint8Array, b: Uint8Array): { psnr: number; mad: number; max: number } {
  let squares = 0, sum = 0, max = 0, n = 0;
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a[i + c] - b[i + c]);
      squares += d * d;
      sum += d;
      max = Math.max(max, d);
      n++;
    }
  }
  return { psnr: squares === 0 ? Infinity : 10 * Math.log10((255 * 255 * n) / squares), mad: sum / n, max };
}

function wellFormed(img: DecodedImage): void {
  expect(img.frames.length).toBeGreaterThan(0);
  for (const f of img.frames) {
    expect(f.data).toBeInstanceOf(Uint8Array);
    expect(f.data.length).toBe(img.width * img.height * 4);
    // Each frame owns its buffer exactly, so new ImageData(new Uint8ClampedArray(data.buffer), w, h) is safe.
    expect(f.data.byteOffset).toBe(0);
    expect(f.data.buffer.byteLength).toBe(f.data.length);
  }
}

// A small seeded generator, so the mutation tests are the same every run.
function random(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// PNG chunks for hand-made files.
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function chunk(type: string, data: Uint8Array | number[] = []): Uint8Array {
  const body = new Uint8Array([...Array.from(type, ch => ch.charCodeAt(0)), ...data]);
  let crc = -1;
  for (const b of body) crc = CRC[(crc ^ b) & 255] ^ (crc >>> 8);
  const out = new Uint8Array(body.length + 8), view = new DataView(out.buffer);
  view.setUint32(0, body.length - 4);
  out.set(body, 4);
  view.setUint32(body.length + 4, ~crc >>> 0);
  return out;
}
const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const be32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function png(width: number, height: number, depth: number, type: number, raw: Uint8Array, extra: Uint8Array[] = []): Uint8Array {
  return join(SIGNATURE, chunk('IHDR', [...be32(width), ...be32(height), depth, type, 0, 0, 0]), ...extra, chunk('IDAT', deflateSync(raw)), chunk('IEND'));
}

describe('lossless formats decode exactly (bit for bit as Pillow, or the browser model where they differ)', () => {
  for (const name of lossless) {
    const e = expected[name] as Lossless;
    it(`${name}: ${e.covers}`, () => {
      const img = decodeImage(read(name));
      wellFormed(img);
      expect(img.format).toBe(FORMAT[name.split('/')[0]]);
      expect([img.width, img.height]).toEqual([e.width, e.height]);
      expect(img.frames.map(f => sha(f.data))).toEqual(e.sha256);
      expect(img.frames.map(f => f.delay)).toEqual(e.delays);
      expect(img.loop).toBe(e.loop);
    });
  }
});

describe('JPEG matches libjpeg-turbo (Pillow) to 40 dB PSNR and 1.5 mean absolute difference, usually exactly', () => {
  for (const name of jpegs) {
    const e = expected[name] as Lossy;
    it(`${name}: ${e.covers}`, () => {
      const img = decodeImage(read(name));
      wellFormed(img);
      expect(img.format).toBe('jpeg');
      expect([img.width, img.height]).toEqual([e.width, e.height]);
      const ref = decodePng(read(e.reference)).frames[0].data;
      const { psnr, mad } = compareRgb(img.frames[0].data, ref);
      expect(psnr).toBeGreaterThanOrEqual(40);
      expect(mad).toBeLessThanOrEqual(1.5);
      // Every fixture is in fact identical to libjpeg-turbo's output.
      expect(psnr).toBe(Infinity);
    });
  }

  it('decodes a real photo exactly as libjpeg-turbo does', () => {
    const img = decodeImage(new Uint8Array(readFileSync(new URL('../motion-still.jpg', DIR))));
    expect([img.width, img.height]).toEqual([768, 432]);
    expect(sha(img.frames[0].data)).toBe(expected['_motion-still'].sha256);
  });
});

describe('imageFormat', () => {
  it('names each fixture by its first bytes', () => {
    for (const name of fixtures) expect(imageFormat(read(name)), name).toBe(FORMAT[name.split('/')[0]]);
  });

  it('is null for anything else', () => {
    const cases = [[], [0x89, 0x50], [0xff, 0xd8], [0x42, 0x4d, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 99, 0, 0, 0], [0x50, 0x38, 0x0a], [0x50, 0x36], Array.from('RIFF....WEBP', c => c.charCodeAt(0)), Array.from('<svg', c => c.charCodeAt(0))];
    for (const c of cases) expect(imageFormat(new Uint8Array(c))).toBeNull();
    expect(() => decodeImage(new Uint8Array([1, 2, 3]))).toThrow(/^decodeImage: /);
  });
});

describe('decodeImage', () => {
  it('takes a Uint8Array, a view into a larger buffer, a Node Buffer or an ArrayBuffer', () => {
    const bytes = read('png/type6-8bit.png');
    const want = sha(decodeImage(bytes).frames[0].data);
    const padded = new Uint8Array(bytes.length + 20);
    padded.set(bytes, 7);
    expect(sha(decodeImage(padded.subarray(7, 7 + bytes.length)).frames[0].data)).toBe(want);
    expect(sha(decodeImage(Buffer.from(bytes)).frames[0].data)).toBe(want);
    expect(sha(decodeImage(bytes.slice().buffer).frames[0].data)).toBe(want);
  });

  it('rejects images above maxPixels, naming the format', () => {
    for (const [name, format] of [['png/type2-8bit.png', 'PNG'], ['jpeg/baseline-444.jpg', 'JPEG'], ['gif/loop-forever.gif', 'GIF'], ['bmp/24bit.bmp', 'BMP'], ['pnm/p6.ppm', 'PNM'], ['qoi/rgba.qoi', 'QOI']]) {
      expect(() => decodeImage(read(name), { maxPixels: 50 }), name).toThrow(new RegExp(`^${format}: image is too large`));
    }
  });

  it('rejects a side longer than 65535 whatever maxPixels says', () => {
    const wide = png(70000, 1, 8, 0, new Uint8Array(70001));
    expect(() => decodeImage(wide, { maxPixels: 1e12 })).toThrow(/^PNG: image is too large/);
    const qoi = new Uint8Array([0x71, 0x6f, 0x69, 0x66, 0, 1, 0x11, 0x70, 0, 0, 0, 1, 4, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(() => decodeImage(qoi, { maxPixels: 1e12 })).toThrow(/^QOI: image is too large/);
    const pnm = new TextEncoder().encode('P5 70000 1 255\n');
    expect(() => decodeImage(pnm, { maxPixels: 1e12 })).toThrow(/^PNM: image is too large/);
  });
});

describe('animation limits', () => {
  it('stops after maxFrames frames, keeping the loop count', () => {
    const gif = decodeImage(read('gif/disposal.gif'), { maxFrames: 2 });
    expect(gif.frames).toHaveLength(2);
    expect(gif.loop).toBe(0);
    const full = decodeImage(read('gif/disposal.gif'));
    expect(gif.frames.map(f => sha(f.data))).toEqual(full.frames.slice(0, 2).map(f => sha(f.data)));
    const apng = decodeImage(read('png/apng-dispose.png'), { maxFrames: 3 });
    expect(apng.frames).toHaveLength(3);
    expect(apng.loop).toBe(2);
    // One frame of an animation is still that animation's frame, with its delay.
    const first = decodeImage(read('gif/loop-forever.gif'), { maxFrames: 1 });
    expect(first.frames).toHaveLength(1);
    expect(first.frames[0].delay).toBe(50);
  });

  it('stops once the frames hold four times maxPixels pixels', () => {
    // 10 frames of 1 pixel on a 100 × 100 screen.
    const frame = [0x21, 0xf9, 4, 0, 10, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x4c, 0x01, 0];
    const gif = new Uint8Array([...Array.from('GIF89a', c => c.charCodeAt(0)), 100, 0, 100, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255, ...Array(10).fill(frame).flat(), 0x3b]);
    expect(decodeGif(gif).frames).toHaveLength(10);
    expect(decodeGif(gif, { maxPixels: 10_000 }).frames).toHaveLength(4);
  });
});

describe('PNG', () => {
  it('decodes image data cut short as far as it goes, the rest transparent', () => {
    const rows = new Uint8Array(40 * (1 + 40 * 4));
    for (let y = 0; y < 40; y++) for (let x = 0; x < 160; x++) rows[y * 161 + 1 + x] = (x * 7 + y * 13) & 255;
    const z = deflateSync(rows, { level: 0 });
    const cut = join(SIGNATURE, chunk('IHDR', [...be32(40), ...be32(40), 8, 6, 0, 0, 0]), chunk('IDAT', z.subarray(0, z.length >> 1)));
    const img = decodePng(cut).frames[0].data;
    expect(img[3]).toBe(7 * 3);
    expect(img[img.length - 1]).toBe(0);
    let done = 0;
    for (let y = 0; y < 40; y++) if (img[(y * 40 + 39) * 4 + 3] !== 0 || img[(y * 40 + 39) * 4] !== 0) done++;
    expect(done).toBeGreaterThan(10);
    expect(done).toBeLessThan(30);
  });

  it('throws on broken files, naming PNG', () => {
    const ok = read('png/type2-8bit.png');
    expect(() => decodePng(ok.subarray(0, 7))).toThrow(/^PNG: not a PNG/);
    expect(() => decodeImage(join(SIGNATURE, chunk('IEND')))).toThrow('PNG: IHDR is not the first chunk');
    expect(() => decodeImage(SIGNATURE)).toThrow('PNG: no IHDR chunk');
    expect(() => decodeImage(png(4, 4, 8, 5, new Uint8Array(20)))).toThrow(/^PNG: unknown colour type/);
    expect(() => decodeImage(png(4, 4, 4, 2, new Uint8Array(20)))).toThrow(/^PNG: bit depth 4 is not allowed/);
    expect(() => decodeImage(png(2, 2, 8, 0, new Uint8Array([9, 1, 2, 0, 1, 2])))).toThrow(/^PNG: bad filter type 9/);
    expect(() => decodeImage(png(2, 2, 8, 3, new Uint8Array(6)))).toThrow(/^PNG: palette image with no PLTE/);
    expect(() => decodeImage(png(2, 2, 8, 0, new Uint8Array(6), [chunk('CgBI', [0, 0, 0, 0])]))).toThrow(/^PNG: Apple's CgBI/);
    const bad = join(SIGNATURE, chunk('IHDR', [...be32(2), ...be32(2), 8, 0, 0, 0, 0]), chunk('IDAT', [0x78, 0x9c, 0xff, 0xff, 0xff]), chunk('IEND'));
    expect(() => decodeImage(bad)).toThrow(/^PNG: corrupt image data \(inflate: /);
  });

  it('skips unknown and ancillary chunks and ignores CRCs', () => {
    const plain = png(3, 2, 8, 0, new Uint8Array([0, 10, 20, 30, 0, 40, 50, 60]));
    const extra = png(3, 2, 8, 0, new Uint8Array([0, 10, 20, 30, 0, 40, 50, 60]), [chunk('gAMA', be32(45455)), chunk('zzZz', [1, 2, 3]), chunk('tEXt', Array.from('a\0b', c => c.charCodeAt(0)))]);
    extra[extra.length - 5] ^= 0xff; // break IEND's CRC
    expect(sha(decodeImage(extra).frames[0].data)).toBe(sha(decodeImage(plain).frames[0].data));
  });
});

describe('JPEG', () => {
  const base = read('jpeg/baseline-420.jpg');
  const sof = (() => { for (let i = 2; i < base.length; i++) if (base[i] === 0xff && base[i + 1] === 0xc0) return i; return -1; })();

  it('throws a clear error for what it does not decode', () => {
    const patched = (at: number, value: number) => { const b = base.slice(); b[at] = value; return b; };
    expect(() => decodeJpeg(patched(sof + 1, 0xc9))).toThrow('JPEG: arithmetic coding is not supported');
    expect(() => decodeJpeg(patched(sof + 1, 0xca))).toThrow('JPEG: arithmetic coding is not supported');
    expect(() => decodeJpeg(patched(sof + 1, 0xc3))).toThrow('JPEG: lossless JPEG is not supported');
    expect(() => decodeJpeg(patched(sof + 1, 0xc5))).toThrow('JPEG: hierarchical JPEG is not supported');
    expect(() => decodeJpeg(patched(sof + 4, 12))).toThrow('JPEG: 12-bit precision is not supported');
    const dnl = base.slice();
    dnl[sof + 5] = dnl[sof + 6] = 0;
    expect(() => decodeJpeg(dnl)).toThrow(/^JPEG: images whose height is given by a DNL marker/);
    expect(() => decodeJpeg(base.subarray(0, sof))).toThrow('JPEG: no frame header');
  });

  it('leaves the picture as stored with orientation: false', () => {
    const bytes = read('jpeg/orientation-6-ii.jpg');
    const upright = decodeImage(bytes), stored = decodeImage(bytes, { orientation: false });
    expect([stored.width, stored.height]).toEqual([upright.height, upright.width]);
    // Orientation 6 turns the stored picture a quarter clockwise: upright (x, y) is stored (y, h - 1 - x).
    const w = stored.width, h = stored.height, a = upright.frames[0].data, b = stored.frames[0].data;
    for (const [x, y] of [[0, 0], [5, 3], [h - 1, w - 1], [2, w - 2]]) {
      const i = (y * upright.width + x) * 4, j = ((h - 1 - x) * w + y) * 4;
      expect(Array.from(a.subarray(i, i + 4))).toEqual(Array.from(b.subarray(j, j + 4)));
    }
  });

  it('skips junk and fill bytes between markers', () => {
    const junk = join(base.subarray(0, sof), new Uint8Array([0x00, 0x12, 0x34, 0xff, 0xff, 0xff]), base.subarray(sof));
    expect(sha(decodeImage(junk).frames[0].data)).toBe(sha(decodeImage(base).frames[0].data));
  });

  it('decodes a progressive file cut short from the scans it has', () => {
    const full = read('jpeg/progressive-444.jpg');
    const want = decodeImage(full).frames[0].data;
    for (const fraction of [0.4, 0.7]) {
      const img = decodeImage(full.subarray(0, Math.floor(full.length * fraction)));
      wellFormed(img);
      expect(compareRgb(img.frames[0].data, want).psnr).toBeGreaterThan(15);
    }
  });
});

describe('GIF', () => {
  it('keeps the frames before a cut, and an LZW stream cut short draws what it has', () => {
    const bytes = read('gif/disposal.gif');
    const full = decodeImage(bytes);
    const cut = decodeImage(bytes.subarray(0, Math.floor(bytes.length * 0.6)));
    expect(cut.frames.length).toBeGreaterThan(1);
    expect(cut.frames.length).toBeLessThan(full.frames.length);
    expect(sha(cut.frames[0].data)).toBe(sha(full.frames[0].data));
  });

  it('throws for a file with no image, or a bad LZW code size', () => {
    expect(() => decodeImage(new Uint8Array([...Array.from('GIF89a', c => c.charCodeAt(0)), 4, 0, 4, 0, 0, 0, 0, 0x3b]))).toThrow('GIF: no image data');
    const bad = new Uint8Array([...Array.from('GIF89a', c => c.charCodeAt(0)), 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 1, 1, 1, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 15, 1, 0, 0, 0x3b]);
    expect(() => decodeImage(bad)).toThrow('GIF: bad LZW code size 15');
  });
});

describe('BMP, PNM and QOI', () => {
  it('throw for what they do not decode', () => {
    const bmp = read('bmp/24bit.bmp').slice();
    bmp[28] = 64; // 64 bits a pixel
    expect(() => decodeImage(bmp)).toThrow('BMP: 64 bits a pixel is not supported');
    const jpegBmp = read('bmp/24bit.bmp').slice();
    jpegBmp[30] = 4; // BI_JPEG
    expect(() => decodeImage(jpegBmp)).toThrow('BMP: embedded JPEG and PNG data are not supported');
    expect(() => decodeImage(new TextEncoder().encode('P5 2 2 0\n\0\0\0\0'))).toThrow('PNM: maxval 0 is out of range');
    expect(() => decodeImage(new TextEncoder().encode('P7\nWIDTH 2\nHEIGHT 2\nDEPTH 3\nMAXVAL 255\nTUPLTYPE GRAYSCALE\nENDHDR\n'))).toThrow(/^PNM: PAM tuple type GRAYSCALE needs depth 1/);
  });

  it('decode files cut short as far as they go', () => {
    for (const name of ['bmp/24bit.bmp', 'pnm/p6.ppm', 'pnm/p3.ppm', 'qoi/rgba.qoi']) {
      const bytes = read(name), full = decodeImage(bytes).frames[0].data;
      const img = decodeImage(bytes.subarray(0, Math.floor(bytes.length * 0.7)));
      const data = img.frames[0].data;
      // The start (the top rows; for a bottom-up BMP the bottom ones) is as before, the rest transparent.
      const bottomUp = name.startsWith('bmp');
      const keep = Math.floor(data.length * 0.3);
      if (bottomUp) expect(sha(data.subarray(data.length - keep))).toBe(sha(full.subarray(full.length - keep)));
      else expect(sha(data.subarray(0, keep))).toBe(sha(full.subarray(0, keep)));
      expect(bottomUp ? data[3] : data[data.length - 1]).toBe(0);
    }
  });
});

describe('inflate', () => {
  const rnd = random(1);
  const samples: [string, Uint8Array][] = [
    ['empty', new Uint8Array(0)],
    ['one byte', new Uint8Array([42])],
    ['random', Uint8Array.from({ length: 70_000 }, () => (rnd() * 256) | 0)],
    ['text-like', Uint8Array.from({ length: 200_000 }, (_, i) => 97 + ((i * i) % 7) + ((rnd() * 3) | 0))],
    ['long runs', Uint8Array.from({ length: 300_000 }, (_, i) => ((i / 1000) | 0) & 255)],
    ['short period', Uint8Array.from({ length: 100_000 }, (_, i) => [1, 2, 3][i % 3])],
    ['long period', Uint8Array.from({ length: 200_000 }, (_, i) => ((i % 300) * 7) & 255)],
  ];
  const options = [{ level: 0 }, { level: 1 }, { level: 6 }, { level: 9 }, { level: 9, strategy: constants.Z_FIXED }, { level: 9, strategy: constants.Z_HUFFMAN_ONLY }, { level: 9, strategy: constants.Z_RLE }, { level: 6, memLevel: 1 }];

  it('matches zlib for stored, fixed and dynamic blocks', () => {
    for (const [label, data] of samples) {
      for (const o of options) {
        const z = deflateSync(data, o), raw = deflateRawSync(data, o);
        expect(sha(inflate(new Uint8Array(z))), `${label} ${JSON.stringify(o)}`).toBe(sha(data));
        expect(sha(inflate(new Uint8Array(z), data.length))).toBe(sha(data));
        expect(sha(inflateRaw(new Uint8Array(raw)))).toBe(sha(data));
        // A wrong size hint only costs speed.
        expect(sha(inflateRaw(new Uint8Array(raw), 3))).toBe(sha(data));
      }
    }
  });

  it('throws on corrupt or cut-short streams', () => {
    const data = samples[3][1], z = new Uint8Array(deflateSync(data));
    expect(() => inflate(z.subarray(0, z.length >> 1))).toThrow('inflate: unexpected end of data');
    expect(() => inflate(z.subarray(0, 1))).toThrow('inflate: unexpected end of data');
    expect(() => inflate(new Uint8Array([0x78, 0x9c, 0x07]))).toThrow('inflate: invalid block type');
    expect(() => inflate(new Uint8Array([0x78, 0x9d, 0, 0]))).toThrow('inflate: not a zlib stream');
    expect(() => inflate(new Uint8Array([0x78, 0xbb, 0, 0, 0, 0]))).toThrow('inflate: zlib preset dictionaries are not supported');
    expect(() => inflateRaw(new Uint8Array([0x01, 0x05, 0x00, 0x00, 0x00]))).toThrow('inflate: corrupt stored block length');
    // A distance before the start of the output.
    expect(() => inflateRaw(new Uint8Array([0x03, 0x02, 0x00]))).toThrow('inflate: distance too far back');
  });
});

describe('robustness: mutated files never hang and only throw Errors that name the format', () => {
  const NAMES = /^(PNG|JPEG|GIF|BMP|PNM|QOI|decodeImage): /;
  for (const name of fixtures) {
    it(name, () => {
      const rnd = random(name.length * 7919 + name.charCodeAt(4));
      const original = read(name);
      for (let k = 0; k < 24; k++) {
        const b = original.slice();
        const kind = k % 4;
        if (kind === 0) {
          for (let i = 0; i < 1 + rnd() * 8; i++) b[(rnd() * b.length) | 0] = (rnd() * 256) | 0;
        } else if (kind === 1) {
          b.fill(0xff, (rnd() * b.length) | 0, (rnd() * b.length) | 0);
        } else if (kind === 2) {
          // Keep the signature, change the header.
          for (let i = 0; i < 3; i++) b[Math.min(b.length - 1, 6 + ((rnd() * 40) | 0))] = (rnd() * 256) | 0;
        } else {
          b.copyWithin((rnd() * b.length) | 0, (rnd() * b.length) | 0);
        }
        const input = kind === 3 && k % 8 === 3 ? b.subarray(0, (rnd() * b.length) | 0) : b;
        try {
          wellFormed(decodeImage(input, { maxPixels: 4_000_000 }));
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).message).toMatch(NAMES);
        }
      }
    });
  }
});
