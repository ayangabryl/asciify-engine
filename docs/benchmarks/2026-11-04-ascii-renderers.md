# asciify-engine against other ASCII renderers

November 4, 2026. asciify-engine 4.33.0, three 0.187.0, postprocessing 6.39.6, ascii.rest 0.4.0, @sister.software/asciify
3.1.3, aalib.js 2.0.0. Raw numbers: [2026-11-04-ascii-renderers.json](2026-11-04-ascii-renderers.json). Reproduce with
`cd bench && npm i && node compare.mjs --images <dir>`, `node size.mjs` and `node three-live.mjs`.

## Summary

| | asciify-engine/headless | aalib.js | ascii.rest (shade) | three.js AsciiEffect | naive ramp (agent baseline) |
| --- | --- | --- | --- | --- | --- |
| Photos, 20 unseen (SSIM close / far) | **0.591 / 0.873** | 0.534 / 0.868 | 0.418 / 0.781 | 0.446 / 0.779 | 0.427 / 0.750 |
| Line art | **0.840 / 0.849** | 0.799 / 0.798 | 0.686 / 0.847 | 0.718 / 0.601 | 0.737 / 0.674 |
| Type | **0.900 / 0.872** | 0.876 / 0.868 | 0.786 / 0.846 | 0.874 / 0.836 | 0.841 / 0.810 |
| 1920×1080 frame to 160 columns | 18 ms | 106 ms | 126 ms | 245 ms | 28 ms |
| Flicker on a slow pan (cells per frame) | 25 % stills, **8 %** video settings | 34 % | 7 % | 7.8 % | 4.7 % |
| Pixels to text in Node, no DOM | **yes** | no | yes | no | (if written to) |
| Minified + gzipped | 4.7 kB | 8.6 kB | 9.1 kB | 130.8 kB (with three) | — |

On photographs, line art and type it is ahead of every renderer tested, close up and at a distance, and better than aalib on
both measures on 15 of the 20 photos; it does it about six times faster than aalib, with a quarter of its flicker in video
settings, in a 4.7 kB entry that also runs on a server. ascii.rest's `logo` style (drawn for
logos on a plain ground) scores 0.367 / 0.728 on photos, 0.746 / 0.778 on line art and 0.805 / 0.829 on type.

**About "Cloudflare's ASCII":** there is no ASCII renderer from Cloudflare. ascii.rest, a library of ASCII pieces that
Cloudflare sponsors (it is made by @bas3line), has an image-to-characters drawing (`drawing()` in `ascii.rest/kit`, the one
its /make/ page uses), and that is what is measured here, in both of its picture styles.

![Line art](2026-11-04-renderers-lines.png)

![Photo](2026-11-04-renderers-photo.png)

![Type](2026-11-04-renderers-text.png)

## What was measured, and how

**Same grid for everyone.** Each renderer turns the same picture into the same grid: 100 columns, rows from the picture's
aspect and a 1.93 cell (DejaVu Sans Mono at line-height 1), light characters on a dark ground: three.js's effect with
`invert`, aalib with its input inverted (as its own `inverse` filter does). ascii.rest sizes its own grid and trims a plain
ground away; its margin is cut off and it is scored against the same trimmed part of the picture.

**Fidelity.** Text output is drawn back in one font (DejaVu Sans Mono, 12 px, white on black), so only the choice of
characters differs. The drawing and the picture are both blurred to a viewing distance, "close" (σ half a cell) and "far"
(σ one and a half cells), and compared with SSIM. The blur averages light, as the eye does; the JSON also has the scores
with the blur in pixel values.

**Tuned on some photos, measured on others.** asciify-engine's weights were tuned on 20 photos from the asciify.org looks
library (every third one) and the line and type images. The photo scores above are on 20 different photos from the same
library (the next one along each time), which the tuning never saw.

**Speed.** Median of seven conversions of a 1920×1080 frame to 160 columns, after a warm-up, in Chromium on one core.

**Flicker.** The photo panned 0.15 of a cell per frame for 24 frames; the share of cells whose character changes. "Video
settings" are `dither: 'ordered'` with each frame given the previous one (`previous`).

**Size.** esbuild, minified, gzipped, of each library's minimal use (`node bench/size.mjs`).

Not measured: TheZoraiz/ascii-image-converter, a popular Go command-line converter, could not be run in the environment the
benchmark was made in (an unvetted downloaded binary).

## Studio heroes: 2025.unseen.co and an open-source WebGL hero

Big design sites draw their ASCII heroes with a WebGL shader. Two are measured here against asciify-engine's GPU field, on the
same 20 unseen photos, line art and type:

- **2025.unseen.co** (Unseen Studio): its ASCII pass, rebuilt in `bench/page.js` from the shader and settings in its live bundle
  (`js-265ae611.js`): one pixel sampled per 12 px square cell, greyscaled, a character picked by brightness from
  `" .,-+=*UNSEEN2025"` (56 px Arial in a 16 by 16 atlas), in `#575757`, with a fluid trail under the cursor (left out here).
- **webgl-ascii-hero** (open source, MIT, a React Three Fiber + postprocessing hero): its effect run unchanged from
  `bench/vendor/`, which samples one pixel per square cell and picks from a 16-character atlas.

Each is scored as shipped and "neutral" (white characters on dark, the same grid as everyone else); neutral is the fair one.

