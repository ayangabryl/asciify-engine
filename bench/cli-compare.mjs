// Command-line ASCII tools on the same pictures and grid, scored like every other renderer (bench/page.js: the text drawn in
// DejaVu Sans Mono, white on black, against the picture, by SSIM up close and at a distance). The tools: asciify-engine's
// command (shape and tone), jp2a and chafa (its ASCII symbols, no colour), each asked for exactly the same columns and rows,
// light characters on a dark ground. node bench/cli-compare.mjs --images <dir of PNG/JPEG> [--columns 100] [--out file.json]
// Needs jp2a and chafa on the PATH (apt install jp2a chafa) and `npm run build` for asciify-engine's own.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { workerSource } from './worker-source.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(import.meta.url)('playwright');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const columns = Number(arg('--columns', 100)), imageDir = arg('--images', null), cli = arg('--cli', path.join(here, '../dist/cli.js'));
if (!imageDir) { console.error('--images <dir> is required'); process.exit(1); }

const has = name => spawnSync(name, ['--version'], { stdio: 'ignore' }).status === 0;
const lines = text => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '').split('\n').filter((_, i, all) => i < all.length - 1 || all[i] !== '');
// Every tool asked for columns × rows of plain characters, light on dark.
const TOOLS = {
  'asciify-engine (shape)': (file, c, r) => spawnSync(process.execPath, [cli, file, '-w', String(c), '-H', String(r), '--no-color'], { encoding: 'utf8' }).stdout,
  'asciify-engine (tone)': (file, c, r) => spawnSync(process.execPath, [cli, file, '-w', String(c), '-H', String(r), '--no-color', '--tone'], { encoding: 'utf8' }).stdout,
  ...(has('jp2a') ? { 'jp2a 1.1 (--background=dark)': (file, c, r) => spawnSync('jp2a', [`--size=${c}x${r}`, '--background=dark', file], { encoding: 'utf8' }).stdout } : {}),
  ...(has('chafa') ? {
    'chafa 1.14 (ASCII symbols)': (file, c, r) => spawnSync('chafa', ['-f', 'symbols', '--symbols', 'ascii', '-c', 'none', '-s', `${c}x${r}`, '--stretch', '--animate', 'off', file], { encoding: 'utf8', env: { ...process.env, TERM: 'xterm' } }).stdout,
  } : {}),
};

// As compare.mjs builds it: the vendored hero's private exports exposed without editing the file.
const exposeHero = { name: 'expose-hero', setup(b) { b.onLoad({ filter: /webgl-ascii-hero[\\/]ascii-effect\.tsx$/ }, async args => ({ contents: `${await fs.readFile(args.path, 'utf8')}\nexport { AsciiEffectImpl, createGlyphTexture, TERMINAL_SYMBOLS }\n`, loader: 'tsx' })); } };
const bundle = await build({ entryPoints: [path.join(here, 'page.js')], bundle: true, format: 'esm', write: false, nodePaths: [path.join(here, 'node_modules')], loader: { '.ts': 'ts' }, jsx: 'automatic', plugins: [exposeHero, workerSource], logLevel: 'error' });
const files = (await fs.readdir(imageDir)).filter(f => /\.(png|jpe?g)$/i.test(f)).sort();
const server = http.createServer(async (req, res) => {
  if (req.url === '/page.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); return; }
  const name = decodeURIComponent(req.url.replace(/^\/img\//, ''));
  if (files.includes(name)) { res.end(await fs.readFile(path.join(imageDir, name))); return; }
  res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000"><script type="module" src="/page.js"></script>');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on('pageerror', e => console.error('page error:', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => window.bench);

const work = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-compare-'));
const sets = [...files.map(f => ({ name: f.replace(/\.\w+$/, ''), kind: 'photo', file: f })), { name: 'synthetic lines', kind: 'lines' }, { name: 'synthetic text', kind: 'text' }];
const results = { columns, tools: Object.keys(TOOLS), pictures: [] };
for (const set of sets) {
  // The picture as the page sees it, saved as the PNG every tool reads, and the grid's rows.
  const { png, rows } = await page.evaluate(async ({ set, columns }) => {
    const { bench } = window;
    const picture = set.kind === 'photo' ? await bench.loadPicture(`/img/${encodeURIComponent(set.file)}`) : set.kind === 'lines' ? bench.syntheticLines() : bench.syntheticText();
    window.current = picture;
    return { png: picture.toDataURL('image/png'), rows: bench.gridRows(picture, columns) };
  }, { set, columns });
  const file = path.join(work, `${set.name.replace(/\W+/g, '_')}.png`);
  await fs.writeFile(file, Buffer.from(png.split(',')[1], 'base64'));
  const row = { name: set.name, kind: set.kind, rows, scores: {} };
  for (const [name, run] of Object.entries(TOOLS)) {
    let text = lines(run(file, columns, rows) ?? '');
    // Exactly the grid: pad or cut what a tool returns.
    text = Array.from({ length: rows }, (_, r) => [...(text[r] ?? '')].slice(0, columns).join('').padEnd(columns, ' '));
    row.scores[name] = await page.evaluate(async lines => { const { bench } = window; return bench.score(await bench.drawText(lines), window.current); }, text);
  }
  results.pictures.push(row);
  console.log(`${set.name.padEnd(18)} ${Object.entries(row.scores).map(([n, s]) => `${n.split(' ')[0]} ${s.close.toFixed(3)}/${s.far.toFixed(3)}`).join('  ')}`);
}
const mean = (kind, tool, key) => { const rows = results.pictures.filter(p => p.kind === kind); return rows.reduce((a, p) => a + p.scores[tool][key], 0) / rows.length; };
results.summary = Object.fromEntries(Object.keys(TOOLS).map(tool => [tool, Object.fromEntries(['photo', 'lines', 'text'].map(kind => [kind, { close: +mean(kind, tool, 'close').toFixed(3), far: +mean(kind, tool, 'far').toFixed(3) }]))]));
console.log('\nmean (close / far)            photos           line art         type');
for (const [tool, s] of Object.entries(results.summary)) console.log(`${tool.padEnd(30)} ${s.photo.close.toFixed(3)} / ${s.photo.far.toFixed(3)}    ${s.lines.close.toFixed(3)} / ${s.lines.far.toFixed(3)}    ${s.text.close.toFixed(3)} / ${s.text.far.toFixed(3)}`);
// How often each tool is best, per picture and measure.
const wins = Object.fromEntries(Object.keys(TOOLS).map(t => [t, 0]));
for (const p of results.pictures) for (const key of ['close', 'far']) { const best = Object.entries(p.scores).sort((a, b) => b[1][key] - a[1][key])[0][0]; wins[best]++; }
results.wins = wins;
console.log('best on (picture × distance):', wins);
const out = arg('--out', null);
if (out) await fs.writeFile(out, JSON.stringify(results, null, 1));
await fs.rm(work, { recursive: true, force: true });
await browser.close(); server.close();
if (!existsSync(cli)) console.error(`note: ${cli} not found; build first`);
