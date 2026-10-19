import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mount, support, gpu } = vi.hoisted(() => ({ mount: vi.fn(), support: { on: true }, gpu: { live: 0, limit: 3 } }));
vi.mock('../field', () => ({ isGlyphFieldSupported: () => support.on, mountGlyphField: mount }));
// A page whose GPU memory budget fits three fields, all drawn through the shared context.
vi.mock('../field/field-gl', async original => ({
  ...(await original<typeof import('../field/field-gl')>()),
  isSharedFieldCanvas: () => true,
  currentFieldContext: () => ({ get overBudget() { return gpu.live > gpu.limit; }, get roomy() { return gpu.live < gpu.limit; } }),
}));

import { beam } from './beam';
import { FakeElement, FakeStyle, fakeField, useFakeDom } from './fake-dom-2a';

const { env, advance, element, as } = useFakeDom(mount, support);
Object.defineProperty(FakeStyle.prototype, 'cssText', { configurable: true, get() { return ''; }, set() {} });
Object.assign(FakeElement.prototype, {
  getAttributeNames(this: FakeElement) { return [...this.attributes.keys()]; },
  replaceWith(this: FakeElement, next: FakeElement) { const parent = this.parentElement; if (!parent) return; parent.insertBefore(next, this); this.remove(); },
});
Object.defineProperty(FakeElement.prototype, 'isConnected', {
  configurable: true,
  get(this: FakeElement) { let n: FakeElement = this; while (n.parentElement) n = n.parentElement; return n.tagName === 'HTML'; },
});

beforeEach(() => {
  vi.stubGlobal('innerHeight', 800);
  gpu.live = 0;
  mount.mockImplementation(() => { gpu.live++; const f = fakeField(); f.destroy.mockImplementation(() => { gpu.live--; }); return f; });
});
afterEach(() => vi.unstubAllGlobals());

const at = (top: number) => { const el = element(); el.rect = { left: 0, top, width: 200, height: 40 }; return el; };
const scroll = (...moves: [FakeElement, number][]) => {
  for (const [el, top] of moves) el.rect = { ...el.rect, top };
  const entries = moves.map(([el]) => ({ target: el, isIntersecting: true }));
  for (const o of env.observers as unknown as { fn?: (e: unknown[]) => void }[]) if (o instanceof IntersectionObserver) o.fn?.(entries);
};

describe('GPU memory budget', () => {
  it('keeps the page within its memory budget: farther fields give way to posters, nearer ones mount', () => {
    const els = [0, 100, 900, 1000, 1100, 1200].map(at);
    const handles = els.map(el => beam(as(el), { poster: '/still.webp' }));
    for (let i = 0; i < 8; i++) { scroll(...els.map(el => [el, el.rect.top] as [FakeElement, number])); advance(); }
    // One over the limit at most: what mounted last tipped it, and the next pass releases the farthest.
    expect(gpu.live).toBeLessThanOrEqual(gpu.limit + 1);
    // Scrolling the far ones into view moves the budget to them.
    scroll([els[0], 3000], [els[1], 3100], [els[2], 0], [els[3], 100], [els[4], 200], [els[5], 300]);
    for (let i = 0; i < 8; i++) { scroll(...els.map(el => [el, el.rect.top] as [FakeElement, number])); advance(); }
    expect(gpu.live).toBeLessThanOrEqual(gpu.limit + 1);
    const lastMounts = mount.mock.calls.slice(-3).map(call => call[0]);
    expect(lastMounts.every(canvas => els.slice(2).some(el => el.contains(canvas)))).toBe(true);
    handles.forEach(h => h.destroy());
    expect(gpu.live).toBe(0);
  });

  it('settles with fields that never release by distance: no mounting and releasing in turn at the budget', () => {
    const els = Array.from({ length: 10 }, (_, i) => at(i * 900));
    const handles = els.map(el => beam(as(el), { lazy: false, poster: '/still.webp' }));
    for (let i = 0; i < 5; i++) { scroll(...els.map(el => [el, el.rect.top] as [FakeElement, number])); advance(); }
    const settled = mount.mock.calls.length;
    for (let i = 0; i < 40; i++) { scroll(...els.map(el => [el, el.rect.top] as [FakeElement, number])); advance(); }
    expect(mount.mock.calls.length).toBe(settled);
    expect(gpu.live).toBeLessThanOrEqual(gpu.limit + 1);
    handles.forEach(h => h.destroy());
  });
});
