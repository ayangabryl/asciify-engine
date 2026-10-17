import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mount, support } = vi.hoisted(() => ({ mount: vi.fn(), support: { on: true } }));
vi.mock('../field', () => ({ isGlyphFieldSupported: () => support.on, mountGlyphField: mount }));

import { beam } from './beam';
import { statusOrb } from './status-orb';
import { fieldBackground } from './field-background';
import { getFieldBudget, getGlobalLook, setFieldBudget, setGlobalLook, subscribeGlobalLook } from './core-live';
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

describe('lazy mounting', () => {
  it('mounts near the viewport, releases beyond one viewport, and keeps the handle working throughout', async () => {
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

    scroll([el, 1500]);
    expect(fields[0].destroy).not.toHaveBeenCalled();
    scroll([el, 2000]);
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

    // c comes on screen while b scrolls away: b, the farthest, gives its context to c.
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

  it('lets a lazy: false field displace the farthest live one', () => {
    setFieldBudget(1);
    beam(as(at(0)));
    beam(as(at(300)), { lazy: false });
    expect(mount).toHaveBeenCalledTimes(2);
    expect(fields[0].destroy).toHaveBeenCalledOnce();
  });
});

describe('posters', () => {
  it('shows the poster under the canvas until the first frame and again while released', async () => {
    const el = at(0);
    const b = beam(as(el), { poster: '/beam.webp' });
    const [img] = imgs(el);
    expect(img.src).toBe('/beam.webp');
    expect(img.getAttribute('aria-hidden')).toBe('true');
    expect(el.children.indexOf(img)).toBeLessThan(el.children.indexOf(canvases(el)[0]));
    expect(img.style.opacity).toBe('1');
    await flush();
    expect(img.style.opacity).toBe('0');
    scroll([el, 3000]);
    expect(img.style.opacity).toBe('1');
    scroll([el, 0]);
    await flush();
    expect(img.style.opacity).toBe('0');
    b.destroy();
    expect(imgs(el)).toHaveLength(0);
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

describe('global look', () => {
  it('re-skins live glyph fields, skips dots, letters and opt-outs, and gives each its own charset back', () => {
    const seen: unknown[] = [];
    const off = subscribeGlobalLook(look => seen.push(look));
    const orb = statusOrb(as(at(0))), dots = beam(as(at(0))), word = statusOrb(as(at(0)), { look: { charset: ' ABC' } });
    const kept = statusOrb(as(at(0)), { globalLook: false });
    setGlobalLook({ charset: ' .oO@' });
    expect(getGlobalLook()).toEqual({ charset: ' .oO@' });
    expect(seen).toEqual([{ charset: ' .oO@' }]);
    expect(fields[0].update).toHaveBeenCalledWith({ charset: ' .oO@' });
    for (const f of fields.slice(1)) expect(f.update).not.toHaveBeenCalledWith({ charset: ' .oO@' });

    // The component's own updates keep the global characters; a new field mounts with them.
    orb.update({ look: { charset: ' -+' } });
    expect(fields[0].update.mock.calls.slice(-1)[0]?.[0]).toMatchObject({ charset: ' .oO@' });
    const late = statusOrb(as(at(0)));
    expect(optionsOf(4)).toMatchObject({ charset: ' .oO@' });

    setGlobalLook(null);
    expect(fields[0].update).toHaveBeenLastCalledWith({ charset: ' -+' });
    expect(fields[4].update).toHaveBeenLastCalledWith({ charset: ' .:-=+*#%@' });
    off();
    setGlobalLook({ charset: ' 01' });
    expect(seen).toHaveLength(2);
    for (const h of [orb, dots, word, kept, late]) h.destroy();
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
    expect(fields[0].update).toHaveBeenLastCalledWith({ charset: ' .oO@' });
    expect(sweeps()).toHaveLength(0);
    env.reduced = false;
    orb.destroy();
  });
});
