import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mount, support } = vi.hoisted(() => ({ mount: vi.fn(), support: { on: true } }));
vi.mock('../field', () => ({ isGlyphFieldSupported: () => support.on, mountGlyphField: mount }));

import { background, backgroundCharset, type BackgroundPreset } from './background';
import { aurora } from './backgrounds/aurora';
import { facet } from './backgrounds/facet';
import { caustics } from './backgrounds/caustics';
import { halo } from './backgrounds/halo';
import { fire } from './backgrounds/fire';
import { wave } from './backgrounds/wave';
import { drift } from './backgrounds/drift';
import { swell } from './backgrounds/swell';
import { halftone } from './backgrounds/halftone';
import { mountCanvas } from './backgrounds/canvas';

/* A small DOM: elements with styles and listeners, 2D canvases that record what they draw, and manual frames. */

let drawn: { text: string; fill: unknown; font: unknown }[];
const context2d = (canvas: FakeElement) => {
  const state: Record<string | symbol, unknown> = { canvas, font: '', fillStyle: '#000', globalAlpha: 1, globalCompositeOperation: 'source-over' };
  return new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'fillText') return (text: string) => drawn.push({ text, fill: target.fillStyle, font: target.font });
      if (key === 'getTransform') return () => ({ a: 1 });
      if (key === 'createRadialGradient' || key === 'createLinearGradient') return () => ({ addColorStop() {} });
      return () => {};
    },
    set(target, key, value) { target[key] = value; return true; },
  });
};
class FakeStyle {
  [key: string]: unknown;
  private props = new Map<string, string>();
  setProperty(name: string, value: string) { this.props.set(name, value); }
  getPropertyValue(name: string) { return this.props.get(name) ?? ''; }
  removeProperty(name: string) { this.props.delete(name); }
}
class FakeElement {
  parentElement: FakeElement | null = null;
  style = new FakeStyle();
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  childNodes: FakeElement[] = [];
  listeners = new Map<string, Set<(event: unknown) => void>>();
  width = 300;
  height = 150;
  clientWidth = 400;
  clientHeight = 300;
  offsetWidth = 400;
  isConnected = true;
  constructor(public tagName = 'DIV') {}
  get children() { return this.childNodes; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 }; }
  appendChild(node: FakeElement) { node.remove(); node.parentElement = this; this.childNodes.push(node); return node; }
  insertBefore(node: FakeElement, before: FakeElement | null) { node.remove(); node.parentElement = this; const i = before ? this.childNodes.indexOf(before) : -1; if (i < 0) this.childNodes.push(node); else this.childNodes.splice(i, 0, node); return node; }
  replaceWith(node: FakeElement) { const p = this.parentElement; if (!p) return; const i = p.childNodes.indexOf(this); node.parentElement = p; p.childNodes[i] = node; this.parentElement = null; }
  prepend(node: FakeElement) { node.remove(); node.parentElement = this; this.childNodes.unshift(node); }
  remove() { if (this.parentElement) this.parentElement.childNodes = this.parentElement.childNodes.filter(n => n !== this); this.parentElement = null; }
  setAttribute(name: string, value: string) { this.attributes.set(name, String(value)); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  getAttributeNames() { return [...this.attributes.keys()]; }
  hasAttribute(name: string) { return this.attributes.has(name); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  addEventListener(type: string, fn: (event: unknown) => void) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type)!.add(fn); }
  removeEventListener(type: string, fn: (event: unknown) => void) { this.listeners.get(type)?.delete(fn); }
  contains(node: FakeElement | null): boolean { for (let n = node; n; n = n.parentElement) if (n === this) return true; return false; }
  closest() { return null; }
  getContext(kind: string) { return kind === '2d' ? (this.ctx ??= context2d(this)) : null; }
  private ctx?: ReturnType<typeof context2d>;
}

let frames: Map<number, FrameRequestCallback>, timers: (() => void)[], reduced: boolean, windowListeners: Map<string, Set<unknown>>, field: Record<string, unknown>;
const runFrames = (rounds = 1, step = 16) => {
  for (let i = 0; i < rounds; i++) { const now = [...frames.values()]; frames.clear(); clock += step; now.forEach(fn => fn(clock)); }
};
let clock = 0;
const host = () => { const el = new FakeElement(); (document.body as unknown as FakeElement).appendChild(el); return el; };
const as = (el: FakeElement) => el as unknown as HTMLElement;
const kitCanvases = (el: FakeElement) => el.childNodes.filter(n => n.tagName === 'CANVAS' && n.dataset.asciiKit !== undefined);
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

