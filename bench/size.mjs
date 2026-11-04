// Bundle cost of each renderer's minimal use (esbuild, minified, gzip) and whether it converts pixels to text in plain Node.
// node bench/size.mjs   (after npm run build at the repository root)
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), dist = path.join(here, '../dist');
const ENTRIES = {
  'asciify-engine/headless (toAsciiGrid + gridToText)': `import { toAsciiGrid, gridToText } from '${dist}/headless.js'; globalThis.x = [toAsciiGrid, gridToText];`,
  'asciify-engine/field (mountGlyphField, GPU)': `import { mountGlyphField } from '${dist}/field.js'; globalThis.x = mountGlyphField;`,
  'asciify-engine/kit (fieldBackground)': `import { fieldBackground } from '${dist}/kit.js'; globalThis.x = fieldBackground;`,
  'three.js AsciiEffect (with WebGLRenderer)': `import { WebGLRenderer } from 'three'; import { AsciiEffect } from 'three/examples/jsm/effects/AsciiEffect.js'; globalThis.x = [WebGLRenderer, AsciiEffect];`,
  'postprocessing ASCIIEffect (with three.js)': `import { WebGLRenderer } from 'three'; import { EffectComposer, EffectPass, RenderPass, ASCIIEffect } from 'postprocessing'; globalThis.x = [WebGLRenderer, EffectComposer, EffectPass, RenderPass, ASCIIEffect];`,
  '@sister.software/asciify': `import { Asciify } from '@sister.software/asciify'; globalThis.x = Asciify;`,
  'aalib.js': `import aalib from 'aalib.js'; globalThis.x = aalib;`,
};
const rows = [];
for (const [name, contents] of Object.entries(ENTRIES)) {
  const result = await build({ stdin: { contents, resolveDir: here, loader: 'js' }, bundle: true, minify: true, format: 'esm', write: false, platform: 'browser', logLevel: 'silent', nodePaths: [path.join(here, 'node_modules')] });
  const code = result.outputFiles[0].contents;
  rows.push({ name, min: code.length, gzip: gzipSync(code).length });
}
for (const r of rows) console.log(`${r.name.padEnd(54)} ${(r.min / 1024).toFixed(1).padStart(7)} kB min  ${(r.gzip / 1024).toFixed(1).padStart(6)} kB gzip`);

// Pixels to text in Node, no DOM: each library's own conversion path.
const px = { width: 64, height: 32, data: new Uint8ClampedArray(64 * 32 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 7) % 256)) };
const tries = {
  'asciify-engine/headless': async () => (await import(`${dist}/headless.js`)).gridToText((await import(`${dist}/headless.js`)).toAsciiGrid(px, { columns: 16 })),
  'aalib.js': async () => { const aa = (await import('aalib.js/lib/aa.js')).default; const { HTMLRenderer } = await import('aalib.js/lib/renderers/HTMLRenderer.js'); const AAImage = (await import('aalib.js/lib/core/AAImage.js')).default; const img = aa.default ? aa.default({ width: 16, height: 8 })(AAImage.default.fromImageData(px)) : aa({ width: 16, height: 8 })(AAImage.fromImageData(px)); new (HTMLRenderer)({}).processImage(img); return 'ok'; },
  '@sister.software/asciify': async () => { const { Asciify } = await import('@sister.software/asciify'); new Asciify(); return 'ok'; },
  'three.js AsciiEffect': async () => { const { AsciiEffect } = await import('three/examples/jsm/effects/AsciiEffect.js'); new AsciiEffect({ setSize() {}, domElement: {} }); return 'ok'; },
};
console.log('\nPixels to text in plain Node (no DOM):');
for (const [name, run] of Object.entries(tries)) {
  try { const out = await run(); console.log(`  ${name.padEnd(28)} yes${typeof out === 'string' && out.length > 4 ? '' : ''}`); }
  catch (e) { console.log(`  ${name.padEnd(28)} no  (${String(e.message).split('\n')[0].slice(0, 80)})`); }
}
