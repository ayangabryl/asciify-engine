// Recreates the dot-matrix section of cloudflare.com's "Build without boundaries" footer with asciify-engine's GPU field, from a
// phone screenshot of it: orange ground, a fine grid of dots everywhere, brightening to a warm glow at the bottom.
// node bench/cf-section.mjs <out.png>
import fs from 'node:fs/promises'; import http from 'node:http'; import path from 'node:path';
import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const { chromium } = createRequire(import.meta.url)('playwright');
const PAGE = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#fff;font-family:"Inter",system-ui,sans-serif}
section{position:relative;height:700px;background:#ec6633;overflow:hidden;color:#fff;text-align:center}
canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.copy{position:relative;padding:140px 28px 0}h2{margin:0;font:500 48px/1.08 Inter,sans-serif;letter-spacing:-.03em}
p{margin:24px 0 0;font:400 21px/1.35 Inter,sans-serif}.b1,.b2{display:block;margin:40px 0 0;padding:20px;border-radius:14px;font:500 18px Inter}.b1{background:#fff;color:#111}.b2{margin-top:12px;background:#ef7c4f;color:#fff}
</style><section><canvas id="f" aria-hidden="true"></canvas><div class="copy"><h2>Build without boundaries</h2>
<p>Join thousands of developers who've eliminated infrastructure complexity and deployed globally.</p><span class="b1">Start building for free</span><span class="b2">View docs</span></div></section>
<script type="module">
import { mountGlyphField } from '/field.js';
// The source: a faint even tone everywhere (the dot grid) and a warm glow rising from the bottom edge.
const src = document.createElement('canvas'); src.width = 200; src.height = 360; const g = src.getContext('2d');
g.fillStyle = '#f6956a'; g.fillRect(0, 0, 200, 360);
const glow = g.createRadialGradient(100, 380, 10, 100, 380, 170); glow.addColorStop(0, '#fff6cf'); glow.addColorStop(.45, '#ffd98a'); glow.addColorStop(1, 'rgba(246,149,106,0)');
g.fillStyle = glow; g.fillRect(0, 0, 200, 360);
window.field = mountGlyphField(document.getElementById('f'), { source: src, mark: 'dot', cellSize: 6, cellAspect: 1, dotScale: .55, color: 'source',
  levels: 'none', brightness: -.12, contrast: 1.15, hover: 'none', drift: 0, fit: 'cover', maxPixelRatio: 2, label: '' });
await window.field.ready; window.done = true;
</script>`;
const server = http.createServer(async (req, res) => { if (req.url.endsWith('.js')) { res.setHeader('Content-Type', 'text/javascript'); res.end(await fs.readFile(path.join(here, '../dist', req.url))); return; } res.setHeader('Content-Type', 'text/html'); res.end(PAGE); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 390, height: 700 }, deviceScaleFactor: 2 });
const errors = []; p.on('pageerror', e => errors.push(e.message));
await p.goto(`http://127.0.0.1:${server.address().port}/`); await p.waitForFunction(() => window.done, null, { timeout: 15000 }); await p.waitForTimeout(400);
await p.screenshot({ path: process.argv[2] }); console.log('saved', process.argv[2], errors.join(' | '));
await b.close(); server.close();
