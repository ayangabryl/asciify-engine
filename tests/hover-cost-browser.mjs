// Hover frame cost of every look on asciify.org/looks, drawn the way mountStudio draws it (in workers), along a scripted
// hover path at the /looks card's size (and with --scale 1.05, the dialog's). Fails when a look's frame cost regresses
// past its recorded budget. Run after the engine changes, on an otherwise idle machine.
//
//   npm run bench:looks -- [--site ../asciify] [--ids a,b] [--scale 1.05] [--steps 120] [--record] [--profile]
//
// Each frame is timed inside the worker (`cost`, what the workers' turns are sized by) and from request to the frame
// landing on the page and being rastered (`wall`, which includes the GPU's share: a look can be cheap in its worker and
// still saturate the GPU). tests/fixtures/hover-cost.json (hover-cost-1.05.json for the dialog) holds each look's
// budgets: a look fails when its median cost or wall time exceeds its budget * 1.5 + 1 ms. --record writes the measured
// medians as the new budgets (run it on the machine the budgets describe, with nothing else drawing). --profile also runs
// each look on the page's main thread, with the worker's GPU dots, under the CPU profiler and prints where its frames go.
// `hover changes` is the share of pixels the hover visibly changes against the frame at rest: a look whose pairing
// (the site's look-hovers.ts) barely shows is flagged FAINT. SHOTS=dir saves the rest and hover frames.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback; };
const flag = name => process.argv.includes('--' + name);
const ids = arg('ids', '')?.split(',').filter(Boolean);
const site = path.resolve(root, arg('site', '../asciify'));
const pub = path.join(site, 'public');
const steps = Number(arg('steps', '120'));
const scale = Number(arg('scale', '1'));
const budgets = path.join(root, 'tests/fixtures', scale === 1 ? 'hover-cost.json' : `hover-cost-${scale}.json`);
const { build } = await import(pathToFileURL(process.env.ASCIIFY_ESBUILD ?? path.join(root, 'node_modules/esbuild/lib/main.js')).href);
const { chromium } = await import(pathToFileURL(process.env.ASCIIFY_PLAYWRIGHT ?? '/Users/ayangabryl/asciify-recovery/tools/node_modules/playwright/index.mjs').href);

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'asciify-hover-cost-'));
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
await build({
  stdin: { contents: `export { createWorkerStudioRenderer, studioWorkerSupported } from './studio/worker-renderer'; export { createStudioRenderer, studioDimensions, normalizeStudioSettings } from './studio'; export { createStudioRendererCore } from './studio/renderer'; export { createDotMarks } from './studio/dot-marks';`, resolveDir: path.join(root, 'src'), loader: 'ts' },
  bundle: true, format: 'esm', platform: 'browser', outfile: path.join(work, 'current.js'), logLevel: 'warning', plugins: [workerSource],
});
const raw = { name: 'raw', setup(b) {
  b.onResolve({ filter: /\?raw$/ }, a => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }));
  b.onLoad({ filter: /.*/, namespace: 'raw' }, a => ({ contents: fs.readFileSync(a.path, 'utf8'), loader: 'text' }));
} };
await build({ stdin: { contents: `import { LOOKS, LOOK_SAMPLES, lookFrame } from './looks-catalog'; import { lookHover } from './look-hovers'; import { HOME_STUDIES } from './home-studies';
  export default LOOKS.map(l => ({ id: l.id, settings: { ...lookFrame(l), hover: lookHover(l.id) }, source: HOME_STUDIES[LOOK_SAMPLES[l.id].source].poster }));`, resolveDir: path.join(site, 'src/lib'), loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: path.join(work, 'site-looks.mjs'), logLevel: 'warning', plugins: [raw], external: ['asciify-engine*'] });
let looks = (await import(pathToFileURL(path.join(work, 'site-looks.mjs')).href)).default;
if (ids.length) looks = looks.filter(l => ids.includes(l.id));

const page = `<!doctype html><meta charset=utf-8><body style="margin:0"><script type=module>
const SCALE = ${scale};
const card = (settings, dims) => { const [a, b] = String(settings.aspectRatio).split(':').map(Number), ratio = a && b ? a / b : 4 / 3;
  return dims(Math.round(384 * ratio * 2 * SCALE), Math.round(768 * SCALE), settings); };
const path = n => { const s = [{ time: 0 }]; for (let i = 1; i <= n; i++) { const t = i / 40; s.push({ time: i / 120, pointer: [.5 + .38 * Math.sin(t * 2.1), .5 + .36 * Math.sin(t * 3.3 + .7), 1000 + i * 1000 / 120] }); } return s; };
const load = src => new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = src; });
const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const p95 = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * .95)]; };
window.worker = async (look, n) => {
  const m = await import('/current.js'); const img = await load(look.source);
  const s = m.normalizeStudioSettings(look.settings); const [w, h] = card(s, m.studioDimensions);
  const canvas = document.createElement('canvas'); document.body.append(canvas);
  let landed, cost = 0; const frame = () => new Promise((res, rej) => { landed = { res, rej }; });
  const r = m.createWorkerStudioRenderer(canvas, look.settings, { maxDimension: 2048, maxCells: 65536 }, { frame: (t, c) => { cost = c; landed.res(); }, ready: () => r.show(), unavailable: () => landed.rej(new Error('worker unavailable')), error: e => landed.rej(e) }, { width: w, height: h });
  r.setPixelRatio(2 * SCALE);
  const costs = [], walls = [], shots = [];
  const probe = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d');
  // How much of the frame the hover changes, against the frame at rest: a pairing a look cannot show changes little.
  const grab = () => { const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height; const x = c.getContext('2d'); x.drawImage(canvas, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
  for (const [i, st] of path(n).entries()) {
    if (st.pointer) r.pointer(...st.pointer);
    const f = frame(), t0 = performance.now(); r.render(img, st.time, w, h, st.time * s.motion.speed, { video: false, time: 0 }); await f;
    // Reading one pixel back waits for the GPU to finish rastering the frame: wall time then includes the GPU's share.
    probe.drawImage(canvas, 0, 0, 1, 1, 0, 0, 1, 1); probe.getImageData(0, 0, 1, 1);
    if (i > 10) { costs.push(cost); walls.push(performance.now() - t0); }
    if (i === 0 || i === 40 || i === 80) { shots.push(grab()); if (window.__shots) (window.__urls ||= []).push(canvas.toDataURL()); }
  }
  const changed = (a, b) => { let n = 0; for (let k = 0; k < a.length; k += 4) if (Math.abs(a[k] - b[k]) + Math.abs(a[k + 1] - b[k + 1]) + Math.abs(a[k + 2] - b[k + 2]) > 48) n++; return n / (a.length / 4); };
  const out = { cost: median(costs), costP95: p95(costs), wall: median(walls), wallP95: p95(walls), size: [canvas.width, canvas.height], visible: shots.length === 3 ? Math.max(changed(shots[0], shots[1]), changed(shots[0], shots[2])) : 0 };
  r.destroy(); canvas.remove(); return out;
};
window.main = async (look, n) => {
  const m = await import('/current.js'); const img = await load(look.source);
  const s = m.normalizeStudioSettings(look.settings); const [w, h] = card(s, m.studioDimensions);
  const canvas = document.createElement('canvas'); document.body.append(canvas);
  // The worker's host on the page, GPU dots included, so the profile shows what a worker spends.
  const surface = () => { const c = document.createElement('canvas'); return { canvas: c, ctx: c.getContext('2d') }; };
  const r = m.createStudioRendererCore(canvas, look.settings, { maxDimension: 2048, maxCells: 65536 }, { surface, media: () => ({ video: false, time: 0, key: img }), marks: m.createDotMarks, finished() {} });
  r.setPixelRatio(2 * SCALE);
  const times = [];
  for (const [i, st] of path(n).entries()) { if (st.pointer) r.pointer(...st.pointer); const t0 = performance.now(); r.render(img, st.time, w, h, st.time * s.motion.speed); if (i > 10) times.push(performance.now() - t0); }
  r.destroy(); canvas.remove(); return median(times);
};
window.ready = true;
</script>`;
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(req.url.split('?')[0]);
  if (name.includes('..')) { res.statusCode = 400; return res.end(); }
  if (name === '/') { res.setHeader('Content-Type', 'text/html'); return res.end(page); }
  const file = name.endsWith('.js') ? path.join(work, path.basename(name)) : path.join(pub, name);
  fs.readFile(file, (e, data) => { if (e) { res.statusCode = 404; return res.end(); } res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'image/webp'); res.end(data); });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ channel: 'chrome', headless: process.env.HEADLESS === '1', args: ['--window-position=-2400,0'] });
