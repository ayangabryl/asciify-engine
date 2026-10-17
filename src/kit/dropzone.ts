import type { GlyphFieldOptions } from '../field';
import { clamp, handle, house, isDark, mountSurface, srOnly, type KitHandle, type KitOptions, type Surface } from './core';
import { drawCover, imageFor, imageReady, injectStyle, type Picture } from './capture';

export type DropState = 'empty' | 'developing' | 'done';

export interface DroppedImage { file: File | null; src: string; width: number; height: number }

export interface DropzoneOptions extends KitOptions {
  /** Called once an image has been accepted and drawn. */
  onImage?: (image: DroppedImage) => void;
  /** Called when a file is refused: not an image, or over `maxBytes`. */
  onError?: (message: string, file: File) => void;
  /** Largest file accepted, in bytes. Default 10 MB. */
  maxBytes?: number;
  /** Ms the image takes to develop in characters. Default 720. */
  develop?: number;
  /** File name for `download()`. Default `<name>-ascii.png`. */
  filename?: string;
  /** Called on every state change (`empty`, `developing`, `done`) with the image's name, or '' when empty. */
  onState?: (state: DropState, name: string) => void;
}

export interface DropzoneHandle extends KitHandle<DropzoneOptions> {
  /** Shows an image (a URL, Blob or File), developing it in characters. */
  setImage(src: string | Blob): Promise<void>;
  /** Back to the empty zone. */
  clear(): void;
  /** Opens the file picker. */
  pick(): void;
  /** Saves the image as drawn in characters, as a PNG. Resolves with the Blob, or null without the field or an image. */
  download(filename?: string): Promise<Blob | null>;
  readonly state: DropState;
}

const DEFAULTS = { maxBytes: 10 * 1024 * 1024, develop: 720 };
const CELL = 6, BREATHE_MS = 1300, REST = 0.08;
const CSS = `
:where(.ascii-drop-empty){position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;height:100%;min-height:inherit;padding:24px;box-sizing:border-box;text-align:center}
:where([data-ascii-dropzone]:not([data-state="empty"])) :where(.ascii-drop-empty){display:none}
:where(.ascii-drop-title){margin:0;font-weight:500}
:where(.ascii-drop-hint){margin:0;font-size:14px;opacity:.65}
:where(.ascii-drop-pick){margin-top:8px;height:34px;padding:0 14px;border:0;border-radius:999px;background:currentColor;font:inherit;font-size:14px;cursor:pointer}
:where(.ascii-drop-pick) > span{color:Canvas}
:where(.ascii-drop-img){position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
`;

function defaultContent() {
  const wrap = document.createElement('div'), title = document.createElement('p'), hint = document.createElement('p');
  const button = document.createElement('button'), label = document.createElement('span');
  wrap.className = 'ascii-drop-empty';
  title.className = 'ascii-drop-title';
  title.textContent = 'Drop an image';
  hint.className = 'ascii-drop-hint';
  hint.textContent = 'PNG, JPG or WebP';
  button.type = 'button';
  button.className = 'ascii-drop-pick';
  button.dataset.dropzone = 'pick';
  label.textContent = 'Choose file';
  button.appendChild(label);
  wrap.append(title, hint, button);
  return wrap;
}

const PHOTO_GROUND = '#0b0b0a';
const RING_ASPECT = 1;

/**
 * The field's cell grid for a box, in the engine's own rounding: whole device pixels per cell, counted from the bottom left.
 * The ring's frame is trimmed to whole cells (and whole CSS pixels), so a source of 2 × 2 texels per cell lands on the grid exactly.
 */
export function ringGrid(w: number, h: number, ratio = Math.min(2, typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1)) {
  const chD = Math.max(2, Math.round(CELL * ratio)), cwD = Math.max(2, Math.round(chD * RING_ASPECT));
  const fit = (size: number, cell: number) => {
    const most = Math.floor((size * ratio) / cell);
    for (let n = most; n > 1; n--) { const css = (n * cell) / ratio; if (Math.abs(css - Math.round(css)) < 0.01 || n < most - 8) return { n, css: Math.round(css) }; }
    return { n: 1, css: Math.round(cell / ratio) };
  };
  const x = fit(w, cwD), y = fit(h, chD);
  return { cols: x.n, rows: y.n, w: x.css, h: y.css, cw: cwD / ratio, ch: chD / ratio };
}

