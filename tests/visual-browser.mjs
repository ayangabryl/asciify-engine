// Visual baselines: kit components, background presets and field marks drawn on a frozen clock, light and dark, and compared
// with screenshots stored in tests/visual/baselines. A release that changes how any of them looks fails here, so a look a
// design team approved cannot move in a patch (see STABILITY.md).
//   npm run build && node tests/visual-browser.mjs            compare
//   node tests/visual-browser.mjs --update                    write new baselines (a deliberate visual change, minor release)
//   node tests/visual-browser.mjs --only hero                 a subset
// Runs in Playwright's Chromium with SwiftShader, so it needs no GPU. Kit components normally refuse software WebGL to spare
// the CPU; here the renderer name is reported as a GPU's so they draw, which changes nothing else.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const update = process.argv.includes('--update'), only = arg('--only')?.split(',');
const baselines = path.join(root, 'tests/visual/baselines');
// A pixel differs when any channel is off by more than CHANNEL; a case fails when more than SHARE % of its pixels differ.
const CHANNEL = 24, SHARE = 0.5;

// The kit's fonts are pinned to fonts every Linux runner has, so baselines do not depend on what else a machine installed.
const PAGE = `<!doctype html><meta charset="utf-8"><style>@font-face{font-family:"Geist";src:local("Liberation Sans")}
@font-face{font-family:"Geist Mono";src:local("DejaVu Sans Mono")}@font-face{font-family:"Arial";src:local("Liberation Sans")}
:root{color-scheme:light dark;--ascii-ink:#57534e;--ascii-ink-strong:#1c1917}
@media (prefers-color-scheme:dark){:root{--ascii-ink:#a8a29e;--ascii-ink-strong:#f5f5f4}}
body{margin:0;font:16px "DejaVu Sans",sans-serif;color:#222;background:#fafaf8}@media (prefers-color-scheme:dark){body{color:#e8e6e1;background:#141413}}
#stage{position:relative;padding:16px;width:480px}#stage>*{position:relative;margin:0}
button{font:inherit;padding:12px 24px;border-radius:10px;border:1px solid currentColor;background:transparent;color:inherit}</style><div id="stage"></div>`;
const img = '/media/still.jpg';
// [markup, mount (k = kit, f = field, el = the element), pointer path in stage px or null, frames]
const CASES = {
  beam: ['<button>Continue</button>', 'k.beam(el)', null, 40],
  pill: ['<span style="padding:4px 12px;display:inline-block">Beta</span>', 'k.pill(el)', null, 30],
  odometer: ['<span style="font-size:40px;display:inline-block">1,234</span>', 'k.odometer(el, { value: 1234 })', null, 60],
  statusOrb: ['<div style="width:120px;height:120px"></div>', 'k.statusOrb(el)', null, 40],
  skeleton: ['<div style="width:320px"><p>Loading line one</p><p>Loading line two</p></div>', 'k.skeleton(el)', null, 40],
  buttonLoading: ['<button>Save</button>', `(() => { const h = k.buttonLoading(el); h.start('Saving'); return h; })()`, null, 30],
  thinking: ['<div style="width:240px;height:40px">Thinking</div>', `(() => { const h = k.thinking(el); h.think(); return h; })()`, null, 40],
  blockChart: ['<div style="width:440px;height:180px"></div>', `k.blockChart(el, { values: [3, 5, 2, 8, 6, 4, 7], labels: ['a','b','c','d','e','f','g'] })`, null, 40],
  wordmark: ['<h1 style="height:140px;font-size:100px;margin:0">asciify</h1>', `k.wordmark(el, { text: 'asciify' })`, null, 40],
  heroBackground: ['<section style="height:280px"></section>', `k.fieldBackground(el, { preset: 'hero' })`, [[100, 100], [300, 160]], 50],
  notFound: ['<section style="height:240px"></section>', `k.fieldBackground(el, { preset: 'notFound' })`, null, 30],
  swell: ['<section style="height:240px"></section>', 'k.background(el, { preset: k.swell })', [[200, 120], [360, 100]], 40],
  drift: ['<section style="height:240px"></section>', 'k.background(el, { preset: k.drift })', null, 40],
  artPanel: ['<figure style="width:360px;height:240px;margin:0"></figure>', `k.artPanel(el, { image: '${img}' })`, null, 40],
  ...Object.fromEntries(['glyph', 'dot', 'pixel', 'led'].map(mark => [`field ${mark}`,
    ['<canvas style="display:block;width:440px;height:260px"></canvas>', `f.mountGlyphField(el, { source: '${img}', mark: '${mark}', hover: 'lantern' })`, [[100, 100], [300, 160]], 40]])),
  'field scene': ['<canvas style="display:block;width:440px;height:260px"></canvas>', `f.mountGlyphField(el, { scene: 'waves', hover: 'none' })`, null, 40],
};

