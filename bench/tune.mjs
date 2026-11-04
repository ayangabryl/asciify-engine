// Parameter search for headless shape mode: node bench/tune.mjs <tunes.json> [--images dir]. Scores each tune on every
// picture (mean of close and far SSIM) and prints them best first. Development tool; the comparison is compare.mjs.
import fs from 'node:fs/promises'; import http from 'node:http'; import path from 'node:path';
import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url'; import { build } from 'esbuild';
const here = path.dirname(fileURLToPath(import.meta.url)); const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const arg = (n, f) => { const i = process.argv.indexOf(n); return i < 0 ? f : process.argv[i + 1]; };
const tunes = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
const bundle = await build({ entryPoints: [path.join(here, 'page.js')], bundle: true, format: 'esm', write: false, nodePaths: [path.join(here, 'node_modules')], logLevel: 'error' });
const files = new Map([['/img/0.jpg', path.join(here, '../tests/fixtures/motion-still.jpg')]]);
const dir = arg('--images', null);
if (dir) (await fs.readdir(dir)).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).sort().slice(0, Number(arg('--max', 8))).forEach((f, i) => files.set(`/img/${i + 1}${path.extname(f)}`, path.join(dir, f)));
const server = http.createServer(async (req, res) => {
  if (req.url === '/page.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); return; }
  if (files.has(req.url)) { res.end(await fs.readFile(files.get(req.url))); return; }
  res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><body><script type="module" src="/page.js"></script>');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch(); const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/`); await page.waitForFunction(() => window.bench);
const results = await page.evaluate(async ({ urls, tunes }) => {
  const { bench } = window;
  const pictures = [...await Promise.all(urls.map(u => bench.loadPicture(u))), bench.syntheticLines(), bench.syntheticText()];
  const out = [];
  for (const tune of tunes) {
    window.tune = tune;
    const scores = [];
    const renderer = tune.renderer ?? (tune.mode === 'tone' ? 'asciify-engine headless, tone' : 'asciify-engine headless, shape');
    const near = [], far = [];
    for (const p of pictures) { const rows = bench.gridRows(p, 100); const s = await bench.score(await bench.drawText(bench.TEXT_RENDERERS[renderer](p, 100, rows)), p); scores.push((s.close + s.far) / 2); near.push(s.close); far.push(s.far); }
    const photos = scores.slice(0, urls.length), mean = a => a.slice(0, urls.length).reduce((x, y) => x + y) / urls.length;
    out.push({ tune, photo: +(photos.reduce((a, b) => a + b) / photos.length).toFixed(4), lines: +scores.at(-2).toFixed(4), text: +scores.at(-1).toFixed(4), pClose: +mean(near).toFixed(3), pFar: +mean(far).toFixed(3) });
  }
  return out;
}, { urls: [...files.keys()], tunes });
results.forEach(r => r.all = +((r.photo * 2 + r.lines + r.text) / 4).toFixed(4));
results.sort((a, b) => b.all - a.all).forEach(r => console.log(r.all.toFixed(4), 'photo', r.photo.toFixed(4), `(close ${r.pClose} far ${r.pFar})`, 'lines', r.lines.toFixed(4), 'text', r.text.toFixed(4), JSON.stringify(r.tune)));
await browser.close(); server.close();
