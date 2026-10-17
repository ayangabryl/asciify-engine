import { hash, settledSource, type Box } from './core';

/* Shared by commandPalette and pageDissolve: a piece of interface drawn as tone, and moved in blocks. */

const grey = (tone: number) => { const v = Math.round(Math.min(1, Math.max(0, tone)) * 255); return `rgb(${v} ${v} ${v})`; };
const alphaOf = (color: string) => {
  if (!color || color === 'transparent') return 0;
  const slash = /\/\s*([\d.]+)(%?)\s*\)$/.exec(color);
  if (slash) return parseFloat(slash[1]) / (slash[2] ? 100 : 1);
  const rgba = /^rgba\([^)]*,\s*([\d.]+)\s*\)$/.exec(color);
  return rgba ? parseFloat(rgba[1]) : 1;
};
const MEDIA = /^(IMG|PICTURE|VIDEO|CANVAS|SVG|svg)$/;

/**
 * Paints `root` white on black into `pen`, in `box`'s CSS pixels: the root as an outline, filled elements as faint tiles,
 * borders as lines, media as mid-tone blocks (never their pixels, so a cross-origin image cannot taint the source), and each
 * word of text in its own font where the browser laid it out. Kit canvases are skipped, unless `nested` is set: then each one
 * but `nested.skip` (the caller's own) is drawn as its component's settled frame, so a chart inside a page dissolves as a chart.
 */
export function paintTree(pen: CanvasRenderingContext2D, root: HTMLElement, box: (element: Element) => Box, nested?: { skip?: Element | null }) {
  const radius = (style: CSSStyleDeclaration, b: Box) => Math.max(0, Math.min(parseFloat(style.borderTopLeftRadius) || 0, b.w / 2, b.h / 2));
  const elements = [root, ...root.querySelectorAll<HTMLElement>('*')];
  pen.save();
  for (const el of elements) {
    if (el.tagName === 'CANVAS' && el.dataset?.asciiKit !== undefined) {
      if (!nested || el === nested.skip) continue;
      const b = box(el), frame = b.w > 0 && b.h > 0 ? settledSource(el as HTMLCanvasElement) : null;
      if (frame) { pen.globalCompositeOperation = 'lighter'; pen.drawImage(frame, b.x, b.y, b.w, b.h); pen.globalCompositeOperation = 'source-over'; }
      continue;
    }
    // A kit poster stands in for a field; it is not part of the view.
    if (el.dataset?.asciiPoster !== undefined) continue;
    const b = box(el);
    if (b.w <= 0 || b.h <= 0) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    const fill = alphaOf(style.backgroundColor) > 0.03, border = (parseFloat(style.borderTopWidth) || 0) > 0 && alphaOf(style.borderTopColor) > 0.1;
    pen.beginPath();
    if (el === root) {
      if (fill || border) { pen.strokeStyle = grey(0.42); pen.lineWidth = 3; pen.roundRect(b.x + 1.5, b.y + 1.5, b.w - 3, b.h - 3, radius(style, b)); pen.stroke(); }
    } else if (MEDIA.test(el.tagName)) {
      pen.fillStyle = grey(0.5);
      if (b.w < 32 && b.h < 32) pen.arc(b.x + b.w / 2, b.y + b.h / 2, Math.min(b.w, b.h) * 0.36, 0, Math.PI * 2);
      else pen.roundRect(b.x, b.y, b.w, b.h, radius(style, b));
      pen.fill();
      continue;
    } else if (fill) {
      pen.fillStyle = grey(0.22); pen.roundRect(b.x, b.y, b.w, b.h, radius(style, b)); pen.fill();
    } else if (border) {
      pen.strokeStyle = grey(0.32); pen.lineWidth = 1.5; pen.roundRect(b.x + 0.75, b.y + 0.75, b.w - 1.5, b.h - 1.5, radius(style, b)); pen.stroke();
    }
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const field = el as HTMLInputElement, text = field.value || field.placeholder || '';
      if (text) word(pen, text, b.x + (parseFloat(style.paddingLeft) || 0), b.y, b.h, style, field.value ? 0.82 : 0.5);
    }
  }
  paintText(pen, root, box);
  pen.restore();
}

function word(pen: CanvasRenderingContext2D, text: string, x: number, y: number, h: number, style: CSSStyleDeclaration, tone: number) {
  // Heavier than the HTML and with a glow: at one sample per cell, thin strokes would average away to blank.
  const weight = Math.min(900, (parseFloat(style.fontWeight) || 400) + 200);
  pen.font = `${style.fontStyle || 'normal'} ${weight} ${style.fontSize} ${style.fontFamily}`;
  pen.fillStyle = grey(tone); pen.shadowColor = grey(tone); pen.shadowBlur = 3;
  pen.textBaseline = 'middle';
  pen.fillText(text, x, y + h / 2);
  pen.shadowBlur = 0;
}

