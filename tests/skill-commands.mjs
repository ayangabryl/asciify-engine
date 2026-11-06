// The agent skill's commands, as documented: every `asciify-engine` command line in a fenced shell block of the skill runs
// against fixtures (placeholder files such as photo.jpg, logo.png, loop.gif, clip.mp4 or helmet.glb are made or copied under
// the same names; URLs are served locally; Claude's upload and output folders are mapped into a temporary folder) and must
// exit 0 and write something. Every flag named inline in the command-line references, or in an inline `asciify-engine …`
// command anywhere, must be one the parser accepts, and every relative link and anchor in the skill must resolve. Commands
// that need a camera are skipped, as are those that need sharp or ffmpeg when it is missing.
// npm run build && node tests/skill-commands.mjs
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const skill = path.join(root, 'skills/asciify-engine');
const cli = path.join(root, 'dist/cli.js');
if (!fs.existsSync(cli)) { console.error('Build first: npm run build'); process.exit(1); }
const started = Date.now();
const failures = [];
const fail = (what, why) => { failures.push(what); console.log(`FAIL ${what}\n     ${String(why).split('\n').slice(0, 6).join('\n     ')}`); };
const docs = [path.join(skill, 'SKILL.md'), ...fs.readdirSync(path.join(skill, 'references')).filter(f => f.endsWith('.md')).sort().map(f => path.join(skill, 'references', f))];
const rel = file => path.relative(skill, file);

// ---- Links and anchors -------------------------------------------------------------------------------------------------
const slugs = new Map();
const anchorsOf = file => {
  if (!slugs.has(file)) {
    const seen = new Map(), set = new Set();
    let fenced = false;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      const heading = !fenced && /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
      if (!heading) continue;
      // GitHub's anchors: lower case, punctuation dropped, spaces to hyphens, repeats numbered.
      const base = heading[1].toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s/g, '-');
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      set.add(n ? `${base}-${n}` : base);
    }
    slugs.set(file, set);
  }
  return slugs.get(file);
};
let links = 0;
for (const file of docs) {
  const text = fs.readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  for (const [, target] of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    if (/^(?:https?:|mailto:)/.test(target)) continue;
    links++;
    const [where, anchor] = target.split('#');
    const resolved = where ? path.resolve(path.dirname(file), where) : file;
    if (!fs.existsSync(resolved)) { fail(`${rel(file)}: link ${target}`, 'no such file'); continue; }
    if (anchor && resolved.endsWith('.md') && !anchorsOf(resolved).has(anchor)) fail(`${rel(file)}: link ${target}`, `no heading gives #${anchor}`);
  }
}

