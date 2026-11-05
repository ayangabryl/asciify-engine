import { describe, expect, it } from 'vitest';
import { mipLevelFor } from './field-readback';

describe('mipLevelFor', () => {
  it('picks the largest level within the side limit', () => {
    expect(mipLevelFor(3840, 2160, 128)).toEqual({ level: 5, width: 120, height: 67 });
    expect(mipLevelFor(1920, 1080, 128)).toEqual({ level: 4, width: 120, height: 67 });
    expect(mipLevelFor(640, 360, 64)).toEqual({ level: 4, width: 40, height: 22 });
  });
  it('keeps a small texture at its own size', () => {
    expect(mipLevelFor(96, 54, 128)).toEqual({ level: 0, width: 96, height: 54 });
  });
  it('stops at one texel on the short side of a long strip', () => {
    expect(mipLevelFor(4096, 2, 128)).toEqual({ level: 1, width: 2048, height: 1 });
  });
});
