import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { mountStudioMedia } from './mount';
import type { StudioMedia } from './media';
const {createRenderer}=vi.hoisted(()=>({createRenderer:vi.fn()}));
vi.mock('./renderer',()=>({createStudioRenderer:createRenderer}));
let clock=0;
let queue: Map<number,FrameRequestCallback>;
let listeners: Record<string,EventListener>;
let renderer: ReturnType<typeof fakeRenderer>;
function fakeRenderer(){return {render:vi.fn(),configure:vi.fn(),invalidate:vi.fn(),pointer:vi.fn(),leave:vi.fn(),destroy:vi.fn(),setBudget:vi.fn(),setPixelRatio:vi.fn(),active:false,maxCells:12000};}
function fixture() {
  const canvas={addEventListener:(name:string,cb:EventListener)=>listeners[name]=cb,removeEventListener:vi.fn(),getBoundingClientRect:()=>({left:0,top:0,width:100,height:100})} as unknown as HTMLCanvasElement;
  const source={width:100,height:100} as HTMLCanvasElement;
  const media={source,width:100,height:100,animated:false,duration:0,frame:vi.fn(()=>source),seek:vi.fn(async()=>{}),destroy:vi.fn()} satisfies StudioMedia;
  return {canvas,media};
}
function advance() {clock+=17;const work=[...queue.values()];queue.clear();for(const cb of work) cb(clock);}
beforeEach(()=>{
  clock=0;queue=new Map();listeners={};let id=0;
  renderer=fakeRenderer();createRenderer.mockReturnValue(renderer);
  vi.stubGlobal('HTMLVideoElement',class {});
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{queue.set(++id,callback);return id;});
  vi.stubGlobal('cancelAnimationFrame',(id:number)=>queue.delete(id));
  vi.stubGlobal('document',{hidden:false,addEventListener:vi.fn(),removeEventListener:vi.fn()});
  vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
  vi.stubGlobal('IntersectionObserver',class {observe(){} disconnect(){}});
});
afterEach(()=>vi.unstubAllGlobals());
it('does not keep scheduling frames for hidden dither controls or zero-strength still motion',()=>{
  const {canvas,media}=fixture();
  const player=mountStudioMedia(canvas,media,{settings:{style:'ascii',dither:{motion:'drift'},motion:{type:'sheen',amount:0}}});
  advance();expect(renderer.render).toHaveBeenCalledTimes(1);expect(queue.size).toBe(0);
  player.update({motion:{amount:1}});advance();advance();
  expect(renderer.render).toHaveBeenCalledTimes(3);expect(queue.size).toBe(1);
  player.update({motion:{amount:0}});advance();expect(queue.size).toBe(0);
  player.destroy();
});
it('wakes a still for hover, then stops once its field settles',()=>{
  const {canvas,media}=fixture();const player=mountStudioMedia(canvas,media);
  advance();renderer.active=true;
  listeners.pointermove({clientX:60,clientY:40,timeStamp:18} as unknown as Event);
  advance();expect(renderer.pointer).toHaveBeenCalledWith(.6,.4,18);expect(queue.size).toBe(1);
  renderer.active=false;advance();expect(queue.size).toBe(0);
  player.destroy();
});
it('pauses automatic motion and releases owned media once on abort or repeated destroy',()=>{
  const {canvas,media}=fixture();const controller=new AbortController();
  const player=mountStudioMedia(canvas,media,{settings:{motion:{type:'current'}},signal:controller.signal});
  advance();expect(queue.size).toBe(1);
  player.pause();advance();expect(queue.size).toBe(0);
  player.pause(false);advance();expect(queue.size).toBe(1);
  controller.abort();player.destroy();
  expect(queue.size).toBe(0);expect(media.destroy).toHaveBeenCalledTimes(1);expect(renderer.destroy).toHaveBeenCalledTimes(1);
});
it('exposes the last painted phase for accurate snapshots after a speed edit',()=>{
  const {canvas,media}=fixture();const player=mountStudioMedia(canvas,media,{settings:{motion:{type:'sheen',speed:1}}});
  advance();advance();advance();
  const before=player.motionTime;
  player.update({motion:{speed:2}});advance();
  expect(player.motionTime).toBeCloseTo(before+.034);
  expect(player.motionTime).toBe(renderer.render.mock.lastCall?.[4]);
  expect(player.motionTime).not.toBeCloseTo(player.time*2,5);
  player.destroy();
});
