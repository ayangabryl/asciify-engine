// elementSource in a real browser, both ways: with HTML-in-Canvas (Chromium's CanvasDrawElement flag) it draws the element's
// real pixels; without it, a painted likeness. Either way a field reading it follows the element as its text changes.
// npm run build && node tests/element-source-browser.mjs
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { chromium } = createRequire(import.meta.url)('playwright');
const PAGE = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#111;color:#eee;font:16px 'DejaVu Sans',sans-serif">
<canvas id="host" style="display:block;width:320px;height:120px"><div id="native" style="width:320px;height:120px;background:#fff;color:#000;font:600 40px 'DejaVu Sans',sans-serif;padding:16px;box-sizing:border-box">Hello</div></canvas>
<div id="plain" style="width:320px;height:120px;background:#222;border:1px solid #888;border-radius:12px;font:600 40px 'DejaVu Sans',sans-serif;padding:16px;box-sizing:border-box">Hello</div>
<canvas id="field" style="display:block;width:320px;height:120px"></canvas>`;
const server = http.createServer(async (req, res) => {
  if (req.url.endsWith('.js')) { try { res.setHeader('Content-Type', 'text/javascript'); res.end(await fs.readFile(path.join(root, 'dist', req.url))); } catch { res.statusCode = 404; res.end(); } return; }
  res.setHeader('Content-Type', 'text/html'); res.end(PAGE);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const failures = [];
const check = (name, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); if (!ok) failures.push(name); };

for (const [label, args, id, expected] of [['with HTML-in-Canvas', ['--enable-features=CanvasDrawElement'], 'native', 'native'], ['without it', [], 'plain', 'painted'], ['element outside a canvas, API present', ['--enable-features=CanvasDrawElement'], 'plain', 'painted']]) {
  const browser = await chromium.launch({ args: [...args, '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 400, height: 420 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin);
  const result = await page.evaluate(async id => {
    const [k, f] = await Promise.all([import('/kit.js'), import('/field.js')]);
    const el = document.getElementById(id);
    let frames = 0, field;
    const source = k.elementSource(el, { onFrame: () => { frames++; field?.redraw(); } });
    field = f.mountGlyphField(document.getElementById('field'), { source: source.canvas, live: true, hover: 'none', ink: '#ffffff', levels: 'none' });
    await field.ready;
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const ink = c => { const p = document.createElement('canvas'); p.width = 160; p.height = 60; const g = p.getContext('2d'); g.drawImage(c, 0, 0, 160, 60); const d = g.getImageData(0, 0, 160, 60).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i]; return s / (d.length / 4); };
    const sig = c => { const p = document.createElement('canvas'); p.width = 80; p.height = 30; const g = p.getContext('2d'); g.drawImage(c, 0, 0, 80, 30); return Array.from(g.getImageData(0, 0, 80, 30).data.filter((_, i) => i % 4 === 0)); };
    await wait(400);
    const before = { source: sig(source.canvas), field: sig(document.getElementById('field')), ink: ink(source.canvas) };
    const framesBefore = frames;
    el.textContent = 'World, wider';
    await wait(600);
    const after = { source: sig(source.canvas), field: sig(document.getElementById('field')) };
    const diff = (a, b) => a.reduce((n, v, i) => n + Math.abs(v - b[i]), 0) / a.length;
    return { mode: source.mode, sourceInk: before.ink, sourceChanged: diff(before.source, after.source), fieldChanged: diff(before.field, after.field), newFrames: frames - framesBefore };
  }, id);
  check(`${label}: mode is ${expected}`, result.mode === expected, result.mode);
  check(`${label}: the source shows the element`, result.sourceInk > 5, result.sourceInk.toFixed(1));
  check(`${label}: a text change reaches the source`, result.sourceChanged > 0.5 && result.newFrames > 0, `${result.sourceChanged.toFixed(2)}, ${result.newFrames} frames`);
  check(`${label}: and the field`, result.fieldChanged > 0.5, result.fieldChanged.toFixed(2));
  check(`${label}: no page errors`, !errors.length, errors.join(' | ').slice(0, 160));
  await browser.close();
}
server.close();
if (failures.length) { console.error(`${failures.length} failed`); process.exit(1); }
console.log('elementSource checks passed.');
