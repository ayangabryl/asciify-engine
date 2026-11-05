# asciify-engine against other ASCII renderers

November 4, 2026. asciify-engine 4.33.0, three 0.187.0, postprocessing 6.39.6, ascii.rest 0.4.0, @sister.software/asciify
3.1.3, aalib.js 2.0.0. Raw numbers: [2026-11-04-ascii-renderers.json](2026-11-04-ascii-renderers.json). Reproduce with
`cd bench && npm i && node compare.mjs --images <dir>`, `node size.mjs` and `node three-live.mjs`.

## Summary

| | asciify-engine/headless | aalib.js | ascii.rest (shade) | three.js AsciiEffect | naive ramp (agent baseline) |
| --- | --- | --- | --- | --- | --- |
| Photos, 20 unseen (SSIM close / far) | **0.593 / 0.878** | 0.534 / 0.868 | 0.418 / 0.781 | 0.446 / 0.779 | 0.427 / 0.750 |
| Line art | **0.846 / 0.876** | 0.799 / 0.798 | 0.686 / 0.847 | 0.718 / 0.601 | 0.737 / 0.674 |
| Type | **0.902 / 0.889** | 0.876 / 0.868 | 0.786 / 0.846 | 0.874 / 0.836 | 0.841 / 0.810 |
| 1920×1080 frame to 160 columns | 29 ms | 427 ms | 167 ms | 336 ms | 27 ms |
| Flicker on a slow pan (cells per frame) | 25 % stills, **3.8 %** video settings | 34 % | 7 % | 7.8 % | 4.7 % |
| Pixels to text in Node, no DOM | **yes** | no | yes | no | (if written to) |
| Minified + gzipped | 4.7 kB | 8.6 kB | 9.1 kB | 130.8 kB (with three) | — |

On photographs, line art and type it is ahead of every renderer tested, close up and at a distance, and better than aalib on
both measures on 16 of the 20 photos; it does it several times faster than aalib, with a quarter of its flicker in video
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

## ASCII generators: ascii-magic.com and devault-ascii.pages.dev

The two most used free image-to-ASCII generators on the web are apps rather than libraries. Their ASCII styles were rebuilt
in `bench/page.js` from the code their sites ship (November 2026), with their default settings, and drawn in one ink on the same
grid and font as everyone else:

- **ASCII Magic** (ascii-magic.com), Characters mode: the picture drawn down to the grid, each cell's brightness set between the
  picture's darkest and lightest, cells under its dark threshold (30) left empty, then `@#S08Xx+=-;:. ` by brightness. As shipped
  it also lays a blurred copy of the photo under the characters, which is left out here: it would score the photo, not the ASCII.
