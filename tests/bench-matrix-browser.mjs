// The engine in every mode, measured the same way: startup (import to first frame, long tasks, shader compiles, atlas and
// source analysis), steady state (frame times idle, scrolling and interacting; main-thread and GPU-process busy; draws and
// texture uploads) and memory (heap, listeners, canvases, live WebGL contexts and their GPU memory, over a soak and after destroy).
// Run after `npm run build`: node tests/bench-matrix-browser.mjs [--only kit,backgrounds,...] [--part 1/8] [--cpu 4] [--gl swiftshader] [--spoof-gpu] [--out file.json]
// ASCIIFY_DIST measures another build; ASCIIFY_PLAYWRIGHT points at playwright's index.mjs; ASCIIFY_BENCH_MEDIA holds (or receives,
// with ffmpeg) the media fixtures; ASCIIFY_SITE (a served build of the site) adds its pages; ASCIIFY_HEADLESS=1 runs headless.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = process.env.ASCIIFY_DIST ?? path.join(root, 'dist');
const media = process.env.ASCIIFY_BENCH_MEDIA ?? path.join(os.tmpdir(), 'asciify-bench-media');
const site = process.env.ASCIIFY_SITE;
const { chromium } = await import(pathToFileURL(process.env.ASCIIFY_PLAYWRIGHT ?? path.join(root, 'node_modules/playwright/index.mjs')).href);
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1] ?? ''; };
const only = arg('--only')?.split(','), cpu = +(arg('--cpu') ?? 1), gl = arg('--gl'), spoof = process.argv.includes('--spoof-gpu'), out = arg('--out');
const throttled = cpu > 1 || !!gl;

// Media: a 1280 and a 4K still, a short and a long MP4 and an animated GIF, made once with ffmpeg.
const FILES = {
  'still-1280.jpg': ['-f', 'lavfi', '-i', 'testsrc2=size=1280x720', '-frames:v', '1', '-q:v', '3'],
  'still-4k.jpg': ['-f', 'lavfi', '-i', 'testsrc2=size=3840x2160', '-frames:v', '1', '-q:v', '3'],
  'short.mp4': ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-t', '2', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-movflags', '+faststart'],
  'long.mp4': ['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-t', '20', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-movflags', '+faststart'],
  'anim.gif': ['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=12', '-t', '2'],
};
await fs.mkdir(media, { recursive: true });
for (const [name, args] of Object.entries(FILES)) {
  if (existsSync(path.join(media, name))) continue;
  try { execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args, path.join(media, name)]); } catch { console.warn(`no ${name}: ffmpeg is needed to make it`); }
}

