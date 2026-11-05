// A glyph field drawn in a worker (`worker: true`), in a real browser: it draws a live source and follows it, matches the same
// field drawn on the page, answers the pointer, falls back to the page for what a worker cannot take, and goes cleanly.
// npm run build && node tests/field-worker-browser.mjs
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { chromium } = createRequire(import.meta.url)('playwright');
const PAGE = '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000"><canvas id="a" style="display:block;width:400px;height:240px"></canvas><canvas id="b" style="display:block;width:400px;height:240px"></canvas>';
const server = http.createServer(async (req, res) => {
  if (req.url.endsWith('.js')) { try { res.setHeader('Content-Type', 'text/javascript'); res.end(await fs.readFile(path.join(root, 'dist', req.url))); } catch { res.statusCode = 404; res.end(); } return; }
  res.setHeader('Content-Type', 'text/html'); res.end(PAGE);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const failures = [];
const check = (name, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== undefined ? ` (${detail})` : ''}`); if (!ok) failures.push(name); };

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 400, height: 480 } });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://127.0.0.1:${server.address().port}/`);
const result = await page.evaluate(async () => {
  const f = await import('/field.js');
  const wait = ms => new Promise(r => setTimeout(r, ms));
  // A live source: a bright disc on black, moved on demand.
  const source = document.createElement('canvas'); source.width = 400; source.height = 240;
  const g = source.getContext('2d');
  const paint = x => { g.fillStyle = '#000'; g.fillRect(0, 0, 400, 240); g.fillStyle = '#fff'; g.beginPath(); g.arc(x, 120, 60, 0, 7); g.fill(); };
  paint(100);
  // Mean red of a canvas in its left and right halves.
  const halves = canvas => { const p = document.createElement('canvas'); p.width = 400; p.height = 240; const c = p.getContext('2d'); c.drawImage(canvas, 0, 0, 400, 240); const d = c.getImageData(0, 0, 400, 240).data; let l = 0, r = 0; for (let y = 0; y < 240; y++) for (let x = 0; x < 400; x++) { const v = d[(y * 400 + x) * 4]; if (x < 200) l += v; else r += v; } return [l / 48000, r / 48000]; };
  const until = async (test, ms = 15000) => { const end = performance.now() + ms; while (performance.now() < end) { if (test()) return true; await wait(100); } return false; };
  const options = { source, live: true, hover: 'lantern', ink: '#ffffff', levels: 'none', drift: 0, cellSize: 10 };

  const supported = f.fieldWorkerSupported();
  const a = document.getElementById('a');
  let transferred = false;
  const transfer = HTMLCanvasElement.prototype.transferControlToOffscreen;
  HTMLCanvasElement.prototype.transferControlToOffscreen = function () { transferred = true; return transfer.call(this); };
  const inWorker = f.mountGlyphField(a, { ...options, worker: true });
  await inWorker.ready;
  const drewLeft = await until(() => { const [l, r] = halves(a); return l > r + 5; });
  const before = halves(a);
  paint(300);
  const followed = await until(() => { const [l, r] = halves(a); return r > l + 5; });
  const after = halves(a);

  // The same field on the page, for comparison.
  const b = document.getElementById('b');
  const onPage = f.mountGlyphField(b, { ...options });
  await onPage.ready;
  await wait(800);
  onPage.redraw();
  const page = halves(b), worker = halves(a);

  // The pointer: the lantern lights the field where it is.
  paint(-200);
  await wait(800);
  const dark = halves(a)[0];
  inWorker.pointer(100, 120);
  const lit = await until(() => halves(a)[0] > dark + 1, 6000);
  // The same on the page, for reference.
  const darkPage = (onPage.redraw(), halves(b)[0]);
  onPage.pointer(100, 120);
  const litPage = await until(() => { onPage.redraw(); return halves(b)[0] > darkPage + 1; }, 6000);
  const litValues = [dark, halves(a)[0], darkPage, halves(b)[0]];
  // A real pointer event on the page reaches the worker as it does a field on the page: the lantern moves to it.
  inWorker.pointer(null);
  await wait(800);
  const restLeft = halves(a)[0];
  const rect = a.getBoundingClientRect();
  for (let i = 0; i < 6; i++) { window.dispatchEvent(new PointerEvent('pointermove', { clientX: rect.left + 100 + i, clientY: rect.top + 120, pointerType: 'mouse' })); await wait(60); }
  const followsEvents = await until(() => halves(a)[0] > restLeft + 1, 6000);

  // Custom effects need the page: the field mounts there instead.
  transferred = false;
  const c = document.createElement('canvas'); c.style.cssText = 'width:200px;height:100px'; document.body.appendChild(c);
  const effect = f.defineFieldEffect({ name: 'nudge', shade: 'color.rgb *= 1.0;' });
  const kept = f.mountGlyphField(c, { scene: 'none', hover: 'none', worker: true, effects: [effect] });
  const keptOnPage = !transferred;
  await kept.ready;
  kept.destroy();

  inWorker.destroy(); onPage.destroy();
  HTMLCanvasElement.prototype.transferControlToOffscreen = transfer;
  return { supported, drewLeft, followed, before, after, page, worker, lit, litPage, litValues, followsEvents, keptOnPage, settings: inWorker.settings.cellSize };
});
check('this browser can draw a field in a worker', result.supported);
check('the worker draws the live source', result.drewLeft, result.before.map(v => v.toFixed(1)).join(' / '));
check('and follows it as it changes', result.followed, result.after.map(v => v.toFixed(1)).join(' / '));
check('it matches the same field drawn on the page', Math.abs(result.page[0] - result.worker[0]) < 6 && Math.abs(result.page[1] - result.worker[1]) < 6, `page ${result.page.map(v => v.toFixed(1)).join(' / ')}, worker ${result.worker.map(v => v.toFixed(1)).join(' / ')}`);
check('the pointer reaches the worker: its lantern lights as the page field\'s does', result.lit && result.litPage && Math.abs((result.litValues[1] - result.litValues[0]) - (result.litValues[3] - result.litValues[2])) < 0.6, `worker ${result.litValues[0].toFixed(2)} -> ${result.litValues[1].toFixed(2)}, page ${result.litValues[2].toFixed(2)} -> ${result.litValues[3].toFixed(2)}`);
check('page pointer events reach it too', result.followsEvents);
check('custom effects keep the field on the page', result.keptOnPage);
check('settings read on the page', result.settings === 10, result.settings);
check('no page errors', !errors.length, errors.join(' | ').slice(0, 300));
await browser.close(); server.close();
if (failures.length) { console.error(`${failures.length} failed`); process.exit(1); }
console.log('Field worker checks passed.');
