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
gridToSvg(grid, { fontSize: 12 }); // standalone SVG of text rows
gridToHtml(grid);                 // a <pre>; add aria-hidden or a label where you place it
```

## Getting pixels

- **Node**: `const { data, info } = await sharp('photo.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });`
  then `toAsciiGrid({ data, width: info.width, height: info.height }, …)`.
- **Browser or worker**: an `ImageData` works as is: `toAsciiGrid(ctx.getImageData(0, 0, w, h), …)`.
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

Pass `dither: 'ordered'` and the previous grid each frame. On a slow pan this changes about 8 % of cells per frame, against
25 % with the still defaults, at the same fidelity:

```ts
let previous = null;
for (const frame of frames) {
  previous = toAsciiGrid(frame, { columns: 120, dither: 'ordered', previous });
  write(gridToAnsi(previous));
}
```

## Quality and cost

Shape matching was measured against other renderers (aalib.js, ascii.rest, three.js AsciiEffect, a naive ramp) on photos it
was not tuned on, line art and type: ahead of everything tested on photos, line art and type, a 1080p frame in about 20 ms on one
core, 4.7 kB gzipped. Glyph shapes and ink come from DejaVu Sans Mono (the Vera design behind Menlo); the art matches most
closely in that family. The output for a given input is deterministic and identical across runtimes.
