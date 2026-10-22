import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mount, support } = vi.hoisted(() => ({ mount: vi.fn(), support: { on: true } }));
vi.mock('../field', () => ({ isGlyphFieldSupported: () => support.on, mountGlyphField: mount }));

import { globe, globeFrame, globeProject } from './globe';
import { isLand } from './land';
import { morphField, drawMorphSource } from './morph-field';
import { ditherGradient, ditherGradientFrame } from './dither-gradient';
import { ditherImage } from './dither-image';
import { decode, scrambleLetter, scriptFor, sweepText, SCRAMBLE_SCRIPTS } from './decode';
import { wordmark, scatterFrame } from './wordmark';
import { cursorTrail, cursorTrailFrame } from './cursor-trail';
import { entryProgress } from './core';
import { useFakeDom, FakeElement } from './fake-dom-2a';

const { env, run, flush, element, as, canvases } = useFakeDom(mount, support);
beforeEach(() => vi.stubGlobal('NodeFilter', { SHOW_TEXT: 4 }));
const last = <T>(list: T[]) => list[list.length - 1];
const looks = () => env.field.update.mock.calls.map(([o]) => o as Record<string, unknown>);
const lastLook = () => Object.assign({}, ...looks()) as Record<string, unknown>;
const mountLook = () => last(mount.mock.calls)?.[1] as Record<string, unknown>;

describe('globe', () => {
  it('knows land from sea', () => {
    expect(isLand(48.8, 2.3)).toBe(true);    // Paris
    expect(isLand(-23.5, 133)).toBe(true);   // central Australia
    expect(isLand(30, -40)).toBe(false);     // mid Atlantic
    expect(isLand(0, -150)).toBe(false);     // mid Pacific
  });

  it('draws a lit disc of land, ocean and lines, and projects points onto the near side only', () => {
    const image = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4) } as ImageData;
    globeFrame(image, 0, 0, 0.9, () => 1, 0, 0);
    const at = (x: number, y: number) => image.data[(y * 64 + x) * 4];
    expect(at(32, 32)).toBe(255);   // all land, facing us
    expect(at(1, 1)).toBe(0);        // outside the disc
    globeFrame(image, 0, 0, 0.9, () => 0, 15, 0);
    expect(at(32, 32)).toBeGreaterThan(at(36, 36) - 1); // the equator and the prime meridian cross in the middle
    expect(at(32, 32)).toBeGreaterThan(40);
    expect(globeProject({ lat: 0, lon: 0 }, 0, 0, 100, 100, 1)).toMatchObject({ x: 50, y: 50, front: true });
    expect(globeProject({ lat: 0, lon: 180 }, 0, 0, 100, 100, 1).front).toBe(false);
    expect(globeProject({ lat: 60, lon: 0 }, 0, 20, 100, 100, 1).y).toBeLessThan(50);
  });

  it('turns on its own, idles when still, and drags', async () => {
    const host = element();
    host.rect = { left: 0, top: 0, width: 400, height: 400 };
    const g = globe(as(host), { speed: 10, lon: 0, label: 'Our network' });
    await flush();
    expect(canvases(host)).toHaveLength(1);
    expect(host.textContent).toContain('Our network');
    expect(host.style.getPropertyValue('touch-action')).toBe('pan-y');
    run(1000);
    expect(g.lon).toBeLessThan(-5); // eastward: the facing longitude falls
    g.update({ speed: 0 });
    run(200);
    const calls = env.field.setSource.mock.calls.length;
    run(300);
    expect(env.field.setSource.mock.calls.length).toBe(calls);
    const before = g.lon;
    host.dispatch('pointerdown', { clientX: 200, timeStamp: 1 });
    host.dispatch('pointermove', { clientX: 280, timeStamp: 40 });
    host.dispatch('pointerup');
    expect(g.lon).toBeLessThan(before);
    g.rotateTo(120);
    run(1200);
    expect(Math.round(g.lon)).toBe(120);
    g.destroy();
    expect(canvases(host)).toHaveLength(0);
    expect(host.textContent).not.toContain('Our network');
  });

  it('holds still under reduced motion and is inert without WebGL2', () => {
    env.reduced = true;
    const host = element();
    const g = globe(as(host), { speed: 30, lon: 10 });
    run(500);
    expect(g.lon).toBe(10);
    g.destroy();
    env.reduced = false;
    support.on = false;
    const off = globe(as(element()));
    expect(off.supported).toBe(false);
    off.rotateTo(40);
    expect(off.lon).toBe(40);
    off.destroy();
  });
});

