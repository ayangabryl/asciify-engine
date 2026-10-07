import { SURFACE_HOVERS } from '../surface/hover-catalog';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createStudioRenderer } from './renderer';
import { STUDIO_STYLES } from './model';
import { MOTION_STYLES } from '../surface/ambient-motion';
import { ditherPixels } from './dither';
import { SourceDenoiser } from './denoise';
import { SourceWarpProcessor, STUDIO_WARPS } from './warps';
vi.mock('./dither', async importOriginal => {
  const actual = await importOriginal<typeof import('./dither')>();
  return {...actual, ditherPixels: vi.fn(actual.ditherPixels)};
});
vi.mock('./finish', () => ({createStudioFinish: () => null}));

const contexts: ReturnType<typeof makeContext>[] = [];
function makeContext() {
  return {
    clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
    drawImage: vi.fn(), fillText: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(),
    fill: vi.fn(), stroke: vi.fn(), rect: vi.fn(), ellipse: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(),
    createLinearGradient: () => ({addColorStop: vi.fn()}),
    createRadialGradient: () => ({addColorStop: vi.fn()}),
    getImageData: vi.fn((_x:number,_y:number,w:number,h:number) => {
      const data = new Uint8ClampedArray(w*h*4);
      for(let i=0;i<data.length;i+=4) { data[i]=90;data[i+1]=140;data[i+2]=190;data[i+3]=255; }
      return {data};
    }),
    putImageData: vi.fn(),
  };
}
function canvas() {
  const ctx = makeContext(); contexts.push(ctx);
  return {width:32,height:24,dataset:{},getContext:()=>ctx} as unknown as HTMLCanvasElement;
}
beforeEach(() => {
  contexts.length=0;
  vi.clearAllMocks();
  vi.stubGlobal('document', {createElement:canvas});
  vi.stubGlobal('ImageData', class { constructor(public data:Uint8ClampedArray,public width:number,public height:number) {} });
});
afterEach(() => vi.unstubAllGlobals());

it.each(STUDIO_STYLES)('applies channel curves before %s and restores them without contaminating the source', style => {
  const renderer=createStudioRenderer(canvas(),{style,color:{curves:{red:[[0,1],[1,0]]},denoise:1}});
  const source=canvas(), sample=contexts[2];
  renderer.render(source,0,32,24);
  expect([...sample.getImageData.mock.results[0].value.data.slice(0,4)]).toEqual([165,140,190,255]);
  renderer.configure({style});renderer.render(source,1,32,24);
  expect([...sample.getImageData.mock.results[1].value.data.slice(0,4)]).toEqual([90,140,190,255]);
  renderer.destroy();
});
it('caches source filtering across lively motion and hover, invalidating only on source/configuration changes', () => {
  const filtering=vi.spyOn(SourceDenoiser.prototype,'apply');
  const renderer=createStudioRenderer(canvas(),{color:{denoise:1},motion:{type:'parallax'}});
  const source=canvas();
  renderer.render(source,0,32,24);renderer.render(source,.1,32,24);
  renderer.pointer(.5,.5,120);renderer.render(source,.15,32,24);
  expect(filtering).toHaveBeenCalledTimes(1);
  renderer.configure({color:{denoise:.5},motion:{type:'sheen'}});renderer.render(source,.2,32,24);
  expect(filtering).toHaveBeenCalledTimes(2);
  renderer.invalidate();renderer.render(source,.3,32,24);
  expect(filtering).toHaveBeenCalledTimes(3);
  renderer.destroy();filtering.mockRestore();
});
it.each(STUDIO_STYLES)('warps the sampled source before %s, caches during interactions, and clears on reset', style=>{
  const processing=vi.spyOn(SourceWarpProcessor.prototype,'apply');
  const renderer=createStudioRenderer(canvas(),{style,warps:[{type:'twirl',amount:.7}],motion:{type:'current'}});
  const source=canvas(),sample=contexts[2];
  sample.getImageData.mockImplementation((_x,_y,w,h)=>{
    const data=new Uint8ClampedArray(w*h*4);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)data.set([x/w*255,y/h*255,(x+y)%2*255,255],(y*w+x)*4);
    return {data};
  });
  renderer.render(source,0,64,48);renderer.render(source,1,64,48);
  expect(processing).toHaveBeenCalledTimes(1);
  const input=processing.mock.calls[0][0],result=processing.mock.results[0].value;
  expect(result).not.toEqual(input);
  renderer.configure({style});renderer.render(source,2,64,48);
  expect(processing.mock.results[1].value).toBe(processing.mock.calls[1][0]);
  renderer.destroy();processing.mockRestore();
});
it('dither motion interpolates alpha and keeps hidden transparent RGB out of visible edges',()=>{
  // Inspect the resampling boundary before palette quantization changes RGB in place.
  vi.mocked(ditherPixels).mockImplementationOnce(()=>{});
  const renderer=createStudioRenderer(canvas(),{style:'dither',dither:{amount:0,scale:1},motion:{type:'current',amount:2}}, {maxCells:12000});
  const source=canvas(),sample=contexts[2];
  sample.getImageData.mockImplementation((_x,_y,w,h)=>{
    const data=new Uint8ClampedArray(w*h*4);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)data.set(x<w/2?[20,80,200,255]:[255,0,30,0],(y*w+x)*4);
    return {data};
  });
  renderer.render(source,2,40,24);
  const data=vi.mocked(ditherPixels).mock.calls.at(-1)![0];
  let partial=0;
  for(let i=0;i<data.length;i+=4)if(data[i+3]>0&&data[i+3]<255) {
    partial++;expect([...data.slice(i,i+3)]).toEqual([20,80,200]);
  }
  expect(partial).toBeGreaterThan(0);renderer.destroy();
});

