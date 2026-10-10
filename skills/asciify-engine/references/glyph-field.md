# GPU glyph fields (4.11)

`asciify-engine/field` draws an image, a video or generated motion as characters entirely on the GPU, with a fluid wake under the cursor. Use it for full-bleed heroes, section backgrounds and brand fields where the frame must stay smooth while people move over it. It is a separate, optional entry; importing the root, `/core`, `/hover` or `/studio` never loads it.

Use `/studio` instead when you need the 24 render styles, dither, print styles, masks, effects or exports. The field draws glyph ramps only: characters, braille, block shading, dots, or your own letters.

## Mount

```ts
import { mountGlyphField, isGlyphFieldSupported } from 'asciify-engine/field';

const canvas = document.querySelector<HTMLCanvasElement>('#hero-field')!; // sized by CSS
if (isGlyphFieldSupported()) {
  const field = mountGlyphField(canvas, {
    source: '/media/hero.mp4',          // image or video URL, or an element; omit for generated motion
    charset: ' .,:-+ACME',              // empty → dense; words work
    cellSize: 12,                       // CSS px, cell height
    color: 'ink', ink: '#f3ba32', shade: 1,
    vignette: 0.3,
    fluid: { radius: 0.08, refraction: 0.03, glow: 0.6 },
    label: 'Our studio, drawn in our name',
  });
  await field.ready;                    // first frame drawn
  // field.update({ ink: '#ffffff' }); field.pointer(x, y); field.pause(); field.destroy();
}
```

Size the canvas with CSS (for example `position:absolute; inset:0; width:100%; height:100%`). The field follows the canvas with a `ResizeObserver` and caps the device pixel ratio at `maxPixelRatio` (2).

## Options

| Option | Default | Notes |
| --- | --- | --- |
| `source` | none | URL (`.mp4`, `.webm`, `.mov` load as muted, looping, inline video), `HTMLImageElement`, `HTMLVideoElement`, `HTMLCanvasElement` or `ImageBitmap`. Cross-origin media needs CORS. |
| `scene` | `'flow'` | Generated motion when there is no source: `'flow'` (domain-warped noise), `'orb'` (lit sphere) or `'none'` (blank, wake only). |
| `charset` | `' .,:-=+*#%@'` | Ordered from empty to dense. Graphemes, so emoji, braille and block shading each take one cell. Up to 256. |
| `cellSize`, `cellAspect` | `12`, `1` | Cell height in CSS px; width ÷ height. Monospaced ramps look best near `0.6`. Cells are whole device pixels, and glyphs are sampled texel for texel. |
| `font`, `fontWeight`, `glyphScale` | monospace, `500`, `0.8` | Any loaded CSS font. The atlas is redrawn when the font finishes loading. |
| `color` | `'ink'` | `'ink'` uses `ink`; `'source'` takes each cell's hue from the media. |
| `ink`, `highlight` | `#f3ba32`, `'auto'` | Hex colors. The wake lifts characters toward `highlight`; `'auto'` brightens each character's own color so the wake keeps the artwork's hue. |
| `shade` | `0.5` | How much darker tones dim the ink, so same-density glyphs such as words still carry the image. |
| `saturation` | `1.1` | Source-color saturation. |
| `background` | `'transparent'` | Hex or `'transparent'`; the canvas is premultiplied. |
| `backdrop` | `0` | Opacity of a soft, blurred copy of the source under the glyphs. It is sampled from the mip chain, so it costs nothing extra. |
| `levels` | `'auto'` | Stretches the source's 2nd–98th luminance percentiles across the charset. Needs pixel access; tainted cross-origin media falls back to `'none'`. |
| `brightness`, `contrast`, `gamma`, `invert` | `0`, `1`, `1`, `false` | Applied after levels. |
| `fit`, `focus` | `'cover'`, centre | `focus` moves the cover crop (0–1 on each axis). |
| `vignette` | `0` | Darkens toward the corners. |
| `drift`, `speed` | `0`, `1` | Slow ambient sampling drift keeps a still image alive; `speed` scales drift and generated scenes. |
| `hover` | `'fluid'` | `'fluid'`: an ink-in-water wake that bends the image and swirls the characters. `'lantern'`: a soft light that follows the pointer and lifts characters with no distortion. `'trail'`: the Asciify Trail, the same ink field as the studio's Trail hover: in the wake, sparse characters fill in and dense ones open up, then settle, with no distortion. `'none'`: still under the pointer. `FIELD_HOVERS` lists them with labels. |
| `trail` | `{ strength: 0.55, radius: 0.45 }` | Same meaning and defaults as the studio's Trail hover, so a look moves between renderers unchanged. |
| `lantern` | soft | `radius` (fraction of height), `strength`, `trail` (seconds its tail takes to fade), `follow` (how tightly the light catches the pointer). |
| `fluid` | on | Settings for the fluid hover; `false` turns it off. `radius` (fraction of height), `force`, `dissipation` (per second; higher settles sooner), `curl` (vorticity: how strongly the wake curls into eddies, 0 is a straight smear), `refraction` (how far the flow bends sampling), `glow` (how strongly the flow lights characters), `resolution` (simulation grid, longest side). |
| `respectReducedMotion` | `true` | Under reduced motion, drift and generated scenes stop and the wake bends a quarter as far. Video still plays unless you pause it. |
| `interactionTarget` | `window` | Where pointer movement is read. Use the hero element when it dispatches synthetic pointer events. |

