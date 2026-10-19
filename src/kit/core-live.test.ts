import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mount, support } = vi.hoisted(() => ({ mount: vi.fn(), support: { on: true } }));
vi.mock('../field', () => ({ isGlyphFieldSupported: () => support.on, mountGlyphField: mount }));

import { beam } from './beam';
import { statusOrb } from './status-orb';
import { fieldBackground } from './field-background';
import { background } from './background';
import { swell } from './backgrounds/swell';
import { KIT_STYLES, balanceCharset, getFieldBudget, getGlobalLook, inkWeight, setFieldBudget, setGlobalLook, subscribeGlobalLook } from './core-live';
import { STUDIO_STYLES } from '../studio/model';
import { FakeElement, FakeStyle, fakeField, useFakeDom } from './fake-dom-2a';

const { env, advance, flush, element, as, canvases } = useFakeDom(mount, support);

// What the shared core needs beyond the phase 2a DOM: copying a canvas in place, and connection to the document.
Object.defineProperty(FakeStyle.prototype, 'cssText', {
  configurable: true,
  get(this: Record<string, unknown>) { return Object.entries(this).filter(([k, v]) => k !== 'props' && typeof v === 'string').map(([k, v]) => `${k}:${v}`).join(';'); },
  set(this: Record<string, unknown>, text: string) { for (const rule of text.split(';')) { const [k, v] = rule.split(':'); if (k && v !== undefined) this[k] = v; } },
});
Object.assign(FakeElement.prototype, {
  getAttributeNames(this: FakeElement) { return [...this.attributes.keys()]; },
  after(this: FakeElement, ...next: FakeElement[]) { const parent = this.parentElement; if (!parent) return; let at = parent.childNodes[parent.childNodes.indexOf(this) + 1] ?? null; for (const n of next.reverse()) at = parent.insertBefore(n, at); },
  replaceWith(this: FakeElement, next: FakeElement) { const parent = this.parentElement; if (!parent) return; parent.insertBefore(next, this); this.remove(); },
});
Object.defineProperty(FakeElement.prototype, 'isConnected', {
  configurable: true,
  get(this: FakeElement) { let n: FakeElement = this; while (n.parentElement) n = n.parentElement; return n.tagName === 'HTML'; },
});

let fields: ReturnType<typeof fakeField>[];
beforeEach(() => {
  vi.stubGlobal('innerHeight', 800);
  fields = [];
  mount.mockImplementation(() => { const f = fakeField(); fields.push(f); return f; });
});
afterEach(() => { setFieldBudget(12); setGlobalLook(null); });

/** Places an element `top` px from the top of an 800px viewport. */
const at = (top: number, tag = 'DIV') => { const el = element(tag); el.rect = { left: 0, top, width: 200, height: 40 }; return el; };
/** Moves elements and lets the shared observers see it, as a scroll would. */
const scroll = (...moves: [FakeElement, number][]) => {
  for (const [el, top] of moves) el.rect = { ...el.rect, top };
  const entries = moves.map(([el]) => ({ target: el, isIntersecting: true }));
  for (const o of env.observers as unknown as { fn?: (e: unknown[]) => void }[]) if (o instanceof IntersectionObserver) o.fn?.(entries);
};
const optionsOf = (call: number) => mount.mock.calls[call][1];
const imgs = (el: FakeElement) => el.children.filter(c => c.tagName === 'IMG');

describe('fields that never release by distance', () => {
  it('settles when there are more of them than the context budget, instead of taking contexts from each other forever', () => {
    setFieldBudget(2);
    const els = [0, 900, 1800, 2700].map(top => at(top));
    const handles = els.map(el => beam(as(el), { lazy: false }));
    for (let i = 0; i < 5; i++) { scroll(...els.map(el => [el, el.rect.top] as [FakeElement, number])); advance(); }
    const settled = mount.mock.calls.length;
    for (let i = 0; i < 30; i++) { scroll(...els.map(el => [el, el.rect.top] as [FakeElement, number])); advance(); }
    expect(mount.mock.calls.length).toBe(settled);
    expect(fields.filter(f => !f.destroy.mock.calls.length)).toHaveLength(2);
    handles.forEach(h => h.destroy());
  });
});

