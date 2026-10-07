# Studio performance and combination audit — 2026-10-07

This is evidence for specific CPU improvements, not a comparison of whole-browser FPS or a claim of visual superiority. Local browser inspection remains blocked by the earlier browser-tool policy rejection; no alternate browser was used.

## CPU quantization

Node v25.9.0, macOS arm64, Apple M4 Pro. A deterministic 640×360 RGBA fixture with transparency and a 16-color Pico-8 palette. Each algorithm warms for six runs and samples 24 further runs. Input reset happens outside the timed span.

| Algorithm | Before median | After median |
| --- | ---: | ---: |
| Bayer 4 | 15.232 ms | 10.116 ms |
| Bayer 16 | 21.264 ms | 10.074 ms |
| Floyd–Steinberg | 31.213 ms | 29.395 ms |
| Atkinson | 37.964 ms | 36.273 ms |

Ordered thresholds now use a precomputed table. All 54 regression fixtures across 18 algorithms preserve the original quantized RGBA bytes. Large diffusion grids still exceed a 16.7 ms frame budget on CPU alone; use an adaptive grid for interaction. These timings exclude Canvas, video decode, GPU finishing, browser scheduling and presentation. JIT/device variance applies.

Reproduce with `npm run bench:dither -- /tmp/dither.json`. Full source settings, CPU metadata and per-size p95 measurements are in [before](benchmarks/2026-10-07-dither-before.json) and [after](benchmarks/2026-10-07-dither-after.json).

## Hover field simulation

All eight active hovers were exercised with radius 1, strength 1, edge protection off, long strokes and rapid reversals. Landscape fields are 128×72; portrait fields are 72×128. Sampled 210 steps after 30 warm-up steps. P95 CPU deposition/simulation costs ranged from 0.209 to 1.488 ms. Every field settled after pointer exit. Scatter direction noise is precomputed once per field rather than on each pointer deposit.

Reproduce with `npm run bench:hover -- /tmp/hover.json`. [Full report](benchmarks/2026-10-07-hover-fields.json). This does not include per-glyph sampling, rendering or GPU work, and does not establish 60 FPS on mobile.

## Pipeline and combination regressions

- All 18 renderers reuse stationary compositions, including masks, lighting and backdrop, while time-dependent post-processing continues.
- Edits, source changes, invalidation, size/grid changes and active hover invalidate the composition. The field's final clean frame is restored before caching.
- 18 styles × 9 hover choices × 7 ambient choices = 1,134 small Canvas-command combinations execute with finite coordinates. Color mode cycles across combinations; edge protection and finishing are included. This is command-level coverage, not pixel or WebGL visual acceptance.
- CMYK now derives screen coverage from the same gray/accent/source tone, hover and ambient treatment as other renderers. Regression tests confirm changing tonal motion and density hover changes its dot coverage.
- Stationary Sheen/Living Grain glyphs remain pixel-aligned. Zero-strength ambient motion and hidden dither settings on other styles do not keep the preview scheduled.
- Mount tests verify wake/settle, pause/resume, abort cleanup and phase preservation. Still exports can use the mounted `motionTime` to match the preview after speed edits; animation exports continue to begin at zero.
- The typed project example covers live update, saved settings, independent PNG/MP4 export, bounded output dimensions and cleanup. The package skill routes new integrations to one motion owner.

## Remaining gates

Actual mobile/desktop frame pacing, GPU effect combinations, output fidelity across all styles and browser codecs, PNG/animation visual comparisons, landing/editor usability and competitor comparison remain unverified. Finite command tests do not prove visual quality. The broader catalog gaps listed in the site's Studio capability audit remain open.