beforeEach(() => {
  frames = new Map(); timers = []; reduced = false; drawn = []; clock = 0; windowListeners = new Map();
  mount.mockReset(); support.on = true;
  field = { ready: Promise.resolve(), update: vi.fn(), setSource: vi.fn(async () => {}), redraw: vi.fn(), pulse: vi.fn(), play: vi.fn(), pause: vi.fn(), resize: vi.fn(), destroy: vi.fn(), settings: {} };
  mount.mockImplementation((canvas: FakeElement) => Object.assign(field, { canvas }));
  const body = new FakeElement('BODY'), root = new FakeElement('HTML');
  root.appendChild(body);
  vi.stubGlobal('HTMLElement', FakeElement);
  vi.stubGlobal('Element', FakeElement);
  vi.stubGlobal('document', {
    body, documentElement: root, hidden: false,
    createElement: (tag: string) => new FakeElement(tag.toUpperCase()),
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  });
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.set(++id, fn); return id; });
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => { frames.delete(handle); });
  vi.stubGlobal('setTimeout', (fn: () => void) => { timers.push(fn); return ++id; });
  vi.stubGlobal('clearTimeout', () => {});
  vi.stubGlobal('devicePixelRatio', 2);
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduced') ? reduced : false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('getComputedStyle', () => ({ position: 'static', color: 'rgb(20, 20, 20)', backgroundColor: 'rgba(0, 0, 0, 0)', getPropertyValue: () => '' }));
  vi.stubGlobal('addEventListener', (type: string, fn: unknown) => { if (!windowListeners.has(type)) windowListeners.set(type, new Set()); windowListeners.get(type)!.add(fn); });
  vi.stubGlobal('removeEventListener', (type: string, fn: unknown) => { windowListeners.get(type)?.delete(fn); });
  class Observer { observe() {} disconnect = vi.fn(); }
  vi.stubGlobal('ResizeObserver', Observer);
  vi.stubGlobal('MutationObserver', Observer);
  vi.stubGlobal('performance', { now: () => clock });
});
afterEach(() => vi.unstubAllGlobals());

describe('background options', () => {
  it('needs a preset', () => {
    expect(() => background(as(host()), {} as never)).toThrow(TypeError);
  });

  it('resolves named and custom character sets', () => {
    expect(backgroundCharset(undefined)).toBeUndefined();
    expect(backgroundCharset('blocks')).toBe(' ░▒▓█');
    expect(backgroundCharset('dots')).toBe(' ·∙•●');
    expect(backgroundCharset('#@')).toBe(' #@');
    expect(backgroundCharset(' .o')).toBe(' .o');
  });

  it('draws a canvas preset under the content with its defaults and graphite ink', () => {
    const el = host();
    const bg = background(as(el), { preset: facet });
    expect(bg.supported).toBe(true);
    expect(bg.field).toBeNull();
    expect(bg.preset).toBe(facet);
    const [canvas] = kitCanvases(el);
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
    expect(canvas.getAttribute('style')).toContain('z-index:-1');
    expect(el.style.getPropertyValue('position')).toBe('relative');
    expect(el.style.getPropertyValue('isolation')).toBe('isolate');
    expect(canvas.width).toBe(800);
    drawn = [];
    runFrames(2);
    expect(drawn.length).toBeGreaterThan(0);
    // Light ground: the site's light graphite, each glyph's alpha carrying its tone.
    expect(drawn.every(d => String(d.fill).startsWith('rgba(111,109,103,'))).toBe(true);
    expect(drawn[0].font).toBe('12px "Geist Mono", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace');
    bg.destroy();
  });

  it('takes palette over color over ink, size, charset and opacity', () => {
    const el = host();
    const bg = background(as(el), { preset: facet, ink: '#00ff00', color: '#0000ff', palette: { light: '#ff0000' }, cellSize: 20, charset: 'blocks', opacity: 0.4 });
    runFrames(1);
    expect(drawn.every(d => String(d.fill).startsWith('rgba(255,0,0,'))).toBe(true);
    expect(String(drawn[0].font).startsWith('20px')).toBe(true);
    expect(drawn.every(d => '░▒▓█'.includes(d.text))).toBe(true);
    expect(kitCanvases(el)[0].style.opacity).toBe('0.4');
    bg.update({ palette: undefined, opacity: 1 });
    drawn = [];
    runFrames(1);
    expect(drawn.every(d => String(d.fill).startsWith('rgba(0,0,255,'))).toBe(true);
    expect(kitCanvases(el)[0].style.opacity).toBe('1');
    bg.destroy();
  });

  it('maps the ink into the template keys the site uses', () => {
    const draw = vi.fn();
    const preset: BackgroundPreset = { id: 'probe', name: 'Probe', description: '', cellSize: 9, speed: 0.5, cursor: true, mount: c => mountCanvas(c, draw) };
    const bg = background(as(host()), { preset, accent: '#ff8800', dither: 0.5 });
    runFrames(1);
    const frame = draw.mock.calls.at(-1)![5];
    expect(frame).toMatchObject({ fontSize: 9, ditherStrength: 0.5, lightMode: true, ink: '#6f6d67', accent: '#ff8800', speed: 0.5 });
    bg.destroy();
  });
});

