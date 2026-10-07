// Pure sampling arithmetic. Excludes Canvas/GPU work, media decoding and encoding.
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir, cpus } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
const temporary=await mkdtemp(join(tmpdir(),'asciify-lively-bench-'));
try {
  await build({entryPoints:['src/surface/ambient-motion.ts'],outdir:temporary,bundle:true,platform:'node',format:'esm',outExtension:{'.js':'.mjs'},logLevel:'silent'});
  const {sampleAmbient}=await import(pathToFileURL(join(temporary,'ambient-motion.mjs')).href);
  const rows=[],out=[0,0,0,1];let checksum=0;
  for(const cells of [24000,96000]) for(const motion of ['relight','shimmer','breeze','unfold']) {
    const columns=400,rowsCount=cells/columns,samples=[];
    for(let frame=0;frame<24;frame++){
      const start=performance.now();
      for(let y=0;y<rowsCount;y++)for(let x=0;x<columns;x++){
        sampleAmbient(motion,x/columns,y/rowsCount,frame*.19,out,(x%31)/30);checksum+=out[2]+out[3];
      }
      if(frame>=4)samples.push(performance.now()-start);
    }
    samples.sort((a,b)=>a-b);
    rows.push({motion,cells,medianMs:+samples[10].toFixed(3),p95Ms:+samples[19].toFixed(3)});
  }
  const report={scope:'CPU motion sampling only; not browser FPS',timestamp:new Date().toISOString(),cpu:cpus()[0]?.model,node:process.version,checksum,rows};
  if(process.argv[2])await writeFile(resolve(process.argv[2]),JSON.stringify(report,null,2)+'\n');
  console.table(rows);console.log(report.scope);
}finally{await rm(temporary,{recursive:true,force:true});}
