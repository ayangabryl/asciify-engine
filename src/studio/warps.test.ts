import { describe,expect,it } from 'vitest';
import { normalizeStudioWarps,SourceWarpProcessor,STUDIO_WARPS } from './warps';
import { normalizeStudioSettings,parseStudioSettings,serializeStudioSettings,updateStudioSettings } from './model';

const ramp=(w:number,h:number)=>{
  const pixels=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)pixels.set([x/(w-1)*255,y/(h-1)*255,(x+y)%2?70:180,255],(y*w+x)*4);
  return pixels;
};
describe('reusable source warp stacks',()=>{
  it('keeps identity byte-exact with no defaults, disabled stages or zero strengths',()=>{
    const pixels=ramp(24,16);
    for(const input of [[],[{type:'twirl',amount:0}],[{type:'polar',enabled:false}]]) {
      const processor=new SourceWarpProcessor(input);
      expect(processor.active).toBe(false);expect(processor.apply(pixels,24,16)).toBe(pixels);
    }
    expect(normalizeStudioSettings().warps).toEqual([]);
  });
  it('bounds imported state, rejects unknown transforms and round-trips independent settings',()=>{
    const warps=normalizeStudioWarps([null,{type:'unknown'},...Array.from({length:30},()=>({type:'twirl',x:NaN,y:2,radius:100,amount:-5,frequency:Infinity,angle:-800}))]);
    expect(warps.length).toBe(8);
    expect(warps[0]).toEqual({type:'twirl',enabled:true,x:.5,y:1,radius:2,amount:-1,frequency:5,angle:-180});
    const settings=normalizeStudioSettings({warps,warpEdge:'transparent'});
    expect(parseStudioSettings(serializeStudioSettings(settings))).toEqual(settings);
    const next=updateStudioSettings(settings,{warps:[{type:'ripple',frequency:8}]});
    expect(next.warps?.length).toBe(1);expect(settings.warps?.length).toBe(8);
    next.warps![0].amount=.7;expect(settings.warps![0].amount).toBe(-1);
    expect(normalizeStudioSettings({warpEdge:'nope'}).warpEdge).toBe('clamp');
  });
  it.each(STUDIO_WARPS)('$label changes the source locally and leaves pixels outside its region intact',({value})=>{
    const pixels=ramp(65,65),processor=new SourceWarpProcessor([{type:value,amount:.8,radius:.35}]);
    const out=processor.apply(pixels,65,65);
    expect(out).not.toEqual(pixels);
    for(let y=0;y<65;y++)for(let x=0;x<65;x++) {
      const r=Math.hypot((x+.5)/65-.5,(y+.5)/65-.5);
      if(r>.36)expect(out.slice((y*65+x)*4,(y*65+x)*4+4)).toEqual(pixels.slice((y*65+x)*4,(y*65+x)*4+4));
    }
  });
  it('has distinguishable transform mechanisms and strength signs',()=>{
    const pixels=ramp(61,47),outputs=STUDIO_WARPS.map(({value})=>
      new SourceWarpProcessor([{type:value,amount:.65,angle:30,radius:.7}]).apply(pixels,61,47).slice());
    for(let a=0;a<outputs.length;a++)for(let b=0;b<a;b++)expect(outputs[a]).not.toEqual(outputs[b]);
    for(const {value} of STUDIO_WARPS) {
      const positive=new SourceWarpProcessor([{type:value,amount:.5}]).apply(pixels,61,47);
      const negative=new SourceWarpProcessor([{type:value,amount:-.5}]).apply(pixels,61,47);
      expect(positive).not.toEqual(negative);
    }
  });
  it('applies list order rather than treating a stack as interchangeable independent effects',()=>{
    const pixels=ramp(55,39),twirl={type:'twirl',amount:.55,x:.45,radius:.8},shear={type:'shear',amount:.6,angle:20,radius:.8};
    const a=new SourceWarpProcessor([twirl,shear]).apply(pixels,55,39),b=new SourceWarpProcessor([shear,twirl]).apply(pixels,55,39);
    expect(a).not.toEqual(b);
    // A full rotation's inverse is also smooth at the boundary; order is tested numerically, not visually.
    const first=new SourceWarpProcessor([{type:'twirl',amount:.3,radius:.8}]);
    const cancel=new SourceWarpProcessor([{type:'twirl',amount:.3,radius:.8},{type:'twirl',amount:-.3,radius:.8}]);
    expect(first.apply(pixels,55,39)).not.toEqual(pixels);
    expect(cancel.apply(pixels,55,39)).toEqual(pixels);
  });
  it('reuses output/maps, resets cleanly and does not corrupt input or retained pixels',()=>{
    const pixels=ramp(24,16),copy=pixels.slice(),processor=new SourceWarpProcessor([{type:'twirl'}]);
    const out=processor.apply(pixels,24,16),first=out.slice();
    expect(processor.apply(pixels,24,16)).toBe(out);expect(out).toEqual(first);expect(pixels).toEqual(copy);
    processor.configure([{type:'twirl',amount:-.8}]);expect(processor.apply(pixels,24,16)).not.toEqual(first);
    processor.configure([]);expect(processor.apply(pixels,24,16)).toBe(pixels);
    processor.configure([{type:'twirl'}]);expect(processor.apply(pixels,24,16)).toEqual(first);
    expect(()=>processor.apply(pixels,0,16)).toThrow(/dimensions/);
    expect(()=>processor.apply(pixels,24,16,NaN)).toThrow(/dimensions/);
  });
  it('preserves an aspect-correct circular region on portrait and landscape grids',()=>{
    const w=65,h=33,source=ramp(w,h),transposed=new Uint8ClampedArray(source.length);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)transposed.set(source.slice((y*w+x)*4,(y*w+x)*4+4),(x*h+y)*4);
    const wide=new SourceWarpProcessor([{type:'pinch',amount:.6,radius:.8}]).apply(source,w,h,w/h);
    const tall=new SourceWarpProcessor([{type:'pinch',amount:.6,radius:.8}]).apply(transposed,h,w,h/w);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)expect(tall.slice((x*h+y)*4,(x*h+y)*4+4)).toEqual(wide.slice((y*w+x)*4,(y*w+x)*4+4));
  });
  it('provides transparent edges while keeping partial-alpha color clean',()=>{
    const width=32,height=24,pixels=new Uint8ClampedArray(width*height*4);
    for(let i=0;i<pixels.length;i+=4)pixels.set([40,120,200,255],i);
    const input=[{type:'smudge',amount:1,x:0,y:.5,radius:2}];
    const clamp=new SourceWarpProcessor(input).apply(pixels,width,height),transparent=new SourceWarpProcessor(input,'transparent').apply(pixels,width,height);
    expect(clamp).toEqual(pixels);expect(transparent).not.toEqual(clamp);
    let partial=0,empty=0;
    for(let i=0;i<transparent.length;i+=4) {
      if(transparent[i+3])expect([...transparent.slice(i,i+3)]).toEqual([40,120,200]);
      if(transparent[i+3]>0&&transparent[i+3]<255)partial++;
      if(!transparent[i+3])empty++;
    }
    expect(partial).toBeGreaterThan(0);expect(empty).toBeGreaterThan(0);
  });
  it('handles maximum stacks, extreme controls, one-pixel grids and repeated size changes',()=>{
    for(const amount of [-1,1]) for(const edge of ['clamp','transparent'] as const) {
      const stack=STUDIO_WARPS.slice(0,8).map(({value},i)=>({type:value,amount,x:i%2,y:(i+1)%2,radius:i%2?.05:2,angle:180,frequency:24}));
      const processor=new SourceWarpProcessor(stack,edge);
      for(const [w,h] of [[1,1],[1,15],[15,1],[77,43],[43,77]]) {
        const source=new Uint8ClampedArray(w*h*4).fill(120),out=processor.apply(source,w,h,w/h);
        expect(out.length).toBe(source.length);
        expect([...out].every(Number.isFinite)).toBe(true);
      }
    }
  });
});
