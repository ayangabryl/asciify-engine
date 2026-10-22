# Asciify scenario prompts

Copy a prompt, replace bracketed inputs, and keep your own visual direction. These are starting points for common supported workflows, not a claim to cover every possible project. Read [project integration](project-integration.md) first. Inspect the installed package's types; never guess exports or option IDs.

## Shared acceptance criteria

Preserve the existing framework, design and chosen media. Use one renderer owner per composition. Keep navigation and readable copy in HTML. Include loading/error states, responsive crop, reduced motion, offscreen/hidden pause and unmount cleanup. Test live motion, not only a screenshot. Report tested package version and remaining limitations. Do not publish, deploy or upgrade unrelated dependencies unless asked.

## 1. Convert a photo

“Use Asciify to render [image] in [style] in this component. Preserve [subject/crop/colors]. Choose /core for simple ASCII or /studio for art styles. Include a still fallback and PNG export using supported APIs. Compare the output with the source at mobile and desktop sizes.”

## 2. Interactive website hero

“Add a live Asciify hero using [image] with [Trail/desired interaction]. Keep [headline/CTA] as accessible HTML and respect our design. Use one /studio player, or /field if a GPU glyph field meets the brief. Keep input and render loops bounded; honor reduced motion. Do not stack /hover over /studio.”

## 3. Custom words and characters

“Render [image] with [brand word/custom Unicode/block characters]. Distinguish a density ramp from repeated text. Offer the engine character catalog plus custom input, keep a leading space for shading when appropriate, and check the actual font can display each glyph. Preserve the subject and colors.”

## 4. All styles and looks

“Create a selector from STUDIO_STYLES and the installed Studio preset catalog. Expose every supported style without a handwritten subset. Keep render style, character ramp, color look, dither algorithm, motion and hover as separate controls. Explain which controls apply to the active style.”

## 5. Dither and print

“Render [source] as [dither/engraving/woodblock/risograph/etc.]. Use the genuine Studio style. For dither, use the installed algorithm catalog, compare blue noise and ordered patterns, and avoid shimmer on animation. Preserve readable midtones; compare light and dark backgrounds.”

## 6. Ambient background

“Build [pattern] behind [content] with `background()` from asciify-engine/kit and the [pattern] preset, imported by name. Keep the copy clear with `clear` and a frosted veil, ink from our theme tokens, pause offscreen and destroy on unmount. For a Studio render style on a background, use the downloaded studio-background.js helper and its STUDIO.md instructions.”

The website's Studio background helper renders a continuous procedural source through /studio; it supports the site's 24 styles and 12 looks. Its original template mode uses its own character/dither controls. Never imply every control applies to every renderer.

## 7. Video or GIF

“Convert [direct permitted media file] into [style]. Start with a bounded processing resolution and 24–30 fps, then measure. Include a poster, muted inline playback, autoplay-failure UI, pause offscreen and cleanup. Do not use a YouTube watch URL as a canvas source.”

## 8. Scroll-controlled footage

“Connect [video] progress to [scroll region] using the installed media APIs. Keep seeking bounded, avoid duplicate playback clocks, handle metadata loading, and show a still for reduced motion. Keep page scrolling native and keyboard access intact.”

## 9. Layered composition

“Compose [sources and placements] with mountStudioProject when supported. Keep one project clock and shared budgets, save source keys separately from media, and keep UI text in HTML. Export with exportStudioProject independently from the live preview.”

## 10. Text artwork

“Turn [text] into decorative Asciify art with [font/style]. Keep an accessible HTML equivalent, wait for fonts before rasterizing, handle resize, and preserve readable surrounding content. Use Studio text settings supported by the installed version.”

## 11. Export an animation

“Export [composition] as [GIF/MP4] at [dimensions/duration]. Inspect the installed export API, preserve settings and source framing, and keep export progress/cancellation separate from live playback. If recording canvas instead, negotiate a supported MediaRecorder MIME type and stop every track.”

## 12. Framework integration

“Integrate this Asciify composition into [React/Vue/Svelte/plain JS]. Own the renderer in one lifecycle scope, update settings in place, handle async setup that resolves after unmount, and remove observers/listeners/media resources on cleanup. Test repeated mount/unmount.”

## 13. Improve a trail

“Improve the wake on [component] with restrained follow-through and smooth reversals. Keep the glyph grid stable and input responsive. If adding a procedural pointer chain, bound distance, curvature and work per frame; reset on exit/teleport, stop when settled and honor reduced motion. Test fast turns, slow movement, re-entry, 30/60/120 Hz and touch scrolling. Do not invent an engine proceduralTrail option.”

The website uses the published renderer's native Trail. A chain-shaped tonal overlay was evaluated and removed because it obscured the artwork. Do not add it as part of a standard integration; procedural-chain experiments should be opt-in and visually verified.

## 14. Match a reference

“Match the visual character of [reference] using [our source]. Identify crop, density, palette, negative space and motion before selecting settings. Preserve our branding. Preview at real sizes and explain any limitation instead of claiming an exact match.”

