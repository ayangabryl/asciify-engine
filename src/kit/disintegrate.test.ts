import { describe, expect, it, vi } from 'vitest';

const { mount, support } = vi.hoisted(() => ({ mount: vi.fn(), support: { on: true } }));
vi.mock('../field', () => ({ isGlyphFieldSupported: () => support.on, mountGlyphField: mount }));

import { asElement, useFakeDom } from './fake-dom-2b';
import { disintegrate, DISINTEGRATE_DEFAULTS } from './disintegrate';

const dom = useFakeDom(mount, support);
function row() {
  const list = dom.element('UL'), li = dom.element('LI'), name = dom.element('SPAN'), icon = dom.element('svg');
  name.textContent = 'Q3 roadmap.pdf';
  li.append(icon, name);
  list.appendChild(li);
  return { list, li, name };
}

describe('disintegrate', () => {
  it('drifts the row away in characters over its parent, closes it, and resolves', async () => {
    const { list, li, name } = row();
    const done = disintegrate(asElement(li));
    expect(disintegrate(asElement(li))).toBe(done);
    expect(dom.canvases(list)).toHaveLength(1);
    expect(name.style.getPropertyValue('opacity')).toBe('0');
    expect(li.attributes.get('aria-hidden')).toBe('true');
    expect(dom.field.pulse).not.toHaveBeenCalled();
    dom.advance();
    expect(dom.pen().drawImage).toHaveBeenCalled();
    dom.advance(400);
    expect(parseFloat(li.style.getPropertyValue('height'))).toBeLessThan(40);
    dom.settle();
    await done;
    expect(li.style.getPropertyValue('height')).toBe('0.00px');
    expect(dom.canvases(list)).toHaveLength(0);
    expect(dom.field.destroy).toHaveBeenCalledOnce();
    expect(li.parentElement).toBe(list);
  });

  it('removes the row when asked, and closes at once under reduced motion', async () => {
    const { list, li } = row();
    await disintegrate(asElement(li), { reducedMotion: true, remove: true });
    expect(li.parentElement).toBeNull();
    expect(dom.canvases(list)).toHaveLength(0);
  });

  it('keeps the space when collapse is off, and works without WebGL2', async () => {
    support.on = false;
    const { li, name } = row();
    await disintegrate(asElement(li), { collapse: false });
    expect(name.style.getPropertyValue('opacity')).toBe('0');
    expect(li.style.getPropertyValue('height')).toBe('');
    expect(mount).not.toHaveBeenCalled();
    expect(DISINTEGRATE_DEFAULTS.duration).toBe(620);
  });
});