| | Photos (close / far) | Line art | Type |
| --- | --- | --- | --- |
| asciify-engine field, `FIELD_PHOTO_CHARSET`, `glyphScale: 1`, `sample: 'shape'` | **0.618 / 0.922** | **0.852 / 0.917** | **0.915 / 0.961** |
| asciify-engine field, `FIELD_PHOTO_CHARSET`, `glyphScale: 1` | 0.581 / 0.918 | 0.783 / 0.889 | 0.875 / 0.954 |
| asciify-engine field, defaults (tuned for interfaces) | 0.407 / 0.875 | 0.736 / 0.847 | 0.840 / 0.876 |
| 2025.unseen.co ASCII pass, neutral | 0.533 / 0.812 | 0.759 / 0.674 | 0.870 / 0.814 |
| 2025.unseen.co ASCII pass, as shipped (grey `#575757` characters) | 0.311 / 0.348 | 0.662 / 0.448 | 0.790 / 0.662 |
| webgl-ascii-hero, neutral | 0.479 / 0.645 | 0.772 / 0.688 | 0.885 / 0.842 |
| webgl-ascii-hero, as shipped (inverted, purple) | 0.499 / 0.666 | 0.727 / 0.586 | 0.800 / 0.688 |

Both studio shaders choose a character by brightness alone from one sampled pixel, so they alias and do not follow edges. The
field averages each cell and, with the measured 24-step charset, holds more of the picture at both distances; with
`sample: 'shape'` it also reads each cell in 3 by 5 parts on the GPU and, among the characters within three steps of the cell's
tone, takes the one whose ink lies where the picture's light does (cells with no edge in them keep their tone's character).
That is what puts it ahead on type up close, where plain tone sampling (0.875) was behind webgl-ascii-hero (0.885). Its three
constants were tuned on the 20 training photos, line art and type; the photo scores above are on the 20 held-out photos.

### Frame cost

`node bench/perf.mjs` draws a live source (a canvas repainted every frame, standing in for a playing video) at 1920×1080 and
3840×2160 device pixels with 12, 4 and 1 px cells, the pointer moving every frame, and times each frame from the repaint to the
result being finished on the GPU, less an idle frame. See the section below for the numbers.

## cloudflare.com's dot hero

cloudflare.com's home hero ("Build without boundaries") is not drawn live: its field of small ticks with a warm glow is a
pre-rendered video, `static/hero-background-video.mp4` (2560 by 1600, 8 s, **5.08 MB**), behind a 17.8 kB AVIF poster. The page
compiles no WebGL shaders for it.

`bench/cf-hero.mjs` draws the same hero live with asciify-engine's glyph field: one tick character per cell on a 9 by 17 grid,
coloured by the orange ground and glow beneath it, each tick lifted toward white by a four-line custom effect
(`defineFieldEffect`). Scored against a frame of their video at 1280 by 800, it is near-identical at a distance (SSIM **0.998**;
mean colour 255, 97, 34 against their 253, 97, 32). Close up the score is low (about 0.35) because a grid of ticks shifted by
part of a cell scores badly pixel for pixel; it is the same pattern, not the same pixels.

| | cloudflare.com (video) | asciify-engine (live field) |
| --- | --- | --- |
| Bytes for the hero | 5.08 MB video + 17.8 kB poster | 43 kB gzipped field code, no media |
| Resolution | fixed 2560 by 1600, scaled to fit | drawn at the screen's own resolution |
| Interaction, theme, reduced motion | none (a loop) | cursor responses, CSS-token ink, stills under reduced motion |

## Pixel renderers (GPU and canvas)

These draw pixels rather than text, each in its own font, so they are scored on what they drew (same metric), photos:

| | close | far |
| --- | --- | --- |
| asciify-engine glyph field (`/field`, GPU, defaults) | 0.407 | 0.875 |
| asciify-engine glyph field, `FIELD_PHOTO_CHARSET`, `sample: 'shape'` | **0.618** | **0.922** |
| postprocessing ASCIIEffect (defaults) | 0.285 | 0.301 |
| @sister.software/asciify (block mosaic) | 0.547 | 0.792 |

postprocessing tints each glyph by the scene's colour by default, which is why it reads dark here. @sister.software/asciify
fills each cell with a block and cuts the glyph out of it, a mosaic rather than text, so it is listed apart.

## Live 3D

`node bench/three-live.mjs` renders a three.js torus knot each frame and draws it with a glyph field (`live: true`,
`redraw()` after each render). The characters follow the scene, and the source is read back on the CPU only when its levels
are re-measured (about every 1.5 s), not every frame; before `live`, `setSource` each frame read it back twice a frame.

## Where it is not ahead

- **Photos at a distance:** ahead of aalib on average by a small margin (0.873 against 0.868); on 5 of the 20 photos aalib is better on at least one measure.
- **Flicker on stills:** the default (error diffusion) is the most faithful for a still but changes many cells between similar
  frames (25 %); use `dither: 'ordered'` and `previous` for video and animation (8 %), still above a plain ramp (4.7 %).
- **A thin horizontal or vertical line on a cell edge** can come out as `;:;:` or `)` where aalib draws dots or `!`.
- The glyph table is measured from DejaVu Sans Mono; the art matches most closely in that family and its relatives.
- GPU frame times on real hardware were not measured: the runs use SwiftShader, which compares the work each renderer asks for
  but says nothing about a real GPU's speed.
