// Frame cost of live ASCII renderers, bundled by perf.mjs. Each renderer draws a live source (a canvas repainted every frame,
// standing in for a playing video) into a canvas of the given size; a frame is timed from the source's repaint to the result
// being on the GPU and finished (read back one pixel, which waits for all queued work).
import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass } from 'postprocessing';
import { AsciiEffectImpl as HeroAscii, createGlyphTexture as heroGlyphs, TERMINAL_SYMBOLS as HERO_SYMBOLS } from './vendor/webgl-ascii-hero/ascii-effect.tsx';
import { mountGlyphField, FIELD_PHOTO_CHARSET } from '../src/field.ts';
import { toAsciiGrid, imageToAsciiGrid } from '../src/headless.ts';
import { TEXT_RENDERERS } from './page.js';

/** A moving picture: gradients and shapes that change every frame, so every upload is new. */
export function liveSource(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  let t = 0;
  const paint = () => {
    t += 1;
    const grd = g.createLinearGradient(0, 0, w, h); grd.addColorStop(0, `hsl(${t % 360},60%,20%)`); grd.addColorStop(1, `hsl(${(t * 3) % 360},70%,70%)`);
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 12; i++) { g.fillStyle = `hsl(${(i * 30 + t) % 360},80%,${40 + i * 4}%)`; g.beginPath(); g.arc((w / 2) + Math.cos(t / 20 + i) * w * .35, (h / 2) + Math.sin(t / 17 + i * 2) * h * .35, h * .08, 0, 7); g.fill(); }
  };
  paint();
  return { canvas: c, paint };
}

// Every animation-frame callback is timed, so the main-thread time of a frame includes the field's own frame loop.
let rafMs = 0;
const nativeRaf = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = cb => nativeRaf(t => { const a = performance.now(); try { cb(t); } finally { rafMs += performance.now() - a; } });

const sync = canvas => { const p = document.createElement('canvas'); p.width = p.height = 1; const g = p.getContext('2d', { willReadFrequently: true }); g.drawImage(canvas, 0, 0, 1, 1); return g.getImageData(0, 0, 1, 1).data[0]; };


/** One glyph atlas for the text renderers: every character drawn once, then stamped with drawImage (faster than fillText). */
function atlasFor(chars, cellW, cellH) {
  const list = [...new Set(chars)], c = document.createElement('canvas'); c.width = cellW * list.length; c.height = cellH;
  const g = c.getContext('2d'); g.fillStyle = '#e8e8e8'; g.font = `${Math.round(cellH * 0.9)}px monospace`; g.textBaseline = 'middle'; g.textAlign = 'center';
  list.forEach((ch, i) => g.fillText(ch, i * cellW + cellW / 2, cellH / 2));
  return { canvas: c, at: new Map(list.map((ch, i) => [ch, i * cellW])) };
}
/** A text renderer drawn on screen each frame: convert the frame, then stamp each non-blank character from the atlas. */
const textOnScreen = convert => (host, src, cell) => {
  const pen = host.getContext('2d'), cellH = Math.round(cell * 2), cellW = Math.max(2, Math.round(cellH * 0.6));
  const columns = Math.floor(host.width / cellW), rows = Math.floor(host.height / cellH);
  const atlas = atlasFor(' .,:;*!/<[j7Jy23A#0DRNB@%#*+=-:. $&8BWMoahkbdpqwmZO0QLCJUYXzcvunxrjft\\|()1{}[]?-_+~<>i!lI;:,"^`\'@#S08Xx', cellW, cellH);
  let previous = null;
  return { ready: Promise.resolve(), frame() {
    const lines = convert(src.canvas, columns, rows, previous, g => { previous = g; });
    pen.fillStyle = '#000'; pen.fillRect(0, 0, host.width, host.height);
    for (let r = 0; r < lines.length; r++) { const line = lines[r]; for (let c = 0; c < line.length; c++) { const ch = line[c]; if (ch === ' ') continue; const x = atlas.at.get(ch); if (x !== undefined) pen.drawImage(atlas.canvas, x, 0, cellW, cellH, c * cellW, r * cellH, cellW, cellH); } }
  }, destroy() {} };
};
const LIVE_TEXT = {
  'ASCII Magic (rebuilt): convert + draw': textOnScreen((frame, columns, rows) => TEXT_RENDERERS['ASCII Magic (characters)'](frame, columns, rows)),
  'Devault Classic (rebuilt): convert only, draw not counted': (host, src, cell) => {
    const cellH = Math.round(cell * 2), cellW = Math.max(2, Math.round(cellH * 0.6)), columns = Math.floor(host.width / cellW), rows = Math.floor(host.height / cellH);
    return { ready: Promise.resolve(), frame() { TEXT_RENDERERS['Devault ASCII generator (Classic)'](src.canvas, columns, rows); }, destroy() {} };
  },
  'asciify imageToAsciiGrid shape (video): convert + draw': textOnScreen((frame, columns, rows, previous, keep) => { const g = imageToAsciiGrid(frame, { columns, rows, dither: 'ordered', previous }); keep(g); return g.lines; }),
  'asciify imageToAsciiGrid tone (video): convert + draw': textOnScreen((frame, columns, rows, previous, keep) => { const g = imageToAsciiGrid(frame, { columns, rows, mode: 'tone', dither: 'ordered', previous }); keep(g); return g.lines; }),
  'asciify GPU field, shape + bloom + fluid hover': (host, src, cell) => {
    const field = mountGlyphField(host, { source: src.canvas, live: true, cellSize: cell, cellAspect: 0.6, charset: FIELD_PHOTO_CHARSET, glyphScale: 1, sample: 'shape', hover: 'fluid', post: { bloom: 0.8 }, maxPixelRatio: 2, drift: 0 });
    let k = 0;
    return { drawsItself: true, ready: field.ready, frame() { const r = host.getBoundingClientRect(); k++; field.pointer(r.width * (.5 + .4 * Math.cos(k / 6)), r.height * (.5 + .4 * Math.sin(k / 5))); }, destroy() { field.destroy(); } };
  },
};

