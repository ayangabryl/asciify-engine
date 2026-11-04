// Runs in the benchmark page (bundled by compare.mjs). Each renderer turns the same picture into the same grid of characters;
// text output is drawn back in one font, pixel output is taken as the renderer drew it, and both are scored against the
// picture the same way.
import * as THREE from 'three';
import { AsciiEffect } from 'three/examples/jsm/effects/AsciiEffect.js';
import { EffectComposer, RenderPass, EffectPass, ASCIIEffect, ASCIITexture } from 'postprocessing';
import { Asciify as SisterAsciify } from '@sister.software/asciify';
import * as aaModule from 'aalib.js/lib/aa.js';
import * as htmlRendererModule from 'aalib.js/lib/renderers/HTMLRenderer.js';
import * as aaImageModule from 'aalib.js/lib/core/AAImage.js';
const AAImage = aaImageModule.default?.default ?? aaImageModule.default;
const aaFactory = aaModule.default?.default ?? aaModule.default ?? aaModule;
const HTMLRenderer = htmlRendererModule.HTMLRenderer ?? htmlRendererModule.default?.HTMLRenderer;
import { toAsciiGrid } from '../src/headless.ts';
import { drawing as asciiRestDrawing } from 'ascii.rest/kit';
import { tuneHeadless } from '../src/headless/grid.ts';
import { asciiText } from '../src/core.ts';
import { mountGlyphField } from '../src/field.ts';

const FONT = '"DejaVu Sans Mono"';
const FONT_SIZE = 12;
export const CELL_ASPECT = 1.9306; // matches the font's box, so every renderer is given the same grid shape

// ---------- pictures ----------
export async function loadPicture(url, width = 960) {
  const img = new Image(); img.src = url; await img.decode();
  const c = document.createElement('canvas'); c.width = width; c.height = Math.round(width * img.naturalHeight / img.naturalWidth);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}
export function syntheticLines(width = 960) {
  const c = document.createElement('canvas'); c.width = width; c.height = Math.round(width * 0.625);
  const g = c.getContext('2d'), s = width / 640;
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); g.strokeStyle = '#fff'; g.lineWidth = 2 * s;
  for (const [x1, y1, x2, y2] of [[20, 20, 200, 380], [220, 380, 400, 20], [420, 200, 620, 200], [520, 20, 520, 380], [20, 200, 180, 240]]) { g.beginPath(); g.moveTo(x1 * s, y1 * s); g.lineTo(x2 * s, y2 * s); g.stroke(); }
  g.beginPath(); g.arc(320 * s, 200 * s, 90 * s, 0, Math.PI * 2); g.stroke();
  const grd = g.createLinearGradient(420 * s, 0, 620 * s, 0); grd.addColorStop(0, '#000'); grd.addColorStop(1, '#fff'); g.fillStyle = grd; g.fillRect(420 * s, 250 * s, 200 * s, 120 * s);
  g.font = `bold ${64 * s}px sans-serif`; g.fillStyle = '#fff'; g.fillText('ASCII', 230 * s, 380 * s);
  return c;
}
export function syntheticText(width = 960) {
  const c = document.createElement('canvas'); c.width = width; c.height = Math.round(width * 0.5);
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.textAlign = 'center';
  g.font = `600 ${width * 0.16}px sans-serif`; g.fillText('Hello', width / 2, c.height * 0.36);
  g.font = `400 ${width * 0.07}px sans-serif`; g.fillText('characters that belong', width / 2, c.height * 0.74);
  return c;
}

export const gridRows = (picture, columns) => Math.max(1, Math.round(columns * (picture.height / picture.width) / CELL_ASPECT));
const pixelsOf = canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
const resized = (source, w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(source, 0, 0, w, h); return c; };

