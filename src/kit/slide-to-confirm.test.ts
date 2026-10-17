import { describe, expect, it, vi } from 'vitest';

const { mount, support } = vi.hoisted(() => ({ mount: vi.fn(), support: { on: true } }));
vi.mock('../field', () => ({ isGlyphFieldSupported: () => support.on, mountGlyphField: mount }));

import { slideToConfirm, stepSpring, velocity } from './slide-to-confirm';
import { FakeElement, useFakeDom } from './fake-dom-2a';

const { env, advance, run, element, as, canvases, key } = useFakeDom(mount, support);

function slider() {
  const track = element();
  track.rect = { left: 0, top: 0, width: 300, height: 56 };
  const label = new FakeElement('SPAN');
  label.dataset.label = ''; label.textContent = 'Slide to pay $48';
  const thumb = new FakeElement('DIV');
  thumb.setAttribute('role', 'slider');
  thumb.rect = { left: 4, top: 4, width: 48, height: 48 };
  track.appendChild(label); track.appendChild(thumb);
  return { track, thumb, label };
}

describe('slideToConfirm', () => {
  it('sets up an accessible slider under a field and cleans up', () => {
    const { track, thumb } = slider();
    const s = slideToConfirm(as(track));
    expect(canvases(track)[0].style.zIndex).toBe('-1');
    expect(thumb.getAttribute('aria-label')).toBe('Slide to pay $48');
    expect(thumb.getAttribute('aria-valuenow')).toBe('0');
    expect(thumb.tabIndex).toBe(0);
    expect(track.dataset.state).toBe('idle');
    s.destroy();
    expect(canvases(track)).toHaveLength(0);
    expect(track.listeners.get('pointerdown')?.size).toBe(0);
    expect(track.dataset.state).toBeUndefined();
  });
  it('confirms when dragged to the end, fading the label, and condenses into a check', () => {
    const { track, thumb, label } = slider();
    const onConfirm = vi.fn();
    const s = slideToConfirm(as(track), { onConfirm });
    thumb.dispatch('pointerdown', { clientX: 20 });
    expect(track.dataset.state).toBe('dragging');
    thumb.dispatch('pointermove', { clientX: 120 });
    advance();
    expect(thumb.style.getPropertyValue('translate')).toBe('100px 0');
    expect(Number(label.style.getPropertyValue('opacity'))).toBeLessThan(1);
    expect(thumb.getAttribute('aria-valuenow')).toBe(String(Math.round((100 / 244) * 100)));
    thumb.dispatch('pointermove', { clientX: 300 });
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(s.confirmed).toBe(true);
    expect(track.dataset.state).toBe('confirmed');
    run(1100);
    expect(track.dataset.confirmed).toBe('');
    expect(env.field.update).toHaveBeenLastCalledWith({ ink: '#1c8a4f' });
    expect(env.frames.size).toBe(0);
    s.reset();
    run(400);
    expect(s.confirmed).toBe(false);
    expect(track.dataset.confirmed).toBeUndefined();
    s.destroy();
  });
  it('springs back when released short, and confirms from the keyboard', () => {
    const { track, thumb } = slider();
    const onConfirm = vi.fn();
    const s = slideToConfirm(as(track), { onConfirm });
    thumb.dispatch('pointerdown', { clientX: 20 });
    thumb.dispatch('pointermove', { clientX: 80 });
    run(200);
    thumb.dispatch('pointerup');
    run(1500);
    expect(thumb.style.getPropertyValue('translate')).toBe('0px 0');
    expect(onConfirm).not.toHaveBeenCalled();
    key(thumb, 'ArrowRight');
    run(600);
    expect(parseFloat(String(thumb.style.getPropertyValue('translate')))).toBeCloseTo(61, 0);
    key(thumb, 'Enter');
    expect(onConfirm).toHaveBeenCalledOnce();
    s.destroy();
  });
  it('resets itself after resetAfter ms', () => {
    const { track } = slider();
    const s = slideToConfirm(as(track), { resetAfter: 1000 });
    s.confirm();
    run(1400);
    expect(s.confirmed).toBe(false);
    s.destroy();
  });
  it('still slides and confirms without WebGL2', () => {
    support.on = false;
    const { track, thumb } = slider();
    const onConfirm = vi.fn();
    const s = slideToConfirm(as(track), { onConfirm });
    expect(s.supported).toBe(false);
    key(thumb, 'End');
    expect(onConfirm).toHaveBeenCalledOnce();
    s.destroy();
  });
  it('steps springs to rest and reads fling velocity', () => {
    const sp = { x: 0, v: 0, to: 10, k: 520, z: 0.8 };
    for (let i = 0; i < 120 && stepSpring(sp, 1 / 60); i++);
    expect(sp.x).toBe(10);
    expect(velocity([[0, 0], [40, 40]], 50)).toBe(1000);
    expect(velocity([[0, 0]], 10)).toBe(0);
  });
});
