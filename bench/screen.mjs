// Main-thread time per frame of live ASCII renderers drawing on screen, measured by Chrome itself. Each renderer draws a live
// source (a canvas repainted every frame, standing in for a playing video) at the display's rate for a few seconds; every
// task the page's main thread runs meanwhile is taken from a trace (garbage collection and the browser's own frame work
// included), the source's repainting is taken off, and the rest is divided by the frames drawn. Repeated --runs times, each
// run taking every renderer in turn.
// node bench/screen.mjs [--only regex] [--size 1920x1080] [--cell 12] [--seconds 4] [--runs 5] [--out file.json]
import fs from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { workerSource } from './worker-source.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(import.meta.url)('playwright');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const only = new RegExp(arg('--only', '.')), [width, height] = arg('--size', '1920x1080').split('x').map(Number);
const cell = Number(arg('--cell', 12)), seconds = Number(arg('--seconds', 4)), runs = Number(arg('--runs', 5));
const exposeHero = { name: 'expose-hero', setup(b) { b.onLoad({ filter: /webgl-ascii-hero[\\/]ascii-effect\.tsx$/ }, async args => ({ contents: `${await fs.readFile(args.path, 'utf8')}\nexport { AsciiEffectImpl, createGlyphTexture, TERMINAL_SYMBOLS }\n`, loader: 'tsx' })); } };
const bundle = await build({ entryPoints: [path.join(here, 'perf-page.js')], bundle: true, format: 'esm', write: false, nodePaths: [path.join(here, 'node_modules')], loader: { '.ts': 'ts' }, jsx: 'automatic', plugins: [exposeHero, workerSource], logLevel: 'error' });
const server = http.createServer((req, res) => {
  if (req.url === '/perf.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].contents); return; }
  res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000"><script type="module" src="/perf.js"></script>');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--expose-gc'] });
// Every process Chrome runs for this benchmark (browser, renderers, GPU, workers' hosts): the descendants of this one.
const chromeProcesses = () => {
  const parent = new Map();
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try { const stat = readFileSync(`/proc/${name}/stat`, 'utf8'); parent.set(Number(name), Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1])); } catch { /* gone */ }
  }
  return [...parent.keys()].filter(pid => { let p = pid; for (let i = 0; i < 32 && p > 1; i++) { p = parent.get(p); if (p === process.pid) return true; } return false; });
};
/** Proportional set size of those processes, MB: memory each really holds, shared pages divided among their users. */
const memoryMb = () => chromeProcesses().reduce((sum, pid) => { try { return sum + Number(/Pss:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8'))?.[1] ?? 0) / 1024; } catch { return sum; } }, 0);
/** CPU time those processes have used, seconds (user and system). */
const cpuSeconds = () => chromeProcesses().reduce((sum, pid) => { try { const f = readFileSync(`/proc/${pid}/stat`, 'utf8'); const r = f.slice(f.lastIndexOf(')') + 2).split(' '); return sum + (Number(r[11]) + Number(r[12])) / 100; } catch { return sum; } }, 0);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const results = {};
const names = await (async () => {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.perf);
  const all = await page.evaluate(() => window.perf.RENDERERS);
  await page.close();
  return all.filter(n => only.test(n));
})();
for (let run = 0; run < runs; run++) {
  const line = [];
  for (const name of names) {
    // A fresh page for every renderer, so one's teardown (a context given back, an idle timer) never lands in another's time.
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    page.on('pageerror', e => console.error('page error:', e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.perf);
    const cdp = await page.context().newCDPSession(page);
    await page.evaluate(() => globalThis.gc?.());
    const events = [];
    const collect = e => events.push(...e.value);
    cdp.on('Tracing.dataCollected', collect);
    const complete = new Promise(r => cdp.once('Tracing.tracingComplete', r));
    await cdp.send('Tracing.start', { categories: 'toplevel,blink.user_timing,v8,devtools.timeline', transferMode: 'ReportEvents' });
    let frames = 0, memory = 0, cpuStart = 0, cpuEnd = 0;
    // Memory halfway through the measured window; CPU over it (the run warms up for 1.5 s first).
    const sampling = (async () => {
      await sleep(1700); cpuStart = cpuSeconds();
      await sleep(seconds * 500); memory = memoryMb();
      await sleep(seconds * 500 - 400); cpuEnd = cpuSeconds();
    })();
    try { frames = await page.evaluate(o => window.perf.steady(o.name, o), { name, width, height, cell, seconds }); } catch (e) { console.error(name, e.message); }
    await sampling;
    await cdp.send('Tracing.end');
    await complete;
    cdp.off('Tracing.dataCollected', collect);
    const mark = n => events.find(e => e.name === n && e.cat?.includes('blink.user_timing'));
    const start = mark('steady-start'), end = mark('steady-end');
    if (!start || !end || !frames) { line.push(`${name}: no frames`); await page.close(); continue; }
    const { pid, tid } = start, s = start.ts, e = end.ts;
    const tasks = events.filter(t => t.pid === pid && t.tid === tid && t.ph === 'X' && /RunTask$/.test(t.name));
    const busy = tasks.reduce((sum, t) => sum + Math.max(0, Math.min(e, t.ts + t.dur) - Math.max(s, t.ts)), 0);
    // CPU time on the main thread (thread time), where the trace has it: time the thread actually ran, not time it waited for a
    // core (on a machine whose GPU is software, the GPU's threads compete with it).
    const cpuTasks = tasks.filter(t => t.ts >= s && t.ts + t.dur <= e && typeof t.tdur === 'number');
    const cpu = cpuTasks.reduce((sum, t) => sum + t.tdur, 0);
    // The source's repainting: each 'bench' measure, begin to end, inside the window.
    const begins = new Map();
    let bench = 0;
    for (const ev of events.filter(x => x.name === 'bench' && x.cat?.includes('blink.user_timing')).sort((a, b) => a.ts - b.ts)) {
      const key = `${ev.id ?? ''}${ev.id2?.local ?? ''}`;
      if (ev.ph === 'b') begins.set(key, ev.ts);
      else if (ev.ph === 'e' && begins.has(key)) { const b = begins.get(key); begins.delete(key); bench += Math.max(0, Math.min(e, ev.ts) - Math.max(s, b)); }
    }
    const ms = (busy - bench) / 1000 / frames;
    if (arg('--breakdown', null)) {
      // What the main thread did, by the outermost named work inside each task.
      const inside = events.filter(x => x.pid === pid && x.tid === tid && x.ph === 'X' && x.ts >= s && x.ts <= e && !/RunTask$/.test(x.name) && x.dur);
      const by = {};
      for (const t of tasks.filter(t => t.ts >= s && t.ts <= e)) {
        const kids = inside.filter(k => k.ts >= t.ts && k.ts + k.dur <= t.ts + t.dur);
        const top = kids.filter(k => !kids.some(o => o !== k && o.ts <= k.ts && o.ts + o.dur >= k.ts + k.dur && o.dur > k.dur));
        for (const k of top) { const key = k.name + (k.args?.data?.type ? `:${k.args.data.type}` : ''); by[key] = (by[key] ?? 0) + k.dur; }
      }
      if (arg('--timers', null)) {
        const fired = inside.filter(x => x.name === 'TimerFire').sort((a, b) => b.dur - a.dur).slice(0, 5);
        for (const t of fired) {
          const calls = inside.filter(k => k.ts >= t.ts && k.ts + k.dur <= t.ts + t.dur && (k.name === 'FunctionCall' || k.name === 'v8.callFunction'));
          console.log(`    timer ${(t.dur / 1000).toFixed(1)} ms: ${calls.slice(0, 3).map(c => `${c.args?.data?.functionName || '?'} ${String(c.args?.data?.url || '').split('/').pop()}:${c.args?.data?.lineNumber}`).join(' | ')} ${JSON.stringify(t.args?.data ?? {}).slice(0, 120)}`);
        }
      }
      const inWindow = tasks.filter(t => t.ts >= s && t.ts <= e);
      const covered = inWindow.reduce((sum, t) => { const kids = inside.filter(k => k.ts >= t.ts && k.ts + k.dur <= t.ts + t.dur); const top = kids.filter(k => !kids.some(o => o !== k && o.ts <= k.ts && o.ts + o.dur >= k.ts + k.dur && o.dur > k.dur)); return sum + top.reduce((a, k) => a + k.dur, 0); }, 0);
      const total = inWindow.reduce((a, t) => a + t.dur, 0);
      console.log(`  ${name}: ${(inWindow.length / frames).toFixed(1)} tasks a frame, ${((total - covered) / 1000 / frames).toFixed(3)} ms a frame in tasks outside named work; tasks by length: ${[...inWindow].sort((a, b) => b.dur - a.dur).slice(0, 6).map(t => (t.dur / 1000).toFixed(2)).join(', ')}`);
      console.log(`  ${name}: ` + Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${(v / 1000 / frames).toFixed(3)}`).join(', '));
    }
    const cpuMs = cpuTasks.length ? Math.max(0, cpu - bench) / 1000 / frames : NaN;
    const browserCpu = (cpuEnd - cpuStart) / (seconds - 0.4);
    (results[name] ??= []).push({ ms: +ms.toFixed(3), cpuMs: +cpuMs.toFixed(3), frames, fps: +(frames / seconds).toFixed(1), memoryMb: +memory.toFixed(1), browserCpu: +browserCpu.toFixed(3) });
    line.push(`${name.replace('asciify-engine ', '')} ${ms.toFixed(3)} ms, cpu ${cpuMs.toFixed(3)}, ${memory.toFixed(0)} MB, ${(browserCpu * 100).toFixed(0)} % CPU (${frames} frames)`);
    await page.close();
  }
  console.log(`run ${run + 1}: ${line.join(' | ')}`);
}
console.log(`\nmain thread per frame on screen, ${width}x${height}, ${cell} px cells (Chrome trace, ${seconds} s a run, ${runs} runs), ms:`);
for (const [name, list] of Object.entries(results)) {
  const t = list.map(r => r.ms).sort((a, b) => a - b), c = list.map(r => r.cpuMs).sort((a, b) => a - b);
  const med = key => { const v = list.map(r => r[key]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
  console.log(`  ${name.padEnd(56)} min ${t[0].toFixed(3)}  median ${t[Math.floor(t.length / 2)].toFixed(3)}  max ${t[t.length - 1].toFixed(3)}   cpu: min ${c[0].toFixed(3)}  median ${c[Math.floor(c.length / 2)].toFixed(3)}  max ${c[c.length - 1].toFixed(3)}   memory ${med('memoryMb').toFixed(0)} MB, browser CPU ${(med('browserCpu') * 100).toFixed(0)} %`);
}
const out = arg('--out', null);
if (out) await fs.writeFile(out, JSON.stringify({ width, height, cell, seconds, runs, results }, null, 1));
await browser.close(); server.close();