describe('lazy mounting', () => {
  it('mounts fields while the page scrolls, two viewports ahead, at most two a frame and within the frame\'s time', () => {
    // Each mount costs 1.5ms: the frame's 4ms allows two, and the count allows no more even when mounts are cheaper.
    mount.mockImplementation(() => { env.clock += 1.5; const f = fakeField(); fields.push(f); return f; });
    // The browser's frame time: the same for every task in a frame, however long they take.
    const timeline = { currentTime: 0 };
    Object.assign(document, { timeline });
    const els = Array.from({ length: 7 }, () => at(5000));
    const handles = els.map(el => beam(as(el), { poster: '/still.webp' }));
    expect(mount).not.toHaveBeenCalled();
    const frames: number[] = [];
    // A fast scroll: every frame runs its frame callbacks, then the page moves on and the scroll event fires; nothing waits
    // for the scroll to rest.
    for (let frame = 0, top = 3200; frame < 8; frame++, top -= 300) {
      const before = mount.mock.calls.length, start = env.clock;
      timeline.currentTime = env.clock + 16;
      advance();
      for (const fn of env.docListeners.get('scroll') ?? []) fn({});
      scroll(...els.map((el, i) => [el, top + i * 60] as [FakeElement, number]));
      frames.push(mount.mock.calls.length - before);
      expect(env.clock - start - 16).toBeLessThanOrEqual(4 + 1.5);
    }
    // Within two viewports (1600px) of the screen from the fourth frame on, all seven mount, two a frame, while still scrolling.
    expect(Math.max(...frames)).toBeLessThanOrEqual(2);
    expect(mount).toHaveBeenCalledTimes(7);
    expect(frames.slice(0, 3)).toEqual([0, 0, 0]);
    handles.forEach(h => h.destroy());
  });

  it('mounts within two viewports, releases beyond three, and keeps the handle working throughout', async () => {
    const el = at(3000);
    const b = beam(as(el));
    expect(b.supported).toBe(true);
    expect(mount).not.toHaveBeenCalled();
    const [placeholder] = canvases(el);
    expect(placeholder).toBeDefined();
    const proxy = b.field!;

    scroll([el, 1100]);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(mount.mock.calls[0][0]).toBe(placeholder);
    advance(); await flush();
    expect(fields[0].setSource).toHaveBeenCalled();

    scroll([el, 3100]);
    expect(fields[0].destroy).not.toHaveBeenCalled();
    scroll([el, 3300]);
    expect(fields[0].destroy).toHaveBeenCalledOnce();
    expect(env.frames.size).toBe(0);

    // Updates while released are kept; methods still run.
    b.update({ palette: 'mono', look: { cellSize: 9 } });
    b.update({ look: { glyphScale: 0.5 } });
    b.progress(0.5);
    b.pause();
    expect(mount).toHaveBeenCalledTimes(1);

    scroll([el, 100]);
    expect(mount).toHaveBeenCalledTimes(2);
    const [fresh] = canvases(el);
    expect(fresh).not.toBe(placeholder);
    expect(mount.mock.calls[1][0]).toBe(fresh);
    expect(fresh.getAttribute('aria-hidden')).toBe('true');
    expect(fresh.style.position).toBe('absolute');
    expect(optionsOf(1)).toMatchObject({ color: 'ink', cellSize: 9, glyphScale: 0.5 });
    expect(fields[1].pause).toHaveBeenCalled();
    expect(b.field).toBe(proxy);
    expect(proxy.canvas).toBe(fresh);
    b.play();
    expect(fields[1].play).toHaveBeenCalled();
    advance(); await flush();
    expect(fields[1].setSource).toHaveBeenCalled();
    b.destroy();
    expect(fields[1].destroy).toHaveBeenCalledOnce();
    expect(canvases(el)).toHaveLength(0);
    expect(env.observers.every(o => o.disconnect.mock.calls.length > 0)).toBe(true);
  });

  it('mounts at once wherever the element is with lazy: false', () => {
    const el = at(5000);
    const b = beam(as(el), { lazy: false });
    expect(mount).toHaveBeenCalledOnce();
    scroll([el, 9000]);
    expect(fields[0].destroy).not.toHaveBeenCalled();
    b.destroy();
  });

  it('keeps a page field\'s source and settings across a release', () => {
    const el = at(0);
    const bg = fieldBackground(as(el), { preset: 'notFound' });
    expect(mount).toHaveBeenCalledOnce();
    scroll([el, 4000]);
    expect(fields[0].destroy).toHaveBeenCalledOnce();
    void bg.field!.setSource(null);
    bg.update({ ink: '#ff0000', look: { cellSize: 11 } });
    scroll([el, 0]);
    expect(mount).toHaveBeenCalledTimes(2);
    expect(optionsOf(1)).toMatchObject({ source: null, ink: '#ff0000', cellSize: 11 });
    bg.destroy();
  });

  it('spreads costly mounts over frames, nearest first', () => {
    mount.mockImplementation(() => { env.clock += 10; const f = fakeField(); fields.push(f); return f; });
    const near = at(0), mid = at(500), far = at(1100);
    beam(as(near)); beam(as(far)); beam(as(mid));
    expect(mount).toHaveBeenCalledOnce();
    expect(mount.mock.calls[0][0].parentElement).toBe(near);
    advance();
    expect(mount).toHaveBeenCalledTimes(2);
    expect(mount.mock.calls[1][0].parentElement).toBe(mid);
    advance();
    expect(mount.mock.calls[2][0].parentElement).toBe(far);
  });
});

