import {fileURLToPath, pathToFileURL} from 'node:url';
import path from 'node:path';
const {default: puppeteer} = await import(process.env.ASCIIFY_BROWSER_TOOLS ? pathToFileURL(path.join(process.env.ASCIIFY_BROWSER_TOOLS,'node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js')).href : 'puppeteer');
import fs from 'node:fs/promises';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const root=fileURLToPath(new URL('..',import.meta.url));
const out=process.env.ASCIIFY_AUDIT_OUTPUT; if(out) await fs.mkdir(out,{recursive:true});
const server=http.createServer(async(req,res)=>{try{if(req.url==='/hover.js'){res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(root+'/dist/hover.js'));}else res.end('<style>body{margin:0;background:#090909}#art{position:relative;width:640px;height:360px}canvas{width:640px;height:360px;display:block}</style><div id="art"><canvas width="640" height="360" id="source" style="visibility:visible"></canvas></div>');}catch(e){res.statusCode=500;res.end(String(e));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
const browser=await puppeteer.launch({executablePath:process.env.PUPPETEER_EXECUTABLE_PATH,headless:true});const results=[];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
try{
 const req=createRequire(import.meta.url);assert.equal(typeof req(root+'/dist/hover.cjs').mountHover,'function');assert.equal(typeof (await import(root+'/dist/hover.js')).mountHover,'function');
 for (const fallback of [false,true]) {
  const page=await browser.newPage();await page.setViewport({width:800,height:600});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluateOnNewDocument(fallback=>{window.ticks=0;const raf=requestAnimationFrame;window.requestAnimationFrame=cb=>raf(t=>{window.ticks++;cb(t)});if(fallback){const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='webgl'?null:get.call(this,type,...args)}}},fallback);
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}]);await page.goto(url);await page.evaluate(async()=>{
   const {mountHover,mountStudioHover}=await import('/hover.js');if(mountHover!==mountStudioHover)throw Error('Alias differs');
   const host=document.querySelector('#art'),source=document.querySelector('#source'),ctx=source.getContext('2d');window.ctx=ctx;
   ctx.font='12px monospace';ctx.textAlign='center';ctx.textBaseline='middle';
   for(let y=0;y<30;y++)for(let x=0;x<80;x++){ctx.fillStyle=`rgb(${90+x%4*20},${90+x%4*20},${90+x%4*20})`;ctx.fillText(' .:-=+*#%@'[(x+y)%10],x*8+4,y*12+6)}
   window.mount=()=>mountHover(host,source,{fontSize:8,charAspect:2/3,strength:1,radius:1});window.hover=window.mount();
   window.fingerprint=()=>hover.canvas.toDataURL();
  });
  await delay(250);assert.equal(await page.evaluate(()=>hover.canvas.dataset.renderer),fallback?'surface-canvas':'surface-gpu');
  for(const effect of ['trail','water','contour','dissolve','silk','vortex']){
   await page.evaluate(effect=>hover.update({effect}),effect);await delay(100);const before=await page.evaluate(()=>fingerprint());
   for(let i=0;i<16;i++){await page.mouse.move(70+i*30,150+Math.sin(i*.6)*45);await delay(18)}
   const after=await page.evaluate(()=>fingerprint());if(after===before){console.log(await page.evaluate(()=>({ticks,reduce:matchMedia('(prefers-reduced-motion: reduce)').matches,host:document.querySelector('#art').getBoundingClientRect().toJSON(),source:document.querySelector('#source').getBoundingClientRect().toJSON(),hidden:document.hidden})));throw Error(`${effect} ${fallback}: no visible hover`)};
   await page.mouse.move(750,550);results.push({renderer:fallback?'canvas':'webgl',effect,changesArtwork:true});
  }
  // A released trail must settle and stop scheduling frames without selecting Off.
  await page.evaluate(()=>hover.update({effect:'trail'}));
  await page.mouse.move(100,160);await delay(30);await page.mouse.move(480,180);await delay(70);await page.mouse.move(750,550);
  await delay(6000);const settled=await page.evaluate(()=>ticks);await delay(250);assert.equal(await page.evaluate(()=>ticks),settled,'released trail must settle and sleep');
  await page.evaluate(()=>hover.update({effect:'none'}));await delay(120);const start=await page.evaluate(()=>ticks);await delay(200);assert.equal(await page.evaluate(()=>ticks),start,'still should sleep');
  const still=await page.evaluate(()=>fingerprint());await page.evaluate(()=>{ctx.fillStyle='red';ctx.fillRect(250,150,40,40);hover.invalidate()});await delay(100);assert.notEqual(await page.evaluate(()=>fingerprint()),still,'invalidate must redraw');
  await page.evaluate(()=>hover.update({motion:'print'}));await delay(200);const motion=await page.evaluate(()=>fingerprint());await delay(200);assert.notEqual(await page.evaluate(()=>fingerprint()),motion,'living image must change');
  await page.evaluate(()=>hover.update({paused:true}));await delay(100);const paused=await page.evaluate(()=>({ticks,image:fingerprint()}));await delay(160);assert.deepEqual(await page.evaluate(()=>({ticks,image:fingerprint()})),paused,'pause must sleep and freeze');
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);await page.evaluate(()=>hover.update({effect:'water',paused:false}));await delay(100);const reduced=await page.evaluate(()=>({ticks,image:fingerprint()}));await page.mouse.move(200,150);await delay(150);assert.deepEqual(await page.evaluate(()=>({ticks,image:fingerprint()})),reduced,'reduced motion must sleep');
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}]);
  await page.evaluate(()=>hover.update({animated:true,motion:'none',effect:'trail'}));await delay(100);
  await page.evaluate(()=>{document.querySelector('#art').style.marginTop='900px'});await delay(150);const offscreen=await page.evaluate(()=>ticks);await delay(200);assert.equal(await page.evaluate(()=>ticks),offscreen,'offscreen video surface must sleep');
  await page.evaluate(()=>{document.querySelector('#art').style.marginTop='0'});await delay(150);assert.ok(await page.evaluate(()=>ticks)>offscreen,'visible surface must resume');
  if(!fallback){await page.evaluate(()=>hover.canvas.getContext('webgl').getExtension('WEBGL_lose_context').loseContext());await delay(150);assert.equal(await page.evaluate(()=>hover.canvas.dataset.renderer),'surface-canvas','context loss fallback');}
  await page.evaluate(()=>{hover.destroy();hover.destroy()});assert.equal(await page.$('.ascii-hover-surface'),null);assert.equal(await page.evaluate(()=>document.querySelector('#source').style.visibility),'visible');
  const destroyed=await page.evaluate(()=>ticks);await page.mouse.move(250,200);await delay(150);assert.equal(await page.evaluate(()=>ticks),destroyed,'destroy leaked pointer');assert.deepEqual(errors,[]);
  results.push({renderer:fallback?'canvas':'webgl',idle:true,settled:true,offscreen:true,contextLoss:!fallback,invalidate:true,motion:true,pause:true,reducedMotion:true,cleanup:true,errors});await page.close();
 }
 if(out) await fs.writeFile(out+'/browser-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close();server.close()}
