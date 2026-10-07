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

## 4.4.0 effect expansion

The catalog now has 11 active hovers and 10 active still-image motions, plus independent Off choices. Emboss adds signed light and shadow without shifting the grid; Elastic stores momentum and uses an analytic damped spring; Rake alternates displacement bands along a stroke. New still-image motions are Parallax, Woven Flow, Print Shift and Contour Light. All share the existing runtime, pause lifecycle and bounded fields.

The maximum-radius/strength benchmark was rerun for all 11 hovers in landscape and portrait. New-mode CPU p95 costs were Emboss 0.266–0.290 ms, Elastic 0.377–0.411 ms and Rake 0.532–0.560 ms on the same M4 Pro. Every field settled after pointer exit. [Full 4.4.0 report](benchmarks/2026-10-07-hover-fields-4.4.0.json). These measurements exclude source sampling, glyph rendering, GPU finishing and browser presentation; they are not a frame-rate guarantee.

The suite now covers 18 styles × 12 hover choices × 11 motion choices = 2,376 finite Canvas-command combinations. Additional regressions cover signed CPU/packed-field agreement, spring recoil and 30/60/120 Hz subdivision, edge protection, restoration, source-dependent Contour Light, deterministic cycles and visible dither output under each motion. Spatial hover sampling now interpolates source pixels with premultiplied alpha, avoiding whole-cell jumps and transparent-edge halos. The integer resting-grid path remains allocation-free.

243 unit tests across 19 files and the package build pass. Actual browser appearance, frame pacing and animated export playback remain unverified under the browser-inspection restriction above.

## 4.5.0 source tone and blue-noise quantization

