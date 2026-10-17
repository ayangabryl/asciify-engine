import { describe, expect, it, vi } from 'vitest';

const { mount, support } = vi.hoisted(() => ({ mount: vi.fn(), support: { on: true } }));
vi.mock('../field', () => ({ isGlyphFieldSupported: () => support.on, mountGlyphField: mount }));

import { asElement, useFakeDom, type FakeImage } from './fake-dom-2b';
import { accordion } from './accordion';

const dom = useFakeDom(mount, support);
const IMAGES = [{ src: '/a.webp', title: 'Stairwell', meta: 'Silver print' }, '/b.webp', { src: '/c.webp', alt: 'Shell', focus: { x: 0.5, y: 0.2 } }];

describe('accordion', () => {
  it('builds a panel per image, opens one, and draws the closed ones in characters', async () => {
    const strip = dom.element();
    const a = accordion(asElement(strip), { images: IMAGES, open: 1 });
    const panels = strip.querySelectorAll('button');
    expect(panels).toHaveLength(3);
    expect(strip.attributes.get('role')).toBe('group');
    expect(strip.dataset.asciiField).toBe('');
    expect(panels.map(p => p.attributes.get('aria-expanded'))).toEqual(['false', 'true', 'false']);
    expect(panels.map(p => p.tabIndex)).toEqual([-1, 0, -1]);
    expect(panels[0].attributes.get('aria-label')).toBe('Stairwell, Silver print');
    expect(panels[2].attributes.get('aria-label')).toBe('Shell');
    expect(panels[0].querySelector('.ascii-acc-title')?.textContent).toBe('Stairwell');
    panels.forEach(p => (p.querySelector('img') as FakeImage).load(400, 300));
    await dom.flush();
    dom.advance();
    expect(dom.pen().drawImage).toHaveBeenCalledTimes(2);
    dom.settle();
    expect(dom.frames.size).toBe(0);
    a.destroy();
    expect(strip.children).toHaveLength(0);
    expect(strip.attributes.has('role')).toBe(false);
    expect(strip.dataset.asciiAccordion).toBeUndefined();
  });

  it('opens on pointer and moves with the arrow keys', () => {
    const strip = dom.element(), onChange = vi.fn();
    const a = accordion(asElement(strip), { images: IMAGES, onChange });
    const panels = strip.querySelectorAll('button');
    panels[2].dispatch('pointermove');
    expect(a.open).toBe(2);
    expect(onChange).toHaveBeenCalledWith(2);
    panels[2].dispatch('keydown', { key: 'ArrowRight' });
    expect(a.open).toBe(0);
    expect(panels[0].focus).toHaveBeenCalled();
    panels[0].dispatch('keydown', { key: 'End' });
    expect(a.open).toBe(2);
    a.select(1);
    expect(panels.map(p => p.attributes.get('aria-expanded'))).toEqual(['false', 'true', 'false']);
    expect(dom.frames.size).toBe(1);
  });

  it('still works as a strip of photos without WebGL2', () => {
    support.on = false;
    const strip = dom.element();
    const a = accordion(asElement(strip), { images: IMAGES });
    expect(a.supported).toBe(false);
    expect(strip.querySelectorAll('button')).toHaveLength(3);
    expect(strip.dataset.asciiField).toBeUndefined();
    a.select(2);
    expect(a.open).toBe(2);
  });
});
