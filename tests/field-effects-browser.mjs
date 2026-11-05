// Custom effects and live sources in a real browser: node tests/field-effects-browser.mjs (after npm run build).
// Checks that an effect's `pointer` and `uv` agree on screen, that a broken effect is reported and the field keeps drawing,
// that a live canvas source updates every frame while a plain one does not, and that a live source is not read back on the
// CPU every frame. Exits non-zero on any failure. Uses the Playwright Chromium on the machine (ASCIIFY_PLAYWRIGHT to override).
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const pw = process.env.ASCIIFY_PLAYWRIGHT ? await import(pathToFileURL(process.env.ASCIIFY_PLAYWRIGHT).href) : require('playwright');
const PAGE = '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000"><canvas id="c" style="display:block;width:400px;height:300px"></canvas>';
const server = http.createServer(async (req, res) => {
  if (req.url.endsWith('.js')) {
    try { res.setHeader('Content-Type', 'text/javascript'); res.end(await fs.readFile(path.join(root, 'dist', req.url.split('?')[0]))); } catch { res.statusCode = 404; res.end(); }
    return;
  }
  res.setHeader('Content-Type', 'text/html'); res.end(PAGE);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const check = (name, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); if (!ok) failures.push(name); };
const frames = (page, n) => page.evaluate(n => new Promise(resolve => { let i = 0; const step = () => (++i >= n ? resolve() : requestAnimationFrame(step)); requestAnimationFrame(step); }), n);
// Mean luminance of the field canvas in each quadrant: [top-left, top-right, bottom-left, bottom-right].
const quadrants = page => page.evaluate(() => {
  const c = document.getElementById('c'), probe = document.createElement('canvas');
  probe.width = c.width; probe.height = c.height;
  const pen = probe.getContext('2d'); pen.drawImage(c, 0, 0);
  const { data, width, height } = pen.getImageData(0, 0, probe.width, probe.height);
  const sums = [0, 0, 0, 0], counts = [0, 0, 0, 0];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const q = (y < height / 2 ? 0 : 2) + (x < width / 2 ? 0 : 1), i = (y * width + x) * 4;
    sums[q] += (data[i] + data[i + 1] + data[i + 2]) / 3 * data[i + 3] / 255; counts[q]++;
  }
  return sums.map((s, i) => s / counts[i]);
});

