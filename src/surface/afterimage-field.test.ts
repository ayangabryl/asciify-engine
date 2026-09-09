import {describe,it,expect} from 'vitest';
import {AfterimageField} from './afterimage-field';
import {WaterSurface} from './water-surface';
const sample=(f:AfterimageField,x:number,y:number)=>{const v=[0,0,0];f.sample(x,y,v);return v;};
describe('decaying cursor memory',()=>{
  it('retains a dissolving tail at older positions without moving or advecting the grid',()=>{
    const f=new AfterimageField(128,72);f.move(.2,.5,.2);for(let i=0;i<20;i++){f.move(.2+i*.025,.5,.2);f.step(1/60);}
    const old=sample(f,.3,.5),head=sample(f,.65,.5);expect(old[2]).toBeLessThan(-.5);expect(head[2]).toBeLessThan(old[2]);expect(old.slice(0,2)).toEqual([0,0]);
    f.leave();for(let i=0;i<30;i++)f.step(1/60);expect(sample(f,.3,.5)[2]).toBeGreaterThan(old[2]);expect(sample(f,.3,.5)[2]).toBeLessThan(0);
    for(let i=0;i<300;i++)f.step(1/60);expect(f.active).toBe(false);expect(f.pixels.every(v=>v===0)).toBe(true);
  });
  it.each(['silk','vortex'] as const)('%s remembers travel, restores its surface and pins every outer edge',mode=>{
    const f=new AfterimageField(128,72);f.setMode(mode);f.edgeSafe=true;f.move(.2,.5,1);expect(f.active).toBe(false);
    f.move(.8,.5,1);for(let i=0;i<8;i++)f.step(1/60);
    expect(Math.abs(sample(f,.5,.56)[0])+Math.abs(sample(f,.5,.56)[1])).toBeGreaterThan(.001);
    for(const t of [0,.1,.5,.9,1])for(const [x,y] of [[0,t],[1,t],[t,0],[t,1]])expect(sample(f,x,y).slice(0,2).map(Math.abs)).toEqual([0,0]);
    f.leave();const before=f.pixels.slice();f.step(.05);expect(f.pixels).not.toEqual(before);
    for(let i=0;i<300;i++)f.step(1/60);expect(f.active).toBe(false);expect(f.pixels[0]).toBe(128);
  });
  it('keeps maximum rapid reversal input finite and bounded, with distinct fold and rotation fields',()=>{
    const results=[];
    for(const mode of ['silk','vortex'] as const){const f=new WaterSurface(1.6);f.configure(mode,1,1);for(let i=0;i<180;i++){f.move(.5+Math.sin(i*.7)*.5,.5+Math.cos(i*.5)*.5);f.step(1/60);}const v=[0,0,0];f.sample(.6,.6,v);expect(v.every(Number.isFinite)).toBe(true);expect(Math.abs(v[0])).toBeLessThanOrEqual(.08);expect(Math.abs(v[1])).toBeLessThanOrEqual(.08);results.push([...f.refraction.pixels]);}
    expect(results[0]).not.toEqual(results[1]);
  });
});