- **Devault** (devault-ascii.pages.dev), Classic (its default, `@%#*+=-:. `) and Detailed (a 70-character ramp): auto levels, a 6 %
  cutoff, and its edge pass on: a structure-tensor edge finder that puts `-`, `/`, `|` or `\` on strong edges and lifts the rest.

| | Photos (close / far) | Line art | Type | Flicker | 1080p frame |
| --- | --- | --- | --- | --- | --- |
| **asciify-engine/headless** | **0.593 / 0.878** | **0.846 / 0.876** | **0.902 / 0.889** | 25 %, **3.8 %** video | 25 ms |
| asciify-engine `imageToAsciiGrid`, `mode: 'tone'` | 0.540 / 0.869 | 0.780 / 0.839 | 0.870 / 0.894 | 3.5 % video | **2.0 ms** |
| Devault, Detailed | 0.426 / 0.785 | 0.713 / 0.871 | 0.813 / 0.871 | 36 % | 180 ms |
| Devault, Classic | 0.424 / 0.764 | 0.728 / 0.845 | 0.833 / 0.862 | 6.8 % | 167 ms |
| ASCII Magic, Characters | 0.368 / 0.636 | 0.706 / 0.573 | 0.875 / 0.842 | 9.4 % | 2.2 ms |

asciify-engine is ahead of both on every picture at both distances, and with its video settings it flickers least (3.8 % of
cells a frame on a slow pan, against 6.8 % and 9.4 %, while scoring 0.923 on the moving picture against 0.828 and 0.682). The
closest call is line art seen from a distance, where Devault's edge characters do well (0.871 against 0.876).

For speed, `imageToAsciiGrid` in tone mode reads one pixel a cell from a frame drawn down on the GPU, as ASCII Magic does: 2.0
ms against its 2.2 ms, ahead of it on photos, on line art and on type at a distance. Up close on type it is just behind (0.870
against 0.875), and Devault's edge characters keep line art at a distance (0.871 against 0.839): shape mode, at 25 ms, is the
one ahead of both everywhere. On the GPU, the glyph field with `sample: 'shape'` scores
0.618 / 0.922, 0.852 / 0.917 and 0.915 / 0.961 (see the studio heroes below).

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
result being finished on the GPU, less an idle frame. Each cell is the median frame in ms / the slowest main-thread frame in
ms, in Chromium with SwiftShader (the GPU emulated on the CPU), November 5, 2026. Raw numbers:
[2026-11-05-frame-cost.json](2026-11-05-frame-cost.json).

| | 1080p 12 px | 1080p 4 px | 1080p 1 px | 4K 12 px | 4K 4 px | 4K 1 px |
| --- | --- | --- | --- | --- | --- | --- |
| asciify-engine field, no hover | 178 / 19 | 227 / 5.2 | 248 / 10.2 | 872 / 12.1 | 975 / 12.4 | 1011 / 9 |
| asciify-engine field, fluid hover | 225 / 9.3 | 212 / 11.6 | 275 / 5.2 | 847 / 9.4 | 880 / 11.7 | 883 / 10.3 |
| asciify-engine field, `sample: 'shape'`, fluid hover | 193 / 5.2 | 240 / 6.4 | 265 / 10.3 | 765 / 5.5 | 929 / 14.4 | 1000 / 9.2 |
| asciify-engine field, fluid hover, `scope: 'subject'` | 197 / 10.4 | 225 / 12.2 | 266 / 17.2 | 802 / 11.7 | 872 / 14 | 964 / 10 |
| 2025.unseen.co ASCII pass (its fluid trail left out) | 160 / 0.2 | 185 / 0.3 | 158 / 0.2 | 715 / 0.2 | 660 / 0.2 | 691 / 0.2 |
| webgl-ascii-hero | 310 / 1.5 | 331 / 1.6 | 311 / 1.5 | 1183 / 1.1 | 1366 / 1.1 | 1388 / 1.7 |

- **Main thread: no stalls.** Before this release a playing source read a canvas copy back on the CPU to measure its levels
  and hover scope; at 1080p that blocked frames for up to 76 ms (and every frame with `scope: 'subject'`). Those reads now come
  back from the GPU without waiting, and the slowest main-thread frame above is 5 to 19 ms under emulation, where the field's
  copy to its canvas also runs on the CPU. The studio shaders draw straight into their own canvas and do less on the main
  thread (0.1 to 1.7 ms).
- **GPU work:** the field asks for about 1.1 to 1.6 times the work of the bare 2025.unseen.co pass, which samples one pixel per
  cell with no hover (its fluid trail is left out of the rebuild), and 0.6 to 0.85 times webgl-ascii-hero's. The field also
  averages each cell, runs the fluid, and copies each frame to the field's own canvas, which is what lets every field on a page
  share one WebGL context.
- **Big hovers cost the same as small ones:** the fluid runs on a fixed grid whatever its radius, and each cell reads it once.
  Shape sampling adds little at 12 px cells and nothing below 8 device px, where it samples as `area`.
- Emulated times compare the work asked for; they say nothing about a real GPU's speed, which was not measured.


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

- **Photos at a distance:** ahead of aalib on average by a small margin (0.878 against 0.868); on 4 of the 20 photos aalib is better on at least one measure.
- **Flicker on stills:** the default (error diffusion) is the most faithful for a still but changes many cells between similar
  frames (25 %); use `dither: 'ordered'` and `previous` for video and animation (3.8 %, below a plain ramp's 4.7 %).
- **One setting is not ahead of both on everything.** Shape mode is ahead on every picture but takes 25 ms a 1080p frame;
  tone mode through `imageToAsciiGrid` is faster than ASCII Magic (2.0 ms against 2.2) but just behind it on type up close.
- **A thin horizontal or vertical line on a cell edge** can come out as `;:;:` or `)` where aalib draws dots or `!`.
- The glyph table is measured from DejaVu Sans Mono; the art matches most closely in that family and its relatives.
- GPU frame times on real hardware were not measured: the runs use SwiftShader, which compares the work each renderer asks for
  but says nothing about a real GPU's speed.
