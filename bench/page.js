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
import { mountGlyphField, FIELD_PHOTO_CHARSET } from '../src/field.ts';
// webgl-ascii-hero's effect (vendor/, unchanged); compare.mjs's build exposes its class and glyph atlas.
import { AsciiEffectImpl as HeroAscii, createGlyphTexture as heroGlyphs, TERMINAL_SYMBOLS as HERO_SYMBOLS } from './vendor/webgl-ascii-hero/ascii-effect.tsx';

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
// ---------- ASCII generators people use: rebuilt from the code their sites ship (November 2026) ----------
// Halving steps with high-quality smoothing down to the grid, as devault-ascii.pages.dev's analyzer samples a picture.
const halved = (source, w, h) => {
  let img = source, iw = source.width, ih = source.height;
  while (iw > w * 2 && ih > h * 2) { const nw = Math.max(w, Math.ceil(iw / 2)), nh = Math.max(h, Math.ceil(ih / 2)); img = resized(img, nw, nh); iw = nw; ih = nh; }
  return resized(img, w, h);
};
// Devault's edge finder (its edge worker): a structure tensor over the blurred RGB picture, coherent edges kept, thinned to
// their ridge, then for each cell the strongest edge and its direction (0 '-', 1 '/', 2 '|', 3 '\').
function devaultEdges(rgba, w, h, cols, rows, smooth) {
  const n = w * h, strength = new Float32Array(cols * rows), dir = new Uint8Array(cols * rows);
  const blurH = (src, dst) => { for (let y = 0; y < h; y++) { const r = y * w; for (let x = 0; x < w; x++) { const a = x > 1 ? x - 2 : 0, b = x > 0 ? x - 1 : 0, c = x < w - 1 ? x + 1 : w - 1, d = x < w - 2 ? x + 2 : w - 1; dst[r + x] = (src[r + a] + 4 * src[r + b] + 6 * src[r + x] + 4 * src[r + c] + src[r + d]) / 16; } } };
  const blurV = (src, dst) => { for (let y = 0; y < h; y++) { const a = (y > 1 ? y - 2 : 0) * w, b = (y > 0 ? y - 1 : 0) * w, r = y * w, c = (y < h - 1 ? y + 1 : h - 1) * w, d = (y < h - 2 ? y + 2 : h - 1) * w; for (let x = 0; x < w; x++) dst[r + x] = (src[a + x] + 4 * src[b + x] + 6 * src[r + x] + 4 * src[c + x] + src[d + x]) / 16; } };
  const tmp = new Float32Array(n), blur = (a, times) => { for (let i = 0; i < times; i++) { blurH(a, tmp); blurV(tmp, a); } };
  if (w < 5 || h < 5) return { strength, dir };
  const ch = [0, 1, 2].map(k => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = rgba[i * 4 + k] / 255; return a; });
  const passes = 1 + Math.round(Math.min(1, Math.max(0, smooth)) * 2);
  ch.forEach(a => blur(a, passes));
  const xx = new Float32Array(n), yy = new Float32Array(n), xy = new Float32Array(n);
  for (const e of ch) for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = e[i - w + 1] + 2 * e[i + 1] + e[i + w + 1] - (e[i - w - 1] + 2 * e[i - 1] + e[i + w - 1]);
    const gy = e[i + w - 1] + 2 * e[i + w] + e[i + w + 1] - (e[i - w - 1] + 2 * e[i - w] + e[i - w + 1]);
    xx[i] += gx * gx; yy[i] += gy * gy; xy[i] += gx * gy;
  }
  blur(xx, 2); blur(yy, 2); blur(xy, 2);
  const s = new Float32Array(n), cos2 = new Float32Array(n), sin2 = new Float32Array(n);
  const step = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a + 1e-9))); return t * t * (3 - 2 * t); };
  let top = 0;
  for (let i = 0; i < n; i++) {
    const a = xx[i], b = yy[i], c = xy[i], d = Math.sqrt((a - b) * (a - b) + 4 * c * c), l1 = (a + b + d) / 2, l2 = (a + b - d) / 2;
    s[i] = Math.sqrt(Math.max(0, l1)) * step(0.15, 0.65, (l1 - l2) / (l1 + l2 + 1e-9));
    if (s[i] > top) top = s[i];
    if (d > 1e-9) { cos2[i] = (a - b) / d; sin2[i] = 2 * c / d; }
  }
  if (top < 1e-6) return { strength, dir };
  const hist = new Uint32Array(512); for (let i = 0; i < n; i++) hist[Math.min(511, Math.floor(s[i] / top * 512))]++;
  const pct = q => { let seen = 0; for (let b = 0; b < 512; b++) { seen += hist[b]; if (seen >= q * n) return (b + 1) / 512 * top; } return top; };
  const hi = pct(0.992), lo = Math.max(pct(0.8), 0.15 * hi);
  if (hi - lo < 1e-6) return { strength, dir };
  for (let i = 0; i < n; i++) s[i] = Math.min(1, Math.max(0, (s[i] - lo) / (hi - lo)));
  const ridge = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, v = s[i]; if (v <= 0) continue;
    const c = Math.sqrt((1 + cos2[i]) / 2), sn = (sin2[i] >= 0 ? 1 : -1) * Math.sqrt((1 - cos2[i]) / 2);
    let a, b;
    if (Math.abs(sn) < 0.3827) { a = i - 1; b = i + 1; } else if (Math.abs(sn) > 0.9239) { a = i - w; b = i + w; } else if (sn * c > 0) { a = i - w - 1; b = i + w + 1; } else { a = i - w + 1; b = i + w - 1; }
    if (v >= s[a] && v >= s[b]) ridge[i] = v;
  }
  const cw = w / cols, chh = h / rows;
  for (let r = 0; r < rows; r++) { const y0 = Math.floor(r * chh), y1 = Math.min(h, Math.floor((r + 1) * chh));
    for (let c = 0; c < cols; c++) { const x0 = Math.floor(c * cw), x1 = Math.min(w, Math.floor((c + 1) * cw)); let best = 0, dx = 0, dy = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * w + x, v = ridge[i]; if (v <= 0) continue; if (v > best) best = v; dx -= v * cos2[i]; dy -= v * sin2[i]; }
      const k = r * cols + c; strength[k] = best;
      if (best > 0) { const deg = 0.5 * Math.atan2(dy, dx) * 180 / Math.PI, m = Math.abs(deg); dir[k] = m < 22.5 ? 0 : m >= 67.5 ? 2 : deg > 0 ? 3 : 1; } } }
  return { strength, dir };
}
// Devault's Classic (and Detailed) style with its defaults: auto levels at the 1st and 99th percentiles, a cutoff of 6 %, and
// edges on at strength 55: a strong edge takes '-', '/', '|' or '\' and every edge lifts the cell.
const devault = ramp => (picture, columns, rows) => {
  const { data } = pixelsOf(halved(picture, columns, rows)), n = columns * rows, luma = new Float32Array(n), hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) { const l = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) / 255; luma[i] = l; hist[Math.min(255, l * 255 | 0)]++; }
  const at = q => { let seen = 0; for (let v = 0; v < 256; v++) { seen += hist[v]; if (seen >= q * n) return v / 255; } return 1; };
  let lo = at(0.01), hi = at(0.99); if (hi - lo < 0.08) { const m = (hi + lo) / 2; lo = Math.max(0, m - 0.04); hi = Math.min(1, m + 0.04); }
  // Devault sizes its edge picture from the cell shape (width over height): up to three samples a cell across, as many more down.
  const aspect = (rows * picture.width) / (columns * picture.height);
  const o = 1 / aspect, k = Math.max(1, Math.min(3, Math.floor(Math.sqrt(5e5 / (columns * rows * o))))), ew = columns * k, eh = rows * Math.max(1, Math.round(k * o));
  const edges = devaultEdges(pixelsOf(halved(picture, ew, eh)).data, ew, eh, columns, rows, 0.4);
  const glyphs = ['-', '/', '|', '\\'], out = [];
  for (let r = 0; r < rows; r++) { let line = '';
    for (let c = 0; c < columns; c++) { const i = r * columns + c; let a = Math.min(1, Math.max(0, (luma[i] - lo) / Math.max(1e-4, hi - lo)));
      const v = Math.min(1, edges.strength[i] * 1.1); let edge = -1;
      if (v > 0.05) { if (v > 0.3) { edge = edges.dir[i]; a = Math.max(a, 0.55 + 0.45 * v); } else a = Math.max(a, v * 0.9); }
      if (edge >= 0) { line += glyphs[edge]; continue; }
      if (a < 0.06) { line += ' '; continue; }
      line += ramp[Math.min(ramp.length - 1, Math.floor((1 - a) * ramp.length))];
    }
    out.push(line); }
  return out;
};

