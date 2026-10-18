import { describe, expect, it } from 'vitest';
import { AmbientTimeline, sampleAmbient, resolveMotion, printGrain } from './ambient-motion';

describe('living image motion', () => {
  it('keeps pause and speed edits continuous and starts a new selection at its source', () => {
    const clock=new AmbientTimeline();
    expect(clock.update(10,'sheen',1)).toBe(0);
    expect(clock.update(11,'sheen',1)).toBe(1);
    expect(clock.update(11,'sheen',3)).toBe(1);
    expect(clock.update(12,'caustics',3)).toBe(4);
    expect(clock.update(12,'develop',1)).toBe(0);
    expect(clock.update(0,'develop',1)).toBe(0);
  });
  it('pins current edges, moves inside, and returns seamlessly after a full cycle', () => {
    for(const [x,y] of [[0,.5],[1,.5],[.5,0],[.5,1]])sampleAmbient('current',x,y,2,[]).slice(0,2).forEach(v=>expect(v).toBeCloseTo(0,10));
    const a=sampleAmbient('current',.37,.46,2,[]),b=sampleAmbient('current',.37,.46,14,[]);
    expect(Math.abs(a[0])+Math.abs(a[1])).toBeGreaterThan(.1);
    a.forEach((v,i)=>expect(v).toBeCloseTo(b[i],6));
  });
  it('develops back in from the highlights after a readable hold', () => {
    sampleAmbient('develop',.5,.5,0,[],.5).forEach((v,i)=>expect(v).toBeCloseTo(i===3?1:0,10));
    sampleAmbient('develop',.5,.5,6,[],.5).forEach((v,i)=>expect(v).toBeCloseTo(i===3?1:0,10));
    expect(sampleAmbient('develop',.5,.5,8.6,[],.5)[3]).toBeLessThan(.2);
    expect(sampleAmbient('develop',.5,.5,10,[],.9)[3]).toBeGreaterThan(sampleAmbient('develop',.5,.5,10,[],.2)[3]);
  });
  it('keeps light motions anchored and maps retired ids to current ones', () => {
    for(let t=0;t<12;t+=.1){const a=sampleAmbient('sheen',.37,.42,t,[],.8);expect(a.slice(0,2)).toEqual([0,0]);expect(a[2]).toBeGreaterThanOrEqual(0);expect(a[2]).toBeLessThanOrEqual(.45);}
    expect(resolveMotion('caustics')).toBe('sheen');
    expect(resolveMotion('unfold')).toBe('develop');
    expect(resolveMotion('orbit')).toBe('none');
    expect(resolveMotion('toString')).toBe('none');
    expect(resolveMotion('unknown')).toBe('none');
  });
  it('uses a stable spatial grain with balanced threshold coverage', () => {
    let sum=0;const bins=[0,0,0,0];
    for(let y=0;y<128;y++)for(let x=0;x<128;x++){const n=printGrain(x,y);expect(n).toBeGreaterThanOrEqual(0);expect(n).toBeLessThan(1);sum+=n;bins[Math.floor(n*4)]++;}
    expect(sum/16384).toBeCloseTo(.5,2);
    bins.forEach(n=>expect(n/16384).toBeCloseTo(.25,2));
  });
});
