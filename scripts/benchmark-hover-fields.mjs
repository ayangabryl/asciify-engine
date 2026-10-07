// Measures CPU simulation only, excluding glyph rendering, upload, GPU and paint.
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir, cpus } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
const temporary=await mkdtemp(join(tmpdir(),'asciify-hover-bench-'));
try {
  await build({entryPoints:['src/surface/water-surface.ts'],outdir:temporary,bundle:true,
    platform:'node',format:'esm',outExtension:{'.js':'.mjs'},logLevel:'silent'});
  const {WaterSurface}=await import(pathToFileURL(join(temporary,'water-surface.mjs')).href);
  const rows=[];
  for(const aspect of [16/9,9/16]) for(const effect of ['trail','water','contour','dissolve','silk','vortex','magnetic','scatter','etch','elastic','rake','lens','smudge','ripple']) {
    const field=new WaterSurface(aspect);field.configure(effect,1,1,false);
    const samples=[];
    for(let i=0;i<240;i++) {
      // Rapid reversals and long strokes, sampled at 60Hz; no growing particle list.
      const start=performance.now();
      field.move(.5+Math.sin(i*.7)*.49,.5+Math.cos(i*.51)*.49,i*1000/60);
      field.step(1/60);
      if(i>=30)samples.push(performance.now()-start);
    }
    samples.sort((a,b)=>a-b);
    field.leave();let settleFrames=0;
    while(field.active&&settleFrames<1200){field.step(1/60);settleFrames++;}
    rows.push({effect,aspect:aspect>1?'landscape':'portrait',field:`${field.columns}x${field.rows}`,
      medianMs:+samples[Math.floor(samples.length/2)].toFixed(3),p95Ms:+samples[Math.floor(samples.length*.95)].toFixed(3),
      settled:!field.active,settleFrames});
  }
  const report={scope:'CPU pointer deposition and simulation only; not browser FPS',
    timestamp:new Date().toISOString(),node:process.version,cpu:cpus()[0]?.model,
    radius:1,strength:1,edgeSafe:false,rows};
  if(process.argv[2])await writeFile(resolve(process.argv[2]),JSON.stringify(report,null,2)+'\n');
  console.table(rows);console.log(report.scope);
  if(rows.some(row=>!row.settled))process.exitCode=1;
}finally{await rm(temporary,{recursive:true,force:true});}
