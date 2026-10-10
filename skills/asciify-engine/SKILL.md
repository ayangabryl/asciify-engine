---
name: asciify-engine
description: Build and tune browser ASCII art with asciify-engine so it fits the user's request, preferences and the project's design. Use for photo, video and GIF conversion, interactive heroes, GPU character fields with the user's own words, ambient backgrounds, text banners, art styles and export, hover and motion choices, layered HTML typography, and rendering performance.
metadata:
  tested-engine: "4.11.0"
  updated: "2026-10-09"
---

# Asciify Engine

Use the published `asciify-engine` npm package for browser canvas rendering. Tested against **4.11.0**. Check the application's installed version and its public types before using newer options; a local checkout can contain unpublished changes.

- Agent entry: https://asciify.org/skill (redirects to this Markdown document).
- Playground: https://asciify.org/editor
- API documentation: https://asciify.org/docs/api
- Repository: https://github.com/ayangabryl/asciify-engine

```sh
npm install asciify-engine@latest
```

Entries: `asciify-engine` and `/core` for media and text conversion; `/hover` for the website hovers and living-image motion; `/studio` for art styles, looks and export; `/field` for GPU character fields. Each optional entry loads only when imported. Procedural background templates are downloaded from asciify.org/backgrounds and are not npm exports. GIF decoding loads `gifuct-js` when a GIF API is called.

## Start here: the request, then the design

Most requests are a feeling ("make the hero feel alive", "retro", "subtle behind the pricing", "like unseen.co, with our name") rather than an API. Before writing code:

