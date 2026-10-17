import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mount, support } = vi.hoisted(() => ({ mount: vi.fn(), support: { on: true } }));
vi.mock('../field', () => ({ isGlyphFieldSupported: () => support.on, mountGlyphField: mount }));

import { beam, beamPalette, BEAM_DEFAULTS, beamArcs, beamRing, beamCracked, beamBand } from './beam';
import { decode } from './decode';
import { odometer, firstChanged } from './odometer';
import { buttonLoading, letterCells, letterGlyph } from './button-loading';
import { statusOrb } from './status-orb';
import { skeleton, blockKind } from './skeleton';
import { pill, pillTone, pillLane, laneClip } from './pill';
import { tabs, streamSpan, indicatorRow } from './tabs';
import { imageGenerate, elapsedLabel } from './image-generate';
import { resolveColor, mixHex, handle, isDark } from './core';

/* A small DOM: enough element, style, canvas and observer behaviour for the kit to run in Node. */

const context2d = () => new Proxy({} as Record<string | symbol, unknown>, {
  get(target, key) {
    if (key in target) return target[key];
    if (key === 'measureText') return () => ({ width: 8, fontBoundingBoxAscent: 11, fontBoundingBoxDescent: 3 });
    if (key === 'createImageData') return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
    if (key === 'getImageData') return () => ({ data: new Uint8ClampedArray([12, 34, 56, 255]) });
    if (key === 'createLinearGradient' || key === 'createConicGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
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
class FakeText extends FakeNode { constructor(public data: string) { super(); this.textValue = data; } }

class FakeElement extends FakeNode {
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
  animate = vi.fn();
  focus = vi.fn();
  constructor(public tagName = 'DIV') { super(); }
  get children() { return this.childNodes.filter((n): n is FakeElement => n instanceof FakeElement); }
  get clientWidth() { return this.rect.width; }
  get clientHeight() { return this.rect.height; }
  get offsetWidth() { return this.rect.width; }
  get offsetHeight() { return this.rect.height; }
  get textContent(): string { return this.childNodes.length ? this.childNodes.map(n => n.textContent).join('') : this.textValue; }
  set textContent(value: string) { this.childNodes = []; this.textValue = ''; if (value) this.appendChild(new FakeText(value)); }
  getBoundingClientRect() { return { ...this.rect, right: this.rect.left + this.rect.width, bottom: this.rect.top + this.rect.height }; }
  appendChild<T extends FakeNode>(node: T) { node.remove(); node.parentElement = this; this.childNodes.push(node); return node; }
  removeChild(node: FakeNode) { this.childNodes = this.childNodes.filter(n => n !== node); node.parentElement = null; }
  replaceChildren(...nodes: FakeNode[]) { for (const n of this.childNodes) n.parentElement = null; this.childNodes = []; nodes.forEach(n => this.appendChild(n)); }
  insertBefore<T extends FakeNode>(node: T, before: FakeNode | null) { if (!before) return this.appendChild(node); node.remove(); node.parentElement = this; this.childNodes.splice(this.childNodes.indexOf(before), 0, node); return node; }
    prepend(node: FakeNode) { node.remove(); node.parentElement = this; this.childNodes.unshift(node); }
  setAttribute(name: string, value: string) { this.attributes.set(name, String(value)); if (name === 'style') String(value).split(';').forEach(rule => { const [k, v] = rule.split(':'); if (k && v) this.style[k.trim().replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v.trim(); }); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  hasAttribute(name: string) { return this.attributes.has(name); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  toggleAttribute(name: string, on: boolean) { if (on) this.attributes.set(name, ''); else this.attributes.delete(name); }
  addEventListener(type: string, fn: (event: unknown) => void) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type)!.add(fn); }
  removeEventListener(type: string, fn: (event: unknown) => void) { this.listeners.get(type)?.delete(fn); }
  dispatch(type: string, event: Record<string, unknown> = {}) { for (const fn of this.listeners.get(type) ?? []) fn({ currentTarget: this, target: this, preventDefault() {}, ...event }); }
  contains(node: FakeNode | null): boolean { for (let n: FakeNode | null = node; n; n = n.parentElement) if (n === this) return true; return false; }
  all(): FakeElement[] { return this.children.flatMap(c => [c, ...c.all()]); }
  matches(selector: string) {
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
  private ctx?: ReturnType<typeof context2d>;
}
class FakeImage extends FakeElement { complete = true; naturalWidth = 0; naturalHeight = 0; src = ''; constructor() { super('IMG'); } }

let frames: Map<number, FrameRequestCallback>, clock: number, docListeners: Map<string, () => void>, observers: { disconnect: ReturnType<typeof vi.fn> }[];
let visibility: ((entries: { isIntersecting: boolean }[]) => void)[];
let reduced: boolean, styles: Map<FakeElement, Record<string, string>>;
let field: ReturnType<typeof fakeField>;
function fakeField() {
  return {
    canvas: null, ready: Promise.resolve(), settings: {}, update: vi.fn(), setSource: vi.fn(async () => {}), pointer: vi.fn(), redraw: vi.fn(),
    pulse: vi.fn(), play: vi.fn(), pause: vi.fn(), resize: vi.fn(), destroy: vi.fn(),
  };
}
const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
function advance(ms = 16) { clock += ms; const work = [...frames.values()]; frames.clear(); for (const fn of work) fn(clock); }
const element = (tag = 'DIV') => { const el = new FakeElement(tag); document.body.appendChild(el as never); return el; };
const asElement = (el: FakeElement) => el as unknown as HTMLElement;
const canvases = (root: FakeElement) => root.all().filter(el => el.tagName === 'CANVAS' && el.dataset.asciiKit !== undefined);

beforeEach(() => {
  mount.mockReset(); support.on = true; clock = 0; frames = new Map(); docListeners = new Map(); observers = []; visibility = []; reduced = false; styles = new Map();
  field = fakeField(); mount.mockImplementation(() => field);
  let id = 0;
  const body = new FakeElement('BODY'), root = new FakeElement('HTML');
  root.appendChild(body);
  vi.stubGlobal('HTMLElement', FakeElement);
  vi.stubGlobal('HTMLImageElement', FakeImage);
  vi.stubGlobal('document', {
    hidden: false, body, documentElement: root,
    createElement: (tag: string) => (tag === 'img' ? new FakeImage() : new FakeElement(tag.toUpperCase())),
    addEventListener: (type: string, fn: () => void) => docListeners.set(type, fn),
    removeEventListener: (type: string) => docListeners.delete(type),
    getElementById: (id: string) => body.all().find(el => el.getAttribute('id') === id) ?? null,
    createRange: () => ({ selectNode() {}, selectNodeContents() {}, setStart() {}, setEnd() {}, getBoundingClientRect: () => ({ left: 10, right: 40, top: 0, width: 30, height: 10 }), getClientRects: () => [] }),
    createTreeWalker: () => ({ nextNode: () => null }),
  });
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.set(++id, fn); return id; });
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => frames.delete(handle));
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduced') ? reduced : false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('getComputedStyle', (el: FakeElement) => {
    const own = styles.get(el) ?? {};
    const base: Record<string, string> = { position: 'static', color: 'rgb(20, 20, 20)', fontSize: '15px', fontWeight: '500', fontStyle: 'normal', fontFamily: 'mono', letterSpacing: 'normal', paddingTop: '18px', paddingLeft: '20px', borderTopLeftRadius: '10px', borderTopRightRadius: '10px', borderBottomRightRadius: '10px', borderBottomLeftRadius: '10px', textTransform: 'none', ...own };
    return { ...base, getPropertyValue: (name: string) => own[name] ?? '' };
  });
  class Observer { constructor(public fn?: (entries: { isIntersecting: boolean }[]) => void) { observers.push(this as never); } observe() {} unobserve() {} disconnect = vi.fn(); }
  class Visibility extends Observer { constructor(fn: (entries: { isIntersecting: boolean }[]) => void) { super(fn); visibility.push(fn); } }
  vi.stubGlobal('ResizeObserver', Observer);
  vi.stubGlobal('IntersectionObserver', Visibility);
  vi.stubGlobal('MutationObserver', Observer);
  vi.stubGlobal('performance', { now: () => clock });
});
afterEach(() => vi.unstubAllGlobals());

describe('fallback without WebGL2', () => {
  beforeEach(() => { support.on = false; });
  it('leaves the HTML untouched and returns inert handles', () => {
    const card = element(), label = element('BUTTON'), figure = element('SPAN'), list = element();
    label.textContent = 'Deploy'; figure.textContent = '$1,200';
    const a = beam(asElement(card)), b = buttonLoading(asElement(label)), c = odometer(asElement(figure), { format: n => `$${n}` });
    const d = statusOrb(asElement(element())), e = skeleton(asElement(element())), f = pill(asElement(element())), g = tabs(asElement(list));
    const h = decode(asElement(element('H1'))), i = imageGenerate(asElement(element()));
    for (const kit of [a, b, c, d, e, f, g, h, i]) { expect(kit.supported).toBe(false); expect(kit.field).toBeNull(); }
    expect(canvases(document.body as never)).toHaveLength(0);
    expect(mount).not.toHaveBeenCalled();
    expect(card.style.position).toBeUndefined();
    expect(figure.textContent).toBe('$1,200');
    expect(label.textContent).toBe('Deploy');
    a.progress(0.5); a.success(); a.error(); d.loading(); d.success(); f.sheen(); f.count(3); h.replay(); a.play(); a.pause(); a.update({ palette: 'mono' });
    expect(frames.size).toBe(0);
    for (const kit of [a, b, c, d, e, f, g, h, i]) kit.destroy();
  });
  it('still updates the plain text where the component has meaning without the field', async () => {
    const button = element('BUTTON'), figure = element('SPAN');
    button.textContent = 'Save';
    const b = buttonLoading(asElement(button));
    b.start('Saving');
    expect(button.textContent).toBe('Saving');
    expect(button.getAttribute('aria-busy')).toBe('true');
    b.succeed('Saved');
    expect(button.textContent).toBe('Saved');
    expect(button.getAttribute('aria-busy')).toBeNull();
    const o = odometer(asElement(figure), { value: 5 });
    o.set(1200);
    expect(figure.textContent).toBe((1200).toLocaleString());
    await expect(skeleton(asElement(element())).resolve()).resolves.toBeUndefined();
  });
  it('shows image generation progress in the photo itself', async () => {
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:1', revokeObjectURL: vi.fn() });
    vi.stubGlobal('setTimeout', (fn: () => void) => { fn(); return 0; });
    const frame = element(), photo = new FakeImage();
    frame.appendChild(photo);
    const gen = imageGenerate(asElement(frame));
    expect(photo.style.getPropertyValue('visibility')).toBe('hidden');
    const seen: string[] = [];
    async function* stream() { yield { preview: '/p1.webp' }; seen.push(photo.src); yield { final: '/final.webp' }; }
    await expect(gen.run(stream)).resolves.toBe('done');
    expect(seen).toEqual(['/p1.webp']);
    expect(photo.src).toBe('/final.webp');
    expect(photo.style.getPropertyValue('visibility')).toBe('visible');
    gen.destroy();
    expect(photo.style.getPropertyValue('visibility')).toBe('');
  });
  it('falls back when mounting throws, removing what it added', () => {
    support.on = true;
    mount.mockImplementation(() => { throw new Error('no context'); });
    const card = element();
    const b = beam(asElement(card));
    expect(b.supported).toBe(false);
    expect(canvases(card)).toHaveLength(0);
    expect(card.style.getPropertyValue('position')).toBe('');
  });
});

describe('lifecycle', () => {
  it('mounts a decorative canvas that follows the element, then cleans up completely', async () => {
    const card = element();
    const b = beam(asElement(card));
    const [canvas] = canvases(card);
    expect(b.supported).toBe(true);
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
    expect(canvas.style.left).toBe('0px');
    expect(canvas.style.width).toBe('calc(100% + 0px)');
    expect(canvas.style.borderRadius).toBe('10px 10px 10px 10px');
    expect(card.style.getPropertyValue('position')).toBe('relative');
    const look = mount.mock.calls[0][1];
    expect(look).toMatchObject({ mark: 'dot', background: 'transparent', hover: 'none', levels: 'none', color: 'source' });
    advance(); await flush();
    expect(field.setSource).toHaveBeenCalled();
    expect(field.redraw).toHaveBeenCalled();
    expect(frames.size).toBe(1);
    b.pause();
    expect(field.pause).toHaveBeenCalled();
    expect(frames.size).toBe(0);
    advance();
    expect(frames.size).toBe(0);
    b.play();
    expect(field.play).toHaveBeenCalled();
    advance();
    expect(frames.size).toBe(1);
    b.destroy();
    expect(field.destroy).toHaveBeenCalledOnce();
    expect(canvases(card)).toHaveLength(0);
    expect(card.style.getPropertyValue('position')).toBe('');
    expect(frames.size).toBe(0);
    expect(observers.every(o => o.disconnect.mock.calls.length > 0)).toBe(true);
    expect(card.listeners.get('pointerenter')?.size ?? 0).toBe(0);
    expect(docListeners.has('visibilitychange')).toBe(false);
    b.destroy();
    expect(b.supported).toBe(false);
    expect(b.field).toBeNull();
  });
  it('pauses off screen and resumes when visible again', () => {
    const b = beam(asElement(element()));
    advance();
    visibility.forEach(fn => fn([{ isIntersecting: false }]));
    advance();
    expect(frames.size).toBe(0);
    visibility.forEach(fn => fn([{ isIntersecting: true }]));
    expect(frames.size).toBe(1);
    b.destroy();
  });
  it('tears itself down when the field reports an error', () => {
    const card = element();
    const b = beam(asElement(card));
    mount.mock.calls[0][1].onError(new Error('lost'));
    expect(b.supported).toBe(false);
    expect(canvases(card)).toHaveLength(0);
    expect(field.destroy).toHaveBeenCalledOnce();
  });
  it('keeps one handle shape across components', () => {
    const kits = [beam(asElement(element())), decode(asElement(element('H1'))), odometer(asElement(element())), buttonLoading(asElement(element('BUTTON'))),
      statusOrb(asElement(element())), skeleton(asElement(element())), pill(asElement(element())), tabs(asElement(element())), imageGenerate(asElement(element()))];
    for (const kit of kits) {
      for (const key of ['update', 'play', 'pause', 'destroy']) expect(typeof (kit as unknown as Record<string, unknown>)[key]).toBe('function');
      expect(kit.supported).toBe(true);
      kit.field?.pulse();
      expect(field.pulse).toHaveBeenCalled();
      kit.destroy();
    }
  });
});

describe('reduced motion', () => {
  it('draws one settled frame and stops, from the media query', () => {
    reduced = true;
    const b = beam(asElement(element()));
    advance();
    expect(field.setSource).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
    b.progress(0.4);
    advance();
    expect(field.setSource).toHaveBeenCalledTimes(2);
    expect(frames.size).toBe(0);
    b.destroy();
  });
  it('can be forced either way by the option', () => {
    reduced = true;
    const moving = beam(asElement(element()), { reducedMotion: false });
    advance();
    expect(frames.size).toBe(1);
    moving.destroy();
    reduced = false;
    const still = statusOrb(asElement(element()), { reducedMotion: true });
    still.loading();
    advance();
    expect(frames.size).toBe(0);
    still.success();
    advance();
    expect(field.pulse).not.toHaveBeenCalled();
    still.destroy();
  });
  it('skips the shake and resolves skeletons at once', async () => {
    const button = element('BUTTON');
    button.textContent = 'Deploy';
    const b = buttonLoading(asElement(button), { reducedMotion: true });
    b.fail('Retry');
    expect(button.animate).not.toHaveBeenCalled();
    const card = element(), block = new FakeElement('SPAN');
    block.dataset.block = 'text';
    card.appendChild(block);
    const s = skeleton(asElement(card), { reducedMotion: true });
    expect(block.style.getPropertyValue('opacity')).toBe('0');
    const done = s.resolve();
    advance();
    await expect(done).resolves.toBeUndefined();
    expect(block.style.getPropertyValue('opacity')).toBe('');
    expect(card.getAttribute('aria-busy')).toBeNull();
  });
});

describe('options', () => {
  it('merges defaults and applies updates to the field', () => {
    expect(BEAM_DEFAULTS).toMatchObject({ palette: 'colorful', mode: 'rotate', grain: 'dots', speed: 1 });
    const b = beam(asElement(element()), { palette: 'mono', look: { cellSize: 4 } });
    expect(mount.mock.calls[0][1]).toMatchObject({ color: 'ink', cellSize: 4, ink: '#8a8882' });
    b.update({ grain: 'glyphs', palette: 'ocean' });
    expect(field.update).toHaveBeenLastCalledWith(expect.objectContaining({ mark: 'glyph', color: 'source' }));
    b.destroy();
  });
  it('builds palettes from names or stops', () => {
    const named = beamPalette('sunset'), custom = beamPalette(['#ff0000']), empty = beamPalette([]);
    expect(custom[0]).toBe(1); expect(custom[1]).toBe(0); expect(custom[3]).toBeCloseTo(0.2126);
    expect(named.length).toBe(1024);
    expect(Array.from(empty.slice(0, 4))).toEqual(Array.from(beamPalette('colorful').slice(0, 4)));
    expect(beamArcs(0)).toBeCloseTo(1);
    expect(beamArcs(0.25)).toBe(0);
  });
  it('draws the progress ring up to its head and cracks the border away', () => {
    expect(beamRing(0.2, 0.5)).toBeGreaterThan(0.42);
    expect(beamRing(0.5, 0.5)).toBeGreaterThan(beamRing(0.25, 0.5));
    expect(beamRing(0.6, 0.5)).toBe(0);
    expect(beamCracked(0.5, 0)).toBe(1);
    expect(beamCracked(0.5, 1)).toBe(0);
    expect(beamCracked(0.95, 1)).toBe(1);
  });
  it('follows each corner radius and keeps dots inside the curve', () => {
    const sharp = beamBand(60, 40, 3, 3, 9, [0, 0, 0, 0], 1.2), round = beamBand(60, 40, 3, 3, 9, [16, 0, 0, 0], 1.2);
    const lit = (b: ReturnType<typeof beamBand>, col: number, row: number) => b.pixel.includes((row * 3 + 1) * b.W + col * 3 + 1);
    expect(lit(sharp, 0, 0)).toBe(true);
    expect(lit(round, 0, 0)).toBe(false);
    expect(lit(round, 19, 0)).toBe(true);
    expect(round.weight.length).toBeLessThan(sharp.weight.length);
    expect(Math.max(...round.weight)).toBeLessThanOrEqual(1);
    expect(round.turn.every(t => t >= 0 && t < 1)).toBe(true);
    expect(round.crack.length).toBe(round.weight.length);
  });
  it('resolves colours from literals, custom properties and fallbacks', () => {
    const el = element();
    styles.set(el, { '--brand': '#123456', '--short': '#abc' });
    expect(resolveColor('#AABBCC', asElement(el))).toBe('#aabbcc');
    expect(resolveColor('rgb(255, 0, 10)', asElement(el))).toBe('#ff000a');
    expect(resolveColor('--brand', asElement(el))).toBe('#123456');
    expect(resolveColor('var(--short)', asElement(el))).toBe('#aabbcc');
    expect(resolveColor('var(--missing, #fff)', asElement(el))).toBe('#ffffff');
    expect(resolveColor('--missing', asElement(el), '#010203')).toBe('#010203');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
  it('reads the ground from an opaque background before the text colour', () => {
    const el = element();
    expect(isDark(asElement(el))).toBe(false);
    styles.set(el, { backgroundColor: 'rgb(0, 0, 0)' });
    expect(isDark(asElement(el))).toBe(true);
    styles.set(el, { backgroundColor: 'rgba(0, 0, 0, 0.2)', color: 'rgb(240, 240, 236)' });
    expect(isDark(asElement(el))).toBe(true);
    styles.set(el, { backgroundColor: 'rgb(255, 255, 255)', color: 'rgb(240, 240, 236)' });
    expect(isDark(asElement(el))).toBe(false);
  });
  it('lands button letters on whole cells and waves only while loading', () => {
    for (const ratio of [1, 1.5, 2]) {
      const { cw, ch } = letterCells(15, ratio);
      expect((ch * ratio) % 3).toBe(0);
      expect(cw / ch).toBeCloseTo(2 / 3);
    }
    expect(letterGlyph(0, 0, 6, true, false)).toBeGreaterThan(0);
    expect(letterGlyph(0, 2000, 6, false, false)).toBe(0);
    const waves = Array.from({ length: 60 }, (_, i) => letterGlyph(2, 400 + i * 20, 6, true, false));
    expect(Math.max(...waves)).toBe(9);
    expect(letterGlyph(0, 2000, 6, true, true)).toBe(0);
  });
  it('rolls only changed digits, leftmost first', () => {
    expect(firstChanged('48,290', '49,530')).toBe(4);
    expect(firstChanged('48,290', '48,530')).toBe(2);
    expect(firstChanged('100', '100')).toBe(-1);
    expect(firstChanged('9', '10')).toBe(1);
  });
  it('streams the tab indicator head first', () => {
    const a = { x: 0, y: 0, w: 50, h: 20 }, b = { x: 100, y: 0, w: 50, h: 20 };
    expect(streamSpan(a, b, 0)).toMatchObject({ left: 0, right: 50, dir: 1 });
    const mid = streamSpan(a, b, 0.5);
    expect(mid.right).toBeGreaterThan(100);
    expect(mid.left).toBeLessThan(100);
    expect(streamSpan(a, b, 1)).toMatchObject({ left: 100, right: 150 });
    expect(indicatorRow(100, 4, 20)).toEqual({ n: 15, x0: 20 });
    expect(indicatorRow(30, 4, 20)).toEqual({ n: 0, x0: 15 });
  });
  it('reads block kinds, pill tones and the elapsed clock', () => {
    const img = new FakeImage(), round = new FakeImage(), text = new FakeElement('SPAN'), named = new FakeElement('DIV');
    styles.set(round, { borderTopLeftRadius: '50%' });
    named.dataset.block = 'avatar';
    expect(blockKind(asElement(img))).toBe('photo');
    expect(blockKind(asElement(round))).toBe('avatar');
    expect(blockKind(asElement(text))).toBe('text');
    expect(blockKind(asElement(named))).toBe('avatar');
    const p = new FakeElement('SPAN');
    expect(pillTone(asElement(p), 'neutral')).toBe('neutral');
    p.dataset.tone = 'green';
    expect(pillTone(asElement(p), 'neutral')).toBe('green');
    p.dataset.tone = 'purple';
    expect(pillTone(asElement(p), 'red')).toBe('red');
    expect(elapsedLabel(4210)).toBe('4.2s');
    expect(elapsedLabel(75000)).toBe('1:15');
  });
  it('shares one field across a list of pills and lays a single pill under its text', () => {
    const list = element(), a = new FakeElement('SPAN'), b = new FakeElement('SPAN');
    list.appendChild(a); list.appendChild(b);
    const many = pill([asElement(a), asElement(b)]);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(canvases(list)).toHaveLength(1);
    expect(canvases(list)[0].style.zIndex).toBe('1');
    many.destroy();
    const one = pill(asElement(a), { tone: 'green', live: true });
    expect(canvases(a)[0].style.zIndex).toBe('-1');
    expect(a.style.getPropertyValue('isolation')).toBe('isolate');
    expect(mount.mock.calls[1][1]).toMatchObject({ color: 'source' });
    one.destroy();
    expect(a.style.getPropertyValue('isolation')).toBe('');
  });
});

describe('component behaviour', () => {
  it('clips the beam to the element and plays its outcomes', () => {
    const card = element();
    styles.set(card, { borderTopLeftRadius: '12px', borderBottomRightRadius: '4px' });
    const b = beam(asElement(card), { mode: 'progress' });
    advance();
    expect(canvases(card)[0].style.clipPath).toBe('inset(0 round 12px 10px 4px 10px)');
    b.progress(0.5);
    for (let i = 0; i < 20; i++) advance();
    b.success();
    for (let i = 0; i < 200; i++) advance();
    expect(frames.size).toBe(1);
    b.error();
    for (let i = 0; i < 120; i++) advance();
    expect(frames.size).toBe(0);
    card.dispatch('pointerenter');
    expect(frames.size).toBe(1);
    b.reset();
    for (let i = 0; i < 5; i++) advance();
    expect(frames.size).toBe(1);
    b.destroy();
  });
  it('gives each pill a lane of one cell row inside its edge', () => {
    const lane = pillLane({ x: 10, y: 4, w: 80, h: 24 }, 12, 12);
    expect(lane).toEqual({ x: 12, y: 12, w: 76 });
    expect(laneClip([lane], 12)).toMatch(/^path\("M18\.00 12\.00H82\.00A6/);
    expect(laneClip([{ x: 0, y: 0, w: 2 }], 12)).toBe('inset(50%)');
  });
  it('adds the live indicator, lifts labels over a shared field, and rolls counts', () => {
    const list = element(), status = new FakeElement('SPAN'), count = new FakeElement('SPAN'), label = new FakeElement('SPAN');
    status.dataset.tone = 'green'; status.dataset.live = ''; label.textContent = 'Live'; status.appendChild(label);
    count.dataset.count = ''; count.textContent = '12';
    list.appendChild(status); list.appendChild(count);
    const p = pill([asElement(status), asElement(count)]);
    const dot = status.querySelector('[data-dot]');
    expect(dot?.getAttribute('aria-hidden')).toBe('true');
    expect(label.style.getPropertyValue('z-index')).toBe('2');
    expect(label.style.getPropertyValue('position')).toBe('relative');
    expect(count.textContent).toBe('1212');
    advance();
    expect(canvases(list)[0].style.clipPath).toMatch(/^path\(/);
    expect(frames.size).toBe(1);
    p.count(14);
    advance();
    const digits = count.children[1].children;
    expect(digits.map(d => d.textContent)).toEqual(['1', '4']);
    expect(digits[0].style.opacity).toBeUndefined();
    expect(count.children[0].textContent).toBe('14');
    p.destroy();
    expect(status.querySelector('[data-dot]')).toBeNull();
    expect(label.style.getPropertyValue('z-index')).toBe('');
    expect(count.textContent).toBe('14');
  });
  it('runs tabs with keys, aria and panels', () => {
    const list = element(), panels = [element(), element(), element()];
    const tabsEls = [0, 1, 2].map(i => { const t = new FakeElement('BUTTON'); t.setAttribute('role', 'tab'); t.setAttribute('aria-controls', `p${i}`); panels[i].setAttribute('id', `p${i}`); list.appendChild(t); return t; });
    const onChange = vi.fn();
    const t = tabs(asElement(list), { onChange });
    expect(t.active).toBe(0);
    expect(tabsEls.map(el => el.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(panels.map(p => p.hidden)).toEqual([false, true, true]);
    list.dispatch('keydown', { key: 'End' });
    expect(t.active).toBe(2);
    expect(tabsEls[2].focus).toHaveBeenCalled();
    expect(onChange.mock.calls[0][0]).toBe(2);
    expect(onChange.mock.calls[0][1]).toBe(tabsEls[2]);
    list.dispatch('keydown', { key: 'ArrowRight' });
    expect(t.active).toBe(0);
    list.dispatch('click', { target: tabsEls[1] });
    expect(t.active).toBe(1);
    expect(tabsEls[1].tabIndex).toBe(0);
    expect(frames.size).toBe(1);
    expect(list.style.getPropertyValue('--tabs-w')).toMatch(/px$/);
    t.destroy();
    expect(list.listeners.get('keydown')?.size).toBe(0);
    expect(list.style.getPropertyValue('--tabs-w')).toBe('');
  });
  it('steps the button through its states and restores its label', () => {
    const button = element('BUTTON');
    button.textContent = 'Deploy';
    const b = buttonLoading(asElement(button), { reducedMotion: false });
    expect(button.textContent).toContain('Deploy');
    b.start('Deploying');
    expect(b.state).toBe('loading');
    expect(button.dataset.state).toBe('loading');
    expect(button.getAttribute('aria-busy')).toBe('true');
    advance(); advance();
    expect(frames.size).toBe(1);
    b.fail('Retry');
    expect(button.animate).toHaveBeenCalled();
    b.succeed('Deployed');
    expect(button.textContent).toContain('Deployed');
    expect(button.querySelector('[data-ascii-check]')?.style.opacity).toBe('1');
    b.destroy();
    expect(button.textContent).toBe('Deploy');
    expect(button.dataset.state).toBeUndefined();
  });
  it('breathes one cell over an icon-only button and swaps in a check, naming each state', () => {
    const button = element('BUTTON'), icon = new FakeElement('svg');
    button.setAttribute('aria-label', 'Refresh status');
    button.appendChild(icon);
    const b = buttonLoading(asElement(button), { reducedMotion: false });
    b.start('Refreshing status');
    expect(button.getAttribute('aria-label')).toBe('Refreshing status');
    expect(icon.style.getPropertyValue('opacity')).toBe('0');
    advance(); advance();
    expect(frames.size).toBe(1);
    b.succeed('Status up to date');
    expect(button.querySelector('[data-ascii-check]')?.style.opacity).toBe('1');
    b.reset();
    expect(button.getAttribute('aria-label')).toBe('Refresh status');
    expect(icon.style.getPropertyValue('opacity')).toBe('1');
    b.destroy();
    expect(button.children).toEqual([icon]);
  });
  it('rolls the odometer only while it changes, and keeps a live value', () => {
    const figure = element('SPAN');
    const o = odometer(asElement(figure), { value: 48290, format: n => `$${n.toLocaleString('en-US')}` });
    expect(figure.textContent).toContain('$48,290');
    advance();
    expect(frames.size).toBe(0);
    o.set(49530);
    expect(o.value).toBe(49530);
    advance();
    expect(figure.children[0].getAttribute('aria-live')).toBe('polite');
    expect(figure.children[0].textContent).toBe('$49,530');
    o.destroy();
    expect(figure.textContent).toBe('$49,530');
  });
  it('draws the whole odometer figure in glyphs with the glyph face, and hands back to text', () => {
    const figure = element('SPAN');
    const o = odometer(asElement(figure), { value: 12, face: 'glyph' });
    const digits = figure.children[1];
    expect(digits.style.getPropertyValue('color')).toBe('transparent');
    o.update({ face: 'text' });
    expect(digits.style.getPropertyValue('color')).toBe('inherit');
    o.destroy();
    expect(figure.textContent).toBe('12');
  });
  it('settles the orb on its outcome and stops drawing', () => {
    const el = element();
    const orb = statusOrb(asElement(el));
    orb.loading();
    for (let i = 0; i < 5; i++) advance();
    expect(frames.size).toBe(1);
    orb.error();
    expect(el.animate).toHaveBeenCalled();
    for (let i = 0; i < 80; i++) advance();
    expect(frames.size).toBe(0);
    expect(orb.state).toBe('error');
    expect(field.update).toHaveBeenLastCalledWith({ ink: '#c93636' });
    orb.destroy();
  });
  it('develops a streamed image and shows the photo', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 160, height: 90 })));
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:1', revokeObjectURL: vi.fn() });
    vi.stubGlobal('setTimeout', (fn: () => void) => { fn(); return 0; });
    vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => new Blob(['b']) })));
    const frame = element(), photo = new FakeImage(), states: string[] = [];
    frame.appendChild(photo);
    async function* stream() { yield { preview: new Blob(['a']) }; yield { final: 'https://example.test/final.webp' }; }
    const gen = imageGenerate(asElement(frame), { onState: s => states.push(s), reducedMotion: true });
    expect(photo.style.getPropertyValue('opacity')).toBe('0');
    await expect(gen.run(stream)).resolves.toBe('done');
    expect(states).toEqual(['generating', 'done']);
    expect(photo.src).toBe('https://example.test/final.webp');
    expect(photo.style.getPropertyValue('opacity')).toBe('1');
    async function* broken(): AsyncGenerator<{ preview?: Blob }> { throw new Error('quota'); }
    await expect(gen.run(broken)).resolves.toBe('failed');
    gen.destroy();
    expect(frame.dataset.state).toBeUndefined();
  });
  it('builds handles that ignore calls after destroy', () => {
    const apply = vi.fn(), cleanup = vi.fn();
    const h = handle(() => null, { current: { a: 1 } }, apply, { extra: () => 1 }, cleanup);
    h.update({ a: 2 });
    expect(apply).toHaveBeenCalledWith({ a: 2 });
    h.destroy(); h.destroy(); h.update({ a: 3 });
    expect(cleanup).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledOnce();
    expect(h.extra()).toBe(1);
  });
});