// ---- The flags the command accepts, read from its parser ---------------------------------------------------------------
const parser = fs.readFileSync(path.join(root, 'src/cli/args.ts'), 'utf8');
const accepted = new Set(), takesValue = new Set();
for (const group of parser.slice(parser.indexOf('switch (arg)')).split(/\n(?=\s*case ')/)) {
  const labels = [...group.matchAll(/case '(-[^']*)'/g)].map(m => m[1]);
  for (const label of labels) {
    accepted.add(label);
    if (/\b(?:value|number|hex)\(arg/.test(group) && label !== '--spin') takesValue.add(label);
  }
}
if (accepted.size < 40 || !takesValue.has('-o') || !takesValue.has('--ink')) fail('reading the CLI flags from src/cli/args.ts', `found ${accepted.size}`);
const flagOk = token => accepted.has(token.split('=')[0]);

// ---- A small shell reader: words, quotes, comments, pipes and redirects --------------------------------------------------
function words(line) {
  const out = [];
  let word = null, quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) { if (ch === quote) quote = null; else if (ch === '\\' && quote === '"' && /["\\$`]/.test(line[i + 1] ?? '')) word += line[++i]; else word += ch; continue; }
    if (ch === "'" || ch === '"') { quote = ch; word ??= ''; continue; }
    if (/\s/.test(ch)) { if (word !== null) { out.push(word); word = null; } continue; }
    if (ch === '#' && word === null) break;
    if ((ch === '|' || ch === '>') && word === null) { out.push({ op: ch }); continue; }
    if (ch === '\\' && i + 1 < line.length) { word = (word ?? '') + line[++i]; continue; }
    word = (word ?? '') + ch;
  }
  if (word !== null) out.push(word);
  return out;
}

/** The asciify-engine invocation on a line: its arguments, and what feeds its standard input. */
function invocation(line) {
  const tokens = words(line);
  const segments = [[]];
  for (const t of tokens) if (typeof t === 'object' && t.op === '|') segments.push([]); else segments[segments.length - 1].push(t);
  for (let s = 0; s < segments.length; s++) {
    const seg = segments[s];
    let i = 0;
    if (seg[0] === 'npx') {
      i = 1;
      while (i < seg.length && typeof seg[i] === 'string' && seg[i].startsWith('-')) i += seg[i] === '-p' || seg[i] === '--package' ? 2 : 1;
    }
    if (typeof seg[i] !== 'string' || !/^asciify-engine(@\S+)?$/.test(seg[i])) continue;
    const packages = seg.slice(1, i).filter((t, k, all) => all[k - 1] === '-p' || all[k - 1] === '--package');
    const args = [];
    let redirect = null;
    for (let k = i + 1; k < seg.length; k++) {
      if (typeof seg[k] === 'object') { if (seg[k].op === '>') redirect = seg[++k]; continue; }
      args.push(seg[k]);
    }
    const before = s > 0 ? segments[s - 1].filter(t => typeof t === 'string') : null;
    return { args, packages, redirect, feed: before ? before[before.length - 1] : null };
  }
  return null;
}

// ---- Fixtures -----------------------------------------------------------------------------------------------------------
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'asciify-skill-'));
const served = path.join(work, 'served');
fs.mkdirSync(served);
const require = createRequire(import.meta.url);
const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = buf => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const paint = (width, height, fn) => { const data = new Uint8Array(width * height * 4); for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(fn(x, y), (y * width + x) * 4); return data; };
const photoJpeg = fs.readFileSync(path.join(root, 'tests/fixtures/motion-still.jpg'));
const { decodeImage } = await import(pathToFileURL(path.join(root, 'dist/decode.js')).href);
const decoded = decodeImage(photoJpeg);
const photoPng = png(decoded.width, decoded.height, decoded.frames[0].data);
// A logo: a dark ring and bar on white. A sprite: a 16 × 16 heart on a transparent ground.
const logoPng = png(240, 120, paint(240, 120, (x, y) => { const d = Math.hypot(x - 60, y - 60); const on = (d > 30 && d < 44) || (x > 120 && x < 220 && y > 50 && y < 70); return on ? [20, 20, 30, 255] : [255, 255, 255, 255]; }));
const spritePng = png(16, 16, paint(16, 16, (x, y) => { const u = (x - 7.5) / 7, v = (y - 6) / 7; const on = (u * u + v * v - 1) ** 3 - u * u * v * v * v < 0; return on ? [230, 40, 60, 255] : [0, 0, 0, 0]; }));
function gif() {
  const { GIFEncoder, quantize, applyPalette } = require('gifenc');
  const encoder = GIFEncoder();
  for (let f = 0; f < 6; f++) {
    const data = paint(96, 64, (x, y) => (Math.hypot(x - 16 - f * 12, y - 32) < 14 ? [250, 160, 40, 255] : [20, 30, 60 + y, 255]));
    const palette = quantize(data, 32);
    encoder.writeFrame(applyPalette(data, palette), 96, 64, { palette, delay: 100 });
  }
  encoder.finish();
  return Buffer.from(encoder.bytes());
}
// A coloured octahedron, as glTF JSON with its buffer inline, or as GLB.
function gltfParts() {
  const positions = new Float32Array([1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1]);
  const colors = new Float32Array([0.9, 0.2, 0.2, 0.2, 0.9, 0.2, 0.2, 0.2, 0.9, 0.9, 0.9, 0.2, 0.9, 0.2, 0.9, 0.2, 0.9, 0.9]);
  const indices = new Uint16Array([0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4, 2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5]);
  const bin = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(colors.buffer), Buffer.from(indices.buffer)]);
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, COLOR_0: 1 }, indices: 2 }] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 72 }, { buffer: 0, byteOffset: 72, byteLength: 72 }, { buffer: 0, byteOffset: 144, byteLength: 48 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 6, type: 'VEC3', min: [-1, -1, -1], max: [1, 1, 1] },
      { bufferView: 1, componentType: 5126, count: 6, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: 24, type: 'SCALAR' },
    ],
  };
  return { json, bin };
}
function glb() {
  const { json, bin } = gltfParts();
  const pad = (buf, fill) => Buffer.concat([buf, Buffer.alloc((4 - (buf.length % 4)) % 4, fill)]);
  const j = pad(Buffer.from(JSON.stringify(json)), 0x20), b = pad(bin, 0);
  const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + j.length + 8 + b.length, 8);
  const head = (len, type) => { const h = Buffer.alloc(8); h.writeUInt32LE(len, 0); h.writeUInt32LE(type, 4); return h; };
  return Buffer.concat([header, head(j.length, 0x4e4f534a), j, head(b.length, 0x004e4942), b]);
}
function gltf() {
  const { json, bin } = gltfParts();
  json.buffers[0].uri = `data:application/octet-stream;base64,${bin.toString('base64')}`;
  return Buffer.from(JSON.stringify(json));
}
const obj = ['v -1 -1 -1', 'v 1 -1 -1', 'v 1 1 -1', 'v -1 1 -1', 'v -1 -1 1', 'v 1 -1 1', 'v 1 1 1', 'v -1 1 1', 'f 1 2 3 4', 'f 5 8 7 6', 'f 1 5 6 2', 'f 2 6 7 3', 'f 3 7 8 4', 'f 5 1 4 8'].join('\n');
function stl() {
  const tris = [[[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[0, 0, 0], [0, 0, 1], [1, 0, 0]], [[0, 0, 0], [0, 1, 0], [0, 0, 1]], [[1, 0, 0], [0, 0, 1], [0, 1, 0]]];
  const buf = Buffer.alloc(84 + 50 * tris.length);
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((tri, i) => tri.forEach((v, k) => v.forEach((c, j) => buf.writeFloatLE(c, 84 + i * 50 + 12 + k * 12 + j * 4))));
  return buf;
}
function ply() {
  const points = [];
  for (let i = 0; i < 1500; i++) { const u = (i / 1500) * 2 - 1, t = i * 2.399963, r = Math.sqrt(1 - u * u); points.push(`${(r * Math.cos(t)).toFixed(4)} ${u.toFixed(4)} ${(r * Math.sin(t)).toFixed(4)} ${Math.round(128 + 127 * u)} 90 ${Math.round(128 - 127 * u)}`); }
  return ['ply', 'format ascii 1.0', `element vertex ${points.length}`, 'property float x', 'property float y', 'property float z', 'property uchar red', 'property uchar green', 'property uchar blue', 'end_header', ...points].join('\n') + '\n';
}
const decodeFixture = (dir, name) => fs.readFileSync(path.join(root, 'tests/fixtures/decode', dir, name));
const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0 && spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;
let hasSharp = false;
try { require.resolve('sharp', { paths: [path.join(root, 'dist')] }); hasSharp = true; } catch { /* not installed */ }
const videoCache = new Map();
function video(ext) {
  if (!videoCache.has(ext)) {
    const file = path.join(work, `source.${ext}`);
    const codec = ext === 'webm' ? ['-c:v', 'libvpx-vp9', '-b:v', '300k'] : ['-pix_fmt', 'yuv420p'];
    const made = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=12:duration=2', ...codec, file]);
    videoCache.set(ext, made.status === 0 ? fs.readFileSync(file) : null);
  }
  return videoCache.get(ext);
}

/** The bytes for a placeholder input, by its name and extension; a string when it must be skipped. */
function fixture(name) {
  const base = path.basename(name).toLowerCase(), ext = path.extname(base).slice(1);
  switch (ext) {
    case 'jpg': case 'jpeg': return photoJpeg;
    case 'png': return /sprite|pixel|icon/.test(base) ? spritePng : /logo|line|sketch|diagram|scan|draw|sign|screen|shot|ui/.test(base) ? logoPng : photoPng;
    case 'apng': return decodeFixture('png', 'apng-basic.png');
    case 'gif': return gif();
    case 'bmp': return decodeFixture('bmp', '24bit.bmp');
    case 'ppm': case 'pnm': return decodeFixture('pnm', 'p6.ppm');
    case 'pgm': return decodeFixture('pnm', 'p5.pgm');
    case 'pbm': return decodeFixture('pnm', 'p4.pbm');
    case 'qoi': return decodeFixture('qoi', 'rgb.qoi');
    case 'webp': case 'avif': case 'heic': case 'heif': case 'tif': case 'tiff': case 'svg': return hasSharp ? null : `needs sharp for .${ext}`;
    case 'mp4': case 'm4v': case 'mov': case 'mkv': case 'webm':
      if (!hasFfmpeg) return 'needs ffmpeg';
      return video(ext === 'webm' ? 'webm' : 'mp4') ?? `ffmpeg could not make a .${ext}`;
    case 'glb': return glb();
    case 'gltf': return gltf();
    case 'obj': return Buffer.from(obj);
    case 'stl': return stl();
    case 'ply': return Buffer.from(ply());
    default: return { error: `no fixture for ${base || name}: add one to tests/skill-commands.mjs` };
  }
}

// URLs are served from a local folder, so the URL path of the command is exercised without the network.
const server = http.createServer((req, res) => {
  const file = path.join(served, path.basename(decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200); res.end(fs.readFileSync(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const SHAPES = new Set(['torus', 'donut', 'knot', 'sphere', 'cube', 'icosahedron']);
/** The command with placeholders swapped for fixtures: { args, stdin, outputs } or { skip }. */
function prepare(command) {
  const args = [], outputs = [];
  let stdin = null;
  const inputPath = name => {
    const bytes = fixture(name);
    if (bytes?.error) return bytes;
    if (typeof bytes === 'string') return { skip: bytes };
    if (bytes === null) return { skip: 'sharp handles this one' };
    const file = path.join(work, 'in', path.basename(name));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    return { file, bytes };
  };
  if (command.packages.some(p => /^sharp(@|$)/.test(p)) && !hasSharp) return { skip: 'needs sharp' };
  const list = command.args;
  for (let k = 0; k < list.length; k++) {
    const token = list[k];
    if (token.startsWith('-') && token.length > 1 && !/^-\d/.test(token)) {
      const flag = token.split('=')[0];
      if (!flagOk(token)) return { error: `unknown flag ${flag}` };
      if (flag === '--webcam' || flag === '--camera') return { skip: 'needs a camera' };
      args.push(token);
      if (token.includes('=')) continue;
      if (takesValue.has(flag) && k + 1 < list.length) {
        let value = list[++k];
        if (flag === '-o' || flag === '--output') {
          value = path.join(work, 'out', value.replace(/^\/+/, '').replace(/^~\//, ''));
          fs.mkdirSync(path.dirname(value), { recursive: true });
          outputs.push(value);
        }
        args.push(value);
      } else if (flag === '--spin' && /^-?\d+(\.\d+)?$/.test(list[k + 1] ?? '')) args.push(list[++k]);
      continue;
    }
    if (token === '-') {
      const source = command.feed ?? 'photo.jpg';
      const made = inputPath(/^https?:/.test(source) ? new URL(source).pathname : source);
      if (made.skip || made.error) return made;
      stdin = made.bytes;
      args.push('-');
      continue;
    }
    if (SHAPES.has(token.toLowerCase())) { args.push(token); continue; }
    if (/^https?:\/\//.test(token)) {
      const name = path.basename(new URL(token).pathname);
      const bytes = fixture(name);
      if (bytes?.error) return bytes;
      if (typeof bytes === 'string' || bytes === null) return { skip: typeof bytes === 'string' ? bytes : 'sharp handles this one' };
      fs.writeFileSync(path.join(served, name), bytes);
      args.push(`${origin}/${name}`);
      continue;
    }
    const made = inputPath(token);
    if (made.skip || made.error) return made;
    args.push(made.file);
  }
  if (command.redirect) outputs.push(path.join(work, 'out', path.basename(command.redirect)));
  return { args, stdin, outputs };
}

// ---- Collect the commands -------------------------------------------------------------------------------------------------
const commands = [];
let inlineFlags = 0;
for (const file of docs) {
  const text = fs.readFileSync(file, 'utf8');
  for (const block of text.matchAll(/^ {0,3}```([^\n]*)\n([\s\S]*?)^ {0,3}```/gm)) {
    if (!/^(sh|bash|shell|console|zsh)?\s*$/.test(block[1])) continue;
    for (const raw of block[2].split('\n')) {
      const line = raw.replace(/^\$\s+/, '').trim();
      if (!line || line.startsWith('#')) continue;
      const command = invocation(line);
      if (command) commands.push({ file, line, command });
    }
  }
  // Flags named inline: bare flags (`--light`, `-w 80`) in the command-line references, and the arguments of any inline
  // `asciify-engine …` command anywhere. Other programs' commands (npx's own flags, ffmpeg, npm) are not the CLI's.
  const cliDoc = /(?:^|\/)(cli|convert-attachments)\.md$/.test(file);
  for (const [, code] of text.replace(/```[\s\S]*?```/g, '').matchAll(/`([^`\n]+)`/g)) {
    const tokens = words(code).filter(t => typeof t === 'string').map(t => t.replace(/,$/, ''));
    let flags = [];
    if (cliDoc && /^-/.test(tokens[0] ?? '') && tokens[0] !== '-') flags = tokens;
    else { const command = invocation(code); if (command) flags = command.args; }
    for (const token of flags) {
      if (!/^--?[a-zA-Z0-9]/.test(token) || /^-\d/.test(token)) continue;
      inlineFlags++;
      if (!flagOk(token)) fail(`${rel(file)}: inline flag ${token.split('=')[0]}`, `not accepted by the command (in \`${code}\`)`);
    }
  }
}

// ---- Run them ------------------------------------------------------------------------------------------------------------
let ran = 0, skipped = 0;
const run = (args, stdin) => new Promise(resolve => {
  const child = spawn(process.execPath, [cli, ...args], { cwd: work, env: { ...process.env, NO_COLOR: '', FORCE_COLOR: '', COLORTERM: '' }, stdio: ['pipe', 'pipe', 'pipe'] });
  const out = [], err = [];
  child.stdout.on('data', d => out.push(d));
  child.stderr.on('data', d => err.push(d));
  const timer = setTimeout(() => child.kill('SIGKILL'), 45000);
  child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString() }); });
  child.stdin.on('error', () => {});
  child.stdin.end(stdin ?? undefined);
});
const queue = [];
for (const { file, line, command } of commands) {
  const name = `${rel(file)}: ${line.replace(/\s+#.*$/, '')}`;
  const prepared = prepare(command);
  if (prepared.error) fail(name, prepared.error);
  else if (prepared.skip) { skipped++; console.log(`skip ${name} (${prepared.skip})`); }
  else queue.push({ name, command, prepared });
}
async function worker() {
  while (queue.length) {
    const { name, command, prepared } = queue.shift();
    const result = await run(prepared.args, prepared.stdin);
    ran++;
    if (command.redirect && result.code === 0) fs.writeFileSync(prepared.outputs[prepared.outputs.length - 1], result.stdout);
    const problems = [];
    if (result.code !== 0) problems.push(`exit ${result.code ?? result.signal}: ${result.stderr.trim()}`);
    if (/Unknown option/.test(result.stderr)) problems.push(result.stderr.trim());
    const files = prepared.outputs.filter(f => !command.redirect || f !== prepared.outputs[prepared.outputs.length - 1]);
    for (const out of files) if (!fs.existsSync(out) || fs.statSync(out).size === 0) problems.push(`wrote nothing to ${path.basename(out)}`);
    if (!files.length && !command.redirect && result.code === 0 && !result.stdout.length) problems.push('printed nothing');
    if (problems.length) fail(name, problems.join('\n'));
    else console.log(`ok   ${name}`);
  }
}
await Promise.all(Array.from({ length: Math.max(1, Math.min(4, os.cpus().length)) }, worker));
server.close();
fs.rmSync(work, { recursive: true, force: true });

const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\n${commands.length} documented commands: ${ran} ran, ${skipped} skipped; ${inlineFlags} inline flags and ${links} links checked; ${seconds} s.`);
if (!commands.length) fail('finding commands', 'no asciify-engine commands in the skill');
if (failures.length) { console.error(`${failures.length} failed`); process.exit(1); }
console.log('Skill commands, flags and links verified.');