it.each(STUDIO_STYLES)('renders %s through the common composition pipeline without an unsupported-style exception', style => {
  const renderer=createStudioRenderer(canvas(),{style, dither:{algorithm:'bayer4'}});
  renderer.render(canvas(),0,32,24);
  expect(contexts[0].drawImage).toHaveBeenCalled();
  if(style==='hex') expect(contexts.some(c=>c.lineTo.mock.calls.length>0)).toBe(true);
  if(style==='led'||style==='cmyk') expect(contexts.some(c=>c.arc.mock.calls.length>0)).toBe(true);
  renderer.destroy();
});
it.each(STUDIO_STYLES)('applies tonal detail before %s sampling and restores it when reset', style => {
  const renderer=createStudioRenderer(canvas(),{style});
  const source=canvas(), sample=contexts[2];
  renderer.render(source,0,32,24);
  expect([...sample.getImageData.mock.results[0].value.data.slice(0,4)]).toEqual([90,140,190,255]);
  renderer.configure({style,color:{gamma:2}});
  renderer.render(source,1,32,24);
  expect([...sample.getImageData.mock.results[1].value.data.slice(0,4)]).toEqual([151,189,220,255]);
  renderer.configure({style});
  renderer.render(source,2,32,24);
  expect([...sample.getImageData.mock.results[2].value.data.slice(0,4)]).toEqual([90,140,190,255]);
  renderer.destroy();
});
it('reuses static dither quantization during post-processing, then invalidates on source/settings changes', () => {
  const renderer=createStudioRenderer(canvas(),{style:'dither',dither:{algorithm:'bayer4'},effects:{grain:.2}});
  const source=canvas();
  renderer.render(source,0,32,24);
  renderer.render(source,1,32,24);
  expect(ditherPixels).toHaveBeenCalledTimes(1);
  renderer.configure({style:'dither',dither:{algorithm:'atkinson'}});
  renderer.render(source,2,32,24);
  expect(ditherPixels).toHaveBeenCalledTimes(2);
  renderer.render(canvas(),3,32,24);
  expect(ditherPixels).toHaveBeenCalledTimes(3);
});
it('recomputes a moving dither pattern instead of reusing a frozen frame', () => {
  const renderer=createStudioRenderer(canvas(),{style:'dither',dither:{algorithm:'bayer4',motion:'drift'}});
  const source=canvas();
  renderer.render(source,0,32,24);
  renderer.render(source,1,32,24);
  expect(ditherPixels).toHaveBeenCalledTimes(2);
});

