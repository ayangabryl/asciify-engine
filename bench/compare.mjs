// Compares asciify-engine with other ASCII renderers on the same pictures and grid. node bench/compare.mjs [--images dir]
// [--columns 100] [--out file.json]. Needs `npm i` in bench/ and Playwright's Chromium with DejaVu Sans Mono installed.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const columns = Number(arg('--columns', 100));
const imageDir = arg('--images', null);
const only = arg('--only', null);

// The vendored hero keeps its effect class and glyph atlas private; the build exposes them without editing the file.
const exposeHero = { name: 'expose-hero', setup(b) { b.onLoad({ filter: /webgl-ascii-hero[\\/]ascii-effect\.tsx$/ }, async args => ({ contents: `${await fs.readFile(args.path, 'utf8')}\nexport { AsciiEffectImpl, createGlyphTexture, TERMINAL_SYMBOLS }\n`, loader: 'tsx' })); } };
const bundle = await build({ entryPoints: [path.join(here, 'page.js')], bundle: true, format: 'esm', write: false, nodePaths: [path.join(here, 'node_modules')], loader: { '.ts': 'ts' }, jsx: 'automatic', plugins: [exposeHero], logLevel: 'error' });
const pictures = [{ name: 'motion-still (photo)', url: '/img/motion-still.jpg', file: path.join(here, '../tests/fixtures/motion-still.jpg') }];
if (imageDir) for (const file of (await fs.readdir(imageDir)).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).sort()) pictures.push({ name: file.replace(/\.\w+$/, ''), url: `/img/${file}`, file: path.join(imageDir, file) });
const files = new Map(pictures.map(p => [p.url, p.file]));
const server = http.createServer(async (req, res) => {
  if (req.url === '/page.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); return; }
  if (files.has(req.url)) { res.end(await fs.readFile(files.get(req.url))); return; }
  res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000"><script type="module" src="/page.js"></script>');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on('pageerror', e => console.error('page error:', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => window.bench);
if (arg('--dump', null)) await page.evaluate(() => { window.dump = true; });
if (arg('--tune', null)) await page.evaluate(tune => { window.tune = tune; }, JSON.parse(arg('--tune', '{}')));
if (arg('--tune', null)) await page.evaluate(t => { window.tune = t; }, JSON.parse(arg('--tune', '{}')));
if (arg('--q', null)) await page.evaluate(q => { globalThis.__q = q; }, arg('--q', 'high'));
if (arg('--field', null)) await page.evaluate(o => { window.fieldOptions = o; }, JSON.parse(arg('--field', '{}')));
if (arg('--pixels-only', null)) await page.evaluate(only => { for (const k of Object.keys(window.bench.PIXEL_RENDERERS)) if (!k.includes(only)) delete window.bench.PIXEL_RENDERERS[k]; for (const k of Object.keys(window.bench.TEXT_RENDERERS)) delete window.bench.TEXT_RENDERERS[k]; }, arg('--pixels-only', ''));

const results = { columns, renderer: await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); const i = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(i ? i.UNMASKED_RENDERER_WEBGL : g.RENDERER); }), pictures: [] };
const sets = [...pictures.map(p => ({ name: p.name, kind: 'url', url: p.url })), { name: 'synthetic lines', kind: 'lines' }, { name: 'synthetic text', kind: 'text' }];
for (const set of sets) {
  const row = await page.evaluate(async ({ set, columns, only }) => {
    const { bench } = window;
    const picture = set.kind === 'url' ? await bench.loadPicture(set.url) : set.kind === 'lines' ? bench.syntheticLines() : bench.syntheticText();
    const rows = bench.gridRows(picture, columns), out = { name: set.name, rows, text: {}, pixels: {} };
    for (const [name, render] of Object.entries(bench.TEXT_RENDERERS)) {
      if (only && !name.includes(only)) continue;
      try {
        window.lastCrop = null;
        const lines = render(picture, columns, rows), drawn = await bench.drawText(lines);
        // A renderer that trims the picture to its subject is scored against that part of it.
        const target = window.lastCrop ? bench.cropped(picture, window.lastCrop) : picture;
        out.text[name] = { ...(await bench.score(drawn, target)), sample: lines.slice(Math.floor(rows / 2) - 2, Math.floor(rows / 2) + 2) };
        if (window.dump) out.text[name].png = drawn.toDataURL('image/png');
      } catch (e) { out.text[name] = { error: String(e && e.message || e).slice(0, 200) }; }
    }
    if (!only) {
      const ref = await bench.drawText(Array.from({ length: rows }, () => ' '.repeat(columns)));
      for (const [name, render] of Object.entries(bench.PIXEL_RENDERERS)) {
        try { const drawn = await render(picture, ref.width, ref.height, columns); out.pixels[name] = await bench.score(drawn, picture); if (window.dump) out.pixels[name].png = drawn.toDataURL('image/png'); }
        catch (e) { out.pixels[name] = { error: String(e && e.message || e).slice(0, 200) }; }
      }
    }
    return out;
  }, { set, columns, only });
  const dumpDir = arg('--dump', null);
  if (dumpDir) {
    await fs.mkdir(dumpDir, { recursive: true });
    for (const table of [row.text, row.pixels]) for (const [name, r] of Object.entries(table)) if (r.png) { await fs.writeFile(path.join(dumpDir, `${row.name}--${name}`.replace(/[^\w.-]+/g, '_') + '.png'), Buffer.from(r.png.split(',')[1], 'base64')); delete r.png; }
  }
  results.pictures.push(row);
  console.log(`\n${row.name} (${columns}x${row.rows})`);
  for (const [kind, table] of Object.entries({ text: row.text, pixels: row.pixels })) for (const [name, r] of Object.entries(table)) console.log(`  ${kind.padEnd(6)} ${name.padEnd(40)} ${r.error ? `ERROR ${r.error}` : `close ${r.close.toFixed(3)}  far ${r.far.toFixed(3)}   (pixel-value blur: ${r.closeCode.toFixed(3)} / ${r.farCode.toFixed(3)})`}`);
}
// Temporal stability and speed, text renderers only: a slow pan across the photo (0.15 of a cell a frame) and how many cells
// change per frame; then the time to convert a 1920×1080 frame to 160 columns (median of 7, after a warm-up).
if (!only || arg('--extras', null)) {
  results.extras = await page.evaluate(async ({ url }) => {
    const { bench } = window;
    const photo = await bench.loadPicture(url, 1280), big = await bench.loadPicture(url, 1920), out = {};
    const frames = bench.panFrames(photo, 24, 100);
    for (const [name, render] of Object.entries(bench.TEXT_RENDERERS)) {
      try {
        const rows = bench.gridRows(frames[0], 100);
        let previous = null;
        const sequence = frames.map(f => { const lines = render(f, 100, rows, previous); if (render.sequence) previous = window.lastGrid; return lines; });
        const churn = bench.churn(sequence);
        // Fidelity while panning: the last four frames of the pan scored against their own pictures, so a renderer that keeps
        // characters from frame to frame is caught if they lag the picture.
        let pan = 0;
        for (const f of [20, 21, 22, 23]) pan += (await bench.score(await bench.drawText(sequence[f]), frames[f])).far / 4;
        const ms = bench.timeIt(() => render(big, 160, bench.gridRows(big, 160)));
        out[name] = { churn, ms, pan: +pan.toFixed(3) };
      } catch (e) { out[name] = { error: String(e && e.message || e).slice(0, 160) }; }
    }
    return out;
  }, { url: pictures[0].url });
  console.log('\nflicker on a slow pan (% of cells changing per frame) and 1920x1080 -> 160 columns (ms):');
  for (const [name, r] of Object.entries(results.extras)) console.log(`  ${name.padEnd(40)} ${r.error ? r.error : `${String(r.churn).padStart(6)} %   ${String(r.ms).padStart(7)} ms   pan far ${r.pan}`}`);
}
const outFile = arg('--out', null);
if (outFile) await fs.writeFile(outFile, JSON.stringify(results, null, 1));
await browser.close(); server.close();