// ---------- text renderers: each returns rows of characters, bright = dense (light characters on a dark ground) ----------
export const TEXT_RENDERERS = {
  // What a coding agent writes in a few minutes: average each cell, index a ramp.
  'naive ramp (agent baseline)': (picture, columns, rows) => {
    const small = resized(picture, columns, rows), { data } = pixelsOf(small), ramp = ' .:-=+*#%@', out = [];
    for (let r = 0; r < rows; r++) { let line = ''; for (let c = 0; c < columns; c++) { const i = (r * columns + c) * 4; const l = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255; line += ramp[Math.min(ramp.length - 1, Math.floor(l * ramp.length))]; } out.push(line); }
    return out;
  },
  'three.js AsciiEffect': (picture, columns, rows) => {
    // The real effect, reading a WebGL renderer that shows the picture full frame. It samples every other pixel row, so it is
    // sized for 2 × rows sample rows; `invert` makes bright parts dense, matching a dark ground.
    const W = 960, res = columns / W, H = Math.round((rows * 2) / res);
    const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
    renderer.setSize(W, H, false);
    const texture = new THREE.CanvasTexture(picture); texture.colorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: texture })));
    const effect = new AsciiEffect(renderer, ' .:-=+*#%@', { resolution: res, invert: true });
    effect.setSize(W, H);
    effect.render(scene, camera);
    const html = effect.domElement.querySelector('td').innerHTML;
    renderer.dispose();
    return html.split('<br>').filter((_, i, a) => i < a.length - 1 || _).map(line => line.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')).slice(0, rows).map(l => l.padEnd(columns).slice(0, columns));
  },
  'aalib.js': (picture, columns, rows) => {
    // aalib matches characters for dark ink on a white page; inverting the picture first (its own `inverse` filter does the
    // same) gives light characters on a dark ground, like every other renderer here.
    const { data, width, height } = pixelsOf(picture);
    const inverted = new Uint8ClampedArray(data); for (let i = 0; i < inverted.length; i += 4) { inverted[i] = 255 - inverted[i]; inverted[i + 1] = 255 - inverted[i + 1]; inverted[i + 2] = 255 - inverted[i + 2]; }
    const image = aaFactory({ width: columns, height: rows })(AAImage.fromImageData({ width, height, data: inverted }));
    const renderer = new HTMLRenderer({ el: document.createElement('pre'), fontFamily: 'DejaVu Sans Mono' });
    renderer.processImage(image);
    const out = [];
    for (let r = 0; r < rows; r++) { let line = ''; for (let c = 0; c < columns; c++) line += image.data[r * columns + c].char; out.push(line); }
    return out;
  },
  // ascii.rest (sponsored by Cloudflare): its own image drawing, in its two styles for pictures. It trims an image to its ink
  // and adds a margin of 2 columns and 1 row; with the background kept and the margin cut off, it covers the whole picture.
  // It sizes the grid itself from `width` (columns, margin included) and its own cell shape, so its rows may differ slightly.
  ...Object.fromEntries(['logo', 'shade'].map(style => [`ascii.rest (${style})`, (picture, columns, rows) => {
    const { data, width, height } = pixelsOf(picture);
    // Its default: a plain ground (the black of the line and type images) is taken out and the drawing trimmed to the ink,
    // so it is scored against the same trimmed part of the picture.
    const d = asciiRestDrawing(data, width, height, { width: columns + 4, height: Math.min(120, rows + 2), style, color: false, invert: false });
    const art = d.art.slice(1, -1).map(line => line.slice(2, -2));
    if (d.ground) {
      const g = [1, 3, 5].map(i => parseInt(d.ground.slice(i, i + 2), 16));
      let x0 = width, y0 = height, x1 = -1, y1 = -1;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (Math.abs(data[i] - g[0]) + Math.abs(data[i + 1] - g[1]) + Math.abs(data[i + 2] - g[2]) > 48) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      }
      if (x1 >= x0) window.lastCrop = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    }
    return art;
  }])),
  'asciify-engine core asciiText (4.32)': (picture, columns, rows) => {
    const fontSize = 10, charAspect = 1 / CELL_ASPECT;
    return asciiText(picture, { fontSize, charAspect, charSpacing: 1 }, columns * fontSize, Math.round(rows * fontSize / charAspect)).split('\n').slice(0, rows).map(l => l.padEnd(columns).slice(0, columns));
  },
  'asciify-engine headless, tone': (picture, columns, rows) => { tuneHeadless(window.tune?.internal ?? {}); return toAsciiGrid(pixelsOf(picture), { columns, rows, mode: 'tone', charset: ' .:-=+*#%@', ...(window.tune?.options ?? {}) }).lines; },
  // For video: ordered dither, and each frame given the one before (in a sequence; a single picture has none).
  'asciify-engine headless, shape (video settings)': Object.assign((picture, columns, rows, previous) => { tuneHeadless(window.tune?.internal ?? {}); const grid = toAsciiGrid(pixelsOf(picture), { columns, rows, dither: 'ordered', previous }); window.lastGrid = grid; return grid.lines; }, { sequence: true }),
  'asciify-engine headless, shape': (picture, columns, rows) => { tuneHeadless(window.tune?.internal ?? {}); return toAsciiGrid(pixelsOf(picture), { columns, rows, ...(window.tune?.options ?? {}) }).lines; },
};

