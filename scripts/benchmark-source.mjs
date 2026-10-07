// CPU source processing only; not browser frame rate or actual Canvas/GPU work.
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir, cpus } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const temporary = await mkdtemp(join(tmpdir(), 'asciify-source-bench-'));
try {
  await build({entryPoints:['src/studio/tone.ts','src/studio/denoise.ts'],outdir:temporary,
    bundle:true,platform:'node',format:'esm',outExtension:{'.js':'.mjs'},logLevel:'silent'});
  const {createColorLookups,applyColorLookups}=await import(pathToFileURL(join(temporary,'tone.mjs')).href);
  const {SourceDenoiser}=await import(pathToFileURL(join(temporary,'denoise.mjs')).href);
  const lut=createColorLookups({gamma:1.3,curves:{rgb:[[0,.05],[.3,.25],[.7,.8],[1,1]],red:[[0,0],[.5,.6],[1,1]]}});
  const rows=[];
  for(const [width,height] of [[160,90],[320,180],[640,360],[960,540]]) {
    const source=new Uint8ClampedArray(width*height*4),data=new Uint8ClampedArray(source.length);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
      const i=(y*width+x)*4,n=((x*31+y*37)%23)-11;
      source[i]=x/width*255+n;source[i+1]=y/height*255+n;source[i+2]=(x+y)/(width+height)*255+n;source[i+3]=255;
    }
    for(const mode of ['curves','denoise','combined']) {
      const filter=new SourceDenoiser(1),samples=[];
      for(let i=0;i<30;i++) {
        data.set(source);const start=performance.now();
        if(mode!=='curves')filter.apply(data,width,height);
        if(mode!=='denoise')applyColorLookups(data,lut);
        if(i>=6)samples.push(performance.now()-start);
      }
      samples.sort((a,b)=>a-b);
      rows.push({width,height,mode,medianMs:+samples[Math.floor(samples.length/2)].toFixed(3),p95Ms:+samples[Math.floor(samples.length*.95)].toFixed(3)});
    }
  }
  const report={scope:'CPU sampled-source processing only; static sources reuse this result during motion/hover. Excludes decoding, Canvas, GPU and frame pacing.',timestamp:new Date().toISOString(),node:process.version,cpu:cpus()[0]?.model,rows};
  if(process.argv[2])await writeFile(resolve(process.argv[2]),JSON.stringify(report,null,2)+'\n');
  console.table(rows);console.log(report.scope);
} finally {await rm(temporary,{recursive:true,force:true});}
