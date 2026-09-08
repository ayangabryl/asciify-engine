# Layer HTML text through ASCII artwork

Use the companion [HTML](../examples/layered-hero.html), [CSS](../examples/layered-hero.css), and [JavaScript](../examples/layered-hero.js) in a browser app with `asciify-engine@1.2.0` installed. Rename the HTML to `index.html` in a Vite project, and provide `/hero.mp4` plus `/hero-poster.jpg` or change its data attributes. The example starts with `data-render-limit="720"`; set this no larger than the source video's longer dimension. No Asciify site footage or fonts are included.

The script renders a poster before requesting video, respects initial reduced motion, pauses offscreen/hidden video, provides a keyboard-operable Play/Pause button, and returns cleanup synchronously while guarding asynchronous setup. Call it on mount and call its returned function on unmount. It uses the public package without the site's patched renderer or private hero sampler.

## The layer order

```html
<section class="ascii-hero">
  <h1 class="hero-title">Your headline</h1>
  <canvas class="hero-art" aria-hidden="true"></canvas>
  <div class="hero-entry">Description and real links</div>
  <div class="hero-controls">Real buttons</div>
</section>
```

```css
.ascii-hero { position: relative; isolation: isolate; overflow: hidden; }
.hero-title { position: relative; z-index: 0; }
.hero-art { position: absolute; z-index: 1; pointer-events: none; background: transparent; }
.hero-entry { position: relative; z-index: 2; }
.hero-controls { position: absolute; z-index: 3; }
```

The transparent gaps between glyphs reveal the headline below. The description and controls stay above the artwork. This is the cover relationship on Asciify; it does not rasterize the headline or make its wording part of the charset.

Do not wrap the headline and CTA together in a parent with `transform`, `filter`, `opacity < 1`, `isolation`, or a positioned `z-index`. That creates a separate stacking context: a high `z-index` on the CTA cannot escape its parent's lower layer. Keep the three semantic layers as siblings, or explicitly split their wrappers into those levels.

Do not paint a solid rectangle behind the ASCII glyphs. A black stage/canvas at z-index 1 would cover the lower headline completely. The section owns the background color; the drawing surface stays transparent. If building a custom renderer, clear the full drawing surface before each frame rather than fading old frames, which can leave unwanted trails.

## Readability and input

- Keep the headline as an `h1` with real text. Decorative canvases use `aria-hidden="true"`.
- Keep descriptions and buttons above the ASCII. Use localized text shadow or a restrained scrim where required; do not depend on one favorable video frame for contrast.
- Choose the headline color independently from `options.colorMode`—a yellow HTML title can coexist with full-color or gray ASCII.
- `pointer-events: none` lets users select text and click controls through the decoration. For optional studio hover, listen on the hero host, not the decorative canvas; the module ignores interactive control targets.
- If the headline becomes hard to read, reduce artwork opacity or add the example's `text-in-front` class to put the title at z-index 2. Keep this choice driven by the content and the user's design.
- The media remains a cover crop on narrow screens. Check the subject's position there; moving HTML layers does not fix source framing.

## Performance boundary

This example shows portable layering and lifecycle with the published package. It does not claim the exact GPU performance or custom interactions of the Asciify production hero. Match the website's enhanced hover behavior only by intentionally adding the [optional studio module](studio-effects.md). That module adds a canvas and must occupy the same artwork layer, not cover the controls.

For additional custom text in the artwork, change `options.charset` while retaining its tonal symbols. Keep the headline itself in HTML so it remains readable, searchable, selectable, and accessible.
