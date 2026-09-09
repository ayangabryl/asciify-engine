import { describe, expect, it } from 'vitest';
import * as core from './core';
import { CHARACTER_SETS } from './studio/characters';
import { STUDIO_STYLES } from './studio/model';
import { resolveCoreStyle } from './core/style';
import { resolveSourceCrop } from './core/renderer';
import { computeCanvasRenderSize } from './core/simple-api';

describe('current catalogs', () => {
  it('removes legacy catalog exports from the public media API', () => {
    for(const key of ['CHARSETS','ART_STYLE_PRESETS','CHARSET_SEQUENCES','LIVING_STYLE_PRESETS']) expect(core).not.toHaveProperty(key);
  });
  it('retains the curated alphabets and exactly the 15 current render styles', () => {
    expect(Object.keys(CHARACTER_SETS)).toEqual(['standard','asciify','minimal','detailed','letters','technical','blocks','braille']);
    expect(STUDIO_STYLES).toEqual(['ascii','blocks','braille','dots','lines','cross','diagonal','diamond','mixed','pixel','mosaic','lego','voxel','disco','dither']);
  });
  it('rejects removed shortcuts with migration guidance', () => {
    for(const name of ['binary','katakana','waves','smoke','particles','letters','art','terminal']) expect(()=>resolveCoreStyle(name)).toThrow('asciify-engine/studio');
    expect(resolveCoreStyle()).toEqual({artStyle:'classic'});
  });
});

describe('source crop', () => {
  it('treats CSS-like insets as the exact source view box', () => {
    expect(resolveSourceCrop({ top: 0.2, bottom: 0.24 }, 1920, 1080)).toEqual({
      x: 0,
      y: 216,
      width: 1920,
      height: 604.8,
    });
  });

  it('still preserves source aspect for single-dimension legacy crops', () => {
    expect(resolveSourceCrop({ height: 0.7 }, 1000, 500)).toEqual({
      x: 150,
      y: 75,
      width: 700,
      height: 350,
    });
  });
});

describe('canvas render sizing', () => {
  it('keeps fitted canvas render dimensions at least as large as the CSS display box', () => {
    expect(computeCanvasRenderSize({
      sourceWidth: 1920,
      sourceHeight: 415,
      cssWidth: 2121,
      cssHeight: 458,
      dpr: 1,
      maxRenderDimension: 4096,
    })).toEqual({
      renderW: 2121,
      renderH: 458,
    });
  });

  it('leaves retina scaling to the canvas DPR buffer instead of double-counting it', () => {
    expect(computeCanvasRenderSize({
      sourceWidth: 1920,
      sourceHeight: 415,
      cssWidth: 2048,
      cssHeight: 443,
      dpr: 2,
      maxRenderDimension: 4096,
    })).toEqual({
      renderW: 2048,
      renderH: 443,
    });
  });
});
