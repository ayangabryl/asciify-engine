/**
 * The page a glyph field expects, stood in for inside a worker (see field-worker.ts). Imported before the field so it is in
 * place when the field's modules first look: the page's layout, visibility, media queries, observers and pointer arrive as
 * messages from the page (field-offscreen.ts) and are replayed here through the same APIs the field uses on a page.
 */

type Listener = (event: Event) => void;
const scope = self as unknown as Record<string, unknown> & { addEventListener(type: string, fn: Listener, options?: unknown): void; dispatchEvent(event: Event): boolean };

/** What the page last said: the canvas's layout box, the pixel ratio, visibility and preferences. */
export const page = {
  width: 0, height: 0, left: 0, top: 0,
  hidden: false,
  reducedMotion: false,
  darkScheme: false,
};

// Element classes the field checks sources against: none of them exist here, so every check is false.
for (const name of ['HTMLElement', 'HTMLImageElement', 'HTMLVideoElement', 'HTMLCanvasElement', 'Element']) {
  if (typeof scope[name] !== 'function') scope[name] = class {};
}

const listeners = (target: Map<string, Set<Listener>>) => ({
  addEventListener(type: string, fn: Listener) { if (!target.has(type)) target.set(type, new Set()); target.get(type)!.add(fn); },
  removeEventListener(type: string, fn: Listener) { target.get(type)?.delete(fn); },
});
const fire = (target: Map<string, Set<Listener>>, type: string, event: Event) => { for (const fn of [...target.get(type) ?? []]) fn(event); };

// Font faces are the page's (its stylesheets are not readable here): the page paints the glyph atlas, and a face arriving
// is announced as on a page, so the field asks for its atlas again.
const fontEvents = new Map<string, Set<Listener>>();
export const fonts = {
  ...listeners(fontEvents),
  load: () => Promise.resolve([] as FontFace[]),
  check: () => true,
  ready: Promise.resolve(),
  /** Tells the field that a face of `family` is ready. */
  announce(family: string) { fire(fontEvents, 'loadingdone', Object.assign(new Event('loadingdone'), { fontfaces: [{ family }] })); },
};

const documentEvents = new Map<string, Set<Listener>>();
scope.document = {
  ...listeners(documentEvents),
  get hidden() { return page.hidden; },
  fonts,
  documentElement: null,
  body: null,
  createElement(tag: string) {
    if (tag === 'canvas') return new OffscreenCanvas(1, 1);
    throw new Error(`A glyph field in a worker cannot create a <${tag}>.`);
  },
};
/** The page was shown or hidden. */
export const setHidden = (hidden: boolean) => { page.hidden = hidden; fire(documentEvents, 'visibilitychange', new Event('visibilitychange')); };

// The window's events (the pointer) are dispatched on the worker's own scope, where the field listens for them.
scope.window = self;
if (typeof scope.devicePixelRatio !== 'number') scope.devicePixelRatio = 1;

const queries = new Map<string, { matches: boolean; events: Map<string, Set<Listener>> }>();
const queryValue = (query: string) => (/reduced-motion/.test(query) ? page.reducedMotion : /color-scheme:\s*dark/.test(query) ? page.darkScheme : false);
scope.matchMedia = (query: string) => {
  let entry = queries.get(query);
  if (!entry) queries.set(query, entry = { matches: queryValue(query), events: new Map() });
  const known = entry;
  return { media: query, get matches() { return known.matches; }, ...listeners(known.events) };
};
/** The page's media preferences changed. */
export const setMedia = (reducedMotion: boolean, darkScheme: boolean) => {
  page.reducedMotion = reducedMotion; page.darkScheme = darkScheme;
  for (const [query, entry] of queries) {
    const next = queryValue(query);
    if (next === entry.matches) continue;
    entry.matches = next;
    fire(entry.events, 'change', Object.assign(new Event('change'), { matches: next, media: query }));
  }
};

// Size and visibility observers, told by the page.
const resizeCallbacks = new Set<(entries: { target: unknown }[]) => void>();
scope.ResizeObserver = class {
  constructor(private callback: (entries: { target: unknown }[]) => void) {}
  observe() { resizeCallbacks.add(this.callback); }
  unobserve() { resizeCallbacks.delete(this.callback); }
  disconnect() { resizeCallbacks.delete(this.callback); }
};
const viewCallbacks = new Set<(entries: { target: unknown; isIntersecting: boolean }[]) => void>();
let targetOf: unknown = null, visible = true;
scope.IntersectionObserver = class {
  constructor(private callback: (entries: { target: unknown; isIntersecting: boolean }[]) => void) {}
  observe(target: unknown) { targetOf = target; viewCallbacks.add(this.callback); queueMicrotask(() => this.callback([{ target, isIntersecting: visible }])); }
  unobserve() { viewCallbacks.delete(this.callback); }
  disconnect() { viewCallbacks.delete(this.callback); }
};
/** The canvas's layout box changed (size, or place on the page). */
export const setBox = (width: number, height: number, left: number, top: number) => {
  const resized = width !== page.width || height !== page.height;
  Object.assign(page, { width, height, left, top });
  if (resized) for (const callback of [...resizeCallbacks]) callback([{ target: targetOf }]);
};
/** The canvas scrolled into or out of view. */
export const setVisible = (value: boolean) => {
  visible = value;
  for (const callback of [...viewCallbacks]) callback([{ target: targetOf, isIntersecting: value }]);
};

/** A pointer event from the page, replayed where the field listens for the window's. */
export const replayPointer = (type: string, init: { clientX: number; clientY: number; pointerType?: string; buttons?: number }) => {
  if (type === 'pointerleave') { fire(documentEvents, 'pointerleave', new Event('pointerleave')); return; }
  const event = Object.assign(new Event(type), init, { composedPath: () => [] });
  scope.dispatchEvent(event);
};

// Workers have animation frames where OffscreenCanvas does; where not, a 60 Hz timer stands in.
if (typeof scope.requestAnimationFrame !== 'function') {
  scope.requestAnimationFrame = (fn: FrameRequestCallback) => setTimeout(() => fn(performance.now()), 16) as unknown as number;
  scope.cancelAnimationFrame = (id: number) => clearTimeout(id);
}

/**
 * The transferred canvas, given what the field reads of a canvas element: its layout size and box, as the page last said.
 */
export function asFieldCanvas(canvas: OffscreenCanvas): HTMLCanvasElement {
  const shaped = canvas as unknown as Record<string, unknown>;
  Object.defineProperties(shaped, {
    clientWidth: { get: () => page.width, configurable: true },
    clientHeight: { get: () => page.height, configurable: true },
    ownerDocument: { value: undefined, configurable: true },
  });
  shaped.getBoundingClientRect = () => ({ left: page.left, top: page.top, x: page.left, y: page.top, width: page.width, height: page.height, right: page.left + page.width, bottom: page.top + page.height });
  shaped.setAttribute = () => {};
  shaped.removeAttribute = () => {};
  shaped.dataset = {};
  shaped.style = {};
  return canvas as unknown as HTMLCanvasElement;
}
