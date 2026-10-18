import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountGlyphField } from './glyph-field';

/* Just enough WebGL2 and DOM for the field to mount and draw in Node: every GL call succeeds and draws are counted. */

const constants = new Map<string, number>();
const fakeGl = (counts: { draws: number }) => new Proxy({} as Record<string | symbol, unknown>, {
  get(target, key) {
    if (typeof key !== 'string') return undefined;
    if (/^[A-Z0-9_]+$/.test(key)) { if (!constants.has(key)) constants.set(key, 0x9000 + constants.size); return constants.get(key); }
    if (key === 'drawArrays') return () => { counts.draws++; };
    if (key === 'getExtension') return () => null;
    if (key === 'isContextLost') return () => false;
    if (key === 'getProgramParameter') return (_: unknown, name: number) => (name === constants.get('ACTIVE_UNIFORMS') ? 0 : true);
    if (key === 'checkFramebufferStatus') return () => constants.get('FRAMEBUFFER_COMPLETE');
    if (key.startsWith('create')) return () => ({});
    return target[key] ?? (() => null);
  },
});
const fake2d = () => new Proxy({} as Record<string | symbol, unknown>, {
  get(target, key) {
    if (key in target) return target[key];
    if (key === 'measureText') return () => ({ width: 8, actualBoundingBoxAscent: 9, actualBoundingBoxDescent: 2 });
    if (key === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
    return () => {};
  },
  set(target, key, value) { target[key] = value; return true; },
});
const listeners = () => {
  const map = new Map<string, Set<unknown>>();
  return { map, addEventListener: (type: string, fn: unknown) => { if (!map.has(type)) map.set(type, new Set()); map.get(type)!.add(fn); }, removeEventListener: (type: string, fn: unknown) => { map.get(type)?.delete(fn); } };
};
const fakeCanvas = (gl?: unknown) => ({
  width: 300, height: 150, clientWidth: 300, clientHeight: 150, dataset: {} as Record<string, string>,
  setAttribute() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 150 }),
  getContext: (type: string) => (type === 'webgl2' ? gl ?? null : fake2d()), ...listeners(),
});

let frames: FrameRequestCallback[], now: number, win: ReturnType<typeof listeners>, doc: ReturnType<typeof listeners>;
const runFrame = (ms = 16) => { const due = frames; frames = []; now += ms; due.forEach(fn => fn(now)); };
beforeEach(() => {
  frames = []; now = 0;
  doc = listeners(); win = listeners();
  vi.stubGlobal('document', { createElement: () => fakeCanvas(), hidden: false, ...doc });
  vi.stubGlobal('window', win);
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => frames.push(fn));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  for (const name of ['HTMLElement', 'HTMLImageElement', 'HTMLVideoElement']) vi.stubGlobal(name, class {});
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('glyph field frames', () => {
  it('draws a frame once when the caller already drew it with redraw(), stops when static, and leaves no listeners', async () => {
    const counts = { draws: 0 };
    const canvas = fakeCanvas(fakeGl(counts));
    const field = mountGlyphField(canvas as unknown as HTMLCanvasElement, { scene: 'none', hover: 'none', drift: 0 });
    runFrame();
    await field.ready;
    // A kit surface hands the field each painted frame and draws it at once, as mountSurface does.
    const source = fakeCanvas();
    for (let i = 0; i < 3; i++) {
      await field.setSource(source as unknown as HTMLCanvasElement);
      field.redraw();
      const drawn = counts.draws;
      runFrame();
      expect(counts.draws).toBe(drawn);
    }
    // Static: the loop stops once nothing changes.
    runFrame();
    expect(frames).toHaveLength(0);
    field.destroy();
    for (const target of [win, doc, canvas]) expect([...target.map.values()].every(set => !set.size)).toBe(true);
  });

  it('draws ambient motion at 60 frames a second on a 120 Hz screen', async () => {
    const counts = { draws: 0 };
    const field = mountGlyphField(fakeCanvas(fakeGl(counts)) as unknown as HTMLCanvasElement, { scene: 'none', hover: 'none', drift: 0.5 });
    runFrame();
    await field.ready;
    const start = counts.draws;
    for (let i = 0; i < 120; i++) runFrame(1000 / 120);
    // Two passes a drawn frame.
    expect((counts.draws - start) / 2).toBeLessThanOrEqual(61);
    expect((counts.draws - start) / 2).toBeGreaterThanOrEqual(55);
    field.destroy();
  });

  it('does no work on a zero-size canvas', () => {
    const counts = { draws: 0 };
    const canvas = { ...fakeCanvas(fakeGl(counts)), clientWidth: 0, clientHeight: 0, getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }) };
    const field = mountGlyphField(canvas as unknown as HTMLCanvasElement, { scene: 'none', hover: 'none', drift: 0.5 });
    for (let i = 0; i < 10; i++) runFrame();
    expect(counts.draws).toBe(0);
    expect(frames).toHaveLength(0);
    field.destroy();
  });
});
