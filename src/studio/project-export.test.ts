import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { exportStudioProject } from './project-export';
import { normalizeStudioProject } from './project-model';
const {load,create,renderer}=vi.hoisted(()=>({load:vi.fn(),create:vi.fn(),renderer:{render:vi.fn(),invalidate:vi.fn(),destroy:vi.fn()}}));
vi.mock('./project-media',()=>({loadStudioProjectSources:load}));
vi.mock('./project-renderer',()=>({createStudioProjectRenderer:create}));
const asset=()=>({source:{},frame:vi.fn(()=>({})),seek:vi.fn(async(_time:number,_signal?:AbortSignal)=>{}),destroy:vi.fn(),animated:true});
beforeEach(()=>{
  vi.clearAllMocks();create.mockReturnValue(renderer);
  vi.stubGlobal('document',{createElement:()=>({width:0,height:0,dataset:{},toBlob:(done:(blob:Blob)=>void)=>done(new Blob(['image'],{type:'image/png'}))})});
});
afterEach(()=>vi.unstubAllGlobals());
const project=()=>normalizeStudioProject({layers:[{id:'one',source:'s'},{id:'two',source:'s'},{id:'hidden',source:'hidden',visible:false}]});
it('owns export media independently, seeks each visible source once and retains per-layer phases',async()=>{
  const a=asset(),hidden=asset();load.mockResolvedValue(new Map([['s',a],['hidden',hidden]]));
  await exportStudioProject(project(),{s:'photo',hidden:'hidden'},{format:'png',width:640,height:360,time:3,motionTimes:{one:2,two:1}});
  expect(a.seek).toHaveBeenCalledOnce();expect(a.seek.mock.calls[0][0]).toBe(3);expect(hidden.seek).not.toHaveBeenCalled();
  expect(renderer.render.mock.calls[0].slice(1)).toEqual([3,640,360,{one:2,two:1}]);
  expect(a.destroy).toHaveBeenCalledOnce();expect(hidden.destroy).toHaveBeenCalledOnce();expect(renderer.destroy).toHaveBeenCalledOnce();
});
it('snapshots settings, text and File bindings before asynchronous loading',async()=>{
  class FakeFile {text(){return Promise.resolve('bytes');}}
  vi.stubGlobal('File',FakeFile);const file=new FakeFile() as unknown as File;
  const input=project(),bindings={s:file,hidden:{text:'ORIGINAL'}},a=asset();let resolve:(value:Map<string,ReturnType<typeof asset>>)=>void=()=>{};
  load.mockImplementation(()=>new Promise(r=>resolve=r));
  const pending=exportStudioProject(input,bindings,{format:'png',width:20,height:20});
  input.layers[0].name='changed';bindings.hidden.text='changed';resolve(new Map([['s',a],['hidden',asset()]]));await pending;
  expect(load.mock.calls[0][1].s).toBe(file);expect(load.mock.calls[0][1].hidden.text).toBe('ORIGINAL');
  expect(create.mock.calls[0][1].layers[0].name).not.toBe('changed');
});
it('validates dimensions/phases before loading sources',async()=>{
  await expect(exportStudioProject(project(),{s:'source'},{format:'png',width:0,height:1})).rejects.toThrow(/dimensions/);
  await expect(exportStudioProject(project(),{s:'source'},{format:'png',width:20,height:20,motionTimes:{one:NaN}})).rejects.toThrow(/motion times/);
  expect(load).not.toHaveBeenCalled();
});
it('aborts sibling seeks and releases every asset if one source fails',async()=>{
  const a=asset(),b=asset();a.seek.mockRejectedValue(new Error('decode'));
  let aborted=false;b.seek.mockImplementation((_time,signal)=>new Promise((_resolve,reject)=>signal!.addEventListener('abort',()=>{aborted=true;reject(new DOMException('Cancelled','AbortError'));},{once:true})));
  load.mockResolvedValue(new Map([['s',a],['b',b]]));
  await expect(exportStudioProject({layers:[{id:'a',source:'s'},{id:'b',source:'b'}]},{s:'a',b:'b'},{format:'png',width:20,height:20})).rejects.toThrow('decode');
  expect(aborted).toBe(true);expect(a.destroy).toHaveBeenCalledOnce();expect(b.destroy).toHaveBeenCalledOnce();expect(renderer.destroy).toHaveBeenCalledOnce();
});
it('forwards caller cancellation and never renders after cancellation while seeking',async()=>{
  const a=asset(),controller=new AbortController();a.seek.mockImplementation((_time,signal)=>new Promise((_resolve,reject)=>signal!.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true})));
  load.mockResolvedValue(new Map([['s',a],['hidden',asset()]]));
  const pending=exportStudioProject(project(),{s:'a',hidden:'b'},{format:'png',width:20,height:20,signal:controller.signal});
  await Promise.resolve();controller.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});
  expect(renderer.render).not.toHaveBeenCalled();expect(a.destroy).toHaveBeenCalledOnce();
});
