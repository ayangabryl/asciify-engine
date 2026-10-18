import { describe, expect, it } from 'vitest';
import { buildPhotoCues, packPhotoCues, PHOTO_CUE_STRIDE } from './photo-cues';
import { sampleAmbient } from './ambient-motion';

// A blue sky over a turquoise sea with a red buoy, on a 96x48 grid; the sea has a little level ripple.
function seascape() {
  const w = 96, h = 48, rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, sea = y >= h * .45, buoy = Math.hypot(x - 48, y - 34) < 5;
    const ripple = sea ? Math.sin(y * 2.1 + Math.sin(x * .3)) * 18 : 0;
    rgba.set(buoy ? [210, 40, 30, 255] : sea ? [20 + ripple, 150 + ripple, 170 + ripple, 255] : [110 + y, 170 + y, 235, 255], i);
  }
  return { w, h, rgba };
}
const at = (w: number, x: number, y: number, k: number) => (y * w + x) * PHOTO_CUE_STRIDE + k;

describe('photo cues', () => {
  it('finds sky above and water below, and keeps a hued object out of both', () => {
    const { w, h, rgba } = seascape(), cues = buildPhotoCues(rgba, w, h);
    expect(cues[at(w, 20, 4, 9)]).toBeGreaterThan(.6);
    expect(cues[at(w, 20, 40, 8)]).toBeGreaterThan(.6);
    expect(cues[at(w, 20, 40, 9)]).toBeLessThan(.2);
    expect(cues[at(w, 48, 34, 8)]).toBeLessThan(.15);
  });
  it('reads the sky as far and the ground plane nearer toward the bottom', () => {
    const { w, h, rgba } = seascape(), cues = buildPhotoCues(rgba, w, h);
    expect(cues[at(w, 20, 4, 1)]).toBeLessThan(cues[at(w, 20, 44, 1)]);
  });
  it('drift moves water and sky but holds the subject still', () => {
    const { w, h, rgba } = seascape(), cues = buildPhotoCues(rgba, w, h), out: number[] = [];
    const moved = (x: number, y: number) => { sampleAmbient('current', x / w, y / h, 2, out, .5, cues, at(w, x, y, 0)); return Math.hypot(out[0], out[1]); };
    expect(moved(20, 40)).toBeGreaterThan(.4);
    expect(moved(48, 34)).toBeLessThan(.01);
    sampleAmbient('current', .2, .8, 0, out, .5, cues, at(w, 20, 40, 0)).forEach((v, i) => expect(v).toBeCloseTo(i === 3 ? 1 : 0, 6));
  });
  it('packs water and sky for drift instead of glow and detail', () => {
    const { w, h, rgba } = seascape(), cues = buildPhotoCues(rgba, w, h);
    const drift = packPhotoCues(cues, undefined, true), light = packPhotoCues(cues);
    const i = 40 * w + 20;
    expect(drift[i * 4 + 2]).toBe(Math.round(cues[i * PHOTO_CUE_STRIDE + 8] * 255));
    expect(light[i * 4 + 2]).toBe(Math.round(cues[i * PHOTO_CUE_STRIDE + 2] * 255));
  });
  it('analyses a large grid on a smaller one without changing the result shape', () => {
    const w = 200, h = 100, rgba = new Uint8ClampedArray(w * h * 4).fill(128);
    const cues = buildPhotoCues(rgba, w, h);
    expect(cues.length).toBe(w * h * PHOTO_CUE_STRIDE);
    expect(cues.every(Number.isFinite)).toBe(true);
  });
});

// Dark, rough cliffs either side of a bright, churning, vertically streaked fall; a smooth pale column beside it.
function gorge() {
  const w = 96, h = 64, rgba = new Uint8ClampedArray(w * h * 4);
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, fall = Math.abs(x - 48) < 5, column = Math.abs(x - 16) < 3;
    const v = fall ? 190 + Math.sin(x * 2.7) * 30 + (rand() - .5) * 70 : column ? 205 : 40 + rand() * 50;
    rgba.set(fall || column ? [v, v, v * .97, 255] : [v * .7, v, v * .6, 255], i);
  }
  return { w, h, rgba };
}
describe('falling water', () => {
  it('finds a churning fall but not a smooth column, and moves only the fall', () => {
    const { w, h, rgba } = gorge(), cues = buildPhotoCues(rgba, w, h), out: number[] = [];
    expect(cues[at(w, 48, 32, 10)]).toBeGreaterThan(.5);
    expect(cues[at(w, 16, 32, 10)]).toBeLessThan(.1);
    expect(Math.abs(sampleAmbient('current', 48 / w, .5, 2, out, .8, cues, at(w, 48, 32, 0))[1])).toBeGreaterThan(.3);
    expect(Math.hypot(...sampleAmbient('current', 16 / w, .5, 2, out, .8, cues, at(w, 16, 32, 0)).slice(0, 2))).toBeLessThan(.01);
  });
  it('packs falling water above one half of the drift alpha channel, sky below it', () => {
    const { w, h, rgba } = gorge(), cues = buildPhotoCues(rgba, w, h), packed = packPhotoCues(cues, undefined, true);
    expect(packed[(32 * w + 48) * 4 + 3]).toBeGreaterThan(128);
  });
});
