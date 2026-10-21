# Changelog

Notable changes to `asciify-engine`, newest first. Releases are published to [npm](https://www.npmjs.com/package/asciify-engine) from version tags.




## 4.30: event-site pieces — morphField, globe, ditherGradient, ditherImage, scramble, assemble, spray

- New in `asciify-engine/kit`: `morphField` (frames, including drawing functions and video, that morph into one another as hatched lines or any mark; `next`, `go`, `onChange`), `ditherGradient` (soft lights as a two-tone dither on the element's own background, leaning toward the pointer), `globe` (a globe of dots with land, ocean, graticule and far side, turning, draggable, with `points` and `rotateTo`; built-in Natural Earth land mask, 2.7 KB) and `ditherImage` (an image in a brand's two tones as dither, pixels, dots or engraving, developing in when visible or with scroll).
- `decode`: `scramble` flips the headline through other alphabets (`SCRAMBLE_SCRIPTS`, or your own) before landing, drawn by the field in the element's font; `trigger: 'scroll'` ties the decode to scroll position and idles while the page is still.
- `wordmark`: `assemble: 'visible' | 'scroll'` gathers the word out of scattered pieces as it comes into view.
- `cursorTrail`: `style: 'spray'` sprays patches of diagonal hatching round the path and draws a hatched box while dragging; `readout: true` adds coordinate tags.
- Field: `markAngle` sets the screen angle of the line and print marks (default -35, as before); `glyphOrder: 'text'` reads the charset in order along each row, so repeated words stay legible as text-as-art.
- Skill: kit.md "Event-site pieces" with an event-site header, hero and footer recipe; applying-asciify.md section 9b; scenario prompts 20 and 21.

## 4.29: cursorTrail's trail is the field trail

- `cursorTrail({ style: 'trail' })` now draws the same ink trail as a kit field's `hover: 'trail'` (the wordmark's), with the wordmark's glyphs, so the page cursor and a field's own trail read as one. New `trail: { strength, radius, span, cell }` sizes it to match a given field: `span` is that field's shorter side and `cell` its longer side / 128, in CSS pixels. Still idle once the last character fades. `wake`, `water` and `sparkle` are unchanged.
- `InkTrail` takes an optional `span`, the cells its brush is measured against.

## 4.28: cursorTrail, an ASCII cursor for the whole page

- New: `cursorTrail()` in `asciify-engine/kit` puts a page-wide cursor trail on any site in one call: `cursorTrail({ style: 'trail' | 'wake' | 'water' | 'sparkle', ink, charset, cellSize })`. One fixed, click-through layer on the shared GPU context, mounted on the first pointer move and drawing only while something fades. Off on touch, under reduced motion and in hidden tabs; quiet over inputs, dialogs and `[data-ascii-cursor-skip]`. Returns a handle with `update`, `clear`, `pause`, `play` and `destroy`.

## 4.27.1

- Fixed: kit components drawing an `<img>` that uses `srcset` (compare, image accordion) took only the top-left part of the file, because `naturalWidth` is density-corrected while a source rectangle is read in file pixels. `drawCover` now places the whole image, so the before/after slider lines up across the divider.
## 4.27: Smooth dot looks and steady hover

- LED (Scoreboard), Dots and Stipple draw in one instanced GPU pass, like Pointillism, instead of thousands of Canvas 2D fills per frame: Scoreboard's hover costs 5 ms instead of 12, Lookbook goes from 93 to 120 fps. Output matches within the parity tolerance; frames mixing sub-pixel dots fall back to Canvas 2D exactly.
- Hover pacing steps down only when a look's own frames are late for several frames, ignores one-off stalls, and returns to full rate within a second (it used to wait up to 16 s). A new hover starts at full rate.
- `npm run bench:looks` fails a look whose hover cost regresses past its recorded budget.
## 4.26.1

- Fixed: the pill's hover sparkle could read a character before the start of its set (progress slightly below zero) and throw.
## 4.26: Studio off the main thread, live while scrolling

- Kit fields mount while the page scrolls instead of waiting for it to rest: within two viewports ahead, scroll direction first, at most two mounts per frame inside a 4 ms budget, with glyph atlases prewarmed at idle. A poster swaps for its canvas in the same frame the first frame is drawn, so a host is never blank, and paused fields keep their last frame.
- Fixed: the kit bundled its own copy of the field's shared context, so kit fields ran a second context and frame loop and were still held to the old 12-context cap. The build now fails if a kit chunk carries its own copy.

