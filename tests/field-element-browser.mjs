// `<asciify-field>` in a real browser: defined on request, mounts from its attributes, follows attribute and property changes,
// lays its children over the field, draws in a worker on request, takes over a property set before it was defined, and
// goes cleanly when removed.
// npm run build && node tests/field-element-browser.mjs
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { chromium } = createRequire(import.meta.url)('playwright');
const PAGE = '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000"><div id="host"></div>';
const server = http.createServer(async (req, res) => {
  if (req.url.endsWith('.js')) { try { res.setHeader('Content-Type', 'text/javascript'); res.end(await fs.readFile(path.join(root, 'dist', req.url))); } catch { res.statusCode = 404; res.end(); } return; }
  res.setHeader('Content-Type', 'text/html'); res.end(PAGE);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const failures = [];
const check = (name, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== undefined ? ` (${detail})` : ''}`); if (!ok) failures.push(name); };

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://127.0.0.1:${server.address().port}/`);
const result = await page.evaluate(async () => {
  const f = await import('/field.js');
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const until = async (test, ms = 15000) => { const end = performance.now() + ms; while (performance.now() < end) { if (await test()) return true; await wait(100); } return false; };
  const disc = x => { const c = document.createElement('canvas'); c.width = 400; c.height = 240; const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 400, 240); g.fillStyle = '#fff'; g.beginPath(); g.arc(x, 120, 60, 0, 7); g.fill(); return c.toDataURL(); };
  const halves = canvas => { const p = document.createElement('canvas'); p.width = 400; p.height = 240; const c = p.getContext('2d'); c.drawImage(canvas, 0, 0, 400, 240); const d = c.getImageData(0, 0, 400, 240).data; let l = 0, r = 0; for (let y = 0; y < 240; y++) for (let x = 0; x < 400; x++) { const v = d[(y * 400 + x) * 4]; if (x < 200) l += v; else r += v; } return [l / 48000, r / 48000]; };
  const out = {};

  // Upgrade: options set on the element before it was defined are taken over.
  const late = document.createElement('asciify-field');
  late.options = { cellSize: 14, scene: 'none', hover: 'none' };
  late.style.cssText = 'width:200px;height:100px';
  document.getElementById('host').appendChild(late);

  out.defined = f.defineAsciifyField();
  out.again = f.defineAsciifyField();
  await late.ready;
  out.upgraded = late.field?.settings.cellSize;

  const host = document.getElementById('host');
  host.insertAdjacentHTML('beforeend', `<asciify-field id="a" src="${disc(100)}" cell-size="10" hover="lantern" levels="none" ink="#ffffff" drift="0" aria-label="A disc" style="width:400px;height:240px"><h1 id="title" style="margin:0;color:red">Over</h1></asciify-field>`);
  const a = document.getElementById('a');
  await a.ready;
  const canvas = () => a.shadowRoot.querySelector('canvas');
  out.drewLeft = await until(() => { const [l, r] = halves(canvas()); return l > r + 5; });
  out.label = canvas().getAttribute('aria-label');
  a.setAttribute('src', disc(300));
  out.followedSrc = await until(() => { const [l, r] = halves(canvas()); return r > l + 5; });
  a.setAttribute('cell-size', '20');
  out.cellSize = await until(() => a.field.settings.cellSize === 20, 3000) && a.field.settings.cellSize;
  a.setAttribute('lantern', '{"strength":1.2}');
  await wait(50);
  out.json = a.field.settings.lantern?.strength;
  a.options = { ink: '#ff0000' };
  await wait(50);
  out.property = a.field.settings.ink;
  const title = document.getElementById('title').getBoundingClientRect(), box = a.getBoundingClientRect();
  out.childOver = title.top >= box.top && title.bottom <= box.bottom && getComputedStyle(document.getElementById('title')).position !== 'absolute';
  out.hit = document.elementFromPoint(title.left + 5, title.top + 5)?.id;

  // Moved within the page: the same field stays.
  const field = a.field;
  host.prepend(a);
  await wait(50);
  out.keptOnMove = a.field === field;

  // In a worker.
  let transferred = false;
  const transfer = HTMLCanvasElement.prototype.transferControlToOffscreen;
  HTMLCanvasElement.prototype.transferControlToOffscreen = function () { transferred = true; return transfer.call(this); };
  host.insertAdjacentHTML('beforeend', `<asciify-field id="w" worker src="${disc(100)}" cell-size="10" levels="none" ink="#ffffff" drift="0" style="width:400px;height:240px"></asciify-field>`);
  const w = document.getElementById('w');
  await w.ready;
  out.worker = transferred;
  out.workerDrew = await until(() => { const [l, r] = halves(w.shadowRoot.querySelector('canvas')); return l > r + 5; });
  // Leaving the worker: a new canvas, mounted on the page.
  w.removeAttribute('worker');
  out.leftWorker = await until(() => w.field && !w.field.settings ? false : true, 3000);
  HTMLCanvasElement.prototype.transferControlToOffscreen = transfer;

  // Removed: the field goes.
  a.remove(); w.remove(); late.remove();
  await wait(50);
  out.gone = a.field === null && w.field === null && late.field === null;
  return out;
});
check('defineAsciifyField defines the element, once', result.defined && result.again);
check('options set before it was defined are taken over', result.upgraded === 14, result.upgraded);
check('it mounts from its attributes and draws its src', result.drewLeft);
check('aria-label names the field', result.label === 'A disc', result.label);
check('a new src is followed', result.followedSrc);
check('attribute changes update the field', result.cellSize === 20, result.cellSize);
check('JSON attributes become objects', result.json === 1.2, result.json);
check('the options property is merged over the attributes', result.property === '#ff0000', result.property);
check('children are laid over the field and take the pointer', result.childOver && result.hit === 'title', result.hit);
check('moving it within the page keeps its field', result.keptOnMove);
check('the worker attribute draws it in a worker', result.worker && result.workerDrew);
check('leaving the worker mounts it again on the page', result.leftWorker);
check('removing it destroys its field', result.gone);
check('no page errors', !errors.length, errors.join(' | ').slice(0, 300));
await browser.close(); server.close();
if (failures.length) { console.error(`${failures.length} failed`); process.exit(1); }
console.log('Field element checks passed.');
