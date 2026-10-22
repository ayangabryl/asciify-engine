import { describe, expect, it, vi } from 'vitest';

const { mount, support } = vi.hoisted(() => ({ mount: vi.fn(), support: { on: true } }));
vi.mock('../field', () => ({ isGlyphFieldSupported: () => support.on, mountGlyphField: mount }));

import { ocean, bodyWidth, createSpine, createWorld, laySpine, spawn, despawn, stepWorld, advanceWorld, tint, SPINE, OCEAN_KINDS, OCEAN_CHARSET } from './ocean';
import { useFakeDom } from './fake-dom-2a';

const { env, run, flush, element, as, canvases } = useFakeDom(mount, support);
const settings = { speed: 1, depth: 0.7, interactive: true };
const mountLook = () => mount.mock.calls[mount.mock.calls.length - 1]?.[1] as Record<string, unknown>;

describe('ocean geometry', () => {
  it('shapes bodies that taper to a point at the snout and stay slim at the tail', () => {
    for (const kind of ['fish', 'school', 'shark', 'hammerhead'] as const) {
      expect(bodyWidth(kind, 0)).toBeLessThan(0.01);
      const widest = Math.max(...Array.from({ length: 21 }, (_, i) => bodyWidth(kind, i / 20)));
      expect(bodyWidth(kind, 0.3)).toBeGreaterThan(widest * 0.85);
      expect(bodyWidth(kind, 1)).toBeLessThan(widest * 0.15);
    }
    expect(bodyWidth('shark', 0.3)).toBeLessThan(bodyWidth('fish', 0.3));
  });

  it('lays a spine of the right length behind the snout, bent by a turn and swung by the wave', () => {
    const sp = createSpine();
    laySpine(sp, 100, 50, 0, 0, 80, 0, 0, 1);
    expect(sp.x[0]).toBeCloseTo(100);
    expect(sp.x[SPINE]).toBeCloseTo(20);
    expect(sp.y[SPINE]).toBeCloseTo(50);
    expect(sp.ny[8]).toBeCloseTo(1);           // facing +x, the left normal points down the screen's y
    laySpine(sp, 100, 50, 0, 0.8, 80, 0, 0, 1);
    expect(sp.y[SPINE]).toBeGreaterThan(50 + 10); // turning, the tail trails the way it came
    laySpine(sp, 100, 50, 0, 0, 80, Math.PI / 2, 0.1, 1);
    const tailSwing = Math.abs(sp.y[SPINE] - 50), headSwing = Math.abs(sp.y[0] - 50);
    expect(tailSwing).toBeGreaterThan(headSwing * 3);
  });

  it('tints a colour to the tone the field reads', () => {
    const lum = (c: number[]) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
    for (const tone of [0.1, 0.5, 0.9]) expect(lum(tint([30, 90, 220], tone))).toBeCloseTo(tone, 2);
  });
});

describe('ocean motion', () => {
  it('is deterministic for a seed', () => {
    const a = createWorld(800, 450, 7), b = createWorld(800, 450, 7), c = createWorld(800, 450, 8);
    for (const w of [a, b, c]) { spawn(w, 'shark', 1); spawn(w, 'school', 20); }
    for (let i = 0; i < 120; i++) { stepWorld(a, 1 / 60, settings); stepWorld(b, 1 / 60, settings); stepWorld(c, 1 / 60, settings); }
    expect(a.bodies.map(o => [o.x, o.y])).toEqual(b.bodies.map(o => [o.x, o.y]));
    expect(a.bodies[0].x).not.toBe(c.bodies[0].x);
  });

  it('keeps a school together, turns back at the edges and draws far creatures first', () => {
    const w = createWorld(800, 450, 3);
    spawn(w, 'school', 24); spawn(w, 'fish', 3);
    for (let i = 0; i < 60 * 20; i++) stepWorld(w, 1 / 60, settings);
    const school = w.bodies.filter(o => o.kind === 'school');
    const cx = school.reduce((s, o) => s + o.x, 0) / school.length, cy = school.reduce((s, o) => s + o.y, 0) / school.length;
    const spread = Math.max(...school.map(o => Math.hypot(o.x - cx, o.y - cy)));
    expect(spread).toBeLessThan(260);
    for (const o of w.bodies) { expect(o.x).toBeGreaterThan(-120); expect(o.x).toBeLessThan(920); expect(o.y).toBeGreaterThan(-120); expect(o.y).toBeLessThan(570); }
    const zs = w.order.map(i => w.bodies[i].z);
    expect(zs).toEqual([...zs].sort((p, q) => q - p));
  });

  it('scatters small fish from the cursor and turns sharks toward it', () => {
    const w = createWorld(1000, 600, 5);
    spawn(w, 'fish', 1); spawn(w, 'shark', 1);
    const fish = w.bodies[0], shark = w.bodies[1];
    Object.assign(fish, { x: 500, y: 300, heading: 0, z: 0 });
    Object.assign(shark, { x: 250, y: 300, heading: -Math.PI / 2, z: 0 });
    Object.assign(w.pointer, { x: 470, y: 300, at: 0, on: true });
    const before = Math.hypot(fish.x - 470, fish.y - 300);
    for (let i = 0; i < 40; i++) stepWorld(w, 1 / 60, settings);
    expect(Math.hypot(fish.x - 470, fish.y - 300)).toBeGreaterThan(before + 10);
    expect(fish.fear).toBeGreaterThan(0);
    expect(Math.abs(shark.heading)).toBeLessThan(Math.PI / 2 - 0.2);  // swinging from up toward the cursor on its right
  });

  it('advances in fixed steps and removes a whole school at once', () => {
    const w = createWorld(400, 300, 1);
    spawn(w, 'school', 10); spawn(w, 'manta', 1);
    advanceWorld(w, 0.05, settings);
    expect(w.t).toBeCloseTo(3 / 60);
    expect(despawn(w, 'school')).toBe(true);
    expect(w.bodies.map(o => o.kind)).toEqual(['manta']);
    expect(despawn(w, 'jellyfish')).toBe(false);
  });
});