/**
 * The idle ring, one texel block per cell: every side gets exactly one even row of characters, a cell in from the frame,
 * with corners rounded to `radius` CSS px. `inner` (0–1) adds a dimmer row inside it, the breath that answers a drag.
 */
export function paintRing(pen: CanvasRenderingContext2D, grid: ReturnType<typeof ringGrid>, radius: number, tone: number, inner: number) {
  const { cols, rows } = grid, image = pen.createImageData(cols * 2, rows * 2), data = image.data;
  const rx = Math.max(1, radius / grid.cw), ry = Math.max(1, radius / grid.ch);
  const x0 = 1, x1 = cols - 2, y0 = 1, y1 = rows - 2;
  for (let row = 0; row < rows; row++) {
    for (let c = 0; c < cols; c++) {
      // Signed distance in cells to the rounded rectangle: straight sides exactly, corners along the ray from their centre.
      const qx = Math.max(x0 + rx - c, 0, c - (x1 - rx)), qy = Math.max(y0 + ry - row, 0, row - (y1 - ry));
      let d;
      if (qx > 0 && qy > 0) { const e = Math.hypot(qx / rx, qy / ry); d = Math.hypot(qx, qy) * (1 - 1 / e); }
      else d = -Math.min(c - x0, x1 - c, row - y0, y1 - row);
      const t = Math.abs(d) < 0.5 ? tone : inner > 0 && d < -0.5 && d > -1.5 ? tone * 0.55 * inner : 0;
      const v = Math.round(Math.min(1, t) * 255);
      for (let k = 0; k < 4; k++) { const i = ((row * 2 + (k >> 1)) * cols * 2 + c * 2 + (k & 1)) * 4; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255; }
    }
  }
  pen.putImageData(image, 0, 0);
}

/**
 * An image dropzone whose border is a quiet ring of characters that thickens and breathes while a file is dragged over.
 * A dropped image develops in characters, in its own colours. Any element inside with `data-dropzone="pick"`, `"clear"`
 * or `"download"` is wired to that action. Without content of your own it adds a title, hint and Choose file button.
 */
