import type { GlyphFieldOptions } from '../field';
import { clamp, handle, isDark, mountSurface, srOnly, type KitHandle, type KitOptions, type Surface } from './core';
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
  /** Ms the image takes to develop in characters. Default 900. */
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

const DEFAULTS = { maxBytes: 10 * 1024 * 1024, develop: 900 };
// The ring rests on the lightest character of any set; a drag lifts it and sets packets chasing at CHASE_SPEED cells a second.
const CELL = 6, REST = 0.08, RING = 0.3, CHASE_SPEED = 14;
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

export interface RingLook {
  /** Tone of the ring row, 0–1. */
  tone: number;
  /** 0–1: how far the drag look has come in, lit packets chasing round the ring and a halo leaning in from it. */
  glow?: number;
  /** Where the chase has got to, in cells along the ring. */
  phase?: number;
  /** The dragged file, in cells, so the halo swells on the side nearest it. */
  near?: { x: number; y: number } | null;
}

const CHASE = 9, HALO = 3;

/**
 * The ring, one texel block per cell: every side gets exactly one even row of characters, a cell in from the frame,
 * with corners rounded to `radius` CSS px. While a file is over it, packets of denser characters chase round the row
 * and a halo a few cells deep leans in from it, deepest on the side nearest the file.
 */
export function paintRing(pen: CanvasRenderingContext2D, grid: ReturnType<typeof ringGrid>, radius: number, look: RingLook) {
  const { cols, rows } = grid, image = pen.createImageData(cols * 2, rows * 2), data = image.data;
  const { tone, glow = 0, phase = 0, near = null } = look;
  const rx = Math.max(1, radius / grid.cw), ry = Math.max(1, radius / grid.ch);
  const x0 = 1, x1 = cols - 2, y0 = 1, y1 = rows - 2;
  // Lengths along the ring, in cells: top, right, bottom and left sides, each followed by a quarter arc.
  const sx = Math.max(0, x1 - x0 - 2 * rx), sy = Math.max(0, y1 - y0 - 2 * ry), arc = (Math.PI / 4) * (rx + ry);
  const reach = Math.hypot(cols, rows) * 0.45;
  for (let row = 0; row < rows; row++) {
    for (let c = 0; c < cols; c++) {
      // Signed distance in cells to the rounded rectangle: straight sides exactly, corners along the ray from their centre.
      const qx = Math.max(x0 + rx - c, 0, c - (x1 - rx)), qy = Math.max(y0 + ry - row, 0, row - (y1 - ry));
      let d;
      if (qx > 0 && qy > 0) { const e = Math.hypot(qx / rx, qy / ry); d = Math.hypot(qx, qy) * (1 - 1 / e); }
      else d = -Math.min(c - x0, x1 - c, row - y0, y1 - row);
      let t = 0;
      if (Math.abs(d) < 0.5) {
        t = tone;
        if (glow > 0) {
          // Position along the ring, clockwise from the top left corner's end.
          const right = c > x1 - rx, bottom = row > y1 - ry, left = c < x0 + rx, top = row < y0 + ry;
          const turn = (a: number, b: number) => Math.atan2(a, b) / (Math.PI / 2);
          let s;
          if (top && !left && !right) s = c - (x0 + rx);
          else if (top && right) s = sx + arc * turn(qx / rx, qy / ry);
          else if (right && !top && !bottom) s = sx + arc + (row - (y0 + ry));
          else if (bottom && right) s = sx + arc + sy + arc * turn(qy / ry, qx / rx);
          else if (bottom && !left) s = sx + 2 * arc + sy + ((x1 - rx) - c);
          else if (bottom && left) s = 2 * sx + 2 * arc + sy + arc * turn(qx / rx, qy / ry);
          else if (left && !top) s = 2 * sx + 3 * arc + sy + ((y1 - ry) - row);
          else s = 2 * sx + 3 * arc + 2 * sy + arc * turn(qy / ry, qx / rx);
          const w = (((s - phase) % CHASE) + CHASE) % CHASE;
          const lit = Math.max(0, 1 - Math.abs(w - CHASE / 2) / 2.2);
          t = tone + glow * (0.2 + 0.32 * lit);
        }
      } else if (glow > 0 && d < -0.5 && d > -0.5 - HALO) {
        const depth = (-d - 0.5) / HALO, lean = near ? Math.max(0, 1 - Math.hypot(c - near.x, row - near.y) / reach) : 0.4;
        t = glow * (1 - depth) ** 1.6 * (0.1 + 0.32 * lean);
      }
      const v = Math.round(Math.min(1, t) * 255);
      for (let k = 0; k < 4; k++) { const i = ((row * 2 + (k >> 1)) * cols * 2 + c * 2 + (k & 1)) * 4; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255; }
    }
  }
  pen.putImageData(image, 0, 0);
}

/**
 * The develop: the image opens out of the dark from `origin` in a soft circle, its wavefront lit so the characters
 * there climb the ramp a beat before they settle. `k` runs 0–1.
 */