export const TEXT_RENDERERS = {
  // devault-ascii.pages.dev's generator, Classic style (its default) and Detailed, as it ships them, in one ink.
  'Devault ASCII generator (Classic)': devault('@%#*+=-:. '),
  'Devault ASCII generator (Detailed)': devault('$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,"^`\'. '),
  // ascii-magic.com's Characters mode with its defaults: the picture drawn down to the grid, each cell's brightness set
  // between the picture's darkest and lightest, cells under its dark threshold (30) left empty, then '@#S08Xx+=-;:. '.
  'ASCII Magic (characters)': (picture, columns, rows) => {
    const { data } = pixelsOf((() => { const c = document.createElement('canvas'); c.width = columns; c.height = rows; c.getContext('2d').drawImage(picture, 0, 0, columns, rows); return c; })());
    const ramp = '@#S08Xx+=-;:. ', step = Math.max(1, Math.floor(Math.min(rows, columns) / 40)), luma = i => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    let lo = 255, hi = 0; for (let r = 0; r < rows; r += step) for (let c = 0; c < columns; c += step) { const l = luma((r * columns + c) * 4); if (l < lo) lo = l; if (l > hi) hi = l; }
    const span = hi - lo || 1, cut = 0.6 * (1 - 30 / 100), out = [];
    for (let r = 0; r < rows; r++) { let line = '';
      for (let c = 0; c < columns; c++) { const m = Math.max(0, Math.min(1, (luma((r * columns + c) * 4) - lo) / span)); line += m < cut ? ' ' : ramp[Math.min(ramp.length - 1, Math.floor((1 - m) * ramp.length))]; }
      out.push(line); }
    return out;
  },
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
  // A studio-style WebGL hero: a postprocessing pass that samples one pixel per square cell and picks from a 16-glyph atlas.
  // As shipped (inverted, purple tint, contrast 1.8) and neutral (white glyphs on dark, the same grid as everyone else).
  ...Object.fromEntries([['as shipped', { invert: true, tintColor: new THREE.Vector3(0x91 / 255, 0x7a / 255, 1), volumeShading: true, postfx: { contrastAdjust: 1.8, brightnessAdjust: 0 } }],
    ['neutral', { invert: false, tintColor: new THREE.Vector3(1, 1, 1), volumeShading: false, postfx: {} }]].map(([label, o]) => [`webgl-ascii-hero (${label})`, async (picture, w, h, columns) => {
    const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
    renderer.setSize(w, h, false);
    const texture = new THREE.CanvasTexture(picture); texture.colorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: texture })));
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const atlas = heroGlyphs(HERO_SYMBOLS);
    composer.addPass(new EffectPass(camera, new HeroAscii({ cellSize: w / columns, color: true, style: 0, resolution: new THREE.Vector2(w, h), glyphAtlas: atlas, glyphTiles: HERO_SYMBOLS.length, ...o })));
    composer.render(1 / 60);
    const out = resized(renderer.domElement, w, h);
    composer.dispose(); renderer.dispose();
    return out;
  }])),
  // 2025.unseen.co's ASCII pass, rebuilt from the shader and settings in its live bundle (js-265ae611.js): one pixel sampled per
  // square cell, greyscaled, a character chosen by floor((count - 1) * grey) from " .,-+=*UNSEEN2025" drawn in 56px Arial into a
  // 16 by 16 atlas, in #575757 (no cursor fluid here). As shipped, and neutral (white glyphs, the same grid as everyone else).
  ...Object.fromEntries([['as shipped', [0x57 / 255, 0x57 / 255, 0x57 / 255]], ['neutral', [1, 1, 1]]].map(([label, color]) => [`2025.unseen.co ASCII pass (${label})`, async (picture, w, h, columns) => {
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
    const atlas = document.createElement('canvas'); atlas.width = atlas.height = 1024;
    const a = atlas.getContext('2d'), chars = ' .,-+=*UNSEEN2025', tile = 64;
    a.font = '56px arial'; a.textAlign = 'center'; a.textBaseline = 'middle'; a.fillStyle = '#fff';
    for (let i = 0; i < chars.length; i++) a.fillText(chars[i], (i % 16) * tile + tile / 2, Math.floor(i / 16) * tile + tile / 2);
    const compile = (type, src) => { const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, `#version 300 es
      out vec2 vUv; void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); vUv = p; gl_Position = vec4(p * 2. - 1., 0., 1.); }`));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float; in vec2 vUv; out vec4 o;
      uniform sampler2D tDiffuse, uCharacters; uniform float uCharactersCount, uCellSize; uniform vec3 uColor; uniform vec2 uResolutionNoDpr;
      const vec2 SIZE = vec2(16.);
      void main(){
        vec2 cell = uResolutionNoDpr / uCellSize; vec2 grid = 1.0 / cell;
        vec2 pixelizedUV = grid * (0.5 + floor(vUv / grid));
        vec4 pixelized = texture(tDiffuse, pixelizedUV);
        float greyscaled = dot(pixelized.rgb, vec3(0.299, 0.587, 0.114));
        float characterIndex = floor((uCharactersCount - 1.0) * greyscaled);
        vec2 characterPosition = vec2(mod(characterIndex, SIZE.x), floor(characterIndex / SIZE.y));
        vec2 offset = vec2(characterPosition.x, -characterPosition.y) / SIZE;
        vec2 charUV = mod(vUv * (cell / SIZE), 1.0 / SIZE) - vec2(0., 1.0 / SIZE) + offset;
        o = vec4(uColor * texture(uCharacters, charUV).r, 1.);
      }`));
    gl.linkProgram(prog); gl.useProgram(prog);
    // The atlas repeats, as its CanvasTexture does there: the glyph lookup runs below zero and wraps.
    const tex = (img, unit, wrap) => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap); return t; };
    tex(resized(picture, w, h), 0, gl.CLAMP_TO_EDGE); tex(atlas, 1, gl.REPEAT);
    const u = n => gl.getUniformLocation(prog, n);
    gl.uniform1i(u('tDiffuse'), 0); gl.uniform1i(u('uCharacters'), 1); gl.uniform1f(u('uCharactersCount'), chars.length);
    gl.uniform1f(u('uCellSize'), w / columns); gl.uniform3f(u('uColor'), ...color); gl.uniform2f(u('uResolutionNoDpr'), w, h);
    gl.viewport(0, 0, w, h); gl.drawArrays(gl.TRIANGLES, 0, 3);
    const out = resized(canvas, w, h); gl.getExtension('WEBGL_lose_context')?.loseContext();
    return out;
  }])),
  'asciify-engine glyph field (GPU, photo charset)': async (picture, w, h, columns) => {
    const host = document.createElement('canvas'); host.style.cssText = `display:block;width:${w}px;height:${h}px;position:fixed;left:0;top:0`;
    document.body.appendChild(host);
    const field = mountGlyphField(host, { source: picture, hover: 'none', cellSize: (w / columns) * CELL_ASPECT, cellAspect: 1 / CELL_ASPECT, maxPixelRatio: 1, ink: '#ffffff', drift: 0, scene: 'none', font: 'DejaVu Sans Mono', charset: FIELD_PHOTO_CHARSET, glyphScale: 1 });
    await field.ready; field.redraw();
    const out = resized(host, w, h);
    field.destroy(); host.remove();
    return out;
  },
  'asciify-engine glyph field (GPU, photo charset, shape)': async (picture, w, h, columns) => {
    const host = document.createElement('canvas'); host.style.cssText = `display:block;width:${w}px;height:${h}px;position:fixed;left:0;top:0`;
    document.body.appendChild(host);
    const field = mountGlyphField(host, { source: picture, hover: 'none', cellSize: (w / columns) * CELL_ASPECT, cellAspect: 1 / CELL_ASPECT, maxPixelRatio: 1, ink: '#ffffff', drift: 0, scene: 'none', font: 'DejaVu Sans Mono', charset: FIELD_PHOTO_CHARSET, glyphScale: 1, sample: 'shape' });
    await field.ready; field.redraw();
    const out = resized(host, w, h);
    field.destroy(); host.remove();
    return out;
  },
  'asciify-engine glyph field (GPU)': async (picture, w, h, columns) => {
    const host = document.createElement('canvas'); host.style.cssText = `display:block;width:${w}px;height:${h}px;position:fixed;left:0;top:0`;
    document.body.appendChild(host);
    const field = mountGlyphField(host, { source: picture, hover: 'none', cellSize: (w / columns) * CELL_ASPECT, cellAspect: 1 / CELL_ASPECT, maxPixelRatio: 1, ink: '#ffffff', drift: 0, scene: 'none', font: 'DejaVu Sans Mono', ...(window.fieldOptions ?? {}) });
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