const recorded = fs.existsSync(budgets) ? JSON.parse(fs.readFileSync(budgets, 'utf8')) : {};
const failures = [], measured = {};
try {
  for (const look of looks) {
    // A fresh page per look: Chrome stops accelerating new canvases after about a hundred.
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
    const p = await context.newPage();
    try {
      await p.goto(base); await p.waitForFunction(() => window.ready);
      if (process.env.SHOTS) await p.evaluate(() => { window.__shots = true; });
      const r = await p.evaluate(([look, n]) => window.worker(look, n), [look, steps]);
      if (process.env.SHOTS) (await p.evaluate(() => window.__urls)).forEach((url, i) => fs.writeFileSync(path.join(process.env.SHOTS, `${look.id}-${i}.png`), Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')));
      let profile = '';
      if (flag('profile')) {
        const cdp = await context.newCDPSession(p);
        await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 100 }); await cdp.send('Profiler.start');
        const ms = await p.evaluate(([look, n]) => window.main(look, n), [look, steps]);
        const { profile: prof } = await cdp.send('Profiler.stop');
        const self = new Map(), total = prof.samples.length;
        const byId = new Map(prof.nodes.map(n => [n.id, n]));
        const counts = new Map(); for (const s of prof.samples) counts.set(s, (counts.get(s) ?? 0) + 1);
        for (const [id, c] of counts) { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) ?? 0) + c); }
        profile = ` main ${ms.toFixed(1)}ms | ` + [...self].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, c]) => `${k} ${(c / total * 100).toFixed(0)}%`).join(', ');
      }
      measured[look.id] = { cost: +r.cost.toFixed(2), wall: +r.wall.toFixed(2) };
      const budget = recorded[look.id];
      const over = budget !== undefined && (r.cost > budget.cost * 1.5 + 1 || r.wall > budget.wall * 1.5 + 1);
      if (over) failures.push(look.id);
      console.log(`${over ? 'FAIL' : budget === undefined ? 'NEW ' : 'PASS'} ${look.id.padEnd(12)} ${look.settings.style.padEnd(12)} cost ${r.cost.toFixed(1)}ms (p95 ${r.costP95.toFixed(1)}) wall ${r.wall.toFixed(1)}ms (p95 ${r.wallP95.toFixed(1)}) ${r.size.join('x')} hover changes ${(r.visible * 100).toFixed(1)}%${r.visible < .01 ? ' FAINT' : ''}${budget !== undefined ? ` budget ${budget.cost}/${budget.wall}ms` : ''}${profile}`);
    } finally { await context.close(); }
  }
} finally {
  await browser.close(); server.close();
  fs.rmSync(work, { recursive: true, force: true });
}
if (flag('record')) { fs.writeFileSync(budgets, JSON.stringify({ ...recorded, ...measured }, null, 1) + '\n'); console.log('recorded', budgets); }
if (failures.length) { console.log(`${failures.length} looks over budget: ${failures.join(', ')}`); process.exit(1); }
