# GPU glyph fields (4.11)

For interface components and backgrounds, use `asciify-engine/kit` first ([applying-asciify.md](applying-asciify.md), [kit.md](kit.md)); it is built on this field and adds theme ink, posters, lazy mounting, the context budget and fallbacks. Mount the field directly only for a look the kit has no option for.

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
| `scene` | `'flow'` | Generated motion when there is no source: `'flow'` (domain-warped noise), `'drift'` (a few broad lobes, made for halftone, 4.12), `'swell'` (three crossing sine swells rolling diagonally, made for a fine dot grid), `'orb'` (lit sphere), the kit's background scenes `'caustics'`, `'contour'`, `'aurora'`, `'ripple'`, `'halo'`, `'interference'`, `'mesh'`, `'cascade'` and `'constellation'` (`FIELD_SCENES` lists them all), or `'none'` (blank, wake only). |
| `mark`, `dotScale` | `'glyph'`, `0.9` | `'dot'` draws a halftone: one circle per cell whose area follows tone, antialiased at any pixel ratio. `dotScale` is the largest dot as a fraction of the cell; about 0.6 keeps a calm, open grid. (4.12) |
| `mark` (Studio styles) | | `FIELD_MARKS` also holds the Studio's tile and print styles, drawn per cell in the composite pass from the cell's tone and colour (one shader branch each, no extra pass or texture). Tiles, which fade with tone in `color: 'ink'` and stay solid in `'source'`: `'pixel'` (filled cell), `'mosaic'` (gapped tile), `'lego'` (gapped brick lit from above, with a ringed stud), `'voxel'` (isometric cube, faces at 1, 0.72 and 0.42), `'disco'` (gapped tile, lit upper facet, shaded lower), `'hex'` (flat-topped hexagon), `'led'` (round lamp, soft halo, glint). `'dither'` lights a 4x4 Bayer screen of about five dots a cell. `'cmyk'` separates the cell's hue into offset cyan, magenta and yellow dots, with the neutral share as a key dot in the ink's own lightness. Print marks, whose size carries the tone: `'stipple'` (four jittered dots a cell), `'engraving'` (parallel cuts at -35°, running on across cells), `'crosshatch'` (two more directions join in darker tones), `'woodblock'` (broad carved bands in five steps, edges wavering), `'risograph'` (main ink and a coral second ink, offset), `'pointillism'` (four small strokes, their shade varied). `'tick'` lays a smooth wash under a fine screen of upright ticks, one a cell, each stepping through four strengths by a 4x4 ordered threshold and melting into the wash at the brightest tones (with `ramp`, the wash runs through the ramp and the ticks sit a step up it). `'inlay'` sets the tone's character into a gapped tile shaded by the tone, dark letters in light tiles, a speck where the tone is faint and a hairline grid in empty cells (the `ocean` look). Every mark but `'dot'` leaves blank the cells the `charset` leaves blank (its first glyph), so keep a ramp that starts with a space. Cells near square suit them best. |
| `markAngle` | `-35` | Screen angle in degrees for the line and print marks (`engraving`, `crosshatch`, `woodblock`, `risograph`), turning clockwise as CSS `rotate` does: 0 horizontal, 90 vertical, -45 rising to the right. (4.30) |
| `glyphOrder` | `'tone'` | `'text'` reads the charset after its blank in order along each row (each row a few letters on), so a phrase stays legible as text-as-art; the tone decides which cells show their letter, every one from 0.6, thinning below it through a 4x4 screen. (4.30) `'scatter'` gives each cell a fixed character picked from the charset and lets the tone set its opacity (glyph mark only). |
| `scale` | `1` | Feature size of generated scenes; higher is finer. Use about 1.8 on phones, where the field is tall. (4.12) |
| `clear` | `false` | Keeps the field quiet around content so text stays readable: an element, `{ element, padding, feather, shape }` (followed through layout changes), or a zone in field fractions (4.12); or `{ rects, padding?, softness?, strength?, bend? }` for a text-shaped clear map: `rects` (viewport CSS px, or a function returning them, read once per drawn frame) are quiet right behind, falling off over `softness` px (default 28) past `padding` px (default 8), by `strength` (default 0.85), the field bending away from their edges by `bend` (0–1, default 0.5) (4.32.2) |
| `charset` | `' .,:-=+*#%@'` | Ordered from empty to dense. Graphemes, so emoji, braille and block shading each take one cell. Up to 256. `CHARACTER_SETS` holds the curated ramps, each ordered by measured ink: `CHARACTER_SETS.fish.chars` (` .'-,:;txoSX%#8@`, the ocean's letters) and `CHARACTER_SETS.kanji.chars` (Kanji (Japanese): ` 一二人小大中日本目田長間語書曜驚霧`, common Jōyō kanji from light to heavy strokes) among them. Full-width glyphs (kanji, kana, Hangul) are drawn in square cells (`cellAspect` is raised to 1 for a `glyph` or `inlay` field whose set is mostly full width) and set in the system Japanese faces (`"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP"`), fitted evenly to the cell, never squeezed or clipped. |
| `ramp` | `[]` | A gradient map in ink colour mode: two to six `#rrggbb` stops the tone runs through, faintest first, in place of the one `ink`. The `tick` mark draws its wash in the ramp and its ticks a step up it (`ditherGradient`). |
| `cellSize`, `cellAspect` | `12`, `1` | Cell height in CSS px; width ÷ height. Monospaced ramps look best near `0.6`. Cells are whole device pixels, and glyphs are sampled texel for texel. |
| `cellFit` | `'pixel'` | `'pixel'` snaps each cell to whole device pixels, so a fractional `cellSize` rounds and rows drift from a renderer that does not. `'fill'` fits a whole number of cells of at least `cellSize` × `cellAspect` and stretches them to fill the canvas exactly, as the core renderer lays out a frame; each glyph stays texel for texel, centred in its cell. |
| `font`, `fontWeight`, `glyphScale` | monospace, `500`, `0.8` | Any loaded CSS font. The atlas is redrawn when the font finishes loading. |
| `color` | `'ink'` | `'ink'` uses `ink`; `'source'` takes each cell's hue from the media. |
| `ink`, `highlight` | `#f3ba32`, `'auto'` | Hex colors. The wake lifts characters toward `highlight`; `'auto'` brightens each character's own color so the wake keeps the artwork's hue. |
| `shade` | `0.5` | How much darker tones dim the ink, so same-density glyphs such as words still carry the image. |
| `saturation` | `1.1` | Source-color saturation. |
| `background` | `'transparent'` | Hex or `'transparent'`; the canvas is premultiplied. |
| `backdrop` | `0` | Opacity of a soft, blurred copy of the source under the glyphs. It is sampled from the mip chain, so it costs nothing extra. |
| `levels` | `'auto'` | Stretches the source's 2nd–98th luminance percentiles across the charset. Needs pixel access; tainted cross-origin media falls back to `'none'`. |
| `blend` | `'auto'` | Shades between two characters, mixed across neighbouring cells in a fixed 4x4 pattern, as print halftones do. `'auto'` turns it on for photo and video sources drawn in nine or fewer characters; drawn interface shapes stay crisp. `'on'`, `'off'` force it. Locked to the grid, so it never shimmers; one comparison per cell. |
| `brightness`, `contrast`, `gamma`, `invert` | `0`, `1`, `1`, `false` | Applied after levels. |
| `fit`, `focus` | `'cover'`, centre | `focus` moves the cover crop (0–1 on each axis). |
| `vignette` | `0` | Darkens toward the corners. |
| `drift`, `speed` | `0`, `1` | Slow ambient sampling drift keeps a still image alive; `speed` scales drift and generated scenes. |
| `hover` | `'fluid'` | `'fluid'`: an ink-in-water wake that bends the image and swirls the characters. `'lantern'`: a soft light that follows the pointer and lifts characters with no distortion. `'trail'`: the Asciify Trail, the same ink field as the studio's Trail hover: in the wake, sparse characters fill in and dense ones open up, then settle, with no distortion. `'loupe'`: a glass loupe glides after the pointer and magnifies the characters it covers through a soft rim. `'reveal'`: under a soft spotlight the characters take the source's own colours (best over a photo in one ink). Loupe and Reveal use the `lantern` radius, strength and follow. `'none'`: still under the pointer. `FIELD_HOVERS` lists them with labels. See `scope`. |
| `tap` | `'surface'` | How a press on a photo or video source answers, and what `pulse()` sends there. `'surface'`: a damped wave that travels over the picture itself, read from the source's light, depth, detail, water and sky (every frame for video): fast over water, sky and smooth areas, slow on detail, held back by strong edges and the subject's outline so it wraps round the subject; water carries it furthest with glints on the crest, sky swells softly, busy ground gives a short shudder, one front that settles behind itself with no bounce or echoes (4.32.1), and the front is shaded by the photo's own light so it reads as lying on the surface. `'ring'`: the plain expanding ring (presses send it too). `'none'`: presses do nothing (`pulse()` still sends the ring). Fields without a source, and drawn sources such as a canvas, keep the ring. Skipped under reduced motion; links, buttons and inputs never tap. |
| `scope` | `'all'` | Where the pointer response acts: `'all'`, `'subject'` (only on the source's subject) or `'outside'` (only on the ground around it). The subject is the source's alpha, or for an opaque source on a plain, even border its distance from that ground (the same detection as `/studio`), feathered at the edge; a busy photo and generated scenes act as `'all'`. Video re-reads the subject about six times a second on a 96-cell grid. Applies to every hover. |
| `trail` | `{ strength: 0.55, radius: 0.45 }` | Same meaning and defaults as the studio's Trail hover, so a look moves between renderers unchanged. |
| `lantern` | soft | `radius` (fraction of height), `strength`, `trail` (seconds its tail takes to fade), `follow` (how tightly the light catches the pointer). |
| `fluid` | on | Settings for the fluid hover; `false` turns it off. `radius` (fraction of height), `force`, `dissipation` (per second; higher settles sooner), `curl` (vorticity: how strongly the wake curls into eddies, 0 is a straight smear), `refraction` (how far the flow bends sampling), `glow` (how strongly the flow lights characters), `resolution` (simulation grid, longest side). |
| `respectReducedMotion` | `true` | Under reduced motion, drift and generated scenes stop and the wake bends a quarter as far. Video still plays unless you pause it. |
| `interactionTarget` | `window` | Where pointer movement is read. Use the hero element when it dispatches synthetic pointer events. |

`update(options)` merges and rebuilds only what changed (the atlas for type changes, the simulation for resolution changes). `setSource(source)` swaps media. `pointer(x, y)` moves the wake in CSS pixels relative to the canvas (`pointer(null)` lifts it), which is useful for an intro stroke. `redraw()` draws immediately, so you can copy the canvas with `drawImage` in the same task, for example to cross-fade between looks.

## Halftone for interfaces (4.12)

Product pages, docs, pricing and SaaS heroes want a background that is calm, works in light and dark themes, and never fights the copy. Use dots, the drift scene, a clear zone around the content, and `pulse()` for interface events:

```ts
const field = mountGlyphField(heroCanvas, {
  mark: 'dot', scene: 'drift', cellSize: 14, dotScale: 0.64,
  color: 'ink', ink: tokens.textMuted, background: 'transparent',
  clear: { element: heroCopy, padding: 40, feather: 0.18 },
  hover: 'lantern',
});
saveButton.addEventListener('click', () => field.pulse({ element: saveButton }));
```

- Ink: the muted text token, not the accent. On light grounds a mid grey such as `#9a988f`; on dark about `#5f5e58`.
- Clear zone: always set one when text sits over the field. Measure contrast at the busiest frame anyway.
- Pulse: one ring per meaningful event (saved, sent, connected), not on every click. It is skipped under reduced motion.
- Over a photo or video the pulse is a surface tap (see `tap`); pass `tap: 'ring'` for the plain ring there too.
- `pulse({ x, y })` takes CSS pixels relative to the canvas; `pulse({ element })` starts at the element's centre; no argument starts at the centre.


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
