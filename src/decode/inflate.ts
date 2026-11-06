/*
 * DEFLATE (RFC 1951) and zlib (RFC 1950) decompression in plain TypeScript: synchronous, no dependencies and no platform API,
 * so it runs in any JavaScript runtime. Two-level Huffman tables keep the inner loop to one or two lookups a symbol, and the
 * input can be several ranges of one buffer (a PNG's IDAT chunks) read straight through, without joining them first.
 * Not supported: zlib preset dictionaries. The zlib checksum (Adler-32) is not checked.
 */

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

// A table entry is bits to drop (low byte), an op (next byte) and a value (high half). Op 0 is a literal (or a plain symbol),
// 16 + n a length or distance base with n extra bits, 32 the end of a block, 64 a code that is not in use, and 1–15 a link
// to a second-level table that many more bits wide, whose offset is the value.
const OP_BASE = 16, OP_END = 32, OP_BAD = 64;
const BAD = OP_BAD << 8;
const LIT_ROOT = 10, DIST_ROOT = 8, CODE_ROOT = 7, LIT_MASK = (1 << LIT_ROOT) - 1, DIST_MASK = (1 << DIST_ROOT) - 1;
const KIND_CODES = 0, KIND_LIT = 1, KIND_DIST = 2;

interface Tables {
  lit: Int32Array;
  dist: Int32Array;
  codes: Int32Array;
  fixedLit: Int32Array;
  fixedDist: Int32Array;
  lens: Uint8Array;
  codeLens: Uint8Array;
  count: Uint16Array;
  offs: Uint16Array;
  sorted: Uint16Array;
}

let shared: Tables | null = null;
const REV8 = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let r = 0;
  for (let b = 0; b < 8; b++) r |= ((i >> b) & 1) << (7 - b);
  REV8[i] = r;
}

// The value half of an entry for a symbol of a given kind of code.
function symbolEntry(sym: number, kind: number): number {
  if (kind === KIND_CODES) return sym << 16;
  if (kind === KIND_LIT) {
    if (sym < 256) return sym << 16;
    if (sym === 256) return OP_END << 8;
    if (sym < 286) return (LENGTH_BASE[sym - 257] << 16) | ((OP_BASE + LENGTH_EXTRA[sym - 257]) << 8);
    return BAD;
  }
  return sym < 30 ? (DIST_BASE[sym] << 16) | ((OP_BASE + DIST_EXTRA[sym]) << 8) : BAD;
}

/**
 * Fills `table` with a two-level decoding table for the code lengths lens[start..start+n). Returns false for an over-full
 * code. Incomplete codes are allowed (zlib allows only some); their unused codes decode as errors.
 */
function build(t: Tables, lens: Uint8Array, start: number, n: number, table: Int32Array, root: number, kind: number): boolean {
  const { count, offs, sorted } = t;
  count.fill(0);
  for (let i = 0; i < n; i++) count[lens[start + i]]++;
  count[0] = 0;
  let max = 15;
  while (max > 0 && count[max] === 0) max--;
  const size = 1 << root;
  table.fill(BAD, 0, size);
  if (max === 0) return true; // No codes at all: legal for distances when a block has only literals.
  let left = 1;
  for (let len = 1; len <= 15; len++) {
    left = (left << 1) - count[len];
    if (left < 0) return false;
  }
  offs[1] = 0;
  for (let len = 1; len < 15; len++) offs[len + 1] = offs[len] + count[len];
  for (let i = 0; i < n; i++) {
    const len = lens[start + i];
    if (len) sorted[offs[len]++] = i;
  }
  const sub = max > root ? max - root : 0, subSize = 1 << sub;
  let next = size, code = 0, k = 0;
  for (let len = 1; len <= max; len++) {
    for (let c = count[len]; c > 0; c--) {
      const value = symbolEntry(sorted[k++], kind);
      const rev = ((REV8[code & 255] << 8) | REV8[code >>> 8]) >>> (16 - len);
      if (len <= root) {
        const e = value | len;
        for (let j = rev; j < size; j += 1 << len) table[j] = e;
      } else {
        const low = rev & (size - 1);
        let link = table[low];
        if (((link >>> 8) & 0xff) === OP_BAD) {
          link = (next << 16) | (sub << 8) | root;
          table[low] = link;
          table.fill(BAD, next, next + subSize);
          next += subSize;
        }
        const base = link >>> 16, e = value | (len - root);
        for (let j = rev >>> root; j < subSize; j += 1 << (len - root)) table[base + j] = e;
      }
      code++;
    }
    code <<= 1;
  }
  return true;
}

