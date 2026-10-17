import { describe, expect, it, vi } from 'vitest';

const { mount, support } = vi.hoisted(() => ({ mount: vi.fn(), support: { on: true } }));
vi.mock('../field', () => ({ isGlyphFieldSupported: () => support.on, mountGlyphField: mount }));

import { asElement, useFakeDom, FakeImage } from './fake-dom-2b';
import { dropzone, DROPZONE_DEFAULTS } from './dropzone';

const dom = useFakeDom(mount, support);
/** Every `<img>` the kit creates loads at once, as a 300 × 200 picture. */
function autoload() {
  const create = document.createElement;
  vi.stubGlobal('document', { ...document, createElement: (tag: string) => { const el = create(tag); if (el instanceof FakeImage) queueMicrotask(() => el.load(300, 200)); return el; } });
}
const png = (name = 'cat.png', size = 2048, type = 'image/png') => new File([new Uint8Array(size)], name, { type });

describe('dropzone', () => {
  it('adds default content and a ring that breathes while a file is over it', () => {
    const zone = dom.element();
    const d = dropzone(asElement(zone));
    expect(zone.dataset.state).toBe('empty');
    expect(zone.querySelector('[data-dropzone="pick"]')?.textContent).toBe('Choose file');
    const input = zone.querySelector('input')!;
    expect(input.type).toBe('file');
    zone.dispatch('click', { target: zone.querySelector('[data-dropzone="pick"]') });
    expect(input.click).toHaveBeenCalled();
    dom.advance(); dom.advance();
    expect(dom.pen().putImageData).toHaveBeenCalled();
    expect(dom.frames.size).toBe(0);
    const enter = zone.dispatch('dragenter');
    expect(enter.preventDefault).toHaveBeenCalled();
    expect(zone.dataset.over).toBe('');
    dom.advance(); dom.advance(400);
    expect(dom.frames.size).toBe(1);
    zone.dispatch('dragleave');
    expect(zone.dataset.over).toBeUndefined();
    dom.settle();
    expect(dom.frames.size).toBe(0);
    d.destroy();
    expect(zone.children).toHaveLength(0);
    expect(zone.dataset.state).toBeUndefined();
    expect(zone.listenerCount()).toBe(0);
  });

  it('keeps your own content', () => {
    const zone = dom.element(), own = dom.element('P');
    zone.appendChild(own);
    dropzone(asElement(zone));
    expect(zone.querySelector('.ascii-drop-empty')).toBeNull();
    expect(zone.children[0]).toBe(own);
  });

  it('develops a dropped image, then reports it', async () => {
    autoload();
    const zone = dom.element(), onImage = vi.fn();
    const d = dropzone(asElement(zone), { onImage });
    zone.dispatch('drop', { clientX: 40, clientY: 10, dataTransfer: { files: [png()] } });
    expect(dom.field.pulse).toHaveBeenCalledWith({ x: 40, y: 10, strength: 1 });
    await dom.flush();
    expect(d.state).toBe('developing');
    expect(zone.dataset.state).toBe('developing');
    expect(dom.field.update).toHaveBeenLastCalledWith(expect.objectContaining({ color: 'source' }));
    dom.settle();
    expect(d.state).toBe('done');
    expect(onImage).toHaveBeenCalledWith(expect.objectContaining({ width: 300, height: 200, file: expect.objectContaining({ name: 'cat.png' }) }));
    expect(zone.all().find(el => el.attributes.get('aria-live'))?.textContent).toBe('cat.png ready');
    const blob = await d.download('out.png');
    expect(blob?.type).toBe('image/png');
    expect(dom.field.redraw).toHaveBeenCalled();
    d.clear();
    expect(d.state).toBe('empty');
    expect(dom.field.update).toHaveBeenLastCalledWith(expect.objectContaining({ charset: ' .:+*#' }));
    await expect(d.download()).resolves.toBeNull();
  });

  it('refuses files that are not images or too large', () => {
    const zone = dom.element(), onError = vi.fn();
    dropzone(asElement(zone), { onError, maxBytes: 1000 });
    zone.dispatch('drop', { dataTransfer: { files: [png('notes.txt', 10, 'text/plain')] } });
    zone.dispatch('drop', { dataTransfer: { files: [png('big.png', 4000)] } });
    expect(onError.mock.calls.map(c => c[0])).toEqual(['notes.txt isn’t an image.', 'big.png is over 0 MB.']);
    expect(zone.dataset.state).toBe('empty');
    expect(DROPZONE_DEFAULTS.maxBytes).toBe(10 * 1024 * 1024);
  });

  it('shows the image as a plain photo without WebGL2', async () => {
    support.on = false;
    autoload();
    const zone = dom.element();
    const d = dropzone(asElement(zone));
    await d.setImage('/fruit.webp');
    expect(d.state).toBe('done');
    expect((zone.querySelector('.ascii-drop-img') as FakeImage | null)?.src).toBe('/fruit.webp');
    await expect(d.download()).resolves.toBeNull();
    d.clear();
    expect(zone.querySelector('.ascii-drop-img')).toBeNull();
  });
});
