// Pixel parity between two builds: the same components and fields, on a frozen clock, light and dark, compared pixel for pixel.
// node tests/field-parity-browser.mjs <distA> <distB> [--only name,...] [--webkit] [--out dir]
// Each case mounts, the fake clock runs a fixed number of frames (with pointer moves for the hover cases), and the stage is
// captured. A difference is any channel off by more than 2; the report gives the share of such pixels and the largest one.
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const [distA, distB] = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!distA || !distB) throw new Error('usage: field-parity-browser.mjs <distA> <distB>');
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const only = arg('--only')?.split(','), outDir = arg('--out'), useWebkit = process.argv.includes('--webkit');
const pw = await import(pathToFileURL(process.env.ASCIIFY_PLAYWRIGHT ?? path.join(root, 'node_modules/playwright/index.mjs')).href);
const media = process.env.ASCIIFY_BENCH_MEDIA ?? path.join(os.tmpdir(), 'asciify-bench-media');

const PAGE = `<!doctype html><meta charset="utf-8"><style>:root{color-scheme:light dark}body{margin:0;font:16px system-ui;color:#222;background:#fafaf8}
@media (prefers-color-scheme:dark){body{color:#e8e6e1;background:#141413}}#stage{position:relative;padding:24px;width:720px}#stage>*{position:relative;margin:0 0 16px}
button{font:inherit;padding:14px 28px;border-radius:10px;border:1px solid currentColor;background:transparent;color:inherit}</style><div id="stage"></div>`;
const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const [, build, ...rest] = url.split('/');
  try {
    if (build === 'media') { res.setHeader('Content-Type', url.endsWith('.jpg') ? 'image/jpeg' : 'video/mp4'); res.end(await fs.readFile(path.join(media, rest.join('/')))); return; }
    if (url.endsWith('.js')) { res.setHeader('Content-Type', 'text/javascript'); res.end(await fs.readFile(path.join(build === 'b' ? distB : distA, ...rest))); return; }
  } catch { res.statusCode = 404; res.end(); return; }
  res.setHeader('Content-Type', 'text/html'); res.end(PAGE);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const img = '/media/still-1280.jpg';
// [markup, mount body (k = kit, f = field), pointer path (stage px) or null, frames]
const CASES = {
  beam: ['<button>Continue</button>', 'k.beam(el)', [[30, 20], [120, 30]], 40],
  pill: ['<span style="padding:4px 12px;display:inline-block">Beta</span>', 'k.pill(el)', null, 30],
  decode: ['<h1 style="font-size:40px">Characters that belong.</h1>', `k.decode(el, { text: 'Characters that belong.' })`, null, 90],
  odometer: ['<span style="font-size:48px;display:inline-block">1,234</span>', 'k.odometer(el, { value: 1234 })', null, 60],
  statusOrb: ['<div style="width:120px;height:120px"></div>', 'k.statusOrb(el)', null, 40],
  skeleton: ['<div style="width:320px"><p>Loading line one</p><p>Loading line two</p></div>', 'k.skeleton(el)', null, 40],
  tabs: ['<div role="tablist"><button role="tab" aria-selected="true">One</button><button role="tab">Two</button></div>', 'k.tabs(el)', [[40, 20], [160, 24]], 40],
  buttonLoading: ['<button>Save</button>', 'k.buttonLoading(el)', null, 30],
  thinking: ['<div style="width:240px;height:40px">Thinking</div>', 'k.thinking(el)', null, 40],
  blockChart: ['<div style="width:480px;height:200px"></div>', `k.blockChart(el, { values: [3, 5, 2, 8, 6, 4, 7], labels: ['a','b','c','d','e','f','g'] })`, [[100, 100], [300, 120]], 40],
  wordmark: ['<h1 style="height:160px;font-size:120px;margin:0">asciify</h1>', `k.wordmark(el, { text: 'asciify' })`, [[100, 80], [300, 90]], 40],
  heroBackground: ['<section style="height:360px"></section>', `k.fieldBackground(el, { preset: 'hero' })`, [[100, 100], [400, 200], [600, 150]], 60],
  notFound: ['<section style="height:360px"></section>', `k.fieldBackground(el, { preset: 'notFound' })`, null, 30],
  swell: ['<section style="height:300px"></section>', 'k.background(el, { preset: k.swell })', [[200, 150], [500, 120]], 50],
  fluid: ['<section style="height:300px"></section>', 'k.background(el, { preset: k.fluid })', [[200, 150], [500, 120]], 50],
  drift: ['<section style="height:300px"></section>', 'k.background(el, { preset: k.drift })', null, 40],
  artPanel: ['<figure style="width:360px;height:240px;margin:0"></figure>', `k.artPanel(el, { image: '${img}' })`, [[100, 100], [250, 140]], 40],
  globalLook: ['<button>Look</button>', `(k.setGlobalLook({ style: 'braille' }), k.beam(el))`, null, 40],
  ...Object.fromEntries(['glyph', 'dot', 'pixel', 'led', 'cmyk', 'pointillism', 'risograph'].map(mark => [`field ${mark}`,
    ['<canvas style="display:block;width:480px;height:300px"></canvas>', `f.mountGlyphField(el, { source: '${img}', mark: '${mark}', hover: 'lantern' })`, [[100, 100], [300, 180]], 40]])),
  'field braille trail': ['<canvas style="display:block;width:480px;height:300px"></canvas>', `f.mountGlyphField(el, { source: '${img}', charset: ' ⠁⠃⠇⡇⣇⣧⣷⣿', hover: 'trail' })`, [[60, 60], [200, 160], [400, 120]], 40],
  'field fluid wake': ['<canvas style="display:block;width:480px;height:300px"></canvas>', `f.mountGlyphField(el, { source: '${img}', hover: 'fluid' })`, [[60, 60], [200, 160], [400, 120]], 40],
  'field scene': ['<canvas style="display:block;width:480px;height:300px"></canvas>', `f.mountGlyphField(el, { scene: 'waves', hover: 'none' })`, null, 40],
};
const names = Object.keys(CASES).filter(n => !only || only.some(o => n.includes(o)));

