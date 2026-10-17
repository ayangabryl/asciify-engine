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
    expect(call.slice(5)).toEqual([0, 0, 200, 40]);
    expect(dom.frames.size).toBe(0);
    c.destroy();
    expect(frame.children).toHaveLength(0);
    expect(frame.style.getPropertyValue('--ascii-pos')).toBe('');
    expect(frame.listenerCount()).toBe(0);
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