// ---------- drawing text back, in one font, at the same grid ----------
let metrics;
export async function fontMetrics() {
  if (metrics) return metrics;
  await document.fonts.load(`${FONT_SIZE}px ${FONT}`);
  const m = document.createElement('canvas').getContext('2d'); m.font = `${FONT_SIZE}px ${FONT}`;
  const t = m.measureText('M');
  return (metrics = { cw: t.width, ch: t.fontBoundingBoxAscent + t.fontBoundingBoxDescent, ascent: t.fontBoundingBoxAscent });
}
export async function drawText(lines) {
  const { cw, ch, ascent } = await fontMetrics();
  const c = document.createElement('canvas'); c.width = Math.round(cw * lines[0].length); c.height = Math.round(ch * lines.length);
  const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  g.font = `${FONT_SIZE}px ${FONT}`; g.fillStyle = '#fff';
  lines.forEach((line, r) => { for (let i = 0; i < line.length; i++) if (line[i] !== ' ') g.fillText(line[i], i * cw, r * ch + ascent); });
  return c;
}

// ---------- pixel renderers: each draws the picture as characters into a canvas of the given size ----------
export const PIXEL_RENDERERS = {
  'postprocessing ASCIIEffect': async (picture, w, h, columns) => {
    const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
    renderer.setSize(w, h, false);
    const texture = new THREE.CanvasTexture(picture); texture.colorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: texture })));
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new EffectPass(camera, new ASCIIEffect({ cellSize: w / columns, asciiTexture: new ASCIITexture({ characters: ' .:-=+*#%@', fontFamily: 'DejaVu Sans Mono' }) })));
    composer.render();
    const out = resized(renderer.domElement, w, h);
    composer.dispose(); renderer.dispose();
    return out;
  },
  // Not text: it fills each cell with a block and cuts the glyph out of it (XOR), a mosaic of filled cells.
  '@sister.software/asciify (block mosaic)': async (picture, w, h, columns) => {
    // Its cells are square, fontSize px each; it sizes itself from the canvas's layout box, so the canvas is put on the page.
    const out = document.createElement('canvas'); out.style.cssText = `display:block;width:${w}px;height:${h}px;position:fixed;left:0;top:0`;
    document.body.appendChild(out);
    const a = new SisterAsciify(out, { fontSize: w / columns, characterSet: ' .:-=+*#%@'.split(''), colorize: false, fontFamily: 'DejaVu Sans Mono', pixelRatio: 1 });
    a.setSize(w, h);
    await a.rasterizeImage(picture);
    const copy = resized(out, w, h); out.remove();
    return copy;
  },
  'asciify-engine glyph field (GPU)': async (picture, w, h, columns) => {
    const host = document.createElement('canvas'); host.style.cssText = `display:block;width:${w}px;height:${h}px;position:fixed;left:0;top:0`;
    document.body.appendChild(host);
    const field = mountGlyphField(host, { source: picture, hover: 'none', cellSize: (w / columns) * CELL_ASPECT, cellAspect: 1 / CELL_ASPECT, maxPixelRatio: 1, ink: '#ffffff', drift: 0, scene: 'none', font: 'DejaVu Sans Mono' });
    await field.ready; field.redraw();
    const out = resized(host, w, h);
    field.destroy(); host.remove();
    return out;
  },
};

