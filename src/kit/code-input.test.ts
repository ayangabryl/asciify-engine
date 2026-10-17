import { describe, expect, it, vi } from 'vitest';

const { mount, support } = vi.hoisted(() => ({ mount: vi.fn(), support: { on: true } }));
vi.mock('../field', () => ({ isGlyphFieldSupported: () => support.on, mountGlyphField: mount }));

import { cleanCode, codeInput } from './code-input';
import { FakeElement, useFakeDom } from './fake-dom-2a';

const { env, run, element, as, canvases } = useFakeDom(mount, support);

const type = (input: FakeElement, text: string) => { input.value = text; input.dispatch('input'); };
const parts = (el: FakeElement) => ({ input: el.querySelector('input')!, cells: el.querySelectorAll('[data-cell]') });

describe('codeInput', () => {
  it('builds cells and an accessible one-time-code input, and removes them again', () => {
    const el = element();
    const c = codeInput(as(el), { length: 4 });
    const { input, cells } = parts(el);
    expect(cells).toHaveLength(4);
    expect(input.getAttribute('autocomplete')).toBe('one-time-code');
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.getAttribute('aria-label')).toBe('Verification code, 4 digits');
    expect(canvases(el)[0].style.left).toBe('-16px');
    expect(el.dataset.state).toBe('idle');
    c.destroy();
    expect(el.querySelectorAll('[data-cell]')).toHaveLength(0);
    expect(el.querySelector('input')).toBeNull();
    expect(canvases(el)).toHaveLength(0);
  });
  it('resolves each digit out of characters, then reports the code', () => {
    const el = element();
    const onComplete = vi.fn();
    const c = codeInput(as(el), { length: 4, onComplete });
    const { input, cells } = parts(el);
    input.dispatch('focus');
    expect(cells[0].hasAttribute('data-active')).toBe(true);
    type(input, '12a');
    expect(c.value).toBe('12');
    expect(input.value).toBe('12');
    run(32);
    expect(cells[0].querySelector('[data-digit]')!.style.getPropertyValue('opacity')).toBe('0');
    run(300);
    expect(cells[0].querySelector('[data-digit]')!.style.getPropertyValue('opacity')).toBe('1');
    expect(cells[0].textContent).toBe('1');
    expect(cells[2].hasAttribute('data-active')).toBe(true);
    input.dispatch('paste');
    type(input, '1234');
    expect(onComplete).not.toHaveBeenCalled();
    run(600);
    expect(onComplete).toHaveBeenCalledWith('1234');
    c.destroy();
  });
  it('fills a whole code, resolving the characters one after another', () => {
    const el = element();
    const onComplete = vi.fn();
    const c = codeInput(as(el), { length: 4, onComplete });
    const { cells } = parts(el);
    c.fill('12-34');
    expect(c.value).toBe('1234');
    run(330);
    expect(cells[0].querySelector('[data-digit]')!.style.getPropertyValue('opacity')).toBe('1');
    expect(cells[3].querySelector('[data-digit]')!.style.getPropertyValue('opacity')).toBe('0');
    run(600);
    expect(onComplete).toHaveBeenCalledWith('1234');
    c.destroy();
  });
  it('breaks up and clears a wrong code, and gathers a right one into a check', () => {
    const el = element();
    const c = codeInput(as(el), { length: 4 });
    const { input, cells } = parts(el);
    type(input, '1111');
    c.verify(false);
    expect(c.state).toBe('error');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(el.animate).toHaveBeenCalled();
    run(600);
    expect(c.value).toBe('');
    expect(env.frames.size).toBe(0);
    type(input, '4829');
    expect(c.state).toBe('idle');
    c.verify(true);
    expect(c.state).toBe('success');
    expect(el.dataset.state).toBe('success');
    expect(cells[0].style.getPropertyValue('opacity')).toBe('0');
    run(800);
    expect(env.frames.size).toBe(0);
    c.clear();
    expect(c.state).toBe('idle');
    c.destroy();
  });
  it('works as a plain input without WebGL2', () => {
    support.on = false;
    const el = element();
    const onComplete = vi.fn();
    const c = codeInput(as(el), { length: 3, onComplete });
    const { input, cells } = parts(el);
    type(input, '987');
    expect(cells[2].querySelector('[data-digit]')!.style.getPropertyValue('opacity')).toBe('1');
    run(16);
    expect(onComplete).toHaveBeenCalledWith('987');
    c.verify(false);
    run(16);
    expect(c.value).toBe('');
    c.destroy();
  });
  it('cleans what it accepts', () => {
    expect(cleanCode('48 29-13x', 6)).toBe('482913');
    expect(cleanCode('ab-12c', 4, 'alphanumeric')).toBe('AB12');
  });
});