1. **Read the request.** Subject (their media, a word, or nothing), placement (hero, background behind text, card, banner), mood words, interaction, and any reference site.
2. **Read the design.** Open the project's tokens (CSS custom properties, Tailwind theme, brand file): page background, text colors, the one accent, mono and display fonts, light/dark themes, motion durations and easing, reduced-motion handling.
3. **Pick the tool** from the table below, then **derive every color, font and size from the tokens**. Never add a new brand color, a black canvas on a light site, or a white hover glow on a colored artwork.
4. **Decide living or still.** A still photo can be made to feel alive (field `drift`, studio `motion`), but some users want it still. Follow their words; keep art behind text, in grids and in data views still; reduced motion always gets a still. See [living or still](references/design-matching.md#living-or-still).
5. **Say what you chose in one line** and offer one alternative. Ask only when the media is missing or motion would be new to a site that has none.

[references/design-matching.md](references/design-matching.md) maps mood words to settings, explains light themes, contrast and fonts, and gives tested recipes for the common requests. Read it whenever the user describes a look rather than an option.

| The user wants | Use |
| --- | --- |
| Their photo, video or GIF as ASCII on the page, optionally answering the cursor | `asciify` / `asciifyVideo` / `asciifyGif`, plus `mountHover` from `/hover` for the website hovers |
| A full-bleed hero or brand field that stays smooth under the cursor, or their own word as the characters | `mountGlyphField` from `/field` ([glyph-field.md](references/glyph-field.md)); `hover: 'trail'` for the classic Asciify Trail on pure characters, `'fluid'` for bold and liquid, `'lantern'` for a subtle light |
| Art styles, saved looks, backdrops, masks, effects, PNG/MP4/GIF export | `mountStudio` from `/studio` ([studio-workspace.md](references/studio-workspace.md)) |
| Several media and text layers in one artwork | `mountStudioProject` from `/studio` ([layered-projects.md](references/layered-projects.md)) |
| An ambient background with no media | A template from asciify.org/backgrounds, or a `/field` generated scene |
| A text banner or lettering | `asciifyText` / `renderTextToCanvas` |
| Headline text visible through the art | Layered HTML ([layered-hero.md](references/layered-hero.md)) |

## Install the agent skill

```sh
npx skills add ayangabryl/asciify-engine --skill asciify-engine
```

This uses the Vercel Skills CLI to install the repository skill and its linked resources. The npm dependency and an installed agent skill update separately. When asked to update Asciify or when an integration needs newer options, follow [references/upgrading.md](references/upgrading.md): check npm's current `latest`, update with the project's package manager, then refresh only this skill in its installed scope. Do not treat this document's tested version as permanently latest, or upgrade unrelated skills/dependencies.

## Choose the integration

For a live project component, start with [project-integration.md](references/project-integration.md): it maps each use case to one rendering pipeline, covers instance ownership, and keeps PNG/video export independent of live playback. Use `/studio` for a new composition with art styles, masks, backdrops and saved settings. It already owns hover/motion; do not add another `/hover` instance on top.


- Static image: `asciify(source, canvas, config)` returns `Promise<() => void>`. Call the cleanup on unmount, including for a still image.
- Video: `asciifyVideo(source, canvas, config)` returns `Promise<() => void>`. Call that function on unmount. Use `fitTo` and `objectFit: 'cover'` for full-bleed heroes; `contain` for a whole-subject preview.
- GIF: `asciifyGif(source, canvas, config)` returns a cleanup function asynchronously.
- Procedural background: download a template from https://asciify.org/backgrounds and import its `asciiBackground` helper locally. Call its `destroy()` on unmount. No background generators ship in npm 4.0.
- Dense custom rendering: use `imageToAsciiTextFrame` and `renderTextFrameToCanvas`; keep the same options when converting and rendering. Use object frames when per-cell mutation is required.

For a hero with HTML layered through the ASCII, read [references/layered-hero.md](references/layered-hero.md) and use the accompanying [HTML](examples/layered-hero.html), [CSS](examples/layered-hero.css), and [JavaScript](examples/layered-hero.js). These are ordinary Vite/bundler inputs, not another npm dependency. Supply your own media.

For crop, scroll, React lifecycle, and low-level API details, read [references/media-api.md](references/media-api.md).

## Start with a readable source

Use ordinary images or footage, then convert them with Asciify. Do not ask an image/video generator to pre-render ASCII. A dark subject with thin highlights tends to become an outline; changing to full color cannot recover missing midtones. Prefer recognizable subjects, broad illuminated surfaces, controlled highlights, and stable framing.

Choose color intentionally:

- `fullcolor`: preserve source colors; do not grayscale source pixels first.
- `grayscale`: gray characters.
- `accent`: a single brand color via `accentColor`.
- `matrix`: green treatment.

Start around `fontSize: 7`, `fps: 24` or `30`, and `maxRenderDimension: 960`. These are a starting budget, not an FPS guarantee. Increase detail only after checking the actual viewport and target hardware. Use `normalize: true` for flat sources when helpful; compare it against `false` on already graded video because frame-by-frame normalization may change the look.

```js
import { asciifyVideo } from 'asciify-engine';
const stop = await asciifyVideo('/hero.mp4', canvas, {
  fitTo: hero,
  objectFit: 'cover',
  objectPosition: 'center',
  fontSize: 7,
  fps: 24,
  maxRenderDimension: 960,
  options: {
    charset: ' .:-=+*#%@',
    colorMode: 'fullcolor',
    normalize: false,
    animationStyle: 'none',
    hoverStrength: 0,
  },
});
// On unmount: stop();
```

## Custom letters

`options.charset` is the density ramp. `customText` repeats a string and is a different feature. To incorporate a brand's letters while retaining shading symbols, build a ramp such as:

```js
const letters = [...new Set('ASCIIFY'.toUpperCase().replace(/[^A-Z]/g, ''))].join('');
const charset = ` .:-=+${letters}#%@`;
```

Preview it: letter glyph densities differ, so arbitrary words are not automatically an evenly ordered ramp. When the user wants the artwork drawn in their name, `/field` handles it better: put the word after a quiet ramp (`' .,:-+' + word`), use one ink with `shade: 1`, and let brightness carry the image (see [design-matching.md](references/design-matching.md)). Keep the leading space and the light/dense symbols. Use the curated `CHARACTER_SETS.standard.chars`, `detailed.chars`, `blocks.chars`, or `braille.chars` from `/core` when appropriate.

## Engine effects versus studio effects

The core `HoverEffect` IDs are `spotlight`, `magnify`, `repel`, `glow`, `colorShift`, `attract`, `shatter`, `trail`, and `glitchText`. Those remain valid APIs, but they are **not identical to the current website's enhanced interactions**.

The website offers **Trail, Water, Contour, Dissolve, Silk, Vortex, Magnetic Pull, Scatter, Emboss, Elastic, Rake, Lens wake, Smudge, Ripple rings, and Off** through an optional studio surface module. Its fourteen still-image motions—Caustics, Slow Current, Reveal & Reform, Sheen, Tidal Rings, Living Grain, Parallax, Woven Flow, Print Shift, Contour Light, Relight, Shimmer, Breeze, Unfold—and fine-dither treatments ship in the same `asciify-engine/hover` module. Use its typed options rather than converting display names into engine `hoverEffect` or `animationStyle` values.

To reproduce those interactions, read [references/studio-effects.md](references/studio-effects.md). Import `mountHover` from `asciify-engine/hover`; no separate download is needed. Keep engine `hoverStrength: 0` and `animationStyle: 'none'` when using it, to avoid applying two effects. Trail is the site's default. Prefer a stationary-grid effect such as Trail or Dissolve when the user wants a wake without spatial displacement.

For built-in hover alone, use a supported `options.hoverEffect` and a restrained nonzero `hoverStrength`; validate its behavior instead of promising that it matches the website.

## Text layering

Use real HTML for the headline, description, and links. The engine draws artwork; CSS controls which HTML sits in front of it.

For our cover relationship, use a single isolated hero stacking context:

1. Headline at `z-index: 0`.
2. Transparent ASCII canvas/stage at `z-index: 1`.
3. Description, CTA, and motion controls at `z-index: 2` or above.

Keep these as sibling layers. A transformed or isolated content wrapper can trap all its descendants below the canvas. Set decorative artwork to `pointer-events: none`; attach optional hover input to the positioned hero host. Keep controls clickable, focusable, and visually unobscured. Leave canvas background transparent; an opaque canvas or stage hides the headline beneath it.

Choose the more conventional arrangement—artwork behind all text—when it improves readability. The layered example explains both arrangements without imposing the Asciify homepage's branding or layout on another project.

## Performance and lifecycle

- Reduce processing dimensions and cell count before dropping source playback FPS. Do not default to 60 fps on a 24 fps video.
- Start video at 24–30 fps with a 720–960px processing cap. More processing pixels do not create detail absent from the source.
- When the user asks for a smooth, high-frame-rate hero, prefer `/field` over a canvas pipeline, and keep the canvas pipeline as its fallback.
- Keep stable canvas dimensions; resize on layout changes, not on every animation frame.
- Avoid remounting the renderer on pointer movement or each React render.
- Pause media offscreen and when the document is hidden. Reduced-motion users should get a still; do not merely hide a playing video with CSS.
- Guard asynchronous setup: if a component unmounts before an API resolves, immediately call its returned cleanup. Handle loading failures without removing the HTML content or CTA.
- Compress media at a resolution appropriate to ASCII sampling, remove unused audio, use fast-start MP4, and provide a small poster. Immutable caching requires a content-hashed URL; keep this skill's URL revalidatable.
- Fine dithering can add texture but can shimmer on moving footage. Compare a still and a loop, and offer a non-dithered rendering.
- YouTube page URLs and iframe players are not direct canvas video sources. Use permitted direct media files with suitable CORS; see https://asciify.org/docs/youtube.

## Verify before handing off

Check the actual implementation: readable subject and text, no stretching or unintended empty margins, working pointer and keyboard controls, mobile crop, reduced motion, autoplay failure, and cleanup after navigation. Observe several seconds of motion and an entire loop boundary. State the measured device/settings if reporting FPS; screenshots and recordings alone do not establish performance.

Do not import nonexistent helpers such as `createRecorder` or `recordAndDownload`. For deterministic composition export, use `/studio` as described below. For recording an existing interactive canvas, use a browser `MediaRecorder` with a supported `canvas.captureStream()` format and clean up its tracks; for snapshots, inspect the published `captureSnapshot` / `snapshotAndDownload` types.


## Hero finish

`/hover` supports text-shaped charcoal cutouts (`textMask`), peripheral scanline/fringe control (`edgeEffect`), fixed accent ink, Prism edge softness (`edgeSoftness`), and fixed-grid fluid Trail. See the [complete API, layering example, lifecycle, and fallback limits](references/hero-finish.md).

## Studio composition and export

For optional wallpaper/backdrops, alternate renderers, palettes, masks, saved looks, text fonts, or deterministic MP4/GIF export, read [references/studio-workspace.md](references/studio-workspace.md). `/studio` is separate from `/hover` and `AsciiOptions`; do not replace an existing hero pipeline just to add a backdrop.

## GPU glyph fields

For a full-bleed hero, section background or brand field that must stay smooth under the cursor, use `mountGlyphField` from `asciify-engine/field` and read [references/glyph-field.md](references/glyph-field.md). It draws glyph ramps (including words and braille) from images, video or generated motion on WebGL2 with a fluid wake that keeps each character's own color. It does not replace `/studio` for the 24 render styles, dither, print styles, effects or export. Check `isGlyphFieldSupported()` (false without a GPU), always provide a poster and a canvas fallback, and call `destroy()` on unmount.

## Current catalogs

For multiple media/text layers in one live component, use 4.8+ `mountStudioProject` and read [layered-projects.md](references/layered-projects.md). It shares one playback loop and rendering budgets across up to eight independently styled layers. Persist source keys separately from media, and use `exportStudioProject` for independent exports. Do not create one mounted Studio instance per layer or rasterize accessible interface text.

Legacy `CHARSETS`, `ART_STYLE_PRESETS`, `CHARSET_SEQUENCES`, `LIVING_STYLE_PRESETS` and their key types are removed. Do not import them or generate old names such as Katakana, Binary, Waves or Smoke. Use the 24 `STUDIO_STYLES` for render-style selectors and `/studio` rendering. For ASCII-only character ramps use `CHARACTER_SETS` from `/core` or `STUDIO_CHARACTER_SETS` from `/studio`; custom Unicode and user-provided frame arrays remain supported. Core `artStyle` only accepts `classic`; use explicit options instead of preset shortcuts. Despite the requested 4.1.0 version number, migrating these removed APIs is a breaking change.


## Version notes

Read these when the installed version is older than the tested one, or when a user names a specific feature.

### Fine dither and creative controls (4.2)

Studio adds `hex`, `led`, and `cmyk` render styles, directional/radial dither patterns, additional palettes, luminance mapping, RGB split, sharpening, and adjustable still-image motion strength. Read [studio-workspace.md](references/studio-workspace.md#fine-detail-and-controls-42) for exact options, density budgets and preview/export consistency. These are local Canvas/WebGL effects, not AI generation or a claim of parity with every competing catalog.

From 4.5, `dither.algorithm: 'blue-noise'` uses a precomputed dispersed threshold tile, separate from white `noise`. Studio `color` also accepts `blackPoint`, `whitePoint`, `gamma`, `shadows` and `highlights` to shape detail before conversion. All are neutral by default. Read [tonal detail and blue noise](references/studio-workspace.md#tonal-detail-and-blue-noise-45) before adding these controls; they belong to `/studio`, not core `AsciiOptions`.

From 4.6, Studio adds `color.curves` (RGB, red, green, blue) and optional edge-preserving `color.denoise`. `player.settings` returns a detached snapshot for saving or exporting after updates. Read [channel curves and source noise](references/studio-workspace.md#channel-curves-and-source-noise-46) for point limits, update semantics and the processing budget. Do not turn noise reduction on by default or apply it again to the already-rendered characters.

From 4.7, Studio supports up to eight ordered source warps: Twirl, Pinch, Spherize, Ripple, Zigzag, Shear, Smudge, Polar and Fragment. Build controls from `STUDIO_WARPS`, retain array order, and read [source shaping](references/source-shaping.md) for bounds, alpha/edge policy and cached-map performance. These shape the source; use `motion.type` to bring a still image to life and `hover.effect` for pointer interaction. Keep them independent, with an empty warp stack by default.

From 4.9, optional Studio adds Stipple, Engraving, Crosshatch, Woodblock, Risograph and Pointillism with a shared `print` settings group. Read [print and illustration](references/print-styles.md) for exact controls, light-ink versus dark-ink polarity, still-motion integration and dense-render limits. These are genuine additional render paths; do not substitute dither presets for their IDs.

### Lively images and interaction starting points (4.10)

`STUDIO_ANIMATION_PRESETS` provides six editable motion/hover pairings through `/studio` and `/hover`. Apply `motion` and `hover` to an existing Studio player to keep the source and art style; do not treat the pairings as additional art styles. Read [studio-effects.md](references/studio-effects.md#lively-images-410) for exact new IDs, loop limits and the live component example.

### GPU glyph fields (4.11)

`asciify-engine/field` adds `mountGlyphField`, `isGlyphFieldSupported` and `glyphFieldTier`. Older installs do not have this entry; upgrade before using it.
