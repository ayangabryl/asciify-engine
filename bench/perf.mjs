// Frame cost of live ASCII renderers on a live 4K source: node bench/perf.mjs [--sizes 3840x2160] [--cells 12,4,1] [--frames 12]
// Runs in Playwright's Chromium. With SwiftShader (no GPU here) the GPU work runs on the CPU, so total times are not what a real
// GPU takes; they compare the work each renderer asks for, on the same emulated GPU. Main-thread times are real.
import fs from 'node:fs/promises'; import http from 'node:http'; import path from 'node:path';
import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url'; import { build } from 'esbuild';
const here = path.dirname(fileURLToPath(import.meta.url)); const { chromium } = createRequire(import.meta.url)('playwright');
const arg = (n, f) => { const i = process.argv.indexOf(n); return i < 0 ? f : process.argv[i + 1]; };
const sizes = arg('--sizes', '3840x2160').split(',').map(s => s.split('x').map(Number));
const prof = JSON.parse(arg('--prof', '{}'));
const cells = arg('--cells', '12,4,1').split(',').map(Number), frames = Number(arg('--frames', 12)), only = arg('--only', null);
const exposeHero = { name: 'expose-hero', setup(b) { b.onLoad({ filter: /webgl-ascii-hero[\\/]ascii-effect\.tsx$/ }, async args => ({ contents: `${await fs.readFile(args.path, 'utf8')}\nexport { AsciiEffectImpl, createGlyphTexture, TERMINAL_SYMBOLS }\n`, loader: 'tsx' })); } };
const bundle = await build({ entryPoints: [path.join(here, 'perf-page.js')], bundle: true, format: 'esm', write: false, nodePaths: [path.join(here, 'node_modules')], loader: { '.ts': 'ts' }, jsx: 'automatic', plugins: [exposeHero], logLevel: 'error' });
const server = http.createServer((req, res) => { if (req.url === '/perf.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); return; } res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><body style="margin:0;background:#000"><script type="module" src="/perf.js"></script>'); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = [];
try {
  for (const [w, h] of sizes) for (const cell of cells) {
    const page = await browser.newPage({ viewport: { width: w / 2, height: h / 2 }, deviceScaleFactor: 2 });
    page.on('pageerror', e => console.error('page error:', e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`); await page.waitForFunction(() => window.perf); await page.evaluate(p => { globalThis.__prof = p; }, prof);
    const names = (await page.evaluate(() => window.perf.RENDERERS)).filter(n => !only || n.includes(only));
    for (const name of names) {
      const r = await page.evaluate(([name, o]) => window.perf.measure(name, o), [name, { width: w, height: h, cell, frames }]).catch(e => ({ name, error: e.message }));
      results.push(r);
      console.log(`${w}x${h} cell ${String(cell).padStart(2)}px  ${name.padEnd(48)} ${r.error ? 'ERROR ' + r.error : `main ${String(r.mainMs).padStart(7)} ms (max ${String(r.mainMaxMs).padStart(6)})   total ${String(r.totalMs).padStart(8)} ms`}`);
    }
    await page.close();
  }
} finally { await browser.close(); server.close(); }
const out = arg('--out', null); if (out) await fs.writeFile(out, JSON.stringify(results, null, 1));
