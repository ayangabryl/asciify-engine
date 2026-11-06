---
name: asciify-engine
description: "Asciify attached or linked images, GIFs, video and 3D models: convert them to ASCII art with the asciify-engine command (text for a reply, ANSI for a terminal, SVG or animated SVG for a README), and build ASCII components and backgrounds for websites. Use when someone says asciify or asks for ASCII, text, braille or block art of a photo, logo, file or URL, a text banner, or ASCII in a terminal; and for interface components in characters (loading, status, toasts, tabs, AI states, charts, transitions, pages), animated backgrounds and heroes inked from the site's theme, live image, video and 3D fields on the GPU, artwork looks and art styles for wallpapers, posters and prints, hover and motion, type layered over media, export, rendering performance, and ASCII on servers and at the edge."
metadata:
  tested-engine: "4.33.0"
  updated: "2026-11-06"
---

# Asciify Engine

Use the published `asciify-engine` npm package. Tested against **4.33.0**. Check the application's installed version and its public types before using newer options; a local checkout can contain unpublished changes.

- Agent entry: https://asciify.org/skill (redirects to this Markdown document).
- Components: https://asciify.org/components · Looks: https://asciify.org/looks · Backgrounds: https://asciify.org/backgrounds
- Playground: https://asciify.org/editor · API documentation: https://asciify.org/docs/api
- Repository: https://github.com/ayangabryl/asciify-engine

```sh
npm install asciify-engine@latest
```

Entries: the `asciify-engine` command for files (a chat reply, a terminal, an SVG for a README); `/kit` for interface components and backgrounds, one call each; `asciify-engine` and `/core` for media and text conversion on a page; `/headless` for pixels to text with no DOM (servers, edge, terminals); `/decode` for image files to pixels with no dependencies; `/model` for 3D models to ASCII; `/hover` for the website hovers and living-image motion; `/studio` for art styles, looks and export; `/field` for raw GPU character fields. Each optional entry loads only when imported. GIF decoding loads `gifuct-js` when a GIF API is called.

## Asciify an attachment

When someone says asciify (or "turn this into ASCII", "make this ASCII art") and attaches or names an image, GIF, video, 3D model or URL, convert it now with the command and hand back the result; ask nothing about flags first. Per-media defaults, their words mapped to flags, READMEs and failures: [convert-attachments.md](references/convert-attachments.md).

1. **Find the file.** A path in the message (Claude Code pastes dropped files as paths); `/mnt/user-data/uploads/` in Claude apps, which expect what you hand back in `/mnt/user-data/outputs/`; the workspace in Cursor and Codex. Pass image, GIF and model URLs straight in; download a video first. A picture pasted with no file behind it: look where this environment keeps uploads, and if there is no file, say in one line that you need the file or its path. Never draw a stand-in by hand.
2. **Check the command.** `npx -y asciify-engine@latest --version` must print 4.33.0 or later (Node 18 or later); a project that depends on 4.33 or later can run its own `npx asciify-engine`. `could not determine executable to run` means npm has no 4.33 yet: say so.
3. **Convert for where it goes.** Text for your reply (`-f text`, and `--still` for a GIF, video or model so nothing plays), and a file worth keeping:

   ```sh
   npx -y asciify-engine@latest photo.jpg -f text -w 80 --cell-aspect 2.4     # the reply (leave out --cell-aspect in a terminal)
   npx -y asciify-engine@latest photo.jpg -o photo.svg --background '#000000'  # the file: in colour, sharp at any size
   npx -y asciify-engine@latest loop.gif -o loop.svg                           # a GIF or video (ffmpeg): an animated SVG
   npx -y asciify-engine@latest helmet.glb --spin -o turn.svg                  # a 3D model: one full turn
   ```

   Logo, line art or a scan, dark on white: add `--light`. A README: `--no-color --ink '#24292f' --dark-ink '#e6edf3' --title "…"`. A terminal: ANSI (`-o art.ans`). Playback and the 3D viewer run only in the user's own terminal: give them the line, such as `npx asciify-engine helmet.glb`.
