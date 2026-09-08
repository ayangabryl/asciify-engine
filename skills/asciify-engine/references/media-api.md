# Media API notes — published 1.2.0

Use installed package types as the authority for exact signatures. Import from `asciify-engine`.

## Crop and layout

`options.sourceCrop` chooses the source pixels before conversion. Side insets use fractions from 0 to 1 by default:

```js
options: { sourceCrop: { top: 0.08, right: 0.1, bottom: 0.16, left: 0.1 } }
```

Side insets define a new crop aspect. A single `width` or `height` crop derives the other dimension with `preserveAspect` by default. Use `{ unit: 'pixel', x, y, width, height }` for exact source coordinates.

`fitTo`, `objectFit`, `objectPosition`, `width`, `height`, `scale`, and `bleed` position the rendered canvas. Prefer `objectFit: 'cover'` for a full hero and `contain` for a complete subject. Keep the source aspect intact; `fill` can distort it. A small `bleed: { x: '1vw' }` can cover glyph side-bearing gaps, but do not use large oversizing to compensate for inappropriate footage.

Chroma key is optional. Use it only on footage with a removable background:

```js
options: {
  chromaKey: true,
  chromaKeyTolerance: 60,
  chromaKeyTrimMode: 'range',
  chromaKeyTrimPadding: 0.002,
}
```

`range` keeps framing stable over video. `frame` remeasures the foreground each frame and can visibly change scale; choose it intentionally for edge-tight scrubbing. Test key tolerance and trim thresholds on the actual subject. Keying is not a solution for a dark, underlit subject.

## Static image and compact frames

```js
import { asciify } from 'asciify-engine';
const cleanup = await asciify('/photo.jpg', canvas, {
  fontSize: 7,
  options: { colorMode: 'fullcolor', charset: ' .:-=+*#%@' },
});
// On unmount:
if (typeof cleanup === 'function') cleanup();
```

For custom loops, convert and render with the **same options**:

```js
import { DEFAULT_OPTIONS, imageToAsciiTextFrame, renderTextFrameToCanvas } from 'asciify-engine';
const options = { ...DEFAULT_OPTIONS, fontSize: 7, colorMode: 'fullcolor' };
const frame = imageToAsciiTextFrame(image, options, 960, 540);
renderTextFrameToCanvas(context, frame, options, 960, 540);
```

`AsciiTextFrame` uses row strings, dimensions, and an optional packed color buffer; do not substitute it for the object-cell `AsciiFrame` expected by `renderFrameToCanvas`.

## React and Next.js

Initialize browser APIs in an effect; use `'use client'` where needed. Keep settings stable. This pattern handles a late initialization after unmount:

```jsx
useEffect(() => {
  let disposed = false;
  let stop;
  asciifyVideo(src, canvasRef.current, {
    fitTo: heroRef.current,
    objectFit: 'cover',
    fontSize: 7,
    fps: 24,
    maxRenderDimension: 960,
    options: { colorMode: 'fullcolor', hoverStrength: 0, animationStyle: 'none' },
  }).then(cleanup => {
    if (disposed) cleanup();
    else stop = cleanup;
  }).catch(error => {
    if (!disposed) setError(error.message);
  });
  return () => { disposed = true; stop?.(); };
}, [src]);
```

This is lifecycle wiring, not a complete accessibility implementation. For visibility, reduced motion, a still fallback, and text layers, adapt the companion layered-hero example. Do not expose server credentials in client components.

## Scroll-synced video

Use the API's scroll mapping rather than racing it with a second `currentTime` loop:

```js
const stop = await asciifyVideo('/hero.mp4', canvas, {
  fitTo: hero,
  objectFit: 'cover',
  fontSize: 7,
  maxRenderDimension: 960,
  trim: { start: 1, end: 5 },
  scroll: { trigger: hero, from: 1, to: 5 },
  options: { animationStyle: 'none', hoverStrength: 0 },
});
```

For GSAP, pass your installed `gsap` and `ScrollTrigger` instances through `scroll`, alongside `trigger`, `start`, `end`, and `scrub`. `scroll.speed` changes progress mapping, not the source frame rate. `maxCachedFrames` bounds the lazy frame cache. Test rapid direction changes and actual memory use before raising it.

## Procedural backgrounds

```js
import { asciiBackground } from 'asciify-engine';
const background = asciiBackground(host, {
  type: 'aurora', fontSize: 14, speed: 0.8, density: 0.55,
});
// On unmount:
background.destroy();
```

The published background types are wave, rain, stars, pulse, noise, grid, aurora, silk, void, morph, fire, dna, terrain, and circuit. The website's fluid scene is separate application code; it is not a `type: 'fluid'` option in this package version.