function developMask(pen: CanvasRenderingContext2D, w: number, h: number, origin: { x: number; y: number }, k: number) {
  const far = Math.max(Math.hypot(origin.x, origin.y), Math.hypot(w - origin.x, origin.y), Math.hypot(origin.x, h - origin.y), Math.hypot(w - origin.x, h - origin.y));
  const edge = Math.max(24, Math.min(w, h) * 0.22), r = k * (far + edge);
  const inner = Math.max(0, r - edge);
  const shade = pen.createRadialGradient(origin.x, origin.y, inner, origin.x, origin.y, Math.max(inner + 1, r));
  shade.addColorStop(0, 'rgb(0 0 0 / 0)');
  shade.addColorStop(1, 'rgb(0 0 0 / 1)');
  pen.globalCompositeOperation = 'source-over';
  pen.fillStyle = shade;
  pen.fillRect(0, 0, w, h);
  const lit = pen.createRadialGradient(origin.x, origin.y, inner, origin.x, origin.y, Math.max(inner + 1, r));
  const fade = 1 - k * k;
  lit.addColorStop(0, 'rgb(255 255 255 / 0)');
  lit.addColorStop(0.55, `rgb(255 255 255 / ${0.5 * fade})`);
  lit.addColorStop(1, 'rgb(255 255 255 / 0)');
  pen.globalCompositeOperation = 'lighter';
  pen.fillStyle = lit;
  pen.fillRect(0, 0, w, h);
  pen.globalCompositeOperation = 'source-over';
}

/**
 * An image dropzone whose border is a quiet ring of characters that comes alive while a file is dragged over.
 * A dropped image opens out from the drop point in characters, in its own colours. Any element inside with `data-dropzone="pick"`, `"clear"`
 * or `"download"` is wired to that action. Without content of your own it adds a title, hint and Choose file button.
 */
export function dropzone(element: HTMLElement, options: DropzoneOptions = {}): DropzoneHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  let phase: DropState = 'empty', pic: Picture | null = null, src = '', objectUrl = '', name = 'image', since = 0, request = 0;
  let over = false, depth = 0, glow = 0, then = 0, phase0 = 0, lastFile: File | null = null;
  let pointer: { x: number; y: number } | null = null, origin: { x: number; y: number } | null = null;
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
      color: 'source', saturation: 1.15, contrast: 1.15, levels: 'auto', brightness: REST, hover: 'trail', trail: { strength: 0.6, radius: 0.3 }, ...state.current.look });

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
        const t = still ? 1 : clamp((now - since) / state.current.develop);
        // The wavefront's area grows with the square of its radius, so the radius eases gently or the sweep is over in a blink.
        const k = 1 - (1 - t) ** 2;
        drawCover(pen, pic, 0, 0, w, h);
        if (phase === 'developing' && k < 1) developMask(pen, w, h, origin ?? { x: w / 2, y: h / 2 }, k);
        if (t >= 1 && phase === 'developing') settle();
        return t < 1;
      }
      const dt = then ? Math.min(64, now - then) : 16;
      then = now;
      const to = over ? 1 : 0;
      glow = still ? to : glow + (to - glow) * (1 - Math.exp(-dt / 90));
      if (!still && glow > 0.004) phase0 += (dt / 1000) * CHASE_SPEED;
      const radius = Math.max(4, (parseFloat(getComputedStyle(element).borderTopLeftRadius) || 16) - CELL);
      const grid = trim();
      if (grid) {
        const box = surface!.canvas.getBoundingClientRect();
        const near = pointer && box.width ? { x: ((pointer.x - box.left) / box.width) * grid.cols, y: ((pointer.y - box.top) / box.height) * grid.rows } : null;
        paintRing(pen, grid, radius, { tone: RING, glow, phase: phase0, near });
      }
      const moving = !still && (over || Math.abs(to - glow) > 0.004);
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

  const setImage = async (next: string | Blob, file: File | null = null, from: { x: number; y: number } | null = null) => {
    const id = ++request;
    origin = from;
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

  const accept = (file: File, from: { x: number; y: number } | null = null) => {
    const fail = (message: string) => { live.textContent = message; state.current.onError?.(message, file); };
    if (!file.type.startsWith('image/')) return fail(`${file.name} isn’t an image.`);
    if (file.size > state.current.maxBytes) return fail(`${file.name} is over ${Math.round(state.current.maxBytes / 1024 / 1024)} MB.`);
    void setImage(file, file, from);
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
  const onEnter = (event: DragEvent) => { event.preventDefault(); depth++; pointer = { x: event.clientX, y: event.clientY }; if (!over) { over = true; element.dataset.over = ''; kick(); } };
  const onOver = (event: DragEvent) => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; pointer = { x: event.clientX, y: event.clientY }; };
  const onLeave = () => { depth = Math.max(0, depth - 1); if (!depth && over) { over = false; pointer = null; delete element.dataset.over; kick(); } };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    depth = 0; over = false; pointer = null; delete element.dataset.over;
    const box = element.getBoundingClientRect(), at = { x: event.clientX - box.left, y: event.clientY - box.top };
    surface?.field.pulse({ ...at, strength: 1 });
    const file = event.dataTransfer?.files?.[0];
    if (file) accept(file, at); else kick();
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
