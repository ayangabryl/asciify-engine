import {describe,it,expect} from 'vitest';
import {ContourField} from './contour-field';
import {WaterSurface} from './water-surface';

describe('contour and dissolve studio interactions',()=>{
  it('sends a ring outward, leaves its center quiet, and fully settles',()=>{
    const f=new ContourField(96,96);f.move(.5,.5,.2);
    for(let i=0;i<6;i++)f.step(1/60);
    expect(f.sample(.535,.5)).toBeGreaterThan(f.sample(.5,.5));
    const before=f.pixels.slice();for(let i=0;i<12;i++)f.step(1/60);
    expect(f.pixels).not.toEqual(before);expect(f.sample(.575,.5)).toBeGreaterThan(f.sample(.51,.5));
    f.leave();for(let i=0;i<300;i++)f.step(1/60);
    expect(f.active).toBe(false);expect(f.pixels.every(v=>v===0)).toBe(true);
  });
  it.each(['contour','dissolve'] as const)('%s leaves geometry fixed at maximum strength and radius',mode=>{
    const f=new WaterSurface(1.6);f.configure(mode,1,1);f.move(.5,.5);
    for(let i=0;i<20;i++)f.step(1/60);
    for(const x of [0,.1,.5,.9,1])for(const y of [0,.1,.5,.9,1]) {
      const out=[0,0,0];f.sample(x,y,out);expect(out.slice(0,2)).toEqual([0,0]);expect(out.every(Number.isFinite)).toBe(true);
    }
    expect(f.refraction.strength).toBe(0);expect(f.refraction.pixels.some(v=>v>0)).toBe(true);
    f.leave();for(let i=0;i<300;i++)f.step(1/60);expect(f.active).toBe(false);
  });
  it('dissolves density rather than adding bright ink, then restores it',()=>{
    const f=new WaterSurface();f.configure('dissolve',1,.2);f.move(.5,.5);for(let i=0;i<30;i++)f.step(1/60);
    const a=[0,0,0];f.sample(.5,.5,a);expect(a[2]).toBeLessThan(-1);
    f.leave();for(let i=0;i<300;i++)f.step(1/60);f.sample(.5,.5,a);expect(a[2]).toBeCloseTo(0,8);
  });
});