describe('ocean', () => {
  it('mounts under the content, swims, answers the cursor and a press, and cleans up', async () => {
    const host = element();
    host.rect = { left: 0, top: 0, width: 800, height: 450 };
    const o = ocean(as(host), { label: 'Sharks and fish swimming', creatures: [{ kind: 'shark' }, { kind: 'school', count: 12 }] });
    await flush();
    expect(canvases(host)).toHaveLength(1);
    expect(canvases(host)[0].style.zIndex).toBe('-1');
    expect(mountLook()).toMatchObject({ mark: 'inlay', charset: OCEAN_CHARSET, color: 'ink', background: 'transparent' });
    expect(host.textContent).toContain('Sharks and fish swimming');
    run(500);
    const frames = env.field.setSource.mock.calls.length;
    expect(frames).toBeGreaterThan(10);
    expect(o.count).toBe(13);
    host.dispatch('pointermove', { clientX: 400, clientY: 200 });
    host.dispatch('pointerdown', { clientX: 400, clientY: 200 });
    expect(env.field.pulse).toHaveBeenCalledWith(expect.objectContaining({ x: 400, y: 200 }));
    expect(o.add('jellyfish', { count: 2 })).toBe(2);
    expect(o.count).toBe(15);
    expect(o.remove('school')).toBe(true);
    expect(o.count).toBe(3);
    o.pause();
    run(200);
    const paused = env.field.setSource.mock.calls.length;
    run(200);
    expect(env.field.setSource.mock.calls.length).toBe(paused);
    o.play();
    o.update({ palette: { shark: '#3366ff' }, look: { mark: 'dither', cellSize: 6 } });
    expect(env.field.update).toHaveBeenLastCalledWith(expect.objectContaining({ color: 'source', cellSize: 6 }));
    o.destroy();
    expect(canvases(host)).toHaveLength(0);
    expect(host.textContent).not.toContain('Sharks');
  });

  it('holds a still composition under reduced motion, rebuilds for a new seed and falls back without WebGL2', async () => {
    env.reduced = true;
    const host = element();
    host.rect = { left: 0, top: 0, width: 600, height: 400 };
    const o = ocean(as(host), { seed: 4 });
    await flush();
    run(300);
    const after = env.field.setSource.mock.calls.length;
    run(300);
    expect(env.field.setSource.mock.calls.length).toBe(after);
    expect(o.count).toBe(1 + 1 + 1 + 1 + 18 + 14);
    o.update({ density: 2 });
    expect(o.count).toBe(2 * (1 + 1 + 1 + 1 + 18 + 14));
    o.destroy();
    env.reduced = false;
    support.on = false;
    const off = ocean(as(element()), { poster: '/ocean.png', creatures: [{ kind: 'fish', count: 2 }] });
    expect(off.supported).toBe(false);
    expect(off.add('manta')).toBe(1);
    expect(off.count).toBe(3);
    off.destroy();
  });

  it('lists its kinds', () => {
    expect(OCEAN_KINDS).toEqual(['fish', 'shark', 'hammerhead', 'manta', 'jellyfish', 'school']);
  });
});
