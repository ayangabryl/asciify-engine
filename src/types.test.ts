import { describe, expect, it } from 'vitest';
import {
  ART_STYLE_PRESETS,
  CHARSET_SEQUENCES,
  CHARSETS,
  LIVING_STYLE_PRESETS,
} from './types';

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
    expect(LIVING_STYLE_PRESETS.liquidSignal.animationStyle).toBe('melt');
    expect(LIVING_STYLE_PRESETS.cursorGravity.hoverStrength).toBeGreaterThan(0);
    expect(LIVING_STYLE_PRESETS.agentField.normalize).toBe(true);
  });
});
