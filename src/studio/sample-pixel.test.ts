import { expect, it } from 'vitest';
import { samplePixel } from './sample-pixel';
it('changes tone continuously across a source-cell boundary',()=>{
  const pixels=new Uint8ClampedArray([0,0,0,255,200,100,50,255]);
  const out:number[]=[];
  samplePixel(pixels,2,1,.25,0,out);expect(out).toEqual([50,25,12.5,255]);
  samplePixel(pixels,2,1,.75,0,out);expect(out).toEqual([150,75,37.5,255]);
  samplePixel(pixels,2,1,1,0,out);expect(out).toEqual([200,100,50,255]);
});
it('preserves transparent-edge color without a dark halo',()=>{
  const pixels=new Uint8ClampedArray([0,0,0,0,200,100,50,255]),out:number[]=[];
  samplePixel(pixels,2,1,.5,0,out);expect(out).toEqual([200,100,50,127.5]);
  samplePixel(pixels,2,1,-5,-2,out);expect(out).toEqual([0,0,0,0]);
  samplePixel(pixels,2,1,5,2,out);expect(out).toEqual([200,100,50,255]);
});