function tables(): Tables {
  if (shared) return shared;
  const t: Tables = {
    // Root plus at most one second-level table for each long code (286 and 30 codes, 5 and 7 more bits at most).
    lit: new Int32Array((1 << LIT_ROOT) + 286 * (1 << (15 - LIT_ROOT))),
    dist: new Int32Array((1 << DIST_ROOT) + 30 * (1 << (15 - DIST_ROOT))),
    codes: new Int32Array(1 << CODE_ROOT),
    fixedLit: new Int32Array(1 << LIT_ROOT),
    fixedDist: new Int32Array(1 << DIST_ROOT),
    lens: new Uint8Array(320),
    codeLens: new Uint8Array(19),
    count: new Uint16Array(16),
    offs: new Uint16Array(16),
    sorted: new Uint16Array(320),
  };
  const lens = new Uint8Array(288);
  lens.fill(8, 0, 144);
  lens.fill(9, 144, 256);
  lens.fill(7, 256, 280);
  lens.fill(8, 280, 288);
  build(t, lens, 0, 288, t.fixedLit, LIT_ROOT, KIND_LIT);
  lens.fill(5, 0, 32);
  build(t, lens, 0, 32, t.fixedDist, DIST_ROOT, KIND_DIST);
  return (shared = t);
}

function grow(out: Uint8Array, used: number, need: number): Uint8Array {
  const next = new Uint8Array(Math.max(need, out.length * 2, 1024));
  next.set(out.subarray(0, used));
  return next;
}

// What a run ended on.
const DONE = 1, SHORT_INPUT = 2, FULL = 3;

/**
 * The reader and the output, shared by the block loop and the symbol loop. `ip` and `end` bound the current input range;
 * `ranges` holds start, end pairs and `range` the index of the current pair. Past the last byte the reader adds zero bytes,
 * counted in `over`, so the final symbols can be looked up; using one of them means the input was cut short.
 */
interface State {
  src: Uint8Array;
  ranges: ArrayLike<number>;
  range: number;
  ip: number;
  end: number;
  hold: number;
  bits: number;
  over: number;
  out: Uint8Array;
  op: number;
  fixed: boolean;
  status: number;
}

/** Tops the bit buffer up to `n` bits (at most 24), moving to the next input range as each ends. False once past the end. */
function need(s: State, n: number): boolean {
  let { hold, bits } = s;
  while (bits < n) {
    if (s.ip < s.end) {
      hold |= s.src[s.ip++] << bits;
      bits += 8;
    } else if (s.range + 2 < s.ranges.length) {
      s.range += 2;
      s.ip = s.ranges[s.range];
      s.end = s.ranges[s.range + 1];
    } else {
      // Past the end: zeros, a few bytes' worth at most.
      if (++s.over > 4) {
        s.hold = hold;
        s.bits = bits;
        return false;
      }
      bits += 8;
    }
  }
  s.hold = hold;
  s.bits = bits;
  return true;
}

function take(s: State, n: number): number {
  const v = s.hold & ((1 << n) - 1);
  s.hold >>= n;
  s.bits -= n;
  return v;
}

/** Copies a stored block's `len` bytes: those already in the bit buffer, then straight from the input. */
function stored(s: State, len: number): void {
  while (len > 0 && s.bits >= 8) {
    if (s.over * 8 >= s.bits) { s.status = SHORT_INPUT; return; }
    if (s.op === s.out.length) {
      if (s.fixed) { s.status = FULL; return; }
      s.out = grow(s.out, s.op, s.op + len);
    }
    s.out[s.op++] = take(s, 8);
    len--;
  }
  while (len > 0) {
    if (s.ip >= s.end) {
      if (s.range + 2 >= s.ranges.length) { s.status = SHORT_INPUT; return; }
      s.range += 2;
      s.ip = s.ranges[s.range];
      s.end = s.ranges[s.range + 1];
      continue;
    }
    let n = Math.min(len, s.end - s.ip);
    if (s.op + n > s.out.length) {
      if (s.fixed) n = s.out.length - s.op;
      else s.out = grow(s.out, s.op, s.op + len);
    }
    s.out.set(s.src.subarray(s.ip, s.ip + n), s.op);
    s.op += n;
    s.ip += n;
    len -= n;
    if (len > 0 && s.op === s.out.length && s.fixed) { s.status = FULL; return; }
  }
}