describe('morphField', () => {
  it('fits a source, waits for an unloaded image and calls drawing functions', () => {
    const pen = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
    const canvas = { width: 200, height: 100 } as HTMLCanvasElement;
    expect(drawMorphSource(pen, canvas, 100, 100, 0, 'cover')).toBe(true);
    expect((pen.drawImage as ReturnType<typeof vi.fn>).mock.calls[0].slice(1)).toEqual([-50, 0, 200, 100]);
    expect(drawMorphSource(pen, { naturalWidth: 0, naturalHeight: 0 } as HTMLImageElement, 100, 100, 0, 'cover')).toBe(false);
    const draw = vi.fn();
    expect(drawMorphSource(pen, draw, 10, 20, 5, 'contain')).toBe(true);
    expect(draw).toHaveBeenCalledWith(pen, 10, 20, 5);
  });

  it('holds, morphs to the next frame, reports it and idles between morphs', async () => {
    const host = element();
    const seen: number[] = [];
    const a = { width: 10, height: 10 }, b = { width: 10, height: 10 };
    const m = morphField(as(host), { sources: [a, b] as unknown as HTMLCanvasElement[], hold: 500, transition: 300, onChange: i => seen.push(i) });
    await flush();
    expect(mountLook()).toMatchObject({ mark: 'engraving', markAngle: -45 });
    run(100);
    const idle = env.field.setSource.mock.calls.length;
    run(200);
    expect(env.field.setSource.mock.calls.length).toBe(idle);
    run(600);
    expect(seen).toEqual([1]);
    expect(m.index).toBe(1);
    m.go(0);
    expect(seen).toEqual([1, 0]);
    m.destroy();
    expect(canvases(host)).toHaveLength(0);
  });

  it('does not cycle under reduced motion', () => {
    env.reduced = true;
    const seen: number[] = [];
    const m = morphField(as(element()), { sources: [{ width: 1, height: 1 }, { width: 1, height: 1 }] as unknown as HTMLCanvasElement[], hold: 100, onChange: i => seen.push(i) });
    run(1000);
    expect(seen).toEqual([]);
    m.next();
    expect(m.index).toBe(1);
    m.destroy();
  });
});

describe('ditherGradient', () => {
  it('lays lights over the ground additively', () => {
    const calls: string[] = [];
    const pen = new Proxy({} as Record<string, unknown>, {
      get: (t, k) => (k in t ? t[k as string] : k === 'createRadialGradient' ? () => ({ addColorStop: (at: number, c: string) => calls.push(`${at}:${c}`) }) : () => calls.push(String(k))),
      set: (t, k, v) => { t[k as string] = v; if (k === 'globalCompositeOperation') calls.push(`op:${v}`); return true; },
    }) as unknown as CanvasRenderingContext2D;
    ditherGradientFrame(pen, 100, 50, [{ x: 0.5, y: 1, strength: 0.5 }], 0.1, 0, 0, { x: 0, y: 0 });
    expect(calls).toContain('op:lighter');
    expect(calls).toContain('0:rgb(128,128,128)');
    expect(last(calls)).toBe('op:source-over');
  });

  it('dithers under the content, idles with no motion and leans to the pointer', async () => {
    const host = element();
    const d = ditherGradient(as(host), { motion: 0 });
    await flush();
    expect(mountLook()).toMatchObject({ mark: 'tick' });
    expect(canvases(host)[0].style.zIndex).toBe('-1');
    run(200);
    const idle = env.field.setSource.mock.calls.length;
    run(300);
    expect(env.field.setSource.mock.calls.length).toBe(idle);
    host.dispatch('pointermove', { clientX: 190, clientY: 5 });
    run(100);
    expect(env.field.setSource.mock.calls.length).toBeGreaterThan(idle);
    d.setLights([{ x: 0.2, y: 0.2 }]);
    d.destroy();
    expect(canvases(host)).toHaveLength(0);
  });
});

