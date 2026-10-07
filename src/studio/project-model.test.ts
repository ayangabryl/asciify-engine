import { describe,it,expect } from 'vitest';
import { normalizeStudioProject, updateStudioProjectLayer, serializeStudioProject, parseStudioProject, studioLayerPoint, studioProjectBudget, visibleStudioLayers } from './project-model';

describe('layered project interchange and geometry',()=>{
  it('stores independent source keys/settings, with transparent layer backgrounds and no media URLs',()=>{
    const project=normalizeStudioProject({layers:[{id:'hero',source:'photo',url:'private',settings:{warps:[{type:'twirl'}],motion:{type:'parallax'}}},{id:'title',source:'text'}]});
    expect(project.layers[0].settings.backdrop.mode).toBe('transparent');
    expect(serializeStudioProject(project)).not.toContain('private');
    expect(parseStudioProject(serializeStudioProject(project))).toEqual(project);
    const next=updateStudioProjectLayer(project,'hero',{placement:{rotation:30},settings:{hover:{radius:.8},warps:[{type:'ripple'}]}});
    expect(next.layers[0].settings.motion.type).toBe('parallax');expect(next.layers[0].placement.width).toBe(1);
    expect(project.layers[0].placement.rotation).toBe(0);expect(project.layers[0].settings.warps![0].type).toBe('twirl');
    expect(()=>updateStudioProjectLayer(project,'missing',{})).toThrow(/Unknown layer/);
  });
  it('rejects duplicate/invalid identifiers, excess layers and unsupported or unrelated JSON',()=>{
    for(const id of ['','__proto__','../asset','x'.repeat(65)])expect(()=>normalizeStudioProject({layers:[{id,source:'a'}]})).toThrow(/Layer id/);
    expect(()=>normalizeStudioProject({layers:[{id:'a',source:'x'},{id:'a',source:'y'}]})).toThrow(/Duplicate/);
    expect(()=>normalizeStudioProject({layers:Array.from({length:9},(_,i)=>({id:`a${i}`,source:'x'}))})).toThrow(/eight|8/);
    expect(()=>parseStudioProject('{"version":1,"style":"ascii"}')).toThrow(/not an/);
    expect(()=>parseStudioProject(' '.repeat(1000001))).toThrow(/1 MB/);
    expect(()=>normalizeStudioProject({version:2})).toThrow(/Unsupported/);
  });
  it('bounds imported placement, raster dimensions and blending without mutating defaults',()=>{
    const project=normalizeStudioProject({width:Infinity,height:9000,background:'red',layers:[{id:'a',source:'s',opacity:-8,blend:'copy',placement:{x:8,width:0,rotation:999}}]});
    expect(project.width).toBe(1280);expect(project.height).toBe(4096);expect(project.background).toBe('#0c1711');
    expect(project.layers[0]).toMatchObject({opacity:0,blend:'source-over',placement:{x:2,width:.01,rotation:180}});
  });
  it('maps pointers through translation, non-square scale, rotation and both flips',()=>{
    const layer=normalizeStudioProject({layers:[{id:'a',source:'s',placement:{x:.4,y:.6,width:.5,height:.4,rotation:90}}]}).layers[0];
    expect(studioLayerPoint(layer,.4,.6,1000,500)).toEqual([.5,.5]);
    const point=studioLayerPoint(layer,.4,.85,1000,500);
    expect(point[0]).toBeCloseTo(.75);expect(point[1]).toBeCloseTo(.5);
    layer.placement.flipX=true;expect(studioLayerPoint(layer,.4,.85,1000,500)[0]).toBeCloseTo(.25);
    layer.placement.rotation=0;layer.placement.flipY=true;expect(studioLayerPoint(layer,.4,.7,1000,500)[1]).toBeCloseTo(.25);
  });
  it('excludes invisible/transparent/offscreen work, while retaining rotated bounds that intersect the canvas',()=>{
    const project=normalizeStudioProject({width:1000,height:500,layers:[{id:'a',source:'s',visible:false},{id:'b',source:'s',opacity:0},
      {id:'c',source:'s',placement:{x:2,width:.1}},{id:'d',source:'s',placement:{x:1.05,width:.1,height:1,rotation:90}}]});
    expect(visibleStudioLayers(project).map(l=>l.id)).toEqual(['d']);
  });
  it('divides one cell and raster budget, including extreme thin/rotated eight-layer stacks',()=>{
    for(const [width,height] of [[2,4096],[4096,2],[1920,1080],[4000,4000]])for(const cells of [2048,24000,1048576])for(const maxPixels of [65536,4194304]) {
      const project=normalizeStudioProject({width,height,layers:Array.from({length:8},(_,i)=>({id:`a${i}`,source:'s',placement:{width:i%2?2:.01,height:i%3?.01:2,rotation:i*20}}))});
      const budget=studioProjectBudget(project,cells,maxPixels);
      expect(budget.reduce((sum,l)=>sum+l.maxCells,0)).toBe(cells);
      expect(budget.every(l=>l.maxCells>=256&&l.width>=2&&l.height>=2&&l.width<=4096&&l.height<=4096)).toBe(true);
      expect(budget.reduce((sum,l)=>sum+l.width*l.height,0)).toBeLessThanOrEqual(maxPixels);
    }
    expect(studioProjectBudget(normalizeStudioProject())).toEqual([]);
  });
});
