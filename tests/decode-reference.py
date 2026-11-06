#!/usr/bin/env python3
"""
Reference checks for asciify-engine/decode (src/decode) against Pillow. Local only: it needs Pillow 12 and numpy, and
ImageMagick's `convert` for the JPEG layouts Pillow cannot write (4:1:1, 4:4:0, YCCK) when it is installed.

  python3 tests/decode-reference.py              compare a wide random set with Pillow, print a summary table, then time
                                                 the decoders on large images (and tests/fixtures/motion-still.jpg)
  python3 tests/decode-reference.py --fixtures   rewrite tests/fixtures/decode/, the small files and expected data the
                                                 unit tests (src/decode/decode.test.ts) read in CI, where there is no Pillow
  python3 tests/decode-reference.py --quick      the comparison on fewer sizes, and no timing

The decoders are bundled with the repo's esbuild and run in Node. Where Pillow and browsers disagree (GIF and APNG
compositing, GIF loop counts, 16-bit grey, tRNS at low bit depths) the expected pixels come from a small model here that
follows the spec and the browsers, and Pillow is checked only where the two agree.
"""

import argparse
import hashlib
import io
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import zlib

import numpy as np
from PIL import Image, ImageFile, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURES = os.path.join(ROOT, 'tests', 'fixtures', 'decode')
HAVE_MAGICK = shutil.which('convert') is not None


# ---------------------------------------------------------------------------------------------------------------- pictures

def photo(w, h, seed, noise=3.0):
    """Photo-like: smooth gradients, a few hard-edged shapes and a little noise. RGB, uint8."""
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:h, 0:w].astype(np.float64)
    img = np.zeros((h, w, 3))
    for c in range(3):
        a = rng.uniform(0.02, 0.12, 4)
        img[..., c] = 128 + 70 * np.sin(x * a[0] + y * a[1] + c * 2) + 45 * np.cos(x * a[2] - y * a[3])
    for _ in range(5):
        cx, cy, r = rng.uniform(0, w), rng.uniform(0, h), rng.uniform(2, max(3, min(w, h) / 3))
        img[(x - cx) ** 2 + (y - cy) ** 2 < r * r] = rng.uniform(0, 255, 3)
    img += rng.normal(0, noise, img.shape)
    return np.clip(np.round(img), 0, 255).astype(np.uint8)


def ramp_alpha(w, h, seed):
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:h, 0:w]
    a = (x * 255 // max(1, w - 1) + y * 37) % 256
    a[rng.random((h, w)) < 0.15] = 0
    a[rng.random((h, w)) < 0.15] = 255
    return a.astype(np.uint8)


def sha(a):
    return hashlib.sha256(np.ascontiguousarray(a, np.uint8).tobytes()).hexdigest()


# ------------------------------------------------------------------------------------------------------------------- PNG

def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)


def pack_rows(samples, depth):
    """Rows of samples (h, w, c) at a bit depth, as bytes: big-endian, sub-byte samples packed from the high bit."""
    h, w, c = samples.shape
    rows = []
    for y in range(h):
        flat = samples[y].reshape(-1).astype(np.int64)
        if depth == 16:
            rows.append(flat.astype('>u2').tobytes())
        elif depth == 8:
            rows.append(flat.astype(np.uint8).tobytes())
        else:
            per = 8 // depth
            pad = (-len(flat)) % per
            v = np.concatenate([flat, np.zeros(pad, np.int64)]).reshape(-1, per)
            shifts = 8 - depth * (np.arange(per) + 1)
            rows.append((v << shifts).sum(axis=1).astype(np.uint8).tobytes())
    return rows


def filter_row(kind, row, prev, bpp):
    """The encoder side of a PNG filter (it predicts from the original bytes, so it vectorises)."""
    x = np.frombuffer(row, np.uint8).astype(np.int64)
    b = np.frombuffer(prev, np.uint8).astype(np.int64) if prev is not None else np.zeros_like(x)
    a = np.concatenate([np.zeros(bpp, np.int64), x[:-bpp]])[: len(x)]
    c = np.concatenate([np.zeros(bpp, np.int64), b[:-bpp]])[: len(x)]
    if kind == 0:
        p = 0
    elif kind == 1:
        p = a
    elif kind == 2:
        p = b
    elif kind == 3:
        p = (a + b) // 2
    else:
        pp = a + b - c
        pa, pb, pc = np.abs(pp - a), np.abs(pp - b), np.abs(pp - c)
        p = np.where((pa <= pb) & (pa <= pc), a, np.where(pb <= pc, b, c))
    return ((x - p) & 255).astype(np.uint8).tobytes()


ADAM7 = [(0, 0, 8, 8), (4, 0, 8, 8), (0, 4, 4, 8), (2, 0, 4, 4), (0, 2, 2, 4), (1, 0, 2, 2), (0, 1, 1, 2)]


def png_data(samples, depth, interlace=False, filters=None):
    """The zlib stream of an image's filtered rows; filters cycle through `filters` (default: all five, row by row)."""
    h, w, c = samples.shape
    bpp = max(1, c * depth // 8)
    raw, k = bytearray(), 0
    for (x0, y0, dx, dy) in (ADAM7 if interlace else [(0, 0, 1, 1)]):
        sub = samples[y0::dy, x0::dx]
        if sub.shape[0] == 0 or sub.shape[1] == 0:
            continue
        prev = None
        for r in pack_rows(sub, depth):
            f = (filters or [0, 1, 2, 3, 4])[k % len(filters or [0, 1, 2, 3, 4])]
            raw += bytes([f]) + filter_row(f, r, prev, bpp)
            prev, k = r, k + 1
    return zlib.compress(bytes(raw), 9)


def png_bytes(samples, colortype, depth, palette=None, trns=None, interlace=False, filters=None, idat_size=None, extra=b''):
    h, w, _ = samples.shape
    z = png_data(samples, depth, interlace, filters)
    out = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, depth, colortype, 0, 0, int(interlace)))
    if palette is not None:
        out += chunk(b'PLTE', bytes(palette))
    if trns is not None:
        out += chunk(b'tRNS', bytes(trns))
    out += extra
    step = idat_size or max(1, len(z))
    for i in range(0, len(z), step):
        out += chunk(b'IDAT', z[i:i + step])
    return out + chunk(b'IEND', b'')


