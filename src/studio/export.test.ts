import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { exportStudio } from './export';
import { normalizeStudioSettings } from './model';
const {renderer}=vi.hoisted(()=>({renderer:{render:vi.fn(),destroy:vi.fn()}}));
vi.mock('./renderer',()=>({createStudioRenderer:()=>renderer}));
beforeEach(()=>{
  vi.clearAllMocks();
  vi.stubGlobal('document',{createElement:()=>({dataset:{},toBlob:(done:(b:Blob)=>void)=>done(new Blob(['image'],{type:'image/png'}))})});
});
afterEach(()=>vi.unstubAllGlobals());
it('exports the selected still with its displayed phase after live speed edits',async()=>{
  const image={} as HTMLCanvasElement;
  const frame=vi.fn(async()=>image);
  const settings=normalizeStudioSettings({motion:{type:'sheen',speed:2}});
  await exportStudio({frame},settings,{format:'png',width:32,height:24,time:10,motionTime:7.25});
  expect(frame).toHaveBeenCalledWith(10,undefined);
  expect(renderer.render).toHaveBeenCalledWith(image,10,32,24,7.25);
  expect(renderer.destroy).toHaveBeenCalledOnce();
});
it('keeps the renderer default phase for existing export callers',async()=>{
  const image={} as HTMLCanvasElement;
  await exportStudio({frame:()=>image},normalizeStudioSettings(),{format:'png',width:32,height:24,time:2});
  expect(renderer.render).toHaveBeenCalledWith(image,2,32,24,undefined);
});
it.each([NaN,Infinity,-1])('rejects invalid motion time %s before invoking a source',async motionTime=>{
  const frame=vi.fn();
  await expect(exportStudio({frame},normalizeStudioSettings(),{format:'png',width:32,height:24,motionTime})).rejects.toThrow('Motion time');
  expect(frame).not.toHaveBeenCalled();
});