describe('context budget', () => {
  it('holds at most the budget across components and page fields, releasing the farthest first', () => {
    expect(getFieldBudget()).toBe(12);
    setFieldBudget(2);
    const a = at(0), b = at(900), c = at(1000);
    const ha = beam(as(a)), hb = fieldBackground(as(b)), hc = statusOrb(as(c));
    expect(mount).toHaveBeenCalledTimes(2);
    expect(hc.supported).toBe(true);

    // c comes on screen while b scrolls away, a frame later: b, the farthest, gives its context to c.
    advance(20);
    scroll([c, 0], [b, 1100]);
    expect(mount).toHaveBeenCalledTimes(3);
    expect(mount.mock.calls[2][0].parentElement).toBe(c);
    expect(fields[1].destroy).toHaveBeenCalledOnce();
    expect(fields[0].destroy).not.toHaveBeenCalled();

    // A lower budget releases the farthest at once; destroying one lets the nearest waiting field in.
    setFieldBudget(1);
    expect([fields[0], fields[2]].filter(f => f.destroy.mock.calls.length)).toHaveLength(1);
    setFieldBudget(2);
    ha.destroy();
    expect(mount.mock.calls.length).toBeGreaterThanOrEqual(4);
    hb.destroy(); hc.destroy();
  });

  it('gives a hidden field\'s context to one on screen', () => {
    setFieldBudget(1);
    const hidden = at(0);
    const handle = beam(as(hidden));
    expect(mount).toHaveBeenCalledTimes(1);
    // display: none reports a zero box at the origin and no client rects.
    Object.assign(hidden, { getClientRects: () => [] });
    scroll([hidden, 0]);
    beam(as(at(100)));
    expect(fields[0].destroy).toHaveBeenCalledOnce();
    expect(mount).toHaveBeenCalledTimes(2);
    handle.destroy();
  });

  it('gives an open modal dialog\'s fields the contexts of the covered page, and gives them back on close', () => {
    setFieldBudget(2);
    const grid = [beam(as(at(0))), beam(as(at(100)))];
    expect(mount).toHaveBeenCalledTimes(2);
    // At most two mounts a frame: the dialog opens in a later one.
    advance(20);
    const dialog = element('DIALOG');
    const modal = { open: [dialog] };
    Object.assign(document, { querySelectorAll: (selector: string) => (selector === 'dialog:modal' ? modal.open : []) });
    const inside = (top: number) => { const el = at(top); dialog.appendChild(el); return el; };
    // Both on screen, both lazy: only being covered lets the dialog's fields in.
    const shown = [beam(as(inside(200))), beam(as(inside(300)))];
    expect(mount).toHaveBeenCalledTimes(4);
    expect(fields[0].destroy).toHaveBeenCalledOnce();
    expect(fields[1].destroy).toHaveBeenCalledOnce();
    // A covered field coming near never takes one back while the dialog is open.
    const covered = beam(as(at(50)));
    expect(mount).toHaveBeenCalledTimes(4);

    // Closing unmounts the dialog's demo: the page behind it mounts again.
    advance(20);
    modal.open = [];
    shown.forEach(h => h.destroy());
    expect(mount).toHaveBeenCalledTimes(6);
    expect(mount.mock.calls.slice(4).map(call => call[0].parentElement?.parentElement)).not.toContain(dialog);
    grid.forEach(h => h.destroy());
    covered.destroy();
  });

  it('brings covered fields back when a dialog that drew none closes', () => {
    setFieldBudget(1);
    const dialog = element('DIALOG');
    const modal = { open: [dialog] };
    Object.assign(document, { querySelectorAll: (selector: string) => (selector === 'dialog:modal' ? modal.open : []) });
    const near = at(0);
    dialog.appendChild(near);
    const shown = beam(as(near));
    const page = beam(as(at(100)));
    expect(mount).toHaveBeenCalledTimes(1);
    // The dialog closes while its demo stays: it is hidden, and the close hands its context to the page.
    modal.open = [];
    Object.assign(near, { getClientRects: () => [] });
    for (const fn of env.docListeners.get('close') ?? []) fn({ target: dialog });
    expect(fields[0].destroy).toHaveBeenCalledOnce();
    expect(mount).toHaveBeenCalledTimes(2);
    shown.destroy(); page.destroy();
  });

  it('remounts a field whose context the browser took and did not restore, on a fresh canvas', () => {
    const el = at(0);
    const handle = beam(as(el));
    expect(mount).toHaveBeenCalledTimes(1);
    const [first] = canvases(el);
    first.dispatch('webglcontextlost');
    advance(400);
    first.dispatch('webglcontextrestored');
    advance(1000);
    expect(mount).toHaveBeenCalledTimes(1);

    first.dispatch('webglcontextlost');
    advance(1000);
    expect(fields[0].destroy).toHaveBeenCalledOnce();
    expect(mount).toHaveBeenCalledTimes(2);
    const [second] = canvases(el);
    expect(second).not.toBe(first);
    expect(mount.mock.calls[1][0]).toBe(second);
    handle.destroy();
  });

  it('gives a released field\'s canvas up at once, so its lost context can be collected', () => {
    const el = at(0);
    const handle = beam(as(el));
    const [first] = canvases(el);
    scroll([el, 3300]);
    expect(fields[0].destroy).toHaveBeenCalledOnce();
    const [waiting] = canvases(el);
    expect(waiting).not.toBe(first);
    expect(first.parentElement).toBeNull();
    scroll([el, 0]);
    expect(mount.mock.calls[1][0]).toBe(waiting);
    handle.destroy();
  });

  it('paints a self-animating component at most 60 times a second on a 120 Hz screen, and every frame under the pointer', async () => {
    const el = at(0);
    const handle = beam(as(el));
    await flush();
    const paints = () => fields[0].setSource.mock.calls.length;
    advance(); advance();
    let before = paints();
    for (let i = 0; i < 120; i++) advance(1000 / 120);
    expect(paints() - before).toBeLessThanOrEqual(61);
    expect(paints() - before).toBeGreaterThanOrEqual(55);
    before = paints();
    for (let i = 0; i < 60; i++) { el.dispatch('pointermove', { timeStamp: env.clock }); advance(1000 / 120); }
    expect(paints() - before).toBeGreaterThanOrEqual(58);
    handle.destroy();
  });

  it('never mounts a field whose host has left the document before its handle is destroyed', () => {
    setFieldBudget(1);
    const shown = beam(as(at(0)));
    const gone = at(100);
    const waiting = beam(as(gone));
    expect(mount).toHaveBeenCalledTimes(1);
    gone.remove();
    shown.destroy();
    advance(); advance();
    expect(mount).toHaveBeenCalledTimes(1);
    waiting.destroy();
  });

  it('mounts one field per frame when a host starts many in one long task', () => {
    // Each mount takes 10ms and the host renders for 20ms between them, all in one task: the frame clock stands still.
    Object.assign(document, { timeline: { currentTime: 1000 } });
    mount.mockImplementation(() => { env.clock += 10; const f = fakeField(); fields.push(f); return f; });
    const handles = Array.from({ length: 4 }, (_, i) => { env.clock += 20; return beam(as(at(i * 50))); });
    expect(mount).toHaveBeenCalledTimes(1);
    for (let frame = 2; frame <= 4; frame++) {
      (document as unknown as { timeline: { currentTime: number } }).timeline.currentTime += 16;
      advance();
      expect(mount).toHaveBeenCalledTimes(frame);
    }
    handles.forEach(h => h.destroy());
    delete (document as { timeline?: unknown }).timeline;
  });

  it('leaves no listener behind on its canvases or the document once the last field goes', () => {
    const el = at(0);
    const handle = beam(as(el));
    const [first] = canvases(el);
    expect(first.listeners.get('webglcontextlost')?.size).toBe(1);
    scroll([el, 2000]);
    scroll([el, 0]);
    const [second] = canvases(el);
    handle.destroy();
    for (const canvas of [first, second]) for (const type of ['webglcontextlost', 'webglcontextrestored']) expect(canvas.listeners.get(type)?.size ?? 0).toBe(0);
    expect(env.docListeners.get('close')?.size ?? 0).toBe(0);
  });

  it('lets a lazy: false field displace the farthest live one', () => {
    setFieldBudget(1);
    beam(as(at(0)));
    beam(as(at(300)), { lazy: false });
    expect(mount).toHaveBeenCalledTimes(2);
    expect(fields[0].destroy).toHaveBeenCalledOnce();
  });
});

