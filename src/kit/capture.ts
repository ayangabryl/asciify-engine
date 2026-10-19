import { clamp, hash, type Box } from './core';

/* Shared by the phase 2b components: images drawn into a source, interface snapshots, and the kit's fallback styles. */

export type ImageInput = string | HTMLImageElement | Blob;
export interface Picture { image: CanvasImageSource; width: number; height: number }

const crossOrigin = (src: string) => {
  try { return typeof location !== 'undefined' && new URL(src, location.href).origin !== location.origin; } catch { return false; }
};

/** Waits for an `<img>` to hold a decoded picture. */
export function imageReady(img: HTMLImageElement): Promise<Picture> {
  const done = (): Picture => ({ image: img, width: img.naturalWidth, height: img.naturalHeight });
  if (img.complete && img.naturalWidth) return Promise.resolve(done());
  return new Promise((resolve, reject) => {
    const ok = () => { off(); resolve(done()); };
    const fail = () => { off(); reject(new Error(`Could not load ${img.src}`)); };
    const off = () => { img.removeEventListener('load', ok); img.removeEventListener('error', fail); };
    img.addEventListener('load', ok);
    img.addEventListener('error', fail);
  });
}

/** An `<img>` showing `src`; a URL from another origin is requested with CORS so the field can read it. */
export function imageFor(src: string, img: HTMLImageElement = document.createElement('img')) {
  if (crossOrigin(src) && !img.crossOrigin) img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  img.src = src;
  return img;
}

/** Draws a picture cropped like `object-fit: cover`, focused at `fx`, `fy`. */
export function drawCover(pen: CanvasRenderingContext2D, pic: Picture, x: number, y: number, w: number, h: number, fx = 0.5, fy = 0.5) {
  if (w <= 0 || h <= 0 || !pic.width || !pic.height) return;
  const s = Math.max(w / pic.width, h / pic.height), dw = pic.width * s, dh = pic.height * s;
  // Placed whole and clipped rather than cut with a source rectangle: an `<img>` chosen from a srcset reports a
  // density-corrected naturalWidth, while drawImage's source rectangle is in the file's own pixels.
  pen.save();
  pen.beginPath();
  pen.rect(x, y, w, h);
  pen.clip();
  pen.drawImage(pic.image, x + (w - dw) * fx, y + (h - dh) * fy, dw, dh);
  pen.restore();
}

/**
 * A picture as tone for an ink field: levels stretched, and on a light ground inverted, so dark parts of the photo become
 * dense dark ink on a light page and bright parts dense light ink on a dark one. `floor` keeps a faint texture everywhere.
 */
