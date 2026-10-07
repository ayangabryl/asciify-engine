import { expect, it } from 'vitest';
import { samplePixel, samplePixelTransparent } from './sample-pixel';
it('changes tone continuously across a source-cell boundary',()=>{
  const pixels=new Uint8ClampedArray([0,0,0,255,200,100,50,255]);
  const out:number[]=[];
  samplePixel(pixels,2,1,.25,0,out);expect(out).toEqual([50,25,12.5,255]);
  samplePixel(pixels,2,1,.75,0,out);expect(out).toEqual([150,75,37.5,255]);
  samplePixel(pixels,2,1,1,0,out);expect(out).toEqual([200,100,50,255]);
});
it('interpolates transparent virtual edge pixels without spreading hidden colors',()=>{
  const source=new Uint8ClampedArray([40,120,200,255,255,0,0,0]),out:number[]=[];
  samplePixelTransparent(source,2,1,-.25,0,out);expect(out).toEqual([40,120,200,191.25]);
  samplePixelTransparent(source,2,1,-.5,-.5,out);expect(out).toEqual([40,120,200,63.75]);
  samplePixelTransparent(source,2,1,.5,0,out);expect(out).toEqual([40,120,200,127.5]);
  for(const [x,y] of [[-1,0],[2,0],[0,-1],[0,1]]) {
    samplePixelTransparent(source,2,1,x,y,out);expect(out).toEqual([0,0,0,0]);
  }
});
it('preserves transparent-edge color without a dark halo',()=>{
  const pixels=new Uint8ClampedArray([0,0,0,0,200,100,50,255]),out:number[]=[];
  samplePixel(pixels,2,1,.5,0,out);expect(out).toEqual([200,100,50,127.5]);
  samplePixel(pixels,2,1,-5,-2,out);expect(out).toEqual([0,0,0,0]);
  samplePixel(pixels,2,1,5,2,out);expect(out).toEqual([200,100,50,255]);
});
