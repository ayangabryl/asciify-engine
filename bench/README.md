# Comparison benchmark

asciify-engine against other ASCII renderers, on the same pictures and grid. Kept out of the package: it has its own
dependencies (three, postprocessing, @sister.software/asciify, aalib.js). The latest report is
[docs/benchmarks/2026-11-04-ascii-renderers.md](../docs/benchmarks/2026-11-04-ascii-renderers.md).

```bash
cd bench && npm i
node compare.mjs [--images dir] [--out results.json] [--dump dir]   # fidelity, flicker, speed
node size.mjs                                                         # bundle size, Node support (after npm run build)
node three-live.mjs [--shot file.png]                                 # a three.js scene as a live field source
node tune.mjs tunes.json [--images dir]                               # parameter search for the headless renderer
```

Needs Playwright's Chromium and DejaVu Sans Mono. `page.js` holds the renderers, the scoring (SSIM after a viewing-distance
blur in linear light) and the flicker and speed measures; the report explains each.
