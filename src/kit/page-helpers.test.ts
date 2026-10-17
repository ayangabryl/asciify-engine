import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mount, support } = vi.hoisted(() => ({ mount: vi.fn(), support: { on: true } }));
vi.mock('../field', () => ({ isGlyphFieldSupported: () => support.on, mountGlyphField: mount }));

import { fieldBackground, lostTiles, SCATTER_STEPS } from './field-background';
import { wordmark, wordArt } from './wordmark';
import { asciiVideo } from './ascii-video';
import { artPanel } from './art-panel';
import { pricingGlow, savingRoom, planArt } from './pricing-glow';

/* A small DOM for the page helpers: elements, styles, 2D canvases that record text, observers and manual timers. */

let drawn: string[];
const context2d = (canvas: FakeElement) => new Proxy({ canvas } as Record<string | symbol, unknown>, {
  get(target, key) {
    if (key in target) return target[key];
    if (key === 'measureText') return (text: string) => ({ width: text.length * 200 });
    if (key === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) });
    if (key === 'fillText') return (text: string) => drawn.push(text);
    if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
    return () => {};
  },
  set(target, key, value) { target[key] = value; return true; },
});

class FakeStyle {
  [key: string]: unknown;
  private props = new Map<string, string>();
  setProperty(name: string, value: string) { this.props.set(name, value); }
  getPropertyValue(name: string) { return this.props.get(name) ?? ''; }
  removeProperty(name: string) { this.props.delete(name); }
}
class FakeNode {
  parentElement: FakeElement | null = null;
  textValue = '';
  get textContent(): string { return this.textValue; }
  set textContent(value: string) { this.textValue = value; }
  remove() { this.parentElement?.removeChild(this); }
}
class FakeText extends FakeNode { constructor(data: string) { super(); this.textValue = data; } }
class FakeElement extends FakeNode {
  style = new FakeStyle();
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  childNodes: FakeNode[] = [];
  listeners = new Map<string, Set<(event: unknown) => void>>();
  rect = { left: 0, top: 0, width: 300, height: 200 };
  width = 300;
  height = 150;
  constructor(public tagName = 'DIV') { super(); }
  get children() { return this.childNodes.filter((n): n is FakeElement => n instanceof FakeElement); }
  get offsetWidth() { return this.rect.width; }
  get offsetHeight() { return this.rect.height; }
  get textContent(): string { return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(value: string) { this.childNodes = []; if (value) this.appendChild(new FakeText(value)); }
  getBoundingClientRect() { return { ...this.rect, right: this.rect.left + this.rect.width, bottom: this.rect.top + this.rect.height }; }
  appendChild<T extends FakeNode>(node: T) { node.remove(); node.parentElement = this; this.childNodes.push(node); return node; }
  insertBefore(node: FakeNode, before: FakeNode | null) { node.remove(); node.parentElement = this; const i = before ? this.childNodes.indexOf(before) : -1; if (i < 0) this.childNodes.push(node); else this.childNodes.splice(i, 0, node); return node; }
  prepend(node: FakeNode) { node.remove(); node.parentElement = this; this.childNodes.unshift(node); }
  removeChild(node: FakeNode) { this.childNodes = this.childNodes.filter(n => n !== node); node.parentElement = null; }
  setAttribute(name: string, value: string) { this.attributes.set(name, String(value)); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  getAttributeNames() { return [...this.attributes.keys()]; }
  removeAttribute(name: string) { this.attributes.delete(name); }
  addEventListener(type: string, fn: (event: unknown) => void) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type)!.add(fn); }
  removeEventListener(type: string, fn: (event: unknown) => void) { this.listeners.get(type)?.delete(fn); }
  dispatch(type: string, event: Record<string, unknown> = {}) { for (const fn of this.listeners.get(type) ?? []) fn({ currentTarget: this, target: this, ...event }); }
  contains(node: FakeNode | null): boolean { for (let n: FakeNode | null = node; n; n = n.parentElement) if (n === this) return true; return false; }
  all(): FakeElement[] { return this.children.flatMap(c => [c, ...c.all()]); }
  querySelector(selector: string) {
    const attr = /^\[([\w-]+)\]$/.exec(selector);
    return this.all().find(el => (attr ? el.dataset[attr[1].replace(/^data-/, '')] !== undefined : el.tagName.toLowerCase() === selector)) ?? null;
  }
  getContext(kind: string) { return kind === '2d' ? (this.ctx ??= context2d(this)) : null; }
  private ctx?: ReturnType<typeof context2d>;
}
class FakeImage extends FakeElement { complete = true; naturalWidth = 400; naturalHeight = 300; src = ''; alt = ''; crossOrigin = ''; decode = async () => {}; constructor() { super('IMG'); } }
class FakeVideo extends FakeElement { muted = false; pause = vi.fn(); loop = false; playsInline = false; play = vi.fn(async () => {}); constructor() { super('VIDEO'); } }

