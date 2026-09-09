import { describe, expect, it } from 'vitest';
import { AmbientTimeline, sampleAmbient, resolveMotion, printGrain } from './ambient-motion';

describe('living image motion', () => {
  it('keeps pause and speed edits continuous and starts a new selection at its source', () => {
    const clock=new AmbientTimeline();
    expect(clock.update(10,'caustics',1)).toBe(0);
    expect(clock.update(11,'caustics',1)).toBe(1);
    expect(clock.update(11,'caustics',3)).toBe(1);
    expect(clock.update(12,'caustics',3)).toBe(4);
    expect(clock.update(12,'reform',1)).toBe(0);
    expect(clock.update(0,'reform',1)).toBe(0);
  });
  it('pins current edges, moves inside, and returns seamlessly after a full cycle', () => {
    for(const [x,y] of [[0,.5],[1,.5],[.5,0],[.5,1]])sampleAmbient('current',x,y,2,[]).slice(0,2).forEach(v=>expect(v).toBeCloseTo(0,10));
    const a=sampleAmbient('current',.37,.46,2,[]),b=sampleAmbient('current',.37,.46,14,[]);
    expect(Math.abs(a[0])+Math.abs(a[1])).toBeGreaterThan(.1);
    a.forEach((v,i)=>expect(v).toBeCloseTo(b[i],6));
  });
  it('holds a readable image, disperses, and reforms with staggered local timing', () => {
    sampleAmbient('reform',.5,.5,0,[]).forEach((v,i)=>expect(v).toBeCloseTo(i===3?1:0,10));
    expect(sampleAmbient('reform',.5,.5,5,[])[3]).toBeLessThan(.3);
    sampleAmbient('reform',.5,.5,10,[]).forEach((v,i)=>expect(v).toBeCloseTo(i===3?1:0,10));
    expect(sampleAmbient('reform',.1,.5,3,[])[3]).toBeLessThan(sampleAmbient('reform',.9,.5,3,[])[3]);
  });
  it('keeps print glyph geometry fixed with a moving light without geometry changes', () => {
    for(let t=0;t<12;t+=.1){const a=sampleAmbient('caustics',.37,.42,t,[]);expect(a.slice(0,2)).toEqual([0,0]);expect(Math.abs(a[2])).toBeLessThanOrEqual(.175);expect(a[3]).toBeGreaterThanOrEqual(.8);}
    expect(resolveMotion('orbit')).toBe('none');
    expect(resolveMotion('unknown')).toBe('none');
  });
  it('uses a stable spatial grain with balanced threshold coverage', () => {
    let sum=0;const bins=[0,0,0,0];
    for(let y=0;y<128;y++)for(let x=0;x<128;x++){const n=printGrain(x,y);expect(n).toBeGreaterThanOrEqual(0);expect(n).toBeLessThan(1);sum+=n;bins[Math.floor(n*4)]++;}
    expect(sum/16384).toBeCloseTo(.5,2);
    bins.forEach(n=>expect(n/16384).toBeCloseTo(.25,2));
  });
});
