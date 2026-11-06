# Headless: pixels to text anywhere (4.33, experimental)

`asciify-engine/headless` turns raw pixels into characters with no DOM, no canvas and no dependencies. It runs in Node, Deno,
Bun, Web Workers and edge runtimes (Cloudflare Workers, Vercel Edge) as well as the browser, and importing it touches nothing.
Use it for ASCII in places a canvas cannot go: OG images and emails rendered on a server, CLI banners and terminal output,
READMEs, static site builds, chat bots, and server-rendered pages. For art on a live page, use `/field` or the kit instead.

```ts
import { toAsciiGrid, gridToText, gridToAnsi, gridToSvg, gridToHtml, ASCII_SYMBOLS } from 'asciify-engine/headless';

const grid = toAsciiGrid({ data, width, height }, { columns: 100 }); // RGBA by default; channels: 3 or 1 for RGB or grey
gridToText(grid);                 // plain text, rows joined by \n
gridToAnsi(grid);                 // terminal colour (with color: true), 24-bit or { color: '256' }
gridToSvg(grid, { fontSize: 12 }); // standalone SVG: text rows, block characters as exact shapes
gridToHtml(grid);                 // a <pre>; add aria-hidden or a label where you place it
gridsToAnimatedSvg(grids, { fps: 12 }); // frames as one animated SVG, CSS only (plays in a README)
toBlockGrid({ data, width, height }, { mode: 'sextant', color: true }); // sub-cell art, two colours a cell
```

## SVG for READMEs, docs and design tools

`gridToSvg` sizes each cell from the grid's `cellAspect`, so the SVG keeps the picture's proportions, and spreads characters
to it with `textLength`, so the art keeps its shape in any monospace font. Block elements (█ ▀ ▄ ▌ ▐, eighths, quadrants,
sextants) are drawn as exact rectangles, and ░ ▒ ▓ as 25, 50 and 75 % fills, merged into one path per colour. They tile with
no seams in any font and import cleanly into Figma or Illustrator; `blocks: 'text'` keeps them as characters.

```ts
// One file for either README theme, named for screen readers:
gridToSvg(grid, { title: 'Project logo', ink: '#111', dark: { ink: '#eee' } });

// Animated: each frame shown in turn by CSS, no script, so it plays as an <img> on GitHub. Under prefers-reduced-motion it
// holds the first frame. loop: false plays once and holds the last.
const frames = pictures.map(p => toAsciiGrid(p, { columns: 80, dither: 'ordered', previous })); // pass previous for calm motion
fs.writeFileSync('hero.svg', gridsToAnimatedSvg(frames, { fps: 12, dark: { ink: '#eee' } }));
```

Keep animated SVGs short: every frame is in the file (an 80-column frame is a few kB of text).

## Sub-cell art: `toBlockGrid`

More detail than one character a cell. Each character holds several pixels:

| `mode` | Pixels a cell | Characters | Shows in |
| --- | --- | --- | --- |
| `'braille'` (default) | 2 × 4 dots | U+2800–28FF | Nearly every terminal and font |
| `'half'` | 1 × 2 | ▀ ▄ █ | Everywhere |
| `'quad'` | 2 × 2 | ▘ ▝ ▖ ▗ ▚ ▞ ▙ … | Everywhere |
| `'sextant'` | 2 × 3 | 🬀 … (Symbols for Legacy Computing) | Recent terminals and fonts (Kitty, WezTerm, Windows Terminal, Cascadia, Iosevka) |

With `color: true` each cell is split into its lighter and darker pixels, which become its foreground (`colors`) and
background (`backgrounds`) colours, as terminal image viewers draw it: `half` in colour is effectively two true-colour
pixels a cell. Without colour, pixels are lit by tone (light pixels on `'dark'`, dark ones on `'light'`), after `levels`, with
`dither: 'diffuse'` (default), `'ordered'` or `false` and a `threshold`. `cellAspect` defaults to 2, a terminal's cells; use
the grid's own writers for output (`gridToAnsi` sets the backgrounds; `gridToSvg` draws blocks as shapes).

```ts
process.stdout.write(gridToAnsi(toBlockGrid(frame, { columns: process.stdout.columns, mode: 'half', color: true })) + '\n');
```

## Getting pixels

- **Node**: `const { data, info } = await sharp('photo.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });`
  then `toAsciiGrid({ data, width: info.width, height: info.height }, …)`.
- **Browser or worker, live video**: `createAsciiGpu()` converts a video, image, canvas (a three.js one included), `ImageBitmap`
  or `VideoFrame` on the GPU, with every option below, and never makes the main thread wait for it (see below).
