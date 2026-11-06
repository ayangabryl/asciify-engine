// The command line, as a user runs it: images (PNG, GIF), standard input, 3D models (built-in shapes, OBJ, binary STL), every
// output format, the sub-cell modes, video through ffmpeg when it is installed, errors, and the interactive terminal view
// in a pseudo-terminal (through Python's pty, when Python is there).
// npm run build && node tests/cli-node.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = path.join(root, 'dist/cli.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asciify-cli-'));
const failures = [];
const check = (name, fn) => {
  try { fn(); console.log(`ok   ${name}`); } catch (error) { console.log(`FAIL ${name}\n     ${String(error.message).split('\n').slice(0, 6).join('\n     ')}`); failures.push(name); }
};
const run = (args, options = {}) => spawnSync(process.execPath, [cli, ...args], { encoding: options.encoding ?? 'utf8', input: options.input, cwd: dir, env: { ...process.env, NO_COLOR: '', FORCE_COLOR: '', COLORTERM: '', ...options.env }, timeout: 60000 });

// A PNG: a bright disc on a dark ground, with a gradient.
const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = buf => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
function png(width, height, paint) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.set(paint(x, y), y * (width * 4 + 1) + 1 + x * 4);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const disc = (cx, cy, r) => (x, y) => { const on = Math.hypot(x - cx, y - cy) < r; return [on ? 250 : 20 + x / 4, on ? 200 : 20, on ? 60 : 40 + y / 3, 255]; };
fs.writeFileSync(path.join(dir, 'disc.png'), png(160, 100, disc(60, 50, 30)));

// An animated GIF: the disc moving across, four frames.
const { GIFEncoder, quantize, applyPalette } = createRequire(import.meta.url)('gifenc');
const gif = GIFEncoder();
for (let f = 0; f < 4; f++) {
  const data = new Uint8Array(80 * 50 * 4);
  for (let y = 0; y < 50; y++) for (let x = 0; x < 80; x++) data.set(disc(15 + f * 15, 25, 12)(x * 2, y * 2).map((v, k) => (k < 3 ? v : 255)), (y * 80 + x) * 4);
  const palette = quantize(data, 16);
  gif.writeFrame(applyPalette(data, palette), 80, 50, { palette, delay: 120 });
}
gif.finish();
fs.writeFileSync(path.join(dir, 'move.gif'), gif.bytes());

