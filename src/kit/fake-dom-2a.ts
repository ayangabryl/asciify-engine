import { afterEach, beforeEach, vi, type Mock } from 'vitest';

/* A small DOM for the phase 2a kit tests: enough element, style, canvas, event and observer behaviour for the kit to run in Node. */

const context2d = () => new Proxy({} as Record<string | symbol, unknown>, {
  get(target, key) {
    if (key in target) return target[key];
    if (key === 'measureText') return () => ({ width: 8, fontBoundingBoxAscent: 11, fontBoundingBoxDescent: 3 });
    if (key === 'createImageData') return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
    if (key === 'getImageData') return (_x: number, _y: number, w = 1, h = 1) => ({ data: new Uint8ClampedArray(Math.max(1, w * h) * 4).fill(200), width: w, height: h });
    if (key === 'createLinearGradient' || key === 'createConicGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
    if (key === 'drawImage') return (target.drawImage ??= vi.fn());
    return () => {};
  },
  set(target, key, value) { target[key] = value; return true; },
});

export class FakeStyle {
  [key: string]: unknown;
  private props = new Map<string, string>();
  setProperty(name: string, value: string) { this.props.set(name, value); }
  getPropertyValue(name: string) { return this.props.get(name) ?? ''; }
  removeProperty(name: string) { this.props.delete(name); }
}

export class FakeNode {
  parentElement: FakeElement | null = null;
  textValue = '';
  get textContent(): string { return this.textValue; }
  set textContent(value: string) { this.textValue = value; }
  remove() { this.parentElement?.removeChild(this); }
}
export class FakeText extends FakeNode { constructor(public data: string) { super(); this.textValue = data; } }

const windowListeners = new Map<string, Set<(event: unknown) => void>>();
export class FakeElement extends FakeNode {
  style = new FakeStyle();
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  childNodes: FakeNode[] = [];
  listeners = new Map<string, Set<(event: unknown) => void>>();
  rect = { left: 0, top: 0, width: 200, height: 40 };
  hidden = false;
  tabIndex = -1;
  width = 300;
  height = 150;
  value = '';
  placeholder = '';
  alt = '';
  src = '';
  captured = new Set<number>();
  animate = vi.fn(() => ({ cancel: vi.fn(), finished: Promise.resolve() }));
  focus = vi.fn(() => { (globalThis.document as unknown as { activeElement: unknown }).activeElement = this; });
  constructor(public tagName = 'DIV') { super(); }
  get children() { return this.childNodes.filter((n): n is FakeElement => n instanceof FakeElement); }
  get firstElementChild() { return this.children[0] ?? null; }
  get clientWidth() { return this.rect.width; }
  get clientHeight() { return this.rect.height; }
  get offsetWidth() { return this.rect.width; }
  get offsetHeight() { return this.rect.height; }
  get id() { return this.attributes.get('id') ?? ''; }
  get textContent(): string { return this.childNodes.length ? this.childNodes.map(n => n.textContent).join('') : this.textValue; }
  set textContent(value: string) { this.childNodes = []; this.textValue = ''; if (value) this.appendChild(new FakeText(value)); }
  getBoundingClientRect() { return { ...this.rect, right: this.rect.left + this.rect.width, bottom: this.rect.top + this.rect.height }; }
  appendChild<T extends FakeNode>(node: T) { node.remove(); node.parentElement = this; this.childNodes.push(node); return node; }
  insertBefore<T extends FakeNode>(node: T, before: FakeNode | null) {
    node.remove(); node.parentElement = this;
    const i = before ? this.childNodes.indexOf(before) : -1;
    if (i < 0) this.childNodes.push(node); else this.childNodes.splice(i, 0, node);
    return node;
  }
  removeChild(node: FakeNode) { this.childNodes = this.childNodes.filter(n => n !== node); node.parentElement = null; }
  replaceChildren(...nodes: FakeNode[]) { for (const n of this.childNodes) n.parentElement = null; this.childNodes = []; nodes.forEach(n => this.appendChild(n)); }
  setAttribute(name: string, value: string) { this.attributes.set(name, String(value)); if (name === 'hidden') this.hidden = true; }
  getAttribute(name: string) { return name === 'hidden' ? (this.hidden ? '' : null) : this.attributes.get(name) ?? null; }
  hasAttribute(name: string) { return name === 'hidden' ? this.hidden : name === 'tabindex' ? this.attributes.has(name) || this.tabIndex >= 0 : this.attributes.has(name); }
  removeAttribute(name: string) { this.attributes.delete(name); if (name === 'hidden') this.hidden = false; }
  toggleAttribute(name: string, on?: boolean) { const next = on ?? !this.attributes.has(name); if (next) this.attributes.set(name, ''); else this.attributes.delete(name); return next; }
  addEventListener(type: string, fn: (event: unknown) => void) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type)!.add(fn); }
  removeEventListener(type: string, fn: (event: unknown) => void) { this.listeners.get(type)?.delete(fn); }
  /** Fires `type` here and on each ancestor, like a bubbling event. */
  dispatch(type: string, event: Record<string, unknown> = {}) {
    const path: FakeElement[] = [];
    for (let n: FakeElement | null = this; n; n = n.parentElement) path.push(n);
    const full = { target: this, button: 0, pointerId: 1, clientX: 0, clientY: 0, preventDefault: vi.fn(), stopPropagation() {}, composedPath: () => path, ...event };
    // The window's capture listeners hear it first, as the shared pointer listener does in a browser.
    for (const fn of [...windowListeners.get(type) ?? []]) fn({ currentTarget: null, ...full });
    for (let n: FakeElement | null = this; n; n = n.parentElement) for (const fn of n.listeners.get(type) ?? []) fn({ currentTarget: n, ...full });
    return full;
  }
  setPointerCapture(id: number) { this.captured.add(id); }
  hasPointerCapture(id: number) { return this.captured.has(id); }
  releasePointerCapture(id: number) { this.captured.delete(id); }
  contains(node: FakeNode | null): boolean { for (let n: FakeNode | null = node; n; n = n.parentElement) if (n === this) return true; return false; }
  all(): FakeElement[] { return this.children.flatMap(c => [c, ...c.all()]); }
  matches(selector: string): boolean {
    if (selector.includes(',')) return selector.split(',').some(s => this.matches(s.trim()));
    if (selector === '*') return true;
    const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (attr) {
      const name = attr[1], data = name.startsWith('data-') ? name.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase()) : null;
      const value = data ? this.dataset[data] : this.attributes.get(name);
      return value !== undefined && (attr[2] === undefined || value === attr[2]);
    }
    return selector === ':focus-visible' ? false : this.tagName.toLowerCase() === selector.toLowerCase();
  }
  closest(selector: string) { for (let n: FakeElement | null = this; n; n = n.parentElement) if (n.matches(selector)) return n; return null; }
  querySelectorAll(selector: string) { return this.all().filter(el => el.matches(selector)); }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  getContext(kind: string) { return kind === '2d' ? (this.ctx ??= context2d()) : null; }
  ctx?: ReturnType<typeof context2d>;
}
export class FakeImage extends FakeElement { complete = true; naturalWidth = 0; naturalHeight = 0; currentSrc = ''; constructor() { super('IMG'); } }

