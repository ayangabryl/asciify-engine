import { describe, expect, it, vi } from 'vitest';

const { mount, support } = vi.hoisted(() => ({ mount: vi.fn(), support: { on: true } }));
vi.mock('../field', () => ({ isGlyphFieldSupported: () => support.on, mountGlyphField: mount }));

import { swipeDeck, toneImage } from './swipe-deck';
import { FakeElement, FakeImage, useFakeDom } from './fake-dom-2a';

const { env, advance, run, element, as, canvases, key } = useFakeDom(mount, support);

function deck(n = 3) {
  const el = element();
  el.rect = { left: 0, top: 0, width: 200, height: 260 };
  const cards = Array.from({ length: n }, (_, i) => {
    const card = new FakeElement('DIV'), img = new FakeImage();
    card.dataset.card = ''; img.alt = `Stay ${i}`; img.naturalWidth = 400; img.naturalHeight = 300;
    card.appendChild(img); el.appendChild(card);
    return card;
  });
  return { el, cards };
}

describe('swipeDeck', () => {
  it('draws the cards in the field and keeps only the top one in the accessibility tree', () => {
    const { el, cards } = deck();
    const d = swipeDeck(as(el));
    expect(canvases(el)[0].style.left).toBe('-56px');
    expect(cards.map(c => c.style.getPropertyValue('opacity'))).toEqual(['0', '0', '0']);
    expect(cards.map(c => c.getAttribute('aria-hidden'))).toEqual([null, 'true', 'true']);
    expect(el.getAttribute('aria-roledescription')).toBe('card');
    expect(el.getAttribute('aria-label')).toContain('Stay 0');
    advance();
    expect(env.field.setSource).toHaveBeenCalled();
    d.destroy();
    expect(cards.map(c => c.style.getPropertyValue('opacity'))).toEqual(['', '', '']);
    expect(canvases(el)).toHaveLength(0);
  });
  it('leans a target of your choosing, and only follows the pointer that took the card', () => {
    const { el } = deck();
    const row = element();
    const d = swipeDeck(as(el), { leanTarget: as(row) });
    el.dispatch('pointerdown', { button: 0, clientX: 100, clientY: 100, pointerId: 9 });
    el.dispatch('pointermove', { clientX: 140, clientY: 100, pointerId: 9 });
    el.dispatch('pointermove', { clientX: 400, clientY: 100, pointerId: 1 });
    run(16);
    expect(parseFloat(String(row.style.getPropertyValue('--ascii-lean')))).toBeCloseTo(0.5, 1);
    expect(el.style.getPropertyValue('--ascii-lean')).toBe('');
    d.destroy();
    expect(row.style.getPropertyValue('--ascii-lean')).toBe('');
  });
  it('flings on the arrow keys, dissolving the top card, and moves on', () => {
    const { el, cards } = deck();
    const onSwipe = vi.fn();
    const d = swipeDeck(as(el), { onSwipe });
    key(el, 'ArrowRight');
    expect(onSwipe.mock.calls[0][0]).toBe(1);
    expect(onSwipe.mock.calls[0][1]).toBe(0);
    expect(onSwipe.mock.calls[0][2]).toBe(cards[0]);
    expect(d.index).toBe(1);
    expect(el.getAttribute('aria-label')).toContain('Stay 1');
    expect(d.next(-1)).toBe(false);
    run(700);
    expect(env.frames.size).toBe(0);
    expect(d.index).toBe(1);
    key(el, 'ArrowLeft');
    run(700);
    key(el, 'ArrowLeft');
    run(700);
    expect(d.index).toBe(0);
    d.destroy();
  });
  it('flings a drag past the threshold and springs a short one back', () => {
    const { el } = deck();
    const d = swipeDeck(as(el), { loop: false });
    el.dispatch('pointerdown', { clientX: 100, clientY: 100 });
    el.dispatch('pointermove', { clientX: 130, clientY: 100 });
    run(200);
    el.dispatch('pointerup');
    run(1200);
    expect(d.index).toBe(0);
    el.dispatch('pointerdown', { clientX: 100, clientY: 100 });
    el.dispatch('pointermove', { clientX: 10, clientY: 100 });
    run(200);
    el.dispatch('pointerup');
    run(700);
    expect(d.index).toBe(1);
    d.next(); run(700);
    expect(d.next()).toBe(true);
    run(700);
    expect(d.next()).toBe(false);
    expect(el.getAttribute('aria-label')).toBe('No more cards');
    d.destroy();
  });
  it('shows one HTML card at a time and drags it without WebGL2', () => {
    support.on = false;
    const { el, cards } = deck();
    const d = swipeDeck(as(el));
    expect(cards.map(c => c.hidden)).toEqual([false, true, true]);
    el.dispatch('pointerdown', { clientX: 100, clientY: 100 });
    el.dispatch('pointermove', { clientX: 140, clientY: 100 });
    advance();
    expect(String(cards[0].style.getPropertyValue('transform'))).toContain('translate(40px');
    d.next();
    expect(cards.map(c => c.hidden)).toEqual([true, false, true]);
    d.destroy();
    expect(cards.every(c => !c.hidden)).toBe(true);
  });
  it('tones an image, or gives up on one it cannot read', () => {
    const img = new FakeImage();
    img.naturalWidth = 10; img.naturalHeight = 10;
    expect(toneImage(img as unknown as HTMLImageElement, true)).not.toBeNull();
    img.complete = false;
    expect(toneImage(img as unknown as HTMLImageElement, true)).toBeNull();
  });
});