let field: ReturnType<typeof fakeField>, styles: Map<FakeElement, Record<string, string>>, reduced: boolean, timers: (() => void)[], observers: { disconnect: ReturnType<typeof vi.fn> }[];
function fakeField() {
  return { canvas: null as unknown, ready: Promise.resolve(), settings: {}, update: vi.fn(), setSource: vi.fn(async (_s?: unknown) => {}), pointer: vi.fn(), redraw: vi.fn(), pulse: vi.fn(), play: vi.fn(), pause: vi.fn(), resize: vi.fn(), destroy: vi.fn() };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
/** Runs pending timers and the promises they release, `rounds` times. */
const tick = async (rounds = 1) => { for (let i = 0; i < rounds; i++) { const now = timers.splice(0); now.forEach(fn => fn()); await flush(); } };
const element = (tag = 'DIV') => { const el = new FakeElement(tag); (document.body as unknown as FakeElement).appendChild(el); return el; };
const as = (el: FakeElement) => el as unknown as HTMLElement;
const canvases = (root: FakeElement) => root.all().filter(el => el.tagName === 'CANVAS' && el.dataset.asciiKit !== undefined);
const look = (call = 0) => mount.mock.calls[call][1];

beforeEach(() => {
  mount.mockReset(); support.on = true; reduced = false; styles = new Map(); timers = []; observers = []; drawn = [];
  field = fakeField();
  mount.mockImplementation((canvas: FakeElement) => { field.canvas = canvas; return field; });
  const body = new FakeElement('BODY'), root = new FakeElement('HTML');
  root.appendChild(body);
  vi.stubGlobal('HTMLElement', FakeElement);
  vi.stubGlobal('HTMLImageElement', FakeImage);
  vi.stubGlobal('HTMLVideoElement', FakeVideo);
  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal('document', {
    body, documentElement: root,
    createElement: (tag: string) => (tag === 'img' ? new FakeImage() : tag === 'video' ? new FakeVideo() : new FakeElement(tag.toUpperCase())),
    createTextNode: (text: string) => new FakeText(text),
  });
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { timers.push(() => fn(0)); return ++id; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('setTimeout', (fn: () => void) => { timers.push(fn); return ++id; });
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduced') ? reduced : false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('getComputedStyle', (el: FakeElement) => {
    const own = styles.get(el) ?? {};
    return { position: 'static', color: 'rgb(20, 20, 20)', ...own, getPropertyValue: (name: string) => own[name] ?? '' };
  });
  class Observer { constructor(public fn?: () => void) { observers.push(this as never); } observe() {} disconnect = vi.fn(); }
  vi.stubGlobal('ResizeObserver', Observer);
  vi.stubGlobal('MutationObserver', Observer);
  vi.stubGlobal('performance', { now: () => 0 });
});
afterEach(() => vi.unstubAllGlobals());

describe('page helpers without WebGL2', () => {
  it('leave the page as it was and return inert handles', async () => {
    support.on = false;
    const box = element(), word = element(), panel = element(), card = element();
    word.textContent = 'asciify';
    const bg = fieldBackground(as(box)), mark = wordmark(as(word)), art = artPanel(as(panel), { image: '/wing.webp' }), glow = pricingGlow(as(card));
    const kits = [bg, mark, asciiVideo(as(element()), { src: '/clip.mp4' }), art, glow];
    for (const kit of kits) { expect(kit.supported).toBe(false); expect(kit.field).toBeNull(); kit.play(); kit.pause(); kit.update({}); }
    expect(mount).not.toHaveBeenCalled();
    expect(canvases(document.body as never)).toHaveLength(0);
    expect(box.style.getPropertyValue('position')).toBe('');
    await expect(bg.scatter()).resolves.toBeUndefined();
    await expect(glow.saving('−25%')).resolves.toBeUndefined();
    mark.setText('Ship it');
    expect(word.textContent).toBe('Ship it');
    art.shimmer(true);
    for (const kit of kits) kit.destroy();
  });
});