describe('posters', () => {
  it('shows the poster under the canvas until the first frame and again while released, swapping without a fade', async () => {
    const el = at(0);
    const b = beam(as(el), { poster: '/beam.webp' });
    const [img] = imgs(el);
    expect(img.src).toBe('/beam.webp');
    expect(img.getAttribute('aria-hidden')).toBe('true');
    expect(el.children.indexOf(img)).toBeLessThan(el.children.indexOf(canvases(el)[0]));
    expect(img.style.opacity).toBe('1');
    await flush();
    expect(img.style.opacity).toBe('0');
    // It swaps with the canvas in one frame: no fade, so the host never shows both, or neither.
    expect(String(img.getAttribute('style') ?? '')).not.toMatch(/transition/);
    scroll([el, 4000]);
    expect(img.style.opacity).toBe('1');
    scroll([el, 0]);
    await flush();
    expect(img.style.opacity).toBe('0');
    b.destroy();
    expect(imgs(el)).toHaveLength(0);
  });

  it('covers a lost context with the poster at once, and uncovers it once the context is back and drawn', async () => {
    const el = at(0);
    const b = beam(as(el), { poster: '/beam.webp' });
    const [img] = imgs(el);
    await flush();
    expect(img.style.opacity).toBe('0');
    const [canvas] = canvases(el);
    canvas.dispatch('webglcontextlost');
    expect(img.style.opacity).toBe('1');
    canvas.dispatch('webglcontextrestored');
    expect(img.style.opacity).toBe('1');
    advance(); advance();
    expect(img.style.opacity).toBe('0');
    b.destroy();
  });

  it('stays as the fallback without WebGL and when the field fails, until destroy', () => {
    support.on = false;
    const el = at(0), page = at(0);
    const b = beam(as(el), { poster: '/beam.webp' }), bg = fieldBackground(as(page), { poster: '/bg.webp' });
    expect(b.supported).toBe(false);
    expect(imgs(el)[0].style.opacity).toBe('1');
    expect(el.style.getPropertyValue('position')).toBe('relative');
    expect(imgs(page)).toHaveLength(1);
    b.destroy(); bg.destroy();
    expect(imgs(el)).toHaveLength(0);
    expect(imgs(page)).toHaveLength(0);
    expect(el.style.getPropertyValue('position')).toBe('');

    support.on = true;
    const failing = at(0);
    const f = statusOrb(as(failing), { poster: '/orb.webp' });
    optionsOf(0).onError(new Error('lost'));
    expect(f.supported).toBe(false);
    expect(canvases(failing)).toHaveLength(0);
    expect(imgs(failing)[0].style.opacity).toBe('1');
    f.destroy();
    expect(imgs(failing)).toHaveLength(0);
  });
});