const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  try {
    if (url === '/media/still.jpg') { res.setHeader('Content-Type', 'image/jpeg'); res.end(await fs.readFile(path.join(root, 'tests/fixtures/motion-still.jpg'))); return; }
    if (url.endsWith('.js')) { res.setHeader('Content-Type', 'text/javascript'); res.end(await fs.readFile(path.join(process.env.ASCIIFY_DIST ?? path.join(root, 'dist'), url))); return; }
  } catch { res.statusCode = 404; res.end(); return; }
  res.setHeader('Content-Type', 'text/html'); res.end(PAGE);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--font-render-hinting=none'] });
await fs.mkdir(baselines, { recursive: true });
const failures = [];
const compare = (page, a, b) => page.evaluate(async ([a, b]) => {
  const read = async b64 => { const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob()); const c = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d'); c.drawImage(bmp, 0, 0); return c.getImageData(0, 0, bmp.width, bmp.height); };
  const [x, y] = await Promise.all([read(a), read(b)]);
  if (x.width !== y.width || x.height !== y.height) return { size: `${x.width}x${x.height} vs ${y.width}x${y.height}` };
  let off = 0, max = 0;
  for (let i = 0; i < x.data.length; i += 4) {
    let d = 0;
    for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(x.data[i + c] - y.data[i + c]));
    if (d > window.CHANNEL) off++;
    max = Math.max(max, d);
  }
  return { share: off * 100 / (x.width * x.height), max };
}, [a.toString('base64'), b.toString('base64')]);

try {
  for (const scheme of ['light', 'dark']) {
    for (const [name, [markup, body, moves, frames]] of Object.entries(CASES)) {
      if (only && !only.some(o => name.includes(o))) continue;
      const context = await browser.newContext({ viewport: { width: 520, height: 420 }, deviceScaleFactor: 1, colorScheme: scheme, reducedMotion: 'no-preference' });
      await context.addInitScript(() => {
        // Report SwiftShader under a GPU's name so kit components draw (see the header).
        for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
          const get = proto.getParameter;
          proto.getParameter = function (p) { const v = get.call(this, p); return typeof v === 'string' && /swiftshader/i.test(v) ? 'ANGLE (Test GPU)' : v; };
        }
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.clock.install({ time: 0 });
      await page.goto(origin);
      await page.clock.pauseAt(1000);
      await page.evaluate(async ([markup, channel]) => {
        window.CHANNEL = channel;
        [window.k, window.f] = await Promise.all([import('/kit.js'), import('/field.js')]);
        await document.fonts.ready;
        document.getElementById('stage').innerHTML = markup;
      }, [markup, CHANNEL]);
      await page.evaluate(body => { const el = document.getElementById('stage').firstElementChild; window.handle = new Function('k', 'f', 'el', `return ${body}`)(k, f, el); }, body);
      // Sources decode in real time; the clock only moves by frames.
      for (let i = 0; i < 8; i++) { await page.clock.runFor(17); await page.waitForTimeout(60); }
      const box = await page.locator('#stage > *').first().boundingBox();
      for (let i = 0; i < frames; i++) {
        if (moves && box && i < moves.length * 4) { const [x, y] = moves[Math.floor(i / 4)]; await page.mouse.move(box.x + x + (i % 4) * 6, box.y + y + (i % 4) * 3); }
        await page.clock.runFor(1000 / 60);
      }
      await page.waitForTimeout(150);
      await page.clock.runFor(1000 / 60);
      await page.waitForTimeout(150);
      const shot = await page.locator('#stage').screenshot();
      const file = path.join(baselines, `${name.replace(/\W+/g, '-')}-${scheme}.png`);
      let line;
      if (update) { await fs.writeFile(file, shot); line = `wrote ${path.relative(root, file)}`; }
      else {
        let base = null;
        try { base = await fs.readFile(file); } catch { /* missing */ }
        if (!base) { line = 'FAIL no baseline (run with --update)'; failures.push(`${name} ${scheme}`); }
        else {
          const diff = await compare(page, shot, base);
          const ok = !diff.size && diff.share <= SHARE;
          line = `${ok ? 'ok  ' : 'FAIL'} ${diff.size ? `size ${diff.size}` : `${diff.share.toFixed(3)}% of pixels differ (max ${diff.max})`}`;
          if (!ok) { failures.push(`${name} ${scheme}`); await fs.writeFile(file.replace(/\.png$/, '.actual.png'), shot); }
        }
      }
      if (errors.length) { failures.push(`${name} ${scheme} errors`); line += ` | page errors: ${errors.join(' | ').slice(0, 160)}`; }
      console.log(`${scheme.padEnd(5)} ${name.padEnd(16)} ${line}`);
      await context.close();
    }
  }
} finally {
  await Promise.race([browser.close(), new Promise(r => setTimeout(r, 5000))]);
  server.close();
}
if (failures.length) { console.error(`\n${failures.length} visual case(s) failed: ${failures.join(', ')}. A deliberate change: --update, a minor release and a changelog note.`); process.exit(1); }
console.log(update ? '\nBaselines written.' : '\nAll visual cases match their baselines.');
