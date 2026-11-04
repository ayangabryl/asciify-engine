// The live-source path with a real three.js scene: a torus knot rendered each frame, drawn as characters by the glyph field
// with `live: true` and `redraw()` after each render. Checks the characters follow the scene and counts CPU readbacks.
// node bench/three-live.mjs [--shot file.png]
import http from 'node:http'; import path from 'node:path'; import fs from 'node:fs/promises';
import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url'; import { build } from 'esbuild';
const here = path.dirname(fileURLToPath(import.meta.url)); const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const entry = `import { threeLive } from '../examples/three-live.ts'; window.threeLive = threeLive;`;
const bundle = await build({ stdin: { contents: entry, resolveDir: here, loader: 'ts' }, bundle: true, format: 'esm', write: false, logLevel: 'error', nodePaths: [path.join(here, 'node_modules')],
  alias: { 'asciify-engine/field': path.join(here, '../src/field.ts') } });
const server = http.createServer((req, res) => { if (req.url === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); return; } res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><body style="margin:0;background:#000"><canvas id="c" style="display:block;width:640px;height:360px"></canvas><script type="module" src="/app.js"></script>'); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
await ctx.addInitScript(() => { for (const p of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) { const g = p.getParameter; p.getParameter = function (n) { const v = g.call(this, n); return typeof v === 'string' && /swiftshader/i.test(v) ? 'ANGLE (Test GPU)' : v; }; } });
const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/`); await page.waitForFunction(() => window.threeLive);
const result = await page.evaluate(async () => {
  const original = CanvasRenderingContext2D.prototype.getImageData; let readbacks = 0;
  CanvasRenderingContext2D.prototype.getImageData = function (...a) { if (this.canvas.width <= 128) readbacks++; return original.apply(this, a); };
  window.stop = window.threeLive(document.getElementById('c'));
  const grab = () => { const p = document.createElement('canvas'); p.width = 160; p.height = 90; const g = p.getContext('2d'); g.drawImage(document.getElementById('c'), 0, 0, 160, 90); return g.getImageData(0, 0, 160, 90).data; };
  const wait = n => new Promise(r => { let i = 0; const s = () => (++i >= n ? r() : requestAnimationFrame(s)); requestAnimationFrame(s); });
  await wait(20); readbacks = 0; const a = grab(); const t0 = performance.now(); await wait(60); const elapsed = performance.now() - t0; const b = grab();
  let diff = 0, lit = 0; for (let i = 0; i < a.length; i += 4) { diff += Math.abs(a[i] - b[i]); lit += b[i] > 40 ? 1 : 0; }
  return { changed: diff / (a.length / 4), litShare: lit / (a.length / 4), readbacks, frames: 60, seconds: +(elapsed / 1000).toFixed(2) };
});
const shot = process.argv.includes('--shot') ? process.argv[process.argv.indexOf('--shot') + 1] : null;
if (shot) await page.screenshot({ path: shot });
console.log(JSON.stringify({ ...result, errors }, null, 1));
// Levels are re-measured about every 1.5 s, so readbacks follow time, not frames.
const ok = result.changed > 1 && result.litShare > 0.02 && result.readbacks <= Math.ceil(result.seconds / 1.5) + 1 && !errors.length;
console.log(ok ? 'three.js live source ok: the characters follow the scene, without a readback per frame.' : 'FAILED');
await browser.close(); server.close(); process.exit(ok ? 0 : 1);
