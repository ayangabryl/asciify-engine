/**
 * What every glyph field on a page shares: one WebGL2 context drawing off screen, one frame loop, one set of page listeners
 * and observers, and the programs and glyph atlases built in that context. Each field draws its frame into the shared
 * context and copies it to its own canvas with a 2D blit, so a page with many fields holds one context: no per-field context
 * creation or teardown, no browser context limit, and fields stay ordinary canvases in the page's own stacking and clipping.
 */

import { FIELD_COMPOSITE, fieldCellShader } from './field-shaders';

type Locations = Record<string, WebGLUniformLocation | null>;
export interface SharedProgram { program: WebGLProgram; locations: Locations | null; fragment: WebGLShader }
export interface SharedAtlas { key: string; texture: WebGLTexture; refs: number; final: boolean; users: Set<() => void>; bytes: number }

const VERTEX = `#version 300 es
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`;

/* ---------------- One frame loop ---------------- */

type Task = (now: number) => void;
const tasks = new Set<Task>();
let raf = 0, frameStart = 0, rafWith: unknown = null;
const gaps: number[] = [];
let lastTick = 0;
// Ambient motion's budget: while the shared frames take much of the frame interval on the main thread (a slow or busy
// machine), ambient motion draws every second or third time it would; interaction keeps the full rate.
let ambientLoad = 1, tickCost = 0, loadAt = 0;
function tick(now: number) {
  raf = 0;
  if (lastTick && now > lastTick) { gaps.push(now - lastTick); if (gaps.length > 120) gaps.shift(); }
  lastTick = now;
  frameStart = performance.now();
  const due = [...tasks];
  tasks.clear();
  for (const task of due) {
    try { task(now); } catch (error) { if (typeof console !== 'undefined') console.error(error); }
  }
  host?.endFrame(now);
  const cost = performance.now() - frameStart;
  tickCost = tickCost * 0.9 + cost * 0.1;
  if (now - loadAt > 500) {
    loadAt = now;
    const interval = frameInterval();
    const gpuBound = !!host?.overloaded;
    if ((tickCost > interval * 0.5 || gpuBound) && ambientLoad < 3) ambientLoad++;
    else if (tickCost < interval * 0.2 && !gpuBound && ambientLoad > 1) ambientLoad--;
  }
  if (!tasks.size) lastTick = 0;
}
/** How many times longer ambient motion waits between frames right now: 1, or 2 to 3 while frames are expensive. */
export const ambientFactor = () => ambientLoad;
/** Runs `task` in the next shared frame. A task asked for twice in one frame runs once. */
export function requestFieldFrame(task: Task) {
  tasks.add(task);
  // A frame asked of a replaced requestAnimationFrame (a test's, a polyfill swapped in) will never come.
  if (raf && rafWith !== requestAnimationFrame) raf = 0;
  if (!raf) { rafWith = requestAnimationFrame; raf = requestAnimationFrame(tick); }
}
export function cancelFieldFrame(task: Task) {
  tasks.delete(task);
  if (!tasks.size && raf) { cancelAnimationFrame(raf); raf = 0; lastTick = 0; }
}
/**
 * The frame budget: the display's interval from the loop's own recent frames (the 20th percentile, so dropped frames don't
 * count), and never more than a 60 Hz frame, so a machine that drops every frame still sees itself as behind.
 */
export function frameInterval() {
  if (gaps.length < 20) return 1000 / 60;
  const sorted = [...gaps].sort((a, b) => a - b);
  return Math.min(1000 / 60, Math.max(1000 / 360, sorted[Math.floor(sorted.length * 0.2)]));
}

/* ---------------- One set of page listeners ---------------- */

export interface PointerClient {
  /** Where to read the pointer: the window, or an element whose events (bubbling from its content) count. */
  target: HTMLElement | Window;
  move(event: PointerEvent): void;
  /** The pointer left the target, or the page. */
  leave(): void;
  /** False while the field cannot be under the pointer (scrolled away), so moves elsewhere skip it. */
  near?(): boolean;
  inside?: boolean;
}
const pointers = new Set<PointerClient>();
const pages = new Set<() => void>();
const motions = new Set<() => void>();
const themes = new Set<() => void>();
const fontClients = new Set<(event: Event) => void>();
let listening = false, listenedOn: Document | null = null, reducedQuery: MediaQueryList | null = null, schemeQuery: MediaQueryList | null = null, themeWatch: MutationObserver | null = null;

