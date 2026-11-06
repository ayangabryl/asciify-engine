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

const { decodeImage } = await import(new URL('../dist/decode.js', import.meta.url).href);

check('pictures: PNG, an animated PNG and a GIF, checked by decoding them', () => {
  assert.equal(run(['disc.png', '-w', '40', '-o', 'disc-art.png']).status, 0);
  const png = decodeImage(fs.readFileSync(path.join(dir, 'disc-art.png')));
  assert.equal(png.width, 40 * 10);
  assert.equal(png.frames.length, 1);
  assert.equal(run(['move.gif', '-w', '30', '-o', 'move-art.png']).status, 0);
  const apng = decodeImage(fs.readFileSync(path.join(dir, 'move-art.png')));
  assert.equal(apng.frames.length, 4, 'every frame of the GIF');
  assert.equal(run(['move.gif', '-w', '30', '--half', '-o', 'move-art.gif']).status, 0);
  const gif = decodeImage(fs.readFileSync(path.join(dir, 'move-art.gif')));
  assert.equal(gif.frames.length, 4);
  assert.equal(gif.loop, 0, 'plays forever');
  // Bigger cells, a transparent ground.
  assert.equal(run(['disc.png', '-w', '20', '--font-size', '32', '--background', 'transparent', '-o', 'big.png']).status, 0);
  const big = decodeImage(fs.readFileSync(path.join(dir, 'big.png')));
  assert.equal(big.width, 20 * 16);
  assert.equal(big.frames[0].data[3], 0, 'transparent corner');
  // A PNG is never written to a terminal, and an unknown extension is refused.
  const unknown = run(['disc.png', '-o', 'art.xyz']);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Cannot tell what to write/);
});

check('several inputs: one file each with {name}, or printed under their names', () => {
  fs.copyFileSync(path.join(dir, 'disc.png'), path.join(dir, 'second.png'));
  const r = run(['disc.png', 'second.png', '-o', 'many/{name}.svg']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, 'many/disc.svg')) && fs.existsSync(path.join(dir, 'many/second.svg')));
  const printed = run(['disc.png', 'second.png', '-w', '20']);
  assert.match(printed.stdout, /==> disc\.png <==[\s\S]*==> second\.png <==/);
  const bad = run(['disc.png', 'second.png', '-o', 'one.svg']);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /needs \{name\} in it or a folder/);
});

check('crop, flip, one frame, and the braille threshold', () => {
  const whole = run(['disc.png', '-w', '40']).stdout, flipped = run(['disc.png', '-w', '40', '--flip', 'h']).stdout;
  assert.notEqual(whole, flipped);
  // The left half of the picture, where the disc is: wider than tall at 40 columns, so more rows than the whole.
  const cropped = run(['disc.png', '-w', '40', '--crop', '0,0,0.5,1']).stdout.trimEnd().split('\n');
  assert.ok(cropped.length > whole.trimEnd().split('\n').length);
  const frame = run(['move.gif', '-w', '30', '--frame', '3']);
  assert.equal(frame.status, 0, frame.stderr);
  assert.ok(!/first frame/.test(frame.stderr));
  assert.equal(run(['move.gif', '--frame', '9']).status, 1);
  const light = run(['disc.png', '-w', '30', '--braille', '--threshold', '0.1']).stdout, dark = run(['disc.png', '-w', '30', '--braille', '--threshold', '0.9']).stdout;
  const dots = text => [...text].reduce((n, ch) => { const c = ch.codePointAt(0) - 0x2800; let b = 0; for (let v = c; v > 0; v >>= 1) b += v & 1; return n + (c > 0 && c < 256 ? b : 0); }, 0);
  assert.ok(dots(light) > dots(dark), 'a lower threshold lights more dots');
  // Contrast reaches the sub-cell modes too.
  assert.notEqual(run(['disc.png', '-w', '30', '--half']).stdout, run(['disc.png', '-w', '30', '--half', '--contrast', '2']).stdout);
});

check('--ink means one colour; models in folders find their files; errors are one line', () => {
  assert.equal(run(['disc.png', '-o', 'ink.svg', '--dark-ink', '#eeeeee']).status, 0);
  assert.ok(!/<tspan fill/.test(fs.readFileSync(path.join(dir, 'ink.svg'), 'utf8')), 'no per-character colours with --dark-ink');
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  const tri = Buffer.alloc(36); [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((v, i) => tri.writeFloatLE(v, i * 4));
  fs.writeFileSync(path.join(dir, 'sub/tri.bin'), tri);
  const gltf = { asset: { version: '2.0' }, buffers: [{ uri: 'tri.bin', byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 };
  fs.writeFileSync(path.join(dir, 'sub/tri.gltf'), JSON.stringify(gltf));
  const relative = run(['sub/tri.gltf', '-w', '30']);
  assert.equal(relative.status, 0, relative.stderr);
  fs.writeFileSync(path.join(dir, 'draco.gltf'), JSON.stringify({ ...gltf, extensionsUsed: ['KHR_draco_mesh_compression'], extensionsRequired: ['KHR_draco_mesh_compression'] }));
  const draco = run(['draco.gltf']);
  assert.equal(draco.status, 1);
  assert.match(draco.stderr, /re-export it without mesh compression/);
  assert.ok(!/\n\s+at /.test(draco.stderr), 'no stack trace');
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
    // From a pipe, as a GIF and an MP4, a start time and one frame.
    const piped = run(['-', '-o', 'piped.svg', '--frames', '3', '-w', '40'], { input: fs.readFileSync(path.join(dir, 'clip.mp4')), encoding: 'utf8' });
    assert.equal(piped.status, 0, piped.stderr);
    assert.equal((fs.readFileSync(path.join(dir, 'piped.svg'), 'utf8').match(/<g class="f f\d/g) ?? []).length, 3);
    assert.equal(run(['clip.mp4', '--frames', '4', '-w', '32', '-o', 'clip.gif']).status, 0);
    assert.equal(decodeImage(fs.readFileSync(path.join(dir, 'clip.gif'))).frames.length, 4);
    assert.equal(run(['torus', '--spin', '--frames', '6', '-w', '32', '-o', 'torus.mp4']).status, 0);
    const probe = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', path.join(dir, 'torus.mp4')], { encoding: 'utf8' });
    assert.equal(probe.stdout.trim(), '6');
    const later = run(['clip.mp4', '--start', '0.5', '--frame', '2', '-w', '32']);
    assert.equal(later.status, 0, later.stderr);
    // A still picture ffmpeg reads (WebP here) is a picture, not a one-frame video.
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=1:duration=1', '-frames:v', '1', path.join(dir, 'shot.webp')]);
    const webp = run(['shot.webp', '-w', '30']);
    assert.equal(webp.status, 0, webp.stderr);
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
  check('naming a format in a terminal prints once and exits', () => {
    const script = `
import os, pty, sys, time, select
pid, fd = pty.fork()
if pid == 0:
    os.execv(sys.argv[1], [sys.argv[1], sys.argv[2], 'torus', '-f', 'text', '-w', '40'])
out = b''
end = time.time() + 10
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
    assert.match(r.stderr, /exit=0/, r.stderr);
    assert.ok(!r.stdout.includes('\x1b[?1049h'), 'no alternate screen');
    assert.ok(r.stdout.replace(/\s/g, '').length > 100, 'the torus as text');
  });
} else console.log('skip terminal view (no python3 pty)');

fs.rmSync(dir, { recursive: true, force: true });
if (failures.length) { console.error(`${failures.length} failed`); process.exit(1); }
console.log('CLI checks passed.');