- `mountStudio` and `mountStudioMedia` draw in workers on `OffscreenCanvas`. The page keeps the pointer and posts only input; frames come back as `ImageBitmap`s and are shown without a copy, one per display frame. No first frame or hover is a long task on the page any more (a /looks card's first live frame was a 100 ms task).
- Hover draws at the display's rate (120 Hz on ProMotion) for every look: workers take turns drawing frames (as many as the first frames' cost needs, up to three, within 6 megapixels of frames in all), each applying the same input so their hover state is identical; and Pointillism fills its dots on the GPU the way Chrome's canvas does (same polygons, same 4x multisampling). Pointillism hover: about 110 ms → 6 ms a frame. If the browser's own frames slow down under the raster load (CMYK's multiplied dots in a large frame), hover backs off to every second frame or less, so the page stays at the display's rate.
- Output is unchanged: `tests/studio-parity-browser.mjs` compares every look, at rest and along a hover path, in light and dark, against the previous release; Pointillism matches within rounding.
- The worker's script is its own chunk (`studio-worker.js`, about 47 KB gzip), fetched with the first mount's media. Without `OffscreenCanvas` 2D, or if the worker cannot start, the Studio draws on the page as before. `createStudioRenderer` is unchanged and still draws on the calling thread. Public API unchanged.

## 4.25: one shared context, bounded memory

- Every glyph field and kit surface on a page now draws through one shared WebGL2 context and one frame loop. Programs compile once, atlases are shared per glyphs/font/size, and one set of page listeners and observers serves every field. Output is pixel-identical.
- Static fields draw once. Ambient motion slows when frames are expensive, and render scale steps down (1 → 0.5) before frame rate drops. Mounts wait while the page scrolls.
- GPU memory is budgeted at 256 MB per page: off-screen kit fields fall back to posters, farthest first, and unused atlases are evicted. The shared context is released 3 s after the last field.
- Fixed: more than 12 `lazy: false` fields fought over the context budget forever, growing memory without bound. Fixed: `destroy()` left a context on user canvases. The Studio surface shader no longer blocks the page (241 ms → 5 ms), and GIF frame extraction yields between frames.

## 4.24: Lighter on the host page

- The kit is split per component: a host importing one component ships about 33 KB gzip instead of 99 KB. Existing imports are unchanged.
- Animating components draw once per frame (they drew twice), ambient motion is capped at 60 fps (30 on low-end devices or Save-Data) while interactions keep the full rate, and at most one field mounts per frame, so mounts never stack into a long task.
- Studio hover redraws at most 60 times a second and never takes more than half the main thread. Off-screen core video loops stop, zero-size fields stop, the backing store is capped at one 4K screen, and `destroy()` removes every listener.
- See `references/performance.md` in the skill for what the engine promises host apps.

## 4.23: Dialogs always render, sharper motion cues, cleaner hovers

- Kit fields inside an open modal dialog always get a WebGL context: fields covered by the dialog give theirs up and come back when it closes. A released field hands its canvas back at once (Safari counts dead contexts toward its limit), and a field whose context is lost recovers onto a fresh canvas.
- Depth is fused from focus, haze, a horizon prior, texture and saliency with an edge-aware filter; Drift finds water (including non-blue seas by reflection), sky, cloud and falling water, and holds everything else still. The classic core renderer shares the same motion code. Analysis follows grid changes and reads the ungraded photo.
- Water settles cleanly; Ripple and Emboss draw their own rings on dark or transparent ground; glyph fields take `scope`; video subjects update as the video plays; the hover catalog (`HOVER_CONTROLS`, `DEFAULT_HOVER`, `resolveHover`) is exported once. On the GPU path, Trail keeps the artwork's ground and Water moves whole cells.

## 4.22: Photo-aware motion and finish

- A new set of still-image motions read the photo's own light, form, highlights, detail and estimated depth: `relight`, `sheen` (specular sweep), `glow` (highlight bloom), `shimmer` (glints), `parallax`, `push`, `focus`, `mist`, `current` (drift) and `develop`.
- Retired motions keep working through `DEPRECATED_STUDIO_MOTIONS`: caustics → sheen, grain → shimmer, trace → relight, tidal/weave/breeze → current, reform/print/unfold → develop.
- Optical finish: bloom is a wide soft glow around highlights, and grain is fine film grain weighted to the midtones.
- Animation presets are re-paired with the new motions, plus a new Depth study.

## 4.21: Hovers that know the subject

- Six new hovers: `loupe`, `reveal`, `repel`, `tilt`, `haze` and `bleed`; `scatter`, `elastic` and `ripple` are refined, and `rake` is deprecated (it plays `silk`).
- Every hover takes `decay` (how long it lingers) and `scope: 'all' | 'subject' | 'outside'`: the subject comes from transparency, a drawn mask or an even plain ground, with a feathered edge; a busy full-bleed photo acts as `all`.
- Hovers ease in, settle when the pointer stops, follow touch drags and stay off under reduced motion.
- `mountHover` now runs on the GPU in Chrome (a reserved word in its shader forced the 2D fallback).

## 4.20: Sharper presets, 61 looks, twelve backgrounds

- Studio presets `ascii` (Signature ASCII) and `night` (Night signal) are retuned: finer 4px cells, brighter inks, lifted midtones and a faint glow.
- The woodblock print style no longer leaves pale seams between cells.
- `aurora` joins the deprecated backgrounds (closest current preset: `mesh`), leaving twelve curated presets; `halo` fits tall stages, `caustics` is calmer in small cards and `wordField` reads on small dark stages.
- The skill's `looks.md` covers 61 looks, adding Projects looks for album covers, editorial portraits, product heroes, posters, postcards, botanical plates, lookbooks, game box art, stickers and phone wallpapers, each with its export size and frame.

## 4.19: A curated set of backgrounds

- New presets `halo`, `ripple`, `mesh`, `interference`, `constellation` and `cascade`; `caustics`, `contour` and `aurora` are rebuilt on the GPU. All follow `setGlobalLook`, keep a quiet zone behind content and hold a still frame under reduced motion.
- `cursor: false` turns pointer interaction off for every preset. `mark: 'glyph' | 'dot'` draws any preset in characters or dots; `swell` keeps dots by default.
- Dated presets (`dna`, `circuit`, `fire`, `grid`, `morph`, `noise`, `pulse`, `rain`, `silk`, `stars`, `terrain`, `veil`, `void`, `wave`, `weave`, `dune`, `etch`, `facet`, `moire`, `halftone`) stay exported but are deprecated; the kit reference names the closest current preset for each.
- Switching presets no longer leaves the previous preset's poster covering the new one.
- `pageDissolve` draws its settled blocks in one masked pass and snapshots at 1x on touch devices, so the wave stays light on phones.
- The skill's `looks.md` now covers 47 artwork looks, every render style, plus composed (blur, transparent, gradient) and finished (vignette, grain, bloom, scanlines) looks.

## 4.18: 24 render styles in every live field, artwork looks, smoother components

- Glyph fields draw the Studio's tile and print styles: `mark` accepts `pixel`, `mosaic`, `lego`, `voxel`, `disco`, `dither`, `hex`, `led`, `cmyk`, `stipple`, `engraving`, `crosshatch`, `woodblock`, `risograph` and `pointillism` (see `FIELD_MARKS`), one shader branch each.
- `setGlobalLook({ style })` re-skins every opted-in kit field in any of the 24 Studio styles (`KIT_STYLES`); `charset` still works alongside.
- New background preset `swell`: a halftone dot field in slow crossing waves, quiet behind the content, swelling under the pointer.
- Reworked kit components: `blockChart` (crisp glyph columns, scrubbing, morphing ranges), `commandPalette` (gliding selection, resolving rows, AI shimmer), `toastStack` (no outlines, layered stack, swipe to dismiss), `pill` and `tabs` (glyph status dots, gliding indicator, rolling figures), `pageDissolve` (one continuous wave), `imageGenerate` (one develop curve), `accordion` (one spring per panel, hover intent), `pullRefresh` (an iOS-sized ring), `dropzone` (a quiet ring that comes alive on drag-over).
- The skill gains `references/looks.md`: 22 artwork looks with prompts and settings for wallpapers, posters and hero art.
- Studio defaults are paper and graphite instead of yellow; the default characters are Classic ASCII.

## 4.17: A thinking label that rolls

- `thinking` drops the dot bands and the dotted rule. A wave runs through the status label instead, each letter rolling up through glyphs and back in the label's own font; when the answer starts, the label rolls into `Thought for 2s`. New options `roll`, `wave` and `glyphs`; `lines` and `rule` are ignored.

## 4.16: Smooth shading in every charset, rolling streamed text

- Glyph fields gain `blend` (default `'auto'`): with nine or fewer characters, a photo or video mixes neighbouring characters in a fixed 4x4 pattern for the shades between them, so binary, dots and block sets shade like a full ramp. Drawn interface shapes stay crisp. It costs one comparison per cell and never shimmers.
- `streamText(el, { transition: 'roll' })` rolls each character up through glyphs into the crisp letter, like the odometer, with the caret on the front of the roll.

## 4.15: Every charset at the same weight, inks from your tokens

- `setGlobalLook({ charset })` measures the set's ink against classic ASCII and balances it: block and solid sets draw smaller glyphs and keep their detail, sets without light glyphs ease off, and faint sets draw larger, bolder glyphs. Tones are untouched.
- Kit inks default to `--ascii-ink-strong`, and with that unset, to the element's own text colour, so components follow the page's tokens instead of a fixed grey.
- `skeleton` reads its blocks' shapes from CSS (an image's radius; one bar per line of text, as wide as the words) and its shimmer is a continuous wave until `resolve()`.
- A hidden (`display: none`) field gives its WebGL context to fields on screen.