describe('fieldBackground', () => {
  it('draws the hero ground under the content with a soft clear zone, and ripples on movement', () => {
    const hero = element(), headline = element();
    const bg = fieldBackground(as(hero), { clear: as(headline) });
    const [canvas] = canvases(hero);
    expect(look()).toMatchObject({ scene: 'drift', mark: 'glyph', color: 'ink', ink: '#6b6964', clear: { element: headline, padding: -14, feather: 0.22, shape: 'ellipse' } });
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
    expect(canvas.getAttribute('style')).toContain('z-index:-1');
    expect(hero.style.getPropertyValue('isolation')).toBe('isolate');
    hero.dispatch('pointermove', { clientX: 100, clientY: 40 });
    hero.dispatch('pointermove', { clientX: 110, clientY: 40 });
    expect(field.pulse).toHaveBeenCalledTimes(1);
    bg.pulse(as(headline));
    expect(field.pulse).toHaveBeenLastCalledWith({ element: headline, strength: 1.4 });
    bg.destroy();
    expect(canvases(hero)).toHaveLength(0);
    expect(hero.listeners.get('pointermove')?.size).toBe(0);
    expect(hero.style.getPropertyValue('position')).toBe('');
    expect(field.destroy).toHaveBeenCalledOnce();
  });
  it('inks the brand preset from --brand and the palette per ground', () => {
    const a = element(), b = element();
    styles.set(a, { '--brand': '#ff3366' });
    fieldBackground(as(a), { preset: 'brand' }).destroy();
    expect(look(0).ink).toBe('#ff3366');
    styles.set(b, { color: 'rgb(240, 240, 240)' });
    fieldBackground(as(b), { palette: { light: '#111111', dark: '#eeeeee' } }).destroy();
    expect(look(1).ink).toBe('#eeeeee');
  });
  it('sets 404 in characters, then scatters and re-forms it', async () => {
    const box = element(), button = element('BUTTON');
    const bg = fieldBackground(as(box), { preset: 'notFound' });
    expect(look()).toMatchObject({ fit: 'contain', label: '404', clear: false });
    expect(look().source.tagName).toBe('CANVAS');
    expect(drawn).toContain('404');
    const done = bg.scatter(as(button));
    expect(field.pulse).toHaveBeenCalledWith({ element: button, strength: 1.2 });
    await tick(SCATTER_STEPS.length + 2);
    await done;
    expect(field.setSource).toHaveBeenCalledTimes(SCATTER_STEPS.length + 1);
    bg.destroy();
  });
  it('holds still under reduced motion', async () => {
    reduced = true;
    const bg = fieldBackground(as(element()), { preset: 'notFound' });
    await bg.scatter();
    expect(field.setSource).not.toHaveBeenCalled();
    expect(field.pulse).not.toHaveBeenCalled();
    bg.destroy();
    const forced = fieldBackground(as(element()), { reducedMotion: true });
    expect(look(1)).toMatchObject({ speed: 0, drift: 0 });
    forced.destroy();
  });
  it('breaks lit art into tiles', () => {
    const art = new FakeElement('CANVAS');
    art.width = 56; art.height = 28;
    expect(lostTiles(art as unknown as HTMLCanvasElement)).toHaveLength(2);
  });
});

describe('wordmark', () => {
  it('draws the element’s own word and keeps the text for screen readers', () => {
    const el = element();
    el.textContent = 'asciify';
    const w = wordmark(as(el));
    expect(el.style.getPropertyValue('color')).toBe('transparent');
    expect(canvases(el)[0].getAttribute('aria-hidden')).toBe('true');
    expect(drawn).toContain('asciify');
    w.setText('Ship it');
    expect(w.text).toBe('Ship it');
    expect(field.setSource).toHaveBeenCalledOnce();
    expect(el.textContent).toBe('Ship it');
    w.destroy();
    expect(el.style.getPropertyValue('color')).toBe('');
  });
  it('labels the canvas when the word is given', () => {
    const w = wordmark(as(element()), { text: 'Relay' });
    expect(look().label).toBe('Relay');
    w.setText('Lumen');
    expect(field.update).toHaveBeenCalledWith({ label: 'Lumen' });
    w.destroy();
    wordArt('x');
    expect(drawn[drawn.length - 1]).toBe('x');
  });
});

