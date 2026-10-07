import { describe, expect, it } from 'vitest';
import { createStudioCurveLookup, normalizeStudioCurve, normalizeStudioCurves } from './curves';
import { createColorLookups, applyColorLookups, createToneLookup } from './tone';
import { normalizeStudioSettings, parseStudioSettings, serializeStudioSettings, updateStudioSettings } from './model';

describe('source channel curves', () => {
  it('has an exact identity fast path and preserves existing tonal lookup output', () => {
    expect(createColorLookups(normalizeStudioSettings({}).color)).toBeNull();
    expect([...createStudioCurveLookup(null)]).toEqual(Array.from({length:256}, (_,i) => i));
    for (const gamma of [.25, .7, 1, 2, 4]) {
      const state = normalizeStudioSettings({color:{gamma,shadows:.3}}).color;
      const previous = createToneLookup(state)!, next = createColorLookups(state)!;
      for (let c=0;c<3;c++) expect(next.slice(c*256,(c+1)*256)).toEqual(previous);
    }
  });
  it('sorts, deduplicates, clamps and bounds imported control points with owned endpoints', () => {
    const curve = normalizeStudioCurve([[1,1],[.5,.6],[NaN,1],[.5,.3],[-1,-2],[2,2],[.6,Infinity],null]);
    expect(curve).toEqual([[0,0],[128/255,.3],[1,1]]);
    const many = normalizeStudioCurve(Array.from({length:2000},(_,i)=>[i/100,.7]));
    expect(many.length).toBeLessThanOrEqual(16);
    expect(many[0][0]).toBe(0);expect(many.at(-1)![0]).toBe(1);
    for(let i=1;i<many.length;i++) expect(many[i][0]).toBeGreaterThan(many[i-1][0]);
  });
  it('preserves each segment range for unevenly spaced and inverted curves', () => {
    for(let seed=0;seed<160;seed++) {
      const raw = Array.from({length:14}, (_,i) => [((i*17+seed*13)%251)/255,((i*71+seed*37)%256)/255]);
      const points = normalizeStudioCurve(raw), lookup = createStudioCurveLookup(points);
      for(let i=0;i<points.length-1;i++) {
        const [left,right] = [points[i],points[i+1]], low = Math.min(left[1],right[1])*255, high = Math.max(left[1],right[1])*255;
        let last=lookup[Math.round(left[0]*255)];
        for(let x=Math.round(left[0]*255);x<=Math.round(right[0]*255);x++) {
          expect(lookup[x]).toBeGreaterThanOrEqual(Math.floor(low));
          expect(lookup[x]).toBeLessThanOrEqual(Math.ceil(high));
          expect((lookup[x]-last)*Math.sign(right[1]-left[1])).toBeGreaterThanOrEqual(0);
          last=lookup[x];
        }
      }
    }
  });
  it('composes levels, master and individual channels in a documented order', () => {
    const color = normalizeStudioSettings({color:{gamma:2,curves:{rgb:[[0,1],[1,0]],red:[[0,0],[1,.5]]}}}).color;
    const lut = createColorLookups(color)!;
    const pixels = new Uint8ClampedArray([64,64,64,128,90,140,190,0]);
    applyColorLookups(pixels,lut);
    expect([...pixels]).toEqual([64,127,127,128,90,140,190,0]);
  });
  it('merges individual channel updates and round-trips the exact saved curves', () => {
    const first = normalizeStudioSettings({color:{curves:{rgb:[[0,.1],[.4,.6],[1,.9]],red:[[0,1],[1,0]]}}});
    const updated = updateStudioSettings(first,{color:{curves:{blue:[[0,0],[1,.8]]}}});
    expect(updated.color.curves?.rgb).toEqual(first.color.curves?.rgb);
    expect(updated.color.curves?.red).toEqual(first.color.curves?.red);
    expect(updated.color.curves?.blue).not.toEqual(first.color.curves?.blue);
    expect(parseStudioSettings(serializeStudioSettings(updated))).toEqual(updated);
    updated.color.curves!.red![0][1]=.5;
    expect(first.color.curves?.red?.[0][1]).toBe(1);
    const a=normalizeStudioCurves(null),b=normalizeStudioCurves(null);
    a.rgb[0][1]=1; expect(a.red[0][1]).toBe(0);expect(b.rgb[0][1]).toBe(0);
  });
});
