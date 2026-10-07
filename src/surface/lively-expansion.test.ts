import { describe, expect, it } from 'vitest';
import { WaterSurface } from './water-surface';
import { AfterimageField } from './afterimage-field';
import { RippleField } from './ripple-field';
import { decodeDensity, densityHoverKind } from './ink-trail';
import { sampleAmbient, isAnchoredMotion } from './ambient-motion';
import { STUDIO_ANIMATION_PRESETS } from './animation-presets';
import { normalizeStudioSettings, serializeStudioSettings, parseStudioSettings } from '../studio/model';

const sample=(f:{sample:(x:number,y:number,out:number[])=>void},x=.5,y=.5)=>{const out=[0,0,0];f.sample(x,y,out);return out;};
describe('lively images and responsive fields',()=>{
  it('magnifies toward the stroke instead of rotating or moving the whole image',()=>{
    const f=new AfterimageField(128,72);f.setMode('lens');f.move(.5,.5,.8);
    for(let i=0;i<8;i++)f.step(1/60);
    expect(sample(f,.46,.5)[0]).toBeLessThan(0);
    expect(sample(f,.54,.5)[0]).toBeGreaterThan(0);
    expect(sample(f,.5,.46)[1]).toBeLessThan(0);
    expect(sample(f,.5,.54)[1]).toBeGreaterThan(0);
    expect(Math.abs(sample(f,.1,.1)[0])).toBeLessThan(.00001);
  });
  it('smudges along the stroke, follows reversals and returns without overshooting',()=>{
    const f=new AfterimageField(128,72);f.setMode('smudge');f.move(.3,.5,.5);f.move(.7,.5,.5);
    const values=[];for(let i=0;i<120;i++){f.step(1/60);values.push(sample(f)[0]);}
    expect(Math.max(...values)).toBeGreaterThan(.003);expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(values.at(-1)).toBeLessThan(Math.max(...values)*.025);
    f.move(.3,.5,.5);f.step(.05);expect(sample(f)[0]).toBeLessThan(0);
  });
  it.each(['lens','smudge'] as const)('%s release is independent of simulation frequency',mode=>{
    const outputs=[30,60,120].map(fps=>{
      const f=new AfterimageField(128,72);f.setMode(mode);f.move(.4,.5,.5);f.move(.6,.5,.5);
      for(let i=0;i<fps/2;i++)f.step(1/fps);return sample(f,.53,.55);
    });
    outputs.forEach(v=>v.forEach((n,i)=>expect(n).toBeCloseTo(outputs[0][i],7)));
  });
  it('rings move outward, alternate light and shadow and preserve signed GPU packing',()=>{
    const f=new RippleField(128,72);f.move(.48,.5,.6,0);f.move(.5,.5,.6,16);f.step(.05);
    const early=sample(f,.5,.5)[2];let low=0,high=0;
    for(let y=0;y<72;y++)for(let x=0;x<128;x++){
      const v=sample(f,x/127,y/71);expect(v.slice(0,2)).toEqual([0,0]);
      low=Math.min(low,v[2]);high=Math.max(high,v[2]);
      expect(decodeDensity(f.pixels,(y*128+x)*4,'ripple',1)).toBeCloseTo(v[2]/3,4);
    }
    expect(low).toBeLessThan(-.02);expect(high).toBeGreaterThan(.1);expect(densityHoverKind('ripple')).toBe(3);
    for(let i=0;i<18;i++)f.step(1/60);
    expect(sample(f,.5,.5)[2]).toBeLessThan(early*.3);
    expect(sample(f,.536,.5)[2]).toBeGreaterThan(sample(f,.5,.5)[2]);
  });
  it('excites stronger rings for a faster stroke along the same distance',()=>{
    const pulse=(ms:number)=>{const f=new RippleField(128,72);f.move(.48,.5,.6,0);f.move(.5,.5,.6,ms);f.step(.05);return sample(f)[2];};
    expect(pulse(8)).toBeGreaterThan(pulse(90)*1.5);
  });
  it.each(['lens','smudge','ripple'] as const)('%s is bounded, edge-safe, size-adjustable and sleeps after leaving',mode=>{
    const coverage=(radius:number)=>{
      const f=new WaterSurface();f.configure(mode,1,radius,true);f.move(.48,.5,0);f.move(.52,.5,16);f.step(.05);
      let sum=0;for(let y=0;y<32;y++)for(let x=0;x<32;x++)sum+=sample(f,x/31,y/31).reduce((n,v)=>n+Math.abs(v),0);return sum;
    };
    expect(coverage(1)).toBeGreaterThan(coverage(.1));
    for(const aspect of [.5,2]){
      const f=new WaterSurface(aspect);f.configure(mode,1,1,true);
      for(let i=0;i<150;i++){f.move(.5+Math.sin(i*.9)*.5,.5+Math.cos(i*.73)*.5,i*16);f.step(1/60);}
      for(const [x,y] of [[0,.5],[1,.5],[.5,0],[.5,1]])sample(f,x,y).forEach(n=>expect(n).toBeCloseTo(0,4));
      for(const n of sample(f,.42,.53))expect(Number.isFinite(n)).toBe(true);
      f.leave();for(let i=0;i<600;i++)f.step(1/60);expect(f.active).toBe(false);
      f.configure(mode,0,1);f.move(.2,.2,0);f.move(.8,.8,16);f.step(.05);expect(f.active).toBe(false);
    }
  });
  it('leaves highlights and geometry intact when relighting shadows; shimmer is tonal, not flicker',()=>{
    for(const mode of ['relight','shimmer'] as const){
      expect(isAnchoredMotion(mode)).toBe(true);
      for(let time=0;time<12;time+=.1)expect(sampleAmbient(mode,.7,.3,time,[],.8).slice(0,2)).toEqual([0,0]);
    }
    expect(sampleAmbient('shimmer',.7,.3,2,[],.1)[2]).toBeCloseTo(0,10);
    const mid=sampleAmbient('relight',.7,.3,2,[],.5)[2];
    expect(Math.abs(mid)).toBeGreaterThan(Math.abs(sampleAmbient('relight',.7,.3,2,[],1)[2]));
  });
  it('gives Unfold a readable hold and independent column timing',()=>{
    sampleAmbient('unfold',.32,.5,0,[]).forEach((v,i)=>expect(v).toBeCloseTo(i===3?1:0,10));
    sampleAmbient('unfold',.32,.5,10,[]).forEach((v,i)=>expect(v).toBeCloseTo(i===3?1:0,10));
    expect(sampleAmbient('unfold',.32,.5,4,[])[3]).toBeLessThan(.5);
    expect(sampleAmbient('unfold',.1,.5,2,[])[3]).not.toBe(sampleAmbient('unfold',.9,.5,2,[])[3]);
  });
  it('round-trips starting combinations without changing media, styling, edge preference or colors',()=>{
    const original=normalizeStudioSettings({style:'dither',ink:'#123456',hover:{edgeSafe:true},dither:{pixelSize:2}});
    for(const preset of STUDIO_ANIMATION_PRESETS){
      const result=normalizeStudioSettings({...original,motion:preset.motion,hover:{...original.hover,...preset.hover}});
      const restored=parseStudioSettings(serializeStudioSettings(result));
      expect(restored.motion).toEqual(preset.motion);expect(restored.hover.effect).toBe(preset.hover.effect);
      expect(restored.hover.edgeSafe).toBe(true);expect(restored.dither).toEqual(original.dither);
      expect(restored.ink).toBe(original.ink);expect(restored.style).toBe(original.style);
    }
  });
});