export function toneOf(pic: Picture, light: boolean, floor = 0.08): Picture {
  const s = Math.min(1, 420 / Math.max(1, pic.width, pic.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(pic.width * s));
  canvas.height = Math.max(1, Math.round(pic.height * s));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return pic;
  ctx.drawImage(pic.image, 0, 0, canvas.width, canvas.height);
  let data: ImageData;
  try { data = ctx.getImageData(0, 0, canvas.width, canvas.height); } catch { return pic; }
  const px = data.data, hist = new Uint32Array(256), n = px.length / 4;
  const lum = (i: number) => px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722;
  for (let i = 0; i < px.length; i += 4) hist[Math.round(lum(i))]++;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.02) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.02) { hi = v; break; } }
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < px.length; i += 4) {
    let l = clamp((lum(i) - lo) / span);
    if (light) l = 1 - l;
    px[i] = px[i + 1] = px[i + 2] = Math.round((floor + (1 - floor) * l) * 255);
    px[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return { image: canvas, width: canvas.width, height: canvas.height };
}

/** Grey levels for the parts of a snapshot, named by `data-paint` on the element or an ancestor; `data-paint="none"` leaves a part out. */
export const PAINT_TONES: Record<string, number> = { strong: 1, text: 0.82, meta: 0.55, tile: 0.42, icon: 0.62 };
const MEDIA = new Set(['IMG', 'SVG', 'svg', 'VIDEO', 'PICTURE']);
const descendants = (root: Element): HTMLElement[] => [...root.children].flatMap(el => (MEDIA.has(el.tagName) ? [el as HTMLElement] : [el as HTMLElement, ...descendants(el)]));

export interface Snapshot { canvas: HTMLCanvasElement; rects: Box[] }

/**
 * Paints `root`'s words, icons and images white on black, where the browser laid them out, into a canvas of
 * `w` × `h` CSS pixels at 2x. `box` maps an element into that canvas. The returned rects are what was painted.
 */
export function snapshot(root: HTMLElement, w: number, h: number, box: (el: Element) => Box): Snapshot {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(w * 2)); canvas.height = Math.max(2, Math.round(h * 2));
  const rects: Box[] = [];
  const ctx = canvas.getContext('2d');
  if (!ctx) return { canvas, rects };
  ctx.scale(2, 2);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  const origin = box(root), rootRect = root.getBoundingClientRect();
  const k = rootRect.width / (root.offsetWidth || rootRect.width || 1) || 1;
  const toneFor = (el: Element | null) => {
    for (let n = el as HTMLElement | null; n && n !== root.parentElement; n = n.parentElement) {
      const kind = n.dataset?.paint;
      if (kind && PAINT_TONES[kind] !== undefined) return PAINT_TONES[kind];
    }
    return parseFloat(el ? getComputedStyle(el).fontWeight : '400') >= 500 ? 1 : 0.7;
  };
  const grey = (t: number) => { const v = Math.round(clamp(t) * 255); return `rgb(${v} ${v} ${v})`; };

  const all = descendants(root);
  const shapes = [root, ...all].filter(el => {
    const kind = el.dataset?.paint;
    return kind === 'tile' || kind === 'icon' || (!kind && MEDIA.has(el.tagName) && !el.closest('[data-paint]'));
  });
  for (const el of shapes) {
    const b = box(el);
    if (b.w <= 0 || b.h <= 0) continue;
    const kind = el.dataset?.paint;
    ctx.fillStyle = grey(kind === 'icon' ? PAINT_TONES.icon : PAINT_TONES.tile);
    ctx.beginPath();
    if (kind === 'icon' || el.tagName.toLowerCase() === 'svg') ctx.arc(b.x + b.w / 2, b.y + b.h / 2, Math.min(b.w, b.h) * 0.4, 0, Math.PI * 2);
    else ctx.roundRect(b.x, b.y, b.w, b.h, Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, b.h / 2));
    ctx.fill();
    rects.push(b);
  }

  // Words, each where the browser put it.
  const walker = document.createTreeWalker(root, 4);
  const range = document.createRange();
  ctx.textBaseline = 'middle';
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const parent = node.parentElement;
    if (!parent || parent.closest('[data-paint="none"]')) continue;
    const style = getComputedStyle(parent);
    ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    ctx.fillStyle = grey(toneFor(parent));
    // A glow spreads each stroke over a few cells, so thin text still reaches the dense end of the charset.
    ctx.shadowColor = ctx.fillStyle as string; ctx.shadowBlur = 4;
    for (const word of node.data.matchAll(/\S+/g)) {
      range.setStart(node, word.index!);
      range.setEnd(node, word.index! + word[0].length);
      const r = range.getClientRects()[0];
      if (!r) continue;
      const b = { x: origin.x + (r.left - rootRect.left) / k, y: origin.y + (r.top - rootRect.top) / k, w: r.width / k, h: r.height / k };
      ctx.fillText(word[0], b.x, b.y + b.h / 2);
      rects.push(b);
    }
  }
  ctx.shadowBlur = 0;
  range.detach?.();
  return { canvas, rects };
}

export interface Block { x: number; y: number; seed: number }
const BW = 4, BH = 6;

/** The 4 × 6 px blocks of a snapshot that hold anything, so an effect only moves those. */
export function blocksOf(rects: Box[]): Block[] {
  const seen = new Set<string>(), list: Block[] = [];
  for (const r of rects) {
    for (let y = Math.floor((r.y - 2) / BH) * BH; y < r.y + r.h + 2; y += BH) {
      for (let x = Math.floor((r.x - 2) / BW) * BW; x < r.x + r.w + 2; x += BW) {
        const key = `${x},${y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        list.push({ x, y, seed: hash(x, y) });
      }
    }
  }
  return list;
}

/**
 * Draws a snapshot block by block. Each block has an order 0–1; at progress `p` the blocks whose order has passed are home,
 * the next band is in flight (offset by `fly`, fading in) and the rest are not drawn. Run p up to gather, down to dissolve.
 */
export function drawBlocks(pen: CanvasRenderingContext2D, snap: HTMLCanvasElement, blocks: Block[], order: ArrayLike<number>, p: number,
  fly: (b: Block, away: number) => [number, number], alpha = 1, band = 0.32) {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i], k = (p - order[i] * (1 - band)) / band;
    if (k <= 0) continue;
    const away = k >= 1 ? 0 : 1 - k;
    let x = b.x, y = b.y;
    if (away > 0) { const [dx, dy] = fly(b, away); x += dx; y += dy; }
    pen.globalAlpha = alpha * (1 - away * away);
    pen.drawImage(snap, b.x * 2, b.y * 2, BW * 2, BH * 2, x, y, BW, BH);
  }
  pen.globalAlpha = 1;
}

/** Adds the kit's fallback styles once. Every rule sits in `:where()`, so any class of yours overrides it. */
export function injectStyle(id: string, css: string) {
  if (typeof document === 'undefined' || document.getElementById(id)) return;
  const style = document.createElement('style');
  style.setAttribute('id', id);
  style.textContent = css;
  (document.head ?? document.documentElement).appendChild(style);
}
