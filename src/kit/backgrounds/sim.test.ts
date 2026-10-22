import { describe, expect, it, vi } from 'vitest';

const { mount, support } = vi.hoisted(() => ({ mount: vi.fn(), support: { on: true } }));
vi.mock('../../field', () => ({ isGlyphFieldSupported: () => support.on, mountGlyphField: mount }));

import { background } from '../background';
import { capillary, Capillary } from './capillary';
import { estuary, Estuary } from './estuary';
import { shockwave, Shockwave } from './shockwave';
import { useFakeDom } from '../fake-dom-2a';

const { env, run, flush, element, as, canvases } = useFakeDom(mount, support);
const sum = (a: Float32Array) => a.reduce((s, v) => s + v, 0);
const lookOf = () => mount.mock.calls[mount.mock.calls.length - 1]?.[1] as Record<string, unknown>;

describe('capillary', () => {
  it('grows the same faint resting network for a seed, and veins toward the pointer that fade and settle', () => {
    const a = new Capillary(2), b = new Capillary(2), out = new Float32Array(120 * 80);
    a.resize(120, 80); b.resize(120, 80);
    expect(Array.from(a.rest)).toEqual(Array.from(b.rest));
    a.render(out);
    expect(Math.max(...out)).toBeLessThanOrEqual(0.17);
    expect(out.filter(v => v > 0).length).toBeGreaterThan(200);
    a.press(60, 40);
    expect(a.tips).toBe(9);
    for (let i = 0; i < 30; i++) a.step(1 / 60, 1);
    a.render(out);
    expect(Math.max(...out)).toBeGreaterThan(0.4);
    let moving = true;
    for (let i = 0; i < 60 * 30 && moving; i++) moving = a.step(1 / 30, 1);
    expect(moving).toBe(false);
    expect(a.tips).toBe(0);
    expect(sum(a.live)).toBe(0);
  });

  it('turns a pointer-grown vein toward the pointer', () => {
    const c = new Capillary(1);
    c.resize(200, 100);
    c.move(150, 50, 0, 0); c.move(150, 50, 3, 0);
    c.sprout(50, 50, Math.PI / 2, 200, 1);
    const k = c.tips - 1;
    for (let i = 0; i < 40; i++) c.grow(c.live);
    expect(Math.cos(c.a[k])).toBeGreaterThan(0);
  });
});

describe('estuary', () => {
  it('drifts, is still at speed 0 until stirred, and settles back', () => {
    const e = new Estuary(1), out = new Float32Array(80 * 50);
    e.resize(80, 50);
    expect(e.step(1 / 60, 0)).toBe(false);
    e.render(out);
    const before = Float32Array.from(out);
    e.move(40, 25, 4, 0);
    expect(e.step(1 / 60, 0)).toBe(true);
    for (let i = 0; i < 20; i++) e.step(1 / 60, 0);
    e.render(out);
    expect(out.some((v, i) => Math.abs(v - before[i]) > 0.02)).toBe(true);
    let moving = true;
    for (let i = 0; i < 60 * 30 && moving; i++) moving = e.step(1 / 30, 0);
    expect(moving).toBe(false);
    expect(Math.max(...out)).toBeLessThan(0.9);
    expect(e.step(1 / 60, 1)).toBe(true);
  });
});

describe('shockwave', () => {
  it('sends a front and two echoes that spread, slow and fade', () => {
    const s = new Shockwave(1), out = new Float32Array(100 * 100);
    s.resize(100, 100);
    expect(s.step(1 / 60, 1)).toBe(false);
    s.press(50, 50);
    expect(s.count).toBe(3);
    for (let i = 0; i < 30; i++) s.step(1 / 60, 1);
    s.render(out);
    const r = Math.round(s.radius(0.5));
    expect(out[50 * 100 + 50 + r]).toBeGreaterThan(out[50 * 100 + 50] + 0.1);
    expect(s.radius(1) - s.radius(0.5)).toBeLessThan(s.radius(0.5));
    let moving = true;
    for (let i = 0; i < 60 * 10 && moving; i++) moving = s.step(1 / 30, 1);
    expect(moving).toBe(false);
    s.render(out);
    expect(Math.max(...out)).toBeLessThan(0.04);
  });
});

describe('simulation presets', () => {
  it.each([capillary, estuary, shockwave])('$id mounts under the content, wakes on the pointer and idles once settled', async preset => {
    const host = element();
    host.rect = { left: 0, top: 0, width: 600, height: 300 };
    const bg = background(as(host), { preset, speed: preset === estuary ? 0 : 1 });
    await flush();
    expect(canvases(host)).toHaveLength(1);
    expect(lookOf()).toMatchObject({ mark: 'glyph', charset: preset === capillary ? ' .·:-+*' : expect.any(String), hover: 'none' });
    run(200);
    const idle = env.field.setSource.mock.calls.length;
    run(300);
    expect(env.field.setSource.mock.calls.length).toBe(idle);
    host.dispatch('pointermove', { clientX: 300, clientY: 150 });
    host.dispatch('pointermove', { clientX: 330, clientY: 150 });
    host.dispatch('pointerdown', { clientX: 330, clientY: 150 });
    run(300);
    expect(env.field.setSource.mock.calls.length).toBeGreaterThan(idle + 5);
    bg.update({ look: { mark: 'dither' }, charset: 'blocks' });
    expect(env.field.update).toHaveBeenLastCalledWith(expect.objectContaining({ mark: 'dither' }));
    bg.destroy();
    expect(canvases(host)).toHaveLength(0);
  });

  it('draws one still frame under reduced motion and ignores the pointer', async () => {
    env.reduced = true;
    const host = element();
    host.rect = { left: 0, top: 0, width: 400, height: 200 };
    const bg = background(as(host), { preset: capillary });
    await flush();
    run(200);
    const frames = env.field.setSource.mock.calls.length;
    host.dispatch('pointerdown', { clientX: 100, clientY: 100 });
    run(300);
    expect(env.field.setSource.mock.calls.length).toBe(frames);
    bg.destroy();
  });
});