describe('background lifecycle', () => {
  it('advances the clock from the stage start at the chosen speed, and pauses', () => {
    const draw = vi.fn();
    const preset: BackgroundPreset = { id: 'probe', name: 'Probe', description: '', cellSize: 12, speed: 1, cursor: false, mount: c => mountCanvas(c, draw) };
    const bg = background(as(host()), { preset, speed: 2 });
    runFrames(1, 16);
    expect(draw.mock.calls.at(-1)![4]).toEqual({ x: 0.5, y: 0.5 });
    expect(draw.mock.calls.at(-1)![3]).toBe(9);
    runFrames(1, 20);
    expect(draw.mock.calls.at(-1)![3]).toBeCloseTo(9 + 0.04);
    bg.pause();
    expect(frames.size).toBe(0);
    bg.play();
    expect(frames.size).toBe(1);
    bg.destroy();
    expect(frames.size).toBe(0);
  });

  it('follows the pointer only for cursor presets', () => {
    const draw = vi.fn();
    const preset: BackgroundPreset = { ...wave, mount: c => mountCanvas(c, draw) };
    const bg = background(as(host()), { preset });
    for (const fn of windowListeners.get('pointermove') ?? []) (fn as (e: unknown) => void)({ clientX: 400, clientY: 300 });
    runFrames(3);
    const mouse = draw.mock.calls.at(-1)![4];
    expect(mouse.x).toBeGreaterThan(0.5);
    expect(mouse.y).toBeGreaterThan(0.5);
    bg.update({ cursor: false });
    runFrames(60);
    expect(draw.mock.calls.at(-1)![4].x).toBeCloseTo(0.5, 1);
    bg.destroy();
    expect(windowListeners.get('pointermove')?.size ?? 0).toBe(0);
  });

  it('cross-fades to another preset and cleans everything up on destroy', () => {
    const el = host();
    const bg = background(as(el), { preset: caustics, speed: 0.8 });
    const first = kitCanvases(el)[0];
    bg.setPreset(aurora);
    expect(bg.preset).toBe(aurora);
    const both = kitCanvases(el);
    expect(both).toHaveLength(2);
    expect(first.style.opacity).toBe('0');
    timers.splice(0).forEach(fn => fn());
    expect(kitCanvases(el)).toEqual([both[1]]);
    bg.update({ preset: wave });
    expect(bg.preset).toBe(wave);
    bg.destroy();
    expect(kitCanvases(el)).toHaveLength(0);
    expect(el.style.getPropertyValue('position')).toBe('');
    expect(el.style.getPropertyValue('isolation')).toBe('');
    expect(bg.supported).toBe(false);
    bg.update({ speed: 2 });
    bg.setPreset(caustics);
    expect(kitCanvases(el)).toHaveLength(0);
  });

  it('warms Fire on mount, so its first frame already has flame', () => {
    const el = host();
    background(as(el), { preset: fire, reducedMotion: true });
    expect(drawn.length).toBeGreaterThan(0);
  });
});

describe('background reduced motion', () => {
  it('draws one still frame and runs no loop', () => {
    reduced = true;
    const draw = vi.fn();
    const preset: BackgroundPreset = { id: 'probe', name: 'Probe', description: '', cellSize: 12, speed: 1, cursor: true, mount: c => mountCanvas(c, draw) };
    const bg = background(as(host()), { preset });
    runFrames(1);
    const calls = draw.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    expect(draw.mock.calls.every(call => call[3] === 9)).toBe(true);
    expect(frames.size).toBe(0);
    runFrames(5);
    expect(draw.mock.calls.length).toBe(calls);
    bg.destroy();
  });

  it('the option overrides the visitor setting either way', () => {
    reduced = true;
    const draw = vi.fn();
    const preset: BackgroundPreset = { id: 'probe', name: 'Probe', description: '', cellSize: 12, speed: 1, cursor: false, mount: c => mountCanvas(c, draw) };
    const bg = background(as(host()), { preset, reducedMotion: false });
    runFrames(3);
    expect(frames.size).toBe(1);
    expect(draw.mock.calls.at(-1)![3]).toBeGreaterThan(9);
    bg.update({ reducedMotion: true });
    runFrames(1);
    expect(frames.size).toBe(0);
    bg.destroy();
  });

  it('swaps presets at once, without a fade', () => {
    const el = host();
    const bg = background(as(el), { preset: caustics, reducedMotion: true });
    bg.setPreset(aurora);
    expect(kitCanvases(el)).toHaveLength(1);
    bg.destroy();
  });
});

