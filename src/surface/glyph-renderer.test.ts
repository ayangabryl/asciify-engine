import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS } from '../types';
import type { AsciiFrame, AsciiOptions } from '../types';
import { packGlyphFrame, prepareGlyphAtlas, supportsGlyphRenderer } from './glyph-renderer';

const options: AsciiOptions = { ...DEFAULT_OPTIONS, charset: ' AB', colorMode: 'fullcolor' };

describe('hero glyph atlas', () => {
  it('preserves whole Unicode glyph identities and reserves index zero for space', () => {
    const plan = prepareGlyphAtlas(null, { ...options, charset: ' AA⠿𝒜e\u0301👩‍💻' }, 200, 100, 2, 20, 5);
    expect(plan.glyphs).toEqual([' ', 'A', '⠿', '𝒜', 'e\u0301', '👩‍💻']);
    expect(plan.indices.get('𝒜')).toBe(3);
    expect(plan.indices.get('e\u0301')).toBe(4);
    expect(plan.indices.get('👩‍💻')).toBe(5);
  });

  it('reuses the atlas across different video frames and color changes', () => {
    const plan = prepareGlyphAtlas(null, options, 200, 100, 1.5, 20, 5);
    const nextOptions = { ...options, accentColor: '#abcdef' };
    expect(prepareGlyphAtlas(plan, nextOptions, 200, 100, 1.5, 20, 5)).toBe(plan);
    expect(prepareGlyphAtlas(plan, { ...options, charset: ' ASCIIFY' }, 200, 100, 1.5, 20, 5)).not.toBe(plan);
    expect(prepareGlyphAtlas(plan, options, 200, 100, 2, 20, 5)).not.toBe(plan);
    expect(prepareGlyphAtlas(plan, options, 200, 100, 1.5, 20, 5, 4096, 1)).not.toBe(plan);
  });

  it('matches centered glyph metrics at actual DPR, including fonts below six pixels', () => {
    const plan = prepareGlyphAtlas(null, options, 40, 20, 2, 10, 4);
    expect(plan.cellWidth).toBe(4);
    expect(plan.cellHeight).toBe(5);
    expect(plan.fontSize).toBe(4.5);
    expect(plan.tileWidth).toBe(14);
    expect(plan.tileHeight).toBe(16);
    expect(plan.atlasWidth).toBe(plan.atlasColumns * plan.tileWidth);
    expect(plan.glyphs).toContain('A');
  });

  it('rejects atlases too large for the GPU instead of clipping glyphs', () => {
    expect(() => prepareGlyphAtlas(null, options, 2000, 1000, 2, 2, 1, 1024)).toThrow('texture size');
  });
});

describe('hero glyph data', () => {
  it('packs exact RGBA bytes and full two-byte glyph indices', () => {
    const glyphs = new Map([[' ', 0], ['𝒜', 513], ['B', 2]]);
    const frame: AsciiFrame = [[
      { char: '𝒜', r: 17, g: 129, b: 253, a: 127 },
      { char: 'B', r: 255, g: 64, b: 1, a: 255 },
    ]];
    const packed = packGlyphFrame(frame, glyphs, options);
    expect([...packed.indices]).toEqual([1, 2, 110, 0, 2, 0, 114, 0]);
    expect([...packed.colors]).toEqual([17, 129, 253, 127, 255, 64, 1, 255]);
  });

  it('reuses buffers and fully clears cells that become transparent, black or empty', () => {
    const glyphs = new Map([[' ', 0], ['A', 1]]);
    const previous = packGlyphFrame([[{ char: 'A', r: 40, g: 120, b: 250, a: 128 }]], glyphs, options);
    const indices = previous.indices, colors = previous.colors;
    for (const cell of [
      { char: 'A', r: 40, g: 120, b: 250, a: 0 },
      { char: 'A', r: 0, g: 0, b: 0, a: 255 },
      { char: ' ', r: 255, g: 255, b: 255, a: 255 },
    ]) {
      const next = packGlyphFrame([[cell]], glyphs, options, previous);
      expect(next).toBe(previous);
      expect(next.indices).toBe(indices); expect(next.colors).toBe(colors);
      expect([...next.indices]).toEqual([0, 0, 0, 0]);
      expect([...next.colors]).toEqual([0, 0, 0, 0]);
    }
  });

  it('uses constant accent ink and preserves the source alpha', () => {
    const packed = packGlyphFrame([[{ char: 'A', r: 0, g: 0, b: 0, a: 100 }]], new Map([['A', 1]]), {
      ...options, colorMode: 'accent', accentColor: '#123456',
    });
    expect([...packed.colors]).toEqual([18, 52, 86, 100]);
  });

  it('keeps grayscale and matrix color resolution consistent with the engine', () => {
    const frame = [[{ char: 'A', r: 100, g: 200, b: 50, a: 255 }]];
    const glyphs = new Map([['A', 1]]);
    expect([...packGlyphFrame(frame, glyphs, { ...options, colorMode: 'grayscale' }).colors]).toEqual([152, 152, 152, 255]);
    expect([...packGlyphFrame(frame, glyphs, { ...options, colorMode: 'matrix' }).colors]).toEqual([0, 152, 0, 255]);
  });

  it('rejects missing glyphs and ragged frames instead of displaying substitutes', () => {
    const cell = { char: 'B', r: 255, g: 255, b: 255, a: 255 };
    expect(() => packGlyphFrame([[cell]], new Map([['A', 1]]), options)).toThrow('absent');
    expect(() => packGlyphFrame([[cell], []], new Map([['B', 1]]), options)).toThrow('rectangular');
  });
});

describe('hero renderer eligibility', () => {
  it('requires the engine fallback for unsupported effects and style modes', () => {
    expect(supportsGlyphRenderer(options)).toBe(true);
    for (const partial of [
      { animationStyle: 'current' }, { hoverStrength: .2 }, { charsetFrames: ['AB'] },
      { renderMode: 'dots' }, { artStyle: 'braille' }, { colorMode: 'accent', accentColor: 'auto' },
    ] as Partial<AsciiOptions>[]) expect(supportsGlyphRenderer({ ...options, ...partial })).toBe(false);
  });
});

it('keeps black source coverage for a density wake without reviving transparent pixels',()=>{
  const frame:AsciiFrame=[[{char:' ',r:0,g:0,b:0,a:255},{char:' ',r:0,g:0,b:0,a:0}]];
  const result=packGlyphFrame(frame,new Map([[' ',0]]),options,undefined,true);
  expect(result.colors[3]).toBe(255);expect(result.colors[7]).toBe(0);
  expect(result.indices.every(v=>v===0)).toBe(true);
});


it('retains source tone independently of accent ink and arbitrary custom-letter order', () => {
  const frame: AsciiFrame = [[{char:'Y',r:30,g:30,b:30,a:255},{char:'A',r:220,g:220,b:220,a:255}]];
  const result=packGlyphFrame(frame,new Map([['Y',7],['A',1]]),{...options,colorMode:'accent',accentColor:'#888888'});
  expect([result.indices[2],result.indices[6]]).toEqual([30,220]);
  expect([...result.colors]).toEqual([136,136,136,255,136,136,136,255]);
});
