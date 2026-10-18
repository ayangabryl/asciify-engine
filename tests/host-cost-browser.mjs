// What a host page pays for the kit, per component, in one headless Chrome: import-time work, mount time, forced layouts,
// long tasks, main-thread time while static, while scrolled away and while the tab is hidden, and what outlives destroy().
// Run after `npm run build`: node tests/host-cost-browser.mjs [component ...] (ASCIIFY_DIST measures another build)
// ASCIIFY_PLAYWRIGHT points at playwright's index.mjs; ASCIIFY_AUDIT_OUTPUT writes host-cost.json there; ASCIIFY_HOST_VIDEO adds the core's video loop.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = process.env.ASCIIFY_DIST ?? path.join(root, 'dist');
const { chromium } = await import(pathToFileURL(process.env.ASCIIFY_PLAYWRIGHT ?? path.join(root, 'node_modules/playwright/index.mjs')).href);

const PAGE = `<!doctype html><meta charset="utf-8"><style>body{margin:0;font:16px system-ui;color:#222;background:#fafaf8}
#stage{position:relative;width:720px;padding:24px}#stage>*{position:relative}.tall{height:600vh}</style><div id="stage"></div><div class="tall"></div>`;

// Each case returns [markup, mount(k, el) => handle]; `img` is a generated photo URL.
const CASES = {
  fieldBackground: [`<section style="height:420px"></section>`, (k, el) => k.fieldBackground(el, { preset: 'hero' })],
  background: [`<section style="height:420px"></section>`, (k, el) => k.background(el, { preset: k.swell })],
  beam: [`<button style="padding:14px 28px">Continue</button>`, (k, el) => k.beam(el)],
  decode: [`<h1>ASCII that belongs in your interface.</h1>`, (k, el) => k.decode(el, { text: 'ASCII that belongs in your interface.' })],
  wordmark: [`<h1 style="height:200px">asciify</h1>`, (k, el) => k.wordmark(el, { text: 'asciify' })],
  odometer: [`<span style="font-size:48px">1,234</span>`, (k, el) => k.odometer(el, { value: 1234 })],
  tabs: [`<div role="tablist"><button role="tab" aria-selected="true">One</button><button role="tab">Two</button><button role="tab">Three</button></div>`, (k, el) => k.tabs(el)],
  buttonLoading: [`<button style="padding:12px 24px">Save</button>`, (k, el) => k.buttonLoading(el)],
  statusOrb: [`<div style="width:120px;height:120px"></div>`, (k, el) => k.statusOrb(el)],
  skeleton: [`<div style="width:320px"><p>Loading line one</p><p>Loading line two</p></div>`, (k, el) => k.skeleton(el)],
  pill: [`<span style="padding:4px 12px">Beta</span>`, (k, el) => k.pill(el)],
  imageGenerate: [`<div style="width:320px;height:320px"></div>`, (k, el) => k.imageGenerate(el)],
  artPanel: [`<figure style="width:360px;height:240px;margin:0"></figure>`, (k, el, img) => k.artPanel(el, { image: img })],
  pricingGlow: [`<div style="width:320px;height:200px"><strong data-price>$29</strong></div>`, (k, el) => k.pricingGlow(el)],
  voiceOrb: [`<div style="width:160px;height:160px"></div>`, (k, el) => k.voiceOrb(el)],
  blockChart: [`<div style="width:480px;height:200px"></div>`, (k, el) => k.blockChart(el, { values: [3, 5, 2, 8, 6, 4, 7], labels: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })],
  thinking: [`<div style="width:240px;height:40px">Thinking</div>`, (k, el) => k.thinking(el)],
  streamText: [`<p style="width:360px">Streaming answer text</p>`, (k, el) => k.streamText(el)],
  toastStack: [`<div style="width:320px;height:200px"></div>`, (k, el) => k.toastStack(el)],
  accordion: [`<div style="width:480px;height:240px"></div>`, (k, el, img) => k.accordion(el, { images: [img, img, img] })],
  compare: [`<div style="width:480px;height:240px"></div>`, (k, el, img) => k.compare(el, { image: img })],
  likeBurst: [`<button style="padding:10px">Like</button>`, (k, el) => k.likeBurst(el)],
};