describe('GPU presets', () => {
  it('drive the glyph field with the site look, and hold still for reduced motion', async () => {
    const el = host();
    const bg = background(as(el), { preset: drift, lazy: false, reducedMotion: true, cellSize: 9, cursor: 'fluid' });
    await flush();
    expect(mount).toHaveBeenCalledTimes(1);
    const look = mount.mock.calls[0][1];
    expect(look).toMatchObject({ scene: 'drift', mark: 'glyph', cellSize: 9, cellAspect: 0.62, charset: ' .:-=+*#', hover: 'fluid', speed: 0, respectReducedMotion: true, ink: '#8f8d86' });
    expect(bg.supported).toBe(true);
    bg.destroy();
    expect(field.destroy).toHaveBeenCalled();
  });

  it('draw swell as rolling halftone dots, quiet in the middle, with a lantern under the pointer', async () => {
    const el = host();
    const bg = background(as(el), { preset: swell, lazy: false });
    await flush();
    expect(mount.mock.calls[0][1]).toMatchObject({ scene: 'swell', mark: 'dot', cellSize: 10, hover: 'lantern', clear: { shape: 'ellipse' } });
    expect(kitCanvases(el)[0]?.style.opacity).toBe('0.6');
    bg.destroy();
  });

  it('keep the host isolated when a field preset hands over to a canvas one, and restore it on destroy', async () => {
    const el = host();
    const bg = background(as(el), { preset: swell, lazy: false, reducedMotion: true });
    await flush();
    bg.setPreset(aurora);
    expect(el.style.getPropertyValue('isolation')).toBe('isolate');
    bg.destroy();
    expect(el.style.getPropertyValue('isolation')).toBe('');
    expect(el.style.getPropertyValue('position')).toBe('');
  });

  it('draw swell in characters when asked, by mark or by charset, and the drift as dots', async () => {
    const el = host();
    const bg = background(as(el), { preset: swell, lazy: false, mark: 'glyph' });
    await flush();
    expect(mount.mock.calls[0][1]).toMatchObject({ scene: 'swell', mark: 'glyph', charset: ' .:-=+*#', cellAspect: 0.62 });
    bg.destroy();
    const dots = background(as(host()), { preset: drift, lazy: false, mark: 'dot' });
    await flush();
    expect(mount.mock.calls[1][1]).toMatchObject({ scene: 'drift', mark: 'dot', cellAspect: 1 });
    dots.destroy();
    const blocks = background(as(host()), { preset: swell, lazy: false, charset: 'blocks' });
    await flush();
    expect(mount.mock.calls[2][1]).toMatchObject({ mark: 'glyph', charset: ' ░▒▓█' });
    blocks.destroy();
  });

  it('turn the pointer off with cursor: false, or a look hover of none, and keep a quiet middle', async () => {
    const bg = background(as(host()), { preset: halo, lazy: false, cursor: false });
    await flush();
    expect(mount.mock.calls[0][1]).toMatchObject({ scene: 'halo', hover: 'none' });
    bg.destroy();
    const quiet = background(as(host()), { preset: caustics, lazy: false, look: { hover: 'none' } });
    await flush();
    expect(mount.mock.calls[1][1]).toMatchObject({ scene: 'caustics', hover: 'none', clear: { shape: 'ellipse', width: 0.64 } });
    quiet.destroy();
  });

  it('keep the poster to the preset it pictures, so a swapped preset is never covered by it', async () => {
    const el = host();
    const posters = () => el.childNodes.filter(n => n.tagName === 'IMG');
    const bg = background(as(el), { preset: swell, lazy: false, poster: '/swell.webp' });
    await flush();
    expect(posters()).toHaveLength(1);
    expect(posters()[0].style.opacity).toBe('0');
    bg.setPreset(drift);
    await flush();
    bg.setPreset(halftone);
    await flush();
    bg.update({ poster: '/swell-dark.webp' });
    timers.splice(0).forEach(fn => fn());
    expect(posters()).toHaveLength(0);
    bg.setPreset(caustics);
    timers.splice(0).forEach(fn => fn());
    expect(posters()).toHaveLength(0);
    bg.setPreset(swell);
    await flush();
    expect(posters().map(img => (img as unknown as { src: string }).src)).toEqual(['/swell-dark.webp']);
    bg.destroy();
    expect(posters()).toHaveLength(0);
  });

  it('return an inert handle without WebGL2 and leave the element alone', () => {
    support.on = false;
    const el = host();
    const bg = background(as(el), { preset: drift });
    expect(bg.supported).toBe(false);
    expect(bg.field).toBeNull();
    bg.update({ speed: 2 }); bg.play(); bg.pause();
    expect(kitCanvases(el)).toHaveLength(0);
    expect(el.style.getPropertyValue('position')).toBe('');
    bg.destroy();
  });
});
