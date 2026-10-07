// CPU-only quantization benchmark. No browser, canvas, GPU or display FPS claims.
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir, cpus } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const temporary = await mkdtemp(join(tmpdir(), 'asciify-dither-bench-'));
try {
  await build({entryPoints:['src/studio/dither.ts','src/studio/model.ts'],outdir:temporary,
    bundle:true,platform:'node',format:'esm',outExtension:{'.js':'.mjs'},logLevel:'silent'});
  const {ditherPixels} = await import(pathToFileURL(join(temporary,'dither.mjs')).href);
  const {normalizeStudioSettings} = await import(pathToFileURL(join(temporary,'model.mjs')).href);
  const rows=[];
  for (const [width,height] of [[320,180],[640,360]]) {
    const source=new Uint8ClampedArray(width*height*4);
    for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
      const i=(y*width+x)*4;
      source[i]=x/width*255;source[i+1]=y/height*255;
      source[i+2]=(x*17+y*29)%256;source[i+3]=(x+y)%37===0?0:255;
    }
    const data=new Uint8ClampedArray(source.length);
    for(const algorithm of ['bayer4','bayer16','floyd-steinberg','atkinson','halftone','noise','radial','blue-noise']) {
      const options=normalizeStudioSettings({dither:{algorithm,palette:'pico8'}}).dither;
      const samples=[];
      for(let i=0;i<30;i++) {
        data.set(source);const start=performance.now();ditherPixels(data,width,height,options,i/60);
        const elapsed=performance.now()-start;if(i>=6)samples.push(elapsed);
      }
      samples.sort((a,b)=>a-b);
      rows.push({width,height,algorithm,palette:options.palette,
        medianMs:+samples[Math.floor(samples.length/2)].toFixed(3),p95Ms:+samples[Math.floor(samples.length*.95)].toFixed(3)});
    }
  }
  const report={scope:'CPU palette quantization only; not rendering, GPU, interaction latency or browser FPS',
    timestamp:new Date().toISOString(),node:process.version,platform:process.platform,arch:process.arch,
    cpu:cpus()[0]?.model,rows};
  const output=process.argv[2];
  if(output) await writeFile(resolve(output),JSON.stringify(report,null,2)+'\n');
  console.table(rows);
  console.log(report.scope);
} finally { await rm(temporary,{recursive:true,force:true}); }