const onMove = (event: PointerEvent) => {
  let path: EventTarget[] | null = null;
  for (const client of pointers) {
    // A window-wide client keeps `inside` itself (whether the pointer was over its field).
    if (client.target === window) { if (!client.near || client.near() || client.inside) client.move(event); continue; }
    path ??= event.composedPath();
    const within = path.includes(client.target);
    if (within) { client.inside = true; client.move(event); } else if (client.inside) { client.inside = false; client.leave(); }
  }
};
const onPageLeave = () => { for (const client of pointers) { client.inside = false; client.leave(); } };
const onVisibility = () => { for (const fn of [...pages]) fn(); };
const onMotion = () => { for (const fn of [...motions]) fn(); };
const onTheme = () => { for (const fn of [...themes]) fn(); };
const onFonts = (event: Event) => { for (const fn of [...fontClients]) fn(event); };
const fonts = () => (typeof document === 'undefined' ? undefined : (document as Document & { fonts?: FontFaceSet }).fonts);

function listen() {
  const want = pointers.size + pages.size + motions.size + themes.size + fontClients.size > 0;
  if (typeof document === 'undefined') return;
  // A new document (a test's) starts with nothing attached.
  if (listenedOn !== document) { listening = false; listenedOn = document; reducedQuery = schemeQuery = null; themeWatch = null; }
  if (want === listening) return;
  listening = want;
  const method = want ? 'addEventListener' : 'removeEventListener';
  // Capture on the window: every move reaches the fields, even one a page handler stops from bubbling.
  if (typeof window !== 'undefined') {
    window[method]?.('pointermove', onMove as EventListener, { capture: true, passive: true } as AddEventListenerOptions);
    window[method]?.('pointerdown', onMove as EventListener, { capture: true, passive: true } as AddEventListenerOptions);
  }
  document[method]?.('pointerleave', onPageLeave);
  document[method]?.('visibilitychange', onVisibility);
  fonts()?.[method]?.('loadingdone', onFonts);
  reducedQuery ??= typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  schemeQuery ??= typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  reducedQuery?.[method]?.('change', onMotion);
  schemeQuery?.[method]?.('change', onTheme);
  if (want) {
    // Class or attribute themes (`.dark`, `data-theme`) change no media query, so watch the root for them.
    themeWatch ??= typeof MutationObserver === 'function' ? new MutationObserver(onTheme) : null;
    for (const root of [document.documentElement, document.body]) if (root) themeWatch?.observe(root, { attributes: true, attributeFilter: ['class', 'data-theme', 'data-mode', 'style'] });
  } else themeWatch?.disconnect();
}
const subscribe = <T>(set: Set<T>, item: T) => { set.add(item); listen(); return () => { if (set.delete(item)) listen(); }; };
/**
 * Pointer moves over the target, through the page's one listener. A target in a shadow root, or in another document, is
 * listened to directly: the page's listener can't see into either. Returns the unsubscribe.
 */
export function watchPointer(client: PointerClient) {
  const target = client.target;
  if (typeof window === 'undefined' || target === window || typeof document === 'undefined') return subscribe(pointers, client);
  const element = target as HTMLElement;
  const root = element.getRootNode?.();
  if (element.ownerDocument === document && (!root || root === document)) return subscribe(pointers, client);
  const move = client.move as EventListener, leave = () => client.leave();
  element.addEventListener('pointermove', move, { passive: true });
  element.addEventListener('pointerdown', move, { passive: true });
  element.addEventListener('pointerleave', leave);
  return () => {
    element.removeEventListener('pointermove', move);
    element.removeEventListener('pointerdown', move);
    element.removeEventListener('pointerleave', leave);
  };
}
/** The tab shown or hidden. */
export const watchVisibility = (fn: () => void) => subscribe(pages, fn);
/** `prefers-reduced-motion` changed. */
export const watchMotionPreference = (fn: () => void) => subscribe(motions, fn);
/** The colour scheme, or a class or attribute theme on the root, changed. */
export const watchTheme = (fn: () => void) => subscribe(themes, fn);
/** A font face finished loading. */
export const watchFonts = (fn: (event: Event) => void) => subscribe(fontClients, fn);

/* ---------------- One set of observers ---------------- */

