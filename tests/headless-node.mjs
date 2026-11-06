// asciify-engine/headless in plain Node, with no DOM: imports the built package, checks it leaves the global scope alone,
// converts a picture, and writes every output format. Run after `npm run build`: node tests/headless-node.mjs
import assert from 'node:assert/strict';

const before = new Set(Object.getOwnPropertyNames(globalThis));
for (const name of ['window', 'document', 'HTMLCanvasElement', 'OffscreenCanvas']) assert.equal(typeof globalThis[name], 'undefined', `${name} must not exist here`);
const esm = await import('../dist/headless.js');
const { createRequire } = await import('node:module');
const cjs = createRequire(import.meta.url)('../dist/headless.cjs');
assert.deepEqual(Object.keys(esm).sort(), Object.keys(cjs).sort(), 'ESM and CJS export the same names');
const added = Object.getOwnPropertyNames(globalThis).filter(name => !before.has(name));
assert.deepEqual(added, [], 'importing adds no globals');

const width = 320, height = 180, data = new Uint8Array(width * height * 4);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const i = (y * width + x) * 4, r = Math.hypot(x - 160, y - 90), v = r < 70 ? 255 * (1 - r / 70) : 0;
  data[i] = v; data[i + 1] = v * 0.8; data[i + 2] = 255 - v; data[i + 3] = 255;
}
const t = performance.now();
const grid = esm.toAsciiGrid({ data, width, height }, { columns: 64, color: true });
const ms = performance.now() - t;
assert.equal(grid.columns, 64);
assert.ok(grid.rows > 10 && grid.lines.every(line => line.length === 64));
assert.ok(esm.gridToText(grid).trim().length > 0);
assert.match(esm.gridToAnsi(grid), /\x1b\[38;2;/);
assert.match(esm.gridToSvg(grid), /^<svg /);
assert.match(esm.gridToHtml(grid), /^<pre /);
for (const mode of ['braille', 'half', 'quad', 'sextant']) {
  const blocks = esm.toBlockGrid({ data, width, height }, { columns: 40, mode, color: true });
  assert.equal(blocks.lines.length, blocks.rows);
  assert.ok(blocks.lines.every(line => [...line].length === 40), `${mode}: one character a cell`);
  assert.match(esm.gridToAnsi(blocks), mode === 'braille' ? /\x1b\[38;2;/ : /;48;2;/);
}
assert.match(esm.gridsToAnimatedSvg([grid, grid], { fps: 4 }), /@keyframes s/);
assert.deepEqual(cjs.toAsciiGrid({ data, width, height }, { columns: 64 }).lines, esm.toAsciiGrid({ data, width, height }, { columns: 64 }).lines, 'ESM and CJS agree');
console.log(esm.gridToText(esm.toAsciiGrid({ data, width, height }, { columns: 48 })));
console.log(`\nheadless ok in Node ${process.version}: ${grid.columns}x${grid.rows} in ${ms.toFixed(1)} ms, no DOM, no globals added.`);