// ---------- scoring ----------
// Luminance as displayed (0–1), blurred to a viewing scale, then SSIM with an 11-tap Gaussian window (σ 1.5).
const LIN = new Float32Array(256); for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
const toPerceptual = v => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
// Luminance as light (linear) or as pixel values (sRGB-encoded).
function luminance(img, linear) {
  const d = img.data, out = new Float32Array(img.width * img.height);
  for (let i = 0; i < out.length; i++) out[i] = linear ? 0.2126 * LIN[d[i * 4]] + 0.7152 * LIN[d[i * 4 + 1]] + 0.0722 * LIN[d[i * 4 + 2]] : (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
  return out;
}
function blur(src, w, h, sigma) {
  const r = Math.max(1, Math.ceil(sigma * 3)), k = new Float32Array(r * 2 + 1); let s = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); s += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0; for (let i = -r; i <= r; i++) a += src[y * w + Math.min(w - 1, Math.max(0, x + i))] * k[i + r]; tmp[y * w + x] = a; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let a = 0; for (let i = -r; i <= r; i++) a += tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x] * k[i + r]; out[y * w + x] = a; }
  return out;
}
function ssim(a, b, w, h) {
  const C1 = 0.01 ** 2, C2 = 0.03 ** 2, mul = (p, q) => p.map((v, i) => v * q[i]);
  const ma = blur(a, w, h, 1.5), mb = blur(b, w, h, 1.5);
  const saa = blur(mul(a, a), w, h, 1.5), sbb = blur(mul(b, b), w, h, 1.5), sab = blur(mul(a, b), w, h, 1.5);
  let total = 0;
  for (let i = 0; i < a.length; i++) {
    const va = saa[i] - ma[i] * ma[i], vb = sbb[i] - mb[i] * mb[i], cov = sab[i] - ma[i] * mb[i];
    total += ((2 * ma[i] * mb[i] + C1) * (2 * cov + C2)) / ((ma[i] * ma[i] + mb[i] * mb[i] + C1) * (va + vb + C2));
  }
  return total / a.length;
}
/**
 * Scores a rendering against the picture at two viewing scales, close (detail) and far (overall form). The blur that stands
 * for viewing distance averages light, as the eye does (linear), then SSIM compares the results as seen (sRGB-encoded). The
 * `*Code` scores blur pixel values instead, which favours renderers that ignore how screens emit light; both are reported.
 */
export async function score(rendered, picture) {
  const { cw } = await fontMetrics();
  const ref = pixelsOf(resized(picture, rendered.width, rendered.height)), img = pixelsOf(rendered);
  // Both are averaged down 2×2 first (in their own units): the viewing blur removes anything finer anyway.
  const half = (v, w0, h0) => { const w = w0 >> 1, h = h0 >> 1, o = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = 2 * y * w0 + 2 * x; o[y * w + x] = (v[i] + v[i + 1] + v[i + w0] + v[i + w0 + 1]) / 4; } return o; };
  const w = rendered.width >> 1, h = rendered.height >> 1, W0 = rendered.width, H0 = rendered.height;
  const result = {};
  const srcL = half(luminance(ref, true), W0, H0), outL = half(luminance(img, true), W0, H0), srcC = half(luminance(ref, false), W0, H0), outC = half(luminance(img, false), W0, H0);
  for (const [name, sigma] of [['close', cw * 0.25], ['far', cw * 0.75]]) {
    const seen = v => v.map(toPerceptual);
    result[name] = +ssim(seen(blur(outL, w, h, sigma)), seen(blur(srcL, w, h, sigma)), w, h).toFixed(4);
    result[`${name}Code`] = +ssim(blur(outC, w, h, sigma), blur(srcC, w, h, sigma), w, h).toFixed(4);
  }
  return result;
}

// ---------- temporal stability: a slow pan, and how many cells change per frame ----------
export function panFrames(picture, frames = 24, columns = 100) {
  const cropW = Math.round(picture.width * 0.8), stepPx = (picture.width / columns) * 0.15;
  return Array.from({ length: frames }, (_, i) => { const c = document.createElement('canvas'); c.width = cropW; c.height = picture.height; c.getContext('2d').drawImage(picture, -i * stepPx, 0); return c; });
}
export function churn(sequence) {
  let changed = 0, total = 0;
  for (let f = 1; f < sequence.length; f++) for (let r = 0; r < sequence[f].length; r++) for (let c = 0; c < sequence[f][r].length; c++) { total++; if (sequence[f][r][c] !== sequence[f - 1][r][c]) changed++; }
  return +(changed * 100 / Math.max(1, total)).toFixed(2);
}

// ---------- speed ----------
export function timeIt(fn, runs = 7) {
  fn();
  const times = [];
  for (let i = 0; i < runs; i++) { const t = performance.now(); fn(); times.push(performance.now() - t); }
  return +times.sort((a, b) => a - b)[Math.floor(runs / 2)].toFixed(2);
}

export function cropped(picture, c) { const out = document.createElement('canvas'); out.width = c.w; out.height = c.h; out.getContext('2d').drawImage(picture, c.x, c.y, c.w, c.h, 0, 0, c.w, c.h); return out; }

Object.assign(window, { bench: { cropped, loadPicture, syntheticLines, syntheticText, gridRows, TEXT_RENDERERS, PIXEL_RENDERERS, drawText, score, panFrames, churn, timeIt, fontMetrics, CELL_ASPECT } });