/** Reads a dynamic block's code lengths and builds its tables into t.lit and t.dist. False if the input ran out. */
function dynamic(s: State, t: Tables): boolean {
  if (!need(s, 14)) return false;
  const nlen = take(s, 5) + 257, ndist = take(s, 5) + 1, ncode = take(s, 4) + 4;
  if (nlen > 286 || ndist > 30) throw new Error('inflate: too many length or distance codes');
  const codeLens = t.codeLens;
  codeLens.fill(0);
  for (let i = 0; i < ncode; i++) {
    if (!need(s, 3)) return false;
    codeLens[CODE_ORDER[i]] = take(s, 3);
  }
  if (!build(t, codeLens, 0, 19, t.codes, CODE_ROOT, KIND_CODES)) throw new Error('inflate: corrupt code lengths');
  const codes = t.codes, lens = t.lens, total = nlen + ndist;
  for (let i = 0; i < total;) {
    if (!need(s, 14)) return false;
    const e = codes[s.hold & 127];
    if (e === BAD) throw new Error('inflate: corrupt code lengths');
    take(s, e & 0xff);
    const sym = e >> 16;
    if (sym < 16) {
      lens[i++] = sym;
      continue;
    }
    let rep: number, value = 0;
    if (sym === 16) {
      if (i === 0) throw new Error('inflate: repeat with no code length');
      value = lens[i - 1];
      rep = 3 + take(s, 2);
    } else rep = sym === 17 ? 3 + take(s, 3) : 11 + take(s, 7);
    if (i + rep > total) throw new Error('inflate: too many code lengths');
    lens.fill(value, i, i + rep);
    i += rep;
  }
  if (lens[256] === 0) throw new Error('inflate: no end-of-block code');
  if (!build(t, lens, 0, nlen, t.lit, LIT_ROOT, KIND_LIT)) throw new Error('inflate: corrupt literal/length code');
  if (!build(t, lens, nlen, ndist, t.dist, DIST_ROOT, KIND_DIST)) throw new Error('inflate: corrupt distance code');
  return true;
}

interface Run {
  out: Uint8Array;
  size: number;
  status: number;
}

/**
 * Inflates the given ranges of `src` into `out`. With `fixed`, `out` is never replaced and decoding stops once it is full;
 * otherwise it grows. Throws on corrupt data; input that ends too soon is reported in `status`.
 */
function run(src: Uint8Array, ranges: ArrayLike<number>, out: Uint8Array, fixed: boolean, zlib: boolean): Run {
  const t = tables();
  const first = ranges.length >= 2;
  const s: State = { src, ranges, range: 0, ip: first ? ranges[0] : 0, end: first ? ranges[1] : 0, hold: 0, bits: 0, over: 0, out, op: 0, fixed, status: 0 };
  if (zlib) {
    if (!need(s, 16) || s.over) return { out, size: 0, status: SHORT_INPUT };
    const cmf = take(s, 8), flg = take(s, 8);
    if ((cmf & 15) !== 8 || cmf >> 4 > 7 || ((cmf << 8) | flg) % 31 !== 0) throw new Error('inflate: not a zlib stream');
    if (flg & 32) throw new Error('inflate: zlib preset dictionaries are not supported');
  }
  for (;;) {
    if (!need(s, 3)) { s.status = SHORT_INPUT; break; }
    const last = take(s, 1), type = take(s, 2);
    if (type === 0) {
      take(s, s.bits & 7);
      if (!need(s, 16)) { s.status = SHORT_INPUT; break; }
      const len = take(s, 16);
      if (!need(s, 16)) { s.status = SHORT_INPUT; break; }
      if ((len ^ 0xffff) !== take(s, 16)) throw new Error('inflate: corrupt stored block length');
      stored(s, len);
    } else if (type === 3) {
      throw new Error('inflate: invalid block type');
    } else if (type === 1) {
      codes(s, t.fixedLit, t.fixedDist);
    } else {
      if (!dynamic(s, t)) { s.status = SHORT_INPUT; break; }
      codes(s, t.lit, t.dist);
    }
    if (s.status) break;
    if (last) {
      // Done, unless the last symbols were read from past the end of the input.
      s.status = s.over * 8 > s.bits ? SHORT_INPUT : DONE;
      break;
    }
  }
  return { out: s.out, size: s.op, status: s.status };
}

