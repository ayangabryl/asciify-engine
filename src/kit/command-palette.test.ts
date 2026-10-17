import { describe, expect, it, vi } from 'vitest';

const { mount, support } = vi.hoisted(() => ({ mount: vi.fn(), support: { on: true } }));
vi.mock('../field', () => ({ isGlyphFieldSupported: () => support.on, mountGlyphField: mount }));

import { commandPalette } from './command-palette';
import { blocksOf } from './paint-dom';
import { FakeElement, useFakeDom } from './fake-dom-2a';

const { env, advance, run, element, as, canvases, key } = useFakeDom(mount, support);

function palette(rows = 3) {
  const trigger = element('BUTTON'), panel = element();
  panel.rect = { left: 0, top: 60, width: 320, height: 200 };
  const input = new FakeElement('INPUT');
  panel.appendChild(input);
  const list = new FakeElement('UL');
  panel.appendChild(list);
  const items = Array.from({ length: rows }, (_, i) => {
    const row = new FakeElement('LI');
    row.setAttribute('role', 'option'); row.setAttribute('id', `cmd-${i}`);
    row.rect = { left: 6, top: 110 + i * 40, width: 300, height: 40 };
    row.textContent = `Command ${i}`;
    list.appendChild(row);
    return row;
  });
  return { trigger, panel, input, items };
}

describe('commandPalette', () => {
  it('sits over the content and marks the selected row from the gutter', () => {
    const { panel, input, items } = palette();
    const p = commandPalette(as(panel));
    const [canvas] = canvases(panel);
    expect(canvas.style.zIndex).toBe('');
    expect(canvas.style.pointerEvents).toBe('none');
    expect(p.isOpen).toBe(true);
    expect(items.map(r => r.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(input.getAttribute('aria-activedescendant')).toBe('cmd-0');
    key(input, 'ArrowDown');
    expect(p.selected).toBe(1);
    key(input, 'End');
    expect(p.selected).toBe(2);
    key(input, 'ArrowDown');
    expect(p.selected).toBe(0);
    p.select(-1);
    expect(p.selected).toBe(2);
    expect(input.getAttribute('aria-activedescendant')).toBe('cmd-2');
    items[1].dispatch('pointermove');
    expect(p.selected).toBe(1);
    advance();
    expect(env.field.setSource).toHaveBeenCalled();
    p.destroy();
    expect(canvases(panel)).toHaveLength(0);
    expect(env.docListeners.get('keydown')?.size ?? 0).toBe(0);
  });
  it('condenses out of the trigger and dissolves back into it', () => {
    const { trigger, panel, input } = palette();
    const changes: boolean[] = [];
    const p = commandPalette(as(panel), { trigger: as(trigger), open: false, onOpenChange: o => changes.push(o) });
    expect(panel.hidden).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    trigger.dispatch('click');
    expect(p.isOpen).toBe(true);
    expect(panel.hidden).toBe(false);
    expect(panel.dataset.state).toBe('opening');
    expect(panel.animate).toHaveBeenCalled();
    expect(input.focus).toHaveBeenCalled();
    expect(input.style.getPropertyValue('opacity')).toBe('0');
    advance();
    const art = (env.field.setSource.mock.calls[0] as unknown[])[0] as { getContext(kind: string): { roundRect: unknown } };
    const pen = art.getContext('2d');
    const marker = vi.fn();
    pen.roundRect = marker;
    run(300);
    // Once the flight lands, the same paint draws the selected row's marker.
    expect(marker).toHaveBeenCalled();
    expect(panel.dataset.state).toBeUndefined();
    expect(input.style.getPropertyValue('opacity')).toBe('');
    key(input, 'Escape');
    expect(panel.dataset.state).toBe('closing');
    run(240);
    expect(p.isOpen).toBe(false);
    expect(panel.hidden).toBe(true);
    expect(trigger.focus).toHaveBeenCalled();
    expect(changes).toEqual([true, false]);
    p.destroy();
  });
  it('runs a row on Enter or click, pulses it and closes', () => {
    const { panel, input, items } = palette();
    const onRun = vi.fn();
    const p = commandPalette(as(panel), { onRun });
    key(input, 'ArrowDown');
    key(input, 'Enter');
    expect(onRun.mock.calls[0][0]).toBe(1);
    expect(onRun.mock.calls[0][1]).toBe(items[1]);
    expect(env.field.pulse.mock.calls[0][0]).toMatchObject({ strength: 0.6 });
    expect((env.field.pulse.mock.calls[0][0] as { element: unknown }).element).toBe(items[1]);
    run(500);
    expect(p.isOpen).toBe(false);
    p.open();
    items[2].dispatch('click');
    expect(onRun).toHaveBeenCalledTimes(1);
    run(200);
    items[2].dispatch('click');
    expect(onRun.mock.calls[1][0]).toBe(2);
    p.destroy();
  });
  it('toggles on Cmd/Ctrl+K and closes on an outside press', () => {
    const { panel } = palette();
    const p = commandPalette(as(panel), { open: false, reducedMotion: true });
    for (const fn of env.docListeners.get('keydown')!) fn({ key: 'k', metaKey: true, preventDefault() {} });
    expect(p.isOpen).toBe(true);
    const outside = element();
    for (const fn of env.docListeners.get('pointerdown')!) fn({ target: outside });
    expect(p.isOpen).toBe(false);
    p.destroy();
  });
  it('still opens, closes and selects without WebGL2', () => {
    support.on = false;
    const { panel, input } = palette();
    const p = commandPalette(as(panel), { open: false });
    expect(p.supported).toBe(false);
    p.open();
    expect(panel.hidden).toBe(false);
    expect(input.style.getPropertyValue('opacity')).toBe('');
    key(input, 'ArrowDown');
    expect(p.selected).toBe(1);
    p.close();
    run(240);
    expect(panel.hidden).toBe(true);
    p.destroy();
  });
  it('finds the lit blocks of a snapshot', () => {
    const snap = new FakeElement('CANVAS');
    snap.width = 16; snap.height = 24;
    expect(blocksOf(snap as unknown as HTMLCanvasElement, 2)).toHaveLength(4);
  });
});
