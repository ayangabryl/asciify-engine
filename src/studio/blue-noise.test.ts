import { describe, expect, it } from 'vitest';
import { BLUE_NOISE_RANKS as ranks, BLUE_NOISE_SIZE as size } from './blue-noise';
import { ditherPixels } from './dither';
import { normalizeStudioSettings } from './model';

function lowFrequencyPower(values: Uint16Array, fraction: number) {
  const threshold = Math.floor(values.length*fraction);
  let power = 0;
  // Fourier energy around DC. Skip DC itself (mean coverage).
  for(let fy=-4;fy<=4;fy++) for(let fx=-4;fx<=4;fx++) {
    if(!fx&&!fy || fx*fx+fy*fy>16) continue;
    let real=0,imaginary=0;
    for(let y=0;y<size;y++) for(let x=0;x<size;x++) if(values[y*size+x]<threshold) {
      const angle=2*Math.PI*(x*fx+y*fy)/size;
      real+=Math.cos(angle); imaginary+=Math.sin(angle);
    }
    power+=real*real+imaginary*imaginary;
  }
  return power;
}

describe('blue-noise dithering', () => {
  it('contains each threshold exactly once and suppresses low-frequency clumps', () => {
    expect(new Set(ranks).size).toBe(size*size);
    expect(Math.min(...ranks)).toBe(0); expect(Math.max(...ranks)).toBe(size*size-1);
    const shuffled = ranks.slice();
    let seed=9377;
    for(let i=shuffled.length-1;i>0;i--) {
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      const j=seed%(i+1); [shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];
    }
    for(const coverage of [.1,.25,.5,.75,.9])
      expect(lowFrequencyPower(ranks,coverage)).toBeLessThan(lowFrequencyPower(shuffled,coverage)*.2);
  });
  it.each([0,13,26,64,100,128,180,230,255])('preserves flat monochrome tone %i', tone => {
    const data = new Uint8ClampedArray(size*size*4);
    for(let i=0;i<data.length;i+=4) { data[i]=data[i+1]=data[i+2]=tone; data[i+3]=255; }
    ditherPixels(data,size,size,normalizeStudioSettings({dither:{algorithm:'blue-noise',palette:'custom',colors:['#000000','#ffffff']}}).dither);
    let white=0;
    for(let i=0;i<data.length;i+=4) { white+=data[i]===255?1:0; expect(data[i+3]).toBe(255); }
    expect(Math.abs(white/(size*size)-tone/255)).toBeLessThan(1/(size*size));
  });
  it('uses only the chosen palette, preserves alpha, and remains stable with time', () => {
    const input = Uint8ClampedArray.from({length:35*23*4},(_,i)=>i*37%256);
    const options = normalizeStudioSettings({dither:{algorithm:'blue-noise',palette:'custom',colors:['#101030','#b64029','#ebdfb5']}}).dither;
    const first=input.slice(),second=input.slice();
    ditherPixels(first,35,23,options,0); ditherPixels(second,35,23,options,20);
    expect(second).toEqual(first);
    const palette=new Set(['16,16,48','182,64,41','235,223,181']);
    for(let i=0;i<first.length;i+=4) {
      expect(first[i+3]).toBe(input[i+3]);
      if(first[i+3]) expect(palette.has([...first.slice(i,i+3)].join(','))).toBe(true);
    }
  });
  it('supports directional matrix motion and zero-strength nearest quantization', () => {
    const input = new Uint8ClampedArray(size*size*4).fill(128);
    const options = normalizeStudioSettings({dither:{algorithm:'blue-noise',palette:'gray4',motion:'drift',direction:-180}}).dither;
    const still=input.slice(),moved=input.slice();
    ditherPixels(still,size,size,options,0); ditherPixels(moved,size,size,options,1);
    expect(moved).not.toEqual(still);
    const off=input.slice(),nearest=input.slice();
    ditherPixels(off,size,size,{...options,amount:0},1);
    ditherPixels(nearest,size,size,{...options,algorithm:'none'},1);
    expect(off).toEqual(nearest);
  });
});
