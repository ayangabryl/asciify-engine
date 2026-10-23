import { describe, expect, it, vi } from 'vitest';

const { mount, support } = vi.hoisted(() => ({ mount: vi.fn(), support: { on: true } }));
vi.mock('../field', () => ({ isGlyphFieldSupported: () => support.on, mountGlyphField: mount }));

import { CHARACTER_SETS, resolveCharset, isWideGlyph } from '../studio/characters';
import { isWideCharset, normalizeFieldSettings } from '../field/field-model';
import { withCharset, setGlobalLook } from './core-live';
import { ocean, OCEAN_CHARSET } from './ocean';
import { globe } from './globe';
import { morphField } from './morph-field';
import { ditherGradient } from './dither-gradient';
import { ditherImage } from './dither-image';
import { wordmark } from './wordmark';
import { decode } from './decode';
import { cursorTrail } from './cursor-trail';
import { background } from './background';
import { estuary } from './backgrounds/estuary';
import { capillary } from './backgrounds/capillary';
import { shockwave } from './backgrounds/shockwave';
import { useFakeDom } from './fake-dom-2a';

const { env, run, flush, element, as } = useFakeDom(mount, support);
const mountLook = () => mount.mock.calls[mount.mock.calls.length - 1]?.[1] as Record<string, unknown>;
const lastLook = () => ({ ...mountLook(), ...Object.assign({}, ...env.field.update.mock.calls.map(([o]) => o as Record<string, unknown>)) });

describe('charsets', () => {
  it('ramps fish and kanji light to dense, and resolves names or your own characters', () => {
    expect(CHARACTER_SETS.fish.chars).toBe(" .'-,:;txoSX%#8@");
    expect(CHARACTER_SETS.kanji.label).toBe('Kanji (Japanese)');
    expect([...CHARACTER_SETS.kanji.chars][1]).toBe('一');
    expect([...CHARACTER_SETS.kanji.chars].slice(1).every(isWideGlyph)).toBe(true);
    for (const set of Object.values(CHARACTER_SETS)) expect(set.chars.startsWith(' ')).toBe(true);
    expect(resolveCharset('kanji')).toBe(CHARACTER_SETS.kanji.chars);
    expect(resolveCharset('ab')).toBe(' ab');
    expect(resolveCharset(undefined)).toBeUndefined();
  });

  it('draws full-width glyphs in square cells', () => {
    expect(isWideCharset(CHARACTER_SETS.kanji.chars)).toBe(true);
    expect(isWideCharset(CHARACTER_SETS.fish.chars)).toBe(false);
    expect(normalizeFieldSettings({ charset: CHARACTER_SETS.kanji.chars, cellAspect: 0.6 }).cellAspect).toBe(1);
    expect(normalizeFieldSettings({ charset: CHARACTER_SETS.kanji.chars, cellAspect: 0.6, mark: 'dot' }).cellAspect).toBe(0.6);
    expect(normalizeFieldSettings({ charset: CHARACTER_SETS.fish.chars, cellAspect: 0.6 }).cellAspect).toBe(0.6);
  });

  it('keeps a character mark and switches a drawn mark to glyphs', () => {
    expect(withCharset({ mark: 'inlay', cellSize: 15 }, 'fish')).toMatchObject({ mark: 'inlay', charset: CHARACTER_SETS.fish.chars, cellSize: 15 });
    expect(withCharset({ mark: 'tick', cellSize: 4 }, 'kanji')).toMatchObject({ mark: 'glyph', charset: CHARACTER_SETS.kanji.chars, cellSize: 7 });
    expect(withCharset({ mark: 'dot' }, undefined)).toEqual({ mark: 'dot' });
  });
});

describe('every new component takes a charset', () => {
  const cases: [string, (el: HTMLElement, charset: string) => unknown, string][] = [
    ['ocean', (el, charset) => ocean(el, { charset }), 'inlay'],
    ['globe', (el, charset) => globe(el, { charset }), 'glyph'],
    ['morphField', (el, charset) => morphField(el, { sources: [(pen: CanvasRenderingContext2D) => pen.fillRect(0, 0, 4, 4)], charset }), 'glyph'],
    ['ditherGradient', (el, charset) => ditherGradient(el, { charset }), 'glyph'],
    ['ditherImage', (el, charset) => ditherImage(el, { src: 'x.png', charset, reveal: 'none' }), 'glyph'],
    ['wordmark assemble', (el, charset) => wordmark(el, { text: 'field', assemble: 'visible', charset }), 'glyph'],
    ['decode', (el, charset) => decode(el, { text: 'Hello', charset }), 'glyph'],
    ['cursorTrail spray', (_el, charset) => {
      const trail = cursorTrail({ style: 'spray', charset });
      for (let i = 0; i < 4; i++) { env.body.dispatch('pointermove', { clientX: 40 + i * 30, clientY: 100, pointerType: 'mouse', buttons: 0 }); run(16); }
      return trail;
    }, 'glyph'],
  ];
  for (const name of ['fish', 'kanji'] as const) {
    for (const [label, make, mark] of cases) {
      it(`${label} in ${name}`, async () => {
        mount.mockClear();
        const host = element();
        host.rect = { left: 0, top: 0, width: 400, height: 300 };
        const handle = make(as(host), name) as { destroy(): void; update(o: object): void };
        await flush();
        expect(lastLook()).toMatchObject({ mark, charset: CHARACTER_SETS[name].chars });
        handle.update({ charset: undefined });
        expect(lastLook().charset).not.toBe(CHARACTER_SETS[name].chars);
        handle.destroy();
      });
    }
    for (const [label, preset] of [['estuary', estuary], ['capillary', capillary], ['shockwave', shockwave]] as const) {
      it(`${label} background in ${name}`, async () => {
        mount.mockClear();
        const bg = background(as(element()), { preset, charset: name });
        await flush();
        expect(mountLook()).toMatchObject({ mark: 'glyph', charset: CHARACTER_SETS[name].chars });
        bg.destroy();
      });
    }
  }

  it('a given charset wins over the page look; the ocean follows the look in its own tiles', async () => {
    const a = element(), b = element();
    const own = ocean(as(a), { charset: 'fish', reducedMotion: true });
    await flush();
    const plain = ocean(as(b), { reducedMotion: true });
    await flush();
    expect(mountLook()).toMatchObject({ mark: 'inlay', charset: OCEAN_CHARSET });
    env.field.update.mockClear();
    setGlobalLook({ charset: CHARACTER_SETS.kanji.chars });
    const updates = env.field.update.mock.calls.map(([o]) => o as Record<string, unknown>);
    expect(updates.some(o => o.charset === CHARACTER_SETS.kanji.chars && o.mark === 'inlay')).toBe(true);
    expect(updates.filter(o => o.charset === CHARACTER_SETS.kanji.chars)).toHaveLength(1);
    setGlobalLook(null);
    own.destroy(); plain.destroy();
  });
});
