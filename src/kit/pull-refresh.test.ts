import { describe, expect, it, vi } from 'vitest';

const { mount, support } = vi.hoisted(() => ({ mount: vi.fn(), support: { on: true } }));
vi.mock('../field', () => ({ isGlyphFieldSupported: () => support.on, mountGlyphField: mount }));

import { asElement, useFakeDom } from './fake-dom-2b';
import { pullRefresh, stepSpring } from './pull-refresh';

const dom = useFakeDom(mount, support);
function screen() { const el = dom.element(), feed = dom.element('UL'); el.rect = { left: 0, top: 0, width: 320, height: 480 }; el.appendChild(feed); return { el, feed }; }
const translate = (el: ReturnType<typeof dom.element>) => parseFloat(el.style.getPropertyValue('translate').split(' ')[1]);

describe('pullRefresh', () => {
  it('follows the pull, refreshes past the threshold and springs back', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { el, feed } = screen();
    let finish = () => {};
    const onRefresh = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const p = pullRefresh(asElement(el), { onRefresh });
    el.dispatch('pointerdown', { clientY: 100 });
    el.dispatch('pointermove', { clientY: 103 });
    expect(p.state).toBe('idle');
    el.dispatch('pointermove', { clientY: 300 });
    expect(p.state).toBe('pulling');
    expect(el.setPointerCapture).toHaveBeenCalled();
    dom.advance();
    expect(translate(feed)).toBeGreaterThan(88);
    expect(dom.pen().fillRect).toHaveBeenCalled();
    el.dispatch('pointerup');
    expect(p.state).toBe('refreshing');
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(el.getAttribute('aria-busy')).toBe('true');
    dom.settle(60);
    expect(translate(feed)).toBeCloseTo(88, 0);
    finish();
    await vi.advanceTimersByTimeAsync(600);
    expect(p.state).toBe('done');
    expect(el.all().find(n => n.attributes.get('aria-live'))?.textContent).toBe('Updated.');
    await vi.advanceTimersByTimeAsync(700);
    expect(p.state).toBe('idle');
    expect(el.getAttribute('aria-busy')).toBeNull();
    dom.settle();
    expect(translate(feed)).toBe(0);
    expect(dom.frames.size).toBe(0);
    p.destroy();
    expect(feed.style.getPropertyValue('translate')).toBe('');
    expect(el.listenerCount()).toBe(0);
  });

  it('resolves new rows in from characters once the content springs back', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { el, feed } = screen();
    const old = dom.element('LI');
    feed.appendChild(old);
    const added: ReturnType<typeof dom.element>[] = [];
    const p = pullRefresh(asElement(el), { reveal: '[data-new]', onRefresh: () => {
      const row = dom.element('LI'); row.dataset.new = ''; row.textContent = 'Kingfisher, weir'; feed.prepend(row); added.push(row);
    } });
    void p.refresh();
    await vi.advanceTimersByTimeAsync(600);
    dom.advance();
    await dom.flush();
    expect(p.state).toBe('done');
    // Held back, hidden, behind the check.
    expect(added[0].style.opacity).toBe('0');
    expect(old.style.opacity).toBeUndefined();
    const draws = dom.pen().drawImage.mock.calls.length;
    await vi.advanceTimersByTimeAsync(700);
    expect(p.state).toBe('idle');
    dom.advance(100);
    expect(dom.pen().drawImage.mock.calls.length).toBeGreaterThan(draws);
    expect(added[0].style.opacity).toBe('0');
    dom.advance(200);
    expect(added[0].style.opacity).toBeFalsy();
    dom.settle();
    expect(added[0].style.transition).toBeFalsy();
    // A row is revealed once: the same row again does nothing.
    p.revealRows([asElement(added[0])]);
    expect(added[0].style.opacity).toBeFalsy();
    const later = dom.element('LI');
    feed.appendChild(later);
    p.revealRows([asElement(later)]);
    expect(later.style.opacity).toBe('0');
    p.destroy();
    expect(later.style.opacity).toBeFalsy();
  });

  it('shows new rows at once under reduced motion', async () => {
    dom.reduced = true;
    const { el, feed } = screen();
    const p = pullRefresh(asElement(el), { reveal: '[data-new]', onRefresh: () => {} });
    const row = dom.element('LI'); row.dataset.new = ''; feed.appendChild(row);
    p.revealRows([asElement(row)]);
    expect(row.style.opacity).toBeUndefined();
    p.destroy();
  });

  it('springs back without refreshing under the threshold, and only at the top', () => {
    const { el, feed } = screen(), onRefresh = vi.fn();
    const p = pullRefresh(asElement(el), { onRefresh });
    el.dispatch('pointerdown', { clientY: 100 });
    el.dispatch('pointermove', { clientY: 150 });
    el.dispatch('pointerup');
    expect(onRefresh).not.toHaveBeenCalled();
    dom.settle();
    expect(translate(feed)).toBe(0);
    el.scrollTop = 40;
    el.dispatch('pointerdown', { clientY: 100 });
    el.dispatch('pointermove', { clientY: 300 });
    expect(p.state).toBe('idle');
  });

  it('refreshes from a button, reports failure, and runs without WebGL2', async () => {
    support.on = false;
    const { el } = screen();
    const p = pullRefresh(asElement(el), { onRefresh: () => Promise.reject(new Error('offline')) });
    expect(p.supported).toBe(false);
    await p.refresh();
    expect(el.all().find(n => n.attributes.get('aria-live'))?.textContent).toBe('Couldn’t refresh.');
    expect(p.state).toBe('idle');
  });

  it('settles its spring', () => {
    const s = { x: 0, v: 0, to: 100 };
    let steps = 0;
    while (stepSpring(s, 1 / 60) && steps < 600) steps++;
    expect(s.x).toBe(100);
    expect(steps).toBeLessThan(120);
  });
});