describe('charset balance', () => {
  const weigh = (max: number, mean: number) => vi.spyOn(document, 'createElement').mockImplementationOnce(() => {
    // A 2D pen whose coverage reads `max`x the reference for the densest glyph; `mean` scales the ramp.
    let glyph = '';
    const cover = (g: string) => (g === '@' ? 30 : g === 'D' ? 30 * max : 30 * mean);
    return { getContext: () => ({ font: '', textAlign: '', textBaseline: '', fillStyle: '', clearRect() {}, fillText(g: string) { glyph = g; }, getImageData: () => ({ data: Object.assign(new Uint8ClampedArray(4), { 3: 255 * cover(glyph) / 100 }) }) }) } as unknown as HTMLElement;
  });

  it('leaves ASCII-weight sets as they are, and every set as it is without a 2D canvas', () => {
    expect(balanceCharset(' .:-=+*#%@', { glyphScale: 0.9 })).toEqual({ glyphScale: 0.9, gamma: 1, fontWeight: 500 });
    const plain = inkWeight(' x');
    expect([plain.max, plain.mean].map(v => +v.toFixed(3))).toEqual([1, 1]);
  });

  it('shrinks heavy glyphs and enlarges and bolds faint ones, never touching tone', () => {
    weigh(2.6, 1); const heavy = balanceCharset(' D', { glyphScale: 0.8 }), faint = (weigh(0.4, 1), balanceCharset(' D ', { glyphScale: 0.8 }));
    expect(heavy.glyphScale).toBeLessThan(0.8);
    expect(faint.glyphScale).toBeGreaterThan(0.8);
    expect(faint.fontWeight).toBe(700);
    expect([heavy.gamma, faint.gamma]).toEqual([1, 1]);
  });
});

