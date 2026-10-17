import { describe, expect, it, vi } from 'vitest';

const { mount, support } = vi.hoisted(() => ({ mount: vi.fn(), support: { on: true } }));
vi.mock('../field', () => ({ isGlyphFieldSupported: () => support.on, mountGlyphField: mount }));

import { asElement, useFakeDom } from './fake-dom-2b';
import { streamText, STREAM_TEXT_DEFAULTS } from './stream-text';

const dom = useFakeDom(mount, support);
const chars = (root: ReturnType<typeof dom.element>) => root.children.filter(el => el.tagName === 'SPAN');

describe('streamText', () => {
  it('lands each token as glyph cells that resolve left to right', async () => {
    const reply = dom.element('P'), states: string[] = [];
    const s = streamText(asElement(reply), { onState: next => states.push(next) });
    expect(mount.mock.calls[0][1]).toMatchObject({ mark: 'glyph', cellSize: 12, cellAspect: 7 / 12 });
    s.write('Hi ');
    s.write('you');
    expect(s.state).toBe('streaming');
    expect(reply.getAttribute('aria-busy')).toBe('true');
    expect(reply.textContent).toBe('Hi you');
    expect(s.text).toBe('Hi you');
    const cells = chars(reply);
    expect(cells.map(c => c.textContent)).toEqual(['H', 'i', 'y', 'o', 'u']);
    expect(cells.every(c => c.style.getPropertyValue('color') === 'transparent')).toBe(true);
    dom.advance(16);
    expect(dom.pen().fillRect).toHaveBeenCalled();
    dom.advance(50);
    expect(cells[0].style.getPropertyValue('color')).toBe('');
    expect(cells[1].style.getPropertyValue('color')).toBe('transparent');
    const done = s.done();
    expect(s.done()).toBe(done);
    dom.settle();
    await done;
    expect(cells.every(c => c.style.getPropertyValue('color') === '')).toBe(true);
    expect(s.state).toBe('done');
    expect(states).toEqual(['streaming', 'done']);
    expect(reply.getAttribute('aria-busy')).toBeNull();
    s.destroy();
    expect(reply.textContent).toBe('Hi you');
    expect(dom.canvases(reply)).toHaveLength(0);
  });

  it('stops at once, landing what was written', async () => {
    const reply = dom.element('P');
    const s = streamText(asElement(reply));
    s.write('Halfway');
    const done = s.done();
    s.stop();
    await done;
    expect(s.state).toBe('stopped');
    expect(chars(reply).every(c => c.style.getPropertyValue('color') === '')).toBe(true);
    s.reset();
    expect(s.state).toBe('idle');
    expect(s.text).toBe('');
    expect(chars(reply)).toHaveLength(0);
  });

  it('fits the field to the content box, a quarter line above and below, and skips the flicker under reduced motion', () => {
    const reply = dom.element('P');
    dom.styles.set(reply, { paddingTop: '10px', paddingLeft: '12px', paddingRight: '12px', paddingBottom: '6px' });
    const s = streamText(asElement(reply), { reducedMotion: true });
    const [canvas] = dom.canvases(reply);
    expect(canvas.style.top).toBe('4px');
    expect(canvas.style.width).toBe('calc(100% - 12px)');
    expect(canvas.style.height).toBe('calc(100% - 4px)');
    s.write('Now');
    expect(chars(reply).every(c => c.style.getPropertyValue('color') === '')).toBe(true);
    expect(STREAM_TEXT_DEFAULTS).toMatchObject({ settle: 60, stagger: 18 });
  });

  it('writes plain text without WebGL2', async () => {
    support.on = false;
    const reply = dom.element('P');
    reply.textContent = 'Waiting';
    const s = streamText(asElement(reply));
    expect(reply.textContent).toBe('Waiting');
    s.write('Plain ');
    s.write('text');
    expect(reply.textContent).toBe('Plain text');
    await expect(s.done()).resolves.toBeUndefined();
    expect(s.state).toBe('done');
  });
  it('keeps a short reasoning tail above the reply and collapses it when done', async () => {
    const box = dom.element(), reply = dom.element('P');
    box.appendChild(reply);
    const s = streamText(asElement(reply), { reasoningLines: 2 });
    s.reasoning('Reading checkout events');
    const tail = box.children[0];
    expect(tail.className).toBe('ascii-reasoning');
    expect(box.children[1]).toBe(reply);
    expect(dom.head.all().some(el => el.attributes.get('id') === 'ascii-kit-reasoning')).toBe(true);
    const items = () => tail.querySelectorAll('li');
    expect(items()[0].textContent).toBe('Reading checkout events');
    expect(items()[0].attributes.has('data-new')).toBe(true);
    dom.advance();
    expect(items()[0].attributes.has('data-new')).toBe(false);
    s.reasoning('Splitting the funnel by browser');
    s.reasoning('Safari 18.1 stalls at payment');
    expect(items()).toHaveLength(3);
    // The shift waits a frame, so every line slides up together with the new one.
    expect(tail.style.getPropertyValue('--ascii-reasoning-shift')).toBe('0');
    dom.advance();
    expect(tail.style.getPropertyValue('--ascii-reasoning-shift')).toBe('1');
    expect(tail.style.getPropertyValue('--ascii-reasoning-lines')).toBe('2');
    s.write('Conversion fell.');
    expect(tail.attributes.has('data-collapsed')).toBe(false);
    const finished = s.done();
    dom.settle();
    await finished;
    expect(s.state).toBe('done');
    expect(tail.attributes.has('data-collapsed')).toBe(true);
    expect(tail.attributes.get('aria-hidden')).toBe('true');
    s.reset();
    expect(box.children).toEqual([reply]);
    s.reasoning('Again');
    expect(box.children).toHaveLength(2);
    s.destroy();
    expect(box.children).toEqual([reply]);
  });
  it('collapses the reasoning on stop, and keeps it without WebGL2', () => {
    support.on = false;
    const box = dom.element(), reply = dom.element('P');
    box.appendChild(reply);
    const s = streamText(asElement(reply));
    s.reasoning('Thinking it over');
    s.write('Partial');
    s.stop();
    expect(box.children[0].attributes.has('data-collapsed')).toBe(true);
    s.destroy();
  });

  it('folds the reasoning away when stopped before any text', () => {
    const box = dom.element(), reply = dom.element('P');
    box.appendChild(reply);
    const s = streamText(asElement(reply));
    s.reasoning('Reading checkout events');
    s.stop();
    expect(s.state).toBe('stopped');
    expect(box.children[0].attributes.has('data-collapsed')).toBe(true);
  });
});