describe('ditherImage', () => {
  it('draws the inner image in two tones, hides it, and develops in when visible', async () => {
    const host = element(), img = element('IMG', host);
    (img as unknown as { alt: string }).alt = 'Field';
    env.styles.set(host, { '--brand-deep': '#0b1b4a' });
    const d = ditherImage(as(host), { tones: ['#0b1b4a', '#3a5bff'], duration: 400 });
    await flush();
    expect(img.style.getPropertyValue('visibility')).toBe('hidden');
    expect(last(mount.mock.calls)?.[1]).toMatchObject({ mark: 'bayer', background: '#0b1b4a', ink: '#3a5bff', label: 'Field' });
    expect(lastLook().brightness).toBe(-1);
    last(env.visibility)!([{ isIntersecting: true }]);
    run(500);
    expect(lastLook().brightness).toBe(0);
    d.destroy();
    expect(img.style.getPropertyValue('visibility')).toBe('');
  });

  it('ties the reveal to scroll, and shows at once under reduced motion', async () => {
    const host = element();
    host.rect = { left: 0, top: 900, width: 200, height: 200 };
    const d = ditherImage(as(host), { src: '/a.png', reveal: 'scroll' });
    await flush();
    expect(entryProgress(host as unknown as Element)).toBe(0);
    host.rect.top = 700;
    env.body.dispatch('scroll');
    expect(lastLook().brightness).toBeCloseTo(-0.5, 3);
    d.destroy();
    env.reduced = true;
    const still = ditherImage(as(element()), { src: '/a.png' });
    expect(last(mount.mock.calls)?.[1]).toMatchObject({ brightness: 0 });
    still.destroy();
  });
});

describe('decode scramble and scroll', () => {
  it('flips unlocked letters through an alphabet and keeps spaces and locked letters', () => {
    expect(scrambleLetter('A', 0, 3, 1, ['xyz'])).toBe('A');
    expect('xyz').toContain(scrambleLetter('A', 2, 3, 1, ['xyz']));
    expect(scrambleLetter(' ', 2, 3, 0, ['xyz'])).toBe(' ');
    expect(SCRAMBLE_SCRIPTS.length).toBeGreaterThan(3);
  });

  it('sweeps the HTML text through another alphabet on hover and lands on it, with no field', async () => {
    const link = element('A');
    link.textContent = 'Speakers';
    const text = link.childNodes[0] as unknown as { data: string };
    const calls = mount.mock.calls.length;
    const d = decode(as(link), { scramble: ['XYZ'], trigger: 'manual', duration: 600 });
    expect(mount.mock.calls.length).toBe(calls);
    expect(d.supported).toBe(true);
    link.dispatch('pointerenter');
    run(250);
    expect(text.data).not.toBe('Speakers');
    expect(text.data.length).toBe(8);
    expect([...text.data].some(c => 'XYZ'.includes(c))).toBe(true);
    run(700);
    expect(text.data).toBe('Speakers');
    d.destroy();
  });

  it('sweeps between words: new letters behind, flicker between the fronts, old letters ahead', () => {
    expect(sweepText('Hallo', 'Hola', 0, 0.1, 'ab').text).toBe('Hallo');
    const mid = sweepText('Hallo', 'Hola', 0.45, 0.1, 'ab');
    expect(mid.text.slice(0, 1)).toBe('H');
    expect(mid.text.slice(4)).toBe('o');
    expect(mid.done).toBe(false);
    expect(sweepText('Hallo', 'Hola', 2, 0.1, 'ab')).toEqual({ text: 'Hola', done: true });
    expect(scriptFor('연결', SCRAMBLE_SCRIPTS, 0)).toContain('결');
    expect(scriptFor('Conectar', SCRAMBLE_SCRIPTS, 0)).toContain('É');
  });

  it('follows scroll position and idles while the page is still', async () => {
    const h = element('H2');
    h.textContent = 'Build it';
    h.rect = { left: 0, top: 900, width: 300, height: 60 };
    const d = decode(as(h), { trigger: 'scroll', settle: 'text' });
    await flush();
    h.rect.top = 770;
    env.body.dispatch('scroll');
    run(100);
    const calls = env.field.setSource.mock.calls.length;
    run(300);
    expect(env.field.setSource.mock.calls.length).toBe(calls);
    expect(h.style.getPropertyValue('-webkit-text-fill-color')).toBe('transparent');
    h.rect.top = 400;
    env.body.dispatch('scroll');
    expect(h.style.getPropertyValue('-webkit-text-fill-color')).toBe('');
    d.destroy();
  });
});

