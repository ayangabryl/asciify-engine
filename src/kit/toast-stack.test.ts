import { describe, expect, it, vi } from 'vitest';

const { mount, support } = vi.hoisted(() => ({ mount: vi.fn(), support: { on: true } }));
vi.mock('../field', () => ({ isGlyphFieldSupported: () => support.on, mountGlyphField: mount }));

import { asElement, useFakeDom, type FakeElement } from './fake-dom-2b';
import { toastStack, TOAST_DEFAULTS } from './toast-stack';

const dom = useFakeDom(mount, support);
const toasts = (root: FakeElement) => root.querySelectorAll('[data-toast]');

describe('toastStack', () => {
  it('gathers a toast in characters, then hands over to the crisp markup', () => {
    const host = dom.element();
    const stack = toastStack(asElement(host));
    expect(stack.supported).toBe(true);
    expect(dom.head.all().some(el => el.attributes.get('id') === 'ascii-kit-toast')).toBe(true);
    const id = stack.push({ title: 'Release 4.12 is live', body: 'Production · just now', icon: '!' });
    const [node] = toasts(host);
    expect(node.dataset.toast).toBe(String(id));
    expect(node.dataset.forming).toBe('');
    expect(node.dataset.front).toBe('');
    expect(node.querySelector('[data-paint="strong"]')?.textContent).toBe('Release 4.12 is live');
    expect(host.all().find(el => el.attributes.get('role') === 'status')?.textContent).toBe('Release 4.12 is live. Production · just now');
    dom.advance(16); dom.advance(250);
    expect(node.dataset.forming).toBeUndefined();
    expect(dom.pen().drawImage).toHaveBeenCalled();
    dom.settle();
    expect(dom.frames.size).toBe(0);
    stack.destroy();
    expect(toasts(host)).toHaveLength(0);
    expect(dom.canvases(host)).toHaveLength(0);
  });

  it('lays its field above every toast, and draws no glint when asked not to', () => {
    const host = dom.element();
    const stack = toastStack(asElement(host), { glint: false });
    expect(dom.canvases(host)[0].style.zIndex).toBe('11');
    stack.push({ title: 'Invite sent' });
    dom.settle();
    expect(dom.pen().stroke).not.toHaveBeenCalled();
    expect(dom.frames.size).toBe(0);
    stack.destroy();
  });

  it('stacks the newest in front and keeps at most `max`', () => {
    const host = dom.element();
    const stack = toastStack(asElement(host), { max: 2, reducedMotion: true });
    const a = stack.push({ title: 'One' }), b = stack.push({ title: 'Two' });
    const [first, second] = toasts(host);
    expect(first.style.getPropertyValue('--d')).toBe('1');
    expect(first.dataset.back).toBe('');
    expect(second.dataset.front).toBe('');
    const c = stack.push({ title: 'Three' });
    expect(stack.toasts).toEqual([b, c]);
    expect(stack.toasts).not.toContain(a);
  });

  it('dissolves on dismiss and closes up after a beat', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const host = dom.element();
    const stack = toastStack(asElement(host), { duration: 0 });
    const id = stack.push({ title: 'Saved', action: { label: 'Undo', onClick: vi.fn() } });
    dom.settle();
    stack.dismiss(id);
    const [node] = toasts(host);
    expect(node.dataset.gone).toBe('');
    expect(stack.toasts).toEqual([]);
    expect(dom.frames.size).toBe(1);
    vi.advanceTimersByTime(160);
    expect(toasts(host)).toHaveLength(0);
  });

  it('leaves on its own after `duration`, held while pointed at', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const host = dom.element();
    const stack = toastStack(asElement(host), { duration: 1000, reducedMotion: true });
    stack.push({ title: 'Invite sent' });
    const list = host.querySelector('ol')!;
    list.dispatch('pointerenter');
    expect(list.dataset.open).toBe('');
    vi.advanceTimersByTime(5000);
    expect(stack.toasts).toHaveLength(1);
    list.dispatch('pointerleave');
    vi.advanceTimersByTime(1000);
    expect(stack.toasts).toHaveLength(0);
  });

  it('wires the action and close buttons', () => {
    const host = dom.element(), onClick = vi.fn();
    const stack = toastStack(asElement(host), { reducedMotion: true });
    stack.push({ title: 'Archived', action: { label: 'Undo', onClick } });
    const [node] = toasts(host);
    node.querySelector('.ascii-toast-action')!.dispatch('click');
    expect(onClick).toHaveBeenCalledOnce();
    expect(stack.toasts).toHaveLength(0);
    stack.push({ title: 'Again' });
    const close = toasts(host)[0].querySelector('.ascii-toast-close')!;
    expect(close.attributes.get('aria-label')).toBe('Dismiss Again');
    close.dispatch('click');
    expect(stack.toasts).toHaveLength(0);
  });

  it('takes custom markup', () => {
    const host = dom.element();
    const stack = toastStack(asElement(host), { reducedMotion: true, render: toast => { const li = document.createElement('li'); li.textContent = toast.title.toUpperCase(); return li; } });
    stack.push({ title: 'hello' });
    expect(toasts(host)[0].textContent).toBe('HELLO');
  });

  it('still shows toasts without WebGL2', () => {
    support.on = false;
    const host = dom.element();
    const stack = toastStack(asElement(host));
    expect(stack.supported).toBe(false);
    stack.push({ title: 'Plain' });
    expect(toasts(host)[0].dataset.forming).toBeUndefined();
    expect(dom.frames.size).toBe(0);
    expect(mount).not.toHaveBeenCalled();
    stack.destroy();
    expect(host.children).toHaveLength(0);
  });

  it('exports its defaults', () => {
    expect(TOAST_DEFAULTS).toMatchObject({ max: 3, duration: 6000 });
  });
});

describe('hidesInk', () => {
  it('flags a fill too close to the ink for gathering characters to read, and passes clear or contrasting fills', async () => {
    const { hidesInk } = await import('./toast-stack');
    expect(hidesInk('rgb(29, 29, 27)', '#1d1d1b')).toBe(true);
    expect(hidesInk('rgb(40 40 40)', '#1d1d1b')).toBe(true);
    expect(hidesInk('rgb(255, 255, 255)', '#1d1d1b')).toBe(false);
    expect(hidesInk('rgba(29, 29, 27, 0)', '#1d1d1b')).toBe(false);
    expect(hidesInk('rgb(250 249 245 / 90%)', '#d8d6cf')).toBe(true);
    expect(hidesInk('transparent', '#1d1d1b')).toBe(false);
  });
});