## 4.14: Backgrounds in the kit, site-quality components

- **`background(el, { preset })`** brings all 26 asciify.org backgrounds into the kit: drift, halftone, wordField and fluid on the GPU field, and 22 canvas presets (caustics, contour, facet, etch, moire, weave, veil, dune, wave, aurora, noise, silk, rain, stars, pulse, grid, voidWell, morph, fire, dna, terrain, circuit). Presets are separate imports, so a page pays only for the ones it uses, and each matches the /backgrounds page's rendering.
- **The site now runs on the kit.** Every component demo on asciify.org is the kit itself, so what you see is what you install. Where the kit was weaker than the hand-built demos, the kit was raised to match.
- **Performance and integration:** fields mount lazily near the viewport and release far from it, a page-wide budget keeps at most 12 WebGL contexts live, `poster` shows a still for first paint and as the no-GPU fallback, `setGlobalLook({ charset })` re-skins every glyph field at once with a short sweep, and `update({ ink, look })` merges per instance.
- **New guide:** [applying-asciify.md](skills/asciify-engine/references/applying-asciify.md) teaches agents the house design: which component or background to use, text over fields, ink, radius, motion, performance and a finishing checklist.

## 4.13: The kit, interface components in one call

`asciify-engine/kit` turns Asciify's interface components into short, customisable calls on the GPU field. Each one follows its element's size and border radius, takes ink from your CSS variables in light and dark, honours reduced motion, pauses off screen, leaves your HTML working without WebGL2, and cleans up with `destroy()`.

