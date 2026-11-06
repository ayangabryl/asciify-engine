// createAsciiGpu in a real browser (Chromium, SwiftShader): every mode against the CPU path on the same frame, colour,
// previous frames, charsets, and the fallbacks. npm run build && node tests/headless-gpu-browser.mjs
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { chromium } = createRequire(import.meta.url)('playwright');
const server = http.createServer(async (req, res) => {
  if (req.url === '/still.jpg') { res.end(await fs.readFile(path.join(root, 'tests/fixtures/motion-still.jpg'))); return; }
  if (req.url.endsWith('.js')) { try { res.setHeader('Content-Type', 'text/javascript'); res.end(await fs.readFile(path.join(root, 'dist', req.url))); } catch { res.statusCode = 404; res.end(); } return; }
  res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000">');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const failures = [];
const check = (name, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== undefined ? ` (${detail})` : ''}`); if (!ok) failures.push(name); };

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
const result = await page.evaluate(async () => {
  // Count the workers started, to tell the worker path from the fallback on this thread.
  let workers = 0;
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker { constructor(...args) { super(...args); workers++; } };
  const h = await import('/headless.js');
  const img = new Image(); img.src = '/still.jpg'; await img.decode();
  const frame = document.createElement('canvas'); frame.width = img.naturalWidth; frame.height = img.naturalHeight;
  frame.getContext('2d').drawImage(img, 0, 0);
  const gpu = h.createAsciiGpu();
  if (!gpu) return { supported: false };
  const agree = (a, b) => { let n = 0, t = 0; a.lines.forEach((l, r) => { for (let i = 0; i < l.length; i++) { t++; if (l[i] === b.lines[r][i]) n++; } }); return n / t; };
  // Tone mode picks among 95 glyphs whose tones lie close together, so it is compared by ink, over 3 by 3 cells.
  const inkGap = (a, b) => {
    const ink = g => g.lines.map(l => [...l].map(ch => h.glyphInk(ch) ?? 0));
    const A = ink(a), B = ink(b);
    let sum = 0, n = 0;
    for (let r = 1; r < A.length - 1; r++) for (let c = 1; c < A[0].length - 1; c++) {
      let x = 0, y = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { x += A[r + dy][c + dx]; y += B[r + dy][c + dx]; }
      sum += Math.abs(x - y) / 9; n++;
    }
    return sum / n;
  };
  const modes = [];
  for (const mode of ['shape', 'tone']) for (const dither of ['diffuse', 'ordered', false]) for (const background of ['dark', 'light']) {
    const options = { columns: 100, mode, dither, background };
    const g = await gpu.convert(frame, options), c = h.imageToAsciiGrid(frame, options);
    modes.push({ label: JSON.stringify(options), same: g.columns === c.columns && g.rows === c.rows && g.lines.every(l => l.length === g.columns), agree: agree(g, c), ink: inkGap(g, c), background: g.background === background });
  }
  const colored = await gpu.convert(frame, { columns: 80, color: true }), cpuColored = h.imageToAsciiGrid(frame, { columns: 80, color: true });
  const colorGap = colored.colors ? colored.colors.reduce((s, v, i) => s + Math.abs(v - cpuColored.colors[i]), 0) / colored.colors.length : Infinity;
  const blocks = await gpu.convert(frame, { columns: 60, mode: 'tone', charset: ' ░▒▓█' });
  const first = await gpu.convert(frame, { columns: 90, dither: 'ordered' });
  const again = await gpu.convert(frame, { columns: 90, dither: 'ordered', previous: first });
  const sized = await gpu.convert(frame, { columns: 37, rows: 11 });
  // More than 127 characters in a tone charset is past what the GPU packs: the CPU path answers.
  const wide = Array.from({ length: 160 }, (_, i) => String.fromCharCode(0x2500 + i)).join('');
  const many = await gpu.convert(frame, { columns: 40, mode: 'tone', charset: wide });
  const shared = await h.imageToAsciiGridGPU(frame, { columns: 50 });
  const stats = gpu.stats;
  // The worker and this thread run the same code on the same GPU: the same characters, every mode.
  const here = h.createAsciiGpu({ worker: false });
  let sameEverywhere = true;
  for (const o of [{ columns: 90 }, { columns: 90, dither: 'ordered' }, { columns: 90, mode: 'tone' }, { columns: 90, color: true, background: 'light' }]) {
    const a = await gpu.convert(frame, o), b = await here.convert(frame, o);
    if (a.lines.join('\n') !== b.lines.join('\n') || (a.colors && a.colors.some((v, i) => v !== b.colors[i]))) sameEverywhere = false;
  }
  here.destroy();
  const workersUsed = workers;
  // A page whose content policy blocks Blob workers: the converter falls back to this thread and still answers.
  window.Worker = class { constructor() { throw new DOMException('blocked', 'SecurityError'); } };
  const blocked = h.createAsciiGpu();
  const blockedGrid = await blocked.convert(frame, { columns: 90, dither: 'ordered' });
  const blockedSame = agree(blockedGrid, await gpu.convert(frame, { columns: 90, dither: 'ordered' }));
  blocked.destroy();
  window.Worker = NativeWorker;
  // In a worker, on an OffscreenCanvas: the frame goes over as an ImageBitmap and the main thread does nothing else.
  const worker = new Worker(URL.createObjectURL(new Blob([`
    self.onmessage = async ({ data }) => {
      const h = await import('${location.origin}/headless.js');
      const gpu = h.createAsciiGpu();
      const grid = gpu ? await gpu.convert(data.bitmap, { columns: 64, dither: 'ordered' }) : null;
      self.postMessage(grid ? { columns: grid.columns, rows: grid.rows, lines: grid.lines } : null);
    };`], { type: 'text/javascript' })), { type: 'module' });
  const bitmap = await createImageBitmap(frame);
  const inWorker = await new Promise(resolve => { worker.onmessage = e => resolve(e.data); worker.onerror = () => resolve(null); worker.postMessage({ bitmap }, [bitmap]); });
  worker.terminate();
  const onPage = await gpu.convert(frame, { columns: 64, dither: 'ordered' });
  const video = typeof VideoFrame === 'function' ? new VideoFrame(frame, { timestamp: 0 }) : null;
  const fromVideo = video ? await gpu.convert(video, { columns: 64, dither: 'ordered' }) : null;
  video?.close();
  gpu.destroy();
  let rejected = false;
  try { await gpu.convert(frame, { columns: 10 }); } catch { rejected = true; }
  return {
    supported: true, modes, colorGap, blocks: [...new Set(blocks.lines.join(''))].every(ch => ' ░▒▓█'.includes(ch)) && new Set(blocks.lines.join('')).size >= 3,
    kept: agree(first, again), sized: sized.columns === 37 && sized.rows === 11 && sized.lines.length === 11 && sized.lines.every(l => l.length === 37),
    many: many.columns === 40 && many.lines.every(l => [...l].every(ch => wide.includes(ch))), shared: shared.columns === 50 && shared.lines.length === shared.rows,
    // The main-thread part of a worker conversion can round to 0: the browser's clock is coarse (about 0.1 ms).
    stats: Number.isFinite(stats.mainThreadMs) && stats.mainThreadMs >= 0 && stats.totalMs > 0 && stats.totalMs >= stats.mainThreadMs, rejected,
    videoFrame: fromVideo ? agree(fromVideo, onPage) : null, sameEverywhere, workersUsed, blockedSame,
    worker: inWorker ? { ok: inWorker.columns === 64 && inWorker.lines.length === inWorker.rows, agree: agree(inWorker, onPage) } : null,
  };
});
check('WebGL2 converter created', result.supported);
if (result.supported) {
  for (const m of result.modes) {
    const shape = m.label.includes('"shape"'), diffuse = m.label.includes('"diffuse"');
    check(`${m.label}: grid size and background`, m.same && m.background);
    // Shape mode agrees with the CPU path character for character about as well as two CPU samplings agree with each other.
    if (shape) check(`${m.label}: characters agree with the CPU path`, m.agree >= (diffuse ? 0.7 : 0.88), `${(m.agree * 100).toFixed(1)}%`);
    check(`${m.label}: ink matches the CPU path`, m.ink < (shape ? 0.012 : 0.02), m.ink.toFixed(4));
  }
  check('colours match the CPU path', result.colorGap < 4, result.colorGap.toFixed(2));
  check('a block charset uses only its characters', result.blocks);
  check('the same frame with its previous grid stays the same', result.kept === 1, result.kept);
  check('columns and rows as asked', result.sized);
  check('a charset past 127 characters falls back to the CPU path', result.many);
  check('imageToAsciiGridGPU uses the shared converter', result.shared);
  check('stats report the last frame', result.stats);
  check('convert after destroy rejects', result.rejected);
  check('converts in a worker by default', result.workersUsed >= 1, result.workersUsed);
  check('the worker and this thread give the same grid in every mode', result.sameEverywhere);
  check('falls back to this thread when workers are blocked', result.blockedSame === 1, result.blockedSame);
  check('takes a VideoFrame', result.videoFrame === null || result.videoFrame > 0.98, result.videoFrame);
  check('works in a worker on an OffscreenCanvas, the same as on the page', result.worker?.ok && result.worker.agree > 0.98, result.worker && `${(result.worker.agree * 100).toFixed(1)}%`);
}
check('no page errors', !errors.length, errors.join(' | ').slice(0, 200));
await browser.close(); server.close();
if (failures.length) { console.error(`${failures.length} failed`); process.exit(1); }
console.log('GPU text checks passed.');