`update(options)` merges and rebuilds only what changed (the atlas for type changes, the simulation for resolution changes). `setSource(source)` swaps media. `pointer(x, y)` moves the wake in CSS pixels relative to the canvas (`pointer(null)` lifts it), which is useful for an intro stroke. `redraw()` draws immediately, so you can copy the canvas with `drawImage` in the same task, for example to cross-fade between looks.

## Living or still

A photo with `drift: 0`, no video and a pointer that has left draws once and stops. Add `drift` (0.15–0.35) to let it breathe, use a video, or use a generated `scene` for continuous motion. Choose by the user's words and the context; [design-matching.md](design-matching.md#living-or-still) has the rules. Reduced motion stops drift and generated scenes; Lantern follows instantly and stops flickering.

## Performance and lifecycle

- One fullscreen pass draws the characters. The wake is an incompressible fluid on a 128-cell grid: splat, vorticity confinement, 20 pressure iterations and advection, about 27 tiny passes while the pointer is active and none once it settles. On dark ground any motion lights the characters; on lit ground the flow brightens one side of each eddy and opens the other into gaps. GPUs without float render targets get a single-pass wake instead. Nothing is read back to the CPU per frame.
- A still image with no drift stops drawing once the wake settles. Videos upload only new frames (`requestVideoFrameCallback` where available). Off-screen and hidden-tab fields stop.
- Measured in Playwright Chromium (Metal) on an Apple M4 Pro at 1440 × 900, device pixel ratio 2: a full-viewport photo field held 120 fps with a 9 ms 95th-percentile frame while the pointer moved continuously. Measure your own target devices; the number depends on the GPU, canvas size and cell size.
- WebGL2 on a GPU is required. `isGlyphFieldSupported()` returns false when there is no WebGL2 or when it runs in software (SwiftShader, llvmpipe), because software rendering would starve the rest of the page; pass `{ allowSoftware: true }` to opt in, and use `glyphFieldTier()` to tell the cases apart. `mountGlyphField` throws when no context is available: catch it and render a poster or the `/studio` renderer instead.
- If frames stay slower than 24 fps for about two seconds, the field drops to 1× pixels, then pauses ambient drift and generated scenes. The wake and video keep working.
- Call `destroy()` on unmount. It removes listeners and observers and frees GPU resources; it keeps the context so a framework can remount on the same canvas.
- Lost contexts restore automatically when the browser allows it.

## Accessibility

The canvas gets `role="img"` and `aria-label` from `label`. Keep real headings and text in the DOM above the field. Provide a static poster for no-JS and for the moment before `ready`.
