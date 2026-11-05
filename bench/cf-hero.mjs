// cloudflare.com's home hero ("Build without boundaries") draws its dot field as a pre-rendered video
// (static/hero-background-video.mp4: 2560x1600, 8 s, 5.08 MB, with a 17.8 kB AVIF poster). This rebuilds the same look live with
// asciify-engine's glyph field and scores it against a frame of their video: one tick character per cell on a 9 by 17 grid,
// coloured by an orange ground with a warm glow rising from the bottom.
//   node bench/cf-hero.mjs <their-frame.png> [--out ours.png]   (after npm run build; their frame from the video at 1 s)
import fs from 'node:fs/promises'; import http from 'node:http'; import path from 'node:path';
import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const { chromium } = createRequire(import.meta.url)('playwright');
const [theirs] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const outArg = process.argv.indexOf('--out'), outFile = outArg > 0 ? process.argv[outArg + 1] : null;
const W = 1280, H = 800;

// The ground, drawn once: Cloudflare's orange, and an elliptical glow at the bottom centre, as their frame shows it.
const GROUND = `const ground = (g, w, h) => {
  g.fillStyle = '#ff5a1a'; g.fillRect(0, 0, w, h);
  g.save(); g.translate(w / 2, h * 1.02); g.scale(1, .62);
  const glow = g.createRadialGradient(0, 0, 0, 0, 0, w * .24);
  glow.addColorStop(0, '#fbe6a6'); glow.addColorStop(.4, '#fbe0a0'); glow.addColorStop(.62, '#fcb27a'); glow.addColorStop(1, 'rgba(255,90,26,0)');
  g.fillStyle = glow; g.fillRect(-w, -h * 2, w * 2, h * 4); g.restore();
};`;
const PAGE = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000}#bg,#f{position:fixed;inset:0;width:${W}px;height:${H}px;display:block}</style>
<canvas id="bg"></canvas><canvas id="f" aria-hidden="true"></canvas>
<script type="module">
import { mountGlyphField, defineFieldEffect } from '/field.js';
${GROUND}
const bg = document.getElementById('bg'); bg.width = ${W * 2}; bg.height = ${H * 2}; ground(bg.getContext('2d'), bg.width, bg.height);
const src = document.createElement('canvas'); src.width = 320; src.height = 200; ground(src.getContext('2d'), 320, 200);
// One tick per cell (every cell is dense: brightness 1), each in the colour of the ground beneath it, lifted toward white.
// A custom effect lifts each tick a little toward white over the colour beneath it, as theirs are drawn.
const lift = defineFieldEffect({ name: 'tick-lift', params: { lift: 0.55 }, shade: 'ink = mix(color, vec3(1.), params.lift); inkAmount = 1.;' });
window.field = mountGlyphField(document.getElementById('f'), { source: src, charset: ' |', font: 'DejaVu Sans Mono', fontWeight: 700,
  cellSize: 8.5, cellAspect: 9 / 17, glyphScale: 0.34, color: 'source', levels: 'none', brightness: 1, hover: 'none', drift: 0, maxPixelRatio: 2, effects: [lift] });
await window.field.ready; window.field.redraw(); window.done = true;
</script>`;
const server = http.createServer(async (req, res) => {
  if (req.url.endsWith('.js')) { res.setHeader('Content-Type', 'text/javascript'); res.end(await fs.readFile(path.join(here, '../dist', req.url))); return; }
  res.setHeader('Content-Type', 'text/html'); res.end(PAGE);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.done, null, { timeout: 20000 }); await page.waitForTimeout(300);
  const ours = await page.screenshot();
  if (outFile) await fs.writeFile(outFile, ours);
  // SSIM between their frame and ours, both at 1280 by 800, as seen up close (no blur) and at a distance (blurred a cell).
  const score = await page.evaluate(async ([a, b]) => {
    const read = async b64 => { const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob()); const c = new OffscreenCanvas(1280, 800).getContext('2d'); c.drawImage(bmp, 0, 0, 1280, 800); return c.getImageData(0, 0, 1280, 800).data; };
    const [x, y] = await Promise.all([read(a), read(b)]);
    const lum = d => { const o = new Float32Array(d.length / 4); for (let i = 0; i < o.length; i++) o[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255; return o; };
    const blur = (s, w, h, sig) => { if (!sig) return s; const r = Math.ceil(sig * 3), k = []; let t = 0; for (let i = -r; i <= r; i++) { k.push(Math.exp(-i * i / (2 * sig * sig))); t += k.at(-1); } const kk = k.map(v => v / t);
      const a = new Float32Array(s.length), o = new Float32Array(s.length);
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { let v = 0; for (let i = -r; i <= r; i++) v += s[yy * w + Math.min(w - 1, Math.max(0, xx + i))] * kk[i + r]; a[yy * w + xx] = v; }
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { let v = 0; for (let i = -r; i <= r; i++) v += a[Math.min(h - 1, Math.max(0, yy + i)) * w + xx] * kk[i + r]; o[yy * w + xx] = v; } return o; };
    const ssim = (p, q, w, h) => { const C1 = 1e-4, C2 = 9e-4, m = (u, v) => u.map((e, i) => e * v[i]); const mp = blur(p, w, h, 1.5), mq = blur(q, w, h, 1.5), spp = blur(m(p, p), w, h, 1.5), sqq = blur(m(q, q), w, h, 1.5), spq = blur(m(p, q), w, h, 1.5);
      let t = 0; for (let i = 0; i < p.length; i++) { const vp = spp[i] - mp[i] ** 2, vq = sqq[i] - mq[i] ** 2, c = spq[i] - mp[i] * mq[i]; t += ((2 * mp[i] * mq[i] + C1) * (2 * c + C2)) / ((mp[i] ** 2 + mq[i] ** 2 + C1) * (vp + vq + C2)); } return t / p.length; };
    const cx = lum(x), cy = lum(y), mean = d => { let r = 0, g = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; } const n = d.length / 4; return [r / n, g / n, b / n].map(Math.round); };
    return { close: +ssim(cx, cy, 1280, 800).toFixed(3), far: +ssim(blur(cx, 1280, 800, 9), blur(cy, 1280, 800, 9), 1280, 800).toFixed(3), theirMean: mean(x), ourMean: mean(y) };
  }, [(await fs.readFile(theirs)).toString('base64'), ours.toString('base64')]);
  console.log(JSON.stringify({ ...score, errors }));
} finally { await browser.close(); server.close(); }
