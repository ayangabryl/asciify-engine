// Memory over repeated mounts and destroys of live 1080p fields (own context, shared context, worker): every Chrome process's
// proportional memory (PSS, from /proc, Linux only) after each round of 6. Flat after the first round means no leak.
// npm run build && node bench/leak.mjs [own,shared,worker]
import fs from 'node:fs/promises'; import http from 'node:http'; import { readdirSync, readFileSync } from 'node:fs'; import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const server = http.createServer(async (req, res) => {
  if (req.url.endsWith('.js')) { res.setHeader('Content-Type', 'text/javascript'); res.end(await fs.readFile(new URL('../dist' + req.url, import.meta.url))); return; }
  res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><body style="margin:0">');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const procs = () => { const parent = new Map(); for (const n of readdirSync('/proc')) { if (!/^\d+$/.test(n)) continue; try { const s = readFileSync(`/proc/${n}/stat`, 'utf8'); parent.set(+n, +s.slice(s.lastIndexOf(')') + 2).split(' ')[1]); } catch {} } return [...parent.keys()].filter(p => { let q = p; for (let i = 0; i < 32 && q > 1; i++) { q = parent.get(q); if (q === process.pid) return true; } return false; }); };
const mb = () => procs().reduce((s, p) => { try { return s + +/Pss:\s+(\d+)/.exec(readFileSync(`/proc/${p}/smaps_rollup`, 'utf8'))[1] / 1024; } catch { return s; } }, 0);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--expose-gc'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
const round = (mode) => page.evaluate(async ({ mode }) => {
  const f = await import('/field.js');
  const src = document.createElement('canvas'); src.width = 1920; src.height = 1080; const g = src.getContext('2d');
  for (let i = 0; i < 6; i++) {
    const c = document.createElement('canvas'); c.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh'; document.body.appendChild(c);
    g.fillStyle = `hsl(${i * 50},60%,50%)`; g.fillRect(0, 0, 1920, 1080);
    const field = f.mountGlyphField(c, { source: src, live: true, hover: 'fluid', cellSize: 12, worker: mode === 'worker', context: mode === 'shared' ? 'shared' : 'auto' });
    await field.ready; await new Promise(r => setTimeout(r, 400));
    field.destroy(); c.remove();
  }
  await new Promise(r => setTimeout(r, 4000)); globalThis.gc?.(); await new Promise(r => setTimeout(r, 500));
}, { mode });
for (const mode of (process.argv[2] ?? 'own,shared,worker').split(',')) {
  const series = [mb()];
  for (let r = 0; r < 8; r++) { await round(mode); series.push(mb()); }
  console.log(`${mode}: ${series.map(v => v.toFixed(0)).join(' -> ')} MB, after each 6 mounts and destroys of live 1080p fields`);
}
console.log('page errors:', errors.length ? errors.slice(0, 3).join(' | ') : 'none');
await browser.close(); server.close();