const server = http.createServer(async (req, res) => {
  const file = req.url.split('?')[0];
  if (file === '/media.mp4' && process.env.ASCIIFY_HOST_VIDEO) { res.setHeader('Content-Type', 'video/mp4'); res.end(await fs.readFile(process.env.ASCIIFY_HOST_VIDEO)); return; }
  if (file.endsWith('.js')) {
    try { res.setHeader('Content-Type', 'text/javascript'); res.end(await fs.readFile(path.join(dist, path.normalize(file)))); }
    catch { res.statusCode = 404; res.end(); }
    return;
  }
  res.setHeader('Content-Type', 'text/html'); res.end(PAGE);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

// Counts what the page holds, so anything the kit leaves behind shows as a difference.
function instrument() {
  const live = { raf: new Set(), observers: new Set(), listeners: new Map(), contexts: new Set(), urls: new Set(), intervals: new Set() };
  const counts = { rafRuns: 0, draws: 0, console: 0, longTasks: 0, longMs: 0 };
  const raf = window.requestAnimationFrame.bind(window), caf = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = callback => { const id = raf(t => { live.raf.delete(id); counts.rafRuns++; callback(t); }); live.raf.add(id); return id; };
  window.cancelAnimationFrame = id => { live.raf.delete(id); caf(id); };
  for (const name of ['ResizeObserver', 'IntersectionObserver', 'MutationObserver']) {
    const Base = window[name];
    window[name] = class extends Base {
      observe(...args) { live.observers.add(this); return super.observe(...args); }
      disconnect() { live.observers.delete(this); return super.disconnect(); }
    };
  }
  const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
  const key = (type, fn, options) => `${type}|${typeof options === 'boolean' ? options : !!options?.capture}`;
  EventTarget.prototype.addEventListener = function (type, fn, options) {
    if (fn && !(typeof options === 'object' && options?.once)) {
      let own = live.listeners.get(this);
      if (!own) live.listeners.set(this, own = new Map());
      own.set(fn, new Set([...(own.get(fn) ?? []), key(type, fn, options)]));
    }
    return add.call(this, type, fn, options);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, options) {
    const own = live.listeners.get(this), keys = own?.get(fn);
    if (keys) { keys.delete(key(type, fn, options)); if (!keys.size) own.delete(fn); if (!own.size) live.listeners.delete(this); }
    return remove.call(this, type, fn, options);
  };
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const gl = getContext.call(this, type, ...rest);
    if (gl && /webgl/.test(type)) live.contexts.add(gl);
    return gl;
  };
  const draw = WebGL2RenderingContext.prototype.drawArrays;
  WebGL2RenderingContext.prototype.drawArrays = function (...args) { counts.draws++; return draw.apply(this, args); };
  const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  URL.createObjectURL = blob => { const url = create(blob); live.urls.add(url); return url; };
  URL.revokeObjectURL = url => { live.urls.delete(url); revoke(url); };
  const every = window.setInterval, clear = window.clearInterval;
  window.setInterval = (...args) => { const id = every(...args); live.intervals.add(id); return id; };
  window.clearInterval = id => { live.intervals.delete(id); clear(id); };
  for (const level of ['log', 'warn', 'error', 'info', 'debug']) { const own = console[level]; console[level] = (...args) => { counts.console++; own(...args); }; }
  new PerformanceObserver(list => { for (const entry of list.getEntries()) { counts.longTasks++; counts.longMs += entry.duration; } }).observe({ type: 'longtask', buffered: false });
  window.__host = {
    counts,
    held: () => ({
      raf: live.raf.size, observers: live.observers.size, intervals: live.intervals.size, urls: live.urls.size,
      // A listener on a detached node goes with the node.
      listeners: [...live.listeners].filter(([target]) => !(target instanceof Node) || target.isConnected || target === document)
        .reduce((n, [, own]) => n + [...own.values()].reduce((m, keys) => m + keys.size, 0), 0),
      contexts: [...live.contexts].filter(gl => !gl.isContextLost()).length,
    }),
  };
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'] });
const rows = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  await context.addInitScript(instrument);
  const open = async () => {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
    return { page, errors, metrics };
  };
  // Main-thread time per second (median of three windows, as the machine may be busy), with frames and draws per window.
  const busy = async ({ page, metrics }, ms) => {
    const runs = [];
    for (let i = 0; i < 3; i++) {
      const a = await metrics(), c = await page.evaluate(() => ({ ...__host.counts }));
      await wait(ms);
      const b = await metrics(), d = await page.evaluate(() => ({ ...__host.counts }));
      runs.push({ cpuMsPerS: +((b.TaskDuration - a.TaskDuration) * 1e6 / ms).toFixed(1), frames: d.rafRuns - c.rafRuns, draws: d.draws - c.draws });
    }
    return runs.sort((x, y) => x.cpuMsPerS - y.cpuMsPerS)[1];
  };

  // Import cost of every entry, on its own page: nothing may be created at import.
  for (const entry of ['index', 'core', 'field', 'hover', 'studio', 'kit']) {
    const tab = await open();
    const before = await tab.metrics();
    const result = await tab.page.evaluate(async entry => {
      const held = __host.held(), nodes = document.getElementsByTagName('*').length, start = performance.now();
      await import(`/${entry}.js`);
      const ms = performance.now() - start;
      await new Promise(resolve => setTimeout(resolve, 200));
      const after = __host.held();
      return { ms: +ms.toFixed(1), created: Object.fromEntries(Object.entries(after).filter(([k, v]) => v !== held[k])), nodes: document.getElementsByTagName('*').length - nodes, console: __host.counts.console };
    }, entry);
    const after = await tab.metrics();
    rows.push({ case: `import ${entry}`, importMs: result.ms, scriptMs: +((after.ScriptDuration - before.ScriptDuration) * 1000).toFixed(1), heapKB: Math.round((after.JSHeapUsedSize - before.JSHeapUsedSize) / 1024), sideEffects: JSON.stringify(result.created) === '{}' && !result.nodes && !result.console ? 'none' : JSON.stringify(result) });
    await tab.page.close();
  }

  const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(CASES);
  for (const name of names) {
    const [markup, mount] = CASES[name];
    const tab = await open();
    const { page } = tab;
    await page.evaluate(async () => {
      window.k = await import('/kit.js');
      const art = Object.assign(document.createElement('canvas'), { width: 640, height: 400 }), pen = art.getContext('2d');
      const sky = pen.createLinearGradient(0, 0, 640, 400); sky.addColorStop(0, '#203040'); sky.addColorStop(1, '#e0c090');
      pen.fillStyle = sky; pen.fillRect(0, 0, 640, 400); pen.fillStyle = '#fff'; pen.beginPath(); pen.arc(400, 180, 90, 0, 7); pen.fill();
      window.img = art.toDataURL('image/png');
    });
    const before = await tab.metrics();
    const mounted = await page.evaluate(async ([markup, mount]) => {
      const stage = document.getElementById('stage');
      stage.innerHTML = markup;
      const el = stage.firstElementChild, held = __host.held(), long = __host.counts.longTasks;
      // Inline styles compare by what they set, not by how the browser serialises them.
      window.normal = root => { for (const node of root.querySelectorAll('[style]')) { const css = node.style.cssText; if (css) node.setAttribute('style', css); else node.removeAttribute('style'); } return root.innerHTML; };
      window.markup = normal(stage.cloneNode(true)); window.held = held;
      const start = performance.now();
      window.handle = (0, eval)(`(${mount})`)(k, el, img);
      const syncMs = performance.now() - start;
      const field = handle.field;
      const ready = field ? await Promise.race([field.ready.then(() => performance.now() - start), new Promise(r => setTimeout(() => r(-1), 4000))]) : null;
      return { syncMs: +syncMs.toFixed(1), readyMs: ready === null ? null : +ready.toFixed(0), supported: handle.supported, longTasks: __host.counts.longTasks - long };
    }, [markup, mount.toString()]);
    const after = await tab.metrics();
    await wait(2500);
    const idle = await busy(tab, 1500);
    // Scrolled far away: the field is released and nothing should run.
    await page.evaluate(() => scrollTo(0, innerHeight * 4));
    await wait(600);
    const away = await busy(tab, 1500);
    const awayContexts = await page.evaluate(() => __host.held().contexts);
    await page.evaluate(() => scrollTo(0, 0));
    await wait(1200);
    const leaks = await page.evaluate(async () => {
      handle.destroy();
      await new Promise(resolve => setTimeout(resolve, 600));
      const now = __host.held();
      const left = Object.fromEntries(Object.entries(now).filter(([key, value]) => value > held[key]).map(([key, value]) => [key, value - held[key]]));
      const html = normal(document.getElementById('stage').cloneNode(true));
      if (html !== markup) left.markup = html.length > 160 ? `${html.slice(0, 160)}…` : html;
      return left;
    });
    rows.push({
      case: name, supported: mounted.supported, mountMs: mounted.syncMs, readyMs: mounted.readyMs,
      layouts: after.LayoutCount - before.LayoutCount, styleRecalcs: after.RecalcStyleCount - before.RecalcStyleCount, longTasks: mounted.longTasks,
      idleCpu: idle.cpuMsPerS, idleFrames: idle.frames, idleDraws: idle.draws,
      awayCpu: away.cpuMsPerS, awayFrames: away.frames, awayContexts,
      leaks: JSON.stringify(leaks) === '{}' ? 'none' : JSON.stringify(leaks), errors: tab.errors.join(' | ') || '',
    });
    console.log(rows[rows.length - 1]);
    await page.close();
  }

  // Many instances on one page, and a hidden tab.
  {
    const tab = await open();
    const { page } = tab;
    const many = await page.evaluate(async () => {
      const k = await import('/kit.js');
      const stage = document.getElementById('stage');
      stage.innerHTML = Array.from({ length: 30 }, (_, i) => `<button style="display:block;margin:8px;padding:12px 24px">Button ${i}</button>`).join('');
      const start = performance.now();
      window.handles = [...stage.children].map(el => k.beam(el));
      const ms = performance.now() - start;
      await new Promise(resolve => setTimeout(resolve, 2500));
      return { mountMs: +ms.toFixed(1), contexts: __host.held().contexts };
    });
    const idle = await busy(tab, 2000);
    // Headless pages never hide, and a hidden tab's frames are throttled anyway: report the page hidden, so what is
    // measured is the engine's own gating (timers and frames it would still schedule).
    const hiddenState = await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      return document.visibilityState;
    });
    await wait(300);
    const hidden = await busy(tab, 2000);
    await page.evaluate(() => { delete document.hidden; delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
    const leaks = await page.evaluate(async () => { handles.forEach(h => h.destroy()); await new Promise(r => setTimeout(r, 600)); return __host.held(); });
    rows.push({ case: '30x beam', mountMs: many.mountMs, liveContexts: many.contexts, idleCpu: idle.cpuMsPerS, idleFrames: idle.frames, hiddenState, hiddenCpu: hidden.cpuMsPerS, hiddenFrames: hidden.frames, afterDestroy: JSON.stringify(leaks), errors: tab.errors.join(' | ') });
    console.log(rows[rows.length - 1]);
    await page.close();
  }
  // Reduced motion: once settled, nothing runs.
  {
    const tab = await open();
    await tab.page.emulateMedia({ reducedMotion: 'reduce' });
    await tab.page.evaluate(async () => {
      const k = await import('/kit.js');
      const stage = document.getElementById('stage');
      stage.innerHTML = '<section style="height:420px"></section><button>Go</button><h1>Title</h1>';
      window.handles = [k.fieldBackground(stage.children[0]), k.beam(stage.children[1]), k.decode(stage.children[2], { text: 'Title' })];
      await new Promise(resolve => setTimeout(resolve, 2500));
    });
    const idle = await busy(tab, 2000);
    rows.push({ case: 'reduced motion (3 components)', idleCpu: idle.cpuMsPerS, idleFrames: idle.frames, idleDraws: idle.draws, errors: tab.errors.join(' | ') });
    console.log(rows[rows.length - 1]);
    await tab.page.close();
  }
  // The core's pre-extracted video loop (ASCIIFY_HOST_VIDEO, an mp4): main-thread time on screen and scrolled away.
  if (process.env.ASCIIFY_HOST_VIDEO) {
    const tab = await open();
    const { page } = tab;
    const mountMs = await page.evaluate(async () => {
      const { asciifyVideo } = await import('/index.js');
      const stage = document.getElementById('stage');
      stage.innerHTML = '<canvas width="480" height="270" style="display:block;width:480px;height:270px"></canvas>';
      const start = performance.now();
      window.stopVideo = await asciifyVideo('/media.mp4', stage.firstElementChild, { preExtract: true, fps: 12, trim: { start: 0, end: 2 }, options: { hoverStrength: 0, animationStyle: 'none' } });
      return +(performance.now() - start).toFixed(0);
    });
    await wait(1000);
    const shown = await busy(tab, 1500);
    await page.evaluate(() => scrollTo(0, innerHeight * 4));
    await wait(600);
    const away = await busy(tab, 1500);
    const leaks = await page.evaluate(async () => { stopVideo(); await new Promise(r => setTimeout(r, 400)); return __host.held(); });
    rows.push({ case: 'core asciifyVideo (preExtract)', mountMs, idleCpu: shown.cpuMsPerS, idleFrames: shown.frames, awayCpu: away.cpuMsPerS, awayFrames: away.frames, afterDestroy: JSON.stringify(leaks), errors: tab.errors.join(' | ') });
    console.log(rows[rows.length - 1]);
    await page.close();
  }
  // Edge cases a heavy host meets. Each records pass/fail with its numbers; `ASCIIFY_HOST_EDGES=0` skips them.
  if (process.env.ASCIIFY_HOST_EDGES !== '0') {
    const edge = async (name, run, init) => {
      const tab = await open();
      if (init) await tab.page.evaluate(init);
      const before = await tab.metrics();
      const result = await tab.page.evaluate(run);
      const after = await tab.metrics();
      const long = await tab.page.evaluate(() => __host.counts.longMs);
      const row = { case: `edge: ${name}`, pass: result.pass && !tab.errors.length, ...result.numbers, heapMB: +((after.JSHeapUsedSize - before.JSHeapUsedSize) / 1048576).toFixed(1), errors: tab.errors.join(' | ') };
      rows.push(row); console.log(row);
      await tab.page.close();
      return long;
    };
    const settle = 'await new Promise(r => setTimeout(r, 2500));';
    const idleWindow = `const c0 = __host.counts.rafRuns, d0 = __host.counts.draws, t0 = performance.now(); await new Promise(r => setTimeout(r, 1500)); const framesPerS = Math.round((__host.counts.rafRuns - c0) * 1000 / (performance.now() - t0)), drawsPerS = Math.round((__host.counts.draws - d0) * 1000 / (performance.now() - t0));`;
    const fn = body => new Function(`return (async () => { const k = await import('/kit.js'); const stage = document.getElementById('stage'); ${body} })();`);
    // 150 components: contexts stay within the budget, nothing is lost, idle stays quiet, destroy frees all.
    await edge('150 beams', fn(`stage.innerHTML = Array.from({ length: 150 }, (_, i) => '<button style="display:block;margin:6px;padding:12px 24px">Item ' + i + '</button>').join('');
      const lost = { n: 0 }; addEventListener('webglcontextlost', () => lost.n++, true);
      const start = performance.now(); const hs = [...stage.children].map(el => k.beam(el)); const mountMs = performance.now() - start;
      ${settle} const live = __host.held().contexts;
      for (let y = 0; y < 6; y++) { scrollTo(0, y * innerHeight); await new Promise(r => setTimeout(r, 400)); }
      scrollTo(0, 0); await new Promise(r => setTimeout(r, 800)); const peak = __host.held().contexts;
      hs.forEach(h => h.destroy()); await new Promise(r => setTimeout(r, 500)); const left = __host.held();
      return { pass: live <= 12 && peak <= 12 && !lost.n && !left.contexts && !left.raf && !left.observers, numbers: { mountMs: Math.round(mountMs), liveContexts: live, peakContexts: peak, lostContexts: lost.n, afterDestroy: JSON.stringify(left) } };`));
    // A full-bleed field on a 5K-class screen: the backing store is capped near one 4K screen.
    await edge('large surface 2560x1440 css at dpr 3', fn(`stage.innerHTML = '<section style="width:2560px;height:1440px"></section>';
      Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => 3 });
      const h = k.fieldBackground(stage.firstElementChild, { look: { maxPixelRatio: 3 } }); ${settle}
      const c = stage.querySelector('canvas[data-renderer="glyph-field"]'); const px = c ? c.width * c.height : 0; h.destroy();
      return { pass: px > 0 && px <= 3840 * 2160 * 1.01, numbers: { backingPx: px, uncappedPx: 2560 * 1440 * 9 } };`));
    // Zero-size and display:none hosts do no work.
    await edge('zero-size and display:none hosts', fn(`stage.innerHTML = '<div style="width:0;height:0"></div><div style="display:none;width:300px;height:200px"></div>';
      const hs = [k.fieldBackground(stage.children[0]), k.fieldBackground(stage.children[1])]; ${settle} ${idleWindow}
      const held = __host.held(); hs.forEach(h => h.destroy());
      return { pass: drawsPerS === 0 && held.contexts <= 1, numbers: { framesPerS, drawsPerS, contexts: held.contexts } };`));
    // A host animating the element's size every frame: no ResizeObserver loop errors, no runaway work.
    await edge('host resized every frame', fn(`stage.innerHTML = '<button style="padding:12px 24px">Resize</button>';
      const errors = []; addEventListener('error', e => errors.push(e.message));
      const h = k.beam(stage.firstElementChild); let n = 0, on = true; const grow = () => { if (!on) return; stage.firstElementChild.style.width = (160 + (n++ % 60)) + 'px'; requestAnimationFrame(grow); }; grow();
      ${settle} ${idleWindow} on = false; h.destroy();
      return { pass: !errors.length, numbers: { framesPerS, drawsPerS, resizeErrors: errors.length } };`));
    // Rapid mount and destroy, as StrictMode, route changes and recycled list rows do.
    await edge('100 rapid mount/destroy cycles', fn(`stage.innerHTML = '<button style="padding:12px 24px">Go</button>'; const before = __host.held();
      const start = performance.now(); for (let i = 0; i < 100; i++) { const h = k.beam(stage.firstElementChild); if (i % 2) await new Promise(r => requestAnimationFrame(r)); h.destroy(); }
      const ms = performance.now() - start; await new Promise(r => setTimeout(r, 800)); const left = __host.held();
      const leaked = Object.keys(left).filter(key => left[key] > before[key]);
      return { pass: !leaked.length, numbers: { totalMs: Math.round(ms), leaked: leaked.join(',') || 'none' } };`));
    // No WebGL2: components keep their HTML (and posters), no errors, no work.
    await edge('no WebGL2', fn(`stage.innerHTML = '<button style="padding:12px 24px">Go</button><section style="height:300px"></section>';
      const hs = [k.beam(stage.children[0]), k.fieldBackground(stage.children[1])]; ${settle} ${idleWindow}
      const supported = hs.map(h => h.supported); hs.forEach(h => h.destroy());
      return { pass: supported.every(s => !s) && framesPerS === 0, numbers: { supported: supported.join(','), framesPerS } };`),
      () => { const get = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return /webgl/.test(type) ? null : get.call(this, type, ...rest); }; });
    // A lost context that is never restored: the field gives way to its poster and mounts again on a fresh canvas.
    await edge('context lost and not restored', fn(`stage.innerHTML = '<section style="height:300px"></section>';
      const h = k.fieldBackground(stage.firstElementChild); ${settle}
      const first = stage.querySelector('canvas[data-renderer="glyph-field"]'); first.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext();
      await new Promise(r => setTimeout(r, 2500)); const next = stage.querySelector('canvas[data-renderer="glyph-field"]');
      const ok = !!next && next !== first && !next.getContext('webgl2').isContextLost(); h.destroy();
      return { pass: ok, numbers: { remounted: ok } };`));
    // A low-end device (two cores): ambient motion draws 30 times a second.
    await edge('low-end device ambient rate', fn(`stage.innerHTML = '<section style="height:420px"></section>';
      const h = k.fieldBackground(stage.firstElementChild); ${settle} ${idleWindow} h.destroy();
      return { pass: drawsPerS / 2 <= 32, numbers: { framesPerS, fieldDrawsPerS: drawsPerS / 2 } };`),
      () => { Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, get: () => 2 }); });
    // The long tasks every edge case produced, together.
    const longest = rows.filter(row => String(row.case).startsWith('edge:')).length;
    rows.push({ case: 'edge cases run', count: longest });
  }
  console.table(rows.map(({ errors, ...row }) => row));
  if (process.env.ASCIIFY_AUDIT_OUTPUT) await fs.writeFile(path.join(process.env.ASCIIFY_AUDIT_OUTPUT, 'host-cost.json'), JSON.stringify(rows, null, 2));
} finally {
  await Promise.race([browser.close(), wait(5000)]);
  server.close();
}