type Watch<E> = Map<Element, Set<(entry: E) => void>>;
const sizes: Watch<ResizeObserverEntry> = new Map();
let resizeObserver: ResizeObserver | null = null;
const views = new Map<string, { observer: IntersectionObserver; watch: Watch<IntersectionObserverEntry> }>();
const dispatch = <E extends { target: Element }>(watch: Watch<E>) => (entries: E[]) => {
  for (const entry of entries) for (const fn of [...watch.get(entry.target) ?? []]) fn(entry);
};
const add = <E>(watch: Watch<E>, element: Element, fn: (entry: E) => void) => {
  const own = watch.get(element);
  if (own) { own.add(fn); return false; }
  watch.set(element, new Set([fn]));
  return true;
};
const drop = <E>(watch: Watch<E>, element: Element, fn: (entry: E) => void) => {
  const own = watch.get(element);
  if (!own?.delete(fn) || own.size) return false;
  watch.delete(element);
  return true;
};
/** A size observation through the page's one ResizeObserver. Returns the unobserve. */
export function observeSize(element: Element, fn: (entry: ResizeObserverEntry) => void) {
  if (typeof ResizeObserver !== 'function') return () => {};
  resizeObserver ??= new ResizeObserver(dispatch(sizes));
  if (add(sizes, element, fn)) resizeObserver.observe(element);
  // A second watcher of an element already observed hears nothing until it changes: tell it the current size now.
  else queueMicrotask(() => { if (sizes.get(element)?.has(fn)) fn({ target: element } as ResizeObserverEntry); });
  return () => {
    if (drop(sizes, element, fn)) resizeObserver?.unobserve(element);
    if (!sizes.size) { resizeObserver?.disconnect(); resizeObserver = null; }
  };
}
/** Visibility within `margin` through one IntersectionObserver per margin. Returns the unobserve. */
export function observeView(element: Element, margin: string, fn: (entry: IntersectionObserverEntry) => void) {
  if (typeof IntersectionObserver !== 'function') return () => {};
  let view = views.get(margin);
  if (!view) {
    const watch: Watch<IntersectionObserverEntry> = new Map();
    view = { observer: new IntersectionObserver(dispatch(watch), { rootMargin: margin }), watch };
    views.set(margin, view);
  }
  const { observer, watch } = view;
  if (add(watch, element, fn)) observer.observe(element);
  else { observer.unobserve(element); observer.observe(element); }
  return () => {
    if (drop(watch, element, fn)) observer.unobserve(element);
    if (!watch.size) { observer.disconnect(); views.delete(margin); }
  };
}

/* ---------------- One context ---------------- */

interface TimerExt { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }
type GlCanvas = OffscreenCanvas | HTMLCanvasElement;

/** How long the context outlives the page's last field. */
const IDLE_MS = 3000;
/**
 * GPU memory the page's fields may hold together: their textures and render targets, the shared atlases, the shared drawing
 * buffer and each field's own canvas. Past it, kit fields farthest off screen give way to their posters, and no more mount
 * until there is room. Fields mounted directly with mountGlyphField are counted but never released by it.
 */
export const FIELD_MEMORY_BUDGET = 256 * 1024 * 1024;
/**
 * Atlases no field uses any more, kept for a remount (or built ahead of a mount) and evicted oldest first past this many,
 * and all of them while over the memory budget. Each is a few glyph cells: a page's whole set costs little.
 */
export const SPARE_ATLASES = 32;
/** Render scale steps: weak GPUs draw fewer pixels per cell before any field gives up frames. */
const SCALES = [1, 0.85, 0.7, 0.58, 0.5];

export class FieldContext {
  gl!: WebGL2RenderingContext;
  canvas!: GlCanvas;
  lost = false;
  /** Index into SCALES; 0 is full resolution. */
  level = 0;
  private programs = new Map<string, SharedProgram>();
  private atlases = new Map<string, SharedAtlas>();
  private vertex: WebGLShader | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private clients = new Set<FieldClient>();
  private parallel: { COMPLETION_STATUS_KHR: number } | null = null;
  private timer: TimerExt | null = null;
  private queries: { query: WebGLQuery; frame: number }[] = [];
  private open: WebGLQuery | null = null;
  private drew = false;
  private gpuMs: number[] = [];
  private cpuMs: number[] = [];
  private changedAt = 0;
  private lostTimer = 0;
  renderer = '';
  /** At the lowest render scale and still over budget: ambient motion slows down too. */
  overloaded = false;

  constructor() { this.create(); }