- **Browser or worker, a still**: `imageToAsciiGrid(source, options)` draws the frame down on a 2D canvas and reads back only
  that small picture, synchronously. An `ImageData` also works with `toAsciiGrid`.
- **Edge runtimes**: decode with a WebAssembly image decoder, or pass frames you already have as RGBA.

## Options

| Option | Default | What it does |
| --- | --- | --- |
| `columns` / `rows` | 80 / from aspect | Grid size. Rows follow the picture's aspect and `cellAspect`. |
| `cellAspect` | 1.93 | Height over width of a character where it is shown (a monospace font at line-height 1). Use about 2 at line-height 1.2. |
| `mode` | `'shape'` | `'shape'` matches each cell's strokes against every printable ASCII glyph: edges become `/ \ \| _ ( )`. `'tone'` picks by brightness along `charset`, the classic ramp. |
| `charset` | printable ASCII | In shape mode a subset to choose from (`ASCII_SYMBOLS` for punctuation only, a cleaner graphic look). In tone mode a ramp from empty to dense; non-ASCII characters (`' ░▒▓█'`) keep the order given. |
| `background` | `'dark'` | `'light'` for dark characters on a light page. |
| `dither` | `'diffuse'` | `'diffuse'` is the most faithful for stills; `'ordered'` is calm frame to frame, for video and animation; `false` for none. |
| `previous` | none | The last frame's grid: cells keep their character while it is nearly as good, so still parts stay still. |
| `levels`, `contrast`, `brightness`, `gamma` | `'auto'`, 1, 0, 1 | Tone shaping before matching. |
| `sharpness` | 1.6 | How boldly edges are read in shape mode. |
| `color` | false | Keep each cell's average colour for ANSI, SVG and HTML output. |

## Video and animation

Pass `dither: 'ordered'` and the previous grid each frame. On a slow pan this changes about 4 % of cells per frame, against
25 % with the still defaults, with the picture as faithful while it moves:

```ts
let previous = null;
for (const frame of frames) {
  previous = toAsciiGrid(frame, { columns: 120, dither: 'ordered', previous });
  write(gridToAnsi(previous));
}
```

## On the GPU: `createAsciiGpu`

For a playing video, a 3D canvas or any large grid in the browser, convert on the GPU. The result is the same grid
`toAsciiGrid` returns, from the same options, and resolves once the GPU is done (normally the next frame):

```ts
import { createAsciiGpu, imageToAsciiGrid, gridToText } from 'asciify-engine/headless';

const gpu = createAsciiGpu();            // null without WebGL2: use imageToAsciiGrid then
let previous = null, busy = false;
video.requestVideoFrameCallback(function frame() {
  if (!busy) {
    busy = true;
    gpu.convert(video, { columns: 160, dither: 'ordered', previous }).then(grid => {
      previous = grid; busy = false;
      pre.textContent = gridToText(grid);
    });
  }
  video.requestVideoFrameCallback(frame);
});
// gpu.stats: the last frame's { mainThreadMs, totalMs }; gpu.destroy() when done.
```

- One converter per page is plenty; `imageToAsciiGridGPU(source, options)` uses a shared one and falls back to the CPU itself.
- It works in a worker of its own by default (started from a Blob URL; no worker file or bundler setup), so the page only
  hands each frame over: about 0.5 ms of main thread a 1080p frame at 160 columns, in every mode, diffusion included.
  `createAsciiGpu({ worker: false })` keeps it on the page (about 1.1 to 2.2 ms). Where a content policy blocks Blob
  workers it falls back to the page by itself.
- At least the CPU path's quality on the benchmark (photos 0.596 / 0.884 against 0.592 / 0.879); 93 to 96 % of characters
  identical without diffusion.
- Falls back to `imageToAsciiGrid` without WebGL2, past the GPU's texture size, with more than 127 characters in `charset`, or
  after a lost context. Calls are queued one frame at a time.

On screen, rather than as text, a glyph field (`/field`) draws the characters on the GPU too and is the faster choice.

## Quality and cost

Shape matching was measured against other renderers (ASCII Magic, the Devault generator, aalib.js, ascii.rest, three.js
AsciiEffect, a naive ramp) on photos it was not tuned on, line art and type: ahead of everything tested on photos, line art and
type, a 1080p frame in about 25 ms on one core, or about 0.5 ms of main thread through `createAsciiGpu`, 4.7 kB gzipped
(the GPU converter, tree-shaken when unused, adds about 7 kB). Glyph shapes and ink come from DejaVu Sans Mono (the Vera design behind Menlo); the art matches most
closely in that family. The output for a given input is deterministic and identical across runtimes.
