// npm run test:browser, then open the printed URL in a foreground browser tab.
import fs from 'node:fs/promises';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const tools = process.env.ASCIIFY_AUDIT_TOOLS;
const { build } = tools ? await import(pathToFileURL(path.join(tools, 'node_modules/esbuild/lib/main.js'))) : await import('esbuild');
const bundle = await build({entryPoints:[fileURLToPath(new URL('../src/index.ts',import.meta.url))],bundle:true,format:'esm',write:false,
  ...(tools ? {alias:{'gifuct-js':path.join(tools,'node_modules/gifuct-js/lib/index.js')}} : {})});
const html=await fs.readFile(new URL('./browser-regressions.html',import.meta.url));
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/all.mjs'?'text/javascript':'text/html');res.end(req.url==='/all.mjs'?bundle.outputFiles[0].contents:html)});
server.listen(0,'127.0.0.1',()=>console.log(`Browser checks: http://127.0.0.1:${server.address().port}`));