// The engine's one runtime dependency, gifuct-js, bundled for the page's import map.
let gifuct = '';
try {
  const { build } = await import('esbuild');
  const entry = path.join(root, 'node_modules/gifuct-js/src/index.js');
  gifuct = (await build({ entryPoints: [entry], bundle: true, format: 'esm', write: false })).outputFiles[0].text;
} catch { console.warn('gifuct-js could not be bundled: the GIF cases will fail'); }
const PAGE = `<!doctype html><meta charset="utf-8"><script type="importmap">{"imports":{"gifuct-js":"/vendor/gifuct.js"}}</script><style>body{margin:0;font:16px system-ui;color:#222;background:#fafaf8}
#stage{position:relative;width:min(960px,100%);padding:24px;box-sizing:border-box}#stage>*{position:relative}.tall{height:300vh}
.full{width:100vw;height:100vh;margin:-24px}</style><div id="stage"></div><div class="tall"></div>`;
const TYPES = { '.js': 'text/javascript', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.gif': 'image/gif' };
const server = http.createServer(async (req, res) => {
  const file = decodeURIComponent(req.url.split('?')[0]);
  const ext = path.extname(file);
  if (file === '/vendor/gifuct.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(gifuct); return; }
  if (TYPES[ext]) {
    try {
      const from = file.startsWith('/media/') ? path.join(media, path.basename(file)) : path.join(dist, path.normalize(file));
      const body = await fs.readFile(from);
      res.setHeader('Content-Type', TYPES[ext]); res.setHeader('Access-Control-Allow-Origin', '*');
      // Video seeks need ranges.
      const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
      if (range) {
        const start = +range[1], end = range[2] ? +range[2] : body.length - 1;
        res.statusCode = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${body.length}`); res.setHeader('Accept-Ranges', 'bytes');
        res.end(body.subarray(start, end + 1));
      } else res.end(body);
    } catch { res.statusCode = 404; res.end(); }
    return;
  }
  res.setHeader('Content-Type', 'text/html'); res.end(PAGE);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

/** Runs in the page before anything else: counts what the page holds and times the work the targets name. */
function instrument(spoofGpu) {
  const live = { raf: new Set(), observers: new Set(), listeners: new Map(), contexts: new Set(), textures: new Map() };
  const t = { compileMs: 0, atlasMs: 0, analysisMs: 0, uploadMs: 0, uploadBytes: 0, uploads: 0, draws: 0, blits: 0, rafRuns: 0, firstDraw: 0, mark: 0, decoded: 0 };
  const long = [];
  const gpu = {
    open: new Map(), off: new WeakSet(), engine: new WeakSet(), pending: [], ms: 0,
    close() { for (const [gl, entry] of gpu.open) { if (!gl.isContextLost()) { gl.endQuery(entry.ext.TIME_ELAPSED_EXT); gpu.pending.push([gl, entry]); } } gpu.open.clear(); },
    poll() {
      gpu.pending = gpu.pending.filter(([gl, { query, ext }]) => {
        if (gl.isContextLost()) return false;
        if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) return true;
        if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) gpu.ms += gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
        gl.deleteQuery(query);
        return false;
      });
    },
  };
  t.gpu = gpu;
  const timed = (proto, name, key, also) => {
    const own = proto?.[name];
    if (!own) return;
    proto[name] = function (...args) { const s = performance.now(); try { return own.apply(this, args); } finally { t[key] += performance.now() - s; also?.(this, args); } };
  };
  const raf = window.requestAnimationFrame.bind(window), caf = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = callback => { const id = raf(time => { live.raf.delete(id); t.rafRuns++; callback(time); }); live.raf.add(id); return id; };
  window.cancelAnimationFrame = id => { live.raf.delete(id); caf(id); };
  for (const name of ['ResizeObserver', 'IntersectionObserver', 'MutationObserver']) {
    const Base = window[name];
    window[name] = class extends Base {
      observe(...args) { live.observers.add(this); return super.observe(...args); }
      disconnect() { live.observers.delete(this); return super.disconnect(); }
    };
  }
  const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
  const key = (type, options) => `${type}|${typeof options === 'boolean' ? options : !!options?.capture}`;
  EventTarget.prototype.addEventListener = function (type, fn, options) {
    if (fn && !(typeof options === 'object' && options?.once)) {
      let own = live.listeners.get(this);
      if (!own) live.listeners.set(this, own = new Map());
      own.set(fn, new Set([...(own.get(fn) ?? []), key(type, options)]));
    }
    return add.call(this, type, fn, options);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, options) {
    const own = live.listeners.get(this), keys = own?.get(fn);
    if (keys) { keys.delete(key(type, options)); if (!keys.size) own.delete(fn); if (!own.size) live.listeners.delete(this); }
    return remove.call(this, type, fn, options);
  };
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const ctx = getContext.call(this, type, ...rest);
    if (ctx && /webgl/.test(type)) live.contexts.add(ctx);
    return ctx;
  };
  if (window.OffscreenCanvas) {
    const own = OffscreenCanvas.prototype.getContext;
    OffscreenCanvas.prototype.getContext = function (type, ...rest) { const ctx = own.call(this, type, ...rest); if (ctx && /webgl/.test(type)) live.contexts.add(ctx); return ctx; };
  }
  // GPU textures: bytes per texture object, from the level-0 size each upload or allocation names.
  const bpp = (gl, format, type) => (type === gl.HALF_FLOAT || format === gl.RGBA16F ? 8 : type === gl.FLOAT || format === gl.RGBA32F ? 16 : 4);
  for (const Proto of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    const p = Proto?.prototype;
    if (!p) continue;
    const bound = new WeakMap();
    const bind = p.bindTexture, create = p.createTexture, del = p.deleteTexture;
    p.bindTexture = function (target, texture) { bound.set(this, texture); return bind.call(this, target, texture); };
    p.createTexture = function () { const texture = create.call(this); live.textures.set(texture, { gl: this, bytes: 0 }); return texture; };
    p.deleteTexture = function (texture) { live.textures.delete(texture); return del.call(this, texture); };
    const size = (gl, args) => {
      if (args.length >= 8 && typeof args[3] === 'number') return [args[3], args[4], args[2], args[7]];
      const src = args[args.length - 1];
      return [src?.videoWidth || src?.naturalWidth || src?.width || 0, src?.videoHeight || src?.naturalHeight || src?.height || 0, args[2], args[args.length - 2]];
    };
    const record = (gl, args, level) => {
      if (level) return;
      const [w, h, format, type] = size(gl, args), entry = live.textures.get(bound.get(gl));
      const bytes = w * h * bpp(gl, format, type);
      if (entry) entry.bytes = bytes;
      t.uploadBytes += bytes; t.uploads++;
    };
    const image = p.texImage2D;
    p.texImage2D = function (...args) { const s = performance.now(); try { return image.apply(this, args); } finally { t.uploadMs += performance.now() - s; record(this, args, args[1]); } };
    const sub = p.texSubImage2D;
    p.texSubImage2D = function (...args) {
      const s = performance.now();
      try { return sub.apply(this, args); } finally {
        t.uploadMs += performance.now() - s; t.uploads++;
        const src = args[args.length - 1];
        t.uploadBytes += (typeof args[4] === 'number' && args.length >= 9 ? args[4] * args[5] : (src?.videoWidth || src?.width || 0) * (src?.videoHeight || src?.height || 0)) * 4;
      }
    };
    const storage = p.texStorage2D;
    if (storage) p.texStorage2D = function (target, levels, format, w, h) { const entry = live.textures.get(bound.get(this)); if (entry) entry.bytes = w * h * bpp(this, format, 0) * (levels > 1 ? 1.34 : 1); return storage.call(this, target, levels, format, w, h); };
    for (const name of ['compileShader', 'linkProgram', 'getProgramParameter', 'getShaderParameter']) timed(p, name, 'compileMs');
    // GPU time: a timer query spans each task's draws in each context, where the browser exposes the extension.
    const begin = p.beginQuery;
    // A context whose page already times its own frames (the engine's shared context does): its results are summed as read.
    if (begin) {
      p.beginQuery = function (...args) { gpu.engine.add(this); return begin.apply(this, args); };
      const result = p.getQueryParameter;
      p.getQueryParameter = function (query, name) { const value = result.call(this, query, name); if (name === this.QUERY_RESULT && gpu.engine.has(this)) gpu.ms += value / 1e6; return value; };
    }
    for (const name of ['drawArrays', 'drawElements']) {
      const own = p[name];
      p[name] = function (...args) {
        t.draws++;
        if (!t.firstDraw && t.mark) t.firstDraw = performance.now();
        if (begin && !gpu.open.has(this) && !gpu.off.has(this) && !gpu.engine.has(this)) {
          const ext = this.getExtension('EXT_disjoint_timer_query_webgl2');
          if (!ext) gpu.off.add(this);
          else {
            const query = this.createQuery();
            begin.call(this, ext.TIME_ELAPSED_EXT, query);
            gpu.open.set(this, { query, ext });
            if (gpu.open.size === 1) queueMicrotask(() => setTimeout(gpu.close, 0));
          }
        }
        return own.apply(this, args);
      };
    }
    if (spoofGpu) {
      const parameter = p.getParameter;
      p.getParameter = function (name) { const value = parameter.call(this, name); return typeof value === 'string' && /swiftshader|software/i.test(value) ? 'ANGLE (Bench, spoofed GPU)' : value; };
    }
  }
  const c2 = CanvasRenderingContext2D.prototype;
  // Atlas and text work on canvases outside the page; blits are what a page canvas receives from another canvas.
  const fill = c2.fillText;
  c2.fillText = function (...args) { const s = performance.now(); try { return fill.apply(this, args); } finally { if (!this.canvas.isConnected) t.atlasMs += performance.now() - s; else if (!t.firstDraw && t.mark) t.firstDraw = performance.now(); } };
  timed(c2, 'getImageData', 'analysisMs');
  const drawImage = c2.drawImage;
  c2.drawImage = function (...args) { if (this.canvas.isConnected) { t.blits++; if (!t.firstDraw && t.mark) t.firstDraw = performance.now(); } return drawImage.apply(this, args); };
  const put = c2.putImageData;
  c2.putImageData = function (...args) { if (this.canvas.isConnected && !t.firstDraw && t.mark) t.firstDraw = performance.now(); return put.apply(this, args); };
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) { const p = play.apply(this, args); p?.then?.(() => { t.decoded = Math.max(t.decoded, performance.now()); }, () => {}); return p; };
  const bitmap = window.createImageBitmap;
  window.createImageBitmap = (...args) => bitmap(...args).then(result => { t.decoded = performance.now(); return result; });
  new PerformanceObserver(list => { for (const entry of list.getEntries()) long.push([entry.startTime, entry.duration]); }).observe({ type: 'longtask', buffered: true });
  let gaps = null, last = 0, run = 0;
  const tick = (id, time) => { gpu.poll(); if (gaps && id === run) { if (last) gaps.push(time - last); last = time; raf(next => tick(id, next)); } };
  window.__bench = {
    t, long,
    record() { gaps = []; last = 0; const id = ++run; raf(time => tick(id, time)); },
    stop() { const out = gaps ?? []; gaps = null; return out; },
    gpuMs: () => t.gpu.ms,
    mark() { t.mark = performance.now(); t.firstDraw = 0; t.decoded = 0; for (const k of ['compileMs', 'atlasMs', 'analysisMs', 'uploadMs']) t[k] = 0; },
    held: () => {
      const contexts = [...live.contexts].filter(ctx => !ctx.isContextLost());
      let textures = 0;
      for (const [, entry] of live.textures) if (!entry.gl.isContextLost()) textures += entry.bytes;
      // Each context's drawing buffer, double-buffered unless preserved.
      const buffers = contexts.reduce((n, ctx) => n + ctx.drawingBufferWidth * ctx.drawingBufferHeight * 4 * (ctx.getContextAttributes()?.preserveDrawingBuffer ? 1 : 2), 0);
      return {
        raf: live.raf.size, observers: live.observers.size, observerTypes: [...live.observers].map(o => Object.getPrototypeOf(Object.getPrototypeOf(o)).constructor.name).sort().join(','),
        listeners: [...live.listeners].filter(([target]) => !(target instanceof Node) || target.isConnected || target === document)
          .reduce((n, [, own]) => n + [...own.values()].reduce((m, keys) => m + keys.size, 0), 0),
        contexts: contexts.length, canvases: document.querySelectorAll('canvas').length,
        listenerTypes: [...live.listeners].filter(([target]) => !(target instanceof Node) || target.isConnected || target === document)
          .flatMap(([target, own]) => [...own.values()].flatMap(keys => [...keys].map(k => `${target.constructor.name}:${k.split('|')[0]}`))).sort().join(','),
        textureMB: +(textures / 1048576).toFixed(1), bufferMB: +(buffers / 1048576).toFixed(1),
      };
    },
  };
}

const stats = list => {
  const s = [...list].sort((a, b) => a - b);
  const at = q => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : 0);
  return { n: s.length, p50: +at(0.5).toFixed(1), p95: +at(0.95).toFixed(1), max: +(s[s.length - 1] ?? 0).toFixed(1) };
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Each case: markup, then mount(env) in the page returning handles (or a cleanup function). `env` holds the modules and media URLs.
const img = '/media/still-1280.jpg', img4k = '/media/still-4k.jpg';
const kitCase = (markup, body, extra = {}) => ({ group: 'kit', markup, mount: `const el = stage.firstElementChild; return [${body}];`, interact: '#stage > *', ...extra });
const KIT = {
  fieldBackground: kitCase('<section style="height:420px"></section>', `kit.fieldBackground(el, { preset: 'hero' })`),
  background: kitCase('<section style="height:420px"></section>', `kit.background(el, { preset: kit.swell })`),
  beam: kitCase('<button style="padding:14px 28px">Continue</button>', 'kit.beam(el)'),
  decode: kitCase('<h1>ASCII that belongs in your interface.</h1>', `kit.decode(el, { text: 'ASCII that belongs in your interface.' })`),
  wordmark: kitCase('<h1 style="height:200px">asciify</h1>', `kit.wordmark(el, { text: 'asciify' })`),
  odometer: kitCase('<span style="font-size:48px">1,234</span>', 'kit.odometer(el, { value: 1234 })'),
  tabs: kitCase('<div role="tablist"><button role="tab" aria-selected="true">One</button><button role="tab">Two</button><button role="tab">Three</button></div>', 'kit.tabs(el)'),
  buttonLoading: kitCase('<button style="padding:12px 24px">Save</button>', 'kit.buttonLoading(el)'),
  statusOrb: kitCase('<div style="width:120px;height:120px"></div>', 'kit.statusOrb(el)'),
  skeleton: kitCase('<div style="width:320px"><p>Loading line one</p><p>Loading line two</p></div>', 'kit.skeleton(el)'),
  pill: kitCase('<span style="padding:4px 12px">Beta</span>', 'kit.pill(el)'),
  imageGenerate: kitCase('<div style="width:320px;height:320px"></div>', 'kit.imageGenerate(el)'),
  artPanel: kitCase('<figure style="width:360px;height:240px;margin:0"></figure>', `kit.artPanel(el, { image: '${img}' })`),
  pricingGlow: kitCase('<div style="width:320px;height:200px"><strong data-price>$29</strong></div>', 'kit.pricingGlow(el)'),
  voiceOrb: kitCase('<div style="width:160px;height:160px"></div>', 'kit.voiceOrb(el)'),
  blockChart: kitCase('<div style="width:480px;height:200px"></div>', `kit.blockChart(el, { values: [3, 5, 2, 8, 6, 4, 7], labels: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })`),
  thinking: kitCase('<div style="width:240px;height:40px">Thinking</div>', 'kit.thinking(el)'),
  streamText: kitCase('<p style="width:360px">Streaming answer text</p>', 'kit.streamText(el)'),
  toastStack: kitCase('<div style="width:320px;height:200px"></div>', 'kit.toastStack(el)'),
  accordion: kitCase('<div style="width:480px;height:240px"></div>', `kit.accordion(el, { images: ['${img}', '${img}', '${img}'] })`),
  compare: kitCase('<div style="width:480px;height:240px"></div>', `kit.compare(el, { image: '${img}' })`),
  likeBurst: kitCase('<button style="padding:10px">Like</button>', 'kit.likeBurst(el)'),
  asciiVideo: kitCase('<div style="width:480px;height:270px"></div>', `kit.asciiVideo(el, { src: '/media/short.mp4' })`),
};
const allKit = Object.entries(KIT).map(([, c]) => [c.markup, c.mount.replace(/^const el = stage.firstElementChild; return \[|\];$/g, '')]);
const BG_PRESETS = ['swell', 'drift', 'wordField', 'fluid', 'caustics', 'contour', 'ripple', 'halo', 'interference', 'mesh', 'cascade', 'constellation'];
const bg = (name, body, dpr, extra = {}) => ({ group: 'backgrounds', markup: '<section class="full"></section>', mount: `const el = stage.firstElementChild; return [${body}];`, dpr, interact: '#stage > *', scroll: false, ...extra });
const STYLES = ['ascii', 'blocks', 'braille', 'dots', 'lines', 'cross', 'diagonal', 'diamond', 'mixed', 'pixel', 'mosaic', 'lego', 'voxel', 'disco', 'dither', 'hex', 'led', 'cmyk', 'stipple', 'engraving', 'crosshatch', 'woodblock', 'risograph', 'pointillism'];
const fieldOf = (size, source, look, extra = {}) => ({
  group: 'pictures', markup: `<canvas style="display:block;width:${size[0]}px;height:${size[1]}px"></canvas>`,
  mount: `return [field.mountGlyphField(stage.firstElementChild, { source: '${source}', ...${JSON.stringify(look)} })];`, interact: '#stage > canvas', ...extra,
});
const studioOf = (size, source, settings, extra = {}) => ({
  group: 'pictures', markup: `<canvas style="display:block;width:${size[0]}px;height:${size[1]}px"></canvas>`,
  mount: `return [await studio.mountStudio(stage.firstElementChild, '${source}', { width: ${size[0] * 2}, height: ${size[1] * 2}, settings: ${JSON.stringify(settings)} })];`, interact: '#stage > canvas', ...extra,
});

const CASES = {
  ...Object.fromEntries(Object.entries(KIT).map(([name, c]) => [`kit ${name}`, c])),
  'kit all together': { group: 'kit', markup: allKit.map(([m]) => `<div style="margin:24px 0">${m}</div>`).join(''), mount: `const fns = [${allKit.map(([, b]) => `el => ${b}`).join(', ')}]; return [...stage.children].map((box, i) => fns[i](box.firstElementChild));`, interact: '#stage > div > *', interactCount: 8, scroll: true, soak: true },
  ...Object.fromEntries(['hero', 'brand', 'notFound'].flatMap(preset => [1, 2, 3].map(dpr => [`fieldBackground ${preset} dpr${dpr}`, bg(preset, `kit.fieldBackground(el, { preset: '${preset}' })`, dpr, preset === 'hero' && dpr === 2 ? { soak: true } : {})]))),
  ...Object.fromEntries(BG_PRESETS.map(name => [`background ${name} dpr2`, bg(name, `kit.background(el, { preset: kit.${name} })`, 2)])),
  ...Object.fromEntries(['fluid', 'swell'].flatMap(name => [1, 3].map(dpr => [`background ${name} dpr${dpr}`, bg(name, `kit.background(el, { preset: kit.${name} })`, dpr)]))),
  'background hero 4K screen': bg('hero', `kit.fieldBackground(el, { preset: 'hero' })`, 2, { group: 'edge', viewport: [1920, 1080] }),
  'background hero 5K screen': bg('hero', `kit.fieldBackground(el, { preset: 'hero' })`, 2, { group: 'edge', viewport: [2560, 1440] }),
  ...Object.fromEntries(STYLES.map(style => [`field ${style} 640x400`, fieldOf([640, 400], img, { mark: ({ ascii: 'glyph', blocks: 'glyph', braille: 'glyph', lines: 'glyph', cross: 'glyph', diagonal: 'glyph', diamond: 'glyph', mixed: 'glyph', dots: 'dot' })[style] ?? style, hover: 'trail', ...(style === 'braille' ? { charset: ' ⠁⠃⠇⡇⣇⣧⣷⣿' } : style === 'blocks' ? { charset: ' ░▒▓█' } : {}) })])),
  'field ascii 240x160 1280src': fieldOf([240, 160], img, { hover: 'fluid' }),
  'field ascii 960x540 1280src': fieldOf([960, 540], img, { hover: 'fluid' }),
  'field ascii 1440x810 4Ksrc': fieldOf([1440, 810], img4k, { hover: 'lantern' }, { soak: true }),
  'field ascii 960x540 4Ksrc': fieldOf([960, 540], img4k, { hover: 'trail' }),
  ...Object.fromEntries(['ascii', 'pointillism', 'led', 'braille', 'dots', 'cmyk'].map(style => [`studio ${style} 480x300 trail`, studioOf([480, 300], img, { style, hover: { effect: 'trail' } })])),
  'studio ascii 960x540 4Ksrc': studioOf([960, 540], img4k, { style: 'ascii', hover: { effect: 'trail' } }),
  'studio hover 640x400': { group: 'pictures', markup: '<div style="position:relative;width:640px;height:400px"><canvas width="1280" height="800" style="width:640px;height:400px"></canvas></div>', mount: `const host = stage.firstElementChild, art = host.firstElementChild; const stop = await core.asciify('${img}', art, { fontSize: 8 }); return [stop, hover.mountStudioHover(host, art, { effect: 'trail' })];`, interact: '#stage > div' },
  'video field short': fieldOf([640, 360], '/media/short.mp4', { hover: 'fluid' }, { group: 'video' }),
  'video field long': fieldOf([960, 540], '/media/long.mp4', { hover: 'trail' }, { group: 'video', soak: true }),
  'video 4 fields on one page': { group: 'video', markup: Array.from({ length: 4 }, () => '<canvas style="display:block;width:480px;height:270px;margin:12px 0"></canvas>').join(''), mount: `return [...stage.children].map((c, i) => field.mountGlyphField(c, { source: i % 2 ? '/media/long.mp4' : '/media/short.mp4' }));`, interact: '#stage > canvas', scroll: true },
  'video core asciifyVideo': { group: 'video', markup: '<canvas width="640" height="360" style="display:block;width:640px;height:360px"></canvas>', mount: `return [await core.asciifyVideo('/media/short.mp4', stage.firstElementChild, { fontSize: 8 })];`, interact: '#stage > canvas' },
  'video scroll-synced': { group: 'video', markup: '<video src="/media/long.mp4" muted playsinline preload="auto" crossorigin="anonymous" style="width:640px;height:360px"></video>', mount: `const v = stage.firstElementChild; await new Promise(r => v.readyState >= 2 ? r() : v.addEventListener('loadeddata', r, { once: true })); return [core.createVideoScrollScrub(v, { trigger: document.body })];`, scroll: true },
  'gif core asciifyGif': { group: 'gif', markup: '<canvas width="640" height="360" style="display:block;width:640px;height:360px"></canvas>', mount: `return [await core.asciifyGif('/media/anim.gif', stage.firstElementChild, { fontSize: 8 })];` },
  'gif studio': studioOf([480, 270], '/media/anim.gif', { style: 'ascii' }, { group: 'gif' }),
  'text decode headline': kitCase('<h1 style="font-size:56px">Characters that belong in your interface.</h1>', `kit.decode(el, { text: 'Characters that belong in your interface.' })`, { group: 'text' }),
  'text wordmark': kitCase('<h1 style="height:240px;font-size:160px">asciify</h1>', `kit.wordmark(el, { text: 'asciify' })`, { group: 'text' }),
  'text layered typography': { group: 'text', markup: '<section style="position:relative;height:480px"><h1 style="position:relative;z-index:1;font-size:72px;margin:0;padding:120px 40px">Layered type</h1></section>', mount: `const el = stage.firstElementChild; return [kit.fieldBackground(el, { preset: 'hero', clear: el.firstElementChild })];`, interact: '#stage > section' },
  'core image': { group: 'core', markup: '<canvas width="960" height="540" style="display:block;width:960px;height:540px"></canvas>', mount: `return [await core.asciify('${img}', stage.firstElementChild, { fontSize: 8 })];` },
  'core live stream (captureStream)': { group: 'core', markup: '<canvas width="640" height="360" style="display:block;width:640px;height:360px"></canvas>', mount: `
    const src = Object.assign(document.createElement('canvas'), { width: 320, height: 180 }), pen = src.getContext('2d'); let n = 0, on = true;
    const paint = () => { if (!on) return; pen.fillStyle = 'hsl(' + (n++ % 360) + ',60%,50%)'; pen.fillRect(0, 0, 320, 180); pen.fillStyle = '#fff'; pen.fillRect((n * 4) % 320, 60, 60, 60); setTimeout(paint, 33); }; paint();
    const v = Object.assign(document.createElement('video'), { muted: true, playsInline: true, srcObject: src.captureStream(30) }); await v.play();
    const stop = await core.asciifyLiveVideo(v, stage.firstElementChild, { fontSize: 8 });
    return [() => { on = false; stop?.(); v.srcObject.getTracks().forEach(t => t.stop()); }];` },
  // Stress cases stay at or under 60 instances a page.
  'edge 50 beams': { group: 'edge', markup: Array.from({ length: 50 }, (_, i) => `<button style="display:block;margin:6px;padding:12px 24px">Item ${i}</button>`).join(''), mount: 'return [...stage.children].map(el => kit.beam(el));', interact: '#stage > button', scroll: true, soak: true },
  'edge 50 pictures': { group: 'edge', markup: Array.from({ length: 50 }, () => '<canvas style="display:inline-block;width:280px;height:180px;margin:6px"></canvas>').join(''), mount: `return [...stage.children].map(c => field.mountGlyphField(c, { source: '${img}', hover: 'trail' }));`, interact: '#stage > canvas', scroll: true, soak: true },
  // Forty full-viewport grounds that never release by distance: the page's GPU memory budget keeps the far ones on posters.
  'edge 40 eager full-viewport grounds': { group: 'edge', markup: Array.from({ length: 40 }, () => '<section style="height:100vh"></section>').join(''), mount: `return [...stage.children].map(el => kit.fieldBackground(el, { lazy: false, poster: '/media/still-1280.jpg' }));`, scroll: true, soak: true },
  'edge zero-size and display:none': { group: 'edge', markup: '<div style="width:0;height:0"></div><div style="display:none;width:300px;height:200px"></div>', mount: 'return [kit.fieldBackground(stage.children[0]), kit.fieldBackground(stage.children[1])];' },
  'edge rapid mount/destroy x100': { group: 'edge', noFirstFrame: true, markup: '<button style="padding:12px 24px">Go</button>', mount: `for (let i = 0; i < 100; i++) { const h = kit.beam(stage.firstElementChild); if (i % 2) await new Promise(r => requestAnimationFrame(r)); h.destroy(); } return [kit.beam(stage.firstElementChild)];` },
  'edge reduced motion': { group: 'edge', reducedMotion: true, markup: '<section style="height:420px"></section><button>Go</button><h1>Title</h1>', mount: `return [kit.fieldBackground(stage.children[0]), kit.beam(stage.children[1]), kit.decode(stage.children[2], { text: 'Title' })];`, interact: '#stage > section' },
  'edge Save-Data': { group: 'edge', saveData: true, markup: '<section class="full"></section>', mount: `return [kit.fieldBackground(stage.firstElementChild)];` },
  'edge no WebGL2': { group: 'edge', noWebgl: true, markup: '<button style="padding:12px 24px">Go</button><section style="height:300px"></section>', mount: 'return [kit.beam(stage.children[0]), kit.fieldBackground(stage.children[1])];' },
  'edge hidden tab': { group: 'edge', hidden: true, markup: '<section class="full"></section>', mount: `return [kit.fieldBackground(stage.firstElementChild), field.mountGlyphField(Object.assign(stage.appendChild(document.createElement('canvas')), { style: 'width:480px;height:270px' }), { source: '/media/short.mp4' })];` },
  'edge off-screen video': { group: 'edge', offscreen: true, markup: '<div style="height:300vh"></div><canvas style="display:block;width:640px;height:360px"></canvas>', mount: `return [field.mountGlyphField(stage.lastElementChild, { source: '/media/long.mp4' })];` },
  'edge context loss': { group: 'edge', contextLoss: true, markup: '<section style="height:300px"></section>', mount: 'return [kit.fieldBackground(stage.firstElementChild)];' },
};
const SITE_CASES = site ? {
  'site home': { group: 'site', path: '/', scroll: true, soak: true },
  'site /components': { group: 'site', path: '/components', scroll: true, soak: true },
  'site /looks hover': { group: 'site', path: '/looks', scroll: true, interact: '.lk-surface', interactCount: 6 },
  'site /backgrounds': { group: 'site', path: '/backgrounds', scroll: true, interact: 'main' },
  'site /text': { group: 'site', path: '/text', scroll: true, interact: 'main' },
  'site /editor': { group: 'site', path: '/editor', interact: 'canvas', editor: true },
} : {};
const ALL = { ...CASES, ...SITE_CASES };
// `--part 2/5` runs the second fifth of the selection, so a long matrix runs as several short guarded runs.
const [part, parts] = (arg('--part') ?? '1/1').split('/').map(Number);
const selected = Object.keys(ALL).filter(name => !only || only.some(o => name.includes(o) || ALL[name].group === o));
const names = selected.slice(Math.floor(selected.length * (part - 1) / parts), Math.floor(selected.length * part / parts));

const args = ['--window-position=-2400,0', '--enable-precise-memory-info'];
if (gl === 'swiftshader') args.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader');
// Software GL renders every pixel in system memory: it runs headless only.
const browser = await chromium.launch({ channel: 'chrome', headless: process.env.ASCIIFY_HEADLESS === '1' || (gl === 'swiftshader' && !process.env.ASCIIFY_REPRO_HEADFUL), args });
const browserCdp = await browser.newBrowserCDPSession();
const gpuCpu = async () => (await browserCdp.send('SystemInfo.getProcessInfo')).processInfo.filter(p => p.type === 'GPU').reduce((n, p) => n + p.cpuTime, 0);
/** GPU memory from Chrome's own accounting: WebGL in the renderers, and the GPU process's ANGLE and shared images. */
async function gpuMemory() {
  const events = [];
  const collect = e => events.push(...e.value);
  browserCdp.on('Tracing.dataCollected', collect);
  const done = new Promise(r => browserCdp.once('Tracing.tracingComplete', r));
  try {
    await browserCdp.send('Tracing.start', { traceConfig: { includedCategories: ['disabled-by-default-memory-infra'], memoryDumpConfig: { triggers: [] } }, transferMode: 'ReportEvents' });
    await browserCdp.send('Tracing.requestMemoryDump', { deterministic: true, levelOfDetail: 'detailed' });
    await browserCdp.send('Tracing.end'); await done;
  } catch { return null; } finally { browserCdp.off('Tracing.dataCollected', collect); }
  const mb = (al, key) => parseInt(al[key]?.attrs?.size?.value ?? '0', 16) / 1048576;
  let webgl = 0, angle = 0, shared = 0;
  for (const e of events.filter(e => e.ph === 'v')) { const al = e.args?.dumps?.allocators ?? {}; webgl += mb(al, 'webgl'); angle += mb(al, 'gpu/angle'); shared += mb(al, 'gpu/shared_images'); }
  return { webglMB: +webgl.toFixed(1), angleMB: +angle.toFixed(1), sharedImagesMB: +shared.toFixed(1) };
}

// Resident memory of every Chrome process this run started, sampled each second; each row records its case's peak.
const { execFileSync: run } = await import('node:child_process');
// Only this run's browser: the Chrome this process started and its helpers (other runs on the machine don't count).
const chromeProcesses = () => {
  const out = {};
  try {
    const all = run('ps', ['-A', '-o', 'pid=,ppid=,rss=,command='], { encoding: 'utf8', maxBuffer: 1 << 24 }).split('\n').map(line => {
      const [, pid, ppid, rss, command] = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line) ?? [];
      return { pid: +pid, ppid: +ppid, rss: +rss, command };
    }).filter(p => p.pid);
    const mine = new Set(all.filter(p => p.ppid === process.pid && /Chrome/.test(p.command)).map(p => p.pid));
    for (let grew = true; grew;) { grew = false; for (const p of all) if (!mine.has(p.pid) && mine.has(p.ppid)) { mine.add(p.pid); grew = true; } }
    for (const p of all) {
      if (!mine.has(p.pid)) continue;
      const type = /--utility-sub-type=[\w.]*?(\w+)(?:\s|$)/.exec(p.command)?.[1] ?? /--type=([\w-]+)/.exec(p.command)?.[1] ?? 'browser';
      out[type] = (out[type] ?? 0) + Math.round(p.rss / 1024);
    }
  } catch { /* no ps */ }
  return out;
};
const chromeMB = () => Object.values(chromeProcesses()).reduce((a, b) => a + b, 0);
let peakMB = 0;
const sampler = setInterval(() => {
  const by = chromeProcesses(), total = Object.values(by).reduce((a, b) => a + b, 0);
  peakMB = Math.max(peakMB, total);
  if (process.env.ASCIIFY_MEMLOG) console.log(`mem ${total} MB ${JSON.stringify(by)}`);
}, 1000);
const rows = [];
try {
  // The display's refresh interval, from an empty page.
  let refresh = 16.7;
  {
    const page = await browser.newPage();
    await page.goto(origin);
    refresh = await page.evaluate(() => new Promise(resolve => { const gaps = []; let last = 0; const f = t => { if (last) gaps.push(t - last); last = t; if (gaps.length < 120) requestAnimationFrame(f); else resolve(gaps.sort((a, b) => a - b)[60]); }; requestAnimationFrame(f); }));
    await page.close();
  }
  console.log(`refresh interval ${refresh.toFixed(2)} ms (${Math.round(1000 / refresh)} Hz), cpu ${cpu}x${gl ? `, gl ${gl}` : ''}${spoof ? ' (spoofed GPU)' : ''}`);
  for (const name of names) {
    const c = ALL[name];
    const [w, h] = c.viewport ?? [1440, 900];
    const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: c.dpr ?? 2, reducedMotion: c.reducedMotion ? 'reduce' : 'no-preference' });
    await context.addInitScript(instrument, spoof);
    if (c.noWebgl) await context.addInitScript(() => { for (const Canvas of [HTMLCanvasElement, window.OffscreenCanvas].filter(Boolean)) { const get = Canvas.prototype.getContext; Canvas.prototype.getContext = function (type, ...rest) { return /webgl/.test(type) ? null : get.call(this, type, ...rest); }; } });
    if (c.saveData) await context.addInitScript(() => { Object.defineProperty(navigator, 'connection', { configurable: true, get: () => ({ saveData: true, addEventListener() {}, removeEventListener() {} }) }); });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
    const row = { case: name, group: c.group };
    peakMB = chromeMB();
    try {
      const t0 = Date.now();
      if (c.path) {
        await page.goto(site + c.path, { waitUntil: 'load' });
      } else {
        await page.goto(origin);
        // Playwright's input layer and locators add window listeners and an observer of their own on first use: let them in
        // before the baseline.
        await page.mouse.move(1, 1);
        await page.locator('body').evaluateAll(() => 0);
        await page.evaluate(async markup => {
          const at = performance.now();
          [window.kit, window.field, window.core, window.studio, window.hover] = await Promise.all(['/kit.js', '/field.js', '/index.js', '/studio.js', '/hover.js'].map(entry => import(entry)));
          window.__importMs = performance.now() - at;
          document.getElementById('stage').innerHTML = markup;
          window.__base = __bench.held();
        }, c.markup);
      }
      const before = await metrics();
      if (c.path) row.importMs = null;
      // Startup: from the mount call to the first frame drawn, with long tasks during the first three seconds.
      const startup = c.path
        ? await page.evaluate(async () => {
          await new Promise(r => setTimeout(r, 3000));
          const nav = performance.getEntriesByType('navigation')[0], paints = performance.getEntriesByType('paint');
          const fcp = paints.find(p => p.name === 'first-contentful-paint')?.startTime ?? 0;
          const long = __bench.long.filter(([s]) => s < 6000);
          return { firstFrameMs: Math.round(fcp), sourceToFrameMs: null, longTasks: long.length, maxLongMs: Math.round(Math.max(0, ...long.map(l => l[1]))), compileMs: +__bench.t.compileMs.toFixed(1), atlasMs: +__bench.t.atlasMs.toFixed(1), analysisMs: +__bench.t.analysisMs.toFixed(1), domMs: Math.round(nav.domContentLoadedEventEnd) };
        })
        : await page.evaluate(async body => {
          const stage = document.getElementById('stage');
          __bench.mark();
          const start = performance.now();
          let handles = [];
          try { handles = await (async () => { const fn = new Function('stage', 'kit', 'field', 'core', 'studio', 'hover', `return (async () => { ${body} })();`); return fn(stage, kit, field, core, studio, hover); })(); }
          catch (error) { window.__mountError = String(error?.message ?? error); }
          window.__handles = (handles ?? []).filter(Boolean);
          const mountMs = performance.now() - start;
          const readies = __handles.map(h => h?.field?.ready ?? h?.ready).filter(p => p && typeof p.then === 'function');
          const readyAt = readies.length ? await Promise.race([Promise.all(readies).then(() => performance.now()), new Promise(r => setTimeout(() => r(0), 6000))]) : 0;
          await new Promise(r => setTimeout(r, 3000 - Math.min(3000, performance.now() - start)));
          // A handle's ready is its first frame with the source; without one, the first draw into the page.
          const firstAt = readyAt || __bench.t.firstDraw, first = firstAt ? firstAt - start : -1;
          const media = performance.getEntriesByType('resource').filter(e => e.name.includes('/media/') && e.startTime >= start - 50).map(e => e.responseEnd);
          const sourceAt = Math.max(0, ...media, __bench.t.decoded || 0);
          const long = __bench.long.filter(([s]) => s >= start - 5 && s < start + 3000);
          return {
            importMs: Math.round(window.__importMs), mountMs: +mountMs.toFixed(1), firstFrameMs: Math.round(first), firstDrawMs: __bench.t.firstDraw ? Math.round(__bench.t.firstDraw - start) : null,
            sourceToFrameMs: sourceAt && first > 0 ? Math.round(firstAt - Math.max(start, sourceAt)) : null,
            longTasks: long.length, maxLongMs: Math.round(Math.max(0, ...long.map(l => l[1]))),
            compileMs: +__bench.t.compileMs.toFixed(1), atlasMs: +__bench.t.atlasMs.toFixed(1), analysisMs: +__bench.t.analysisMs.toFixed(1), mountError: window.__mountError,
          };
        }, c.mount);
      Object.assign(row, startup);
      const after = await metrics();
      row.startupLayouts = after.LayoutCount - before.LayoutCount;
      if (c.hidden) await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      if (c.contextLoss) row.contextLoss = await page.evaluate(async () => {
        const ctx = [...document.querySelectorAll('canvas')].map(cv => cv.getContext('webgl2')).find(Boolean);
        const lose = ctx?.getExtension('WEBGL_lose_context');
        const shared = globalThis.__asciifyFieldContext?.();
        (shared?.getExtension('WEBGL_lose_context') ?? lose)?.loseContext();
        await new Promise(r => setTimeout(r, 2500));
        __bench.t.firstDraw = 0; __bench.t.mark = performance.now();
        await new Promise(r => setTimeout(r, 800));
        return __bench.t.firstDraw ? 'redrawn' : 'blank';
      });
      // One measured window: frame gaps, main-thread busy, GPU-process busy, draws and uploads per second.
      const windowed = async (label, act) => {
        const a = await metrics(), g = await gpuCpu(), t = await page.evaluate(() => { __bench.record(); return { draws: __bench.t.draws, uploadBytes: __bench.t.uploadBytes, gpuMs: __bench.gpuMs(), at: performance.now() }; });
        const startedAt = Date.now();
        await act();
        const ms = Date.now() - startedAt;
        const [gaps, z] = await page.evaluate(() => [__bench.stop(), { draws: __bench.t.draws, uploadBytes: __bench.t.uploadBytes, gpuMs: __bench.gpuMs(), at: performance.now() }]);
        const b = await metrics(), g2 = await gpuCpu();
        const s = stats(gaps.slice(2)), secs = (z.at - t.at) / 1000;
        row[`${label}P50`] = s.p50; row[`${label}P95`] = s.p95; row[`${label}Max`] = s.max;
        row[`${label}Cpu%`] = +((b.TaskDuration - a.TaskDuration) * 1000 / ms * 100).toFixed(1);
        row[`${label}Gpu%`] = +((g2 - g) * 1000 / ms * 100).toFixed(1);
        row[`${label}Draws/s`] = Math.round((z.draws - t.draws) / secs);
        row[`${label}UploadMB/s`] = +((z.uploadBytes - t.uploadBytes) / 1048576 / secs).toFixed(1);
        // Our draws' GPU time per displayed frame, from timer queries.
        row[`${label}GpuMs/frame`] = +((z.gpuMs - t.gpuMs) / Math.max(1, gaps.length)).toFixed(2);
      };
      await page.waitForTimeout(800);
      await windowed('idle', () => page.waitForTimeout(2000));
      const targets = c.interact ? await page.locator(c.interact).evaluateAll((els, n) => els.slice(0, n).map(el => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }).filter(([, , w, h]) => w > 4 && h > 4), c.interactCount ?? 3) : [];
      const sweep = async () => {
        for (const [x, y, rw, rh] of targets.length ? targets : [[0, 0, w, h]]) {
          const top = Math.max(4, Math.min(h - 4, y)), bottom = Math.max(4, Math.min(h - 4, y + rh));
          for (let i = 0; i < 40; i++) { const k = i / 39; await page.mouse.move(x + rw * (0.1 + 0.8 * k), top + (bottom - top) * (0.5 + 0.35 * Math.sin(k * 9))); await wait(16); }
        }
      };
      if (c.interact) await windowed('hover', sweep);
      const scroll = async () => {
        const height = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
        const step = Math.max(120, Math.round(height / 25));
        for (let y = 0; y < height; y += step) { await page.mouse.wheel(0, step); await wait(40); }
        for (let y = height; y > 0; y -= step) { await page.mouse.wheel(0, -step); await wait(40); }
        await page.evaluate(() => scrollTo(0, 0));
      };
      if (c.scroll !== false) await windowed('scroll', scroll);
      if (c.editor) await windowed('scrub', async () => {
        const sliders = await page.locator('input[type=range]').all();
        for (const slider of sliders.slice(0, 4)) { const box = await slider.boundingBox(); if (!box) continue; await page.mouse.move(box.x + 2, box.y + box.height / 2); await page.mouse.down(); for (let i = 0; i < 20; i++) { await page.mouse.move(box.x + box.width * i / 19, box.y + box.height / 2); await wait(16); } await page.mouse.up(); }
      });
      // Heap and the browser's own listener count after a full collection, so neither reads garbage.
      const held = async () => { await cdp.send('HeapProfiler.collectGarbage'); const m = await metrics(); return { heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1), cdpListeners: m.JSEventListeners, ...(await page.evaluate(() => __bench.held())) }; };
      const start = await held();
      row.heapMB = start.heapMB; row.listeners = start.listeners; row.canvases = start.canvases; row.contexts = start.contexts; row.textureMB = start.textureMB; row.bufferMB = start.bufferMB;
      if (c.soak) {
        const rounds = [];
        for (let i = 0; i < 4; i++) { await scroll(); if (c.interact) await sweep(); await page.waitForTimeout(500); rounds.push(await held()); }
        row.soakListeners = rounds.map(r => r.listeners).join('>');
        row.soakAllListeners = rounds.map(r => r.cdpListeners).join('>');
        row.soakHeapMB = rounds.map(r => r.heapMB).join('>');
        row.soakContexts = rounds.map(r => r.contexts).join('>');
        row.soakTextureMB = rounds.map(r => r.textureMB).join('>');
      }
      Object.assign(row, Object.fromEntries(Object.entries(await gpuMemory() ?? {}).map(([k, v]) => [`gpu.${k}`, v])));
      if (!c.path) {
        const left = await page.evaluate(async () => {
          for (const h of __handles) { try { typeof h === 'function' ? h() : h.destroy?.(); } catch { /* reported by the row */ } }
          // The shared context outlives the last field by three seconds.
          await new Promise(r => setTimeout(r, 3500));
          const now = __bench.held(), base = window.__base;
          // Playwright's input layer adds window listeners of its own on first use; they are not the page's.
          const harness = /^Window:(__playwright_global_listeners_check__|auxclick|click|contextmenu|dblclick|mousedown|mousemove|mouseup|pointerdown|pointerup|touchcancel|touchend|touchstart)$/;
          const was = base.listenerTypes.split(','), extra = now.listenerTypes.split(',').filter(k => { const i = was.indexOf(k); if (i < 0) return !harness.test(k); was.splice(i, 1); return false; });
          const wasObservers = base.observerTypes.split(','), extraObservers = now.observerTypes.split(',').filter(k => { const i = wasObservers.indexOf(k); if (i < 0) return !!k; wasObservers.splice(i, 1); return false; });
          const left = Object.fromEntries(Object.entries(now).filter(([k, v]) => typeof v === 'number' && v > base[k] && !['canvases', 'listeners', 'observers'].includes(k)).map(([k, v]) => [k, +(v - base[k]).toFixed(1)]));
          if (extra.length) left.listeners = extra.join(',');
          if (extraObservers.length) left.observers = extraObservers.join(',');
          return left;
        });
        row.afterDestroy = JSON.stringify(left) === '{}' ? 'clean' : JSON.stringify(left);
        const gpu = await gpuMemory();
        row.afterDestroyWebglMB = gpu?.webglMB;
      }
    } catch (error) {
      row.error = String(error.message ?? error).split('\n')[0];
    }
    row.errors = errors.join(' | ').slice(0, 200);
    row.peakChromeMB = Math.max(peakMB, chromeMB());
    // Targets: a first frame within 100 ms of the source, no long task over 50 ms, idle and scroll p95 within the refresh
    // interval (no frame over 50 ms when throttled), flat listeners and heap, and nothing held after destroy.
    const fails = [];
    if (row.sourceToFrameMs != null && row.sourceToFrameMs > 100) fails.push('first frame');
    else if (row.sourceToFrameMs == null && row.firstFrameMs > 100 + (c.path ? 1500 : 0) && !c.noWebgl && !c.hidden && !c.offscreen && !c.noFirstFrame) fails.push('first frame');
    if (row.maxLongMs > 50) fails.push('long task');
    for (const label of ['idle', 'scroll', 'hover']) {
      if (row[`${label}P95`] === undefined) continue;
      // rAF timestamps jitter by about a millisecond at 120 Hz; a dropped frame shows as a gap of two intervals.
      if (!throttled && row[`${label}P95`] > refresh * 1.25) fails.push(`${label} p95`);
      if (throttled && row[`${label}Max`] > 50) fails.push(`${label} max`);
    }
    const climbs = list => { const v = String(list ?? '').split('>').map(Number); return v.length > 1 && v[v.length - 1] > v[0] * 1.15 + 2; };
    if (climbs(row.soakListeners) || climbs(row.soakAllListeners)) fails.push('listeners');
    if (climbs(row.soakHeapMB)) fails.push('heap');
    if (row.afterDestroy && row.afterDestroy !== 'clean') fails.push('destroy');
    if (row.error || row.mountError) fails.push('error');
    row.pass = fails.length ? `FAIL ${fails.join(', ')}` : 'pass';
    rows.push(row);
    console.log(JSON.stringify(row));
    await context.close();
  }
  if (out) await fs.writeFile(out, JSON.stringify({ refresh, cpu, gl: gl ?? null, spoof, rows }, null, 2));
  console.log(`${rows.filter(r => r.pass === 'pass').length}/${rows.length} pass`);
} finally {
  clearInterval(sampler);
  await Promise.race([browser.close(), wait(5000)]);
  server.close();
}
