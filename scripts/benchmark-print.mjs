import { build } from 'esbuild';
import { performance } from 'node:perf_hooks';
import { cpus, platform, arch } from 'node:os';
import { writeFile } from 'node:fs/promises';
const bundled=await build({entryPoints:[new URL('../src/studio/print-renderer.ts',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'esm'});
const {createPrintPainter}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const {STUDIO_PRINT_STYLES}=await import('../dist/studio.js');
let operations=0,checksum=0;
const coordinate=(x=0,y=0,r=0)=>{operations++;checksum+=x*.00001+y*.00001+r;};
const ctx={globalAlpha:1,globalCompositeOperation:'source-over',lineWidth:1,fillStyle:'',strokeStyle:'',beginPath(){operations++;},moveTo:coordinate,lineTo:coordinate,
  closePath(){operations++;},arc:coordinate,ellipse:coordinate,fill(){operations++;checksum+=this.fillStyle.length;},stroke(){operations++;checksum+=this.lineWidth;}};
const painter=createPrintPainter({roughness:1,weight:1.5,registration:1,density:1.5});
const results=[];
for(const {value:style} of STUDIO_PRINT_STYLES)for(const cells of [12000,24000,96000]){
  const columns=Math.floor(Math.sqrt(cells*16/9));
  const run=()=>{for(let i=0;i<cells;i++){const x=i%columns,y=Math.floor(i/columns);painter.paint(ctx,style,x,y,x*6,y*6,6,(i%251)/250,'#dce8d7',70,120,190,'source');}};
  for(let i=0;i<6;i++)run();
  const samples=[];for(let i=0;i<35;i++){operations=0;const start=performance.now();run();samples.push(performance.now()-start);}
  samples.sort((a,b)=>a-b);results.push({style,cells,operations,medianMs:+samples[17].toFixed(3),p95Ms:+samples[33].toFixed(3)});
}
if(!Number.isFinite(checksum))throw new Error('Invalid commands');
const report={version:'4.9.0',date:'2026-10-07',hardware:cpus()[0].model,node:process.version,platform:platform(),arch:arch(),
  scope:'CPU print-geometry generation and color formatting into counting sinks, not Canvas drawing. Excludes source processing, hover simulation, media decode, GPU, browser frame pacing and exports. Static artwork caches this work. Not an FPS result.',results};
await writeFile(new URL('../docs/benchmarks/2026-10-07-print-4.9.0.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
