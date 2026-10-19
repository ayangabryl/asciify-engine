import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* Many fields, one context: the page's shared WebGL2 context draws every field and a 2D blit shows each one. */

const constants = new Map<string, number>();
const counts = { contexts: 0, programs: 0, atlasUploads: 0, draws: 0, blits: 0, raf: 0, textures: 0, buffers: 0 };
const fakeGl = () => new Proxy({} as Record<string | symbol, unknown>, {
  get(target, key) {
    if (typeof key !== 'string') return undefined;
    if (/^[A-Z0-9_]+$/.test(key)) { if (!constants.has(key)) constants.set(key, 0x9000 + constants.size); return constants.get(key); }
    if (key === 'drawArrays') return () => { counts.draws++; };
    if (key === 'createProgram') return () => { counts.programs++; return {}; };
    if (key === 'createTexture') return () => { counts.textures++; return {}; };
    if (key === 'deleteTexture') return () => { counts.textures--; };
    if (key === 'createFramebuffer') return () => { counts.buffers++; return {}; };
    if (key === 'deleteFramebuffer') return () => { counts.buffers--; };
    // The atlas is the only upload from a canvas in these fields (no source).
    if (key === 'texImage2D') return (...args: unknown[]) => { if (args.length === 6 && (args[5] as { getContext?: unknown })?.getContext) counts.atlasUploads++; };
    if (key === 'getExtension') return () => null;
    if (key === 'isContextLost') return () => false;
    if (key === 'getParameter') return () => 'Fake GPU';
    if (key === 'getProgramParameter') return (_: unknown, name: number) => (name === constants.get('ACTIVE_UNIFORMS') ? 0 : true);
    if (key === 'checkFramebufferStatus') return () => constants.get('FRAMEBUFFER_COMPLETE');
    if (key.startsWith('create')) return () => ({});
    return target[key] ?? (() => null);
  },
});
const fake2d = (canvas: unknown) => new Proxy({ canvas } as Record<string | symbol, unknown>, {
  get(target, key) {
    if (key in target) return target[key];
    if (key === 'measureText') return () => ({ width: 8, actualBoundingBoxAscent: 9, actualBoundingBoxDescent: 2 });
    if (key === 'drawImage') return () => { counts.blits++; };
    return () => {};
  },
  set(target, key, value) { target[key] = value; return true; },
});
const listeners = () => {
  const map = new Map<string, Set<(event: unknown) => void>>();
  return {
    map,
    addEventListener: (type: string, fn: (event: unknown) => void) => { if (!map.has(type)) map.set(type, new Set()); map.get(type)!.add(fn); },
    removeEventListener: (type: string, fn: (event: unknown) => void) => { map.get(type)?.delete(fn); },
    fire: (type: string, event: unknown = { preventDefault() {} }) => { for (const fn of [...map.get(type) ?? []]) fn(event); },
  };
};
const size = (map: Map<string, Set<unknown>>) => [...map.values()].reduce((n, set) => n + set.size, 0);
type FakeCanvas = ReturnType<typeof listeners> & { width: number; height: number; clientWidth: number; clientHeight: number; getContext(type: string): unknown };
let sharedCanvas: FakeCanvas | null;
const fakeCanvas = (role: 'view' | 'paint' | 'shared'): FakeCanvas => {
  let two: unknown = null, gl: unknown = null;
  const canvas: FakeCanvas = {
    width: 300, height: 150, clientWidth: 300, clientHeight: 150, ...listeners(),
    getContext(type: string) {
      if (type === 'webgl2') { if (role !== 'shared' || two) return null; if (!gl) { counts.contexts++; gl = fakeGl(); } return gl; }
      if (gl) return null;
      return (two ??= fake2d(canvas));
    },
  };
  Object.assign(canvas, { dataset: {}, setAttribute() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 150 }) });
  if (role === 'shared') sharedCanvas = canvas;
  return canvas;
};