def png_expected(samples, colortype, depth, palette=None, trns=None):
    """RGBA as the decoder should give it: 16-bit samples keep their high byte; tRNS matches the sample at its own depth."""
    s = samples.astype(np.int64)
    h, w, _ = s.shape
    out = np.zeros((h, w, 4), np.uint8)
    mask = 0xffff if depth == 16 else (1 << depth) - 1
    to8 = (lambda v: v >> 8) if depth == 16 else (lambda v: v * (255 // mask))
    if colortype == 3:
        pal = np.zeros((256, 4), np.int64)
        pal[:, 3] = 255
        p = np.frombuffer(bytes(palette), np.uint8).reshape(-1, 3)
        pal[: len(p), :3] = p
        if trns is not None:
            t = np.frombuffer(bytes(trns), np.uint8)
            pal[: len(t), 3] = t
        return pal[s[..., 0]].astype(np.uint8)
    if colortype in (0, 4):
        out[..., 0] = out[..., 1] = out[..., 2] = to8(s[..., 0])
        out[..., 3] = to8(s[..., 1]) if colortype == 4 else 255
        if colortype == 0 and trns is not None:
            out[s[..., 0] == (struct.unpack('>H', bytes(trns))[0] & mask), 3] = 0
    else:
        for i in range(3):
            out[..., i] = to8(s[..., i])
        out[..., 3] = to8(s[..., 3]) if colortype == 6 else 255
        if colortype == 2 and trns is not None:
            t = [v & mask for v in struct.unpack('>HHH', bytes(trns))]
            out[(s[..., 0] == t[0]) & (s[..., 1] == t[1]) & (s[..., 2] == t[2]), 3] = 0
    return out


def png_samples(w, h, colortype, depth, seed):
    rng = np.random.default_rng(seed)
    top = (1 << depth) - 1
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[colortype]
    if depth >= 8:
        base = photo(w, h, seed).astype(np.int64)
        if depth == 16:
            base = base * 257 + rng.integers(0, 256, base.shape)
        chans = [base[..., 0], base[..., 1], base[..., 2]]
        if colortype in (0, 4):
            chans = [(chans[0] * 3 + chans[1] * 5 + chans[2] * 2) // 10]
        if colortype in (4, 6):
            a = ramp_alpha(w, h, seed).astype(np.int64)
            chans.append(a * 257 if depth == 16 else a)
        if colortype == 3:
            chans = [rng.integers(0, top + 1, (h, w))]
        return np.stack(chans, axis=-1)
    return rng.integers(0, top + 1, (h, w, channels))


def pillow_png_check(path, expected, colortype, depth, trns):
    """Pillow agrees with the model except for 16-bit grey and tRNS outside palettes at depths other than 8."""
    if colortype == 0 and depth == 16:
        return
    if trns is not None and colortype in (0, 2) and depth != 8:
        return
    got = np.asarray(Image.open(path).convert('RGBA'))
    if not np.array_equal(got, expected):
        raise SystemExit(f'Pillow disagrees with the PNG model for {path}')


# ------------------------------------------------------------------------------------------------------------------ APNG

def apng_bytes(w, h, frames, plays, hidden_default=None):
    """frames: dicts of x, y, rgba (h, w, 4), num, den, dispose, blend. hidden_default: RGBA written as IDAT but not shown."""
    seq = 0
    out = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    out += chunk(b'acTL', struct.pack('>II', len(frames), plays))
    if hidden_default is not None:
        out += chunk(b'IDAT', png_data(hidden_default, 8))
    for i, f in enumerate(frames):
        fh, fw = f['rgba'].shape[:2]
        out += chunk(b'fcTL', struct.pack('>IIIIIHHBB', seq, fw, fh, f['x'], f['y'], f['num'], f['den'], f['dispose'], f['blend']))
        seq += 1
        z = png_data(f['rgba'], 8)
        if i == 0 and hidden_default is None:
            out += chunk(b'IDAT', z)
        else:
            # Split one frame's data over two fdAT chunks.
            half = len(z) // 2 if i % 2 else len(z)
            for part in ([z[:half], z[half:]] if half < len(z) else [z]):
                out += chunk(b'fdAT', struct.pack('>I', seq) + part)
                seq += 1
    return out + chunk(b'IEND', b'')


def over(dst, src):
    """Source over destination, straight alpha, rounded as the decoder does."""
    d, s = dst.astype(np.int64), src.astype(np.int64)
    sa, da = s[..., 3:4], d[..., 3:4]
    k = da * (255 - sa)
    total = sa * 255 + k
    rgb = (s[..., :3] * sa * 255 + d[..., :3] * k + (total >> 1)) // np.maximum(total, 1)
    blended = np.concatenate([rgb, (total + 127) // 255], axis=-1)
    return np.where(sa == 0, d, np.where((sa == 255) | (da == 0), s, blended)).astype(np.uint8)


def play_delay(ms):
    return 100 if ms <= 10 else ms


def apng_expected(w, h, frames):
    canvas, outs, prev, saved = np.zeros((h, w, 4), np.uint8), [], None, None
    for i, f in enumerate(frames):
        fh, fw = f['rgba'].shape[:2]
        x, y = f['x'], f['y']
        if prev is not None:
            px, py, pw, ph, pd = prev
            if pd == 1:
                canvas[py:py + ph, px:px + pw] = 0
            elif pd == 2:
                canvas[py:py + ph, px:px + pw] = saved
        d = 1 if (i == 0 and f['dispose'] == 2) else f['dispose']
        saved = canvas[y:y + fh, x:x + fw].copy() if d == 2 else None
        region = canvas[y:y + fh, x:x + fw]
        canvas[y:y + fh, x:x + fw] = f['rgba'] if f['blend'] == 0 else over(region, f['rgba'])
        outs.append(canvas.copy())
        prev = (x, y, fw, fh, d)
    return outs, [play_delay(f['num'] * 1000 / (f['den'] or 100)) for f in frames]


# ------------------------------------------------------------------------------------------------------------------- GIF

def lzw_encode(indices, min_size, deferred=False):
    """GIF LZW. Codes grow to 12 bits; a full table is cleared, or with `deferred` kept as it is (a "deferred clear")."""
    clear, eoi = 1 << min_size, (1 << min_size) + 1
    codes = [(clear, min_size + 1)]
    table, size, nxt = {}, min_size + 1, eoi + 1
    prefix = None
    for v in (int(i) for i in indices):
        if prefix is None:
            prefix = v
            continue
        if (prefix, v) in table:
            prefix = table[(prefix, v)]
            continue
        codes.append((prefix, size))
        if nxt < 4096:
            table[(prefix, v)] = nxt
            nxt += 1
            if nxt > (1 << size) and size < 12:
                size += 1
        elif not deferred:
            codes.append((clear, size))
            table, size, nxt = {}, min_size + 1, eoi + 1
        prefix = v
    if prefix is not None:
        codes.append((prefix, size))
    codes.append((eoi, size))
    acc, nbits, data = 0, 0, bytearray()
    for code, s in codes:
        acc |= code << nbits
        nbits += s
        while nbits >= 8:
            data.append(acc & 255)
            acc >>= 8
            nbits -= 8
    if nbits:
        data.append(acc & 255)
    return bytes(data)


def sub_blocks(data):
    out = bytearray()
    for i in range(0, len(data), 255):
        part = data[i:i + 255]
        out += bytes([len(part)]) + part
    return bytes(out + b'\x00')


def colour_table(colours):
    n = 2
    while n < len(colours):
        n *= 2
    flat = bytearray()
    for c in list(colours) + [(0, 0, 0)] * (n - len(colours)):
        flat += bytes(c)
    return bytes(flat), n.bit_length() - 2


def interlace_order(h):
    return [y for start, step in ((0, 8), (4, 8), (2, 4), (1, 2)) for y in range(start, h, step)]


def gif_bytes(w, h, frames, gct=None, loop=None, app=b'NETSCAPE2.0', version=b'89a'):
    """frames: dicts of x, y, idx (h, w), and optionally lct, delay (cs), disposal, transparent, interlace, gce, min_size."""
    flags, table = 0, b''
    if gct is not None:
        table, bits = colour_table(gct)
        flags = 0x80 | (7 << 4) | bits
    out = b'GIF' + version + struct.pack('<HHBBB', w, h, flags, 0, 0) + table
    if loop is not None:
        out += b'\x21\xff\x0b' + app + b'\x03\x01' + struct.pack('<H', loop) + b'\x00'
    for f in frames:
        idx = np.asarray(f['idx'])
        fh, fw = idx.shape
        if f.get('gce', True):
            packed = (f.get('disposal', 0) << 2) | (1 if f.get('transparent') is not None else 0)
            out += b'\x21\xf9\x04' + bytes([packed]) + struct.pack('<H', f.get('delay', 0)) + bytes([f.get('transparent') or 0]) + b'\x00'
        packed, lct = 0, b''
        if f.get('lct') is not None:
            lct, bits = colour_table(f['lct'])
            packed = 0x80 | bits
        if f.get('interlace'):
            packed |= 0x40
            idx = idx[interlace_order(fh)]
        out += b'\x2c' + struct.pack('<HHHHB', f['x'], f['y'], fw, fh, packed) + lct
        min_size = f.get('min_size', 8)
        out += bytes([min_size]) + sub_blocks(lzw_encode(idx.reshape(-1), min_size, f.get('deferred', False)))
    return out + b'\x3b'


def gif_expected(w, h, frames, gct=None, loop=None):
    """Browser compositing: transparent canvas; disposal 2 clears to transparent; 3 restores what was under the frame."""
    canvas, outs, prev, saved = np.zeros((h, w, 4), np.uint8), [], None, None
    for f in frames:
        idx = np.asarray(f['idx'])
        fh, fw = idx.shape
        x, y = f['x'], f['y']
        x1, y1 = min(w, x + fw), min(h, y + fh)
        if prev is not None:
            px, py, px1, py1, pd = prev
            if pd == 2:
                canvas[py:py1, px:px1] = 0
            elif pd == 3:
                canvas[py:py1, px:px1] = saved
        d = f.get('disposal', 0)
        d = 3 if d == 4 else 0 if d > 4 else d
        saved = canvas[y:y1, x:x1].copy() if d == 3 else None
        table = f.get('lct') if f.get('lct') is not None else gct
        if table is not None:
            pal = np.array(list(table), np.uint8).reshape(-1, 3)
            sub = idx[: y1 - y, : x1 - x].astype(np.int64)
            draw = sub < len(pal)
            if f.get('transparent') is not None:
                draw &= sub != f['transparent']
            region = canvas[y:y1, x:x1]
            region[draw, :3] = pal[sub[draw]]
            region[draw, 3] = 255
        outs.append(canvas.copy())
        prev = (x, y, x1, y1, d)
    if len(frames) == 1:
        return outs, [0], 1
    return outs, [play_delay(f.get('delay', 0) * 10) for f in frames], (1 if loop is None else 0 if loop == 0 else loop + 1)


# ------------------------------------------------------------------------------------------------------------------- BMP

def bmp_bytes(w, h, bpp, rows, palette=None, header=40, compression=0, masks=None, top_down=False, data=None, masks_after=False):
    """rows: pixel values (h, w) top row first: indices for 8 bits or fewer, else the raw pixel integers."""
    if data is None:
        stride = (w * bpp + 31) // 32 * 4
        data = bytearray()
        for y in (range(h) if top_down else range(h - 1, -1, -1)):
            row = bytearray(stride)
            for x in range(w):
                v = int(rows[y][x])
                if bpp < 8:
                    row[x * bpp // 8] |= v << (8 - bpp - (x * bpp) % 8)
                else:
                    row[x * bpp // 8: x * bpp // 8 + bpp // 8] = v.to_bytes(bpp // 8, 'little')
            data += row
    pal = b''
    if palette is not None:
        pal = b''.join(bytes([b, g, r]) + (b'' if header == 12 else b'\x00') for (r, g, b) in palette)
    extra = b''
    if masks_after:
        extra = b''.join(struct.pack('<I', m) for m in masks)
    if header == 12:
        dib = struct.pack('<IHHHH', 12, w, h, 1, bpp)
    else:
        dib = struct.pack('<IiiHHIIiiII', header, w, -h if top_down else h, 1, bpp, compression, len(data), 2835, 2835,
                          len(palette) if palette is not None else 0, 0)
        if header >= 52:
            m = list(masks or [0, 0, 0, 0]) + [0] * 4
            dib += struct.pack('<III', *m[:3])
            if header >= 56:
                dib += struct.pack('<I', m[3])
        dib = dib[:header] if header < len(dib) else dib + b'\x00' * (header - len(dib))
        if header >= 108:
            dib = dib[:56] + b'BGRs' + dib[60:]
    offset = 14 + len(dib) + len(extra) + len(pal)
    return b'BM' + struct.pack('<IHHI', offset + len(data), 0, 0, offset) + dib + extra + pal + bytes(data)


def bmp_field(v, mask):
    """An n-bit field to 8 bits as Pillow does: v × 255 / max, rounded down."""
    if not mask:
        return None
    shift = (mask & -mask).bit_length() - 1
    top = mask >> shift
    return ((v & mask) >> shift) * 255 // top


def bmp_expected_masked(rows, masks):
    h, w = len(rows), len(rows[0])
    out = np.zeros((h, w, 4), np.uint8)
    for y in range(h):
        for x in range(w):
            v = int(rows[y][x])
            c = [bmp_field(v, m) for m in masks[:3]]
            a = bmp_field(v, masks[3]) if len(masks) > 3 and masks[3] else 255
            out[y, x] = [0 if q is None else q for q in c] + [a]
    return out


def rle_encode(rows, four, odd_absolute=True):
    """RLE8 or RLE4, bottom-up: runs of one value, absolute runs for the rest, an end-of-line per row."""
    out = bytearray()
    for row in reversed([list(map(int, r)) for r in rows]):
        x, n = 0, len(row)
        while x < n:
            run = 1
            while x + run < n and run < 255 and row[x + run] == row[x]:
                run += 1
            if run >= 3 or n - x < 3:
                out += bytes([run, (row[x] << 4) | row[x] if four else row[x]])
                x += run
                continue
            # An absolute run until the next repeat of three.
            end = x
            while end < n and end - x < 255 and not (end + 2 < n and row[end] == row[end + 1] == row[end + 2]):
                end += 1
            count = end - x
            if count < 3:
                out += bytes([1, (row[x] << 4) | row[x] if four else row[x]])
                x += 1
                continue
            if four and count % 2 and not odd_absolute:
                count -= 1
            px = row[x:x + count]
            if four:
                packed = bytes(((px[i] << 4) | (px[i + 1] if i + 1 < count else 0)) for i in range(0, count, 2))
            else:
                packed = bytes(px)
            out += bytes([0, count]) + packed + (b'\x00' if len(packed) % 2 else b'')
            x += count
        out += b'\x00\x00'
    return bytes(out + b'\x00\x01')


# ------------------------------------------------------------------------------------------------------------------- PNM

def pnm_scale(v, maxval):
    """round(v / maxval × 255), halves to even: Python's round, as Pillow uses."""
    return np.vectorize(lambda s: min(255, round(int(s) / maxval * 255)))(v).astype(np.uint8)


def to_rgba(chans):
    h, w = chans[0].shape
    out = np.zeros((h, w, 4), np.uint8)
    if len(chans) >= 3:
        out[..., 0], out[..., 1], out[..., 2] = chans[0], chans[1], chans[2]
    else:
        out[..., 0] = out[..., 1] = out[..., 2] = chans[0]
    out[..., 3] = chans[-1] if len(chans) in (2, 4) else 255
    return out


# ------------------------------------------------------------------------------------------------------------------- QOI

def qoi_encode(rgba, channels=4):
    """The reference QOI encoder: RUN, INDEX, DIFF, LUMA, RGB and RGBA chunks."""
    h, w, _ = rgba.shape
    out = bytearray(b'qoif' + struct.pack('>IIBB', w, h, channels, 0))
    index = [(0, 0, 0, 0)] * 64
    prev, run = (0, 0, 0, 255), 0
    px_all = [tuple(int(v) for v in p) for p in rgba.reshape(-1, 4)]
    for i, px in enumerate(px_all):
        if px == prev:
            run += 1
            if run == 62 or i == len(px_all) - 1:
                out.append(0xc0 | (run - 1))
                run = 0
            continue
        if run:
            out.append(0xc0 | (run - 1))
            run = 0
        h_ = (px[0] * 3 + px[1] * 5 + px[2] * 7 + px[3] * 11) % 64
        if index[h_] == px:
            out.append(h_)
        else:
            index[h_] = px
            if px[3] == prev[3]:
                dr, dg, db = ((px[0] - prev[0] + 128) & 255) - 128, ((px[1] - prev[1] + 128) & 255) - 128, ((px[2] - prev[2] + 128) & 255) - 128
                dr_dg, db_dg = dr - dg, db - dg
                if -2 <= dr <= 1 and -2 <= dg <= 1 and -2 <= db <= 1:
                    out.append(0x40 | ((dr + 2) << 4) | ((dg + 2) << 2) | (db + 2))
                elif -32 <= dg <= 31 and -8 <= dr_dg <= 7 and -8 <= db_dg <= 7:
                    out += bytes([0x80 | (dg + 32), ((dr_dg + 8) << 4) | (db_dg + 8)])
                else:
                    out += bytes([0xfe, px[0], px[1], px[2]])
            else:
                out += bytes([0xff, *px])
        prev = px
    return bytes(out + b'\x00' * 7 + b'\x01')


# ------------------------------------------------------------------------------------------------------------------ JPEG

def magick_jpeg(src, args):
    with tempfile.TemporaryDirectory() as d:
        Image.fromarray(src).save(os.path.join(d, 'in.png'))
        subprocess.run(['convert', os.path.join(d, 'in.png'), *args, os.path.join(d, 'out.jpg')], check=True)
        return open(os.path.join(d, 'out.jpg'), 'rb').read()


def pillow_jpeg(src, mode='RGB', **kw):
    b = io.BytesIO()
    Image.fromarray(src).convert(mode).save(b, 'JPEG', **kw)
    return b.getvalue()


def exif(orientation, big_endian):
    e = '>' if big_endian else '<'
    tiff = (b'MM\x00\x2a' if big_endian else b'II\x2a\x00') + struct.pack(e + 'IH', 8, 1)
    tiff += struct.pack(e + 'HHI', 0x0112, 3, 1) + struct.pack(e + 'HH', orientation, 0) + struct.pack(e + 'I', 0)
    return b'Exif\x00\x00' + tiff


def jpeg_reference(data):
    """Pillow's decode, upright by the EXIF orientation, the rest of a cut-short file filled as libjpeg does."""
    ImageFile.LOAD_TRUNCATED_IMAGES = True
    try:
        return np.asarray(ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert('RGB'))
    finally:
        ImageFile.LOAD_TRUNCATED_IMAGES = False


def strip_dht(data):
    """The JPEG without its DHT segments, as a motion-JPEG frame: decoders then use the standard tables."""
    out, i = bytearray(data[:2]), 2
    while i < len(data):
        m = data[i + 1]
        if m == 0xda:
            out += data[i:]
            break
        n = struct.unpack('>H', data[i + 2:i + 4])[0]
        if m != 0xc4:
            out += data[i:i + 2 + n]
        i += 2 + n
    return bytes(out)


# --------------------------------------------------------------------------------------------------------- the decoders

class Decoder:
    """The TypeScript decoders, bundled with the repo's esbuild and run in Node on a list of files."""

    RUNNER = r'''
import { decodeImage } from './decode.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const [mode, out, ...files] = process.argv.slice(2);
if (mode === 'decode') {
  // Writes <out>/<n>.rgba (the frames, one after another) and <out>/<n>.json for the nth file.
  files.forEach((f, i) => {
    const n = `${out}/${Number(process.env.FIRST) + i}`;
    try {
      const img = decodeImage(readFileSync(f));
      writeFileSync(n + '.rgba', Buffer.concat(img.frames.map(x => Buffer.from(x.data.buffer, x.data.byteOffset, x.data.byteLength))));
      writeFileSync(n + '.json', JSON.stringify({ width: img.width, height: img.height, loop: img.loop, delays: img.frames.map(x => x.delay), frames: img.frames.length }));
    } catch (e) {
      writeFileSync(n + '.json', JSON.stringify({ error: String(e && e.message || e) }));
    }
  });
} else {
  // Timing: 25 runs, the first 5 as warm-up; the median and the best of the rest, and the first (cold) run.
  const results = {};
  for (const f of files) {
    const bytes = readFileSync(f), times = [];
    let img;
    for (let i = 0; i < 25; i++) { const t = performance.now(); img = decodeImage(bytes); times.push(performance.now() - t); }
    const warm = times.slice(5).sort((a, b) => a - b);
    results[f] = { median: warm[10], best: warm[0], first: times[0], width: img.width, height: img.height };
  }
  writeFileSync(process.env.TIMING_OUT, JSON.stringify(results));
}
'''

    def __init__(self):
        self.dir = tempfile.mkdtemp(prefix='decode-ref-')
        esbuild = os.path.join(ROOT, 'node_modules', '.bin', 'esbuild')
        subprocess.run([esbuild, os.path.join(ROOT, 'src', 'decode', 'index.ts'), '--bundle', '--format=esm', '--platform=neutral',
                        '--outfile=' + os.path.join(self.dir, 'decode.mjs'), '--log-level=warning'], check=True)
        open(os.path.join(self.dir, 'run.mjs'), 'w').write(self.RUNNER)

    def decode(self, paths):
        out = os.path.join(self.dir, 'out')
        os.makedirs(out, exist_ok=True)
        for i in range(0, len(paths), 200):
            subprocess.run(['node', os.path.join(self.dir, 'run.mjs'), 'decode', out, *paths[i:i + 200]], check=True, env={**os.environ, 'FIRST': str(i)})
        results = {}
        for i, p in enumerate(paths):
            n = os.path.join(out, str(i))
            meta = json.load(open(n + '.json'))
            if 'error' not in meta:
                meta['frames_rgba'] = np.fromfile(n + '.rgba', np.uint8).reshape(meta['frames'], meta['height'], meta['width'], 4)
            results[p] = meta
        return results

    def time(self, paths):
        # One process a file, so one file's garbage is not collected in another's timing.
        results = {}
        for p in paths:
            out = os.path.join(self.dir, 'timing.json')
            subprocess.run(['node', os.path.join(self.dir, 'run.mjs'), 'time', self.dir, p], check=True, env={**os.environ, 'TIMING_OUT': out})
            results.update(json.load(open(out)))
        return results

    def close(self):
        shutil.rmtree(self.dir, ignore_errors=True)


def psnr_mad(a, b):
    d = np.abs(a[..., :3].astype(np.int64) - b[..., :3].astype(np.int64))
    mse = float((d.astype(np.float64) ** 2).mean())
    return (float('inf') if mse == 0 else 10 * np.log10(255 * 255 / mse)), float(d.mean()), int(d.max()), float((d == 0).all(axis=-1).mean())


# ------------------------------------------------------------------------------------------------------------- fixtures

class Fixtures:
    """Writes the unit tests' fixtures and the expected results: hashes of each frame for the lossless formats (exact), and
    a lossless PNG of Pillow's decode for each JPEG (compared by PSNR)."""

    def __init__(self, root):
        self.root = root
        self.expected = {}

    def write(self, name, data):
        path = os.path.join(self.root, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, 'wb').write(data)
        return path

    def lossless(self, name, data, frames, covers, delays=None, loop=1):
        path = self.write(name, data)
        h, w = frames[0].shape[:2]
        self.expected[name] = {'covers': covers, 'width': w, 'height': h, 'loop': loop, 'delays': delays or [0],
                               'sha256': [sha(f) for f in frames]}
        return path

    def jpeg(self, name, data, covers):
        self.write(name, data)
        ref = jpeg_reference(data)
        ref_name = name[:-4] + '.ref.png'
        Image.fromarray(ref).save(os.path.join(self.root, ref_name), optimize=True)
        self.expected[name] = {'covers': covers, 'width': ref.shape[1], 'height': ref.shape[0], 'reference': ref_name}


def pillow_frames(path):
    im = Image.open(path)
    out = []
    for i in range(getattr(im, 'n_frames', 1)):
        im.seek(i)
        out.append(np.asarray(im.convert('RGBA')))
    return out


def check_visible(path, ours, kind):
    """Pillow's frames against the model where both are opaque (they composite transparency differently)."""
    theirs = pillow_frames(path)
    if len(theirs) != len(ours):
        raise SystemExit(f'{kind}: Pillow sees {len(theirs)} frames in {path}, the model {len(ours)}')
    for a, b in zip(ours, theirs):
        both = (a[..., 3] == 255) & (b[..., 3] == 255)
        if not np.array_equal(a[both][:, :3], b[both][:, :3]) or both.mean() < 0.3:
            raise SystemExit(f'{kind}: Pillow disagrees with the model for {path}')


def make_fixtures(fx):
    rng = np.random.default_rng(2024)

    # PNG: every colour type and depth, plain and Adam7, every filter, several IDAT chunks.
    for ct, depths in [(0, [1, 2, 4, 8, 16]), (2, [8, 16]), (3, [1, 2, 4, 8]), (4, [8, 16]), (6, [8, 16])]:
        for d in depths:
            for interlace in (False, True):
                w, h = (23, 17)
                s = png_samples(w, h, ct, d, ct * 100 + d)
                palette = rng.integers(0, 256, (1 << d) * 3).astype(np.uint8).tobytes() if ct == 3 else None
                data = png_bytes(s, ct, d, palette=palette, interlace=interlace, idat_size=61 if interlace else None)
                exp = png_expected(s, ct, d, palette)
                name = f'png/type{ct}-{d}bit{"-adam7" if interlace else ""}.png'
                path = fx.lossless(name, data, [exp], f'PNG colour type {ct}, {d}-bit{", Adam7 interlaced, 61-byte IDAT chunks" if interlace else ""}, all five filters')
                pillow_png_check(path, exp, ct, d, None)
    # tRNS for each type that takes it.
    trns_cases = [(0, 8, 'grey 8-bit'), (0, 2, 'grey 2-bit'), (0, 16, 'grey 16-bit'), (2, 8, 'RGB 8-bit'), (2, 16, 'RGB 16-bit'), (3, 4, 'palette 4-bit, alpha table shorter than the palette')]
    for ct, d, label in trns_cases:
        s = png_samples(19, 13, ct, d, 7 + d)
        palette = trns = None
        if ct == 3:
            palette = rng.integers(0, 256, 16 * 3).astype(np.uint8).tobytes()
            trns = bytes([0, 64, 128, 200, 255, 30])
        else:
            key = s[3, 4].copy()
            s[rng.random(s.shape[:2]) < 0.2] = key
            trns = b''.join(struct.pack('>H', int(v)) for v in key)
        data = png_bytes(s, ct, d, palette=palette, trns=trns)
        exp = png_expected(s, ct, d, palette, trns)
        path = fx.lossless(f'png/trns-type{ct}-{d}bit.png', data, [exp], f'PNG tRNS transparency, {label}')
        pillow_png_check(path, exp, ct, d, trns)
    # Tiny and edge sizes: passes with no pixels at all.
    for (w, h, ct, d) in [(1, 1, 6, 8), (1, 9, 0, 8), (9, 1, 3, 1), (3, 3, 2, 16)]:
        s = png_samples(w, h, ct, d, w * 10 + h)
        palette = bytes([255, 0, 0, 0, 0, 255]) if ct == 3 else None
        data = png_bytes(s, ct, d, palette=palette, interlace=True)
        exp = png_expected(s, ct, d, palette)
        path = fx.lossless(f'png/tiny-{w}x{h}-adam7.png', data, [exp], f'PNG {w}x{h}, Adam7 with empty passes')
        pillow_png_check(path, exp, ct, d, None)
    # One filter per image, so each filter is also seen on its own over a whole picture.
    for f in range(5):
        s = png_samples(31, 9, 6, 8, 50 + f)
        fx.lossless(f'png/filter{f}.png', png_bytes(s, 6, 8, filters=[f]), [png_expected(s, 6, 8)], f'PNG with filter {f} on every row')

    # APNG.
    w, h = 32, 24
    base = np.dstack([photo(w, h, 1), np.full((h, w), 255, np.uint8)])
    def patch(fw, fh, seed, alpha=True):
        a = np.dstack([photo(fw, fh, seed), ramp_alpha(fw, fh, seed) if alpha else np.full((fh, fw), 255, np.uint8)])
        return a
    frames = [
        {'x': 0, 'y': 0, 'rgba': base, 'num': 1, 'den': 10, 'dispose': 0, 'blend': 0},
        {'x': 4, 'y': 3, 'rgba': patch(16, 12, 2, False), 'num': 1, 'den': 0, 'dispose': 0, 'blend': 0},
        {'x': 10, 'y': 8, 'rgba': patch(12, 10, 3), 'num': 33, 'den': 1000, 'dispose': 0, 'blend': 1},
    ]
    outs, delays = apng_expected(w, h, frames)
    fx.lossless('png/apng-basic.png', apng_bytes(w, h, frames, 0), outs, 'APNG: the default image is frame 1; regions, source and over blends; delays 1/10 s, 1/0 (den 0 means 100, and 10 ms plays as 100), 33/1000; loops forever', delays, 0)
    frames = [
        {'x': 0, 'y': 0, 'rgba': base, 'num': 5, 'den': 100, 'dispose': 1, 'blend': 0},
        {'x': 2, 'y': 2, 'rgba': patch(20, 14, 4), 'num': 5, 'den': 100, 'dispose': 2, 'blend': 1},
        {'x': 8, 'y': 6, 'rgba': patch(14, 12, 5), 'num': 5, 'den': 100, 'dispose': 0, 'blend': 1},
        {'x': 0, 'y': 10, 'rgba': patch(32, 14, 6), 'num': 7, 'den': 100, 'dispose': 1, 'blend': 0},
        {'x': 6, 'y': 0, 'rgba': patch(10, 24, 7), 'num': 7, 'den': 100, 'dispose': 0, 'blend': 1},
    ]
    outs, delays = apng_expected(w, h, frames)
    fx.lossless('png/apng-dispose.png', apng_bytes(w, h, frames, 2), outs, 'APNG dispose background and previous, blend over with partial alpha, frame data split over fdAT chunks; plays twice', delays, 2)
    hidden = np.dstack([photo(w, h, 9), np.full((h, w), 255, np.uint8)])
    frames = [
        {'x': 0, 'y': 0, 'rgba': patch(32, 24, 10, False), 'num': 1, 'den': 4, 'dispose': 2, 'blend': 0},
        {'x': 5, 'y': 5, 'rgba': patch(9, 9, 11), 'num': 1, 'den': 4, 'dispose': 2, 'blend': 1},
        {'x': 20, 'y': 12, 'rgba': patch(9, 9, 12), 'num': 1, 'den': 4, 'dispose': 0, 'blend': 1},
    ]
    outs, delays = apng_expected(w, h, frames)
    fx.lossless('png/apng-hidden-default.png', apng_bytes(w, h, frames, 1, hidden_default=hidden), outs, 'APNG whose default image is not part of the animation (skipped); a first frame disposed to "previous" clears instead', delays, 1)
    frames = [{'x': 0, 'y': 0, 'rgba': base, 'num': 1, 'den': 10, 'dispose': 0, 'blend': 0}]
    fx.lossless('png/apng-one-frame.png', apng_bytes(w, h, frames, 0), [base], 'APNG of a single frame: a still')
    # Pillow's own APNG writer, opaque frames (Pillow and the spec agree there).
    ims = [Image.fromarray(np.dstack([photo(w, h, 20 + i), np.full((h, w), 255, np.uint8)]), 'RGBA') for i in range(3)]
    ims[1].paste((255, 0, 0, 255), (4, 4, 12, 12))
    b = io.BytesIO()
    ims[0].save(b, 'PNG', save_all=True, append_images=ims[1:], duration=[40, 80, 120], loop=0, disposal=[0, 1, 2], blend=[0, 0, 0])
    path = fx.write('png/apng-pillow.png', b.getvalue())
    theirs = pillow_frames(path)
    fx.lossless('png/apng-pillow.png', b.getvalue(), theirs, "APNG from Pillow's writer (it crops frames to what changed)", [40, 80, 120], 0)

    # GIF.
    gct = [tuple(int(v) for v in c) for c in rng.integers(0, 256, (16, 3))]
    def idx(w, h, n, seed):
        r = np.random.default_rng(seed)
        y, x = np.mgrid[0:h, 0:w]
        return ((x // 3 + y // 2 + r.integers(0, 2, (h, w))) % n).astype(np.uint8)
    def gif(name, w, h, frames, covers, gct=gct, loop=None, app=b'NETSCAPE2.0', version=b'89a', canvas=None, check=True):
        data = gif_bytes(w, h, frames, gct, loop, app, version)
        cw, ch = canvas or (w, h)
        outs, delays, plays = gif_expected(cw, ch, frames, gct, loop)
        path = fx.lossless(name, data, outs, covers, delays, plays)
        if check:
            check_visible(path, outs, 'GIF')
    gif('gif/still-87a.gif', 32, 24, [{'x': 0, 'y': 0, 'idx': idx(32, 24, 16, 1), 'gce': False, 'min_size': 4}], 'GIF87a still, global colour table, no extensions', version=b'87a')
    full = [{'x': 0, 'y': 0, 'idx': idx(32, 24, 16, 2 + i), 'delay': d, 'min_size': 4} for i, d in enumerate([5, 0, 1])]
    gif('gif/loop-forever.gif', 32, 24, full, 'GIF animation, NETSCAPE2.0 loop 0 (forever); delays 5 cs, then 0 and 1 cs that play as 100 ms', loop=0)
    gif('gif/loop-count.gif', 32, 24, full[:2], 'GIF NETSCAPE2.0 loop count 2: plays 3 times, as in browsers', loop=2)
    gif('gif/no-loop.gif', 32, 24, full[:2], 'GIF animation without a loop extension: plays once, as in browsers')
    gif('gif/animexts.gif', 32, 24, full, 'GIF ANIMEXTS1.0 loop count 4 (5 plays)', loop=4, app=b'ANIMEXTS1.0')
    disp = [
        {'x': 0, 'y': 0, 'idx': idx(40, 30, 16, 10), 'delay': 10, 'disposal': 1},
        {'x': 5, 'y': 4, 'idx': idx(20, 15, 16, 11), 'delay': 10, 'disposal': 2, 'transparent': 3},
        {'x': 12, 'y': 10, 'idx': idx(16, 12, 16, 12), 'delay': 10, 'disposal': 3, 'transparent': 5},
        {'x': 0, 'y': 0, 'idx': np.where(idx(40, 30, 16, 13) < 12, 7, idx(40, 30, 16, 14)).astype(np.uint8), 'delay': 10, 'disposal': 0, 'transparent': 7},
        {'x': 30, 'y': 20, 'idx': idx(10, 10, 16, 15), 'delay': 10, 'disposal': 4},
        {'x': 28, 'y': 18, 'idx': idx(12, 12, 16, 16), 'delay': 10, 'disposal': 0, 'transparent': 0},
    ]
    gif('gif/disposal.gif', 40, 30, disp, 'GIF transparency, frame offsets, disposal 1, 2 (clears to transparent), 3 (restores) and 4 (read as 3)', loop=0, check=False)
    inter = [
        {'x': 0, 'y': 0, 'idx': idx(29, 21, 16, 20), 'delay': 7, 'interlace': True, 'lct': gct[::-1]},
        {'x': 3, 'y': 5, 'idx': idx(17, 11, 4, 21), 'delay': 7, 'interlace': True, 'lct': gct[:4], 'min_size': 2},
    ]
    gif('gif/interlaced.gif', 29, 21, inter, 'GIF interlaced frames (all four passes, odd heights) with local colour tables', loop=0, check=False)
    tables = [
        {'x': 0, 'y': 0, 'idx': idx(24, 16, 2, 30), 'lct': [(0, 0, 0), (250, 240, 10)], 'min_size': 2, 'delay': 4},
        {'x': 0, 'y': 0, 'idx': idx(24, 16, 16, 31), 'lct': [tuple(int(v) for v in c) for c in rng.integers(0, 256, (16, 3))], 'min_size': 4, 'delay': 4},
        {'x': 0, 'y': 0, 'idx': idx(24, 16, 256, 32) * 0 + rng.integers(0, 256, (16, 24)).astype(np.uint8), 'lct': [tuple(int(v) for v in c) for c in rng.integers(0, 256, (256, 3))], 'min_size': 8, 'delay': 4},
    ]
    gif('gif/local-tables.gif', 24, 16, tables, 'GIF with no global table: local tables of 2, 16 and 256 colours, LZW code sizes 2, 4 and 8', gct=None, loop=0)
    noise = rng.integers(0, 256, (64, 96)).astype(np.uint8)
    big = [tuple(int(v) for v in c) for c in rng.integers(0, 256, (256, 3))]
    gif('gif/deferred-clear.gif', 96, 64, [{'x': 0, 'y': 0, 'idx': noise, 'deferred': True}], 'GIF LZW whose table fills and is kept without a clear code (deferred clear), 12-bit codes', gct=big)
    gif('gif/clear-when-full.gif', 96, 64, [{'x': 0, 'y': 0, 'idx': noise}], 'GIF LZW cleared each time the table fills', gct=big)
    gif('gif/no-gce.gif', 32, 24, [{'x': 0, 'y': 0, 'idx': idx(32, 24, 16, 40 + i), 'gce': False, 'min_size': 4} for i in range(2)], 'GIF frames with no graphic control extension: 100 ms each', loop=0)
    gif('gif/big-first-frame.gif', 16, 12, [
        {'x': 2, 'y': 1, 'idx': idx(20, 14, 16, 50), 'delay': 10},
        {'x': 0, 'y': 0, 'idx': idx(30, 20, 16, 51), 'delay': 10, 'transparent': 2},
    ], 'GIF whose first frame is bigger than the screen (it grows to fit, as in browsers); a later, bigger frame is clipped', loop=0, canvas=(22, 15), check=False)

    # BMP.
    w, h = 13, 9
    def pal(n, seed):
        return [tuple(int(v) for v in c) for c in np.random.default_rng(seed).integers(0, 256, (n, 3))]
    def bmp_palette(name, bpp, n, covers, header=40, compression=0, data=None, top_down=False, rows=None, check=True, transparent=None):
        p = pal(n, bpp + n)
        rows = rows if rows is not None else np.random.default_rng(bpp).integers(0, n, (h, w))
        raw = bmp_bytes(w, h, bpp, rows, p, header=header, compression=compression, data=data, top_down=top_down)
        exp = np.zeros((h, w, 4), np.uint8)
        table = np.array(p + [(0, 0, 0)] * (256 - n), np.uint8)
        exp[..., :3] = table[np.asarray(rows)]
        exp[..., 3] = 255
        if transparent is not None:
            exp[transparent] = 0
        path = fx.lossless(name, raw, [exp], covers)
        if check and not np.array_equal(np.asarray(Image.open(path).convert('RGBA')), exp):
            raise SystemExit(f'Pillow disagrees with the BMP model for {path}')
    bmp_palette('bmp/1bit.bmp', 1, 2, 'BMP 1-bit, palette')
    bmp_palette('bmp/2bit.bmp', 2, 4, 'BMP 2-bit (Windows CE)', check=False)
    bmp_palette('bmp/4bit.bmp', 4, 12, 'BMP 4-bit with a 12-colour palette')
    bmp_palette('bmp/8bit.bmp', 8, 256, 'BMP 8-bit, 256 colours')
    bmp_palette('bmp/8bit-topdown.bmp', 8, 200, 'BMP 8-bit, top-down', top_down=True)
    bmp_palette('bmp/8bit-os2.bmp', 8, 256, 'BMP 8-bit with an OS/2 1.x (12-byte) header and 3-byte palette entries', header=12)
    bmp_palette('bmp/8bit-os2v2.bmp', 8, 256, 'BMP 8-bit with an OS/2 2.x (64-byte) header', header=64)
    rows8 = np.repeat(np.random.default_rng(3).integers(0, 40, (h, 4)), [5, 1, 3, 4], axis=1)
    bmp_palette('bmp/rle8.bmp', 8, 40, 'BMP RLE8: runs and absolute runs', compression=1, data=rle_encode(rows8, False), rows=rows8)
    rows4 = np.repeat(np.random.default_rng(4).integers(0, 16, (h, 5)), [4, 2, 3, 2, 2], axis=1)
    bmp_palette('bmp/rle4.bmp', 4, 16, 'BMP RLE4: runs and even absolute runs', compression=2, data=rle_encode(rows4, True, odd_absolute=False), rows=rows4)
    rows4b = np.random.default_rng(5).integers(0, 16, (h, w))
    bmp_palette('bmp/rle4-odd.bmp', 4, 16, 'BMP RLE4 with odd-length absolute runs', compression=2, data=rle_encode(rows4b, True), rows=rows4b, check=False)
    # RLE8 with a delta and early end-of-lines: the skipped pixels are transparent.
    delta_rows = np.full((h, w), 3)
    rle = bytearray()
    skipped = np.zeros((h, w), bool)
    for y in range(h):
        if y == 2:
            rle += bytes([4, 7, 0, 2, 3, 2])  # 4 pixels, then a delta: 3 right, 2 up
            skipped[2, 4:] = True
            skipped[3, :] = True
            skipped[4, :7] = True
            rle += bytes([w - 7, 7, 0, 0])
            delta_rows[2, :4] = 7
            delta_rows[4, 7:] = 7
            continue
        if y in (3, 4):
            continue
        if y == 6:
            rle += bytes([5, 9, 0, 0])
            delta_rows[6, :5] = 9
            skipped[6, 5:] = True
            continue
        rle += bytes([w, 3, 0, 0])
    rle += b'\x00\x01'
    # Rows run bottom-up in the file.
    flipped = np.flipud(delta_rows)
    bmp_palette('bmp/rle8-delta.bmp', 8, 16, 'BMP RLE8 with a delta and early end-of-line: skipped pixels are transparent, as in browsers', compression=1, data=bytes(rle), rows=flipped, check=False, transparent=np.flipud(skipped))

    pixels = photo(w, h, 60).astype(np.int64)
    alpha = ramp_alpha(w, h, 60).astype(np.int64)
    def bmp_masked(name, bpp, masks, covers, header=40, compression=3, masks_after=None, check=True, topdown=False):
        bits = [(m & -m).bit_length() - 1 if m else 0 for m in masks]
        widths = [bin(m).count('1') for m in masks]
        chans = [pixels[..., 0], pixels[..., 1], pixels[..., 2], alpha]
        rows = np.zeros((h, w), np.int64)
        for c in range(len(masks)):
            if masks[c]:
                rows |= ((chans[c] * ((1 << widths[c]) - 1) + 127) // 255) << bits[c]
        rows |= np.random.default_rng(1).integers(0, 2, (h, w)) * (((1 << bpp) - 1) & ~sum(masks)) if bpp > 16 else 0
        after = masks_after if masks_after is not None else (header == 40 and compression in (3, 6))
        data = bmp_bytes(w, h, bpp, rows, header=header, compression=compression, masks=masks, masks_after=after, top_down=topdown)
        exp = bmp_expected_masked(rows, list(masks) + [0] * (4 - len(masks)))
        path = fx.lossless(name, data, [exp], covers)
        if check and not np.array_equal(np.asarray(Image.open(path).convert('RGBA')), exp):
            raise SystemExit(f'Pillow disagrees with the BMP model for {path}')
    bmp_masked('bmp/16bit-555.bmp', 16, (0x7c00, 0x3e0, 0x1f), 'BMP 16-bit BI_RGB (5-5-5)', compression=0)
    bmp_masked('bmp/16bit-565.bmp', 16, (0xf800, 0x7e0, 0x1f), 'BMP 16-bit BI_BITFIELDS 5-6-5, masks after a 40-byte header')
    bmp_masked('bmp/16bit-565-v2.bmp', 16, (0xf800, 0x7e0, 0x1f), 'BMP 16-bit 5-6-5 with a V2 (52-byte) header', header=52)
    bmp_masked('bmp/24bit.bmp', 24, (0xff0000, 0xff00, 0xff), 'BMP 24-bit BI_RGB, rows padded to 4 bytes', compression=0)
    bmp_masked('bmp/24bit-topdown.bmp', 24, (0xff0000, 0xff00, 0xff), 'BMP 24-bit, top-down', compression=0, topdown=True)
    bmp_masked('bmp/32bit-rgb.bmp', 32, (0xff0000, 0xff00, 0xff), 'BMP 32-bit BI_RGB: the fourth byte is not alpha (opaque)', compression=0)
    bmp_masked('bmp/32bit-v3-alpha.bmp', 32, (0xff0000, 0xff00, 0xff, 0xff000000), 'BMP 32-bit with a V3 (56-byte) header and an alpha mask', header=56)
    bmp_masked('bmp/32bit-v4-rgba.bmp', 32, (0xff, 0xff00, 0xff0000, 0xff000000), 'BMP 32-bit V4 header, RGBA byte order masks', header=108)
    bmp_masked('bmp/32bit-v5-alpha.bmp', 32, (0xff0000, 0xff00, 0xff, 0xff000000), 'BMP 32-bit V5 header with alpha', header=124)
    bmp_masked('bmp/32bit-v5-1010102.bmp', 32, (0x3ff00000, 0xffc00, 0x3ff, 0xc0000000), 'BMP 32-bit V5, 10-10-10-2 masks (wider than 8 bits)', header=124, check=False)
    bmp_masked('bmp/32bit-alphabitfields.bmp', 32, (0xff0000, 0xff00, 0xff, 0xff000000), 'BMP BI_ALPHABITFIELDS: four masks after a 40-byte header', compression=6, check=False)
    bmp_masked('bmp/16bit-4444.bmp', 16, (0xf00, 0xf0, 0xf, 0xf000), 'BMP 16-bit 4-4-4-4 with alpha (V5)', header=124, check=False)

    # PNM.
    w, h = 11, 7
    grey = photo(w, h, 70)[..., 1].astype(np.int64)
    rgb = photo(w, h, 71).astype(np.int64)
    a = ramp_alpha(w, h, 72).astype(np.int64)
    def pnm(name, data, chans, covers, check=True):
        exp = to_rgba(chans)
        path = fx.lossless(name, data, [exp], covers)
        if check and not np.array_equal(np.asarray(Image.open(path).convert('RGBA')), exp):
            raise SystemExit(f'Pillow disagrees with the PNM model for {path}')
    bits = (grey > 128).astype(np.int64)
    p1 = 'P1\n# a comment\n%d %d\n' % (w, h) + '\n'.join((''.join(map(str, r)) if y % 2 else ' '.join(map(str, r))) + (' # end of row' if y == 3 else '') for y, r in enumerate(bits)) + '\n'
    pnm('pnm/p1.pbm', p1.encode(), [np.where(bits == 1, 0, 255)], 'PBM plain (P1): comments, digits with and without spaces between them')
    def plain(magic, maxval, chans):
        lines = [f'{magic}\n# made for the tests\n{w} {h}\n{maxval}\n']
        flat = np.stack(chans, axis=-1).reshape(h, -1)
        for y, r in enumerate(flat):
            lines.append(' '.join(map(str, r)) + ('  # a comment in the data\n' if y == 2 else '\n'))
        return ''.join(lines).encode()
    g15 = grey * 15 // 255
    pnm('pnm/p2-maxval15.pgm', plain('P2', 15, [g15]), [pnm_scale(g15, 15)], 'PGM plain (P2), maxval 15 (scaled with rounding), comments in the data')
    pnm('pnm/p3.ppm', plain('P3', 255, [rgb[..., i] for i in range(3)]), [rgb[..., i] for i in range(3)], 'PPM plain (P3), maxval 255')
    r1000 = rgb * 1000 // 255
    pnm('pnm/p3-maxval1000.ppm', plain('P3', 1000, [r1000[..., i] for i in range(3)]), [pnm_scale(r1000[..., i], 1000) for i in range(3)], 'PPM plain (P3), maxval 1000')
    packed = b''.join(np.packbits(r).tobytes() for r in bits.astype(np.uint8))
    pnm('pnm/p4.pbm', b'P4\n%d %d\n' % (w, h) + packed, [np.where(bits == 1, 0, 255)], 'PBM raw (P4), rows padded to whole bytes')
    pnm('pnm/p5.pgm', b'P5 %d %d 255\n' % (w, h) + grey.astype(np.uint8).tobytes(), [grey], 'PGM raw (P5), maxval 255')
    g1000 = grey * 1000 // 255
    pnm('pnm/p5-maxval1000.pgm', b'P5\n%d %d\n1000\n' % (w, h) + g1000.astype('>u2').tobytes(), [pnm_scale(g1000, 1000)], 'PGM raw (P5), 16-bit samples, maxval 1000', check=False)
    g16 = grey * 257 + 3
    pnm('pnm/p5-maxval65535.pgm', b'P5\n%d %d\n65535\n' % (w, h) + g16.astype('>u2').tobytes(), [pnm_scale(g16, 65535)], 'PGM raw (P5), maxval 65535', check=False)
    pnm('pnm/p6.ppm', b'P6\n%d %d\n255\n' % (w, h) + rgb.astype(np.uint8).tobytes(), [rgb[..., i] for i in range(3)], 'PPM raw (P6), maxval 255')
    r7 = rgb * 7 // 255
    pnm('pnm/p6-maxval7.ppm', b'P6\n%d %d\n7\n' % (w, h) + r7.astype(np.uint8).tobytes(), [pnm_scale(r7[..., i], 7) for i in range(3)], 'PPM raw (P6), maxval 7')
    r16 = rgb * 257 + 1
    pnm('pnm/p6-maxval65535.ppm', b'P6\n# comment\n%d %d\n65535\n' % (w, h) + r16.astype('>u2').tobytes(), [pnm_scale(r16[..., i], 65535) for i in range(3)], 'PPM raw (P6), 16-bit, maxval 65535')
    def pam(name, tuple_type, maxval, chans, covers):
        depth = len(chans)
        head = f'P7\nWIDTH {w}\nHEIGHT {h}\nDEPTH {depth}\nMAXVAL {maxval}\n' + (f'TUPLTYPE {tuple_type}\n' if tuple_type else '') + '# a comment\nENDHDR\n'
        body = np.stack(chans, axis=-1).astype('>u2' if maxval > 255 else np.uint8).tobytes()
        pnm(name, head.encode() + body, [pnm_scale(c, maxval) for c in chans], covers, check=False)
    pam('pnm/p7-grayscale.pam', 'GRAYSCALE', 255, [grey], 'PAM GRAYSCALE')
    pam('pnm/p7-grayscale-alpha.pam', 'GRAYSCALE_ALPHA', 255, [grey, a], 'PAM GRAYSCALE_ALPHA')
    pam('pnm/p7-rgb.pam', 'RGB', 255, [rgb[..., i] for i in range(3)], 'PAM RGB')
    pam('pnm/p7-rgb-alpha-16bit.pam', 'RGB_ALPHA', 65535, [rgb[..., i] * 257 for i in range(3)] + [a * 257], 'PAM RGB_ALPHA, 16-bit')
    pam('pnm/p7-blackandwhite.pam', 'BLACKANDWHITE', 1, [bits], 'PAM BLACKANDWHITE (1 is white)')
    pam('pnm/p7-blackandwhite-alpha.pam', 'BLACKANDWHITE_ALPHA', 1, [bits, 1 - bits], 'PAM BLACKANDWHITE_ALPHA')
    pam('pnm/p7-no-tupltype.pam', None, 255, [rgb[..., i] for i in range(3)], 'PAM with no TUPLTYPE: read by its depth')

    # QOI.
    w, h = 32, 24
    q = np.dstack([photo(w, h, 80, noise=0.6), ramp_alpha(w, h, 80)])
    q[:, :8, 3] = 255
    q[5:9, :] = q[5, 0]
    for name, img, ch, covers in [('qoi/rgba.qoi', q, 4, 'QOI RGBA: RUN, INDEX, DIFF, LUMA, RGB and RGBA chunks'),
                                   ('qoi/rgb.qoi', np.dstack([q[..., :3], np.full((h, w), 255, np.uint8)]), 3, 'QOI, 3 channels')]:
        path = fx.lossless(name, qoi_encode(img, ch), [img], covers)
        if not np.array_equal(np.asarray(Image.open(path).convert('RGBA')), img):
            raise SystemExit(f'Pillow disagrees with the QOI model for {path}')
    b = io.BytesIO()
    Image.fromarray(q, 'RGBA').save(b, 'QOI')
    fx.lossless('qoi/pillow.qoi', b.getvalue(), [q], "QOI from Pillow's writer")

    # JPEG: Pillow's decode is the reference.
    src = photo(48, 32, 90)
    odd = photo(37, 29, 91)
    for sub, label in [(0, '4:4:4'), (1, '4:2:2'), (2, '4:2:0')]:
        fx.jpeg(f'jpeg/baseline-{label.replace(":", "")}.jpg', pillow_jpeg(src, quality=88, subsampling=sub), f'JPEG baseline {label}')
        fx.jpeg(f'jpeg/progressive-{label.replace(":", "")}.jpg', pillow_jpeg(src, quality=88, subsampling=sub, progressive=True), f'JPEG progressive {label} (spectral selection and successive approximation)')
    fx.jpeg('jpeg/baseline-420-odd.jpg', pillow_jpeg(odd, quality=80, subsampling=2), 'JPEG baseline 4:2:0, 37x29 (not a multiple of the MCU)')
    fx.jpeg('jpeg/progressive-422-odd.jpg', pillow_jpeg(odd, quality=80, subsampling=1, progressive=True), 'JPEG progressive 4:2:2, 37x29')
    fx.jpeg('jpeg/grey.jpg', pillow_jpeg(src, 'L', quality=85), 'JPEG greyscale (one component)')
    fx.jpeg('jpeg/grey-progressive.jpg', pillow_jpeg(odd, 'L', quality=85, progressive=True), 'JPEG greyscale progressive, 37x29')
    fx.jpeg('jpeg/restart-baseline.jpg', pillow_jpeg(src, quality=85, subsampling=2, restart_marker_blocks=1), 'JPEG baseline with a restart marker after every MCU')
    fx.jpeg('jpeg/restart-progressive.jpg', pillow_jpeg(odd, quality=85, subsampling=0, progressive=True, restart_marker_blocks=3), 'JPEG progressive with restart markers')
    rst = pillow_jpeg(photo(64, 48, 94), quality=85, subsampling=2, restart_marker_blocks=1)
    marks = [i for i in range(len(rst) - 1) if rst[i] == 0xff and 0xd0 <= rst[i + 1] <= 0xd7]
    fx.jpeg('jpeg/restart-lost.jpg', rst[:marks[3]] + rst[marks[3] + 2:], 'JPEG with a restart marker missing: resynchronised as libjpeg does')
    wrong = bytearray(rst)
    wrong[marks[2] + 1] = 0xd0 + ((wrong[marks[2] + 1] - 0xd0 + 2) & 7)
    fx.jpeg('jpeg/restart-misnumbered.jpg', bytes(wrong), 'JPEG with a restart marker numbered two ahead: an empty segment, as libjpeg reads it')
    fx.jpeg('jpeg/rgb.jpg', pillow_jpeg(src, quality=90, keep_rgb=True), 'JPEG stored as RGB (Adobe transform 0)')
    fx.jpeg('jpeg/cmyk.jpg', pillow_jpeg(src, 'CMYK', quality=90), 'JPEG CMYK (Adobe, inverted)')
    fx.jpeg('jpeg/cmyk-progressive.jpg', pillow_jpeg(odd, 'CMYK', quality=90, progressive=True), 'JPEG CMYK progressive')
    fx.jpeg('jpeg/standard-tables.jpg', strip_dht(pillow_jpeg(src, quality=85)), 'JPEG with no DHT (motion JPEG): the standard Huffman tables')
    cut = pillow_jpeg(photo(48, 40, 92), quality=90, subsampling=2)
    fx.jpeg('jpeg/truncated.jpg', cut[:len(cut) * 3 // 5], 'JPEG cut short at 60%: the rest grey, as libjpeg')
    if HAVE_MAGICK:
        fx.jpeg('jpeg/ycck.jpg', magick_jpeg(src, ['-quality', '90', '-colorspace', 'CMYK']), 'JPEG YCCK (Adobe transform 2), from ImageMagick')
        fx.jpeg('jpeg/411.jpg', magick_jpeg(odd, ['-quality', '88', '-sampling-factor', '4x1,1x1,1x1']), 'JPEG 4:1:1 (h4v1), 37x29')
        fx.jpeg('jpeg/440.jpg', magick_jpeg(src, ['-quality', '88', '-sampling-factor', '1x2,1x1,1x1']), 'JPEG 4:4:0 (h1v2, vertical fancy upsampling)')
        fx.jpeg('jpeg/440-progressive.jpg', magick_jpeg(odd, ['-quality', '88', '-sampling-factor', '1x2,1x1,1x1', '-interlace', 'JPEG']), 'JPEG 4:4:0 progressive, 37x29')
        fx.jpeg('jpeg/mixed-sampling.jpg', magick_jpeg(odd, ['-quality', '88', '-sampling-factor', '2x2,1x2,1x1']), 'JPEG with different factors per chroma component (2x2, 1x2, 1x1)')
        fx.jpeg('jpeg/h3v1.jpg', magick_jpeg(src, ['-quality', '88', '-sampling-factor', '3x1,1x1,1x1']), 'JPEG 3x1 luma: replicated chroma (libjpeg int_upsample)')
    small = photo(24, 16, 93)
    for o, big in [(2, False), (3, True), (4, False), (5, True), (6, False), (7, True), (8, False), (6, True)]:
        fx.jpeg(f'jpeg/orientation-{o}-{"mm" if big else "ii"}.jpg', pillow_jpeg(small, quality=92, exif=exif(o, big)), f'JPEG EXIF orientation {o} ({"big" if big else "little"}-endian TIFF)')

    fx.expected['_note'] = ('Made by tests/decode-reference.py --fixtures (Pillow ' + Image.__version__ + '). Lossless formats: sha256 of each RGBA frame. '
                            'JPEG: a PNG of the reference decode (Pillow, libjpeg-turbo), compared by PSNR.')
    motion = open(os.path.join(ROOT, 'tests', 'fixtures', 'motion-still.jpg'), 'rb').read()
    fx.expected['_motion-still'] = {'sha256': sha(np.dstack([jpeg_reference(motion), np.full(jpeg_reference(motion).shape[:2], 255, np.uint8)]))}


def write_fixtures():
    if os.path.isdir(FIXTURES):
        shutil.rmtree(FIXTURES)
    os.makedirs(FIXTURES)
    fx = Fixtures(FIXTURES)
    make_fixtures(fx)
    names = sorted(k for k in fx.expected if not k.startswith('_'))
    ordered = {k: fx.expected[k] for k in ['_note', '_motion-still'] + names}
    open(os.path.join(FIXTURES, 'expected.json'), 'w').write(json.dumps(ordered, indent=1) + '\n')
    # Check the decoders against what was written.
    dec = Decoder()
    try:
        paths = [os.path.join(FIXTURES, n) for n in names]
        got = dec.decode(paths)
        bad = 0
        for n, p in zip(names, paths):
            e, g = fx.expected[n], got[p]
            if 'error' in g:
                print(f'  ERROR  {n}: {g["error"]}')
                bad += 1
                continue
            if 'sha256' in e:
                ok = [sha(f) for f in g['frames_rgba']] == e['sha256'] and g['delays'] == e['delays'] and g['loop'] == e['loop']
                if not ok:
                    bad += 1
                    print(f'  DIFF   {n}: delays {g["delays"]} vs {e["delays"]}, loop {g["loop"]} vs {e["loop"]}, frames {len(g["frames_rgba"])} vs {len(e["sha256"])}')
            else:
                ref = np.asarray(Image.open(os.path.join(FIXTURES, e['reference'])).convert('RGB'))
                psnr, mad, mx, exact = psnr_mad(g['frames_rgba'][0], ref)
                if psnr < 40 or mad > 1.5:
                    bad += 1
                print(f'  {"exact " if exact == 1 else "      "} {n}: PSNR {psnr:.2f} dB, mean abs diff {mad:.3f}, max {mx}')
    finally:
        dec.close()
    size = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(FIXTURES) for f in fs)
    print(f'{len(names)} fixtures, {size / 1024:.0f} KB in {os.path.relpath(FIXTURES, ROOT)}; {bad} problems')
    return bad == 0


# ---------------------------------------------------------------------------------------------------------- comparison

def comparison_cases(work, quick):
    """(group, label, path, expected frames or None for a JPEG, delays, loop). Expected frames None means: Pillow's decode."""
    cases = []
    rng = np.random.default_rng(7)
    def put(name, data):
        p = os.path.join(work, name)
        open(p, 'wb').write(data)
        return p
    sizes = [(1, 1), (7, 5), (16, 16), (33, 17), (64, 48), (127, 95), (301, 203)] + ([] if quick else [(2, 2), (8, 8), (17, 33), (640, 480), (1023, 769)])
    qualities = [30, 75, 95] if quick else [10, 30, 50, 75, 90, 95, 100]
    for (w, h) in sizes:
        src = photo(w, h, w * 7 + h, noise=rng.uniform(0, 8))
        for q in qualities:
            for sub, label in [(0, '4:4:4'), (1, '4:2:2'), (2, '4:2:0')]:
                for prog in (False, True):
                    kind = 'progressive' if prog else 'baseline'
                    cases.append((f'JPEG {kind} {label}', f'{w}x{h} q{q}', put(f'j-{w}x{h}-q{q}-{sub}-{int(prog)}.jpg', pillow_jpeg(src, quality=q, subsampling=sub, progressive=prog)), None))
            cases.append(('JPEG grey', f'{w}x{h} q{q}', put(f'g-{w}x{h}-q{q}.jpg', pillow_jpeg(src, 'L', quality=q)), None))
            cases.append(('JPEG grey progressive', f'{w}x{h} q{q}', put(f'gp-{w}x{h}-q{q}.jpg', pillow_jpeg(src, 'L', quality=q, progressive=True)), None))
        cases.append(('JPEG CMYK', f'{w}x{h}', put(f'cmyk-{w}x{h}.jpg', pillow_jpeg(src, 'CMYK', quality=85)), None))
        cases.append(('JPEG restart markers', f'{w}x{h}', put(f'rst-{w}x{h}.jpg', pillow_jpeg(src, quality=85, restart_marker_blocks=int(rng.integers(1, 5)), progressive=bool(rng.integers(0, 2)))), None))
        cases.append(('JPEG RGB', f'{w}x{h}', put(f'rgb-{w}x{h}.jpg', pillow_jpeg(src, quality=85, keep_rgb=True)), None))
        if HAVE_MAGICK and w * h > 1:
            for sf, label in [('4x1,1x1,1x1', '4:1:1'), ('1x2,1x1,1x1', '4:4:0'), ('2x2,1x2,1x1', 'mixed'), ('3x1,1x1,1x1', 'h3v1'), ('1x4,1x1,1x1', 'h1v4'), ('4x2,1x1,1x1', 'h4v2')]:
                for prog in (False, True):
                    args = ['-quality', '85', '-sampling-factor', sf] + (['-interlace', 'JPEG'] if prog else [])
                    cases.append((f'JPEG {label}' + (' progressive' if prog else ''), f'{w}x{h}', put(f'im-{w}x{h}-{label}-{int(prog)}.jpg', magick_jpeg(src, args)), None))
            cases.append(('JPEG YCCK', f'{w}x{h}', put(f'ycck-{w}x{h}.jpg', magick_jpeg(src, ['-quality', '85', '-colorspace', 'CMYK'])), None))
    small = photo(29, 19, 3)
    for o in range(1, 9):
        for big in (False, True):
            cases.append(('JPEG EXIF orientation', f'{o} {"MM" if big else "II"}', put(f'o{o}{int(big)}.jpg', pillow_jpeg(small, quality=90, exif=exif(o, big))), None))
    full = pillow_jpeg(photo(96, 64, 4), quality=90)
    for frac in (0.2, 0.5, 0.8):
        cases.append(('JPEG cut short (baseline)', f'{int(frac * 100)}%', put(f'cut{int(frac * 100)}.jpg', full[:int(len(full) * frac)]), None))
    motion = os.path.join(ROOT, 'tests', 'fixtures', 'motion-still.jpg')
    cases.append(('JPEG real photo', 'motion-still.jpg 768x432', motion, None))

    # Lossless formats: random images through this script's encoders and Pillow's, exact.
    for i in range(12 if quick else 40):
        ct = int(rng.choice([0, 2, 3, 4, 6]))
        d = int(rng.choice({0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16]}[ct]))
        w, h = int(rng.integers(1, 90)), int(rng.integers(1, 70))
        s = png_samples(w, h, ct, d, 1000 + i)
        pal = rng.integers(0, 256, (1 << d) * 3).astype(np.uint8).tobytes() if ct == 3 else None
        inter = bool(rng.integers(0, 2))
        p = put(f'png{i}.png', png_bytes(s, ct, d, palette=pal, interlace=inter, filters=[int(rng.integers(0, 5))] if rng.random() < 0.3 else None, idat_size=int(rng.integers(1, 500))))
        cases.append(('PNG (this script)', f'type {ct} {d}-bit{" Adam7" if inter else ""} {w}x{h}', p, ([png_expected(s, ct, d, pal)], [0], 1)))
    for mode in ['1', 'L', 'LA', 'P', 'RGB', 'RGBA']:
        for (w, h) in [(5, 3), (64, 48), (301, 203)]:
            im = Image.fromarray(np.dstack([photo(w, h, 5), ramp_alpha(w, h, 5)]), 'RGBA').convert(mode)
            b = io.BytesIO()
            im.save(b, 'PNG', optimize=bool(w % 2))
            p = put(f'pil-{mode}-{w}.png', b.getvalue())
            cases.append(('PNG (Pillow)', f'{mode} {w}x{h}', p, ([np.asarray(Image.open(p).convert('RGBA'))], [0], 1)))
            for fmt, ext in [('BMP', 'bmp'), ('PPM', 'pnm'), ('QOI', 'qoi')]:
                if (fmt == 'PPM' and mode not in ('1', 'L', 'RGB')) or (fmt == 'QOI' and mode not in ('RGB', 'RGBA')) or (fmt == 'BMP' and mode == 'LA'):
                    continue
                b = io.BytesIO()
                im.save(b, fmt)
                p = put(f'pil-{mode}-{w}.{ext}', b.getvalue())
                cases.append((f'{fmt} (Pillow)', f'{mode} {w}x{h}', p, ([np.asarray(Image.open(p).convert('RGBA'))], [0], 1)))
    for i in range(6 if quick else 20):
        w, h = int(rng.integers(8, 70)), int(rng.integers(8, 50))
        n = int(rng.integers(1, 6))
        frames = []
        for k in range(n):
            fw, fh = int(rng.integers(1, w + 1)), int(rng.integers(1, h + 1))
            colours = int(rng.choice([2, 4, 16, 256]))
            frames.append({'x': int(rng.integers(0, w - fw + 1)), 'y': int(rng.integers(0, h - fh + 1)),
                           'idx': rng.integers(0, colours, (fh, fw)).astype(np.uint8), 'delay': int(rng.integers(0, 30)),
                           'disposal': int(rng.integers(0, 5)), 'transparent': int(rng.integers(0, colours)) if rng.random() < 0.5 else None,
                           'interlace': bool(rng.integers(0, 2)), 'min_size': max(2, colours.bit_length() - 1),
                           'lct': [tuple(int(v) for v in c) for c in rng.integers(0, 256, (colours, 3))], 'deferred': bool(rng.integers(0, 2))})
        loop = [None, 0, 3][i % 3]
        p = put(f'gif{i}.gif', gif_bytes(w, h, frames, None, loop))
        cases.append(('GIF (this script)', f'{len(frames)} frames {w}x{h}', p, gif_expected(w, h, frames, None, loop)))
    for i in range(6 if quick else 20):
        w, h = int(rng.integers(1, 60)), int(rng.integers(1, 40))
        f = int(rng.integers(0, 4))
        if f == 0:
            q = np.dstack([photo(w, h, i, noise=0.5), ramp_alpha(w, h, i)])
            p = put(f'q{i}.qoi', qoi_encode(q))
            cases.append(('QOI (this script)', f'{w}x{h}', p, ([q], [0], 1)))
        elif f == 1:
            mv = int(rng.choice([1, 3, 15, 255, 256, 1000, 65535]))
            g = rng.integers(0, mv + 1, (h, w))
            p = put(f'pgm{i}.pgm', b'P5\n%d %d\n%d\n' % (w, h, mv) + g.astype('>u2' if mv > 255 else np.uint8).tobytes())
            cases.append(('PNM (this script)', f'P5 maxval {mv} {w}x{h}', p, ([to_rgba([pnm_scale(g, mv)])], [0], 1)))
        elif f == 2:
            mv = int(rng.choice([1, 7, 255, 4095, 65535]))
            c = rng.integers(0, mv + 1, (h, w, 4))
            body = c.astype('>u2' if mv > 255 else np.uint8).tobytes()
            p = put(f'pam{i}.pam', f'P7\nWIDTH {w}\nHEIGHT {h}\nDEPTH 4\nMAXVAL {mv}\nTUPLTYPE RGB_ALPHA\nENDHDR\n'.encode() + body)
            cases.append(('PNM (this script)', f'PAM RGBA maxval {mv} {w}x{h}', p, ([to_rgba([pnm_scale(c[..., k], mv) for k in range(4)])], [0], 1)))
        else:
            bpp = int(rng.choice([1, 2, 4, 8]))
            n = 1 << bpp
            rows = rng.integers(0, n, (h, w))
            palette = [tuple(int(v) for v in c) for c in rng.integers(0, 256, (n, 3))]
            p = put(f'b{i}.bmp', bmp_bytes(w, h, bpp, rows, palette, top_down=bool(rng.integers(0, 2))))
            exp = np.dstack([np.array(palette, np.uint8)[rows], np.full((h, w), 255, np.uint8)])
            cases.append(('BMP (this script)', f'{bpp}-bit {w}x{h}', p, ([exp], [0], 1)))
    return cases


def compare(quick):
    work = tempfile.mkdtemp(prefix='decode-cmp-')
    dec = Decoder()
    try:
        cases = comparison_cases(work, quick)
        got = dec.decode([c[2] for c in cases])
        groups = {}
        print(f'{"case":<34} {"image":<22} {"PSNR dB":>8} {"mean |d|":>9} {"max":>4} {"exact %":>8}')
        for group, label, path, expected in cases:
            g = got[path]
            row = groups.setdefault(group, {'n': 0, 'exact': 0, 'psnr': float('inf'), 'mad': 0.0, 'max': 0, 'errors': 0})
            row['n'] += 1
            ref = None
            if expected is None:
                try:
                    ref = jpeg_reference(open(path, 'rb').read())
                except Exception as e:
                    # Pillow refuses it: so should the decoder.
                    if 'error' in g:
                        row['exact'] += 1
                        print(f'{group:<34} {label:<22} refused by both (Pillow: {e}; ours: {g["error"]})')
                    else:
                        row['errors'] += 1
                        print(f'{group:<34} {label:<22} Pillow refuses it ({e}) but the decoder does not')
                    continue
            if 'error' in g:
                row['errors'] += 1
                print(f'{group:<34} {label:<22} ERROR {g["error"]}')
                continue
            if expected is None:
                psnr, mad, mx, exact = psnr_mad(g['frames_rgba'][0], ref)
            else:
                frames, delays, loop = expected
                ok = len(frames) == len(g['frames_rgba']) and all(np.array_equal(a, b) for a, b in zip(frames, g['frames_rgba']))
                ok = ok and g['delays'] == delays and g['loop'] == loop
                psnr, mad, mx, exact = (float('inf'), 0.0, 0, 1.0) if ok else (0.0, 255.0, 255, 0.0)
                if not ok:
                    print(f'{group:<34} {label:<22} MISMATCH (frames {len(g["frames_rgba"])} vs {len(frames)}, delays {g["delays"]} vs {delays}, loop {g["loop"]} vs {loop})')
            row['exact'] += exact == 1
            row['psnr'] = min(row['psnr'], psnr)
            row['mad'] = max(row['mad'], mad)
            row['max'] = max(row['max'], mx)
            if expected is None and (exact < 1 or group == 'JPEG real photo'):
                print(f'{group:<34} {label:<22} {psnr:>8.2f} {mad:>9.4f} {mx:>4} {exact * 100:>8.2f}')
        print()
        print(f'{"summary":<34} {"cases":>6} {"exact":>6} {"min PSNR":>9} {"max mean |d|":>13} {"max |d|":>8} {"errors":>7}')
        for group, r in groups.items():
            psnr = 'inf' if r['psnr'] == float('inf') else f'{r["psnr"]:.2f}'
            print(f'{group:<34} {r["n"]:>6} {r["exact"]:>6} {psnr:>9} {r["mad"]:>13.4f} {r["max"]:>8} {r["errors"]:>7}')
        return all(r['errors'] == 0 and r['psnr'] >= 40 and r['mad'] <= 1.5 for r in groups.values())
    finally:
        dec.close()
        shutil.rmtree(work, ignore_errors=True)


def timing():
    work = tempfile.mkdtemp(prefix='decode-time-')
    dec = Decoder()
    try:
        hd, big = photo(1920, 1080, 11), photo(4000, 3000, 12)
        motion = Image.open(os.path.join(ROOT, 'tests', 'fixtures', 'motion-still.jpg')).convert('RGB')
        real = np.asarray(motion.resize((1920, 1080), Image.LANCZOS))
        alpha = np.clip(np.linspace(0, 255, 1920)[None, :] + np.zeros((1080, 1)), 0, 255).astype(np.uint8)
        files = {}
        def put(name, data):
            files[name] = os.path.join(work, name)
            open(files[name], 'wb').write(data)
        put('1920x1080 baseline 4:2:0 q90 (synthetic).jpg', pillow_jpeg(hd, quality=90))
        put('1920x1080 baseline 4:2:0 q90 (photo).jpg', pillow_jpeg(real, quality=90))
        put('1920x1080 progressive 4:2:0 q90.jpg', pillow_jpeg(hd, quality=90, progressive=True))
        put('4000x3000 progressive 4:2:0 q90.jpg', pillow_jpeg(big, quality=90, progressive=True))
        put('4000x3000 baseline 4:2:0 q90.jpg', pillow_jpeg(big, quality=90))
        for name, rgba in [('1920x1080 RGBA PNG (photo).png', np.dstack([real, alpha])), ('1920x1080 RGBA PNG (synthetic, noisy).png', np.dstack([hd, alpha]))]:
            b = io.BytesIO()
            Image.fromarray(rgba, 'RGBA').save(b, 'PNG')
            put(name, b.getvalue())
        files['motion-still.jpg 768x432'] = os.path.join(ROOT, 'tests', 'fixtures', 'motion-still.jpg')
        t = dec.time(list(files.values()))
        print(f'\n{"decode (Node " + subprocess.run(["node", "--version"], capture_output=True, text=True).stdout.strip() + ", warm)":<46} {"median ms":>10} {"best ms":>8} {"first ms":>9}')
        for name, p in files.items():
            r = t[p]
            print(f'{name:<46} {r["median"]:>10.1f} {r["best"]:>8.1f} {r["first"]:>9.1f}')
        # Inflate alone, on the photo PNG's image data.
        png = open(files['1920x1080 RGBA PNG (photo).png'], 'rb').read()
        z, pos = b'', 8
        while pos < len(png):
            n, kind = struct.unpack('>I4s', png[pos:pos + 8])
            if kind == b'IDAT':
                z += png[pos + 8:pos + 8 + n]
            pos += 12 + n
        open(os.path.join(work, 'z.bin'), 'wb').write(z)
        script = os.path.join(dec.dir, 'inflate.mjs')
        open(script, 'w').write('''
import { inflate } from './decode.mjs';
import { readFileSync } from 'node:fs';
const z = readFileSync(process.argv[2]); let out; const t = [];
for (let i = 0; i < 25; i++) { const s = performance.now(); out = inflate(z); t.push(performance.now() - s); }
const warm = t.slice(5).sort((a, b) => a - b);
console.log(`inflate: ${(z.length / 1e6).toFixed(2)} MB to ${(out.length / 1e6).toFixed(2)} MB, median ${warm[10].toFixed(1)} ms, ${(out.length / warm[10] / 1000).toFixed(0)} MB/s output`);
''')
        subprocess.run(['node', script, os.path.join(work, 'z.bin')], check=True)
    finally:
        dec.close()
        shutil.rmtree(work, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--fixtures', action='store_true', help='rewrite tests/fixtures/decode')
    ap.add_argument('--quick', action='store_true', help='fewer comparison cases, no timing')
    args = ap.parse_args()
    if args.fixtures:
        sys.exit(0 if write_fixtures() else 1)
    ok = compare(args.quick)
    if not args.quick:
        timing()
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
