---
name: asciify-engine
description: Build and tune browser ASCII images, video, GIFs, text, and interactive heroes with asciify-engine. Use for media conversion, character and color choices, hover integration, layered HTML typography, scroll-synced video, and rendering performance in apps using this package.
metadata:
  tested-engine: "4.0.0"
  updated: "2026-09-09"
---

# Asciify Engine

Use the published `asciify-engine` npm package for browser canvas rendering. Tested against **4.0.0**. Check the application's installed version and its public types before using newer options; a local checkout can contain unpublished changes.

- Agent entry: https://asciify.org/skill (redirects to this Markdown document).
- Playground: https://asciify.org/editor
- API documentation: https://asciify.org/docs/api
- Repository: https://github.com/ayangabryl/asciify-engine

```sh
npm install asciify-engine@latest
```

Version 4.0 exports `asciify-engine` and `asciify-engine/core` for media rendering. Procedural background templates are downloaded from asciify.org/backgrounds and are not npm exports. Root imports remain supported. GIF decoding loads `gifuct-js` when a GIF API is called. Enhanced website hovers, living-image motion and fine dither are available from the optional `asciify-engine/hover` entry; root and `/core` do not load it.

## Install the agent skill

```sh
npx skills add ayangabryl/asciify-engine --skill asciify-engine
```

This uses the Vercel Skills CLI to install the repository skill and its linked resources. The npm dependency and an installed agent skill update separately. When asked to update Asciify or when an integration needs newer options, follow [references/upgrading.md](references/upgrading.md): check npm's current `latest`, update with the project's package manager, then refresh only this skill in its installed scope. Do not treat this document's tested version as permanently latest, or upgrade unrelated skills/dependencies.

## Choose the integration

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

Preview it: letter glyph densities differ, so arbitrary words are not automatically an evenly ordered ramp. Keep the leading space and the light/dense symbols. Use `CHARSETS.standard`, `dense`, `blocks`, or `braille` when they better suit the subject.

## Engine effects versus studio effects

The public npm `HoverEffect` IDs in 1.2.0 are `spotlight`, `magnify`, `repel`, `glow`, `colorShift`, `attract`, `shatter`, `trail`, and `glitchText`. Those remain valid APIs, but they are **not identical to the current website's enhanced interactions**.

The website offers **Trail, Water, Contour, Dissolve, Silk, Vortex, and Off** through an optional studio surface module. Its Caustics, Slow Current, Reveal & Reform, and fine-dither treatments ship in the same `asciify-engine/hover` module. Use its typed options rather than converting display names into engine `hoverEffect` or `animationStyle` values.

To reproduce those interactions, read [references/studio-effects.md](references/studio-effects.md). Import `mountHover` from `asciify-engine/hover` (1.2.0+); no separate download is needed. Keep engine `hoverStrength: 0` and `animationStyle: 'none'` when using it, to avoid applying two effects. Trail is the site's default. Prefer a stationary-grid effect such as Trail or Dissolve when the user wants a wake without spatial displacement.

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
- Start video at 24–30 fps with a 720–960px processing cap. More processing pixels do not create detail absent from the source. Version 1.2.0 includes the renderer fixes previously applied by the website; the enhanced surface module is included through the optional `/hover` import.
- Keep stable canvas dimensions; resize on layout changes, not on every animation frame.
- Avoid remounting the renderer on pointer movement or each React render.
- Pause media offscreen and when the document is hidden. Reduced-motion users should get a still; do not merely hide a playing video with CSS.
- Guard asynchronous setup: if a component unmounts before an API resolves, immediately call its returned cleanup. Handle loading failures without removing the HTML content or CTA.
- Compress media at a resolution appropriate to ASCII sampling, remove unused audio, use fast-start MP4, and provide a small poster. Immutable caching requires a content-hashed URL; keep this skill's URL revalidatable.
- Fine dithering can add texture but can shimmer on moving footage. Compare a still and a loop, and offer a non-dithered rendering.
- YouTube page URLs and iframe players are not direct canvas video sources. Use permitted direct media files with suitable CORS; see https://asciify.org/docs/youtube.

## Verify before handing off

Check the actual implementation: readable subject and text, no stretching or unintended empty margins, working pointer and keyboard controls, mobile crop, reduced motion, autoplay failure, and cleanup after navigation. Observe several seconds of motion and an entire loop boundary. State the measured device/settings if reporting FPS; screenshots and recordings alone do not establish performance.

Do not import nonexistent helpers such as `createRecorder` or `recordAndDownload` from 1.2.0. For deterministic composition export in 1.4.0+, use `/studio` as described below. For recording an existing interactive canvas, use a browser `MediaRecorder` with a supported `canvas.captureStream()` format and clean up its tracks; for snapshots, inspect the published `captureSnapshot` / `snapshotAndDownload` types.


## Hero finish

Version 1.3.0 adds text-shaped charcoal cutouts (`textMask`), peripheral scanline/fringe control (`edgeEffect`), fixed accent ink, Prism edge softness (`edgeSoftness`), and fixed-grid fluid Trail. These additions ship in **npm 1.3.0**. Upgrade older applications before using them. See the [complete API, layering example, lifecycle, and fallback limits](references/hero-finish.md).

## Studio composition and export

For optional wallpaper/backdrops, alternate renderers, palettes, masks, saved looks, text fonts, or deterministic MP4/GIF export, read [references/studio-workspace.md](references/studio-workspace.md). The new `/studio` API is separate from `/hover` and `AsciiOptions`; do not replace an existing hero pipeline just to add a backdrop. Use version 1.4.0 or newer for these APIs after verifying the installed package.

## Standard catalogs in 2.0

`CHARSETS` and `ART_STYLE_PRESETS` no longer include `emoji`, `musical` or `starfield`. Do not recommend or generate those names. For character selection in a Studio integration, use `STUDIO_CHARACTER_SETS` from `asciify-engine/studio` and assign an entry's `chars` to `settings.charset`. These ramps apply to the `ascii` style; other styles define their own marks. Custom Unicode strings remain supported. Read the upgrade reference when migrating 1.x preset names. The site now opens its primary workspace at `/editor`; `/editor/classic` preserves earlier workflows. Keep the engine imports modular: new editor defaults do not require importing Studio into an existing hero.
