// 3D models in a real browser: modelSource draws on the GPU like the CPU renderer does (same outline and light), turns, follows
// a drag, holds still under reduced motion, falls back to the CPU without WebGL2, feeds a glyph field as a live source, and
// gives its context back when destroyed.
// npm run build && node tests/model-browser.mjs
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { chromium } = createRequire(import.meta.url)('playwright');
const PAGE = '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000"><div id="orbit" style="width:320px;height:320px"></div><canvas id="field" style="display:block;width:400px;height:240px"></canvas>';
const server = http.createServer(async (req, res) => {
  if (req.url.endsWith('.js')) { try { res.setHeader('Content-Type', 'text/javascript'); res.end(await fs.readFile(path.join(root, 'dist', req.url))); } catch { res.statusCode = 404; res.end(); } return; }
  res.setHeader('Content-Type', 'text/html'); res.end(PAGE);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const failures = [];
const check = (name, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== undefined ? ` (${detail})` : ''}`); if (!ok) failures.push(name); };

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 400, height: 600 } });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://127.0.0.1:${server.address().port}/`);
const result = await page.evaluate(async () => {
  const m = await import('/model.js');
  const f = await import('/field.js');
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const read = canvas => { const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height; const g = c.getContext('2d'); g.drawImage(canvas, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
  const luma = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  const out = {};
  const torus = m.shapeModel('torus');
  const view = { width: 200, height: 200, yaw: 30, pitch: 25, spin: 0 };

  // GPU against CPU, the same view.
  const src = m.modelSource(torus, view);
  out.gpu = src.gpu;
  const gpu = read(src.canvas), cpu = m.renderModel(torus, { ...view }).data;
  let both = 0, either = 0, diff = 0, n = 0;
  for (let i = 0; i < gpu.length; i += 4) {
    const a = gpu[i + 3] > 127, b = cpu[i + 3] > 127;
    if (a || b) either++;
    if (a && b) { both++; diff += Math.abs(luma(gpu, i) - luma(cpu, i)); n++; }
  }
  out.overlap = both / either;
  out.meanDiff = diff / n;
  // Lit from the upper left.
  out.litSide = luma(gpu, (60 * 200 + 60) * 4) - luma(gpu, (140 * 200 + 140) * 4);

  // Turning by itself (a knot: a torus looks the same turned about its own axis).
  src.setModel(m.shapeModel('knot'));
  const before = read(src.canvas);
  src.update({ spin: 120 });
  await wait(400);
  const after = read(src.canvas);
  let changed = 0;
  for (let i = 3; i < before.length; i += 4) if (Math.abs(before[i - 3] - after[i - 3]) > 20) changed++;
  out.spun = changed;
  src.update({ spin: 0 });

  // A drag turns it.
  const orbit = document.getElementById('orbit');
  src.update({ orbit });
  await wait(50);
  const held = read(src.canvas);
  orbit.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1, bubbles: true }));
  for (let i = 1; i <= 5; i++) window.dispatchEvent(new PointerEvent('pointermove', { clientX: 100 + i * 12, clientY: 100, pointerId: 1 }));
  window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
  const dragged = read(src.canvas);
  let moved = 0;
  for (let i = 3; i < held.length; i += 4) if (Math.abs(held[i - 3] - dragged[i - 3]) > 20) moved++;
  out.dragged = moved;

  // A point cloud.
  const cloud = { ...m.shapeModel('sphere'), indices: new Uint32Array(0), groups: [] };
  const points = m.modelSource(cloud, { ...view, width: 120, height: 120 });
  const pd = read(points.canvas);
  let covered = 0;
  for (let i = 3; i < pd.length; i += 4) if (pd[i] > 0) covered++;
  out.points = covered / (120 * 120);
  points.destroy();

  // As a glyph field's live source.
  const live = m.modelSource(torus, { width: 400, height: 240, spin: 60 });
  const field = f.mountGlyphField(document.getElementById('field'), { source: live.canvas, live: true, ink: '#ffffff', levels: 'none', drift: 0, cellSize: 8, hover: 'none' });
  await field.ready;
  await wait(500);
  field.redraw();
  const fd = read(document.getElementById('field'));
  let lit = 0;
  for (let i = 0; i < fd.length; i += 4) if (fd[i] > 60) lit++;
  out.fieldLit = lit / (fd.length / 4);
  field.destroy();
  live.destroy();

  // Without WebGL2: the CPU renderer, the same picture.
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return type === 'webgl2' ? null : original.call(this, type, ...rest); };
  const fallback = m.modelSource(torus, view);
  HTMLCanvasElement.prototype.getContext = original;
  out.fallbackGpu = fallback.gpu;
  const fb = read(fallback.canvas);
  let same = 0, any = 0;
  for (let i = 3; i < fb.length; i += 4) { if (fb[i] > 127 || cpu[i] > 127) any++; if (fb[i] > 127 && cpu[i] > 127) same++; }
  out.fallbackOverlap = same / any;
  fallback.destroy();

  // Destroyed: its context is given back.
  const gl = src.canvas.getContext('webgl2');
  src.destroy();
  out.lost = gl ? gl.isContextLost() : null;
  return out;
});
check('draws with WebGL2', result.gpu);
check('the GPU drawing matches the CPU renderer\'s silhouette', result.overlap > 0.97, result.overlap.toFixed(3));
check('and its light', result.meanDiff < 14, result.meanDiff.toFixed(1));
check('lit from the upper left', result.litSide > 30, result.litSide.toFixed(0));
check('it turns by itself', result.spun > 500, result.spun);
check('a drag turns it', result.dragged > 500, result.dragged);
check('point clouds draw as discs', result.points > 0.25, result.points.toFixed(2));
check('a glyph field draws it as a live source', result.fieldLit > 0.03, result.fieldLit.toFixed(3));
check('without WebGL2 it falls back to the CPU renderer', result.fallbackGpu === false && result.fallbackOverlap > 0.97, result.fallbackOverlap.toFixed(3));
check('destroying it gives its context back', result.lost === true, result.lost);

// Reduced motion: no turning.
await page.emulateMedia({ reducedMotion: 'reduce' });
const still = await page.evaluate(async () => {
  const m = await import('/model.js');
  const src = m.modelSource(m.shapeModel('knot'), { width: 120, height: 120, spin: 200 });
  const read = canvas => { const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height; const g = c.getContext('2d'); g.drawImage(canvas, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
  const a = read(src.canvas);
  await new Promise(r => setTimeout(r, 400));
  const b = read(src.canvas);
  let changed = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changed++;
  src.destroy();
  return changed;
});
check('reduced motion holds it still', still === 0, still);
check('no page errors', !errors.length, errors.join(' | ').slice(0, 300));
await browser.close(); server.close();
if (failures.length) { console.error(`${failures.length} failed`); process.exit(1); }
console.log('Model browser checks passed.');
