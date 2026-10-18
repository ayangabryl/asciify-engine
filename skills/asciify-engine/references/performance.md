# Performance guarantees

What `asciify-engine` promises a host page, and the default budgets. Measured by `tests/host-cost-browser.mjs` and `scripts/bundle-cost.mjs` in the engine repository, and held by its unit tests.

## Import and bundle

- **No work at import.** Every entry (`asciify-engine`, `/core`, `/field`, `/hover`, `/studio`, `/kit`) only defines code: no DOM, canvas, WebGL, observer, timer, frame or global is touched until you call something. Safe under SSR (Next.js, Remix, Astro) without a `window` guard on the import.
- **`sideEffects: false`, and the kit is split per component.** A route that imports one kit component downloads that component, the shared kit core (about 20 kB) and the field (about 67 kB), not the whole kit: `fieldBackground` alone costs a code-split host about 90 kB minified (33 kB gzipped), against 285 kB (100 kB) when the kit was one module.

## Main thread

- **Mounting is spread out.** Kit fields mount when they come within half a viewport of the screen, at most one per frame however many a host starts in one task (a route change, a long list). Shader programs link with `KHR_parallel_shader_compile` where the browser has it.
- **Nothing runs when nothing changes.** A still field stops its frame loop. Fields off screen, in a hidden tab, in a `display: none` host or with zero size do not draw. Reduced motion settles every component on a still.
- **Ambient motion is capped.** Drift, scenes and self-animating components draw at most 60 frames a second on any screen (30 with two cores or less, 2 GB of memory or less, or Save-Data). The pointer's wake, lantern, trail, pulses and anything under the pointer keep the screen's full rate.
- **Studio hovers stay responsive.** A live `mountStudio` hover renders at most 60 times a second and never more often than leaves half the main thread free, then ends on its settled frame.
- **Listeners are passive** where the event allows, and every listener, observer, frame, timer, object URL and context is released by `destroy()`, including after a hundred quick mount and destroy cycles.
- **No global CSS but scoped fallbacks.** The few components that inject styles use one `<style id="ascii-kit-…">` each, with every rule inside `:where()` (zero specificity). No console output in normal use.

## GPU and memory

- **Context budget: 12.** At most 12 kit fields hold a WebGL context at once (`setFieldBudget(n)` changes it); past it the field farthest off screen is released to its `poster`. A context the browser takes back is remounted on a fresh canvas. 150 components on one page keep 12 contexts and lose none.
- **Backing store capped.** Pixel ratio is at most 2 by default (`look.maxPixelRatio`), and one field's backing store at most about one 4K screen (8.3 million pixels): a full-bleed field on a 5K or 6K display keeps its cells and draws them at a lower ratio.
- **Slow frames degrade, not stall.** About a second of frames slower than 24 fps drops the field to 1× pixels, then to no ambient motion; the pointer response keeps working.
- **Software WebGL counts as unsupported.** SwiftShader and llvmpipe report `isGlyphFieldSupported() === false` (pass `allowSoftware` to override), so components keep their HTML and poster instead of drawing every pixel on the CPU. Without WebGL2 the same fallback applies.

## What a host should still do

- Give heavy components a `poster`, so a released or unsupported field still shows its still.
- Call `destroy()` on unmount. In React, mount in an effect and destroy in its cleanup; StrictMode's double mount is safe.
- Keep `lazy` on (the default) for anything below the fold. `lazy: false` mounts at once wherever the element is.
