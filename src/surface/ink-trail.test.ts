import { describe, expect, it } from 'vitest';
import { InkTrail, invertTrailTone, flowTrailIndex, sampleFlowGlyph } from './ink-trail';
import { WaterSurface } from './water-surface';

const mass=(f:InkTrail)=>{ let n=0;for(let y=0;y<30;y++)for(let x=0;x<48;x++)n+=f.sample(x/47,y/29);return n; };
describe('advected character wake',()=>{
  it('requires travel, does not build a stationary blob, and retains a wake after exit',()=>{
    const f=new InkTrail(96,60);f.move(.2,.5,.2);for(let i=0;i<20;i++)f.move(.2,.5,.2);
    expect(f.active).toBe(false);
    for(let i=0;i<20;i++){f.move(.2+i*.025,.5,.2);f.step(1/60);}
    f.leave();const before=mass(f),pixels=f.pixels.slice();for(let i=0;i<20;i++)f.step(1/60);
    expect(mass(f)).toBeGreaterThan(0);expect(f.pixels).not.toEqual(pixels);
    // The wake can spread briefly as momentum rolls outward, then dissipates.
    for(let i=0;i<90;i++)f.step(1/60);expect(mass(f)).toBeLessThan(before);
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


describe('Trail density reversal', () => {
  it('opens dense areas, fills sparse ones, and returns exactly to rest', () => {
    for (const tone of [0, .1, .5, .9, 1]) {
      expect(invertTrailTone(tone, 0)).toBe(tone);
      expect(invertTrailTone(tone, .38)).toBeCloseTo(1 - tone);
      expect(invertTrailTone(tone, 1)).toBeCloseTo(1 - tone);
    }
    expect(invertTrailTone(.9, .25)).toBeLessThan(.4);
    expect(invertTrailTone(.1, .25)).toBeGreaterThan(.6);
  });
});


describe('source transport momentum', () => {
  it('coasts after release, remains bounded under reversal, and returns home', () => {
    const trail=new InkTrail(96,60), point=[0,0];
    trail.move(.3,.5,.2);trail.move(.65,.5,.2);trail.step(1/60);
    trail.displacement(.5,.5,point);const first=point[0];
    expect(first).toBeGreaterThan(0);
    trail.leave();for(let i=0;i<6;i++)trail.step(1/60);
    trail.displacement(.5,.5,point);expect(point[0]).toBeGreaterThan(first);
    for(let i=0;i<90;i++) {trail.move(i%2?.2:.8,.5,1);trail.step(1/60);}
    for(let y=0;y<10;y++)for(let x=0;x<10;x++) {
      trail.displacement(x/9,y/9,point);
      for(const value of point){expect(Number.isFinite(value)).toBe(true);expect(Math.abs(value)).toBeLessThanOrEqual(2);}
    }
    trail.leave();for(let i=0;i<600;i++)trail.step(1/60);
    trail.displacement(.5,.5,point);expect(point).toEqual([0,0]);
    expect(trail.active).toBe(false);
  });
});


describe('directional wake input', () => {
  const stroke = (rate: number, seconds = 1) => {
    const field = new InkTrail(96, 60);
    field.move(.2, .5, .2, 0);
    for (let i = 1; i <= rate * seconds; i++) {
      field.move(.2 + .6 * i / (rate * seconds), .5, .2, i / rate * 1000);
      field.step(1 / rate);
    }
    return field;
  };
  it('preserves wake strength across 30, 60 and 120 Hz pointer delivery', () => {
    const reference = mass(stroke(60));
    for (const rate of [30, 120]) expect(Math.abs(mass(stroke(rate)) / reference - 1)).toBeLessThan(.08);
  });
  it('leaves a stronger wake after a fast sweep without clipping into a flat band', () => {
    const fast = stroke(60, .25), slow = stroke(60, 3);
    expect(mass(fast)).toBeGreaterThan(mass(slow) * 2);
    let peak = 0;
    for (let y = 0; y < 60; y++) for (let x = 0; x < 96; x++) peak = Math.max(peak, fast.sample(x / 95, y / 59));
    expect(peak).toBeGreaterThan(.4);
    expect(peak).toBeLessThan(1);
  });
  it('ignores invalid input without poisoning the next stroke', () => {
    const field = new InkTrail(96, 60);
    field.move(NaN, .5, .2, 0); field.move(.2, .5, .2, 0);
    field.move(.8, .5, .2, 500); field.step(1 / 60);
    expect(mass(field)).toBeGreaterThan(0);
    expect(Number.isFinite(mass(field))).toBe(true);
  });
});


describe('fixed-grid source flow', () => {
  it('changes glyph density in both light and dark regions without exceeding the atlas', () => {
    for (const count of [1, 2, 12, 300]) for (const index of [0, (count-1)*.2, count-1]) {
      expect(flowTrailIndex(index,count,0)).toBeCloseTo(index);
      for (let d=0; d<=1; d+=.01) {
        const value=flowTrailIndex(index,count,d);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(count-1);
      }
    }
    expect(flowTrailIndex(0,12,.2)).toBeGreaterThan(5);
    expect(flowTrailIndex(11,12,.5)).toBeLessThan(2);
  });
  it('transports source detail, preserves color/alpha and pins the outer cells', () => {
    const cols=24,rows=20,indices=new Uint8Array(cols*rows*4),colors=new Uint8ClampedArray(cols*rows*4);
    for(let y=0;y<rows;y++)for(let x=0;x<cols;x++) {
      const i=(y*cols+x)*4;indices[i]=x;indices[i+2]=x*10;
      colors.set([28,92,140,255],i);
    }
    const rest=[0,0,0,0,0,0],left=[0,0,0,0,0,0],right=[0,0,0,0,0,0];
    sampleFlowGlyph(indices,colors,cols,rows,12,10,0,1,0,24,rest);
    expect(rest[0]).toBe(12);
    sampleFlowGlyph(indices,colors,cols,rows,12,10,.5,-1,0,24,left);
    sampleFlowGlyph(indices,colors,cols,rows,12,10,.5,1,0,24,right);
    expect(left[1]).toBeGreaterThan(right[1]);
    for(let c=2;c<6;c++)expect(left[c]).toBeCloseTo(rest[c]);
    for(const [x,y] of [[0,10],[1,10],[23,10],[12,0],[12,19]]) {
      sampleFlowGlyph(indices,colors,cols,rows,x,y,1,1,-1,24,left,true);
      expect(left[0]).toBe(x);
      expect(left[1]).toBeCloseTo(x*10/255);
    }
  });
});

it('advances the visible field on every 120 Hz frame', () => {
  const f=new InkTrail(96,60);f.move(.2,.5,.45,0);f.move(.8,.5,.45,120);f.step(1/120);
  const first=f.pixels.slice();expect(first.some(v=>v!==0)).toBe(true);
  f.step(1/120);expect(f.pixels).not.toEqual(first);
});


it('allows boundary glyphs to respond by default and makes protection opt-in', () => {
  const indices=new Uint8Array(24*20*4),colors=new Uint8ClampedArray(24*20*4);
  for(let i=0;i<24*20;i++){indices[i*4]=8;colors[i*4+3]=255;}
  const free=[0,0,0,0,0,0],safe=[0,0,0,0,0,0];
  sampleFlowGlyph(indices,colors,24,20,0,10,.7,1,0,12,free);
  sampleFlowGlyph(indices,colors,24,20,0,10,.7,1,0,12,safe,true);
  expect(free[0]).not.toBe(safe[0]);expect(safe[0]).toBe(8);
  expect(free.every(Number.isFinite)).toBe(true);
});