```ts
import { beam, buttonLoading, statusOrb } from 'asciify-engine/kit';

const b = beam(card, { palette: 'colorful', mode: 'progress' });
b.progress(0.6); b.success();

const save = buttonLoading(saveButton, { text: 'Save' });
save.start('Saving'); await request; save.succeed('Saved');
```

Thirty components ship in the kit: beam, decode, odometer, buttonLoading, statusOrb, skeleton, pill, tabs, imageGenerate, voiceOrb, commandPalette, slideToConfirm, likeBurst, blockChart, pageDissolve, swipeDeck, codeInput, toastStack, thinking, streamText, compare, accordion, dropzone, disintegrate, pullRefresh, fieldBackground, wordmark, asciiVideo, artPanel and pricingGlow. Unused components tree-shake away; each adds about 2–4 kB gzipped on top of a 3.5 kB shared core and the `/field` entry. See [kit.md](skills/asciify-engine/references/kit.md), and [components.md](skills/asciify-engine/references/components.md) for the prompt and snippet of every component.

## 4.12: Halftone fields for interfaces

`mark: 'dot'` turns the GPU field into a halftone: one circle per cell, its area following the tone, crisp at any pixel ratio. The new `drift` scene draws a few broad, slow lobes; `clear` keeps the field quiet around an element so copy stays readable; `pulse()` sends a ring through the dots when your interface wants to answer an event.