export function dropzone(element: HTMLElement, options: DropzoneOptions = {}): DropzoneHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  let phase: DropState = 'empty', pic: Picture | null = null, src = '', objectUrl = '', name = 'image', since = 0, request = 0;
  let over = false, depth = 0, glow = 0, then = 0, lastFile: File | null = null;
  let surface: Surface | null = null, ring: ReturnType<typeof ringGrid> | null = null;
  const live = srOnly('', true);
  const FRAME = ['left', 'top', 'width', 'height'] as const;
  /** Fits the canvas to whole cells, centred, for the ring; the image gets the whole zone back. */
  const trim = () => {
    const canvas = surface?.canvas;
    if (!canvas || !element.offsetWidth) return null;
    const grid = phase === 'empty' ? ringGrid(element.offsetWidth, element.offsetHeight) : null;
    const box = grid
      ? [`${Math.round((element.offsetWidth - grid.w) / 2)}px`, `${Math.round((element.offsetHeight - grid.h) / 2)}px`, `${grid.w}px`, `${grid.h}px`]
      : ['0px', '0px', '100%', '100%'];
    let moved = false;
    FRAME.forEach((key, i) => { if (canvas.style[key] !== box[i]) { canvas.style[key] = box[i]; moved = true; } });
    ring = grid;
    if (moved) { surface?.field.resize(); surface?.kick(); return null; }
    return grid;
  };
  const input = document.createElement('input');
  const added: Element[] = [live, input];
  let fallbackImg: HTMLImageElement | null = null;
  const bare = !element.children.length;
  const look = (): GlyphFieldOptions => (phase === 'empty'
    ? { mark: 'glyph', charset: ' .:+*#', font: '"Geist Mono", ui-monospace, monospace', fontWeight: 500, cellSize: CELL, cellAspect: 1, glyphScale: 0.9, ...state.current.look }
    : { blend: 'coarse', mark: 'glyph', charset: ' .:-=+*#%@', font: '"Geist", Arial, sans-serif', fontWeight: 500, cellSize: CELL, cellAspect: 0.8, glyphScale: 0.8,
      // Characters in the photo's own colours read only on a dark ground: on a light zone the shadows would vanish into it.
      background: isDark(element) ? 'transparent' : PHOTO_GROUND,
      color: 'source', saturation: 1.15, contrast: 1.15, levels: 'auto', brightness: phase === 'developing' ? -1 : REST, hover: 'trail', trail: { strength: 0.6, radius: 0.3 }, ...state.current.look });

  surface = mountSurface({
    host: element,
    layer: 'under',
    look,
    // The ring is a quiet border: mid graphite unless the page sets `--ascii-ink`.
    ink: dark => state.current.ink ?? `var(--ascii-ink, ${dark ? '#7a7872' : '#76746e'})`,
    kit: state,
    reducedMotion: () => state.current.reducedMotion,
    // The ring draws 2 × 2 texels per cell; the image, one texel per CSS pixel.
    resolution: (w, h) => (phase === 'empty' && ring ? [ring.cols * 2, ring.rows * 2] : [Math.max(1, Math.round(w)), Math.max(1, Math.round(h))]),
    onFail: () => { surface = null; if (src) showFallback(src); },
    paint: ({ pen, w, h, now, still }) => {
      if (phase !== 'empty') {
        if (!pic) return false;
        const k = still ? 1 : house(clamp((now - since) / state.current.develop));
        drawCover(pen, pic, 0, 0, w, h);
        // The image develops out of the dark, after its levels are set, until only a touch of lift remains.
        const rest = state.current.look?.brightness ?? REST;
        if (phase === 'developing') surface?.field.update({ brightness: -1 + k * (1 + rest) });
        if (k >= 1 && phase === 'developing') settle();
        return k < 1;
      }
      // The ring: one row of characters a cell in from the edge, following the corners; a drag adds a dimmer row inside.
      const dt = then ? Math.min(64, now - then) : 16;
      then = now;
      const to = over ? 1 : 0;
      glow = still ? to : glow + (to - glow) * (1 - Math.exp(-dt / 70));
      const breath = still ? 0.5 : 0.5 - 0.5 * Math.cos((now / BREATHE_MS) * Math.PI * 2);
      const radius = Math.max(4, (parseFloat(getComputedStyle(element).borderTopLeftRadius) || 16) - CELL);
      const grid = trim();
      if (grid) paintRing(pen, grid, radius, 0.56 + glow * (0.14 + 0.28 * breath), glow * (0.4 + 0.6 * breath));
      const moving = over || Math.abs(to - glow) > 0.004;
      if (!moving) then = 0;
      return moving;
    },
  });

  const setState = (next: DropState) => {
    const was = phase;
    phase = next;
    element.dataset.state = next;
    if ((was === 'empty') !== (next === 'empty')) { trim(); surface?.refresh(); }
    if (was !== next) state.current.onState?.(next, next === 'empty' ? '' : name);
  };
  const settle = () => {
    setState('done');
    live.textContent = `${name} ready`;
    if (pic) state.current.onImage?.({ file: lastFile, src, width: pic.width, height: pic.height });
  };
  function showFallback(url: string) {
    fallbackImg ??= Object.assign(document.createElement('img'), { className: 'ascii-drop-img', alt: '' });
    fallbackImg.src = url;
    if (fallbackImg.parentElement !== element) { element.prepend(fallbackImg); added.push(fallbackImg); }
  }

  const setImage = async (next: string | Blob, file: File | null = null) => {
    const id = ++request;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = typeof next === 'string' ? '' : URL.createObjectURL(next);
    src = objectUrl || (next as string);
    lastFile = file ?? (typeof File !== 'undefined' && next instanceof File ? next : null);
    name = lastFile?.name ?? (typeof next === 'string' ? next.split('/').pop()?.split('?')[0] || 'image' : 'image');
    live.textContent = `Converting ${name}`;
    let loaded: Picture;
    try { loaded = await imageReady(imageFor(src)); } catch { if (id === request) { live.textContent = `Could not load ${name}`; } return; }
    if (id !== request) return;
    pic = loaded;
    if (!surface) { showFallback(src); setState('done'); settle(); return; }
    since = performance.now();
    setState(surface.still() ? 'done' : 'developing');
    surface.field.pulse({ strength: 1 });
    surface.kick();
    if (phase === 'done') settle();
  };

  const accept = (file: File) => {
    const fail = (message: string) => { live.textContent = message; state.current.onError?.(message, file); };
    if (!file.type.startsWith('image/')) return fail(`${file.name} isn’t an image.`);
    if (file.size > state.current.maxBytes) return fail(`${file.name} is over ${Math.round(state.current.maxBytes / 1024 / 1024)} MB.`);
    void setImage(file, file);
  };
  const clear = () => {
    request++;
    pic = null; src = ''; lastFile = null;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = '';
    fallbackImg?.remove();
    setState('empty');
    live.textContent = '';
    surface?.kick();
  };
  const pick = () => input.click();
  const download = (filename?: string) => new Promise<Blob | null>(resolve => {
    const field = surface?.field;
    if (!field || !pic || phase !== 'done') { resolve(null); return; }
    const out = document.createElement('canvas');
    out.width = field.canvas.width;
    out.height = field.canvas.height;
    const ctx = out.getContext('2d');
    if (!ctx) { resolve(null); return; }
    ctx.fillStyle = getComputedStyle(element).backgroundColor || '#000';
    ctx.fillRect(0, 0, out.width, out.height);
    field.redraw();
    ctx.drawImage(field.canvas, 0, 0);
    out.toBlob(blob => {
      if (blob) {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename ?? state.current.filename ?? `${name.replace(/\.[^.]+$/, '')}-ascii.png`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      }
      resolve(blob);
    }, 'image/png');
  });

  const kick = () => { then = 0; surface?.kick(); };
  const onEnter = (event: DragEvent) => { event.preventDefault(); depth++; if (!over) { over = true; element.dataset.over = ''; kick(); } };
  const onOver = (event: DragEvent) => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; };
  const onLeave = () => { depth = Math.max(0, depth - 1); if (!depth && over) { over = false; delete element.dataset.over; kick(); } };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    depth = 0; over = false; delete element.dataset.over;
    if (surface) { const box = element.getBoundingClientRect(); surface.field.pulse({ x: event.clientX - box.left, y: event.clientY - box.top, strength: 1 }); }
    const file = event.dataTransfer?.files?.[0];
    if (file) accept(file); else kick();
  };
  const onClick = (event: MouseEvent) => {
    const action = (event.target as Element | null)?.closest?.('[data-dropzone]')?.getAttribute('data-dropzone');
    if (action === 'pick') pick();
    else if (action === 'clear') clear();
    else if (action === 'download') void download();
  };
  const onPicked = () => { const file = input.files?.[0]; input.value = ''; if (file) accept(file); };

  injectStyle('ascii-kit-dropzone', CSS);
  element.dataset.asciiDropzone = '';
  input.type = 'file';
  input.accept = 'image/*';
  input.tabIndex = -1;
  input.hidden = true;
  input.setAttribute('aria-hidden', 'true');
  if (bare) added.push(defaultContent());
  for (const el of added) element.appendChild(el);
  setState('empty');
  element.addEventListener('dragenter', onEnter);
  element.addEventListener('dragover', onOver);
  element.addEventListener('dragleave', onLeave);
  element.addEventListener('drop', onDrop);
  element.addEventListener('click', onClick);
  input.addEventListener('change', onPicked);

  return handle(() => surface, state, () => surface?.refresh(), {
    setImage: (next: string | Blob) => setImage(next),
    clear,
    pick,
    download,
    get state() { return phase; },
  }, () => {
    request++;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    element.removeEventListener('dragenter', onEnter);
    element.removeEventListener('dragover', onOver);
    element.removeEventListener('dragleave', onLeave);
    element.removeEventListener('drop', onDrop);
    element.removeEventListener('click', onClick);
    input.removeEventListener('change', onPicked);
    added.forEach(el => el.remove());
    delete element.dataset.asciiDropzone;
    delete element.dataset.state;
    delete element.dataset.over;
  });
}

export const DROPZONE_DEFAULTS = DEFAULTS;