describe('wordmark assemble', () => {
  it('scatters pieces at 0 and draws the word whole at 1', () => {
    const art = new FakeElement('CANVAS'), out = new FakeElement('CANVAS');
    art.width = 96; art.height = 48;
    scatterFrame(art as unknown as HTMLCanvasElement, 1, out as unknown as HTMLCanvasElement);
    const pen = out.getContext('2d') as unknown as { drawImage: ReturnType<typeof vi.fn> };
    expect(last(pen.drawImage.mock.calls)).toEqual([art, 0, 0]);
    pen.drawImage.mockClear();
    scatterFrame(art as unknown as HTMLCanvasElement, 0.5, out as unknown as HTMLCanvasElement);
    expect(pen.drawImage.mock.calls.length).toBeGreaterThan(1);
  });

  it('gathers as it scrolls into view', async () => {
    const box = element();
    box.rect = { left: 0, top: 900, width: 600, height: 200 };
    const w = wordmark(as(box), { text: 'connect', assemble: 'scroll' });
    await flush();
    const before = env.field.setSource.mock.calls.length;
    box.rect.top = 600;
    env.body.dispatch('scroll');
    expect(env.field.setSource.mock.calls.length).toBeGreaterThan(before);
    w.destroy();
  });
});

describe('cursorTrail spray', () => {
  it('sprays hatched patches with coordinate tags and a drag box, then idles', async () => {
    const trail = cursorTrail({ style: 'spray', readout: true });
    for (let i = 0; i < 8; i++) { env.body.dispatch('pointermove', { clientX: 40 + i * 30, clientY: 100, pointerType: 'mouse', buttons: 0 }); run(16); }
    await flush();
    const layer = env.body.children.find(el => el.dataset.asciiCursor !== undefined)!;
    expect(last(mount.mock.calls)?.[1]).toMatchObject({ mark: 'engraving', markAngle: -45 });
    const tags = layer.children.filter(el => el.tagName === 'SPAN');
    expect(tags.length).toBeGreaterThan(0);
    expect(tags[0].textContent).toMatch(/^\d+, \d+$/);
    env.body.dispatch('pointermove', { clientX: 300, clientY: 300, pointerType: 'mouse', buttons: 1 });
    env.body.dispatch('pointermove', { clientX: 380, clientY: 360, pointerType: 'mouse', buttons: 1 });
    expect(layer.children.filter(el => el.tagName === 'SPAN').some(el => el.textContent === '300, 300')).toBe(true);
    expect(trail.active).toBe(true);
    env.body.dispatch('pointermove', { clientX: 390, clientY: 370, pointerType: 'mouse', buttons: 0 });
    run(3000);
    expect(trail.active).toBe(false);
    trail.destroy();
  });

  it('draws square hatch patches snapped to the cells, and the drag box as a hairline in the DOM', async () => {
    const rects: number[][] = [];
    const pen = new Proxy({} as Record<string, unknown>, {
      get: (t, k) => (k in t ? t[k as string] : k === 'fillRect' ? (...a: number[]) => rects.push(a) : () => {}),
      set: (t, k, v) => { t[k as string] = v; return true; },
    }) as unknown as CanvasRenderingContext2D;
    cursorTrailFrame(pen, [{ x: 50, y: 50, t: 100, seed: 0, vx: 0, vy: 0 }], 'spray', 100, 800, 9, 1);
    expect(rects).toEqual([[45, 45, 18, 18]]);
    const trail = cursorTrail({ style: 'spray', readout: true });
    env.body.dispatch('pointermove', { clientX: 300, clientY: 300, pointerType: 'mouse', buttons: 1 });
    env.body.dispatch('pointermove', { clientX: 380, clientY: 360, pointerType: 'mouse', buttons: 1 });
    await flush();
    const layer = env.body.children.find(el => el.dataset.asciiCursor !== undefined)!;
    const box = layer.children.find(el => el.tagName === 'DIV')!;
    expect(box.style.cssText).toContain('width:80px');
    trail.destroy();
  });
});
