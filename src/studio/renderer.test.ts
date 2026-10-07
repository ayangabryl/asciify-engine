import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createStudioRenderer } from './renderer';
import { STUDIO_STYLES } from './model';
import { ditherPixels } from './dither';
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
    fill: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(),
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

it.each(STUDIO_STYLES)('renders %s through the common composition pipeline without an unsupported-style exception', style => {
  const renderer=createStudioRenderer(canvas(),{style, dither:{algorithm:'bayer4'}});
  renderer.render(canvas(),0,32,24);
  expect(contexts[0].drawImage).toHaveBeenCalled();
  if(style==='hex') expect(contexts.some(c=>c.lineTo.mock.calls.length>0)).toBe(true);
  if(style==='led'||style==='cmyk') expect(contexts.some(c=>c.arc.mock.calls.length>0)).toBe(true);
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
