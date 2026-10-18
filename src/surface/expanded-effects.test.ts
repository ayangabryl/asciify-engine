import { describe, expect, it } from 'vitest';
import { WaterSurface } from './water-surface';
import { AfterimageField } from './afterimage-field';
import { decodeDensity } from './ink-trail';
import { MOTION_STYLES, sampleAmbient } from './ambient-motion';
import { SURFACE_HOVERS } from './hover-catalog';
import { normalizeStudioSettings, parseStudioSettings, serializeStudioSettings } from '../studio/model';

describe('expanded local effects', () => {
  it('keeps the public catalog and saved looks in agreement', () => {
    for (const { value } of SURFACE_HOVERS) {
      const state=normalizeStudioSettings({hover:{effect:value,radius:.73,strength:.81}});
      const restored=parseStudioSettings(serializeStudioSettings(state));
      expect(restored.hover).toEqual(state.hover);
      expect(restored.hover.effect).toBe(value);
    }
    for (const {value} of MOTION_STYLES) {
      const state=normalizeStudioSettings({motion:{type:value,speed:.8,amount:1.2}});
      expect(parseStudioSettings(serializeStudioSettings(state)).motion).toEqual(state.motion);
      expect(state.motion.type).toBe(value);
    }
  });

  it('embosses both light and shadow, with signed GPU data and no displaced cells', () => {
    const f=new WaterSurface();f.configure('etch',1,.5);
    f.move(.5,.5);f.step(1/60);
    let low=0,high=0;
    for(let y=1;y<f.rows-1;y++) for(let x=1;x<f.columns-1;x++) {
      const value=[0,0,0];f.sample(x/(f.columns-1),y/(f.rows-1),value);
      expect(value.slice(0,2)).toEqual([0,0]);
      low=Math.min(low,value[2]);high=Math.max(high,value[2]);
      const gpu=decodeDensity(f.refraction.pixels,(y*f.columns+x)*4,'etch',1);
      expect(gpu).toBeCloseTo(value[2]/3,4);
    }
    expect(low).toBeLessThan(-.1);expect(high).toBeGreaterThan(.1);
    expect(f.refraction.strength).toBe(0);
    f.leave();for(let i=0;i<400;i++)f.step(1/60);
    expect(f.active).toBe(false);
    expect(decodeDensity(f.refraction.pixels,0,'etch',1)).toBe(0);
  });

  it('uses a real restoring spring: displacement crosses rest and decays', () => {
    const f=new AfterimageField(128,72);f.setMode('elastic');f.move(.3,.5,.5);f.move(.7,.5,.5);
    const values:number[]=[];
    // One visible rebound, settled within about 1.5 seconds.
    for(let i=0;i<180;i++){f.step(1/120);const v=[0,0,0];f.sample(.5,.5,v);values.push(v[0]);}
    expect(Math.max(...values)).toBeGreaterThan(.001);
    expect(Math.min(...values)).toBeLessThan(-.0001);
    expect(Math.abs(values.at(-1)!)).toBeLessThan(Math.max(...values)*.02);
  });

  it('settles the spring consistently at 30, 60 and 120 simulation steps per second', () => {
    const values=[30,60,120].map(fps=>{
      const f=new AfterimageField(128,72);f.setMode('elastic');f.move(.45,.5,.5);f.move(.46,.5,.5);
      for(let i=0;i<fps/2;i++)f.step(1/fps);
      const v=[0,0,0];f.sample(.47,.5,v);return v;
    });
    for(const v of values)v.forEach((n,i)=>expect(n).toBeCloseTo(values[0][i],7));
  });

  it.each(['elastic','rake','etch'] as const)('%s respects radius, zero strength and protected edges under rapid input', mode=>{
    const size=(radius:number)=>{
      const f=new WaterSurface(1.6);f.configure(mode,1,radius,true);f.move(.48,.5);f.move(.52,.5);f.step(.025);
      let area=0;
      for(let y=0;y<40;y++)for(let x=0;x<64;x++) {const v=[0,0,0];f.sample(x/63,y/39,v);area+=Math.abs(v[0])+Math.abs(v[1])+Math.abs(v[2]);}
      return area;
    };
    expect(size(1)).toBeGreaterThan(size(.1));
    const f=new WaterSurface(.75);f.configure(mode,1,1,true);
    for(let i=0;i<120;i++){f.move(.5+Math.sin(i*.7)*.5,.5+Math.cos(i*.5)*.5);f.step(1/60);}
    for(const [x,y] of [[0,.5],[1,.5],[.5,0],[.5,1]]){const v=[0,0,0];f.sample(x,y,v);expect(v.every(Number.isFinite)).toBe(true);v.forEach(n=>expect(n).toBeCloseTo(0,5));}
    f.leave();for(let i=0;i<600;i++)f.step(1/60);expect(f.active).toBe(false);
    f.configure(mode,0,1);f.move(.1,.2);f.move(.9,.8);f.step(.016);expect(f.active).toBe(false);
  });

  it('lights the photo’s own relief and highlights, rather than drawing a generic screen-space light', () => {
    const facing=[.6,.5,.5,.5,1,0,.5,.5], away=[.6,.5,.5,.5,-1,0,.5,.5], flat=[.6,.5,.5,.5,0,0,.5,.5];
    expect(sampleAmbient('relight',.5,.5,0,[],.5,facing)[2]).toBeGreaterThan(sampleAmbient('relight',.5,.5,0,[],.5,away)[2]+.2);
    expect(Math.abs(sampleAmbient('relight',.5,.5,0,[],.5,flat)[2])).toBeLessThan(.05);
    const lit=[.8,.5,.9,.5,0,0,.5,.5], dark=[.1,.5,0,.5,0,0,.5,.5];
    expect(sampleAmbient('glow',.5,.5,6,[],.4,lit)[2]).toBeGreaterThan(.08);
    expect(sampleAmbient('glow',.5,.5,6,[],.1,dark)[2]).toBeCloseTo(0,4);
    let peak=0;for(let t=0;t<12;t+=.05)peak=Math.max(peak,sampleAmbient('sheen',.5,.5,t,[],.7,lit)[2]);
    expect(peak).toBeGreaterThan(.2);
    for(let t=0;t<12;t+=.05)expect(sampleAmbient('sheen',.5,.5,t,[],.1,dark)[2]).toBeLessThan(.001);
  });
  it('moves near and far apart for parallax, and pushes toward the subject without leaving the frame', () => {
    const near=[.5,1,0,.5,0,0,.5,.5], far=[.5,0,0,.5,0,0,.5,.5];
    expect(Math.sign(sampleAmbient('parallax',.5,.5,3,[],.5,near)[0])).toBe(-Math.sign(sampleAmbient('parallax',.5,.5,3,[],.5,far)[0]));
    for(const [x,y] of [[0,0],[1,1],[0,1],[.3,.8]]) {
      const a=sampleAmbient('push',x,y,6,[],.5,near);
      expect(Math.abs(x-a[0]/960-.5)).toBeLessThanOrEqual(.5);expect(Math.abs(y-a[1]/960-.5)).toBeLessThanOrEqual(.5);
    }
  });
  it('racks focus between subject and background by pulling tone toward its neighbourhood', () => {
    const near=[.3,1,0,.5,0,0,.5,.5], far=[.3,0,0,.5,0,0,.5,.5];
    expect(sampleAmbient('focus',.5,.5,3,[],.8,far)[2]).toBeLessThan(-.3);
    expect(sampleAmbient('focus',.5,.5,3,[],.8,near)[2]).toBeCloseTo(0,4);
    expect(sampleAmbient('focus',.5,.5,9,[],.8,near)[2]).toBeLessThan(-.3);
  });
});
