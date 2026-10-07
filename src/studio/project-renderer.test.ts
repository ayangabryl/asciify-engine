import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { createStudioProjectRenderer } from './project-renderer';
import { normalizeStudioProject, updateStudioProjectLayer } from './project-model';
import type { StudioSource } from './renderer';
const {create}=vi.hoisted(()=>({create:vi.fn()}));
vi.mock('./renderer',()=>({createStudioRenderer:create}));
function context(){return {clearRect:vi.fn(),fillRect:vi.fn(),save:vi.fn(),restore:vi.fn(),translate:vi.fn(),rotate:vi.fn(),scale:vi.fn(),drawImage:vi.fn(),globalAlpha:1,globalCompositeOperation:'source-over',fillStyle:''};}
function canvas(){const ctx=context();return {width:1,height:1,dataset:{},getContext:()=>ctx} as unknown as HTMLCanvasElement;}
function child(canvas:HTMLCanvasElement){return {canvas,render:vi.fn(),configure:vi.fn(),invalidate:vi.fn(),destroy:vi.fn(),setBudget:vi.fn(),setPixelRatio:vi.fn(),pointer:vi.fn(),leave:vi.fn(),active:false};}
const source={width:320,height:240} as StudioSource;
const frames=new Map([['photo',source]]);
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('document',{createElement:canvas});create.mockImplementation(child);});
afterEach(()=>vi.unstubAllGlobals());
it('caches unchanged layers and compositions, invalidating only the changed source or settings',()=>{
  const project=normalizeStudioProject({layers:[{id:'a',source:'photo'},{id:'b',source:'photo'}]});
  const out=canvas(),render=createStudioProjectRenderer(out,project);
  render.render(frames,0);render.render(frames,1);
  const [a,b]=create.mock.results.map(r=>r.value);
  expect(a.render).toHaveBeenCalledTimes(1);expect(b.render).toHaveBeenCalledTimes(1);
  expect(out.getContext('2d')!.clearRect).toHaveBeenCalledTimes(1);
  render.configure(updateStudioProjectLayer(project,'a',{settings:{ink:'#123456'}}));render.render(frames,2);
  expect(a.configure).toHaveBeenCalledTimes(1);expect(a.render).toHaveBeenCalledTimes(2);expect(b.render).toHaveBeenCalledTimes(1);
  render.invalidate('photo');render.render(frames,3);expect(b.render).toHaveBeenCalledTimes(2);
  render.destroy();render.destroy();expect(a.destroy).toHaveBeenCalledTimes(1);expect(b.destroy).toHaveBeenCalledTimes(1);
});
it('preserves ordering, transforms, alpha and blend mode while isolating unchanged layers during animation',()=>{
  const project=normalizeStudioProject({layers:[{id:'base',source:'photo'}, {id:'top',source:'photo',opacity:.5,blend:'multiply',placement:{width:.4,height:.6,rotation:45,flipX:true},settings:{motion:{type:'parallax'}}}]});
  const out=canvas(),ctx=out.getContext('2d')!,draws:unknown[]=[];
  vi.mocked(ctx.drawImage).mockImplementation((...args:unknown[])=>{draws.push({source:args[0],alpha:ctx.globalAlpha,blend:ctx.globalCompositeOperation});});
  const render=createStudioProjectRenderer(out,project);render.render(frames,0);render.render(frames,1);
  const [a,b]=create.mock.results.map(r=>r.value);
  expect(a.render).toHaveBeenCalledTimes(1);expect(b.render).toHaveBeenCalledTimes(2);
  expect(draws.slice(0,2)).toEqual([{source:a.canvas,alpha:1,blend:'source-over'},{source:b.canvas,alpha:.5,blend:'multiply'}]);
  expect(ctx.rotate).toHaveBeenCalledWith(Math.PI/4);expect(ctx.scale).toHaveBeenCalledWith(-1,1);
  expect(a.setBudget.mock.calls.at(-1)[0]+b.setBudget.mock.calls.at(-1)[0]).toBe(24000);
  render.destroy();
});
it('routes pointers to transformed interactive bounds in top or all mode, and releases removed layers',()=>{
  const project=normalizeStudioProject({width:100,height:100,layers:[{id:'base',source:'photo'},{id:'top',source:'photo',placement:{width:.5,height:.5,rotation:90}}]});
  const render=createStudioProjectRenderer(canvas(),project);render.render(frames);
  const [a,b]=create.mock.results.map(r=>r.value);
  render.pointer(.5,.625,1);expect(a.pointer).not.toHaveBeenCalled();expect(b.pointer).toHaveBeenCalledWith(.75,.5,1);
  render.configure({...project,pointerMode:'all'});render.pointer(.5,.625,2);expect(a.pointer).toHaveBeenCalledWith(.5,.625,2);
  render.pointer(2,2,3);expect(b.leave).toHaveBeenCalled();
  render.configure({...project,layers:[project.layers[0]]});expect(b.destroy).toHaveBeenCalledTimes(1);
  render.destroy();
});
it('detects decoded video updates, forwards own phase values, and surfaces GPU fallback',()=>{
  const project=normalizeStudioProject({layers:[{id:'constructor',source:'photo'}]});
  const render=createStudioProjectRenderer(canvas(),project),video={width:100,height:100,currentTime:0} as unknown as StudioSource;
  const sources=new Map([['photo',video]]);render.render(sources,0);
  const c=create.mock.results[0].value;expect(c.render.mock.calls[0][4]).toBeUndefined();
  (video as HTMLVideoElement).currentTime=1;c.canvas.dataset.studioFinish='unavailable';render.render(sources,1,100,100,{constructor:3});
  expect(c.render.mock.calls.at(-1)[4]).toBe(3);expect(render.canvas.dataset.studioFinish).toBe('unavailable');
  render.destroy();
});
it('handles empty projects, source errors and shared budgets without silently drawing partial output',()=>{
  const out=canvas(),render=createStudioProjectRenderer(out);
  expect(render.render(new Map())).toBe(true);expect(render.render(new Map())).toBe(false);
  render.configure({layers:[{id:'a',source:'photo'},{id:'b',source:'missing'}]});
  expect(()=>render.render(frames)).toThrow(/Missing/);expect(create).not.toHaveBeenCalled();
  render.configure({layers:[{id:'a',source:'photo'}]});render.setBudget(1);render.setPixelRatio(2);render.render(frames);
  expect(render.maxCells).toBe(2048);expect(render.quality[0].maxCells).toBe(2048);
  render.destroy();expect(()=>render.render(frames)).toThrow(/destroyed/);
});
it('preserves logical density when the root output and child rasters are both capped',()=>{
  const render=createStudioProjectRenderer(canvas(),{layers:[{id:'a',source:'photo',placement:{width:.5}}]}, {maxDimension:960,pixelRatio:2,maxRasterPixels:65536});
  render.render(frames,0,1920,1080);
  const c=create.mock.results[0].value,budget=render.quality[0];
  expect(c.setPixelRatio).toHaveBeenCalledWith(2*budget.width/(1920*.5));
  expect(render.canvas.width).toBe(960);expect(budget.width*budget.height).toBeLessThanOrEqual(65536);render.destroy();
});
