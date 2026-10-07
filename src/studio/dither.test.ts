import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { ditherPixels } from './dither';
import { normalizeStudioSettings } from './model';
import reference from './fixtures/dither-4.3.json';

// Captured from 4.3.0 before optimizing: compares actual quantized bytes, including
// alpha, palette membership and propagated diffusion error, not command mocks.
it.each(reference.map((fixture,i) => ({...fixture,id:i})))('preserves 4.3 output for case $id ($options.algorithm)', ({options,sha256}) => {
  const pixels=new Uint8ClampedArray(53*31*4);
  for(let i=0;i<pixels.length;i+=4) {
    pixels[i]=(i*7)%256;pixels[i+1]=(i*19+73)%256;pixels[i+2]=(i*41+139)%256;
    pixels[i+3]=i%23===0?0:(i%3===0?128:255);
  }
  ditherPixels(pixels,53,31,normalizeStudioSettings({dither:options}).dither,4.75);
  expect(createHash('sha256').update(pixels).digest('hex')).toBe(sha256);
});
