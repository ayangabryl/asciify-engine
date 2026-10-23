import { SurfaceTap } from '../../surface/surface-tap';
import { describe, expect, it, vi } from 'vitest';

const { mount, support } = vi.hoisted(() => ({ mount: vi.fn(), support: { on: true } }));
vi.mock('../../field', () => ({ isGlyphFieldSupported: () => support.on, mountGlyphField: mount }));

import { background } from '../background';
import { capillary, Capillary } from './capillary';
import { estuary, Estuary } from './estuary';
import { shockwave, Shockwave } from './shockwave';
import { SCATTER_LOOK } from './sim';
import { useFakeDom } from '../fake-dom-2a';

const { env, run, flush, element, as, canvases } = useFakeDom(mount, support);
const sum = (a: Float32Array) => a.reduce((s, v) => s + v, 0);
const lookOf = () => mount.mock.calls[mount.mock.calls.length - 1]?.[1] as Record<string, unknown>;

describe('capillary', () => {
  it('lays the same faint network for a seed, fades it in, and runs light along it from the pointer until it settles', () => {
    const a = new Capillary(2), b = new Capillary(2), out = new Float32Array(120 * 80);
    a.resize(120, 80); b.resize(120, 80);
    expect(Array.from(a.vein)).toEqual(Array.from(b.vein));
    a.render(out);
    expect(Math.max(...out)).toBeLessThanOrEqual(0.2);
    expect(out.filter(v => v > 0.05).length).toBeGreaterThan(400);
    expect(a.step(1 / 60, 1)).toBe(true);
    expect(a.intro).toBeLessThan(0.1);
    for (let i = 0; i < 60; i++) a.step(1 / 60, 1);
    expect(a.intro).toBe(1);
    expect(a.step(1 / 60, 1)).toBe(false);
    a.press(60, 40);
    a.step(1 / 60, 1);
    const near = a.level;
    for (let i = 0; i < 20; i++) a.step(1 / 60, 1);
    a.render(out);
    expect(near).toBeGreaterThan(0.5);
    expect(Math.max(...out)).toBeGreaterThan(0.4);
    // The light has run out along the veins beyond where it landed.
    const lit = (r: number) => { let n = 0; for (let y = 0; y < 80; y++) for (let x = 0; x < 120; x++) if (Math.hypot(x - 60, y - 40) > r && a.light[y * 120 + x] > 0.05) n++; return n; };
    expect(lit(24)).toBeGreaterThan(0);
    let moving = true;
    for (let i = 0; i < 60 * 30 && moving; i++) moving = a.step(1 / 30, 1);
    expect(moving).toBe(false);
    expect(sum(a.light)).toBe(0);
  });

  it('shows the whole network in a still frame that never stepped', () => {
    const c = new Capillary(1), out = new Float32Array(100 * 60);
    c.resize(100, 60);
    c.render(out);
    expect(Math.max(...out)).toBeGreaterThan(0.08);
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
  it('sends one ring that eases to a stop and fades, over streaks that drift', () => {
    const s = new Shockwave(1), out = new Float32Array(100 * 100);
    s.resize(100, 100);
    expect(s.step(1 / 60, 0)).toBe(false);
    expect(s.step(1 / 60, 1)).toBe(true);
    s.render(out);
    expect(Math.max(...out)).toBeLessThan(0.2);
    s.press(50, 50, 'ring');
    expect(s.count).toBe(1);
    for (let i = 0; i < 30; i++) s.step(1 / 60, 1);
    s.render(out);
    const r = Math.round(s.radius(0.5));
    expect(out[50 * 100 + 50 + r]).toBeGreaterThan(out[50 * 100 + 50] + 0.1);
    expect(s.radius(1) - s.radius(0.5)).toBeLessThan(s.radius(0.5));
    expect(s.radius(10)).toBeLessThan(100 * 0.45);
    for (let i = 0; i < 30 * 5; i++) s.step(1 / 30, 1);
    expect(s.count).toBe(0);
    expect(s.step(1 / 60, 0)).toBe(false);
  });
  it('defaults to one ring of lit letters: never back once it fades, the same timing every press, capped when stacked', () => {
    const s = new Shockwave(1);
    s.resize(120, 80);
    s.press(60, 40);
    expect(s.count).toBe(1);
    expect(s.tap).toBeNull();
    let last = 0;
    for (let t = 0.05; t < 3; t += 0.05) { const r = s.radius(t); expect(r).toBeGreaterThanOrEqual(last); last = r; }
    expect(s.radius(0.67) / s.reach).toBeCloseTo(0.6, 1);
    let prev = Infinity;
    for (let t = 0.1; t < 4; t += 0.05) { const a = Shockwave.glow(t); expect(a).toBeLessThanOrEqual(prev); prev = a; }
    expect(Shockwave.glow(5)).toBeLessThan(0.002);
    for (let i = 0; i < 9; i++) s.press(10 + i * 10, 40);
    expect(s.count).toBeLessThanOrEqual(6);
    let live = 0;
    for (let n = 0; n < s.count; n++) if (s.rings[n * 6 + 4] < 0) live++;
    expect(live).toBe(4);
  });
});

describe('surface tap', () => {
  it('on request sends a front over the wind that the wind carries and that fades', () => {
    const s = new Shockwave(1), out = new Float32Array(160 * 90);
    s.resize(160, 90);
    s.step(1 / 60, 1); s.render(out);
    s.press(80, 45, 'surface');
    expect(s.count).toBe(0);
    expect(s.tap?.live).toBe(true);
    for (let i = 0; i < 36; i++) { s.step(1 / 60, 1); s.render(out); }
    // Downwind (right and up) the front has run further than upwind.
    const reach = (dx: number, dy: number) => { let r = 0; for (let k = 1; k < 70; k++) { const x = Math.round(80 + dx * k), y = Math.round(45 + dy * k); if (x < 0 || y < 0 || x >= 160 || y >= 90) break; if (Math.abs(s.tap!.h[y * 160 + x]) > s.tap!.front * 0.3) r = k; } return r; };
    expect(reach(0.93, -0.36)).toBeGreaterThan(reach(-0.93, 0.36));
    for (let i = 0; i < 60 * 4; i++) { s.step(1 / 30, 1); s.render(out); }
    expect(s.tap?.live).toBe(false);
  });
  it('travels slower over a slow medium and is held back by a wall', () => {
    const open = new SurfaceTap(80, 40), slow = new SurfaceTap(80, 40), walled = new SurfaceTap(80, 40);
    slow.speed.fill(0.25);
    for (let y = 0; y < 40; y++) walled.wall[y * 80 + 50] = 0.9;
    for (const t of [open, slow, walled]) { t.base = 30; t.drop(30, 20, 1, 2); for (let i = 0; i < 30; i++) t.step(1 / 60); }
    const ahead = (t: SurfaceTap) => { let m = 0, at = 0; for (let x = 33; x < 80; x++) if (t.h[20 * 80 + x] > m) { m = t.h[20 * 80 + x]; at = x; } return at; };
    expect(ahead(slow)).toBeLessThan(ahead(open));
    for (const t of [open, walled]) for (let i = 0; i < 40; i++) t.step(1 / 60);
    const beyond = (t: SurfaceTap) => { let e = 0; for (let y = 0; y < 40; y++) for (let x = 52; x < 80; x++) e += Math.abs(t.h[y * 80 + x]); return e; };
    expect(beyond(walled)).toBeLessThan(beyond(open) * 0.5);
  });
});

describe('simulation presets', () => {
  it.each([capillary, estuary, shockwave])('$id mounts under the content, wakes on the pointer and idles once settled', async preset => {
    const host = element();
    host.rect = { left: 0, top: 0, width: 600, height: 300 };
    const bg = background(as(host), { preset, speed: preset === capillary ? 1 : 0 });
    await flush();
    expect(canvases(host)).toHaveLength(1);
    expect(lookOf()).toMatchObject({ mark: 'glyph', charset: SCATTER_LOOK.charset, glyphOrder: 'scatter', cellAspect: 0.5, hover: 'none' });
    run(1200);
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
