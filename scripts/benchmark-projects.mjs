import { performance } from 'node:perf_hooks';
import { cpus, platform, arch } from 'node:os';
import { writeFile } from 'node:fs/promises';
import { normalizeStudioProject, studioProjectBudget, studioLayerPoint, visibleStudioLayers } from '../dist/studio.js';

const results=[];
for(const count of [1,4,8]) {
  const project=normalizeStudioProject({width:1920,height:1080,layers:Array.from({length:count},(_,i)=>({id:`layer${i}`,source:'shared',placement:{width:1-i*.03,height:1-i*.02,rotation:i*12},settings:{hover:{effect:'elastic'}}}))});
  const run=()=>{
    const layers=visibleStudioLayers(project),budget=studioProjectBudget(project,24000,2097152);
    for(const layer of layers)studioLayerPoint(layer,.45,.65,1920,1080);
    if(budget.reduce((n,l)=>n+l.maxCells,0)!==24000||budget.reduce((n,l)=>n+l.width*l.height,0)>2097152)throw new Error('Budget exceeded');
  };
  for(let i=0;i<2000;i++)run();
  const samples=[];
  for(let i=0;i<150;i++){const start=performance.now();for(let j=0;j<100;j++)run();samples.push((performance.now()-start)/100);}
  samples.sort((a,b)=>a-b);results.push({layers:count,medianMs:+samples[75].toFixed(6),p95Ms:+samples[142].toFixed(6)});
}
const report={date:'2026-10-07',version:'4.8.0',node:process.version,hardware:cpus()[0].model,platform:platform(),arch:arch(),width:1920,height:1080,maxCells:24000,maxRasterPixels:2097152,
  scope:'CPU project visibility, shared-budget allocation and inverse pointer geometry only. Excludes actual rendering, media decode, Canvas, GPU, browser frame pacing and exports. Not an FPS result.',results};
const path=new URL('../docs/benchmarks/2026-10-07-projects-4.8.0.json',import.meta.url);
await writeFile(path,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