export interface FakeEnv {
  frames: Map<number, FrameRequestCallback>;
  clock: number;
  reduced: boolean;
  styles: Map<FakeElement, Record<string, string>>;
  docListeners: Map<string, Set<(event: unknown) => void>>;
  visibility: ((entries: { isIntersecting: boolean }[]) => void)[];
  observers: { disconnect: Mock }[];
  timers: { at: number; fn: () => void; id: number }[];
  field: ReturnType<typeof fakeField>;
  body: FakeElement;
}

export function fakeField() {
  return {
    canvas: null, ready: Promise.resolve(), settings: { ink: '#1d1d1b' }, update: vi.fn(), setSource: vi.fn(async () => {}), pointer: vi.fn(), redraw: vi.fn(),
    pulse: vi.fn(), play: vi.fn(), pause: vi.fn(), resize: vi.fn(), destroy: vi.fn(),
  };
}

/** Installs the fake DOM before each test. `mount` is the mocked `mountGlyphField`; `support.on` is WebGL2. */
export function useFakeDom(mount: Mock, support: { on: boolean }) {
  const env = {} as FakeEnv;
  beforeEach(() => {
    mount.mockReset(); support.on = true;
    Object.assign(env, { frames: new Map(), clock: 0, reduced: false, styles: new Map(), docListeners: new Map(), visibility: [], observers: [], timers: [] });
    env.field = fakeField();
    mount.mockImplementation(() => env.field);
    let id = 0, timer = 0;
    const body = new FakeElement('BODY'), root = new FakeElement('HTML');
    root.appendChild(body);
    env.body = body;
    vi.stubGlobal('HTMLElement', FakeElement);
    vi.stubGlobal('HTMLImageElement', FakeImage);
    vi.stubGlobal('document', {
      hidden: false, body, documentElement: root, activeElement: body,
      createElement: (tag: string) => (tag === 'img' ? new FakeImage() : new FakeElement(tag.toUpperCase())),
      addEventListener: (type: string, fn: (event: unknown) => void) => { if (!env.docListeners.has(type)) env.docListeners.set(type, new Set()); env.docListeners.get(type)!.add(fn); },
      removeEventListener: (type: string, fn: (event: unknown) => void) => env.docListeners.get(type)?.delete(fn),
      getElementById: (key: string) => body.all().find(el => el.getAttribute('id') === key) ?? null,
      createRange: () => ({ setStart() {}, setEnd() {}, getClientRects: () => [{ left: 10, top: 4, width: 30, height: 12 }] }),
      createTreeWalker: (rootNode: FakeElement) => {
        const texts: FakeNode[] = [];
        const walk = (n: FakeElement) => n.childNodes.forEach(c => (c instanceof FakeElement ? walk(c) : texts.push(c)));
        walk(rootNode);
        let i = 0;
        return { nextNode: () => texts[i++] ?? null };
      },
    });
    windowListeners.clear();
    vi.stubGlobal('window', {
      addEventListener: (type: string, fn: (event: unknown) => void) => { if (!windowListeners.has(type)) windowListeners.set(type, new Set()); windowListeners.get(type)!.add(fn); },
      removeEventListener: (type: string, fn: (event: unknown) => void) => windowListeners.get(type)?.delete(fn),
    });
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { env.frames.set(++id, fn); return id; });
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => env.frames.delete(handle));
    vi.stubGlobal('setTimeout', (fn: () => void, ms = 0) => { env.timers.push({ at: env.clock + ms, fn, id: ++timer }); return timer; });
    vi.stubGlobal('clearTimeout', (handle: number) => { env.timers = env.timers.filter(t => t.id !== handle); });
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduced') ? env.reduced : false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    vi.stubGlobal('getComputedStyle', (el: FakeElement) => {
      const own = env.styles.get(el) ?? {};
      const base: Record<string, string> = {
        position: 'static', color: 'rgb(20, 20, 20)', fontSize: '15px', fontWeight: '500', fontStyle: 'normal', fontFamily: 'mono', visibility: 'visible', display: 'block',
        backgroundColor: 'rgba(0, 0, 0, 0)', borderTopWidth: '0px', borderTopColor: 'rgb(0, 0, 0)', paddingLeft: '0px',
        borderTopLeftRadius: '10px', borderTopRightRadius: '10px', borderBottomRightRadius: '10px', borderBottomLeftRadius: '10px', ...own,
      };
      return { ...base, getPropertyValue: (name: string) => own[name] ?? '' };
    });
    class Observer { constructor(public fn?: (entries: { isIntersecting: boolean }[]) => void) { env.observers.push(this as never); } observe() {} unobserve() {} disconnect = vi.fn(); }
    class Visibility extends Observer { constructor(fn: (entries: { isIntersecting: boolean }[]) => void) { super(fn); env.visibility.push(fn); } }
    vi.stubGlobal('ResizeObserver', Observer);
    vi.stubGlobal('IntersectionObserver', Visibility);
    vi.stubGlobal('MutationObserver', Observer);
    vi.stubGlobal('performance', { now: () => env.clock });
  });
  afterEach(() => vi.unstubAllGlobals());

  /** Moves the clock on by `ms`, running the frames and the timers that fall due. */
  const advance = (ms = 16) => {
    env.clock += ms;
    const due = env.timers.filter(t => t.at <= env.clock);
    env.timers = env.timers.filter(t => t.at > env.clock);
    for (const t of due) t.fn();
    const work = [...env.frames.values()];
    env.frames.clear();
    for (const fn of work) fn(env.clock);
  };
  const run = (ms: number, step = 16) => { for (let t = 0; t < ms; t += step) advance(step); };
  const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
  const element = (tag = 'DIV', parent?: FakeElement) => { const el = new FakeElement(tag); (parent ?? env.body).appendChild(el); return el; };
  const as = (el: FakeElement) => el as unknown as HTMLElement;
  const canvases = (root: FakeElement) => root.all().filter(el => el.tagName === 'CANVAS' && el.dataset.asciiKit !== undefined);
  const key = (target: FakeElement, k: string, extra: Record<string, unknown> = {}) => target.dispatch('keydown', { key: k, ...extra });
  return { env, advance, run, flush, element, as, canvases, key };
}