describe('asciiVideo', () => {
  it('plays a URL and toggles', () => {
    const v = asciiVideo(as(element()), { src: '/clip.mp4' });
    expect(look()).toMatchObject({ source: '/clip.mp4', label: 'Video, drawn in characters', fit: 'cover' });
    expect(v.playing).toBe(true);
    expect(v.toggle()).toBe(false);
    expect(field.pause).toHaveBeenCalledOnce();
    v.play();
    expect(v.playing).toBe(true);
    expect(field.play).toHaveBeenCalledOnce();
    v.destroy();
    v.play();
    expect(field.play).toHaveBeenCalledOnce();
  });
  it('draws the video inside, hidden, and starts paused under reduced motion', async () => {
    reduced = true;
    const el = element(), video = new FakeVideo();
    el.appendChild(video);
    const v = asciiVideo(as(el));
    expect(look().source).toBe(video);
    expect(video.style.getPropertyValue('opacity')).toBe('0');
    expect(video.muted).toBe(true);
    expect(v.playing).toBe(false);
    await flush();
    expect(field.pause).toHaveBeenCalled();
    v.destroy();
    expect(video.style.getPropertyValue('opacity')).toBe('');
  });
  it('holds a poster until the first frame, and while paused under reduced motion', async () => {
    const el = element();
    const v = asciiVideo(as(el), { src: '/clip.mp4', poster: '/clip.webp' });
    const poster = el.children.find(n => n.tagName === 'IMG') as FakeImage;
    expect(poster.src).toBe('/clip.webp');
    expect(poster.style.opacity).toBe('1');
    await flush();
    expect(poster.style.opacity).toBe('0');
    v.destroy();
    expect(el.children.find(n => n.tagName === 'IMG')).toBeUndefined();
    reduced = true;
    const still = element();
    const w = asciiVideo(as(still), { src: '/clip.mp4', poster: '/clip.webp' });
    const held = still.children.find(n => n.tagName === 'IMG') as FakeImage;
    await flush();
    expect(w.playing).toBe(false);
    expect(held.style.opacity).toBe('1');
    w.play();
    expect(held.style.opacity).toBe('0');
    w.pause();
    expect(held.style.opacity).toBe('1');
    w.destroy();
  });
  it('plays the video itself, with its poster, without WebGL2', () => {
    support.on = false;
    const el = element();
    const v = asciiVideo(as(el), { src: '/clip.mp4', poster: '/clip.webp' });
    const video = el.children.find(n => n.tagName === 'VIDEO') as FakeVideo & { src?: string; poster?: string };
    expect(v.supported).toBe(false);
    expect(video.src).toBe('/clip.mp4');
    expect(video.poster).toBe('/clip.webp');
    expect(video.muted).toBe(true);
    expect(video.play).toHaveBeenCalled();
    expect(v.toggle()).toBe(false);
    expect(v.playing).toBe(false);
    v.destroy();
    expect(el.children).toHaveLength(0);
  });
});

describe('artPanel', () => {
  it('draws the image, keeps the brand clear, pulses and shimmers', async () => {
    const panel = element(), img = new FakeImage(), brand = element();
    img.alt = 'A marble wing';
    panel.appendChild(img);
    const art = artPanel(as(panel), { clear: as(brand) });
    expect(look()).toMatchObject({ source: img, label: 'A marble wing', focus: { x: 0.5, y: 0.4 }, clear: { element: brand, padding: 8, feather: 0.12, shape: 'rect' } });
    expect(img.style.getPropertyValue('opacity')).toBe('0');
    const button = element('BUTTON');
    art.pulse(as(button), 1.8);
    expect(field.pulse).toHaveBeenCalledWith({ element: button, strength: 1.8 });
    art.shimmer(true);
    await flush();
    await tick(3);
    const frames = field.setSource.mock.calls.length;
    expect(frames).toBeGreaterThan(1);
    expect((field.setSource.mock.calls[0][0] as FakeElement).tagName).toBe('CANVAS');
    art.shimmer(false);
    expect(field.setSource).toHaveBeenLastCalledWith(img);
    await tick(3);
    expect(field.setSource.mock.calls.length).toBe(frames + 1);
    art.destroy();
    expect(img.style.getPropertyValue('opacity')).toBe('');
  });
});

describe('pricingGlow', () => {
  const card = () => {
    const el = element(), head = element(), price = element();
    el.appendChild(head); el.appendChild(price);
    head.rect = { left: 0, top: 10, width: 300, height: 40 };
    price.dataset.price = '';
    price.rect = { left: 0, top: 150, width: 300, height: 30 };
    return { el, price };
  };
  it('finds the open space above the price and sets the saving in it', () => {
    const { el, price } = card();
    expect(savingRoom(as(el), price as never)).toEqual({ middle: 100, height: 100 });
    planArt(as(el), '−25%', price as never);
    expect(drawn).toContain('−25%');
    drawn = [];
    price.rect.top = 60;
    planArt(as(el), '−25%', price as never);
    expect(drawn).toHaveLength(0);
  });
  it('sweeps between halftones and pulses from the button', async () => {
    const { el } = card();
    const glow = pricingGlow(as(el), { saving: null });
    expect(look()).toMatchObject({ mark: 'dot', hover: 'lantern', ink: '#5c5a55' });
    expect(drawn).toHaveLength(0);
    const done = glow.saving('−25%');
    await tick(12);
    await done;
    expect(drawn).toContain('−25%');
    expect(field.setSource).toHaveBeenCalledTimes(10);
    glow.pulse(as(el));
    expect(field.pulse).toHaveBeenCalledWith({ element: el, strength: 1.6 });
    glow.destroy();
    expect(observers.every(o => o.disconnect.mock.calls.length > 0)).toBe(true);
  });
});