## 15. Diagnose performance or a blank canvas

“Diagnose [symptom] before changing the look. Check source loading/CORS, canvas dimensions, installed API, GPU fallback, visibility and lifecycle. Measure on [device]. Reduce processing size/cell count before source FPS; do not claim FPS from screenshots. Keep HTML and poster visible on failure.”

## 16. Upgrade an existing project

“Update only Asciify and its installed skill as needed for [feature]. Inspect current version, public exports and migration guidance; preserve the user's settings and dependency manager. Remove obsolete catalog imports, verify preview/export parity and report the tested version. Do not deploy or publish a package automatically.”

## 17. Save and restore a look

“Save the active Studio settings as JSON and restore them through the installed normalizer. Store media references separately, keep defaults compatible with the installed version, and test malformed/older settings without losing the user's current work.”

## 18. Accessible interaction

“Audit this Asciify component for keyboard access, touch scrolling, contrast, reduced motion and error states. Keep decorative canvases out of the reading order, provide text alternatives for meaningful artwork, and keep every CTA usable when rendering fails.”

## 19. Page-wide cursor trail

“Add an Asciify cursor trail to [our site] with `cursorTrail` from `asciify-engine/kit`: one call in the app shell, style [trail/wake/water/sparkle], inked from [our text token], fine cells. Keep it off on touch and under reduced motion, quiet over inputs, dialogs and [our editors] (`data-ascii-cursor-skip` or `skip`), under our header and dialogs (`zIndex`), and destroy it on unmount. Make it one continuous trail: turn off the own hover of our heroes, backgrounds and wordmarks (`look: { hover: 'none' }`) so the page trail flows over them instead of stopping at their edges, skip only interactive components with hovers of their own, and match its cell size to our biggest field (e.g. the footer wordmark). Treat it as a background: `zIndex: -1`, only `html` paints the page colour (body, root and full-page wrappers transparent), so cards, panels and text cover it and it never draws on top of them. If we offer a picker, store the choice per visitor and call `update({ style })` or `destroy()` live.”

## 20. Event-site header, hero and footer

“Build a [Cloudflare Connect–style / our event's] header, hero and footer with `asciify-engine/kit`, using our own brand tokens, frames and copy, never another site's assets. Header: real nav links, each with `decode(link, { scramble: true, trigger: 'manual', settle: 'text' })`. Hero on the brand-coloured ground: `morphField` cycling our [3–5 images or a drawn scene] as hatched lines (`ink` white or a light brand tint, `onChange` updating a small counter), the headline `decode(h1, { scramble: true, settle: 'text' })`, and one page-wide `cursorTrail({ style: 'spray', readout: true, zIndex: -1 })`. Sections: `globe` with our venue `points` and a `label`; photos through `ditherImage` in our two brand tones; the closing call to action on `ditherGradient`. Footer: `wordmark` of our name with `assemble: 'scroll'` and `look: { hover: 'none' }`. Keep every headline, link and CTA in HTML, posters for the first viewport in both themes, reduced motion showing settled stills, nothing drawing off screen or when idle, and destroy every handle on unmount. Check light and dark, a 390px phone, keyboard focus and WebGL off.”

## 21. Dither a photo in our brand colours

“Draw [image] with `ditherImage` in our two tones `[ground token, ink token]`, mark [dither/pixel/dot/engraving], developing in on scroll (`reveal: 'scroll'`). Keep the `<img>` in the markup with its `alt` as the fallback and accessible name. Compare cell sizes 4–8 on desktop and phone, and both themes.”

## 22. An ASCII ocean behind the hero

“Put an ASCII ocean behind our landing hero with `ocean` from `asciify-engine/kit`: [a shark, a hammerhead, a manta, a few fish, two jellyfish and a school of 30 small fish], inked from [our text token] (or a `palette` per kind from our brand tokens), `layer: 'under'` so the headline and CTA stay real HTML above it. The cursor scatters the fish and the sharks turn to investigate; a click sends a ripple. Pick a `seed` we like, keep the busiest creatures off the headline (fewer, or a lower `density` on phones), give it a `label` or leave it decorative, and a `poster` for the first viewport in both themes. Reduced motion shows a still composition; it pauses off screen. Check light and dark, a 390px phone and WebGL off.”

## 23. An interactive hero background with a mode switcher

“Build an interactive ASCII hero background visitors can stir, click and grow, with a mode switcher: `background(hero, { preset: estuary, clear: headline })` from `asciify-engine/kit`, and three pills (Estuary, Capillary, Shockwave) as a real radio group that call `bg.setPreset(estuary | capillary | shockwave)`. Keep it faint behind the headline in [our text token] (`palette: { light, dark }` if we need a tint), the headline and CTA real HTML, the pills keyboard-reachable and labelled, a `poster` for the first viewport in both themes, and one still frame under reduced motion. Check light and dark, a 390px phone, touch, and WebGL off.”