4. **Hand it back.** Read the text first; if the subject does not read, try `--light`, `--invert`, a crop or more columns. Then the text in a code block fenced with four backticks, the file and where it is, one line on what you chose, and one alternative (braille, colour blocks, the classic ramp, a wider file), not a menu.
5. **Live on their website instead?** A hero, background, component or turning model on a page is the kit, a field or `modelSource`, not the command: read on.

## For a website: kit first

Most web requests are a feeling ("make the loading state feel alive", "a calm background behind pricing", "like asciify.org") rather than an API. Work in this order:

1. **Is it a UI component or a background?** Almost always, yes. Read [applying-asciify.md](references/applying-asciify.md) (the house design: when characters earn a place, ink, the clear zone and veil, density, radii, motion, performance, accessibility, which background suits which surface), then take the call from [components.md](references/components.md) and its options from [kit.md](references/kit.md). Stop there unless the kit has no option for the look.
2. **Read the request.** Subject (their media, a word, or nothing), placement (hero, card, control, background behind text), mood words, interaction, any reference site.
3. **Read the design.** Open the project's tokens: ground and surface colours, text colours, the one accent, mono and display fonts, radii, light and dark themes, motion durations and easing, reduced-motion handling. Map the kit's ink tokens (`--ascii-ink`, `--ascii-ink-strong`, `--ascii-success`, `--ascii-warning`, `--ascii-error`) onto them; never add a brand colour.
4. **Decide living or still.** Follow the user's words; keep art behind text, in grids and in data views still; reduced motion always gets a still. See [living or still](references/design-matching.md#living-or-still).
5. **Say what you chose in one line** and offer one alternative. Ask only when the media is missing or motion would be new to a site that has none.

[design-matching.md](references/design-matching.md) maps mood words to settings for the lower-level APIs and media looks.

