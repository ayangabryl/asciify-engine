import { describe, expect, it, vi } from 'vitest';

const { mount, support } = vi.hoisted(() => ({ mount: vi.fn(), support: { on: true } }));
vi.mock('../field', () => ({ isGlyphFieldSupported: () => support.on, mountGlyphField: mount }));

import { barAt, barLayout, blockChart } from './block-chart';
import { useFakeDom } from './fake-dom-2a';

const { env, advance, run, element, as, canvases, key } = useFakeDom(mount, support);

describe('blockChart', () => {
  it('grows the bars, then stops drawing, with a table for screen readers', () => {
    const el = element();
    const c = blockChart(as(el), { values: [3, 5, 8], labels: ['Mon', 'Tue', 'Wed'] });
    expect(canvases(el)).toHaveLength(1);
    expect(mount.mock.calls[0][1]).toMatchObject({ cellSize: 7, cellAspect: 1, blend: 'off' });
    const table = el.children.find(n => n.tagName === 'TABLE')!;
    expect(table.textContent).toBe('Mon3Tue5Wed8');
    expect(el.getAttribute('role')).toBe('group');
    expect(el.tabIndex).toBe(0);
    env.visibility.forEach(fn => fn([{ isIntersecting: true }]));
    advance();
    expect(env.frames.size).toBe(1);
    run(800);
    expect(env.frames.size).toBe(0);
    c.destroy();
    expect(el.children.some(n => n.tagName === 'TABLE')).toBe(false);
    expect(el.hasAttribute('role')).toBe(false);
  });
  it('reads bars out on hover and with the arrow keys', () => {
    const el = element();
    el.rect = { left: 0, top: 0, width: 300, height: 120 };
    const onHover = vi.fn();
    const c = blockChart(as(el), { values: [3, 5, 8], labels: ['Mon', 'Tue', 'Wed'], onHover });
    el.dispatch('pointermove', { clientX: 150, clientY: 60 });
    expect(c.active).toBe(1);
    expect(onHover).toHaveBeenLastCalledWith(1, 5, 'Tue');
    el.dispatch('pointerleave');
    expect(onHover).toHaveBeenLastCalledWith(null, null, null);
    key(el, 'ArrowLeft');
    expect(c.active).toBe(2);
    key(el, 'Home');
    expect(onHover).toHaveBeenLastCalledWith(0, 3, 'Mon');
    key(el, 'Escape');
    expect(c.active).toBeNull();
    c.destroy();
  });
  it('regrows on set() and drops a highlight past the new end', () => {
    const el = element();
    const c = blockChart(as(el), { values: [1, 2, 3, 4] });
    c.highlight(3);
    c.set([9, 9], ['a', 'b']);
    expect(c.active).toBeNull();
    expect(c.values).toEqual([9, 9]);
    expect(el.children.find(n => n.tagName === 'TABLE')!.textContent).toBe('a9b9');
    expect(env.frames.size).toBe(1);
    c.destroy();
  });
  it('keeps the readout without WebGL2', () => {
    support.on = false;
    const el = element();
    const onHover = vi.fn();
    const c = blockChart(as(el), { values: [1, 2], onHover, max: 4 });
    const plain = el.children.find(n => n.tagName === 'DIV')!;
    expect(plain.getAttribute('aria-hidden')).toBe('true');
    expect(plain.children.map(b => /height:([\d.]+)%/.exec(b.getAttribute('style') ?? '')?.[1])).toEqual(['25.00', '50.00']);
    key(el, 'End');
    expect(onHover).toHaveBeenCalledWith(1, 2, null);
    expect(c.supported).toBe(false);
    c.set([4, 2]);
    expect(plain.children[0].getAttribute('style')).toContain('height:100.00%');
    c.destroy();
    expect(el.children.some(n => n === plain)).toBe(false);
  });
  it('lays bars on whole cells, centred, dropping the gaps only when they cannot fit', () => {
    expect(barLayout(60, 7)).toEqual({ bar: 6, gap: 3, left: 0 });
    expect(barLayout(106, 30)).toEqual({ bar: 2, gap: 1, left: 8 });
    expect(barLayout(43, 30)).toEqual({ bar: 1, gap: 0, left: 6 });
    expect(barLayout(10, 0)).toEqual({ bar: 0, gap: 0, left: 0 });
  });
  it('glides bars that keep their label and settles after the move', () => {
    const el = element();
    const c = blockChart(as(el), { values: [1, 2, 3], labels: ['a', 'b', 'c'], intro: false });
    run(100);
    c.set([5, 1, 2, 3], ['z', 'a', 'b', 'c']);
    expect(c.values).toEqual([5, 1, 2, 3]);
    expect(el.children.find(n => n.tagName === 'TABLE')!.textContent).toBe('z5a1b2c3');
    expect(env.frames.size).toBe(1);
    run(900);
    expect(env.frames.size).toBe(0);
    c.destroy();
  });
  it('maps a position to a bar', () => {
    expect(barAt(0, 7)).toBe(0);
    expect(barAt(0.999, 7)).toBe(6);
    expect(barAt(1.2, 7)).toBe(6);
    expect(barAt(0.5, 0)).toBe(-1);
  });
});