/** Inside a visually hidden box (the 1px, overflow-hidden screen-reader pattern): read aloud, never drawn. */
function clipped(el: Element | null, root: Element) {
  for (; el && el !== root; el = el.parentElement) {
    const box = el as HTMLElement;
    if (box.offsetWidth <= 1 && box.offsetHeight <= 1 && getComputedStyle(box).overflow === 'hidden') return true;
  }
  return false;
}

function paintText(pen: CanvasRenderingContext2D, root: HTMLElement, box: (element: Element) => Box) {
  if (typeof document.createTreeWalker !== 'function') return;
  const walker = document.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */), range = document.createRange();
  const origin = box(root), rect = root.getBoundingClientRect(), k = rect.width / ((root as HTMLElement).offsetWidth || rect.width || 1) || 1;
  let words = 0;
  for (let node = walker.nextNode() as Text | null; node && words < 2000; node = walker.nextNode() as Text | null) {
    const parent = node.parentElement;
    if (!parent) continue;
    const style = getComputedStyle(parent);
    if (style.visibility === 'hidden' || clipped(parent, root)) continue;
    const tone = (parseFloat(style.fontWeight) || 400) >= 600 || /^H[1-6]$/.test(parent.tagName) ? 1 : 0.8;
    for (const match of node.data.matchAll(/\S+/g)) {
      range.setStart(node, match.index!);
      range.setEnd(node, match.index! + match[0].length);
      const r = range.getClientRects()[0];
      if (!r) continue;
      words++;
      word(pen, match[0], origin.x + (r.left - rect.left) / k, origin.y + (r.top - rect.top) / k, r.height / k, style, tone);
    }
  }
  range.detach?.();
}

/** A snapshot canvas of `root`, `scale` source pixels per CSS pixel, `w` by `h` CSS pixels. */
export function snapshot(root: HTMLElement, box: (element: Element) => Box, w: number, h: number, scale = 2, nested?: { skip?: Element | null }) {
  const snap = document.createElement('canvas');
  snap.width = Math.max(2, Math.round(w * scale)); snap.height = Math.max(2, Math.round(h * scale));
  const pen = snap.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
  if (!pen) return snap;
  pen.setTransform(scale, 0, 0, scale, 0, 0);
  pen.fillStyle = '#000'; pen.fillRect(0, 0, w, h);
  paintTree(pen, root, box, nested);
  return snap;
}

export interface Block { x: number; y: number; seed: number }
export const BLOCK_W = 4, BLOCK_H = 6;

/** The blocks of a snapshot that hold anything, so an effect moves only those. */
export function blocksOf(snap: HTMLCanvasElement, scale = 2): Block[] {
  const pen = snap.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
  if (!pen) return [];
  const W = snap.width, H = snap.height, data = pen.getImageData(0, 0, W, H).data, list: Block[] = [];
  for (let y = 0; y < H / scale; y += BLOCK_H) {
    for (let x = 0; x < W / scale; x += BLOCK_W) {
      let lit = false;
      for (let sy = 0; sy < BLOCK_H * scale && !lit; sy += 3) for (let sx = 0; sx < BLOCK_W * scale && !lit; sx += 2) {
        const px = Math.round(x * scale + sx), py = Math.round(y * scale + sy);
        if (px < W && py < H && data[(py * W + px) * 4] > 10) lit = true;
      }
      if (lit) list.push({ x, y, seed: hash(x, y) });
    }
  }
  return list;
}

/**
 * Draws a snapshot block by block. Each block has an order 0–1; at progress `p` the blocks whose order has passed are home,
 * the next band is in flight (offset by `fly`, fading in) and the rest are not drawn. Run p up to condense, down to dissolve.
 */
export function drawBlocks(pen: CanvasRenderingContext2D, snap: HTMLCanvasElement, blocks: Block[], order: Float32Array, p: number,
  fly: (block: Block, away: number) => [number, number], alpha = 1, band = 0.32, scale = 2) {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i], k = (p - order[i] * (1 - band)) / band;
    if (k <= 0) continue;
    const away = k >= 1 ? 0 : 1 - k;
    let x = b.x, y = b.y;
    if (away > 0) { const [dx, dy] = fly(b, away); x += dx; y += dy; }
    pen.globalAlpha = alpha * (1 - away * away);
    pen.drawImage(snap, b.x * scale, b.y * scale, BLOCK_W * scale, BLOCK_H * scale, x, y, BLOCK_W, BLOCK_H);
  }
  pen.globalAlpha = 1;
}
