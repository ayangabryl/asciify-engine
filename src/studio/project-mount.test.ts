import { beforeEach,afterEach,expect,it,vi } from 'vitest';
import { mountStudioProjectMedia } from './project-mount';
import type { StudioMedia } from './media';
const {create}=vi.hoisted(()=>({create:vi.fn()}));
vi.mock('./project-renderer',()=>({createStudioProjectRenderer:create}));
let queue:Map<number,FrameRequestCallback>,clock:number,listeners:Record<string,(e:unknown)=>void>;
let observe:(entries:{isIntersecting:boolean}[])=>void,visibility:()=>void;
let reduced:{matches:boolean;addEventListener:ReturnType<typeof vi.fn>;removeEventListener:ReturnType<typeof vi.fn>};
let renderer:ReturnType<typeof fakeRenderer>;
class Video {paused=true;loop=false;play=vi.fn(async()=>{this.paused=false;});pause=vi.fn(()=>{this.paused=true;});}
function fakeRenderer(){return {render:vi.fn(),configure:vi.fn(),invalidate:vi.fn(),pointer:vi.fn(),leave:vi.fn(),destroy:vi.fn(),setBudget:vi.fn(),setPixelRatio:vi.fn(),active:false,maxCells:24000,pixelRatio:1,quality:[]};}
function asset(animated=false,source={}):StudioMedia {
  return {source:source as HTMLCanvasElement,width:100,height:100,duration:animated?5:0,animated,frame:vi.fn(()=>source as HTMLCanvasElement),seek:vi.fn(async()=>{}),destroy:vi.fn()};
}
const canvas=()=>({addEventListener:(key:string,fn:(e:unknown)=>void)=>listeners[key]=fn,removeEventListener:vi.fn(),getBoundingClientRect:()=>({left:10,top:20,width:200,height:100})}) as unknown as HTMLCanvasElement;
function advance(ms=17){clock+=ms;const work=[...queue.values()];queue.clear();for(const cb of work)cb(clock);}
beforeEach(()=>{
  vi.clearAllMocks();clock=0;queue=new Map();listeners={};let id=0;renderer=fakeRenderer();create.mockReturnValue(renderer);
  vi.stubGlobal('HTMLVideoElement',Video);vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{queue.set(++id,cb);return id;});
  vi.stubGlobal('cancelAnimationFrame',(id:number)=>queue.delete(id));
  vi.stubGlobal('document',{hidden:false,addEventListener:(_name:string,cb:()=>void)=>visibility=cb,removeEventListener:vi.fn()});
  reduced={matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()};vi.stubGlobal('matchMedia',()=>reduced);
  vi.stubGlobal('IntersectionObserver',class{constructor(cb:typeof observe){observe=cb;}observe(){}disconnect(){}});
});
afterEach(()=>vi.unstubAllGlobals());
it('shares one RAF and one source frame across all visible layers, then sleeps for unchanged stills',()=>{
  const a=asset(),b=asset();const player=mountStudioProjectMedia(canvas(),{layers:[{id:'a',source:'same'},{id:'b',source:'same'},{id:'hidden',source:'b',visible:false}]},new Map([['same',a],['b',b]]));
  expect(queue.size).toBe(1);advance();expect(queue.size).toBe(0);expect(a.frame).toHaveBeenCalledOnce();expect(b.frame).not.toHaveBeenCalled();
  renderer.active=true;listeners.pointermove({clientX:110,clientY:70,timeStamp:18});advance();expect(renderer.pointer).toHaveBeenCalledWith(.5,.5,18);expect(queue.size).toBe(1);
  renderer.active=false;advance();expect(queue.size).toBe(0);player.destroy();
});
it('applies partial layer updates without losing motion or mutating saved project snapshots',()=>{
  const player=mountStudioProjectMedia(canvas(),{layers:[{id:'a',source:'s',settings:{motion:{type:'sheen'}}}]},new Map([['s',asset()]]));
  advance();advance();advance();const before=player.motionTimes.a;
  player.updateLayer('a',{settings:{motion:{speed:2}},placement:{rotation:40}});advance();
  expect(player.motionTimes.a).toBeCloseTo(before);advance();expect(player.motionTimes.a-before).toBeCloseTo(.034);
  const copy=player.project;copy.layers[0].name='changed';expect(player.project.layers[0].name).not.toBe('changed');
  expect(player.project.layers[0].settings.motion.type).toBe('sheen');
  expect(()=>player.update({layers:[{id:'bad',source:'missing'}]})).toThrow(/Missing/);expect(player.project.layers[0].id).toBe('a');player.destroy();
});
it('stops motion while paused, reduced, hidden or outside the viewport; owns media only once',()=>{
  const a=asset(true),signal=new AbortController();const player=mountStudioProjectMedia(canvas(),{layers:[{id:'a',source:'s'}]},new Map([['s',a],['alias',a]]),{signal:signal.signal});
  advance();advance();const t=player.time;player.pause();advance();expect(queue.size).toBe(0);expect(player.time).toBe(t);
  player.pause(false);advance();expect(queue.size).toBe(1);reduced.matches=true;reduced.addEventListener.mock.calls[0][1]();advance();expect(queue.size).toBe(0);expect(player.paused).toBe(true);
  reduced.matches=false;reduced.addEventListener.mock.calls[0][1]();advance();observe([{isIntersecting:false}]);advance();expect(queue.size).toBe(0);
  observe([{isIntersecting:true}]);advance();Reflect.set(document,'hidden',true);visibility();advance();expect(queue.size).toBe(0);
  signal.abort();player.destroy();expect(a.destroy).toHaveBeenCalledOnce();expect(renderer.destroy).toHaveBeenCalledOnce();
});
it('plays only visible videos and pauses a pending play after the layer is hidden',async()=>{
  const video=new Video(),a=asset(true,video),b=asset(true,new Video());let resolve:()=>void=()=>{};
  video.play.mockImplementation(()=>new Promise<void>(r=>resolve=()=>{video.paused=false;r();}));
  const player=mountStudioProjectMedia(canvas(),{layers:[{id:'a',source:'a'}]},new Map([['a',a],['b',b]]));
  expect(video.play).toHaveBeenCalledOnce();expect((b.source as unknown as Video).play).not.toHaveBeenCalled();
  player.updateLayer('a',{visible:false});resolve();await Promise.resolve();expect(video.paused).toBe(true);player.destroy();
});
it('cancels older seeks, applies only the latest position and aborts pending seeks on destroy',async()=>{
  const a=asset();const pending:{resolve:()=>void;signal:AbortSignal}[]=[];
  vi.mocked(a.seek).mockImplementation((_time,signal)=>new Promise((resolve,reject)=>{pending.push({resolve,signal:signal!});signal!.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true});}));
  const player=mountStudioProjectMedia(canvas(),{layers:[{id:'a',source:'s'}]},new Map([['s',a]]));
  const first=player.seek(1).catch(e=>e);const second=player.seek(2);expect(pending[0].signal.aborted).toBe(true);
  pending[1].resolve();await second;expect(player.time).toBe(2);expect((await first).name).toBe('AbortError');
  const third=player.seek(3).catch(e=>e);player.destroy();expect((await third).name).toBe('AbortError');
  await expect(player.seek(0)).rejects.toThrow(/destroyed/);
});
it('reports render/play failures and pauses without a runaway scheduler',async()=>{
  const onError=vi.fn(),a=asset(true);renderer.render.mockImplementation(()=>{throw new Error('render');});
  const player=mountStudioProjectMedia(canvas(),{layers:[{id:'a',source:'s'}]},new Map([['s',a]]),{onError});advance();advance();
  expect(player.paused).toBe(true);expect(onError).toHaveBeenCalledTimes(1);expect(queue.size).toBe(0);player.destroy();
  const video=new Video();video.play.mockRejectedValue(new Error('autoplay'));
  renderer.render.mockReset();const other=mountStudioProjectMedia(canvas(),{layers:[{id:'v',source:'v'}]},new Map([['v',asset(true,video)]]),{onError});
  await Promise.resolve();await Promise.resolve();expect(other.paused).toBe(true);other.destroy();
});
it('keeps invalid fps finite and reduces one shared budget after sustained rendering cost',()=>{
  let stamp=0;const timer=vi.spyOn(performance,'now').mockImplementation(()=>stamp+=20);
  renderer.setBudget.mockImplementation(value=>{renderer.maxCells=value;});const changed=vi.fn();
  const player=mountStudioProjectMedia(canvas(),{layers:[{id:'a',source:'s',settings:{motion:{type:'parallax'}}}]},new Map([['s',asset()]]),{fps:NaN,onQualityChange:changed});
  for(let i=0;i<35;i++)advance();
  expect(renderer.render.mock.calls.length).toBe(35);expect(renderer.setBudget).toHaveBeenCalledWith(19200);
  expect(changed).toHaveBeenCalledWith(19200);player.destroy();timer.mockRestore();
});
it('rejects too many supplied assets before taking ownership',()=>{
  const media=new Map(Array.from({length:9},(_,i)=>[String(i),asset()]));
  expect(()=>mountStudioProjectMedia(canvas(),{},media)).toThrow(/8 media/);
  expect(create).not.toHaveBeenCalled();for(const item of media.values())expect(item.destroy).not.toHaveBeenCalled();
});