// An OBJ cube and a binary STL tetrahedron.
fs.writeFileSync(path.join(dir, 'cube.obj'), ['v -1 -1 -1', 'v 1 -1 -1', 'v 1 1 -1', 'v -1 1 -1', 'v -1 -1 1', 'v 1 -1 1', 'v 1 1 1', 'v -1 1 1',
  'f 1 2 3 4', 'f 5 8 7 6', 'f 1 5 6 2', 'f 2 6 7 3', 'f 3 7 8 4', 'f 5 1 4 8'].join('\n'));
{
  const tris = [[[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[0, 0, 0], [0, 0, 1], [1, 0, 0]], [[0, 0, 0], [0, 1, 0], [0, 0, 1]], [[1, 0, 0], [0, 0, 1], [0, 1, 0]]];
  const buf = Buffer.alloc(84 + 50 * tris.length);
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((tri, i) => tri.forEach((v, k) => v.forEach((c, j) => buf.writeFloatLE(c, 84 + i * 50 + 12 + k * 12 + j * 4))));
  fs.writeFileSync(path.join(dir, 'tetra.stl'), buf);
}

check('--help and --version', () => {
  const help = run(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage/);
  const version = run(['--version']);
  assert.equal(version.stdout.trim(), JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version);
});

check('a PNG becomes 80 columns of text in a pipe', () => {
  const r = run(['disc.png']);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trimEnd().split('\n');
  assert.ok(lines.length > 10 && lines.every(line => line.length === 80), `${lines.length} lines`);
  assert.ok(!/\x1b\[/.test(r.stdout), 'no escape codes in a pipe');
  // The disc is on the left: more ink there.
  const ink = (from, to) => lines.map(l => l.slice(from, to)).join('').replace(/\s/g, '').length;
  assert.ok(ink(20, 40) > 0);
});

check('width, height and the sub-cell modes', () => {
  const r = run(['disc.png', '-w', '40', '--braille']);
  const lines = r.stdout.trimEnd().split('\n');
  assert.ok(lines.every(line => [...line].length === 40 && [...line].every(ch => ch.codePointAt(0) >= 0x2800 && ch.codePointAt(0) <= 0x28ff)));
  const half = run(['disc.png', '-w', '30', '-H', '8', '--half', '--color', '-f', 'ansi']);
  assert.match(half.stdout, /\x1b\[38;2;\d+;\d+;\d+;48;2;/);
  assert.equal(half.stdout.trimEnd().split('\n').length, 8);
  const sextant = run(['disc.png', '-w', '20', '--sextant']);
  assert.ok(sextant.stdout.trimEnd().split('\n').every(line => [...line].length === 20));
});

check('SVG, HTML and JSON files', () => {
  assert.equal(run(['disc.png', '-o', 'disc.svg', '--title', 'A disc']).status, 0);
  const svg = fs.readFileSync(path.join(dir, 'disc.svg'), 'utf8');
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(svg, /<title>A disc<\/title>/);
  assert.match(svg, /<tspan fill="#/);
  assert.equal(run(['disc.png', '-o', 'disc.html']).status, 0);
  assert.match(fs.readFileSync(path.join(dir, 'disc.html'), 'utf8'), /^<!doctype html>[\s\S]*<pre/);
  assert.equal(run(['disc.png', '-o', 'disc.json', '-w', '50']).status, 0);
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'disc.json'), 'utf8'));
  assert.equal(json.columns, 50);
  assert.equal(json.frames.length, 1);
  assert.equal(json.frames[0].colors.length, json.columns * json.rows * 3);
});

check('standard input', () => {
  const r = run(['-', '-w', '32'], { input: fs.readFileSync(path.join(dir, 'disc.png')), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.trimEnd().split('\n').every(line => line.length === 32));
});

check('an animated GIF becomes an animated SVG, and its first frame in a pipe', () => {
  assert.equal(run(['move.gif', '-o', 'move.svg', '-w', '40']).status, 0);
  const svg = fs.readFileSync(path.join(dir, 'move.svg'), 'utf8');
  assert.equal((svg.match(/<g class="f f\d/g) ?? []).length, 4);
  assert.match(svg, /@keyframes s0/);
  assert.match(svg, /animation-duration:0\.4800s/);
  const first = run(['move.gif', '-w', '40']);
  assert.equal(first.status, 0);
  assert.match(first.stderr, /first frame/);
  const all = run(['move.gif', '-w', '40', '-o', 'move.json']);
  assert.equal(all.status, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'move.json'), 'utf8')).frames.length, 4);
});

check('built-in shapes and 3D model files', () => {
  const torus = run(['torus', '-w', '60']);
  assert.equal(torus.status, 0, torus.stderr);
  const lines = torus.stdout.trimEnd().split('\n');
  // A square view (30 rows) with the empty rows above and below the torus left out.
  assert.ok(lines.length >= 12 && lines.length < 30, `${lines.length} rows`);
  assert.ok(lines[0].trim() && lines.at(-1).trim(), 'no empty first or last row');
  assert.ok(lines.join('').replace(/\s/g, '').length > 300);
  const cube = run(['cube.obj', '-w', '50']);
  assert.equal(cube.status, 0, cube.stderr);
  assert.ok(cube.stdout.replace(/\s/g, '').length > 100);
  const tetra = run(['tetra.stl', '-w', '50', '--shade', 'toon']);
  assert.equal(tetra.status, 0, tetra.stderr);
  assert.ok(tetra.stdout.replace(/\s/g, '').length > 50);
  assert.equal(run(['knot', '--spin', '90', '--frames', '6', '-o', 'knot.svg', '-w', '40']).status, 0);
  assert.equal((fs.readFileSync(path.join(dir, 'knot.svg'), 'utf8').match(/<g class="f f\d/g) ?? []).length, 6);
});

check('a text banner', () => {
  const r = run(['--text', 'HI']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.replace(/\s/g, '').length > 20);
});

check('errors say what went wrong', () => {
  const missing = run(['nope.png']);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /No such file: nope\.png/);
  const flag = run(['disc.png', '--frobnicate']);
  assert.equal(flag.status, 1);
  assert.match(flag.stderr, /Unknown option --frobnicate/);
  fs.writeFileSync(path.join(dir, 'junk.bin'), Buffer.from('not a picture at all'));
  const junk = run(['junk.bin']);
  assert.equal(junk.status, 1);
  assert.match(junk.stderr, /Cannot read/);
});

const ffmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
if (ffmpeg) {
  check('video through ffmpeg', () => {
    const made = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=10:duration=1', '-pix_fmt', 'yuv420p', path.join(dir, 'clip.mp4')]);
    assert.equal(made.status, 0, String(made.stderr));
    const r = run(['clip.mp4', '-o', 'clip.svg', '--frames', '5', '-w', '48']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal((fs.readFileSync(path.join(dir, 'clip.svg'), 'utf8').match(/<g class="f f\d/g) ?? []).length, 5);
    const still = run(['clip.mp4', '-w', '48']);
    assert.equal(still.status, 0, still.stderr);
    assert.ok(still.stdout.trimEnd().split('\n').every(line => line.length === 48));
  });
} else console.log('skip video (no ffmpeg)');

// The live view, in a pseudo-terminal: it takes the alternate screen, draws, quits on q and puts the terminal back.
const python = spawnSync('python3', ['-c', 'import pty'], { stdio: 'ignore' }).status === 0;
if (python && process.platform !== 'win32') {
  check('the 3D view in a terminal: draws, quits on q, restores the terminal', () => {
    const script = `
import os, pty, sys, time, select
pid, fd = pty.fork()
if pid == 0:
    os.environ['COLUMNS'] = '100'; os.environ['LINES'] = '30'
    os.execv(sys.argv[1], [sys.argv[1], sys.argv[2], 'torus'])
import fcntl, termios, struct
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 30, 100, 0, 0))
out = b''
end = time.time() + 2.5
while time.time() < end:
    r, _, _ = select.select([fd], [], [], 0.1)
    if r:
        try: out += os.read(fd, 65536)
        except OSError: break
os.write(fd, b'q')
end = time.time() + 5
while time.time() < end:
    r, _, _ = select.select([fd], [], [], 0.1)
    if r:
        try:
            data = os.read(fd, 65536)
            if not data: break
            out += data
        except OSError: break
_, status = os.waitpid(pid, 0)
sys.stdout.buffer.write(out)
sys.stderr.write('exit=%d' % os.WEXITSTATUS(status))
`;
    const r = spawnSync('python3', ['-c', script, process.execPath, cli], { encoding: 'latin1', timeout: 30000 });
    const out = r.stdout ?? '';
    assert.match(r.stderr, /exit=0/, r.stderr);
    assert.ok(out.includes('\x1b[?1049h'), 'takes the alternate screen');
    assert.ok(out.includes('\x1b[?1049l'), 'gives it back');
    assert.ok(out.includes('\x1b[?25h'), 'shows the cursor again');
    assert.ok((out.match(/\x1b\[\?2026h/g) ?? []).length >= 3, 'draws frames');
    assert.match(out, /triangles/);
  });
} else console.log('skip terminal view (no python3 pty)');

fs.rmSync(dir, { recursive: true, force: true });
if (failures.length) { console.error(`${failures.length} failed`); process.exit(1); }
console.log('CLI checks passed.');
