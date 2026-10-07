import { describe, expect, it } from 'vitest';
import { SourceDenoiser } from './denoise';
import { normalizeStudioSettings } from './model';

const image = (width:number,height:number, value:(x:number,y:number)=>number[]) => {
  const data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set(value(x,y),(y*width+x)*4);
  return data;
};
const energy = (data:Uint8ClampedArray,center:number) => {
  let total=0;for(let i=0;i<data.length;i+=4)total+=(data[i]-center)**2;
  return total/(data.length/4);
};
describe('edge-preserving source denoise', () => {
  it('leaves defaults and disabled processing byte-exact', () => {
    const source=image(32,16,(x,y)=>[x*8,y*16,(x+y)*4,(x*y)%256]), before=source.slice();
    const filter=new SourceDenoiser();filter.apply(source,32,16);
    expect(source).toEqual(before);
    filter.configure(1);filter.configure(0);filter.apply(source,32,16);
    expect(source).toEqual(before);
  });
  it('reduces small tonal noise more at full strength while retaining the source mean', () => {
    const source=image(32,32,(x,y)=>{const v=128+((x*37+y*19)%25)-12;return [v,v,v,255];});
    const mild=source.slice(),full=source.slice();
    new SourceDenoiser(.35).apply(mild,32,32);new SourceDenoiser(1).apply(full,32,32);
    expect(energy(mild,128)).toBeLessThan(energy(source,128));
    expect(energy(full,128)).toBeLessThan(energy(mild,128)*.35);
    let sum=0;for(let i=0;i<full.length;i+=4)sum+=full[i];
    expect(sum/(full.length/4)).toBeCloseTo(128,0);
  });
  it('keeps sharp color boundaries even with similar luminance', () => {
    const source=image(24,16,x=>x<12?[180,40,30,255]:[20,120,20,255]), before=source.slice();
    new SourceDenoiser(1).apply(source,24,16);
    expect(source).toEqual(before);
  });
  it('preserves alpha and excludes hidden RGB from partially transparent edges', () => {
    const source=image(5,3,(x,y)=>x<2?[255,0,255,0]:[50,100,150,(y+1)*70]);
    const before=source.slice();new SourceDenoiser(1).apply(source,5,3);
    expect(source).toEqual(before);
  });
  it('does not accumulate history across calls or wrap at row boundaries', () => {
    const filter=new SourceDenoiser(1);
    const source=image(5,3,(x,y)=>[x*30,y*40,90,255]),a=source.slice(),b=source.slice();
    filter.apply(a,5,3);filter.apply(b,5,3);expect(a).toEqual(b);
    for(const [w,h] of [[1,1],[1,4],[4,1]]) {
      const flat=image(w,h,()=>[25,50,75,99]),before=flat.slice();
      filter.apply(flat,w,h);expect(flat).toEqual(before);
    }
    expect(()=>filter.apply(source,0,3)).toThrow(/dimensions/);
  });
  it('bounds malformed settings without enabling the filter by default', () => {
    for(const value of [NaN,Infinity,'1',undefined]) expect(normalizeStudioSettings({color:{denoise:value}}).color.denoise).toBe(0);
    expect(normalizeStudioSettings({color:{denoise:20}}).color.denoise).toBe(1);
    expect(normalizeStudioSettings({color:{denoise:-1}}).color.denoise).toBe(0);
  });
});
