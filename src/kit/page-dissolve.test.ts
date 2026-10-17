import { describe, expect, it, vi } from 'vitest';

const { mount, support } = vi.hoisted(() => ({ mount: vi.fn(), support: { on: true } }));
vi.mock('../field', () => ({ isGlyphFieldSupported: () => support.on, mountGlyphField: mount }));

import { dissolveFrame, pageDissolve } from './page-dissolve';
import { FakeElement, useFakeDom } from './fake-dom-2a';

const { env, run, flush, element, as, canvases } = useFakeDom(mount, support);

function page() {
  const box = element();
  box.rect = { left: 0, top: 0, width: 200, height: 120 };
  const view = new FakeElement('DIV');
  view.textContent = 'Overview';
  box.appendChild(view);
  return { box, view };
}
async function play(ms: number) { for (let t = 0; t < ms; t += 16) { run(16); await flush(); } }

describe('pageDissolve', () => {
  it('crossfades into characters, swaps underneath, condenses the new view behind the wave and hands back crisp HTML', async () => {
    const { box, view } = page();
    const p = pageDissolve(as(box));
    expect(canvases(box)).toHaveLength(1);
    const render = vi.fn(() => { view.textContent = 'Activity'; });
    const done = p.swap(render);
    await flush();
    expect(p.busy).toBe(true);
    expect(box.dataset.state).toBe('out');
    expect(view.style.getPropertyValue('opacity')).toBe('0');
    await play(150);
    expect(render).toHaveBeenCalledOnce();
    expect(box.dataset.state).toBe('in');
    expect(view.style.getPropertyValue('opacity')).toBe('0');
    await play(400);
    await done;
    expect(view.style.getPropertyValue('opacity')).toBe('');
    expect(box.dataset.state).toBeUndefined();
    expect(env.field.update).toHaveBeenLastCalledWith({ brightness: 0 });
    expect(p.busy).toBe(false);
    p.destroy();
    expect(canvases(box)).toHaveLength(0);
  });
  it('queues swaps in order', async () => {
    const { box } = page();
    const p = pageDissolve(as(box), { dissolve: 32, condense: 32 });
    const order: number[] = [];
    const a = p.swap(() => { order.push(1); }), b = p.swap(() => { order.push(2); });
    await play(400);
    await Promise.all([a, b]);
    expect(order).toEqual([1, 2]);
    p.destroy();
  });
  it('swaps at once under reduced motion and without WebGL2', async () => {
    env.reduced = true;
    const { box } = page();
    const render = vi.fn();
    const p = pageDissolve(as(box));
    await p.swap(render);
    expect(render).toHaveBeenCalledOnce();
    p.destroy();
    support.on = false;
    const q = pageDissolve(as(page().box));
    await q.swap(render);
    expect(render).toHaveBeenCalledTimes(2);
    q.destroy();
  });
  it('shows every block at 0 and none at 1', () => {
    const art = new FakeElement('CANVAS');
    art.width = 40; art.height = 32;
    const pen = new FakeElement('CANVAS').getContext('2d') as unknown as CanvasRenderingContext2D & { drawImage: ReturnType<typeof vi.fn> };
    dissolveFrame(pen, art as unknown as HTMLCanvasElement, -0.2, { x: 0, y: 0 }, 0);
    const all = pen.drawImage.mock.calls.length;
    expect(all).toBe(8);
    pen.drawImage.mockClear();
    dissolveFrame(pen, art as unknown as HTMLCanvasElement, 1.2, { x: 0, y: 0 }, 0);
    expect(pen.drawImage).not.toHaveBeenCalled();
  });
});