export const RENDERERS = {
  ...LIVE_TEXT,
  'asciify-engine field (fluid hover, photo charset)': (host, src, cell) => {
    const field = mountGlyphField(host, { source: src.canvas, live: true, cellSize: cell, cellAspect: 0.6, charset: FIELD_PHOTO_CHARSET, glyphScale: 1, hover: 'fluid', maxPixelRatio: 2, drift: 0 });
    let k = 0;
    // The field draws a live source itself, once per animation frame; the harness only moves the pointer.
    return { drawsItself: true, ready: field.ready, frame() { const r = host.getBoundingClientRect(); k++; field.pointer(r.width * (.5 + .4 * Math.cos(k / 6)), r.height * (.5 + .4 * Math.sin(k / 5))); }, destroy() { field.destroy(); } };
  },
  'asciify-engine field (fluid hover, subject scope)': (host, src, cell) => {
    const field = mountGlyphField(host, { source: src.canvas, live: true, cellSize: cell, cellAspect: 0.6, charset: FIELD_PHOTO_CHARSET, glyphScale: 1, hover: 'fluid', scope: 'subject', maxPixelRatio: 2, drift: 0 });
    let k = 0;
    return { drawsItself: true, ready: field.ready, frame() { const r = host.getBoundingClientRect(); k++; field.pointer(r.width * (.5 + .4 * Math.cos(k / 6)), r.height * (.5 + .4 * Math.sin(k / 5))); }, destroy() { field.destroy(); } };
  },
  'asciify-engine field (shape sampling, fluid hover)': (host, src, cell) => {
    const field = mountGlyphField(host, { source: src.canvas, live: true, cellSize: cell, cellAspect: 0.6, charset: FIELD_PHOTO_CHARSET, glyphScale: 1, sample: 'shape', hover: 'fluid', maxPixelRatio: 2, drift: 0 });
    let k = 0;
    return { drawsItself: true, ready: field.ready, frame() { const r = host.getBoundingClientRect(); k++; field.pointer(r.width * (.5 + .4 * Math.cos(k / 6)), r.height * (.5 + .4 * Math.sin(k / 5))); }, destroy() { field.destroy(); } };
  },
  'asciify-engine field (no hover)': (host, src, cell) => {
    const field = mountGlyphField(host, { source: src.canvas, live: true, cellSize: cell, cellAspect: 0.6, charset: FIELD_PHOTO_CHARSET, glyphScale: 1, hover: 'none', maxPixelRatio: 2, drift: 0 });
    return { drawsItself: true, ready: field.ready, frame() {}, destroy() { field.destroy(); } };
  },
  'asciify-engine field (fluid hover, own context)': (host, src, cell) => {
    host.getContext('webgl2', { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true });
    const field = mountGlyphField(host, { source: src.canvas, live: true, cellSize: cell, cellAspect: 0.6, charset: FIELD_PHOTO_CHARSET, glyphScale: 1, hover: 'fluid', maxPixelRatio: 2, drift: 0 });
    let k = 0;
    return { drawsItself: true, ready: field.ready, frame() { const r = host.getBoundingClientRect(); k++; field.pointer(r.width * (.5 + .4 * Math.cos(k / 6)), r.height * (.5 + .4 * Math.sin(k / 5))); }, destroy() { field.destroy(); } };
  },
  'idle (source repainted, nothing drawn)': () => ({ ready: Promise.resolve(), frame() {}, destroy() {} }),
  '2025.unseen.co ASCII pass (rebuilt)': (host, src, cell) => {
    const w = host.width, h = host.height, gl = host.getContext('webgl2', { preserveDrawingBuffer: true });
    const atlas = document.createElement('canvas'); atlas.width = atlas.height = 1024;
    const a = atlas.getContext('2d'), chars = ' .,-+=*UNSEEN2025';
    a.font = '56px arial'; a.textAlign = 'center'; a.textBaseline = 'middle'; a.fillStyle = '#fff';
    for (let i = 0; i < chars.length; i++) a.fillText(chars[i], (i % 16) * 64 + 32, Math.floor(i / 16) * 64 + 32);
    const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); return x; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, `#version 300 es
      out vec2 vUv; void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); vUv = p; gl_Position = vec4(p * 2. - 1., 0., 1.); }`));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float; in vec2 vUv; out vec4 o; uniform sampler2D tDiffuse, uCharacters; uniform float uCharactersCount, uCellSize; uniform vec2 uResolutionNoDpr;
      const vec2 SIZE = vec2(16.);
      void main(){ vec2 cell = uResolutionNoDpr / uCellSize; vec2 grid = 1.0 / cell; vec2 puv = grid * (0.5 + floor(vUv / grid));
        float g = dot(texture(tDiffuse, puv).rgb, vec3(0.299, 0.587, 0.114)); float ci = floor((uCharactersCount - 1.0) * g);
        vec2 cp = vec2(mod(ci, SIZE.x), floor(ci / SIZE.y)); vec2 off = vec2(cp.x, -cp.y) / SIZE;
        vec2 cuv = mod(vUv * (cell / SIZE), 1.0 / SIZE) - vec2(0., 1.0 / SIZE) + off; o = vec4(vec3(texture(uCharacters, cuv).r), 1.); }`));
    gl.linkProgram(prog); gl.useProgram(prog);
    const mk = (unit, wrap) => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap); return t; };
    const srcTex = mk(0, gl.CLAMP_TO_EDGE); mk(1, gl.REPEAT); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
    const u = n => gl.getUniformLocation(prog, n);
    gl.uniform1i(u('tDiffuse'), 0); gl.uniform1i(u('uCharacters'), 1); gl.uniform1f(u('uCharactersCount'), chars.length); gl.uniform1f(u('uCellSize'), cell); gl.uniform2f(u('uResolutionNoDpr'), w, h);
    return { ready: Promise.resolve(), frame() { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src.canvas); gl.viewport(0, 0, w, h); gl.drawArrays(gl.TRIANGLES, 0, 3); }, destroy() { gl.getExtension('WEBGL_lose_context')?.loseContext(); } };
  },
  'webgl-ascii-hero (vendored)': (host, src, cell) => {
    const renderer = new THREE.WebGLRenderer({ canvas: host, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setSize(host.width, host.height, false);
    const texture = new THREE.CanvasTexture(src.canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter;
    const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: texture })));
    const composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera));
    const atlas = heroGlyphs(HERO_SYMBOLS);
    composer.addPass(new EffectPass(camera, new HeroAscii({ cellSize: cell * 2, color: true, invert: false, tintColor: new THREE.Vector3(1, 1, 1), resolution: new THREE.Vector2(host.width, host.height), glyphAtlas: atlas, glyphTiles: HERO_SYMBOLS.length })));
    return { ready: Promise.resolve(), frame() { texture.needsUpdate = true; composer.render(1 / 60); }, destroy() { composer.dispose(); renderer.dispose(); } };
  },
};

/** Times `frames` frames of a renderer: main-thread ms (the JS it runs per frame) and total ms (until the GPU has finished). */
export async function measure(name, { width, height, cell, frames = 12 }) {
  const host = document.createElement('canvas');
  host.width = width; host.height = height; host.style.cssText = `position:fixed;left:0;top:0;width:${width / 2}px;height:${height / 2}px`;
  document.body.appendChild(host);
  const src = liveSource(width, height);
  const r = RENDERERS[name](host, src, cell);
  await r.ready;
  // One animation frame each: the source repaints, every renderer draws once in that frame (the field from its own frame loop,
  // the others from frame()), then the result is read back, which waits for the GPU. An idle frame is timed the same way and
  // taken off, so what is left is the renderer's cost. Main-thread time is everything on the main thread in that frame.
  const tick = async draw => { const t0 = performance.now(); src.paint(); rafMs = 0;
    await new Promise(res => nativeRaf(() => { const a = performance.now(); draw(); rafMs += performance.now() - a; setTimeout(res, 0); }));
    const main = rafMs; sync(host); return { total: performance.now() - t0, main }; };
  for (let i = 0; i < 4; i++) await tick(() => r.frame());
  const main = [], total = [], idle = [];
  for (let i = 0; i < frames; i++) {
    const f = await tick(() => r.frame()); main.push(f.main); total.push(f.total);
  }
  r.destroy();
  for (let i = 0; i < 6; i++) idle.push((await tick(() => {})).total);
  host.remove();
  const median = a => +a.sort((x, y) => x - y)[Math.floor(a.length / 2)].toFixed(2);
  return { name, width, height, cell, mainMs: median([...main]), mainMaxMs: +Math.max(...main).toFixed(1), totalMs: +(median(total) - median(idle)).toFixed(1) };
}

/**
 * Runs a renderer in a steady state for screen.mjs: a driver at the display's rate repaints the source (marked 'bench', so its
 * cost can be taken off) and calls frame(); the renderer draws as it would on a page. Warms up, then marks 'steady-start' and
 * 'steady-end' around `seconds` of frames and returns how many frames ran in between.
 */
export async function steady(name, { width, height, cell, warm = 1500, seconds = 4 }) {
  // Full size at a device pixel ratio of 1: every renderer draws width x height pixels.
  const host = document.createElement('canvas');
  host.width = width; host.height = height; host.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px`;
  document.body.appendChild(host);
  const src = liveSource(width, height);
  const r = RENDERERS[name](host, src, cell);
  await r.ready;
  let frames = 0, running = true;
  // The driver stands in for the page's video: it repaints the source and schedules itself, all taken off as 'bench'. A
  // renderer that draws itself (a field, from its own frame loop) gets frame() for its pointer here; any other is called
  // from a loop of its own, as a page would run it, so every renderer pays for one animation frame a frame.
  const selfDrawn = !!r.drawsItself;
  const driver = () => {
    if (!running) return;
    performance.mark('bench-paint');
    src.paint();
    frames++;
    nativeRaf(driver);
    performance.measure('bench', 'bench-paint');
    if (selfDrawn) r.frame();
  };
  nativeRaf(driver);
  if (!selfDrawn) { const page = () => { if (!running) return; r.frame(); nativeRaf(page); }; nativeRaf(page); }
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  await wait(warm);
  performance.mark('steady-start');
  const first = frames;
  await wait(seconds * 1000);
  performance.mark('steady-end');
  const count = frames - first;
  running = false;
  await wait(50);
  r.destroy(); host.remove();
  return count;
}

Object.assign(window, { perf: { measure, steady, RENDERERS: Object.keys(RENDERERS) } });
