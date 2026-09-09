import { describe, expect, it } from 'vitest';
import {
  ART_STYLE_PRESETS,
  CHARSET_SEQUENCES,
  CHARSETS,
  LIVING_STYLE_PRESETS,
} from './types';
import { resolveSourceCrop } from './core/renderer';
import { computeCanvasRenderSize } from './core/simple-api';

describe('charset catalog', () => {
  it('includes modern product glyph ramps for clean AI-era interfaces', () => {
    expect(CHARSETS.interface).toContain('⌘');
    expect(CHARSETS.prompt).toContain('>');
    expect(CHARSETS.data).toContain('◇');
    expect(CHARSETS.humanist).toContain('∴');
    expect(CHARSETS.mesh).toContain('╬');
  });

  it('includes living charset sequences for motion-ready ASCII textures', () => {
    expect(CHARSET_SEQUENCES.assistant).toEqual([
      CHARSETS.interface,
      CHARSETS.prompt,
      CHARSETS.data,
    ]);
    expect(CHARSET_SEQUENCES.signal).toContain(CHARSETS.mesh);
  });
});

describe('style presets', () => {
  it('exposes art styles for the new charsets', () => {
    expect(ART_STYLE_PRESETS.interface.charset).toBe(CHARSETS.interface);
    expect(ART_STYLE_PRESETS.prompt.charset).toBe(CHARSETS.prompt);
    expect(ART_STYLE_PRESETS.data.charset).toBe(CHARSETS.data);
    expect(ART_STYLE_PRESETS.humanist.charset).toBe(CHARSETS.humanist);
    expect(ART_STYLE_PRESETS.mesh.charset).toBe(CHARSETS.mesh);
  });

  it('provides living presets that combine charsets, motion, hover, and normalized contrast', () => {
    expect(LIVING_STYLE_PRESETS.liquidSignal.charsetFrames).toEqual(CHARSET_SEQUENCES.signal);
    expect(LIVING_STYLE_PRESETS.liquidSignal.animationStyle).toBe('current');
    expect(LIVING_STYLE_PRESETS.cursorGravity.hoverStrength).toBeGreaterThan(0);
    expect(LIVING_STYLE_PRESETS.agentField.normalize).toBe(true);
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

// Public preset retirement is deliberate in 2.0; custom Unicode remains supported.
describe('standard catalog', () => {
  it('excludes retired novelty presets', () => {
    for (const key of ['emoji', 'musical', 'starfield']) {
      expect(CHARSETS).not.toHaveProperty(key);
      expect(ART_STYLE_PRESETS).not.toHaveProperty(key);
    }
  });
});
