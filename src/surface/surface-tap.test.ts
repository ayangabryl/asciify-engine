import { describe, expect, it } from 'vitest';
import { normalizeFieldSettings } from '../field/field-model';
import { PHOTO_CUE_STRIDE } from './photo-cues';
import { SurfaceTap, photoMedium, shadePhotoTap } from './surface-tap';

// Left half water, right half busy ground, with a near subject's outline down the middle third.
function cues(cols: number, rows: number) {
  const c = new Float32Array(cols * rows * PHOTO_CUE_STRIDE);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const o = (y * cols + x) * PHOTO_CUE_STRIDE, water = x < cols / 2;
    c[o] = 0.4; c[o + 1] = x > cols * 0.75 ? 0.9 : 0.2; c[o + 3] = water ? 0.05 : 0.9; c[o + 8] = water ? 1 : 0;
  }
  return c;
}

describe('photo medium', () => {
  it('carries a tap fast and long over water, damps it on busy ground and holds it at the subject', () => {
    const tap = new SurfaceTap(64, 32), c = cues(64, 32);
    photoMedium(tap, c);
    const water = 16 * 64 + 10, ground = 16 * 64 + 40, outline = 16 * 64 + 48;
    expect(tap.speed[water]).toBeGreaterThan(tap.speed[ground] * 2);
    expect(tap.damp[ground]).toBeGreaterThan(tap.damp[water] * 4);
    expect(tap.wall[outline]).toBeGreaterThan(0.3);
    expect(tap.wall[water]).toBe(0);
    tap.base = 30; tap.drop(16, 16, 1, 2);
    for (let i = 0; i < 20; i++) tap.step(1 / 60);
    const out = shadePhotoTap(tap, c, [-0.5, -0.8], new Uint8Array(64 * 32 * 4));
    let lit = 0;
    for (let i = 0; i < 64 * 32; i++) if (Math.abs(((out[i * 4] << 8) | out[i * 4 + 1]) - 32768) > 2000) lit++;
    expect(lit).toBeGreaterThan(20);
  });
  it('is the field default, and the ring stays available', () => {
    expect(normalizeFieldSettings({}).tap).toBe('surface');
    expect(normalizeFieldSettings({ tap: 'ring' }).tap).toBe('ring');
    expect(normalizeFieldSettings({ tap: 'bogus' as 'ring' }).tap).toBe('surface');
  });
});