const browser = await (useWebkit ? pw.webkit : pw.chromium).launch(useWebkit ? {} : { channel: 'chrome', headless: process.env.ASCIIFY_HEADLESS === '1', args: ['--window-position=-2400,0'] });
const rows = [];
try {
  for (const scheme of ['light', 'dark']) {
    for (const name of names) {
      const [markup, body, moves, frames] = CASES[name];
      const shots = [];
      for (const build of ['a', 'b']) {
        const context = await browser.newContext({ viewport: { width: 800, height: 700 }, deviceScaleFactor: 2, colorScheme: scheme });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.clock.install({ time: 0 });
        await page.goto(origin);
        await page.clock.pauseAt(1000);
        await page.evaluate(async ([build, markup]) => {
          [window.k, window.f] = await Promise.all([import(`/${build}/kit.js`), import(`/${build}/field.js`)]);
          document.getElementById('stage').innerHTML = markup;
        }, [build, markup]);
        await page.evaluate(body => { const el = document.getElementById('stage').firstElementChild; window.handle = new Function('k', 'f', 'el', `return ${body}`)(k, f, el); }, body);
        // Sources decode in real time; the clock only moves by frames.
        for (let i = 0; i < 6; i++) { await page.clock.runFor(17); await page.waitForTimeout(60); }
        const box = await page.locator('#stage > *').first().boundingBox();
        for (let i = 0; i < frames; i++) {
          if (moves && box && i < moves.length * 4) { const [x, y] = moves[Math.floor(i / 4)]; await page.mouse.move(box.x + x + (i % 4) * 6, box.y + y + (i % 4) * 3); }
          await page.clock.runFor(1000 / 60);
        }
        await page.waitForTimeout(120);
        await page.clock.runFor(1000 / 60);
        await page.waitForTimeout(120);
        shots.push({ png: await page.locator('#stage').screenshot(), errors });
        await page.evaluate(() => { try { k.setGlobalLook(null); } catch {} });
        await context.close();
      }
      if (outDir) for (const [i, s] of shots.entries()) await fs.writeFile(path.join(outDir, `${name.replace(/\W+/g, '-')}-${scheme}-${'ab'[i]}.png`), s.png);
      const page = await browser.newPage();
      const diff = await page.evaluate(async ([a, b]) => {
        const read = async b64 => { const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob()); const c = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d'); c.drawImage(bmp, 0, 0); return c.getImageData(0, 0, bmp.width, bmp.height); };
        const [x, y] = await Promise.all([read(a), read(b)]);
        if (x.width !== y.width || x.height !== y.height) return { sizeMismatch: `${x.width}x${x.height} vs ${y.width}x${y.height}` };
        let off = 0, max = 0, inked = 0;
        for (let i = 0; i < x.data.length; i += 4) {
          let d = 0;
          for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(x.data[i + c] - y.data[i + c]));
          if (d > 2) off++;
          if (d > max) max = d;
          if (Math.abs(x.data[i] - x.data[0]) > 8) inked++;
        }
        return { px: x.width * x.height, offPct: +(off * 100 / (x.width * x.height)).toFixed(3), maxDiff: max, inkedPct: +(inked * 100 / (x.width * x.height)).toFixed(1) };
      }, [shots[0].png.toString('base64'), shots[1].png.toString('base64')]);
      await page.close();
      const row = { case: name, scheme, ...diff, errors: [...shots[0].errors, ...shots[1].errors].join(' | ').slice(0, 160) };
      row.match = !row.sizeMismatch && row.offPct === 0 ? 'identical' : !row.sizeMismatch && row.offPct < 0.5 ? 'near' : 'DIFFERENT';
      rows.push(row);
      console.log(JSON.stringify(row));
    }
  }
} finally {
  await Promise.race([browser.close(), new Promise(r => setTimeout(r, 5000))]);
  server.close();
}
console.table(rows.map(({ errors, ...r }) => r));
