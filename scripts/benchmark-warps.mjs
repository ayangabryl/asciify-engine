// CPU sampled-source work only. This does not measure browser frame rate.
import { build } from 'esbuild';
import { mkdtemp,rm,writeFile } from 'node:fs/promises';
import { tmpdir,cpus } from 'node:os';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const temporary=await mkdtemp(join(tmpdir(),'asciify-warp-bench-'));
try {
  await build({entryPoints:['src/studio/warps.ts'],outdir:temporary,bundle:true,platform:'node',format:'esm',outExtension:{'.js':'.mjs'},logLevel:'silent'});
  const {SourceWarpProcessor,STUDIO_WARPS}=await import(pathToFileURL(join(temporary,'warps.mjs')).href);
  const rows=[];
  for(const [width,height] of [[160,90],[320,180],[640,360],[960,540]])for(const count of [0,1,8]) {
    const source=new Uint8ClampedArray(width*height*4);
    for(let i=0;i<source.length;i+=4){source[i]=(i*17)%256;source[i+1]=(i*29)%256;source[i+2]=(i*37)%256;source[i+3]=255;}
    const stack=STUDIO_WARPS.slice(0,count).map(({value},i)=>({type:value,amount:.6,radius:.8,frequency:12,angle:i*20}));
    const processor=new SourceWarpProcessor(stack),samples=[],changed=[];
    for(let i=0;i<26;i++) {
      const start=performance.now();processor.apply(source,width,height);
      if(i>5)samples.push(performance.now()-start);
    }
    for(let i=0;i<16;i++) {
      processor.configure(stack.map(w=>({...w,amount:i%2?.5:.6})));
      const start=performance.now();processor.apply(source,width,height);
      if(i>3)changed.push(performance.now()-start);
    }
    const stats=values=>{values.sort((a,b)=>a-b);return {medianMs:+values[Math.floor(values.length/2)].toFixed(3),p95Ms:+values[Math.floor(values.length*.95)].toFixed(3)};};
    rows.push({width,height,stages:count,cachedFrame:stats(samples),changedSettings:stats(changed)});
  }
  const report={scope:'CPU sampled-source warps only. Cached frame includes one resample; changed settings rebuild the coordinate map. Stills reuse the final result during hover/motion. Excludes decoding, dither, Canvas, GPU and frame pacing.',timestamp:new Date().toISOString(),node:process.version,cpu:cpus()[0]?.model,rows};
  if(process.argv[2])await writeFile(resolve(process.argv[2]),JSON.stringify(report,null,2)+'\n');
  console.table(rows.map(({width,height,stages,cachedFrame,changedSettings})=>({width,height,stages,cachedP95:cachedFrame.p95Ms,changedP95:changedSettings.p95Ms})));
  console.log(report.scope);
} finally {await rm(temporary,{recursive:true,force:true});}