The new `blue-noise` algorithm uses a 64×64 rank tile generated offline by a seeded, toroidal void-and-cluster procedure. Reference: [Ulichney, 1993](https://cv.ulichney.com/papers/1993-void-cluster.pdf). The implementation and generated data are original repository code. The encoded tile decodes to 8 KiB once in the optional Studio entry; it is not included in `/core` or `/hover`, and no network asset or runtime optimizer is involved.

Quantitative tests check unique threshold ranks, low-frequency Fourier power at 10/25/50/75/90% coverage versus a shuffled control, flat black/white tone coverage, palette membership, transparent pixels, deterministic frames, matrix drift and zero-strength behavior. At full strength the monochrome coverage differs from the requested flat tone by less than one pixel per tile. Existing 54 dither regression fixtures retain identical RGBA output.

The new CPU benchmark uses the same M4 Pro, Node 25.9.0 and 16-color Pico-8 fixture as earlier runs. Blue-noise median/p95 quantization is 3.256/3.327 ms at 320×180 and 12.239/12.447 ms at 640×360. White-noise p95 in this run was 4.207 and 16.521 ms respectively. [Full report](benchmarks/2026-10-07-dither-4.5.0.json). These costs exclude sampling, drawing, GPU finishing and presentation. Large grids remain an explicit quality/performance tradeoff; no device FPS guarantee follows from this test.

Neutral tonal controls skip the lookup pass. Non-neutral controls build a 256-entry curve only when configuration changes and apply it to sampled source pixels before every style's conversion; the existing static-source cache remains in effect. Tests verify monotonicity across extreme combinations, input endpoint mapping, midtone gamma, independent shadows/highlights, alpha preservation, settings round-trip, and reset/invalidation in every renderer. This is a bounded global tonal curve, not per-channel curve-graph parity.

279 engine unit tests across 21 files pass. Browser appearance, stack combinations and playback remain unverified under the existing inspection restriction.


## 4.6 source curves and noise reduction

Four independently editable curves (RGB, red, green, blue) use shape-preserving cubic interpolation and compile to three 256-entry tables. Curves support non-monotone output points intentionally; tests check segment bounds and monotonicity within 160 uneven/inverted fixtures. Defaults and identity curves keep the existing 4.5 tone output byte-exact. The edge-preserving source filter uses a fixed 3×3 neighborhood, RGB difference weighting and alpha-aware sampling; it does not touch alpha or read hidden transparent color. It is off by default.

The renderer applies source filtering once per invalidated source, then reuses it during still-image motion and pointer effects. Tests cover all 18 renderer paths, source/configuration invalidation, detached settings snapshots and forwarding saved curves/noise settings to the independent export renderer. Export codecs and actual pixel readback still require browser acceptance.

CPU measurements: Node v25.9.0, Apple M4 Pro. See [full source-processing report](benchmarks/2026-10-07-source-4.6.0.json). At 320×180 samples, combined full-strength filtering/curves median 1.990 ms, p95 2.245 ms. At 640×360, 7.753 / 7.978 ms. Dense 960×540 sampling costs 18.753 / 19.595 ms, so full-resolution video filtering is not a 60fps guarantee. Default character grids are far smaller; stills reuse this work. Curves alone at 640×360 p95 0.421 ms. Measurements exclude decoding, Canvas, GPU, display and user input latency.

## 4.7 source warp stack and dither alpha

Nine original CPU source transformations share a bounded stack of eight stages. Inverse maps compose in reverse order and resample once with premultiplied alpha. Circular regions use the real output aspect ratio, including character grids with non-square cells. Empty, disabled and zero-strength stacks retain the identity path. Maps are reused across video frames; stills also cache the final shaped pixels through hover/motion. Removing/disabling a stack releases its map. No new clock or per-frame allocation is introduced for the normal cached path.

The dither motion/hover branch now uses the same alpha-aware bilinear source sampling as glyph rendering. Its previous RGB interpolation included hidden transparent color and rounded alpha separately. A targeted renderer test inspects pixels before palette quantization and checks fractional alpha with clean visible color. Ordinary static dither behavior remains unchanged.

Verification includes distinct transform mechanisms/signs, stack order and inverse-twirl cancellation, transparent boundaries, portrait/landscape equivalence, eight-stage extremes and 1px grids, source/settings invalidation, all 18 renderer paths, and forwarding to the independent exporter. The 2,376 style × hover × motion command matrix also varies zero/one/two source warps and both edge modes. These tests establish code behavior; they do not establish visual equivalence or real codec playback.

See [CPU warp benchmark](benchmarks/2026-10-07-warps-4.7.0.json), Node v25.9.0 on Apple M4 Pro. Eight-stage cached resampling p95: 0.331 ms at 160×90, 1.049 ms at 320×180, 4.052 ms at 640×360 and 8.909 ms at 960×540. Rebuilding after edits is more expensive: 2.457 / 9.857 / 37.001 / 72.833 ms. Video reuses the map, but parameter animation would invalidate it; use the dedicated hover/motion field instead. Dense preview/export quality is an explicit tradeoff. Measurements exclude decode, dither, Canvas, GPU and frame pacing. No universal 60/120fps or mobile guarantee is made.

Design references for algorithms: [shape-preserving interpolation](https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.PchipInterpolator.html), [edge-preserving filtering](https://docs.opencv.org/3.4.19/dd/d6a/tutorial_js_filtering.html). No third-party implementation or runtime dependency was copied.

The build keeps all root/core/hover ESM and CJS JavaScript byte-identical to the 4.5.0 preflight artifact. Studio is 76.87 KiB ESM (minified, uncompressed). Site controls extend the accepted inspector with native controls; they do not add another live canvas. Browser visual, input, codec and frame-pacing checks remain blocked by the prior URL-policy rejection. These results do not establish competitor superiority.


## 4.9 print geometry and interaction coverage

Six optional Studio renderers add stipple dots, continuous engraving cuts, crossing screens, carved woodblock polygons, registered two-ink dots and pointillist pigment strokes. Stable spatial seeds avoid frame-time random texture. Settings compile once; directions and a bounded carving lookup are reused. Ordinary stills keep the existing whole-composition cache. Dissolve reduces coverage for both light-ink and dark-ink polarity. Defaults remain ASCII.

The matrix now covers 24 styles × 12 hover choices × 11 motion choices = 3,168 Canvas-command combinations, including shaping and finishing settings. Cases are split by hover to avoid one giant test timeout. Geometric tests cover density, weight, polarity, line continuity, distinct mechanisms, registration, finite bounded work, deterministic seeds, partial settings updates and preview/export scaling. These establish implementation behavior, not visual similarity or actual GPU output.

[Full print-geometry report](benchmarks/2026-10-07-print-4.9.0.json): Apple M4 Pro, Node v25.9.0. At 24,000 cells the CPU-only p95 ranges from 0.677 ms (Risograph) to 5.437 ms (Pointillism). Woodblock is 3.889 ms after removing repeated trigonometry, down from 14.111 ms in the initial local implementation. At 96,000 cells Crosshatch/Pointillism geometry alone costs 11.580 / 21.537 ms. This is why high-detail animation is an explicit tradeoff, not a universal 60fps promise. The benchmark uses counting sinks, excluding Canvas commands, decode, source processing, hover simulation, GPU, presentation and real exports.

The root/core minified ESM entries grow by 73 bytes for catalog IDs; their CJS counterparts grow by 83 bytes. Hover ESM/CJS files are byte-identical to 4.8.0. Actual print code stays in optional Studio, which grows by 4,662 bytes to 100.31 KiB minified ESM. Source assets and background generators were not added to npm.

Browser verification remains blocked by the prior automatic URL-policy rejection. Visual quality, real codec playback and target-device frame pacing are unverified. Site controls extend the accepted inspector rather than redesigning it.