  private create() {
    let canvas: GlCanvas | null = null, gl: WebGL2RenderingContext | null = null;
    const attributes: WebGLContextAttributes = { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' };
    // A detached canvas element rather than an OffscreenCanvas: Chrome links programs for an OffscreenCanvas context several
    // times slower, which delays every field's first frame.
    if (typeof document !== 'undefined') { canvas = document.createElement('canvas'); gl = canvas.getContext('webgl2', attributes); }
    if (!gl && typeof OffscreenCanvas === 'function') {
      try { canvas = new OffscreenCanvas(1, 1); gl = canvas.getContext('webgl2', attributes) as WebGL2RenderingContext | null; } catch { gl = null; }
    }
    if (!gl || !canvas) throw new Error('WebGL2 is not available for the glyph field.');
    this.canvas = canvas; this.gl = gl;
    this.lost = false;
    canvas.width = canvas.height = 1;
    this.parallel = gl.getExtension('KHR_parallel_shader_compile') as { COMPLETION_STATUS_KHR: number } | null;
    this.timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    this.renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
    (canvas as EventTarget).addEventListener?.('webglcontextlost', this.onLost);
    (canvas as EventTarget).addEventListener?.('webglcontextrestored', this.onRestored);
    // The two programs every field draws with start linking now, in the browser's compiler, so the first field rarely waits.
    const packed = !gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float');
    this.program(fieldCellShader(packed));
    this.program(FIELD_COMPOSITE);
  }
  private onLost = (event: Event) => {
    event.preventDefault();
    this.lost = true;
    this.reset();
    for (const client of [...this.clients]) client.lost();
    // A context the browser does not give back within a second is replaced with a new one.
    clearTimeout(this.lostTimer);
    this.lostTimer = setTimeout(() => {
      if (!this.lost) return;
      (this.canvas as EventTarget).removeEventListener?.('webglcontextlost', this.onLost);
      (this.canvas as EventTarget).removeEventListener?.('webglcontextrestored', this.onRestored);
      try { this.create(); } catch { return; }
      this.restored();
    }, 1000) as unknown as number;
  };
  private onRestored = () => { clearTimeout(this.lostTimer); this.lost = false; this.restored(); };
  private restored() { for (const client of [...this.clients]) client.restored(); }
  private reset() {
    this.programs.clear(); this.atlases.clear(); this.vertex = null; this.vao = null;
    this.queries = []; this.open = null; this.gpuMs = []; this.cpuMs = [];
  }

  private idleTimer = 0;
  join(client: FieldClient) { this.clients.add(client); clearTimeout(this.idleTimer); }
  leave(client: FieldClient) {
    this.clients.delete(client);
    if (this.clients.size) { this.fit(); return; }
    // Nothing left to draw: give the drawing buffer back at once, and the context itself once the page has gone a while
    // without a field (a route without any), so nothing stays on the GPU. A field mounting meanwhile keeps it.
    if (!this.lost) { this.canvas.width = this.canvas.height = 1; this.level = 0; }
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => { if (!this.clients.size) this.dispose(); }, IDLE_MS) as unknown as number;
  }
  private dispose() {
    clearTimeout(this.lostTimer);
    (this.canvas as EventTarget).removeEventListener?.('webglcontextlost', this.onLost);
    (this.canvas as EventTarget).removeEventListener?.('webglcontextrestored', this.onRestored);
    if (!this.lost) { try { this.gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* already gone */ } }
    this.reset();
    if (host === this) host = null;
  }

  /** The program for a fragment shader, linked once per context. Linking finishes in the browser's compiler. */
  program(fragment: string): SharedProgram {
    const known = this.programs.get(fragment);
    if (known) return known;
    const gl = this.gl;
    const compile = (type: number, code: string) => { const shader = gl.createShader(type)!; gl.shaderSource(shader, code); gl.compileShader(shader); return shader; };
    this.vertex ??= compile(gl.VERTEX_SHADER, VERTEX);
    const program = gl.createProgram()!, shader = compile(gl.FRAGMENT_SHADER, fragment);
    gl.attachShader(program, this.vertex); gl.attachShader(program, shader);
    gl.linkProgram(program);
    const entry = { program, locations: null, fragment: shader };
    this.programs.set(fragment, entry);
    return entry;
  }
  /** True once linked; collects uniform locations then. Throws if linking failed. */
  linked(entry: { program: WebGLProgram; locations: Locations | null; fragment?: WebGLShader }, wait = false): boolean {
    if (entry.locations) return true;
    const gl = this.gl;
    if (!wait && this.parallel && !gl.getProgramParameter(entry.program, this.parallel.COMPLETION_STATUS_KHR)) return false;
    if (!gl.getProgramParameter(entry.program, gl.LINK_STATUS)) {
      if (gl.isContextLost()) return false;
      throw new Error((entry.fragment && gl.getShaderInfoLog(entry.fragment)) || gl.getProgramInfoLog(entry.program) || 'Glyph field program failed to link.');
    }
    const locations: Locations = {};
    for (let i = gl.getProgramParameter(entry.program, gl.ACTIVE_UNIFORMS) - 1; i >= 0; i--) {
      const name = gl.getActiveUniform(entry.program, i)!.name.replace(/\[0\]$/, '');
      locations[name] = gl.getUniformLocation(entry.program, name);
    }
    entry.locations = locations;
    return true;
  }
  get canCompileInParallel() { return !!this.parallel; }
  vertexArray() { return (this.vao ??= this.gl.createVertexArray()); }

