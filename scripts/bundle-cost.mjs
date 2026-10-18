// What a host bundle pays per export, measured against the built dist with the host's tree shaking (Rollup, as Vite uses).
// `alone`: an app that imports only that export. `split`: a code-split app whose other route imports every kit export;
// Rollup chunks per module, so this is what the route that uses only that export downloads.
// Run after `npm run build`: node scripts/bundle-cost.mjs [export ...]
import { rollup } from 'rollup';
import { minify } from 'terser';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

const dist = resolve(process.env.ASCIIFY_DIST ?? 'dist');
// As Vite and Rollup's node-resolve do, the package's `sideEffects: false` lets a host drop imports it does not use.
const moduleSideEffects = JSON.parse(await readFile('package.json', 'utf8')).sideEffects !== false;
const kit = await import(resolve(dist, 'kit.js'));
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(kit);
const virtual = files => ({
  name: 'virtual',
  async resolveId(id, importer) {
    if (id in files) return id;
    if (id.startsWith('asciify-engine/')) return { id: resolve(dist, id.slice(15) + '.js'), moduleSideEffects };
    if (importer?.startsWith(dist) && id.startsWith('.')) return { id: resolve(importer, '..', id), moduleSideEffects };
    return null;
  },
  load: id => files[id] ?? null,
});
const cost = async (files, entries, chunkFor) => {
  const bundle = await rollup({ input: entries, plugins: [virtual(files)], external: id => !id.startsWith('.') && !id.startsWith('/') && !(id in files) && !id.startsWith('asciify-engine/'), onwarn() {} });
  const { output } = await bundle.generate({ format: 'es' });
  await bundle.close();
  const byName = new Map(output.map(chunk => [chunk.fileName, chunk]));
  const seen = new Set();
  const walk = chunk => { if (seen.has(chunk.fileName)) return; seen.add(chunk.fileName); chunk.imports.forEach(name => byName.has(name) && walk(byName.get(name))); };
  walk(output.find(chunk => chunk.name === chunkFor));
  let raw = 0, gz = 0;
  for (const name of seen) {
    const { code } = await minify(byName.get(name).code, { module: true });
    raw += code.length; gz += gzipSync(code).length;
  }
  return { raw, gz };
};
const kb = n => +(n / 1024).toFixed(1);
const rows = [];
for (const name of names) {
  const alone = await cost({ a: `import { ${name} } from 'asciify-engine/kit'; console.log(${name});` }, { a: 'a' }, 'a');
  const split = await cost({
    a: `import { ${name} } from 'asciify-engine/kit'; console.log(${name});`,
    b: `import * as kit from 'asciify-engine/kit'; console.log(kit);`,
  }, { a: 'a', b: 'b' }, 'a');
  rows.push({ export: name, aloneKB: kb(alone.raw), aloneGzKB: kb(alone.gz), splitKB: kb(split.raw), splitGzKB: kb(split.gz) });
}
console.table(rows);
