import { afterEach, beforeEach, vi, type Mock } from 'vitest';

/* A small DOM for the phase 2b kit tests: enough element, style, canvas, event and observer behaviour for the kit to run in Node. */

const context2d = () => new Proxy({} as Record<string | symbol, unknown>, {
  get(target, key) {
    if (key in target) return target[key];
    if (key === 'measureText') return () => ({ width: 8, fontBoundingBoxAscent: 11, fontBoundingBoxDescent: 3 });
    if (key === 'createImageData') return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
    if (key === 'getImageData') return (_x: number, _y: number, w = 1, h = 1) => ({ data: new Uint8ClampedArray(Math.max(1, w * h) * 4).map((_, i) => (i * 37) % 256), width: w, height: h });
    if (key === 'createLinearGradient' || key === 'createConicGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
    if (key === 'drawImage' || key === 'fillRect' || key === 'fillText' || key === 'stroke' || key === 'putImageData') return (target[key] = vi.fn());
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

export class FakeElement extends FakeNode {
  style = new FakeStyle();
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  childNodes: FakeNode[] = [];
  listeners = new Map<string, Set<(event: unknown) => void>>();
  rect = { left: 0, top: 0, width: 200, height: 40 };
  hidden = false;
  tabIndex = 0;
  width = 300;
  height = 150;
  className = '';
  type = '';
  value = '';
  accept = '';
  draggable = true;
  innerHTML = '';
  scrollTop = 0;
  files: unknown[] | null = null;
  click = vi.fn(() => this.dispatch('click'));
  animate = vi.fn();
  focus = vi.fn();
  setPointerCapture = vi.fn();
  constructor(public tagName = 'DIV') { super(); }
  get children() { return this.childNodes.filter((n): n is FakeElement => n instanceof FakeElement); }
  get isConnected() { let n: FakeElement = this; while (n.parentElement) n = n.parentElement; return n.tagName === 'HTML'; }
  get clientWidth() { return this.rect.width; }
  get clientHeight() { return this.rect.height; }
  get offsetWidth() { return this.rect.width; }
  get offsetHeight() { return this.rect.height; }
  get textContent(): string { return this.childNodes.length ? this.childNodes.map(n => n.textContent).join('') : this.textValue; }
  set textContent(value: string) { this.childNodes = []; this.textValue = ''; if (value) this.appendChild(new FakeText(value)); }
  getBoundingClientRect() { return { ...this.rect, right: this.rect.left + this.rect.width, bottom: this.rect.top + this.rect.height }; }
  appendChild<T extends FakeNode>(node: T | string) { const n = typeof node === 'string' ? new FakeText(node) : node; n.remove(); n.parentElement = this; this.childNodes.push(n); return n as T; }
  append(...nodes: (FakeNode | string)[]) { nodes.forEach(n => this.appendChild(n)); }
  removeChild(node: FakeNode) { this.childNodes = this.childNodes.filter(n => n !== node); node.parentElement = null; }
  replaceChildren(...nodes: FakeNode[]) { for (const n of this.childNodes) n.parentElement = null; this.childNodes = []; nodes.forEach(n => this.appendChild(n)); }
  prepend(node: FakeNode) { node.remove(); node.parentElement = this; this.childNodes.unshift(node); }
  insertBefore(node: FakeNode, before: FakeNode | null) { node.remove(); node.parentElement = this; const i = before ? this.childNodes.indexOf(before) : -1; if (i < 0) this.childNodes.push(node); else this.childNodes.splice(i, 0, node); return node; }
  setAttribute(name: string, value: string) { this.attributes.set(name, String(value)); if (name === 'style') String(value).split(';').forEach(rule => { const [k, v] = rule.split(':'); if (k && v) this.style[k.trim().replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v.trim(); }); }
  getAttribute(name: string) {
    if (name.startsWith('data-')) return this.dataset[name.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] ?? null;
    return this.attributes.get(name) ?? null;
  }
  hasAttribute(name: string) { return this.attributes.has(name); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  addEventListener(type: string, fn: (event: unknown) => void) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type)!.add(fn); }
  removeEventListener(type: string, fn: (event: unknown) => void) { this.listeners.get(type)?.delete(fn); }
  dispatch(type: string, event: Record<string, unknown> = {}) {
    const e = { currentTarget: this, target: this, button: 0, pointerId: 1, preventDefault: vi.fn(), ...event };
    for (const fn of this.listeners.get(type) ?? []) fn(e);
    return e;
  }
  listenerCount() { let n = 0; for (const set of this.listeners.values()) n += set.size; return n; }
  contains(node: FakeNode | null): boolean { for (let n: FakeNode | null = node; n; n = n.parentElement) if (n === this) return true; return false; }
  all(): FakeElement[] { return this.children.flatMap(c => [c, ...c.all()]); }
  matches(selector: string) {
    const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (attr) {
      const name = attr[1], data = name.startsWith('data-') ? name.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase()) : null;
      const value = data ? this.dataset[data] : this.attributes.get(name);
      return value !== undefined && (attr[2] === undefined || value === attr[2]);
    }
    if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1));
    return selector === ':focus-visible' ? false : this.tagName.toLowerCase() === selector.toLowerCase();
  }
  closest(selector: string) { for (let n: FakeElement | null = this; n; n = n.parentElement) if (n.matches(selector)) return n; return null; }
  querySelectorAll(selector: string) { return this.all().filter(el => el.matches(selector)); }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  getContext(kind: string) { return kind === '2d' ? (this.ctx ??= context2d()) : null; }
  toBlob(fn: (blob: Blob | null) => void) { fn(new Blob(['png'], { type: 'image/png' })); }
  private ctx?: ReturnType<typeof context2d>;
}
export class FakeImage extends FakeElement {
  complete = true; naturalWidth = 0; naturalHeight = 0; crossOrigin: string | null = null; decoding = ''; alt = ''; declare src: string;
  constructor() { super('IMG'); }
  /** Finishes loading with a picture of this size. */
  load(w = 320, h = 200) { this.naturalWidth = w; this.naturalHeight = h; this.dispatch('load'); }
}

export interface Dom {
  frames: Map<number, FrameRequestCallback>;
  field: ReturnType<typeof fakeField>;
  reduced: boolean;
  styles: Map<FakeElement, Record<string, string>>;
  observers: { disconnect: Mock }[];
  docListeners: Map<string, () => void>;
  readonly clock: number;
  body: FakeElement;
  head: FakeElement;
  /** Runs the queued animation frames `ms` later. */
  advance(ms?: number): void;
  /** Runs frames until none are queued, or `limit` of them. */
  settle(limit?: number, ms?: number): void;
  flush(): Promise<void>;
  element(tag?: string): FakeElement;
  canvases(root: FakeElement): FakeElement[];
  /** The 2D context of the source canvas the kit paints into. */
  pen(): Record<string, Mock>;
}

export function fakeField() {
  return {
    canvas: new FakeElement('CANVAS'), ready: Promise.resolve(), settings: {}, update: vi.fn(), setSource: vi.fn(async () => {}), pointer: vi.fn(), redraw: vi.fn(),
    pulse: vi.fn(), play: vi.fn(), pause: vi.fn(), resize: vi.fn(), destroy: vi.fn(),
  };
}

export const asElement = (el: FakeElement) => el as unknown as HTMLElement;

/** Installs the fake DOM before each test. `mount` is the mocked `mountGlyphField`; `support.on` switches WebGL2 off. */
export function useFakeDom(mount: Mock, support: { on: boolean }): Dom {
  let clock = 0, id = 0;
  const dom = {
    frames: new Map(), field: fakeField(), reduced: false, styles: new Map(), observers: [], docListeners: new Map(),
    get clock() { return clock; },
    body: new FakeElement('BODY'), head: new FakeElement('HEAD'),
    advance(ms = 16) { clock += ms; const work = [...dom.frames.values()]; dom.frames.clear(); for (const fn of work) fn(clock); },
    settle(limit = 400, ms = 16) { for (let i = 0; i < limit && dom.frames.size; i++) dom.advance(ms); },
    async flush() { for (let i = 0; i < 6; i++) await Promise.resolve(); },
    element(tag = 'DIV') { const el = new FakeElement(tag); dom.body.appendChild(el); return el; },
    canvases(root: FakeElement) { return root.all().filter(el => el.tagName === 'CANVAS' && el.dataset.asciiKit !== undefined); },
    pen() {
      const sources = dom.field.setSource.mock.calls as unknown as [FakeElement][];
      const art = sources[sources.length - 1]?.[0];
      return (art?.getContext('2d') ?? {}) as Record<string, Mock>;
    },
  } as Dom;

  beforeEach(() => {
    mount.mockReset(); support.on = true; clock = 0; id = 0;
    dom.frames.clear(); dom.docListeners.clear(); dom.observers.length = 0; dom.styles.clear(); dom.reduced = false;
    dom.field = fakeField(); mount.mockImplementation(() => dom.field);
    const root = new FakeElement('HTML');
    dom.body = new FakeElement('BODY'); dom.head = new FakeElement('HEAD');
    root.append(dom.head, dom.body);
    vi.stubGlobal('HTMLElement', FakeElement);
    vi.stubGlobal('HTMLImageElement', FakeImage);
    vi.stubGlobal('document', {
      hidden: false, body: dom.body, head: dom.head, documentElement: root,
      createElement: (tag: string) => (tag === 'img' ? new FakeImage() : new FakeElement(tag.toUpperCase())),
      createTextNode: (text: string) => new FakeText(text),
      addEventListener: (type: string, fn: () => void) => dom.docListeners.set(type, fn),
      removeEventListener: (type: string) => dom.docListeners.delete(type),
      getElementById: (id: string) => root.all().find(el => el.attributes.get('id') === id) ?? null,
      createRange: () => ({ setStart() {}, setEnd() {}, getClientRects: () => [{ left: 10, top: 4, width: 30, height: 12 }] }),
      createTreeWalker: (start: FakeElement) => {
        const texts: FakeText[] = [];
        const walk = (el: FakeElement) => el.childNodes.forEach(n => (n instanceof FakeText ? texts.push(n) : n instanceof FakeElement && walk(n)));
        walk(start);
        return { nextNode: () => texts.shift() ?? null };
      },
    });
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { dom.frames.set(++id, fn); return id; });
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => dom.frames.delete(handle));
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduced') ? dom.reduced : false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    vi.stubGlobal('getComputedStyle', (el: FakeElement) => {
      const own = dom.styles.get(el) ?? {};
      const base: Record<string, string> = {
        position: 'static', color: 'rgb(20, 20, 20)', backgroundColor: 'rgb(10, 10, 10)', fontSize: '15px', lineHeight: '24px', fontWeight: '500', fontStyle: 'normal',
        fontFamily: 'mono', letterSpacing: 'normal', paddingTop: '0px', paddingLeft: '0px', borderTopLeftRadius: '12px', borderTopRightRadius: '12px',
        borderBottomRightRadius: '12px', borderBottomLeftRadius: '12px', ...own,
      };
      return { ...base, getPropertyValue: (name: string) => own[name] ?? '' };
    });
    class Observer { constructor(public fn?: unknown) { dom.observers.push(this as never); } observe() {} unobserve() {} disconnect = vi.fn(); }
    vi.stubGlobal('ResizeObserver', Observer);
    vi.stubGlobal('IntersectionObserver', Observer);
    vi.stubGlobal('MutationObserver', Observer);
    vi.stubGlobal('performance', { now: () => clock });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  return dom;
}