it.each(STUDIO_STYLES)('caches the complete %s still while post-processing remains time-dependent', style => {
  const renderer=createStudioRenderer(canvas(),{style,effects:{grain:.2},color:{amount:.2},lights:[{x:.5,y:.5,radius:.3,color:'#ffffff',intensity:.2}],mask:{enabled:true,shapes:[{kind:'rectangle',x:0,y:0,width:1,height:1}]}});
  const source=canvas(), art=contexts[3], composite=contexts[4];
  renderer.render(source,0,32,24);
  renderer.render(source,1,32,24);
  expect(art.clearRect).toHaveBeenCalledTimes(1);
  expect(composite.clearRect).toHaveBeenCalledTimes(1);
  expect(contexts[0].drawImage).toHaveBeenCalledTimes(2);
  renderer.invalidate(); renderer.render(source,2,32,24);
  expect(art.clearRect).toHaveBeenCalledTimes(2);
  renderer.configure({style,ink:'#ff0000'}); renderer.render(source,3,32,24);
  expect(art.clearRect).toHaveBeenCalledTimes(3);
  renderer.render(source,4,64,48);
  expect(art.clearRect).toHaveBeenCalledTimes(4);
  renderer.destroy();
});
it('repaints while a hover is active and restores the clean final frame before caching it', () => {
  const renderer=createStudioRenderer(canvas(),{style:'ascii',hover:{effect:'dissolve',strength:1}});
  const source=canvas(), art=contexts[3];
  renderer.render(source,0,32,24);
  renderer.pointer(.5,.5,10);
  renderer.render(source,.02,32,24);
  renderer.leave();
  let time=.02;
  while(renderer.active && time<12) {time+=.05;renderer.render(source,time,32,24);}
  expect(renderer.active).toBe(false);
  const count=art.clearRect.mock.calls.length;
  expect(count).toBeGreaterThan(2);
  renderer.render(source,time+1,32,24);
  expect(art.clearRect).toHaveBeenCalledTimes(count);
  renderer.destroy();
});
it('keeps stationary tonal motion pixel-aligned and treats zero strength as a still', () => {
  const renderer=createStudioRenderer(canvas(),{style:'ascii',cellSize:7,motion:{type:'sheen'}});
  const source=canvas(),art=contexts[3];
  renderer.render(source,0,79,53); renderer.render(source,1,79,53);
  expect(art.clearRect).toHaveBeenCalledTimes(2);
  for(const args of art.drawImage.mock.calls) {
    expect(Number.isInteger(args[5])).toBe(true);expect(Number.isInteger(args[6])).toBe(true);
  }
  renderer.configure({motion:{type:'sheen',amount:0}});
  renderer.render(source,2,79,53); renderer.render(source,3,79,53);
  expect(art.clearRect).toHaveBeenCalledTimes(3);
  renderer.destroy();
});
it.each(['caustics','sheen','grain','dissolve','trail'] as const)('CMYK ink screens respond to %s instead of bypassing the treatment', treatment => {
  const hover=treatment==='dissolve'||treatment==='trail';
  const renderer=createStudioRenderer(canvas(),{style:'cmyk',colorMode:'source',
    motion:{type:hover?'none':treatment},hover:{effect:hover?treatment:'none',strength:1,radius:1}});
  const source=canvas(),art=contexts[3];
  renderer.render(source,0,32,24);
  const first=art.arc.mock.calls.map(c=>c[2]);art.arc.mockClear();
  if(hover) {renderer.pointer(.2,.5,1);renderer.pointer(.8,.5,18);}
  renderer.render(source,2,32,24);
  expect(art.arc.mock.calls.map(c=>c[2])).not.toEqual(first);
  renderer.destroy();
});
it('bounds requested budgets and ignores non-finite values without poisoning the grid', () => {
  const renderer=createStudioRenderer(canvas(),{}, {maxCells:512});
  for(const cells of [NaN,Infinity,-10,Number.MAX_VALUE]) {
    renderer.setBudget(cells);
    expect(renderer.maxCells).toBeGreaterThanOrEqual(256);
    expect(renderer.maxCells).toBeLessThanOrEqual(512);
    renderer.render(canvas(),0,32,24);
  }
  renderer.destroy();
});

// Exercise render-path interactions; this deliberately does not stand in for
// GPU screenshots, visual acceptance or device frame-pacing measurements.
it.each(STUDIO_STYLES)('%s accepts every hover × ambient combination with finite draw commands', style => {
  const hovers=SURFACE_HOVERS.map(effect=>effect.value);
  for(let hi=0;hi<hovers.length;hi++) for(let mi=0;mi<MOTION_STYLES.length;mi++) {
    contexts.length=0;
    const mode=MOTION_STYLES[mi].mode;
    const renderer=createStudioRenderer(canvas(),{style,cellSize:4,
      colorMode:(['source','gray','accent'] as const)[(hi+mi)%3],
      motion:{type:mode,speed:.7,amount:1.2},
      hover:{effect:hovers[hi],strength:1,radius:1,edgeSafe:hi%2===0},
      warps:Array.from({length:(hi+mi)%3},(_,i)=>({type:STUDIO_WARPS[(hi+mi+i)%STUDIO_WARPS.length].value,amount:i?.6:-.4,radius:.7})),
      warpEdge:hi%2?'transparent':'clamp',
      dither:{algorithm:'bayer4',scale:2},
      backdrop:{mode:'gradient',color:'#102030',color2:'#b3ed82'},
      effects:{grain:.2,prism:.15},
    });
    const source=canvas();renderer.render(source,0,32,24);
    renderer.pointer(.2,.5,1);renderer.pointer(.8,.4,18);
    renderer.render(source,.03,32,24);
    expect(contexts[0].drawImage).toHaveBeenCalledTimes(2);
    for(const context of contexts) for(const method of [context.drawImage,context.arc,context.fillRect,context.lineTo]) {
      for(const args of method.mock.calls) for(const value of args) if(typeof value==='number') expect(Number.isFinite(value)).toBe(true);
    }
    renderer.destroy();
  }
});

it.each(MOTION_STYLES.filter(({mode})=>mode!=='none'))('keeps dither visible with $label motion', ({mode}) => {
  const renderer=createStudioRenderer(canvas(),{style:'dither',motion:{type:mode},dither:{algorithm:'bayer4'}});
  renderer.render(canvas(),3,32,24);
  const data=vi.mocked(ditherPixels).mock.calls.at(-1)![0];
  let coverage=0;
  for(let i=3;i<data.length;i+=4)coverage+=data[i];
  expect(coverage).toBeGreaterThan(data.length/4*20);
  renderer.destroy();
});
