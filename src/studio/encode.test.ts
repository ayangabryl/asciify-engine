import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { encodeStudioFrames } from './encode';
const {video,output,gif,support}=vi.hoisted(()=>({video:{add:vi.fn(),close:vi.fn()},output:{start:vi.fn(),finalize:vi.fn(),cancel:vi.fn(),addVideoTrack:vi.fn(),target:{buffer:new ArrayBuffer(2)}},gif:{writeFrame:vi.fn(),finish:vi.fn(),bytes:()=>new Uint8Array([1])},support:vi.fn()}));
vi.mock('mediabunny',()=>({
  Output:class{constructor(){return output;}},CanvasSource:class{constructor(){return video;}},
  Mp4OutputFormat:class{},WebMOutputFormat:class{},BufferTarget:class{},canEncodeVideo:support,
}));
vi.mock('gifenc',()=>({GIFEncoder:()=>gif,quantize:()=>[[0,0,0]],applyPalette:()=>new Uint8Array([0])}));
let canvas:{width:number;height:number;dataset:Record<string,string>;toBlob:ReturnType<typeof vi.fn>;getContext:()=>unknown};
beforeEach(()=>{
  vi.resetAllMocks();support.mockResolvedValue(true);output.cancel.mockResolvedValue(undefined);
  canvas={width:0,height:0,dataset:{},toBlob:vi.fn((done:(b:Blob|null)=>void)=>done(new Blob(['ok']))),getContext:()=>({getImageData:()=>({data:new Uint8ClampedArray(16)})})};
  vi.stubGlobal('document',{createElement:()=>canvas});
});
afterEach(()=>vi.unstubAllGlobals());
it('encodes fractional duration without inventing a full last frame and releases its canvas',async()=>{
  const draw=vi.fn(async()=>{}),progress=vi.fn();
  const result=await encodeStudioFrames(draw,{format:'mp4',width:2,height:2,duration:.15,fps:10,onProgress:progress});
  expect(draw.mock.calls.map(c=>(c as unknown[])[1])).toEqual([0,.1]);
  expect(video.add.mock.calls[0]).toEqual([0,.1]);expect(video.add.mock.calls[1][1]).toBeCloseTo(.05);
  expect(video.close).toHaveBeenCalledOnce();expect(output.finalize).toHaveBeenCalledOnce();expect(output.cancel).not.toHaveBeenCalled();
  expect(result.type).toBe('video/mp4');expect(progress.mock.calls.at(-1)).toEqual([1]);expect(canvas.width).toBe(1);
});
it('cancels encoder resources and preserves the original error when drawing fails',async()=>{
  output.cancel.mockRejectedValue(new Error('cancel failed'));
  await expect(encodeStudioFrames(async()=>{throw new Error('draw failed');},{format:'webm',width:2,height:2,duration:.1})).rejects.toThrow('draw failed');
  expect(output.cancel).toHaveBeenCalledOnce();expect(output.finalize).not.toHaveBeenCalled();expect(canvas.height).toBe(1);
});
it('does not report completed output if cancellation happens during finalization or toBlob',async()=>{
  const controller=new AbortController(),progress=vi.fn();output.finalize.mockImplementation(async()=>controller.abort());
  await expect(encodeStudioFrames(async()=>{},{format:'mp4',width:2,height:2,duration:.1,fps:1,signal:controller.signal,onProgress:progress})).rejects.toMatchObject({name:'AbortError'});
  expect(output.cancel).toHaveBeenCalledOnce();expect(progress).not.toHaveBeenCalledWith(1);
  const imageController=new AbortController();canvas.toBlob.mockImplementation(done=>{imageController.abort();done(new Blob());});
  await expect(encodeStudioFrames(async()=>{},{format:'png',width:2,height:2,signal:imageController.signal})).rejects.toMatchObject({name:'AbortError'});
});
it('rejects a missing GPU effect rather than silently exporting a different image',async()=>{
  await expect(encodeStudioFrames(async()=>{canvas.dataset.studioFinish='unavailable';},{format:'png',width:2,height:2})).rejects.toThrow(/WebGL/);
  expect(canvas.toBlob).not.toHaveBeenCalled();
});
it('does not start an unavailable codec',async()=>{
  support.mockResolvedValue(false);const draw=vi.fn();
  await expect(encodeStudioFrames(draw,{format:'mp4',width:2,height:2})).rejects.toThrow(/unavailable/);
  expect(draw).not.toHaveBeenCalled();expect(output.start).not.toHaveBeenCalled();
});
it('preserves GIF centisecond timing and skips finalization after progress cancellation',async()=>{
  const controller=new AbortController();
  await expect(encodeStudioFrames(async()=>{},{format:'gif',width:2,height:2,duration:.15,fps:10,signal:controller.signal,onProgress:p=>{if(p>0)controller.abort();}})).rejects.toMatchObject({name:'AbortError'});
  expect(gif.finish).not.toHaveBeenCalled();
  gif.writeFrame.mockClear();await encodeStudioFrames(async()=>{},{format:'gif',width:2,height:2,duration:.15,fps:10});
  expect(gif.writeFrame.mock.calls.map(c=>c[3].delay)).toEqual([100,50]);expect(gif.finish).toHaveBeenCalledOnce();
});
