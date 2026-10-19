# Performance guarantees

What `asciify-engine` promises a host page, and the default budgets. Measured by `tests/host-cost-browser.mjs` and `scripts/bundle-cost.mjs` in the engine repository, and held by its unit tests.

## Import and bundle

- **No work at import.** Every entry (`asciify-engine`, `/core`, `/field`, `/hover`, `/studio`, `/kit`) only defines code: no DOM, canvas, WebGL, observer, timer, frame or global is touched until you call something. Safe under SSR (Next.js, Remix, Astro) without a `window` guard on the import.
- **`sideEffects: false`, and the kit is split per component.** A route that imports one kit component downloads that component, the shared kit core (about 20 kB) and the field (about 67 kB), not the whole kit: `fieldBackground` alone costs a code-split host about 90 kB minified (33 kB gzipped), against 285 kB (100 kB) when the kit was one module.

## Main thread

- **Mounting is spread out.** Kit fields mount when they come within half a viewport of the screen, at most one per frame however many a host starts in one task (a route change, a long list). Shader programs link with `KHR_parallel_shader_compile` where the browser has it.
- **Nothing runs when nothing changes.** A still field stops its frame loop. Fields off screen, in a hidden tab, in a `display: none` host or with zero size do not draw. Reduced motion settles every component on a still.
- **Ambient motion is capped.** Drift, scenes and self-animating components draw at most 60 frames a second on any screen (30 with two cores or less, 2 GB of memory or less, or Save-Data). The pointer's wake, lantern, trail, pulses and anything under the pointer keep the screen's full rate.
- **Studio draws off the main thread.** `mountStudio` and `mountStudioMedia` draw in a dedicated worker on `OffscreenCanvas`; the page only posts pointer input and shows each finished frame (an `ImageBitmap`, no copy), so a first frame or a hover never blocks the page. A hover draws at the screen's full rate: workers take turns drawing frames (up to three for a small artwork, within 6 megapixels of frames in all), and Pointillism's dots are filled on the GPU. Output is pixel-identical to drawing on the page; Pointillism's GPU dots match within rounding. Where `OffscreenCanvas` 2D is missing, or a worker cannot start, the same renderer draws on the page at most 60 times a second, never taking more than half the main thread. `destroy()` terminates the workers.
- **Listeners are passive** where the event allows, and every listener, observer, frame, timer, object URL and context is released by `destroy()`, including after a hundred quick mount and destroy cycles.
- **No global CSS but scoped fallbacks.** The few components that inject styles use one `<style id="ascii-kit-…">` each, with every rule inside `:where()` (zero specificity). No console output in normal use.

## GPU and memory

- **One context per page.** Every glyph field on the page (kit components, page helpers and `mountGlyphField`) draws through one shared WebGL2 context and one frame loop, and each field's canvas receives its frame with a 2D copy. Programs compile once for the page and glyph atlases are shared per charset, font and size, so mounting a field creates no context and compiles nothing; 150 components on one page hold one context. A context the browser takes back is replaced, and every field draws again. The context is let go three seconds after the page's last field.
- **GPU memory budget: 256 MB per page.** The shared context counts what every field holds on the GPU: its render targets, its source texture with mipmaps, its wake and trail buffers, its canvas, the shared atlases and the shared drawing buffer. Past 256 MB, kit fields off screen are released to their posters, farthest first, and fields waiting to mount keep their posters until there is room; a field on screen is never released for memory. Atlases are shared per charset, font and size; up to eight that no field uses are kept for a remount and evicted oldest first (all of them while over budget). The shared drawing buffer shrinks when the largest field leaves. Fields mounted directly with `mountGlyphField` count toward the total but are never released by it: destroy them yourself.
- **Context budget.** `setFieldBudget(n)` (default 12) still limits fields that fall back to a context of their own: a canvas from another document, or one that already holds a WebGL context. Past it the field farthest off screen is released to its `poster`.
- **Page listeners don't grow.** One pointer listener (capture, on the window), one visibility, motion, colour-scheme and font listener, and one ResizeObserver serve every field, so mounting and releasing fields while scrolling adds and removes none.
- **Backing store capped.** Pixel ratio is at most 2 by default (`look.maxPixelRatio`), and one field's backing store at most about one 4K screen (8.3 million pixels): a full-bleed field on a 5K or 6K display keeps its cells and draws them at a lower ratio.
- **Slow frames degrade, not stall.** The shared context times its own frames on the GPU (`EXT_disjoint_timer_query_webgl2`, or the frame loop's gaps where it is missing) and lowers the render scale in steps, down to one device pixel per CSS pixel, before any frame is given up; it climbs back once there is headroom. Past that, about a second of frames slower than 24 fps stops a field's ambient motion; the pointer response keeps working.
- **Software WebGL counts as unsupported.** SwiftShader and llvmpipe report `isGlyphFieldSupported() === false` (pass `allowSoftware` to override), so components keep their HTML and poster instead of drawing every pixel on the CPU. Without WebGL2 the same fallback applies.

## What a host should still do

- Give heavy components a `poster`, so a released or unsupported field still shows its still.
- Call `destroy()` on unmount. In React, mount in an effect and destroy in its cleanup; StrictMode's double mount is safe.
- Keep `lazy` on (the default) for anything below the fold. `lazy: false` mounts at once wherever the element is.
