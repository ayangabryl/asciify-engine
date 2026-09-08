import { describe, expect, it } from 'vitest';
import { InkTrail } from './ink-trail';
import { WaterSurface } from './water-surface';

const mass=(f:InkTrail)=>{ let n=0;for(let y=0;y<30;y++)for(let x=0;x<48;x++)n+=f.sample(x/47,y/29);return n; };
describe('advected character wake',()=>{
  it('requires travel, does not build a stationary blob, and retains a wake after exit',()=>{
    const f=new InkTrail(96,60);f.move(.2,.5,.2);for(let i=0;i<20;i++)f.move(.2,.5,.2);
    expect(f.active).toBe(false);
    for(let i=0;i<20;i++){f.move(.2+i*.025,.5,.2);f.step(1/60);}
    f.leave();const before=mass(f),pixels=f.pixels.slice();for(let i=0;i<20;i++)f.step(1/60);
    expect(mass(f)).toBeGreaterThan(0);expect(mass(f)).toBeLessThan(before);expect(f.pixels).not.toEqual(pixels);
    for(let i=0;i<360;i++)f.step(1/60);expect(f.active).toBe(false);expect(mass(f)).toBe(0);
  });
  it('remains finite and bounded under repeated maximum strokes and returns to idle',()=>{
    const f=new InkTrail(128,32);
    for(let i=0;i<180;i++){f.move(.5+Math.sin(i)*.5,.5+Math.cos(i)*.5,1);f.step(.05);}
    for(let y=0;y<10;y++)for(let x=0;x<10;x++){const v=f.sample(x/9,y/9);expect(Number.isFinite(v)).toBe(true);expect(v).toBeGreaterThanOrEqual(0);expect(v).toBeLessThanOrEqual(1);}
    f.clear();expect(f.active).toBe(false);expect(f.pixels.every(v=>v===0)).toBe(true);
  });
  it('changes density without moving any cell, including at the edges',()=>{
    const f=new WaterSurface(1.6);f.configure('trail',1,1);f.move(0,.5);f.move(1,.5);f.step(1/60);
    const p=[0,0,0];f.sample(.5,.5,p);expect(p[2]).toBeGreaterThan(0);
    for(const x of [0,.01,.5,.99,1])for(const y of [0,.01,.5,.99,1]){f.sample(x,y,p);expect(p[0]).toBe(0);expect(p[1]).toBe(0);}
    expect(f.refraction.strength).toBe(0);
  });
  it('resets encoded texture when switching between old water, lighting, and trail',()=>{
    const f=new WaterSurface();f.configure('trail');f.move(.2,.5);f.move(.8,.5);f.step(1/60);
    f.configure('light');f.configure('trail');expect(f.active).toBe(false);expect(f.refraction.pixels.every(v=>v===0)).toBe(true);
    f.configure('water');expect(f.refraction.pixels[0]).toBe(128);
  });
});
