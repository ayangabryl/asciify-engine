// Main-thread time to convert a 1920×1080 frame to 160 columns, measured by Chrome itself: every task the page's main thread
// runs while a renderer converts 8 fresh frames (as with video) is taken from a trace, garbage collection included, and
// divided by 8. Each run times every renderer whose name matches --only (a regular expression) in turn, so they share the
// machine's load; the table gives each run and the spread across runs.
// node bench/speed.mjs [--only "ASCII Magic|GPU text"] [--runs 10] [--out file.json]
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { workerSource } from './worker-source.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(import.meta.url)('playwright');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const only = new RegExp(arg('--only', 'ASCII Magic|GPU text')), runs = Number(arg('--runs', 10)), FRAMES = 8;
const exposeHero = { name: 'expose-hero', setup(b) { b.onLoad({ filter: /webgl-ascii-hero[\\/]ascii-effect\.tsx$/ }, async args => ({ contents: `${await fs.readFile(args.path, 'utf8')}\nexport { AsciiEffectImpl, createGlyphTexture, TERMINAL_SYMBOLS }\n`, loader: 'tsx' })); } };
const bundle = await build({ entryPoints: [path.join(here, 'page.js')], bundle: true, format: 'esm', write: false, nodePaths: [path.join(here, 'node_modules')], loader: { '.ts': 'ts' }, jsx: 'automatic', plugins: [exposeHero, workerSource], logLevel: 'error' });
const server = http.createServer(async (req, res) => {
  if (req.url === '/page.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); return; }
  if (req.url === '/photo.jpg') { res.end(await fs.readFile(path.join(here, '../tests/fixtures/motion-still.jpg'))); return; }
  res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000"><script type="module" src="/page.js"></script>');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--expose-gc'] });
const page = await browser.newPage();
page.on('pageerror', e => console.error('page error:', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => window.bench);
const names = await page.evaluate(source => Object.keys(window.bench.TEXT_RENDERERS).filter(n => new RegExp(source).test(n)), only.source);
// A warm-up: code compiled, the GPU converter's worker started.
await page.evaluate(async names => {
  const f = await window.bench.loadPicture('/photo.jpg', 1920);
  for (const n of names) for (let i = 0; i < 3; i++) await window.bench.TEXT_RENDERERS[n](f, 160, window.bench.gridRows(f, 160));
}, names);
const cdp = await page.context().newCDPSession(page);
const times = Object.fromEntries(names.map(n => [n, []]));
for (let run = 0; run < runs; run++) {
  // Fresh frames for every renderer, made before the trace starts.
  await page.evaluate(async ({ names, FRAMES }) => {
    window.speedFrames = null;
    globalThis.gc?.();
    window.speedFrames = [];
    for (let i = 0; i < names.length * FRAMES; i++) window.speedFrames.push(await window.bench.loadPicture('/photo.jpg', 1920));
    // Each frame finished on the GPU before timing starts (a pixel of it drawn elsewhere and read back), so no renderer pays
    // for drawing the frames. Reading another canvas leaves the frame itself on the GPU.
    const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    for (const f of window.speedFrames) { probe.drawImage(f, 0, 0, 1, 1); probe.getImageData(0, 0, 1, 1); }
    // The last run's frames collected now, not inside someone's timing.
    globalThis.gc?.();
    await new Promise(r => setTimeout(r, 300));
  }, { names, FRAMES });
  const events = [];
  const collect = e => events.push(...e.value);
  cdp.on('Tracing.dataCollected', collect);
  const complete = new Promise(r => cdp.once('Tracing.tracingComplete', r));
  await cdp.send('Tracing.start', { categories: 'toplevel,blink.user_timing,v8', transferMode: 'ReportEvents' });
  await page.evaluate(async ({ names, FRAMES }) => {
    let k = 0;
    for (const n of names) {
      await new Promise(r => setTimeout(r, 100));
      performance.mark(`start ${n}`);
      for (let i = 0; i < FRAMES; i++) { const f = window.speedFrames[k++]; await window.bench.TEXT_RENDERERS[n](f, 160, window.bench.gridRows(f, 160)); }
      performance.mark(`end ${n}`);
    }
    await new Promise(r => setTimeout(r, 100));
    window.speedFrames = null;
  }, { names, FRAMES });
  await cdp.send('Tracing.end');
  await complete;
  cdp.off('Tracing.dataCollected', collect);
  const marks = events.filter(e => /^(start|end) /.test(e.name) && e.cat?.includes('blink.user_timing'));
  const main = { pid: marks[0].pid, tid: marks[0].tid };
  const tasks = events.filter(e => e.pid === main.pid && e.tid === main.tid && e.ph === 'X' && /RunTask$/.test(e.name));
  const line = [];
  for (const n of names) {
    const s = marks.find(m => m.name === `start ${n}`).ts, e = marks.find(m => m.name === `end ${n}`).ts;
    const busy = tasks.reduce((sum, t) => sum + Math.max(0, Math.min(e, t.ts + t.dur) - Math.max(s, t.ts)), 0) / 1000 / FRAMES;
    times[n].push(+busy.toFixed(2));
    if (process.env.SPEED_GC) {
      const gc = events.filter(ev => ev.pid === main.pid && ev.tid === main.tid && ev.ph === 'X' && /GC|Collect/i.test(ev.name) && ev.ts >= s && ev.ts <= e);
      const top = gc.filter(g => !gc.some(o => o !== g && o.ts <= g.ts && o.ts + o.dur >= g.ts + g.dur && o.dur > g.dur));
      line.push(`[gc ${(top.reduce((a, g) => a + g.dur, 0) / 1000 / FRAMES).toFixed(2)} ${[...new Set(top.map(g => g.name))].join(',')}]`);
    }
    line.push(`${n.replace('asciify-engine ', '')} ${busy.toFixed(2)}`);
  }
  console.log(`run ${run + 1}: ${line.join(' | ')}`);
}
console.log(`\nmain-thread tasks per 1920x1080 frame at 160 columns (Chrome trace, ${FRAMES} fresh frames a run, ${runs} runs), ms:`);
for (const n of names) { const t = [...times[n]].sort((a, b) => a - b); console.log(`  ${n.padEnd(44)} min ${t[0]}  median ${t[Math.floor(t.length / 2)]}  max ${t[t.length - 1]}`); }
const outFile = arg('--out', null);
if (outFile) await fs.writeFile(outFile, JSON.stringify({ runs, frames: FRAMES, times }, null, 1));
await browser.close(); server.close();