| The user wants | Use |
| --- | --- |
| A UI component in characters: button loading, status, toasts, tabs, pills, odometer, chart, AI thinking and streaming, transitions, sign-in, pricing, 404; event-site pieces (scrambling headers and headlines, morphing hatched heroes, dithered glows, a dotted globe, two-tone photos, assembling wordmarks, a spray cursor); an ASCII ocean of swimming creatures; interactive backgrounds visitors stir, grow and ripple | `asciify-engine/kit` ([applying-asciify.md](references/applying-asciify.md), [components.md](references/components.md), [kit.md](references/kit.md)) |
| A background behind a hero, pricing, docs or a section, light or dark | Kit `fieldBackground(el, { preset: 'hero', clear })` (asciify.org's hero) or `background(el, { preset, clear })` with one of the 12 curated presets below |
| Their word or brand in characters | Kit `wordmark`, or `background()` with `wordField` |
| Their video in characters on the page | Kit `asciiVideo` |
| Their photo, video or GIF converted, optionally answering the cursor | Advanced: `asciify` / `asciifyVideo` / `asciifyGif`, plus `mountHover` from `/hover` |
| A full-bleed field with a look the kit has no option for | Advanced: `mountGlyphField` from `/field` ([glyph-field.md](references/glyph-field.md)) |
| A hover, reveal or motion in the brand's own design, beyond the built-in ones | `defineFieldEffect` with `mountGlyphField` ([glyph-field.md](references/glyph-field.md#custom-effects-433-experimental)) |
| A three.js / React Three Fiber scene, game or app canvas drawn live as characters | `mountGlyphField(canvas, { source: renderer.domElement, live: true })` ([glyph-field.md](references/glyph-field.md#live-sources-3d-scenes-and-app-canvases-433)) |
| Their own UI (a card, a form, a view) drawn in characters, live, for a transition or a hover | `elementSource` from `/kit` as a `live` field source ([kit.md](references/kit.md#elementsource-433-experimental)) |
| ASCII on a server, at the edge or in a terminal: OG images, emails, CLI banners, READMEs, bots | `toAsciiGrid` from `asciify-engine/headless` ([headless.md](references/headless.md)) |
| A picture, GIF, video or 3D model someone attached or linked, as text for a reply, ANSI for a terminal, SVG, or an animated SVG for a README | The `asciify-engine` command ([convert-attachments.md](references/convert-attachments.md), [cli.md](references/cli.md)) |
| A 3D model (glTF/GLB, OBJ, STL, PLY) as ASCII in code, or a live hero on a page | `asciify-engine/model`, `modelSource` ([model.md](references/model.md)) |
| Image files (PNG, JPEG, GIF, BMP, PNM, QOI) to pixels with no dependencies, at the edge or in Node | `decodeImage` from `asciify-engine/decode` ([headless.md](references/headless.md#getting-pixels)) |
| A playing video or 3D canvas as text (a string per frame, not drawn on screen) | `createAsciiGpu()` from `asciify-engine/headless` ([headless.md](references/headless.md#on-the-gpu-createasciigpu)) |
| Their photo or video as finished artwork in a named look: a wallpaper, poster, cover, print or hero artwork ("newsprint", "riso", "phosphor", "engraving", "Lego") | `mountStudio` / `exportStudio` from `/studio` with a look from [looks.md](references/looks.md) |
| Art styles, saved looks, masks, effects, PNG/MP4/GIF export | Advanced: `mountStudio` from `/studio` ([studio-workspace.md](references/studio-workspace.md)) |
| Several media and text layers in one artwork | Advanced: `mountStudioProject` from `/studio` ([layered-projects.md](references/layered-projects.md)) |
| A text banner or lettering | In a terminal, a reply or a README: `npx asciify-engine --text "Hi" --font Slant` ([cli.md](references/cli.md)); on a page: `asciifyText` / `renderTextToCanvas` |
| Headline text visible through media art | Advanced: layered HTML ([layered-hero.md](references/layered-hero.md)) |

## The kit in one paragraph

Each kit function mounts an `aria-hidden` field over or inside your element, follows its size and border radius, inks it from your theme in light and dark, pauses off screen, honours reduced motion, falls back without WebGL2 to an inert handle that leaves your HTML working, and cleans up on `destroy()`. components.md has every component as a short snippet with the prompt a person gives, in categories Components, AI, Text, Transitions, Media, Pages and Backgrounds. In React, create the handle in an effect and return its `destroy`.

```ts
import { beam } from 'asciify-engine/kit';
const b = beam(card, { palette: 'mono', mode: 'pulse' });
// On unmount: b.destroy();
```

`background()`, its presets, `lazy`, `poster`, `setFieldBudget` and `setGlobalLook` are new in 4.14.0; `halo`, `ripple`, `mesh`, `interference`, `constellation`, `cascade`, the GPU `caustics` and `contour`, and the `mark` option are new in 4.19.0. Check that the installed `asciify-engine/kit` exports them; if not, upgrade ([upgrading.md](references/upgrading.md)).

## Backgrounds

`background(element, { preset })` draws every background on asciify.org/backgrounds as a scene of the GPU glyph field, in the site's graphite inks and following the global look. Import presets by name; a page pays only for those it imports. `cursor: false` turns the pointer response off for any of them. Which one suits which surface, and how to keep it calm, is in [applying-asciify.md](references/applying-asciify.md#9-backgrounds).

```ts
import { background, swell } from 'asciify-engine/kit';
const bg = background(pricing, { preset: swell, clear: pricingCopy });
```

The 12 curated presets, as export → `id` (name), all on the GPU glyph field (WebGL2, sharing the context budget): `swell` (Swell, dots or characters), `drift` (Drift), `halo` (Halo), `caustics` (Caustics), `contour` (Contour), `ripple` (Ripple), `mesh` (Mesh), `interference` (Interference), `constellation` (Constellation), `cascade` (Cascade), `wordField` → `field` (Field), `fluid` (Fluid).

The retired presets (`aurora`, `halftone`, `dna`, `circuit`, `fire`, `grid`, `morph`, `noise`, `pulse`, `rain`, `silk`, `stars`, `terrain`, `veil`, `voidWell`, `wave`, `weave`, `dune`, `etch`, `facet`, `moire`) are still exported and marked `@deprecated` so old code runs; do not reach for them in new work. [kit.md](references/kit.md#backgrounds) maps each to its replacement. `fieldBackground` is separate: its `hero`, `brand` and `notFound` presets are the asciify.org hero ground, the same ground in the brand colour, and the 404.

Templates already downloaded from asciify.org/backgrounds (`asciiBackground` from a local `./wave.js`) keep working in apps that ship them, but the site no longer offers them; move those apps to `background()` with the closest preset (kit.md maps each).

## Install the agent skill

```sh
npx skills add ayangabryl/asciify-engine --skill asciify-engine
```

This uses the Vercel Skills CLI to install the repository skill and its linked resources. The npm dependency and an installed agent skill update separately. When asked to update Asciify or when an integration needs newer options, follow [references/upgrading.md](references/upgrading.md): check npm's current `latest`, update with the project's package manager, then refresh only this skill in its installed scope. Do not treat this document's tested version as permanently latest, or upgrade unrelated skills/dependencies.

## Verify before handing off

Run the checklist at the end of [applying-asciify.md](references/applying-asciify.md#10-checklist-before-you-finish) for kit work. For any integration, check the real page: readable subject and text in both themes, no stretching or unintended margins, working pointer and keyboard controls, mobile crop, reduced motion, autoplay failure, WebGL off, and cleanup after navigation. Observe several seconds of motion and a loop boundary. State the measured device and settings with any FPS figure; screenshots alone do not establish performance. What the engine guarantees a host page, and its default budgets, are in [performance.md](references/performance.md).

Do not import nonexistent helpers such as `createRecorder` or `recordAndDownload`.

# Advanced: the lower-level APIs

Use these when the request is media converted on a page, art styles or export, or a field look the kit cannot give. They do not handle theme ink, posters, the context budget or fallbacks for you; the rules in applying-asciify.md still apply to the result.

## Choose the integration

For a live project component, start with [project-integration.md](references/project-integration.md): it maps each use case to one rendering pipeline, covers instance ownership, and keeps PNG/video export independent of live playback. Use `/studio` for a new composition with art styles, masks, backdrops and saved settings. It already owns hover/motion; do not add another `/hover` instance on top.

- Static image: `asciify(source, canvas, config)` returns `Promise<() => void>`. Call the cleanup on unmount, including for a still image.
- Video: `asciifyVideo(source, canvas, config)` returns `Promise<() => void>`. Call that function on unmount. Use `fitTo` and `objectFit: 'cover'` for full-bleed heroes; `contain` for a whole-subject preview.
- GIF: `asciifyGif(source, canvas, config)` returns a cleanup function asynchronously.
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

Preview it: letter glyph densities differ, so arbitrary words are not automatically an evenly ordered ramp. When the user wants the artwork drawn in their name, the kit's `wordmark` or `wordField` background does it; on raw `/field`, put the word after a quiet ramp (`' .,:-+' + word`), use one ink with `shade: 1`, and let brightness carry the image (see [design-matching.md](references/design-matching.md)). Keep the leading space and the light/dense symbols. Use the curated `CHARACTER_SETS.standard.chars`, `detailed.chars`, `blocks.chars`, or `braille.chars` from `/core` when appropriate.

## Engine effects versus studio effects

The core `HoverEffect` IDs are `spotlight`, `magnify`, `repel`, `glow`, `colorShift`, `attract`, `shatter`, `trail`, and `glitchText`. Those remain valid APIs, but they are **not identical to the current website's enhanced interactions**.

The website offers **Trail, Dissolve, Contour, Emboss, Ripple rings, Ink bleed, Water, Silk, Vortex, Magnetic Pull, Scatter, Elastic, Lens wake, Smudge, Loupe, Reveal, Repel, Tilt, Heat haze, and Off** through an optional studio surface module, each with `scope: 'all' | 'subject' | 'outside'` to keep it on a cut-out subject or around it (`rake` is retired and plays Silk). Its ten photo-aware still-image motions—Relight, Specular sweep, Highlight bloom, Glints, Parallax, Slow push, Focus pull, Mist, Drift, Develop—read the image's own light and depth (retired IDs such as `caustics` load as their closest replacement), and they and the fine-dither treatments ship in the same `asciify-engine/hover` module. Use its typed options rather than converting display names into engine `hoverEffect` or `animationStyle` values.

To reproduce those interactions, read [references/studio-effects.md](references/studio-effects.md). Import `mountHover` from `asciify-engine/hover`; no separate download is needed. Keep engine `hoverStrength: 0` and `animationStyle: 'none'` when using it, to avoid applying two effects. Trail is the site's default. Prefer a stationary-grid effect such as Trail or Dissolve when the user wants a wake without spatial displacement.

For built-in hover alone, use a supported `options.hoverEffect` and a restrained nonzero `hoverStrength`; validate its behavior instead of promising that it matches the website.

## Text layering over media art

For interface grounds, text sits on a clear zone and a frosted veil ([applying-asciify.md](references/applying-asciify.md#3-text-over-a-field-clear-zone-plus-frosted-veil)). For a media hero where the headline should read through the artwork, use real HTML and a single isolated hero stacking context:

1. Headline at `z-index: 0`.
2. Transparent ASCII canvas/stage at `z-index: 1`.
3. Description, CTA, and motion controls at `z-index: 2` or above.

Keep these as sibling layers. A transformed or isolated content wrapper can trap all its descendants below the canvas. Set decorative artwork to `pointer-events: none`; attach optional hover input to the positioned hero host. Keep controls clickable, focusable, and visually unobscured. Leave canvas background transparent; an opaque canvas or stage hides the headline beneath it. Choose artwork behind all text when it reads better.

## Performance and lifecycle

- Reduce processing dimensions and cell count before dropping source playback FPS. Do not default to 60 fps on a 24 fps video.
- Start video at 24–30 fps with a 720–960px processing cap. More processing pixels do not create detail absent from the source.
- When the user asks for a smooth, high-frame-rate hero, prefer the kit or `/field` over a canvas pipeline, and keep the canvas pipeline as its fallback.
- Keep stable canvas dimensions; resize on layout changes, not on every animation frame.
- Avoid remounting the renderer on pointer movement or each React render.
- Pause media offscreen and when the document is hidden. Reduced-motion users should get a still; do not merely hide a playing video with CSS.
- Guard asynchronous setup: if a component unmounts before an API resolves, immediately call its returned cleanup. Handle loading failures without removing the HTML content or CTA.
- Compress media at a resolution appropriate to ASCII sampling, remove unused audio, use fast-start MP4, and provide a small poster. Immutable caching requires a content-hashed URL; keep this skill's URL revalidatable.
- Fine dithering can add texture but can shimmer on moving footage. Compare a still and a loop, and offer a non-dithered rendering.
- YouTube page URLs and iframe players are not direct canvas video sources. Use permitted direct media files with suitable CORS; see https://asciify.org/docs/youtube.
- For deterministic composition export, use `/studio`. To record an existing interactive canvas, use a browser `MediaRecorder` with a supported `canvas.captureStream()` format and clean up its tracks; for snapshots, inspect the published `captureSnapshot` / `snapshotAndDownload` types.

## Hero finish

`/hover` supports text-shaped charcoal cutouts (`textMask`), peripheral scanline/fringe control (`edgeEffect`), fixed accent ink, Prism edge softness (`edgeSoftness`), and fixed-grid fluid Trail. See the [complete API, layering example, lifecycle, and fallback limits](references/hero-finish.md).

## Studio composition and export

For a finished artwork in a ready look (wallpaper, poster, cover, print), start from [references/looks.md](references/looks.md): 22 looks, each with the prompt, exact settings, and wallpaper/poster/loop export sizes. For optional wallpaper/backdrops, alternate renderers, palettes, masks, saved looks, text fonts, or deterministic MP4/GIF export, read [references/studio-workspace.md](references/studio-workspace.md). `/studio` is separate from `/hover` and `AsciiOptions`; do not replace an existing hero pipeline just to add a backdrop. Print and illustration styles (stipple, engraving, crosshatch, woodblock, risograph, pointillism): [print-styles.md](references/print-styles.md); source warps: [source-shaping.md](references/source-shaping.md).

## GPU glyph fields

The kit is built on `mountGlyphField` from `asciify-engine/field`. Use it directly only for a look the kit has no option for, and read [references/glyph-field.md](references/glyph-field.md) and the raw-field helper at the end of [components.md](references/components.md#advanced-raw-field). It draws glyph ramps (including words and braille) from images, video or generated motion on WebGL2 with a fluid wake. It does not replace `/studio` for the render styles, dither, print styles, effects or export. Check `isGlyphFieldSupported()`, provide a poster and a fallback, honour reduced motion, and call `destroy()` on unmount. To build your own component with the kit's plumbing instead, use `mountSurface` ([kit.md](references/kit.md#your-own-components)).

## Current catalogs

For multiple media/text layers in one live component, use 4.8+ `mountStudioProject` and read [layered-projects.md](references/layered-projects.md). It shares one playback loop and rendering budgets across up to eight independently styled layers. Persist source keys separately from media, and use `exportStudioProject` for independent exports. Do not create one mounted Studio instance per layer or rasterize accessible interface text.

Legacy `CHARSETS`, `ART_STYLE_PRESETS`, `CHARSET_SEQUENCES`, `LIVING_STYLE_PRESETS` and their key types are removed. Do not import them or generate old names such as Katakana, Binary, Waves or Smoke. Use the 24 `STUDIO_STYLES` for render-style selectors and `/studio` rendering. For ASCII-only character ramps use `CHARACTER_SETS` from `/core` or `STUDIO_CHARACTER_SETS` from `/studio`; custom Unicode and user-provided frame arrays remain supported. Core `artStyle` only accepts `classic`; use explicit options instead of preset shortcuts. Despite the requested 4.1.0 version number, migrating these removed APIs is a breaking change.

## Version notes

What each release added, from 4.2 to 4.33, and what to check in an older install: [upgrading.md](references/upgrading.md). Check that the installed version exports an API before using it.

4.33 adds the `asciify-engine` command ([cli.md](references/cli.md)); `/headless` (pixels to text with no DOM, sub-cell art, animated SVG, and `createAsciiGpu` for live video in the browser); `/model` for 3D models; and `/decode` for image files in any runtime. `/field` gains `worker: true`, `context`, `live: true` sources, `sample: 'shape'` with `FIELD_PHOTO_CHARSET`, `post`, custom effects (`defineFieldEffect`) and `<asciify-field>`; `/kit` gains `elementSource`. `/headless`, `/model`, `worker`, custom effects and `elementSource` are experimental for now (STABILITY.md in the package).

## Scenario prompts

Use [scenario-prompts.md](references/scenario-prompts.md) for copyable briefs covering images, heroes, characters, all styles, dither, backgrounds, video/GIF, scroll, layers, text, export, frameworks, procedural trails, reference matching, troubleshooting, upgrades, saved looks and accessibility. Adapt the prompt to the user's intent; do not add unrelated features. Use the published renderer's native Trail; do not add a separate tonal ribbon overlay.