```ts
const field = mountGlyphField(canvas, {
  mark: 'dot', scene: 'drift', cellSize: 14, dotScale: 0.64,
  ink: '#9a988f', background: 'transparent',
  clear: { element: document.querySelector('#hero .copy') },
});
saveButton.addEventListener('click', () => field.pulse({ element: saveButton }));
```

Also in 4.12:

- **Even quality across styles.** Character styles stretch each image's tones to its own range and pick glyphs by measured ink, so dark or flat images keep their subject in every character set and look. Set `color.levels: 'none'` for the previous linear mapping. Adaptive resolution only steps down while frames are genuinely over budget, and returns to full detail when motion settles.
- **Faster fields.** Image sources decode off the main thread and are scaled to what the cells can show; scene maths runs once per cell; shaders compile without blocking. `ready` resolves for fields mounted off screen, and a shader link failure is reported through `onError`.
- **4.12.1:** fields size themselves from layout, so a parent's transform (a dialog scaling open) no longer stretches them.
- **31 ready-made components in the agent skill** ([components.md](skills/asciify-engine/references/components.md)): controls, feedback, AI states, transitions, data, media, text and pages, each with the prompt and the reference code. See them running at [asciify.org/components](https://asciify.org/components).

## 4.11: GPU glyph fields

`asciify-engine/field` renders an image, a video or generated motion as characters entirely on the GPU, with three cursor responses: `trail` (the Asciify Trail, the same ink field as the studio's, now on the GPU), `fluid` (an incompressible ink-in-water wake that curls into eddies) and `lantern` (a soft light with no distortion). Use it for full-bleed heroes and brand fields that must stay smooth while people move over them. Characters are drawn texel for texel from a glyph atlas, so any font and any charset work, including your own name.

```ts
import { mountGlyphField } from 'asciify-engine/field';

const field = mountGlyphField(canvas, {
  source: '/media/hero.mp4',
  charset: ' .,:-+ACME',
  color: 'ink', ink: '#f3ba32', shade: 1,
  fluid: { radius: 0.08, refraction: 0.03, glow: 0.6 },
});
// field.update({ charset: ' .:ASCIIFY' }); field.destroy();
```

It needs WebGL2 on a GPU: `isGlyphFieldSupported()` is false without it or on software WebGL, and slow devices step down to 1× pixels and then still ambient motion. Keep a poster or the `/studio` renderer as the fallback. A still field stops drawing once its wake settles. Measured in Playwright Chromium on an Apple M4 Pro at 1440 × 900 and device pixel ratio 2, a full-viewport field held 120 fps (9 ms 95th-percentile frame) under continuous pointer movement; measure your own targets. See the [field guide](skills/asciify-engine/references/glyph-field.md) and [brand field example](examples/glyph-field.ts). It is a separate entry: the root, `/core`, `/hover` and `/studio` never load it.

## 4.10: More life for still images

Three additional pointer responses—Lens wake, Smudge and Ripple rings—and four autonomous motions—Relight, Shimmer, Breeze and Unfold—bring the catalogs to 14 each, plus Off. Source images, art styles and colors remain yours. Six editable combinations in `STUDIO_ANIMATION_PRESETS` help choose a starting point without replacing your look.

```ts
import { STUDIO_ANIMATION_PRESETS } from 'asciify-engine/studio';
const preset = STUDIO_ANIMATION_PRESETS.find(p => p.id === 'quiet-light')!;
player.update({ motion: preset.motion, hover: preset.hover });
```

Use one Studio player for live rendering, settings persistence and independent animation export. See [the complete interaction guide](skills/asciify-engine/references/studio-effects.md#lively-images-410) and [living-image helper](examples/living-image.ts). CPU simulation is bounded and wakes settle; device frame rates and visual fidelity still require browser measurement. Existing defaults and saved IDs are unchanged.

## 4.9: Print and illustration

Stipple, Engraving, Crosshatch, Woodblock, Risograph and Pointillism add distinct print geometry to `/studio`. All share hover, living-image motion, masks, source shaping, saved settings and exports. Tune coverage, mark weight, angle, repeatable texture, light/dark ink polarity and two-ink registration with `print`. Use `STUDIO_PRINT_STYLES` for labels and [the print guide](skills/asciify-engine/references/print-styles.md) for a live still-image example, bounds and performance limits. ASCII remains the default.

## 4.8: Layered projects

Compose up to eight image, video, GIF or text layers with independent styles, motion, hover, placement, opacity and blend modes. `mountStudioProject` owns one playback loop and a shared cell/raster budget; hidden and unchanged layers skip work. Root/core/hover entry points remain unchanged.

```ts
import { mountStudioProject } from 'asciify-engine/studio';
const player = await mountStudioProject(canvas, { layers: [
  { id: 'photo', source: 'image', settings: { motion: { type: 'parallax' } } },
  { id: 'title', source: 'text', placement: { width: .8, height: .25 },
    settings: { ink: '#b3ed82', hover: { effect: 'elastic' } } },
] }, { image: '/your-photo.webp', text: { text: 'HELLO', font: 'Small' } });
player.updateLayer('photo', { settings: { hover: { effect: 'water' } } });
// player.destroy() on unmount
```

`exportStudioProject` owns independent export media, so it does not disturb the live preview. Save layouts with `serializeStudioProject`, retain/rebind source assets separately, and restore with `parseStudioProject`. See the [layered-project guide](skills/asciify-engine/references/layered-projects.md) and [typed live/export example](examples/layered-composition.ts) for geometry, picking, ownership, cancellation and performance limits. This is an optional local composition API, not a claim of complete competitor-style or FPS parity.

## 4.7: Ordered source shaping

Combine up to eight source transformations before ASCII, dither or any Studio style: Twirl, Pinch, Spherize, Ripple, Zigzag, Shear, Smudge, Polar and Fragment. Edit strength, position and radius, plus direction/frequency where applicable. Reorder or disable stages without losing their settings; choose extended or transparent edges. Generate controls from `STUDIO_WARPS` and `MAX_STUDIO_WARPS`.

```ts
player.update({
  warps: [{type:'sphere',amount:.3,radius:.7}, {type:'shear',amount:.15,angle:25}],
  warpEdge:'clamp',
  motion:{type:'parallax',amount:.5},
});
```

The stack is static shaping; motion and pointer hover remain independent. Coordinate maps are cached across video frames, and stills reuse shaped pixels during interaction. Empty stacks are free of additional pixel work. Defaults and root/core/hover behavior remain unchanged. Dither motion also gains alpha-correct interpolation at transparent edges. See [parameters, order, persistence/export and measured CPU tradeoffs](skills/asciify-engine/references/source-shaping.md).

## 4.6: Channel curves and source noise reduction

Studio adds editable RGB, red, green and blue curves, with up to 16 control points each, plus optional edge-preserving source noise reduction. They apply before every render style and travel with saved settings and exports. Defaults preserve existing output. Curves use small cached lookups; still images reuse filtered pixels while hover/motion run. Dense video filtering is an explicit CPU tradeoff.

```ts
player.update({color:{
  denoise:.25,
  curves:{rgb:[[0,0],[.25,.2],[.75,.8],[1,1]]},
}});
const settings = player.settings; // detached snapshot for save/export
```

See [settings, normalization, processing order and performance guidance](skills/asciify-engine/references/studio-workspace.md#channel-curves-and-source-noise-46). Curves are local source controls, not another art-style alias or AI restoration.

## 4.5: Tonal detail and blue-noise dithering

Studio adds `dither.algorithm: 'blue-noise'`: a stable precomputed dispersed pattern with no runtime generation or asset download. `noise` remains white noise. Choose the algorithm from `DITHER_ALGORITHMS`; drift and shimmer remain independently controlled.

Recover usable shadow/highlight separation before conversion with `color.gamma`, `shadows`, `highlights`, `blackPoint` and `whitePoint`. All Studio styles share these controls and retain neutral defaults. They are a bounded monotone tonal curve, not arbitrary per-channel curve editing. See [exact ranges, sampling budgets and a live-project example](skills/asciify-engine/references/studio-workspace.md#tonal-detail-and-blue-noise-45).

## 4.4: More ways to bring photos to life

Eleven pointer interactions and ten autonomous motions, plus Off. Emboss presses paired light and shadow into a fixed character grid; Elastic stores directional momentum and springs back; Rake combs the source into alternating ribbons. Parallax, Woven Flow, Print Shift and Contour Light join the still-image motions. Contour Light follows the actual source tones.

```js
import { STUDIO_HOVERS, STUDIO_MOTIONS } from 'asciify-engine/studio';
// value / label / group / description: use these to build a complete picker.
player.update({
  motion: { type: 'parallax', speed: 1, amount: .7 },
  hover: { effect: 'elastic', radius: .45, strength: .65 },
});
```

All motion choices repeat every `12 / speed` seconds. Still exports preserve the selected preview phase; animated exports include motion without pointer events. Grain, dust, glitch, animated dither and source video have separate timing. No external AI service is used. See [effect integration](skills/asciify-engine/references/studio-effects.md).

## 4.3.1: Studio correctness and performance

Stationary compositions are reused during animated finishing. Hidden dither settings and zero-strength motion no longer keep still previews awake. Ordered dithering uses cached thresholds with byte-identical output; Scatter caches its spatial noise. CMYK now responds to tonal hovers and still motion. For a selected PNG/JPEG frame after changing motion speed, pass `time: player.time` and `motionTime: player.motionTime` to `exportStudio`. See the packaged project-integration skill reference for a live component and independent image/video export.

## 4.3: More motion for still images

Studio includes six still-image motions plus Off: Caustics, Slow Current, Reveal & Reform, Sheen, Tidal Rings, and Living Grain. Sheen and Living Grain preserve the grid. Motion speed and strength are adjustable. Hover adds Magnetic Pull and Scatter alongside Trail, Water, Contour, Dissolve, Silk, and Vortex. Use `hover.effect` in Studio or `effect` in the optional `/hover` module; configure radius and strength separately. Existing defaults remain unchanged.

## 4.2: Studio detail controls

The optional `asciify-engine/studio` entry includes 24 render styles, including hex mosaic, LED matrix and CMYK print. Dither supports pixel scale, custom palettes, RGB/luminance mapping, pattern speed and direction. Use `studioGrid` to report effective density and opt into a larger `maxCells` budget for one-pixel output; defaults stay performance-bounded. Mounts expose `setAdaptive` for an explicit detail/performance choice. Still-image motion has `amount`, and finishing adds `rgbSplit` and `sharpen` (WebGL required). See the [complete controls and export guidance](skills/asciify-engine/references/studio-workspace.md#fine-detail-and-controls-42). No AI service or server upload is introduced.

## 4.1.0: Current catalogs only

This release removes `CHARSETS`, `ART_STYLE_PRESETS`, `CHARSET_SEQUENCES`, `LIVING_STYLE_PRESETS`, and their key types. **Although numbered 4.1.0 at the maintainer's request, these removals are breaking changes.** Update imports before upgrading. Removed core `artStyle` shortcuts throw with migration guidance.

Use `STUDIO_STYLES` from `asciify-engine/studio` for the 15 current render styles: ASCII, Braille, Dots, Lines, Blocks, Dither, Cross, Diagonal, Diamond, Mixed, Pixel, Mosaic, Lego, Voxel and Disco. Set `settings.style` with `mountStudio` / `createStudioRenderer`; these styles are actual rendering methods, not character ramps. Core media APIs remain ASCII-first.

Use `CHARACTER_SETS.standard.chars` (or another curated entry) from root or `/core` for an ASCII ramp; custom `options.charset` and `charsetFrames` arrays remain supported. Use explicit `options.colorMode`, `renderMode`, and hover/motion settings instead of the removed combined presets. No legacy catalog has been moved to a hidden compatibility bundle.

## 4.0: Optional background templates

Procedural backgrounds no longer ship in the npm package or root exports. Download only the template you want from [the background gallery](https://asciify.org/backgrounds); its copied code and lifecycle belong to your application. Existing 3.x applications can remain pinned while migrating. `/backgrounds`, `asciiBackground`, `BACKGROUND_TYPES`, and procedural `render*Background` exports are removed; text/media background APIs remain. The default import and `/core` now expose the same media-first API. `CHARACTER_SETS` is the lightweight curated catalog shared by the hero and editor.

## 3.0: Still-image motion

Use `motion: { type: 'current', speed: 1 }` with `/studio`, `motion: 'current'` with `/hover`, or `animationStyle: 'current'` with core. Choose one motion owner. The curated set is Off (`none`), Caustics (`caustics`, fixed-grid light), Slow Current (`current`, local flow), and Reveal & Reform (`reform`, staggered dissolve). All loop every 12 / speed seconds and preserve your chosen colors. Breathe, Fire, Rainbow and other old ambient motion IDs are retired. Old Studio presets restore with motion Off; update application-owned core options explicitly. Hover effects and optical finishes are independent. See [the 3.0 migration guide](skills/asciify-engine/references/upgrading.md).

## 2.0.1: Size and export fixes

`studioGrid` exposes the effective grid and minimum cell size for a bounded preview. Dither uses `dither.scale`; other styles use `cellSize`. Pass `time` to `exportStudio` for a PNG/JPEG of the current frame. Animation exports continue to start at zero. See the Studio guide for the shared preview/export density contract.

## 2.x: Studio composition tools

The `asciify-engine/studio` entry adds a reusable composition pipeline: alternate render styles, palette dithering, crop and masks, source/blurred/gradient backdrops, combined optical effects, saved looks, text fonts, and PNG/JPG/GIF/MP4/WebM export. Existing ASCII defaults and `/core` and `/hover` imports stay unchanged. Fonts and video encoders load on demand.

```ts
import { mountStudio } from 'asciify-engine/studio';

const studio = await mountStudio(canvas, '/your-video.mp4', {
  settings: {
    style: 'ascii',
    backdrop: { mode: 'blurred', opacity: 0.4 },
  },
});
studio.update({ hover: { effect: 'water', radius: 0.35 } });
// On unmount:
studio.destroy();
```

See the [Studio API guide](skills/asciify-engine/references/studio-workspace.md) for complete settings, import/export, media ownership, browser requirements, and performance budgets.

## 1.3.0: Hero finish

Version 1.3.0 adds text-shaped charcoal cutouts (`textMask`), peripheral scanline/fringe control (`edgeEffect`), fixed accent ink, and velocity-driven Trail source flow. These additions ship in **npm 1.3.0**. Upgrade older applications before using them. See the [complete API, layering example, lifecycle, and fallback limits](skills/asciify-engine/references/hero-finish.md).

## 1.2.0: Website hovers

Since **1.2.0**, import the enhanced interactions through `asciify-engine/hover`. No extra download is needed. This optional entry leaves root and `/core` browser bundles unchanged.

```js
import { asciify } from 'asciify-engine/core';
import { mountHover } from 'asciify-engine/hover';

// <div id="art" style="position:relative;width:fit-content">
//   <canvas id="ascii" style="display:block"></canvas>
// </div>
const host = document.querySelector('#art');
const canvas = document.querySelector('#ascii');
const charset = ' .:-=+*#%@';
const stop = await asciify('/image.jpg', canvas, {
  fontSize: 7,
  options: { charset, charAspect: 0.58, hoverStrength: 0, animationStyle: 'none' },
});
const hover = mountHover(host, canvas, {
  effect: 'trail', strength: 0.55, radius: 0.2,
  fontSize: 7, charAspect: 0.58, charset,
});
// Switch: hover.update({ effect: 'water' });
// Redraw a still: hover.invalidate();
// On unmount: hover.destroy(); stop();
```

Effects: **Trail, Water, Contour, Dissolve, Silk, Vortex, Magnetic Pull, Scatter, Emboss, Elastic, Rake**, and `none`. Inspect `STUDIO_HOVERS` for typed IDs and behavior groups (4.4+). Pass `effect` to `mountHover`, rather than passing these names to the legacy engine `hoverEffect` option. Keep engine hover and animation disabled to avoid stacking two renderers. Match `fontSize`, `charAspect`, `charSpacing`, `charset`, `customText`, and dot settings to the backing canvas.

For video/GIF, set `animated: true, fps: 24` and coordinate `paused` with playback. For a still, optional `motion: 'caustics' | 'current' | 'reform'` (or the other IDs in `STUDIO_MOTIONS`) adds living-image motion; `fineDither: true` enables stationary grain. `mountStudioHover` remains an alias for the existing standalone integration. The module observes reduced motion, sleeps when idle/offscreen, and uses Canvas 2D when WebGL is unavailable (simpler spatial refraction). Call `destroy()` on unmount; use `hover.canvas` for overlay layering or snapshots.

See the [complete integration and lifecycle guide](skills/asciify-engine/references/studio-effects.md). A [standalone ES module](https://asciify.org/background-sources/studio-hover.js) remains available for projects without a bundler.

## Earlier notes

`waveField` now animates the supplied media rather than replacing it with a generated scene. For the previous procedural scene, download the Wave template from https://asciify.org/backgrounds.

