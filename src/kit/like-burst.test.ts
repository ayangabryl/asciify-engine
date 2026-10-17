import { describe, expect, it, vi } from 'vitest';

const { mount, support } = vi.hoisted(() => ({ mount: vi.fn(), support: { on: true } }));
vi.mock('../field', () => ({ isGlyphFieldSupported: () => support.on, mountGlyphField: mount }));

import { likeBurst, springOut } from './like-burst';
import { FakeElement, useFakeDom } from './fake-dom-2a';

const { env, advance, run, element, as, canvases } = useFakeDom(mount, support);

function button() {
  const b = element('BUTTON'), icon = new FakeElement('SVG');
  icon.tagName = 'svg';
  icon.rect = { left: 10, top: 10, width: 20, height: 20 };
  b.appendChild(icon);
  return { b, icon };
}

describe('likeBurst', () => {
  it('reaches 40px past the button in the like red', () => {
    const { b } = button();
    const l = likeBurst(as(b));
    expect(canvases(b)[0].style.left).toBe('-40px');
    expect(mount.mock.calls[0][1]).toMatchObject({ ink: '#e5484d', cellSize: 4 });
    expect(b.getAttribute('aria-pressed')).toBe('false');
    l.destroy();
    expect(canvases(b)).toHaveLength(0);
  });
  it('toggles on click: bursts on, hiding the crisp icon until it lands, and loosens off', () => {
    const { b, icon } = button();
    const onChange = vi.fn();
    const l = likeBurst(as(b), { onChange });
    b.dispatch('click');
    expect(l.pressed).toBe(true);
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(onChange).toHaveBeenCalledWith(true);
    expect(icon.style.getPropertyValue('opacity')).toBe('0');
    run(400);
    expect(icon.style.getPropertyValue('opacity')).toBe('');
    expect(icon.animate).toHaveBeenCalled();
    expect(env.frames.size).toBe(1);
    run(300);
    expect(env.frames.size).toBe(0);
    b.dispatch('click');
    expect(l.pressed).toBe(false);
    advance();
    expect(env.frames.size).toBe(1);
    run(400);
    expect(env.frames.size).toBe(0);
    l.destroy();
    expect(b.listeners.get('click')?.size).toBe(0);
  });
  it('can be driven by hand and skips the burst under reduced motion', () => {
    env.reduced = true;
    const { b, icon } = button();
    const l = likeBurst(as(b), { manage: false, kind: 'save' });
    b.dispatch('click');
    expect(l.pressed).toBe(false);
    l.toggle(true);
    expect(l.pressed).toBe(true);
    expect(icon.style.getPropertyValue('opacity')).toBe('');
    l.burst();
    advance();
    expect(env.frames.size).toBe(0);
    l.destroy();
  });
  it('keeps aria-pressed working without WebGL2', () => {
    support.on = false;
    const { b } = button();
    const l = likeBurst(as(b));
    b.dispatch('click');
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect(l.supported).toBe(false);
    l.destroy();
  });
  it('springs past its target and settles', () => {
    expect(springOut(0)).toBe(0);
    expect(Math.max(...Array.from({ length: 50 }, (_, i) => springOut(i / 50)))).toBeGreaterThan(1.1);
    expect(springOut(1)).toBe(1);
  });
});