describe('global look', () => {
  it('re-skins live glyph fields, skips dots, letters and opt-outs, and gives each its own charset back', () => {
    const seen: unknown[] = [];
    const off = subscribeGlobalLook(look => seen.push(look));
    const orb = statusOrb(as(at(0))), dots = beam(as(at(0))), word = statusOrb(as(at(0)), { look: { charset: ' ABC' } });
    const kept = statusOrb(as(at(0)), { globalLook: false });
    // Two mounts a frame: the four are live after two.
    advance(20); advance(20);
    setGlobalLook({ charset: ' .oO@' });
    expect(getGlobalLook()).toEqual({ charset: ' .oO@' });
    expect(seen).toEqual([{ charset: ' .oO@' }]);
    expect(fields[0].update).toHaveBeenCalledWith(expect.objectContaining({ charset: ' .oO@' }));
    for (const f of fields.slice(1)) expect(f.update).not.toHaveBeenCalledWith(expect.objectContaining({ charset: ' .oO@' }));

    // The component's own updates keep the global characters; a new field mounts with them.
    orb.update({ look: { charset: ' -+' } });
    expect(fields[0].update.mock.calls.slice(-1)[0]?.[0]).toMatchObject({ charset: ' .oO@' });
    advance(20);
    const late = statusOrb(as(at(0)));
    expect(optionsOf(4)).toMatchObject({ charset: ' .oO@' });

    setGlobalLook(null);
    expect(fields[0].update).toHaveBeenLastCalledWith(expect.objectContaining({ charset: ' -+' }));
    expect(fields[4].update).toHaveBeenLastCalledWith(expect.objectContaining({ charset: ' .:-=+*#%@' }));
    off();
    setGlobalLook({ charset: ' 01' });
    expect(seen).toHaveLength(2);
    for (const h of [orb, dots, word, kept, late]) h.destroy();
  });

  it('offers every Studio render style, each as a mark the field draws', () => {
    expect(Object.keys(KIT_STYLES)).toEqual([...STUDIO_STYLES]);
    expect(KIT_STYLES.ascii).toEqual({ mark: 'glyph', charset: ' .:-=+*#%@' });
    expect(KIT_STYLES.dots.mark).toBe('dot');
    expect(KIT_STYLES.lego.mark).toBe('lego');
  });

  it('normalises the look: unknown styles and empty charsets are dropped', () => {
    setGlobalLook({ style: 'bricks' as never, charset: '' });
    expect(getGlobalLook()).toEqual({});
    setGlobalLook({ style: 'toString' as never });
    expect(getGlobalLook()).toEqual({});
    setGlobalLook({ style: 'voxel', charset: ' 01' });
    expect(getGlobalLook()).toEqual({ style: 'voxel', charset: ' 01' });
  });

  it('draws a style in every opted-in glyph field, skipping dots, letters and opt-outs, and puts each mark back', () => {
    const orb = statusOrb(as(at(0))), dots = beam(as(at(0))), word = statusOrb(as(at(0)), { look: { charset: ' ABC' } });
    const kept = statusOrb(as(at(0)), { globalLook: false });
    advance(20); advance(20);
    setGlobalLook({ style: 'lego' });
    // A tile style keeps the field's own charset, which decides the cells left empty.
    expect(fields[0].update).toHaveBeenLastCalledWith(expect.objectContaining({ mark: 'lego', charset: ' .:-=+*#%@' }));
    for (const f of fields.slice(1)) expect(f.update).not.toHaveBeenCalledWith(expect.objectContaining({ mark: 'lego' }));

    // The component's own updates keep the style; a new field mounts with it.
    orb.update({ look: { charset: ' -+' } });
    expect(fields[0].update.mock.calls.slice(-1)[0]?.[0]).toMatchObject({ mark: 'lego', charset: ' -+' });
    advance(20);
    const late = statusOrb(as(at(0)));
    expect(optionsOf(4)).toMatchObject({ mark: 'lego' });

    // A glyph-like style brings its ramp, balanced like any charset; a charset beside it wins.
    setGlobalLook({ style: 'lines' });
    expect(fields[0].update).toHaveBeenLastCalledWith(expect.objectContaining({ mark: 'glyph', charset: ' -═╪╬' }));
    setGlobalLook({ style: 'lines', charset: ' 01' });
    expect(fields[0].update).toHaveBeenLastCalledWith(expect.objectContaining({ mark: 'glyph', charset: ' 01' }));
    setGlobalLook({ style: 'dots' });
    expect(fields[0].update).toHaveBeenLastCalledWith(expect.objectContaining({ mark: 'dot' }));
    // The same look again changes nothing.
    const calls = fields[0].update.mock.calls.length;
    setGlobalLook({ style: 'dots' });
    expect(fields[0].update.mock.calls).toHaveLength(calls);

    setGlobalLook(null);
    expect(fields[0].update).toHaveBeenLastCalledWith(expect.objectContaining({ mark: 'glyph', charset: ' -+' }));
    expect(fields[4].update).toHaveBeenLastCalledWith(expect.objectContaining({ mark: 'glyph', charset: ' .:-=+*#%@' }));
    expect(fields[1].update).not.toHaveBeenCalledWith(expect.objectContaining({ mark: 'glyph' }));
    for (const h of [orb, dots, word, kept, late]) h.destroy();
  });

  it('gives a halftone background characters under a look, laid out as glyph cells, and its dots back after', () => {
    const bg = background(as(at(0)), { preset: swell });
    expect(optionsOf(0)).toMatchObject({ mark: 'dot', cellAspect: 1 });
    setGlobalLook({ charset: ' .oO@' });
    expect(fields[0].update).toHaveBeenLastCalledWith(expect.objectContaining({ mark: 'glyph', charset: ' .oO@', cellAspect: 0.62 }));
    setGlobalLook({ style: 'stipple' });
    expect(fields[0].update).toHaveBeenLastCalledWith(expect.objectContaining({ mark: 'stipple' }));
    setGlobalLook(null);
    expect(fields[0].update).toHaveBeenLastCalledWith(expect.objectContaining({ mark: 'dot', cellAspect: 1 }));
    bg.destroy();
  });

  it('survives a remount and follows a change of globalLook', () => {
    setGlobalLook({ charset: ' 01' });
    const el = at(0);
    const orb = statusOrb(as(el));
    scroll([el, 4000]);
    scroll([el, 0]);
    expect(optionsOf(1)).toMatchObject({ charset: ' 01' });
    orb.update({ globalLook: false });
    expect(fields[1].update.mock.calls.slice(-1)[0]?.[0]).toMatchObject({ charset: ' .:-=+*#%@' });
    orb.destroy();
  });
  it('sweeps a ready field to the new characters, and skips the sweep under reduced motion', async () => {
    const el = at(0);
    const orb = statusOrb(as(el));
    await flush();
    const sweeps = () => el.children.filter(c => c.dataset?.asciiSweep !== undefined);
    setGlobalLook({ charset: ' 01' });
    // The old frame is drawn and held before the field takes the new characters.
    expect(fields[0].redraw.mock.invocationCallOrder[0]).toBeLessThan(fields[0].update.mock.invocationCallOrder.slice(-1)[0]);
    const [layer, scan] = sweeps();
    expect(layer?.tagName).toBe('CANVAS');
    expect(scan?.tagName).toBe('SPAN');
    advance(); advance();
    expect(layer.animate).toHaveBeenCalledWith([{ clipPath: 'inset(0% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 100%)' }], expect.objectContaining({ duration: 200, delay: 40 }));
    expect(scan.animate).toHaveBeenCalled();

    env.reduced = true;
    setGlobalLook({ charset: ' .oO@' });
    expect(fields[0].update).toHaveBeenLastCalledWith(expect.objectContaining({ charset: ' .oO@' }));
    expect(sweeps()).toHaveLength(0);
    env.reduced = false;
    orb.destroy();
  });
});