  /**
   * The glyph atlas for `key`, painted once and shared by every field drawing the same glyphs at the same size. `final` is
   * false when the font was still loading; the first field that sees it arrive repaints it for all.
   */
  atlas(key: string, paint: () => { image: TexImageSource; final: boolean }, user: () => void): SharedAtlas {
    let entry = this.atlases.get(key);
    if (!entry) {
      const gl = this.gl, texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      for (const [name, value] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, name, value);
      entry = { key, texture, refs: 0, final: false, users: new Set(), bytes: 0 };
      this.atlases.set(key, entry);
      this.paintAtlas(entry, paint);
    } else if (!entry.refs) {
      // A spare one in use again: most recently used last.
      this.atlases.delete(key);
      this.atlases.set(key, entry);
    }
    entry.refs++;
    entry.users.add(user);
    return entry;
  }
  /** True when the atlas for `key` exists, in use or spare. */
  hasAtlas(key: string) { return this.atlases.has(key); }
  paintAtlas(entry: SharedAtlas, paint: () => { image: TexImageSource; final: boolean }) {
    const gl = this.gl, { image, final } = paint();
    gl.bindTexture(gl.TEXTURE_2D, entry.texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
    entry.bytes = (image as { width: number }).width * (image as { height: number }).height * 4;
    entry.final = final;
    for (const user of [...entry.users]) user();
  }
  releaseAtlas(entry: SharedAtlas | null, user: () => void) {
    if (!entry || !entry.users.delete(user)) return;
    if (--entry.refs > 0) return;
    this.evictAtlases();
  }
  /** Deletes unused atlases past the spare count, oldest first, and all of them while over the memory budget. */
  private evictAtlases() {
    const spare = [...this.atlases.values()].filter(entry => !entry.refs);
    let excess = spare.length - SPARE_ATLASES;
    for (const entry of spare) {
      if (excess <= 0 && !this.overBudget) break;
      excess--;
      this.atlases.delete(entry.key);
      if (!this.lost) this.gl.deleteTexture(entry.texture);
    }
  }

  /** Shrinks the shared drawing buffer once the largest field it was grown for has gone. */
  private fit() {
    if (this.lost) return;
    let width = 1, height = 1;
    for (const client of this.clients) { const [w, h] = client.size(); width = Math.max(width, w); height = Math.max(height, h); }
    const canvas = this.canvas, step = (n: number) => Math.ceil(n / 256) * 256;
    if (canvas.width * canvas.height > step(width) * step(height) * 2) { canvas.width = step(width); canvas.height = step(height); }
  }
  /** GPU memory the page's fields hold now, in bytes (see FIELD_MEMORY_BUDGET). */
  get bytes() {
    let total = this.canvas.width * this.canvas.height * 4 * 2;
    for (const client of this.clients) total += client.bytes();
    for (const entry of this.atlases.values()) total += entry.bytes;
    return total;
  }
  get overBudget() { return this.bytes > FIELD_MEMORY_BUDGET; }
  /** Room for another field: a margin under the budget, so fields at its edge don't mount and release in turn. */
  get roomy() { return this.bytes < FIELD_MEMORY_BUDGET * 0.85; }

  /** Readies the shared drawing buffer for a frame of this size; it only grows, in steps, so fields rarely resize it. */
  begin(width: number, height: number) {
    const canvas = this.canvas;
    if (canvas.width < width || canvas.height < height) {
      const step = (n: number) => Math.ceil(n / 256) * 256;
      canvas.width = Math.max(canvas.width, step(width));
      canvas.height = Math.max(canvas.height, step(height));
    }
    if (!this.drew) {
      this.drew = true;
      if (this.timer && !this.open && this.queries.length < 4) {
        const query = this.gl.createQuery();
        if (query) { this.gl.beginQuery(this.timer.TIME_ELAPSED_EXT, query); this.open = query; }
      }
    }
  }
  /** Copies the frame just drawn (the bottom-left `width` x `height` of the shared buffer) to a field's canvas. */
  present(target: CanvasRenderingContext2D, width: number, height: number) {
    target.globalCompositeOperation = 'copy';
    target.imageSmoothingEnabled = false;
    target.drawImage(this.canvas as CanvasImageSource, 0, this.canvas.height - height, width, height, 0, 0, width, height);
  }

  /** After each shared frame: collects GPU time where the browser reports it, else main-thread draw time, and sets the scale. */
  endFrame(now: number) {
    if (this.lost) { this.drew = false; return; }
    const gl = this.gl, timer = this.timer;
    if (this.drew) {
      this.cpuMs.push(performance.now() - frameStart);
      if (this.cpuMs.length > 60) this.cpuMs.shift();
      if (timer && this.open) { gl.endQuery(timer.TIME_ELAPSED_EXT); this.queries.push({ query: this.open, frame: now }); this.open = null; }
    }
    this.drew = false;
    if (timer) {
      const disjoint = gl.getParameter(timer.GPU_DISJOINT_EXT);
      while (this.queries.length && gl.getQueryParameter(this.queries[0].query, gl.QUERY_RESULT_AVAILABLE)) {
        const { query } = this.queries.shift()!;
        if (!disjoint) { this.gpuMs.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6); if (this.gpuMs.length > 60) this.gpuMs.shift(); }
        gl.deleteQuery(query);
      }
    }
    this.adapt(now);
  }
  private adapt(now: number) {
    // GPU time where measured; otherwise the loop's frame gaps, which grow when the GPU (or anything) falls behind.
    const interval = frameInterval();
    // Five samples settle it when the GPU is far behind; ten otherwise.
    const behind = this.gpuMs.length >= 5 && Math.min(...this.gpuMs.slice(-5)) > interval * 1.5;
    const samples = this.gpuMs.length >= 10 || behind ? this.gpuMs : null;
    let load: number;
    if (samples) load = [...samples].sort((a, b) => a - b)[Math.floor(samples.length * 0.75)] / interval;
    else {
      if (gaps.length < 30 || this.cpuMs.length < 10) return;
      // Frames falling behind while the fields' own main-thread work is light: the GPU is the likelier cause.
      const recent = gaps.slice(-30).sort((a, b) => a - b), cpu = [...this.cpuMs].sort((a, b) => a - b)[this.cpuMs.length >> 1];
      load = recent[Math.floor(recent.length * 0.75)] / interval > 1.6 && cpu < interval * 0.5 ? 1 : 0.5;
    }
    this.overloaded = load > 0.8 && this.atMinimum;
    if (now - this.changedAt < (load > 0.8 ? 800 : 4000)) return;
    let next = this.level;
    // Twice over budget goes straight to the lowest scale: one step at a time would take seconds of dropped frames.
    if (load > 2) next = SCALES.length - 1;
    else if (load > 0.8 && next < SCALES.length - 1) next++;
    else if (load < 0.3 && next > 0) next--;
    if (next === this.level) return;
    this.level = next;
    this.changedAt = now;
    this.gpuMs = []; this.cpuMs = [];
    for (const client of [...this.clients]) client.rescale();
  }
  get scale() { return SCALES[this.level]; }
  get atMinimum() { return this.level === SCALES.length - 1; }
}

export interface FieldClient {
  lost(): void;
  restored(): void;
  rescale(): void;
  /** The field's frame in device pixels. */
  size(): [number, number];
  /** GPU memory the field holds of its own, in bytes. */
  bytes(): number;
}

let host: FieldContext | null = null, failed = false;
/** The page's shared field context, or null where it cannot be made (no WebGL2, no 2D blit). */
export function fieldContext(): FieldContext | null {
  if (host || failed) return host;
  try { host = new FieldContext(); } catch { failed = true; }
  return host;
}
/** The page's shared context if one exists, without making one. */
export const currentFieldContext = () => host;
const shared = new WeakSet<object>();
/** Marks a canvas as drawn through the shared context. */
export const markShared = (canvas: object, on: boolean) => { if (on) shared.add(canvas); else shared.delete(canvas); };
/** True for a field canvas drawn through the shared context: it holds no WebGL context of its own. */
export const isSharedFieldCanvas = (canvas: object) => shared.has(canvas);
