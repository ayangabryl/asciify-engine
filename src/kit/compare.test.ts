import { describe, expect, it, vi } from 'vitest';

const { mount, support } = vi.hoisted(() => ({ mount: vi.fn(), support: { on: true } }));
vi.mock('../field', () => ({ isGlyphFieldSupported: () => support.on, mountGlyphField: mount }));

import { asElement, useFakeDom, FakeImage } from './fake-dom-2b';
import { compare } from './compare';

const dom = useFakeDom(mount, support);

describe('compare', () => {
  it('builds the photo, divider and slider, and draws the photo in characters', async () => {
    const frame = dom.element();
    const c = compare(asElement(frame), { image: '/bird.webp', position: 58 });
    expect(mount.mock.calls[0][1]).toMatchObject({ color: 'source', hover: 'trail' });
    const photo = frame.querySelector('img') as FakeImage;
    const slider = frame.querySelector('[role="slider"]')!;
    expect(photo.src).toBe('/bird.webp');
    expect(photo.className).toBe('ascii-compare-photo');
    expect(frame.style.getPropertyValue('--ascii-pos')).toBe('58%');
    expect(slider.attributes.get('aria-valuenow')).toBe('58');
    expect(slider.attributes.get('aria-valuetext')).toBe('58% photo, 42% ASCII');
    expect(frame.style.getPropertyValue('overflow')).toBe('hidden');
    photo.load(600, 400);
    await dom.flush();
    dom.advance();
    const call = dom.pen().drawImage.mock.calls[0];
    expect(call[0] === photo).toBe(true);
    expect(call.slice(1, 5).map(n => Math.round(n))).toEqual([0, -93, 400, 267]);
    expect(dom.frames.size).toBe(0);
    c.destroy();
    expect(frame.children).toHaveLength(0);
    expect(frame.style.getPropertyValue('--ascii-pos')).toBe('');
    expect(frame.listenerCount()).toBe(0);
  });

  it('maps a srcset photo larger than the field edge to edge', async () => {
    // A 600×400 file picked from a srcset for a 200 px box: the browser reports a density-corrected naturalWidth of 300,
    // while a drawImage source rectangle is read in the file's own pixels.
    const file = { width: 600, height: 400 };
    const frame = dom.element();
    const c = compare(asElement(frame), { image: '/bird.webp' });
    (frame.querySelector('img') as FakeImage).load(300, 200);
    await dom.flush();
    dom.advance();
    const [, ...args] = dom.pen().drawImage.mock.calls[0] as [unknown, ...number[]];
    const [sx, sy, sw, sh, dx, dy, dw, dh] = args.length === 8 ? args : [0, 0, file.width, file.height, ...args];
    // The art canvas is 400×80 (two source pixels per CSS pixel); the file columns and rows that land on it:
    const fileAt = (d: number, s0: number, sLen: number, d0: number, dLen: number) => s0 + ((d - d0) / dLen) * sLen;
    expect(fileAt(0, sx, sw, dx, dw)).toBeCloseTo(0);
    expect(fileAt(400, sx, sw, dx, dw)).toBeCloseTo(file.width);
    const top = fileAt(0, sy, sh, dy, dh), bottom = fileAt(80, sy, sh, dy, dh);
    expect((top + bottom) / 2).toBeCloseTo(file.height / 2);
    expect((bottom - top) / (fileAt(400, sx, sw, dx, dw) - fileAt(0, sx, sw, dx, dw))).toBeCloseTo(80 / 400);
    c.destroy();
  });

  it('follows a drag and glides on a jump', () => {
    const frame = dom.element(), onChange = vi.fn();
    const c = compare(asElement(frame), { image: '/bird.webp', onChange });
    frame.dispatch('pointerdown', { clientX: 150 });
    expect(c.position).toBe(50);
    dom.settle();
    expect(c.position).toBe(75);
    frame.dispatch('pointermove', { clientX: 20 });
    expect(c.position).toBe(10);
    frame.dispatch('pointerup');
    frame.dispatch('pointermove', { clientX: 100 });
    expect(c.position).toBe(10);
    expect(onChange).toHaveBeenLastCalledWith(10);
  });

  it('steps with the keyboard', () => {
    const frame = dom.element();
    const c = compare(asElement(frame), { image: '/bird.webp', reducedMotion: true });
    const slider = frame.querySelector('[role="slider"]')!;
    const key = (k: string) => slider.dispatch('keydown', { key: k });
    key('ArrowRight'); expect(c.position).toBe(55);
    key('PageDown'); expect(c.position).toBe(35);
    key('End'); expect(c.position).toBe(100);
    key('ArrowUp'); expect(c.position).toBe(100);
    key('Home'); expect(c.position).toBe(0);
    c.set(42);
    expect(slider.attributes.get('aria-valuenow')).toBe('42');
  });

  it('uses an image already inside the element, and puts it back', () => {
    const frame = dom.element(), img = document.createElement('img') as unknown as FakeImage;
    img.className = 'hero';
    frame.appendChild(img);
    const c = compare(asElement(frame), { image: img as unknown as HTMLImageElement });
    expect(frame.querySelectorAll('img')).toHaveLength(1);
    expect(img.className).toBe('hero ascii-compare-photo');
    c.destroy();
    expect(img.parentElement).toBe(frame);
    expect(img.className).toBe('hero');
    expect(img.attributes.has('aria-hidden')).toBe(false);
  });

  it('shows the photo it was given, and nothing more, without WebGL2', () => {
    support.on = false;
    const frame = dom.element();
    const c = compare(asElement(frame), { image: '/bird.webp' });
    expect(c.supported).toBe(false);
    expect(frame.children).toHaveLength(1);
    expect((frame.children[0] as FakeImage).src).toBe('/bird.webp');
    expect(frame.querySelector('[role="slider"]')).toBeNull();
    c.set(20);
    expect(c.position).toBe(20);
    c.destroy();
    expect(frame.children).toHaveLength(0);
    const own = dom.element(), img = new FakeImage();
    own.appendChild(img);
    compare(asElement(own), { image: asElement(img) as unknown as HTMLImageElement }).destroy();
    expect(own.children).toEqual([img]);
  });
});
