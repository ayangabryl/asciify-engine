import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { normalizeStudioProject } from './project-model';
import { loadStudioProjectSources } from './project-media';
const {load,text}=vi.hoisted(()=>({load:vi.fn(),text:vi.fn()}));
vi.mock('./media',()=>({loadStudioMedia:load}));
vi.mock('./text',()=>({createStudioText:text}));
beforeEach(()=>vi.clearAllMocks());
afterEach(()=>vi.unstubAllGlobals());
const project=()=>normalizeStudioProject({layers:[{id:'photo',source:'shared'},{id:'copy',source:'shared'}]});
it('resolves shared references once and owns a transparent text source separately',async()=>{
  const asset={destroy:vi.fn()},canvas={width:80,height:20};
  load.mockResolvedValue(asset);text.mockResolvedValue({canvas});
  const media=await loadStudioProjectSources(project(),{shared:'image.webp',title:{text:'HELLO',font:'Small'}});
  expect(load).toHaveBeenCalledTimes(1);expect(media.get('shared')).toBe(asset);
  expect(text).toHaveBeenCalledWith('HELLO','Small','#ffffff',null);
  const title=media.get('title')!;expect(title.frame(0)).toBe(canvas);expect(title.animated).toBe(false);
  title.destroy();expect(canvas).toEqual({width:1,height:1});
});
it('rejects incomplete/excess bindings before allocating media',async()=>{
  await expect(loadStudioProjectSources(project(),{})).rejects.toThrow(/Missing project source/);
  await expect(loadStudioProjectSources(project(),Object.fromEntries(Array.from({length:9},(_,i)=>[String(i),'url'])))).rejects.toThrow(/8 media/);
  expect(load).not.toHaveBeenCalled();
});
it('releases all successfully loaded sources if a later source fails or is invalid',async()=>{
  const asset={destroy:vi.fn()};load.mockResolvedValueOnce(asset).mockRejectedValueOnce(new Error('decode'));
  await expect(loadStudioProjectSources(project(),{shared:'good',bad:'bad'})).rejects.toThrow('decode');expect(asset.destroy).toHaveBeenCalledOnce();
  load.mockResolvedValueOnce(asset);
  await expect(loadStudioProjectSources(project(),{shared:'good',bad:42 as never})).rejects.toThrow('Invalid project source');
  expect(asset.destroy).toHaveBeenCalledTimes(2);
});
it('cancels between asynchronous loads and disposes the just-completed source',async()=>{
  const controller=new AbortController(),asset={destroy:vi.fn()};
  load.mockImplementation(async()=>{controller.abort();return asset;});
  await expect(loadStudioProjectSources(project(),{shared:'one',two:'two'},controller.signal)).rejects.toMatchObject({name:'AbortError'});
  expect(load).toHaveBeenCalledOnce();expect(asset.destroy).toHaveBeenCalledOnce();
});
it('passes File objects through instead of confusing File.text with a text descriptor',async()=>{
  class FakeFile {text(){return Promise.resolve('content');}}
  vi.stubGlobal('File',FakeFile);const file=new FakeFile() as unknown as File;
  load.mockResolvedValue({});await loadStudioProjectSources(project(),{shared:file});
  expect(load).toHaveBeenCalledWith(file,undefined);expect(text).not.toHaveBeenCalled();
});
