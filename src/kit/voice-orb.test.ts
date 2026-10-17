import { describe, expect, it, vi } from 'vitest';

const { mount, support } = vi.hoisted(() => ({ mount: vi.fn(), support: { on: true } }));
vi.mock('../field', () => ({ isGlyphFieldSupported: () => support.on, mountGlyphField: mount }));

import { voiceOrb } from './voice-orb';
import { useFakeDom } from './fake-dom-2a';

const dom = useFakeDom(mount, support);
const { env, advance, run, flush, element, as, canvases } = dom;

describe('voiceOrb', () => {
  it('mounts a decorative field reaching 8% past the orb, and cleans up', () => {
    const el = element('BUTTON');
    el.rect.width = el.rect.height = 150;
    const orb = voiceOrb(as(el));
    const [canvas] = canvases(el);
    expect(orb.supported).toBe(true);
    expect(canvas.style.left).toBe('-12px');
    expect(mount.mock.calls[0][1]).toMatchObject({ mark: 'glyph', color: 'source', contrast: 2.2 });
    advance();
    expect(env.field.setSource).toHaveBeenCalled();
    orb.destroy();
    expect(canvases(el)).toHaveLength(0);
    expect(el.style.getPropertyValue('scale')).toBe('');
    expect(el.style.getPropertyValue('--ascii-level')).toBe('');
  });
  it('follows the level with a fast attack and a slower release while listening', () => {
    const el = element('BUTTON');
    const orb = voiceOrb(as(el), { palette: 'mono' });
    expect(mount.mock.calls[0][1]).toMatchObject({ color: 'ink' });
    orb.listen();
    expect(orb.state).toBe('listening');
    expect(el.dataset.state).toBe('listening');
    orb.level(1);
    advance();
    const first = orb.current;
    expect(first).toBeGreaterThan(0.3);
    run(200);
    expect(orb.current).toBeGreaterThan(0.95);
    expect(Number(el.style.getPropertyValue('scale'))).toBeGreaterThan(1.09);
    orb.level(0);
    advance();
    expect(1 - orb.current).toBeLessThan(first);
    orb.think();
    run(600);
    expect(orb.current).toBeGreaterThan(0.08);
    expect(orb.current).toBeLessThan(0.32);
    orb.done();
    run(500);
    expect(orb.current).toBe(0);
    orb.destroy();
  });
  it('asks for the microphone only when mic() is called, and stops it on think()', async () => {
    const stop = vi.fn(), getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop }] }));
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    class Context {
      createAnalyser() { return { fftSize: 0, getByteTimeDomainData: (a: Uint8Array) => a.fill(200) }; }
      createMediaStreamSource() { return { connect() {} }; }
      close = vi.fn(async () => {});
    }
    vi.stubGlobal('AudioContext', Context);
    const orb = voiceOrb(as(element('BUTTON')));
    expect(getUserMedia).not.toHaveBeenCalled();
    await expect(orb.mic()).resolves.toBe(true);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(orb.state).toBe('listening');
    run(100);
    expect(orb.current).toBeGreaterThan(0.9);
    orb.think();
    expect(stop).toHaveBeenCalled();
    orb.destroy();
  });
  it('resolves false when the microphone is refused or missing', async () => {
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => { throw new Error('denied'); }) } });
    vi.stubGlobal('AudioContext', class {});
    const orb = voiceOrb(as(element('BUTTON')));
    await expect(orb.mic()).resolves.toBe(false);
    vi.stubGlobal('navigator', {});
    await expect(orb.mic()).resolves.toBe(false);
    await flush();
    orb.destroy();
  });
  it('draws one settled frame under reduced motion', () => {
    env.reduced = true;
    const orb = voiceOrb(as(element('BUTTON')));
    orb.listen(); orb.level(0.8);
    advance();
    expect(env.frames.size).toBe(0);
    expect(orb.current).toBeCloseTo(0.8);
    orb.destroy();
  });
  it('falls back without WebGL2 and still swells with the level', () => {
    support.on = false;
    const el = element('BUTTON');
    const orb = voiceOrb(as(el));
    expect(orb.supported).toBe(false);
    expect(canvases(el)).toHaveLength(0);
    orb.listen(); orb.level(0.5);
    expect(el.style.getPropertyValue('--ascii-level')).toBe('0.500');
    orb.destroy();
  });
});
