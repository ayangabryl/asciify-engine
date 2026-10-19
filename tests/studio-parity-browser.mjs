// Pixel parity of the Studio renderer against a git baseline, for every look on asciify.org/looks (or the engine's own
// presets), at rest and along a scripted hover path, in light and dark. The baseline draws on the page with
// createStudioRenderer; the current tree draws the way mountStudio does now.
//
//   npm run test:parity -- [--ref HEAD] [--site ../asciify] [--ids a,b] [--schemes light,dark] [--scale 1.6] [--steps 90]
//
// Looks: every /looks card's settings, hover and sample, read from the site checkout (--site, default ../asciify), or
// --looks file.json ([{ id, settings, source }], sources under --public). Without either, STUDIO_LOOKS on a sample.
// Every comparison must match exactly, except a style whose dots a worker fills on the GPU (GPU_STYLES): Pointillism's
// are rasterised the way Chrome's GPU canvas does it (same polygons, same 4x multisampling), which leaves rounding-level
// differences, and a few edge samples, that a viewer cannot see. Those frames pass within the bounds below.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback; };
const ref = arg('ref', 'HEAD');
const schemes = arg('schemes', 'light,dark').split(',');
const ids = arg('ids', '')?.split(',').filter(Boolean);
const site = path.resolve(root, arg('site', '../asciify'));
const pub = arg('public', path.join(site, 'public'));
const steps = Number(arg('steps', '90'));
// The dialog draws the card's grid at a higher pixel ratio: --scale 1.6 checks that size too.
const scale = Number(arg('scale', '1'));
const { build } = await import(pathToFileURL(process.env.ASCIIFY_ESBUILD ?? path.join(root, 'node_modules/esbuild/lib/main.js')).href);
const { chromium } = await import(pathToFileURL(process.env.ASCIIFY_PLAYWRIGHT ?? '/Users/ayangabryl/asciify-recovery/tools/node_modules/playwright/index.mjs').href);

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'asciify-parity-'));
const baseline = path.join(work, 'baseline');
fs.mkdirSync(baseline);
execFileSync('sh', ['-c', `git archive ${ref} src | tar -x -C ${baseline}`], { cwd: root });
fs.symlinkSync(path.join(root, 'node_modules'), path.join(baseline, 'node_modules'));
const workerSource = {
  name: 'worker-source',
  setup(b) {
    b.onResolve({ filter: /\?worker-source$/ }, a => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?worker-source$/, '.ts')), namespace: 'worker-source' }));
    b.onLoad({ filter: /.*/, namespace: 'worker-source' }, async a => {
      const r = await build({ entryPoints: [a.path], bundle: true, write: false, format: 'iife', platform: 'browser', minify: true });
      return { contents: `export default ${JSON.stringify(r.outputFiles[0].text)};`, loader: 'js' };
    });
  },
};
const bundle = async (entry, contents, out) => build({
  stdin: { contents, resolveDir: entry, loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', outfile: out, logLevel: 'warning', plugins: [workerSource],
});
await bundle(path.join(baseline, 'src'), `export { createStudioRenderer, studioDimensions, normalizeStudioSettings, STUDIO_LOOKS } from './studio';`, path.join(work, 'baseline.js'));
await bundle(path.join(root, 'src'), `export { createWorkerStudioRenderer, studioWorkerSupported } from './studio/worker-renderer'; export { studioDimensions, normalizeStudioSettings, STUDIO_LOOKS } from './studio';`, path.join(work, 'current.js'));

await build({ stdin: { contents: `export { studioDimensions, normalizeStudioSettings } from './studio/model';`, resolveDir: path.join(root, 'src'), loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', outfile: path.join(work, 'current-node.mjs'), logLevel: 'warning' });
/** The site's looks as its /looks cards mount them (looks-catalog.ts and look-hovers.ts). */
async function siteLooks() {
  const lib = path.join(site, 'src/lib');
  if (!fs.existsSync(path.join(lib, 'looks-catalog.ts'))) return null;
  const raw = { name: 'raw', setup(b) {
    b.onResolve({ filter: /\?raw$/ }, a => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }));
    b.onLoad({ filter: /.*/, namespace: 'raw' }, a => ({ contents: fs.readFileSync(a.path, 'utf8'), loader: 'text' }));
  } };
  const file = path.join(work, 'site-looks.mjs');
  await build({ stdin: { contents: `import { LOOKS, LOOK_SAMPLES, lookFrame } from './looks-catalog'; import { lookHover } from './look-hovers'; import { HOME_STUDIES } from './home-studies';
    export default LOOKS.map(l => ({ id: l.id, settings: { ...lookFrame(l), hover: lookHover(l.id) }, source: HOME_STUDIES[LOOK_SAMPLES[l.id].source].poster }));`, resolveDir: lib, loader: 'ts' },
    bundle: true, format: 'esm', platform: 'node', outfile: file, logLevel: 'warning', plugins: [raw], external: ['asciify-engine*'] });
  return (await import(pathToFileURL(file).href)).default;
}
let looks = arg('looks') ? JSON.parse(fs.readFileSync(arg('looks'), 'utf8')) : await siteLooks();
if (!looks) {
  const { STUDIO_LOOKS } = await import(pathToFileURL(path.join(work, 'baseline.js')).href).catch(() => ({}));
  looks = (STUDIO_LOOKS ?? []).map(l => ({ id: l.id, settings: { ...l.settings, hover: { effect: 'trail', strength: .7, radius: .4 } }, source: '/images/looks/sources/lavender-v1.webp' }));
}
if (ids.length) looks = looks.filter(l => ids.includes(l.id));

const page = `<!doctype html><meta charset=utf-8><body style="margin:0"><script type=module>
// The /looks card: the still's 384px-high logical frame at a pixel ratio of 2.
const SCALE = ${scale};
const card = (settings, dims) => { const [a, b] = String(settings.aspectRatio).split(':').map(Number), ratio = a && b ? a / b : 4 / 3;
  return dims(Math.round(384 * ratio * 2 * SCALE), Math.round(768 * SCALE), settings); };
const path = n => { const s = [{ time: 0 }]; for (let i = 1; i <= n; i++) { const t = i / 40; s.push({ time: i / 120, pointer: [.5 + .38 * Math.sin(t * 2.1), .5 + .36 * Math.sin(t * 3.3 + .7), 1000 + i * 1000 / 120] }); }
  for (let i = 1; i <= 40; i++) s.push({ time: (n + i) / 120, leave: i === 1 }); return s; };
const checkpoints = n => [0, 10, 30, 60, n, n + 10, n + 40];
const read = async canvas => { const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height; const x = c.getContext('2d'); x.drawImage(canvas, 0, 0);
  const data = x.getImageData(0, 0, c.width, c.height).data;
  if (window.__png) (window.__pngs ||= []).push(c.toDataURL('image/png'));
  return await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result.slice(f.result.indexOf(',') + 1)); f.readAsDataURL(new Blob([data])); }); };
const load = src => new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = src; });
window.baseline = async (look, n, bitmap) => {
  const m = await import('/baseline.js'); let img = await load(look.source); if (bitmap) img = await createImageBitmap(img);
  const [w, h] = card(m.normalizeStudioSettings(look.settings), m.studioDimensions); const speed = m.normalizeStudioSettings(look.settings).motion.speed;
  const canvas = document.createElement('canvas'); document.body.append(canvas);
  const r = m.createStudioRenderer(canvas, look.settings, { maxDimension: 2048, maxCells: 65536 }); r.setPixelRatio(2 * SCALE);
  const out = []; const keep = checkpoints(n);
  for (const [i, s] of path(n).entries()) { if (s.pointer) r.pointer(...s.pointer); if (s.leave) r.leave(); r.render(img, s.time, w, h, s.time * speed); if (keep.includes(i)) out.push(await read(canvas)); }
  r.destroy(); canvas.remove(); return out;
};
window.current = async (look, n) => {
  const m = await import('/current.js'); const img = await load(look.source);
  if (!m.studioWorkerSupported()) throw new Error('worker path unavailable');
  const [w, h] = card(m.normalizeStudioSettings(look.settings), m.studioDimensions); const speed = m.normalizeStudioSettings(look.settings).motion.speed;
  const canvas = document.createElement('canvas'); document.body.append(canvas);
  let landed; const frame = () => new Promise((res, rej) => { landed = { res, rej }; });
  const r = m.createWorkerStudioRenderer(canvas, look.settings, { maxDimension: 2048, maxCells: 65536 }, { frame: () => landed.res(), ready: () => r.show(), unavailable: () => landed.rej(new Error('worker unavailable')), error: e => landed.rej(e) }, { width: w, height: h });
  window.__turns = r.turns;
  r.setPixelRatio(2 * SCALE);
  const out = []; const keep = checkpoints(n);
  for (const [i, s] of path(n).entries()) { if (s.pointer) r.pointer(...s.pointer); if (s.leave) r.leave(); const f = frame(); r.render(img, s.time, w, h, s.time * speed, { video: false, time: 0 }); await f; if (keep.includes(i)) out.push(await read(canvas)); }
  window.__turns = r.turns; r.destroy(); canvas.remove(); return out;
};
window.ready = true;
</script>`;
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(req.url.split('?')[0]);
  const file = name === '/' ? null : name.endsWith('.js') ? path.join(work, path.basename(name)) : path.join(pub, name);
  if (name.includes('..')) { res.statusCode = 400; return res.end(); }
  if (!file) { res.setHeader('Content-Type', 'text/html'); return res.end(page); }
  fs.readFile(file, (e, data) => { if (e) { res.statusCode = 404; return res.end(); } res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.webp') ? 'image/webp' : 'application/octet-stream'); res.end(data); });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const widthOf = async look => { const m = await import(pathToFileURL(path.join(work, 'current-node.mjs')).href); const s = m.normalizeStudioSettings(look.settings); const [a, b] = String(s.aspectRatio).split(':').map(Number); const r = a && b ? a / b : 4 / 3; return m.studioDimensions(Math.round(384 * r * 2 * scale), Math.round(768 * scale), s)[0]; };
const browser = await chromium.launch({ channel: 'chrome', headless: process.env.HEADLESS === '1', args: ['--window-position=-2400,0'] });
const GPU_STYLES = {
  // Pixels any channel of which differs by more than 16; mean and largest difference after a 1px blur.
  pointillism: { loud: .0005, seenMean: .05, seenMax: 24 },
};
const failures = [], rows = [];
let turns = 0;
let frameWidth = 0;
const width = () => frameWidth;
try {
  for (const scheme of schemes) for (const look of looks) {
    // A fresh page for each side: Chrome stops accelerating new canvases after about a hundred, which changes resampling.
    const run = async fn => {
      const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme });
      const p = await context.newPage();
      const errors = []; p.on('pageerror', e => errors.push(e.message));
      await p.goto(base); await p.waitForFunction(() => window.ready);
      try {
        if (process.env.PARITY_PNG) await p.evaluate(() => { window.__png = true; });
        const out = await p.evaluate(([fn, look, n, bitmap]) => window[fn](look, n, bitmap), [fn, look, steps, !!process.env.BASELINE_BITMAP]);
        if (fn === 'current') turns = await p.evaluate(() => window.__turns);
        if (process.env.PARITY_PNG) (await p.evaluate(() => window.__pngs)).forEach((url, i) => fs.writeFileSync(path.join(process.env.PARITY_PNG, `${look.id}-${scheme}-${fn}-${i}.png`), Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')));
        return out;
      }
      finally { await context.close(); if (errors.length) console.log(look.id, fn, 'page errors', errors); }
    };
    // Chrome's GPU raster is not always repeatable for a dense frame (CMYK's multiplied dots): a checkpoint passes when the
    // current renderer produces an output the baseline itself produces, over up to three runs of each.
    const decode = list => list.map(x => Buffer.from(x, 'base64'));
    const compare = (x, y) => {
      if (!y || y.length !== x.length) return { size: [x.length, y?.length] };
      let diff = 0, max = 0, sum = 0, loud = 0;
      for (let k = 0; k < x.length; k += 4) {
        let pixel = 0;
        for (let c = 0; c < 4; c++) { const d = Math.abs(x[k + c] - y[k + c]); if (d) { diff++; sum += d; if (d > pixel) pixel = d; } }
        if (pixel > max) max = pixel;
        if (pixel > 16) loud++;
      }
      return { diff, max, mean: sum / x.length, loud: loud / (x.length / 4), ...(diff ? seen(x, y) : {}) };
    };
    // What a viewer sees: both frames through a 1px Gaussian (a 2x screen at arm's length), alpha-weighted.
    const seen = (x, y) => {
      const w = width(x), h = x.length / 4 / w, blur = img => {
        const out = new Float32Array(w * h * 3), k = [1, 4, 6, 4, 1], tmp = new Float32Array(w * h * 3);
        for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) for (let c = 0; c < 3; c++) {
          let v = 0, n = 0; for (let d = -2; d <= 2; d++) { const q = Math.min(w - 1, Math.max(0, xx + d)), i = (yy * w + q) * 4; v += img[i + c] * img[i + 3] / 255 * k[d + 2]; n += k[d + 2]; } tmp[(yy * w + xx) * 3 + c] = v / n; }
        for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) for (let c = 0; c < 3; c++) {
          let v = 0, n = 0; for (let d = -2; d <= 2; d++) { const q = Math.min(h - 1, Math.max(0, yy + d)); v += tmp[(q * w + xx) * 3 + c] * k[d + 2]; n += k[d + 2]; } out[(yy * w + xx) * 3 + c] = v / n; }
        return out;
      };
      const a = blur(x), b = blur(y);
      let max = 0, sum = 0, over = 0;
      for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); sum += d; if (d > max) max = d; if (d > 8) over++; }
      return { seenMean: sum / a.length, seenMax: max, seenOver8: over / a.length };
    };
    frameWidth = await widthOf(look);
    const baselines = [decode(await run('baseline'))], currents = [decode(await run(process.env.PARITY_SELF || 'current'))];
    let frames = baselines[0].map((x, i) => compare(x, currents[0][i]));
    for (let attempt = 1; attempt < 3 && frames.some(f => f.diff !== 0); attempt++) {
      baselines.push(decode(await run('baseline')));
      currents.push(decode(await run(process.env.PARITY_SELF || 'current')));
      frames = frames.map((f, i) => {
        if (f.diff === 0) return f;
        let best = f;
        for (const x of baselines) for (const y of currents) { const c = compare(x[i], y[i]); if (c.diff === 0) return { diff: 0, max: 0, repeats: baselines.length }; if (c.diff < (best.diff ?? Infinity)) best = c; }
        return best;
      });
    }
    const bound = GPU_STYLES[look.settings.style];
    const within = f => f.diff === 0 || (bound && !f.size && f.loud <= bound.loud && f.seenMean <= bound.seenMean && f.seenMax <= bound.seenMax);
    const ok = frames.every(within);
    const exact = frames.every(f => f.diff === 0);
    rows.push({ scheme, id: look.id, style: look.settings.style, ok, exact, frames });
    console.log(`${ok ? exact ? 'PASS' : 'PASS (GPU bound)' : 'FAIL'} ${scheme} ${look.id} (${look.settings.style}, ${turns} workers) ${frames.map(f => f.size ? 'size' : f.diff ? `${f.diff}/${f.max}/mean${f.mean.toFixed(2)}/loud${(f.loud * 100).toFixed(1)}%/seen${f.seenMean.toFixed(2)},max${f.seenMax.toFixed(1)},over8:${(f.seenOver8 * 100).toFixed(2)}%` : f.repeats ? `0(${f.repeats} runs)` : '0').join(' ')}`);
    if (!ok) failures.push(`${scheme} ${look.id}`);
  }
} finally {
  await browser.close(); server.close();
  fs.rmSync(work, { recursive: true, force: true });
}
if (arg('out')) fs.writeFileSync(arg('out'), JSON.stringify(rows, null, 1));
console.log(`${rows.filter(r => r.exact).length}/${rows.length} identical, ${rows.filter(r => r.ok && !r.exact).length} within the GPU bound, ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
