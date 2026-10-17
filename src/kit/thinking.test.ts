import { describe, expect, it, vi } from 'vitest';

const { mount, support } = vi.hoisted(() => ({ mount: vi.fn(), support: { on: true } }));
vi.mock('../field', () => ({ isGlyphFieldSupported: () => support.on, mountGlyphField: mount }));

import { asElement, useFakeDom } from './fake-dom-2b';
import { thinking } from './thinking';

const dom = useFakeDom(mount, support);
const words = (root: ReturnType<typeof dom.element>) => root.all().filter(el => el.tagName === 'SPAN' && el.parentElement?.parentElement === root && !el.childNodes.some(n => n.constructor.name === 'FakeElement'));

describe('thinking', () => {
  it('thinks in bands of dots, then streams the answer word by word', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const reply = dom.element(), label = dom.element('SPAN');
    const t = thinking(asElement(reply), { label: asElement(label) });
    expect(t.state).toBe('thinking');
    expect(reply.getAttribute('aria-busy')).toBe('true');
    expect(label.textContent).toBe('Thinking…');
    expect(reply.style.getPropertyValue('min-height')).toBe('72px');
    expect(mount.mock.calls[0][1]).toMatchObject({ mark: 'dot', background: 'transparent' });
    dom.advance(16);
    expect(dom.pen().drawImage).toHaveBeenCalled();
    dom.advance(700);
    expect(dom.field.pulse).not.toHaveBeenCalled();
    expect(dom.frames.size).toBe(1);

    dom.advance(1400);
    const done = t.stream('Three fixes shipped.');
    expect(t.state).toBe('streaming');
    expect(label.textContent).toBe('Thought for 2s');
    expect(reply.textContent).toBe('Three fixes shipped.');
    const spans = words(reply);
    expect(spans.map(s => s.textContent)).toEqual(['Three', 'fixes', 'shipped.']);
    expect(spans[0].style.getPropertyValue('opacity')).toBe('0');
    expect(spans[2].style.getPropertyValue('transition')).toContain('76ms');
    dom.advance(); dom.advance();
    expect(spans[0].style.getPropertyValue('opacity')).toBe('1');
    await vi.advanceTimersByTimeAsync(400);
    await done;
    expect(t.state).toBe('done');
    expect(reply.getAttribute('aria-busy')).toBe('false');
    dom.settle();
    expect(dom.frames.size).toBe(0);
    t.destroy();
    expect(reply.textContent).toBe('Three fixes shipped.');
    expect(dom.canvases(reply)).toHaveLength(0);
    expect(reply.style.getPropertyValue('min-height')).toBe('');
  });

  it('streams chunks, holding a partial word until it is whole', async () => {
    const reply = dom.element();
    const t = thinking(asElement(reply), { reducedMotion: true });
    async function* chunks() { yield 'Thr'; yield 'ee fi'; yield 'xes'; }
    await t.stream(chunks());
    expect(words(reply).map(s => s.textContent)).toEqual(['Three', 'fixes']);
    expect(t.state).toBe('done');
    t.think();
    expect(reply.textContent).toBe('');
    expect(t.state).toBe('thinking');
  });

  it('waits for think() when start is false, and writes plain text without WebGL2', async () => {
    support.on = false;
    const reply = dom.element();
    reply.textContent = 'placeholder';
    const t = thinking(asElement(reply), { start: false });
    expect(t.supported).toBe(false);
    expect(reply.textContent).toBe('placeholder');
    await t.stream('Hello there');
    expect(reply.textContent).toBe('Hello there');
    expect(words(reply)[0].style.getPropertyValue('opacity')).toBe('');
    t.destroy();
  });

  it('reports each state with how long it thought, for a status rendered elsewhere', async () => {
    const reply = dom.element(), seen: [string, number][] = [];
    const t = thinking(asElement(reply), { reducedMotion: true, onState: (state, seconds) => seen.push([state, seconds]) });
    await t.stream('Done.');
    expect(seen.map(([state]) => state)).toEqual(['thinking', 'streaming', 'done']);
    expect(seen[2][1]).toBeGreaterThanOrEqual(1);
    t.destroy();
  });
});