/** Decodes one Huffman-coded block's symbols, up to its end-of-block code. Kept apart so the engine optimises it on its own. */
function codes(st: State, lit: Int32Array, dist: Int32Array): void {
  const src = st.src, fixed = st.fixed;
  let ip = st.ip, end = st.end, hold = st.hold, bits = st.bits, out = st.out, op = st.op, cap = out.length, status = 0;
  for (;;) {
    // The buffer holds at most 30 bits, so shifts never reach the sign bit.
    if (bits < 15) {
      if (ip + 1 < end) {
        hold |= (src[ip] | (src[ip + 1] << 8)) << bits;
        ip += 2;
        bits += 16;
      } else {
        // Near the end of a range: byte by byte, across ranges, past the end if need be.
        st.ip = ip;
        st.end = end;
        st.hold = hold;
        st.bits = bits;
        const ok = need(st, 15);
        ip = st.ip;
        end = st.end;
        hold = st.hold;
        bits = st.bits;
        if (!ok) { status = SHORT_INPUT; break; }
      }
    }
    let e = lit[hold & LIT_MASK];
    if ((e & 0xff00) === 0) {
      // A literal, the common case.
      const nb = e & 0xff;
      hold >>= nb;
      bits -= nb;
      if (op === cap) {
        if (fixed) { status = FULL; break; }
        out = grow(out, op, op + 1);
        cap = out.length;
      }
      out[op++] = e >> 16;
      continue;
    }
    let o = (e >> 8) & 0xff;
    if (o < 16) {
      hold >>= LIT_ROOT;
      bits -= LIT_ROOT;
      e = lit[(e >> 16) + (hold & ((1 << o) - 1))];
      o = (e >> 8) & 0xff;
    }
    const nb = e & 0xff;
    hold >>= nb;
    bits -= nb;
    if (o === 0) {
      if (op === cap) {
        if (fixed) { status = FULL; break; }
        out = grow(out, op, op + 1);
        cap = out.length;
      }
      out[op++] = e >> 16;
      continue;
    }
    if (o & OP_BASE) {
      // A length: up to 5 extra bits, then a distance code of up to 15.
      if (bits < 20) {
        if (ip + 2 < end) {
          do {
            hold |= src[ip++] << bits;
            bits += 8;
          } while (bits < 20);
        } else {
          st.ip = ip;
          st.end = end;
          st.hold = hold;
          st.bits = bits;
          const ok = need(st, 20);
          ip = st.ip;
          end = st.end;
          hold = st.hold;
          bits = st.bits;
          if (!ok) { status = SHORT_INPUT; break; }
        }
      }
      let len = (e >> 16) + (hold & ((1 << (o & 15)) - 1));
      hold >>= o & 15;
      bits -= o & 15;
      let d = dist[hold & DIST_MASK], p = (d >> 8) & 0xff;
      if (p !== 0 && p < 16) {
        hold >>= DIST_ROOT;
        bits -= DIST_ROOT;
        d = dist[(d >> 16) + (hold & ((1 << p) - 1))];
        p = (d >> 8) & 0xff;
      }
      if (!(p & OP_BASE)) throw new Error('inflate: invalid distance code');
      const dn = d & 0xff;
      hold >>= dn;
      bits -= dn;
      p &= 15;
      if (bits < p && ip + 1 < end) {
        hold |= (src[ip] | (src[ip + 1] << 8)) << bits;
        ip += 2;
        bits += 16;
      } else if (bits < p) {
        st.ip = ip;
        st.end = end;
        st.hold = hold;
        st.bits = bits;
        const ok = need(st, p);
        ip = st.ip;
        end = st.end;
        hold = st.hold;
        bits = st.bits;
        if (!ok) { status = SHORT_INPUT; break; }
      }
      const distance = (d >> 16) + (hold & ((1 << p) - 1));
      hold >>= p;
      bits -= p;
      if (distance > op) throw new Error('inflate: distance too far back');
      if (op + len > cap) {
        if (fixed) { len = cap - op; status = FULL; } else { out = grow(out, op, op + len); cap = out.length; }
      }
      let from = op - distance;
      if (len >= 64 && distance >= len) {
        out.copyWithin(op, from, from + len);
        op += len;
      } else {
        const stop = op + len;
        while (op < stop) out[op++] = out[from++];
      }
      if (status) break;
      continue;
    }
    if (o & OP_END) break;
    throw new Error('inflate: invalid literal/length code');
  }
  st.ip = ip;
  st.end = end;
  st.hold = hold;
  st.bits = bits;
  st.out = out;
  st.op = op;
  st.status = status;
}

/** Inflates raw DEFLATE data (no zlib header). `expectedSize`, if known, saves growing the output. */
export function inflateRaw(data: Uint8Array, expectedSize?: number): Uint8Array {
  return finish(run(data, [0, data.length], start(data.length, expectedSize), false, false));
}

/** Inflates a zlib-wrapped DEFLATE stream (as in PNG). `expectedSize`, if known, saves growing the output. */
export function inflate(data: Uint8Array, expectedSize?: number): Uint8Array {
  return finish(run(data, [0, data.length], start(data.length, expectedSize), false, true));
}

/**
 * Inflates a zlib stream held in ranges of `data` (start, end pairs) into `out`, stopping once it is full; returns how many
 * bytes came out, so short input can be told apart from a whole image. Throws on corrupt data. @internal
 */
export function inflateInto(data: Uint8Array, ranges: ArrayLike<number>, out: Uint8Array): number {
  return run(data, ranges, out, true, true).size;
}

const start = (inputSize: number, expected: number | undefined) =>
  new Uint8Array(typeof expected === 'number' && expected >= 0 ? Math.floor(expected) : Math.max(1024, inputSize * 4));

function finish(r: Run): Uint8Array {
  if (r.status !== DONE) throw new Error('inflate: unexpected end of data');
  return r.size === r.out.length ? r.out : r.out.slice(0, r.size);
}