try {
  {
    const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await page.evaluate(async () => {
      const f = await import('/field.js');
      window.spot = f.defineFieldEffect({ name: 'spot', params: { radius: 0.18 }, shade: 'float d=distance(uv*vec2(aspect,1.),pointer*vec2(aspect,1.));tone=max(tone,smoothstep(params.radius,params.radius*.5,d)*pointerOn);' });
      window.field = f.mountGlyphField(document.getElementById('c'), { scene: 'none', hover: 'none', ink: '#ffffff', background: 'transparent', effects: [window.spot] });
      await window.field.ready;
    });
    await page.mouse.move(100, 75);
    await frames(page, 30);
    const q = await quadrants(page);
    check('effect pointer lands where the pointer is (top-left quadrant brightest)', q[0] > 3 * Math.max(q[1], q[2], q[3]) && q[0] > 2, q.map(v => v.toFixed(1)).join(' / '));
    await page.evaluate(() => { window.spot.params.radius = 0.4; });
    await frames(page, 4);
    const wider = await quadrants(page);
    check('changing a param redraws the field', wider[0] > q[0] * 1.2, `${q[0].toFixed(1)} -> ${wider[0].toFixed(1)}`);
    await page.mouse.move(399, 299);
    await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointerleave')));
    await page.mouse.move(390, 290);
    await frames(page, 30);
    const moved = await quadrants(page);
    check('the effect follows the pointer to the bottom-right', moved[3] > moved[0], moved.map(v => v.toFixed(1)).join(' / '));
    check('no page errors', !errors.length, errors.join(' | '));
    await page.close();
  }
  {
    const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
    await page.goto(origin);
    const result = await page.evaluate(async () => {
      const f = await import('/field.js');
      const reported = [];
      const broken = f.defineFieldEffect({ name: 'broken', shade: 'tone+=notAVariable;' });
      const field = f.mountGlyphField(document.getElementById('c'), { scene: 'waves', hover: 'none', ink: '#ffffff', effects: [broken], onError: e => reported.push(e.message) });
      await Promise.race([field.ready, new Promise(r => setTimeout(r, 3000))]);
      await new Promise(r => setTimeout(r, 300));
      return { reported, drawn: (() => { const p = document.createElement('canvas'); p.width = 400; p.height = 300; const g = p.getContext('2d'); g.drawImage(document.getElementById('c'), 0, 0); const d = g.getImageData(0, 0, 400, 300).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i]; return s; })() };
    });
    check('a broken effect is reported by name', result.reported.some(m => m.includes('broken')), result.reported.join(' | ').slice(0, 160));
    check('the field keeps drawing without the broken effect', result.drawn > 0);
    await page.close();
  }
  {
    // The custom effect in skills/asciify-engine/references/glyph-field.md must compile as documented.
    const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
    await page.goto(origin);
    const doc = await fs.readFile(path.join(root, 'skills/asciify-engine/references/glyph-field.md'), 'utf8');
    const shade = /shade: `([\s\S]*?)`,/.exec(doc)?.[1];
    const reported = await page.evaluate(async shade => {
      const f = await import('/field.js'), errors = [];
      const swell = f.defineFieldEffect({ name: 'brand-swell', params: { radius: 0.18, strength: 0.9 }, shade });
      const field = f.mountGlyphField(document.getElementById('c'), { scene: 'waves', hover: 'none', effects: [swell], onError: e => errors.push(e.message) });
      await Promise.race([field.ready, new Promise(r => setTimeout(r, 3000))]);
      await new Promise(r => setTimeout(r, 300));
      return errors;
    }, shade);
    check('the documented effect example compiles', !!shade && !reported.length, reported.join(' | ').slice(0, 160) || (shade ? '' : 'example not found'));
    await page.close();
  }
  for (const live of [true, false]) {
    const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
    await page.goto(origin);
    await page.evaluate(async live => {
      const f = await import('/field.js');
      const src = document.createElement('canvas'); src.width = 200; src.height = 150;
      const pen = src.getContext('2d');
      let t = 0;
      // The "3D scene": a bright square sweeping across a dark ground, redrawn every frame.
      const paint = () => { t++; pen.fillStyle = '#000'; pen.fillRect(0, 0, 200, 150); pen.fillStyle = '#fff'; pen.fillRect((t * 3) % 200, 40, 60, 70); requestAnimationFrame(paint); };
      paint();
      const original = CanvasRenderingContext2D.prototype.getImageData;
      window.readbacks = 0;
      CanvasRenderingContext2D.prototype.getImageData = function (...args) { if (this.canvas.width <= 128) window.readbacks++; return original.apply(this, args); };
      window.field = f.mountGlyphField(document.getElementById('c'), { source: src, live, hover: 'none', ink: '#ffffff', levels: 'auto' });
      await window.field.ready;
      window.readbacks = 0;
    }, live);
    const before = await quadrants(page);
    await frames(page, 60);
    const after = await quadrants(page);
    const changed = before.some((v, i) => Math.abs(v - after[i]) > 0.5);
    const readbacks = await page.evaluate(() => window.readbacks);
    if (live) {
      check('a live canvas source updates as it is redrawn', changed, `${before.map(v => v.toFixed(1)).join('/')} -> ${after.map(v => v.toFixed(1)).join('/')}`);
      check('a live source is not read back every frame (60 frames)', readbacks <= 3, `${readbacks} small readbacks`);
    } else {
      check('a plain canvas source is uploaded once', !changed);
    }
    await page.close();
  }
  {
    // A playing source is measured from the GPU without waiting on it: after the first measure no small CPU readback at all,
    // the reads arrive through a pixel buffer, and the levels they give match a still measured on the CPU.
    const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
    await page.goto(origin);
    const result = await page.evaluate(async () => {
      const f = await import('/field.js');
      // A low-contrast picture (greys 90 to 160), so levels stretch it visibly.
      const make = () => { const c = document.createElement('canvas'); c.width = 320; c.height = 240; const g = c.getContext('2d'); const grd = g.createLinearGradient(0, 0, 320, 0); grd.addColorStop(0, 'rgb(90,90,90)'); grd.addColorStop(1, 'rgb(160,160,160)'); g.fillStyle = grd; g.fillRect(0, 0, 320, 240); g.fillStyle = 'rgb(150,150,150)'; g.fillRect(120, 70, 80, 100); return c; };
      const original = CanvasRenderingContext2D.prototype.getImageData, buffered = WebGL2RenderingContext.prototype.getBufferSubData;
      let small = 0, reads = 0;
      CanvasRenderingContext2D.prototype.getImageData = function (...args) { if (this.canvas.width <= 128) small++; return original.apply(this, args); };
      WebGL2RenderingContext.prototype.getBufferSubData = function (...args) { reads++; return buffered.apply(this, args); };
      const host = document.getElementById('c');
      const field = f.mountGlyphField(host, { source: make(), live: true, hover: 'fluid', scope: 'subject', ink: '#ffffff', levels: 'auto' });
      await field.ready;
      small = 0;
      const wait = ms => new Promise(r => setTimeout(r, ms));
      await wait(1900);
      const sum = canvas => { const p = document.createElement('canvas'); p.width = 400; p.height = 300; const g = p.getContext('2d'); g.drawImage(canvas, 0, 0); const d = original.call(g, 0, 0, 400, 300).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i]; return s / (d.length / 4); };
      const live = sum(host), afterSmall = small, afterReads = reads;
      field.destroy();
      const other = document.createElement('canvas'); other.style.cssText = 'display:block;width:400px;height:300px'; document.body.appendChild(other);
      const plain = f.mountGlyphField(other, { source: make(), hover: 'fluid', scope: 'subject', ink: '#ffffff', levels: 'auto' });
      await plain.ready;
      const still = sum(other);
      plain.destroy();
      return { small: afterSmall, reads: afterReads, live, still };
    });
    check('a live source with levels and scope is not read back on the CPU after its first measure', result.small === 0, `${result.small} small CPU readbacks`);
    check('its levels and scope are read from the GPU', result.reads >= 2, `${result.reads} buffer reads`);
    check('levels read from the GPU match levels measured on the CPU', Math.abs(result.live - result.still) < 1.5, `${result.live.toFixed(2)} live, ${result.still.toFixed(2)} still`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
if (failures.length) { console.error(`${failures.length} failed`); process.exit(1); }
console.log('All field effect and live source checks passed.');