let frames: FrameRequestCallback[], now: number, win: ReturnType<typeof listeners>, doc: ReturnType<typeof listeners>;
const runFrame = (ms = 16) => { const due = frames; frames = []; now += ms; due.forEach(fn => fn(now)); };
let mountGlyphField: typeof import('./glyph-field').mountGlyphField;
let fieldGl: typeof import('./field-gl');
beforeEach(async () => {
  vi.resetModules();
  frames = []; now = 0; sharedCanvas = null;
  Object.assign(counts, { contexts: 0, programs: 0, atlasUploads: 0, draws: 0, blits: 0, raf: 0, textures: 0, buffers: 0 });
  doc = listeners(); win = listeners();
  let made = 0;
  // The first canvas the engine makes for itself is the shared context's; the rest are atlases.
  vi.stubGlobal('document', { createElement: () => fakeCanvas(made++ ? 'paint' : 'shared'), hidden: false, ...doc });
  vi.stubGlobal('window', win);
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { counts.raf++; frames.push(fn); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  for (const name of ['HTMLElement', 'HTMLImageElement', 'HTMLVideoElement']) vi.stubGlobal(name, class {});
  ({ mountGlyphField } = await import('./glyph-field'));
  fieldGl = await import('./field-gl');
});
afterEach(() => { vi.unstubAllGlobals(); });

const mountMany = (n: number, options = {}) => Array.from({ length: n }, () => {
  const canvas = fakeCanvas('view');
  return { canvas, field: mountGlyphField(canvas as unknown as HTMLCanvasElement, { scene: 'none', hover: 'trail', drift: 0.5, ...options }) };
});

describe('shared field context', () => {
  it('draws many fields with one context, one program set, one atlas and one frame request a frame', async () => {
    const fields = mountMany(6);
    expect(counts.contexts).toBe(1);
    const programs = counts.programs;
    // The cell and composite programs, linked once for the page.
    expect(programs).toBe(2);
    expect(counts.atlasUploads).toBe(1);
    runFrame();
    await Promise.all(fields.map(f => f.field.ready));
    counts.raf = 0;
    for (let i = 0; i < 10; i++) runFrame(1000 / 60);
    expect(counts.raf).toBeLessThanOrEqual(10);
    // Each drawn frame is two passes and one blit to the field's own canvas.
    expect(counts.blits).toBeGreaterThan(0);
    expect(counts.draws).toBe(counts.blits * 2);
    expect(counts.programs).toBe(programs);
    fields.forEach(f => f.field.destroy());
  });

  it('keeps the page listeners the same however many fields mount, and removes them with the last', () => {
    const one = mountMany(1);
    const withOne = size(win.map) + size(doc.map);
    const more = mountMany(8);
    expect(size(win.map) + size(doc.map)).toBe(withOne);
    [...one, ...more].forEach(f => f.field.destroy());
    expect(size(win.map) + size(doc.map)).toBe(0);
    // Remounting churns nothing either.
    for (let i = 0; i < 5; i++) mountMany(3).forEach(f => f.field.destroy());
    expect(size(win.map) + size(doc.map)).toBe(0);
  });

  it('stops on a lost context and draws again when it is restored, with nothing compiled twice per field', async () => {
    const fields = mountMany(3, { drift: 0 });
    runFrame();
    await Promise.all(fields.map(f => f.field.ready));
    sharedCanvas!.fire('webglcontextlost');
    const blits = counts.blits;
    runFrame(); runFrame();
    expect(counts.blits).toBe(blits);
    const programs = counts.programs;
    sharedCanvas!.fire('webglcontextrestored');
    runFrame(); runFrame();
    expect(counts.blits).toBeGreaterThanOrEqual(blits + 3);
    // Restored, the page links its programs once again: not once per field.
    expect(counts.programs - programs).toBe(2);
    fields.forEach(f => f.field.destroy());
  });

  it('gives each field its own frame through redraw(), readable in the same task', () => {
    const [{ field }] = mountMany(1, { drift: 0 });
    const blits = counts.blits;
    field.redraw();
    expect(counts.blits).toBe(blits + 1);
    field.destroy();
  });

  it('listens to an interaction target in a shadow root directly, which the page listener cannot see into', () => {
    const host = { ...listeners(), ownerDocument: document, getRootNode: () => ({ host: {} }) };
    const canvas = fakeCanvas('view');
    const field = mountGlyphField(canvas as unknown as HTMLCanvasElement, { scene: 'none', hover: 'trail', interactionTarget: host as unknown as HTMLElement });
    expect(host.map.get('pointermove')?.size).toBe(1);
    field.destroy();
    expect(size(host.map)).toBe(0);
  });

  it('holds bounded GPU memory over repeated mount, draw and destroy: textures, render targets and atlases all come back', async () => {
    const first = mountMany(1, { hover: 'none' });
    runFrame();
    const textures = counts.textures, buffers = counts.buffers, bytes = fieldGl.currentFieldContext()!.bytes;
    for (let round = 0; round < 20; round++) {
      // Every round a different charset: unused atlases are kept only up to the spare count.
      const fields = mountMany(5, { hover: round % 2 ? 'lantern' : 'trail', charset: ` .:${String.fromCharCode(65 + round)}#` });
      runFrame(); runFrame();
      fields.forEach(f => f.field.destroy());
    }
    runFrame();
    expect(counts.buffers).toBe(buffers);
    // The one field left, plus at most eight spare atlases.
    expect(counts.textures - textures).toBeLessThanOrEqual(8);
    expect(fieldGl.currentFieldContext()!.bytes - bytes).toBeLessThan(8 * 1024 * 1024);
    first.forEach(f => f.field.destroy());
  });

  it('gives the shared drawing buffer back once the largest field has gone', () => {
    const small = mountMany(1, { drift: 0 });
    const big = fakeCanvas('view');
    Object.assign(big, { clientWidth: 3000, clientHeight: 1600 });
    const field = mountGlyphField(big as unknown as HTMLCanvasElement, { scene: 'none', hover: 'none', drift: 0 });
    field.redraw();
    expect(sharedCanvas!.width).toBeGreaterThanOrEqual(3000);
    field.destroy();
    expect(sharedCanvas!.width).toBeLessThan(1024);
    small.forEach(f => f.field.destroy());
  });

  it('falls back to a context of its own for a canvas that already holds one', () => {
    let own = 0;
    const canvas = { ...fakeCanvas('view'), getContext: (type: string) => (type === 'webgl2' ? (own++, fakeGl()) : null) };
    const field = mountGlyphField(canvas as unknown as HTMLCanvasElement, { scene: 'none', hover: 'none', drift: 0 });
    expect(own).toBe(1);
    field.destroy();
  });
});
