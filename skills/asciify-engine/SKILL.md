---
name: asciify-engine
description: Convert images, videos, GIFs, webcam streams, text, and animated backgrounds into high-performance ASCII art with the asciify-engine npm package. Use when creating ASCII media, integrating asciifyVideo/asciify/asciifyGif, building scroll-synced ASCII video, tuning FPS/detail/performance, using compact text-frame APIs, hover effects, chroma key, recording/export, or updating an app that depends on asciify-engine.
---

# asciify-engine

Use this skill for the `asciify-engine` npm package.

**Package:** `asciify-engine`  
**Current version:** `1.0.105`  
**Playground:** https://asciify.org  
**GitHub:** https://github.com/ayangabryl/asciify-engine

The engine is zero-dependency except GIF decoding. It renders ASCII art on canvas from images, videos, GIFs, webcam streams, generated backgrounds, and text.

## When To Use

Use this skill when the user wants to:

- Convert images, videos, GIFs, webcam, or text into ASCII art.
- Add ASCII video/backgrounds to React, Next.js, Vue, Svelte, or vanilla JS.
- Build scroll-synced ASCII video with GSAP ScrollTrigger or native scroll.
- Improve ASCII media performance, FPS, detail, resolution, or hover behavior.
- Use chroma key, fullcolor, accent, matrix, grayscale, dense/braille charsets, or hover effects.
- Use low-level prepared/compact frame APIs.
- Record/export ASCII canvas output.
- Update docs, package usage, or skill instructions for `asciify-engine`.

## Installation

```bash
npm install asciify-engine
```

For existing apps, install the latest tested version:

```bash
npm install asciify-engine@1.0.105
```

## Mental Model

Prefer the simple APIs first:

- `asciify()` for static images/canvas/video elements.
- `asciifyVideo()` for live or scroll-synced video.
- `asciifyGif()` for animated GIF files.
- `asciiBackground()` for procedural ASCII backgrounds.

For high-performance media, the engine uses compact text-frame paths when possible:

- `imageToAsciiTextFrame()`
- `videoToAsciiTextFrames()`
- `gifToAsciiTextFrames()`
- `renderTextFrameToCanvas()`

These avoid object-per-cell frames and are the preferred low-level APIs for dense media, including fullcolor in `1.0.91+`.

Use legacy object frames only when you need per-cell mutation, dots mode, heavy hover/animation transforms, or compatibility with existing `AsciiFrame` consumers:

- `imageToAsciiFrame()`
- `videoToAsciiFrames()`
- `gifToAsciiFrames()`
- `renderFrameToCanvas()`

Use `options.sourceCrop` when the source media has empty edges or needs tighter framing. Percent values are normalized `0–1` by default. Prefer CSS-like insets for readable framing; side insets define the crop window directly, and `asciifyVideo` sizes from that crop aspect so it does not stretch:

```ts
options: {
  sourceCrop: { top: 0.08, bottom: 0.22 },
}
```

Crop from the sides the same way:

```ts
options: {
  sourceCrop: { left: 0.1, right: 0.1 },
}
```

Use any side together:

```ts
options: {
  sourceCrop: { top: 0.08, right: 0.12, bottom: 0.22, left: 0.12 },
}
```

For centered crops, `sourceCrop: { height: 0.7 }` keeps 70% of the source and preserves the original source aspect. `preserveAspect` is only for single-dimension `width`/`height` crops; do not use it to force hero bands. For wide heroes, crop with `top`/`bottom` and let the engine derive the cropped aspect. `sourceCrop` is opt-in; when omitted, the engine samples the full source exactly as older versions did.

Use top-level `asciifyVideo` layout options when the destination needs full-bleed framing. These affect the visible canvas only, not the sampled media:

```ts
await asciifyVideo('/hero.mp4', canvas, {
  fitTo: hero,
  objectFit: 'cover',
  objectPosition: 'center 62%',
  scale: 1.06,
  width: '100%',
  height: '100%',
  options: {
    sourceCrop: { top: 0.08, bottom: 0.14 },
  },
});
```

Mental split:

- `sourceCrop` chooses the source window before ASCII conversion.
- CSS-like insets change the crop aspect naturally; the engine keeps ASCII proportions intact.
- `objectFit`, `objectPosition`, `scale`, `width`, and `height` place the rendered canvas in the page.
- Use `objectFit: 'cover'` for full-width/full-bleed heroes.
- Use `objectFit: 'contain'` for previews where the whole source should remain visible.
- Use `scale` for gentle overfill instead of CSS width hacks like `110vw`.

## Visual Target

Good ASCII media should feel intentional, not like a broken video filter.

- The subject silhouette is readable at first glance.
- Character density reveals form, light, and motion without turning into noise.
- The canvas respects the media aspect ratio and fills the intended container.
- Accent/fullcolor choices support the page design instead of shouting over it.
- Text is crisp, not browser-blurred, stretched, or visibly low resolution.
- Motion updates feel continuous; if FPS drops, reduce work before adding effects.

## Decision Playbooks

### User Wants More Detail

Do not only reduce `fontSize`. Use this ladder:

1. Confirm the canvas/container is actually large enough and not CSS-stretched from a tiny backing buffer.
2. Use `fitTo` for videos so the engine owns canvas sizing.
3. Use `CHARSETS.dense` for normal ASCII detail.
4. Enable `normalize: true` for muted or low-contrast sources.
5. Raise `maxRenderDimension` one step: `960 -> 1280 -> 1600 -> 2048`.
6. Then lower `fontSize`: `8 -> 6 -> 5 -> 4`.
7. Try `colorMode: 'accent'` before `fullcolor` if the design can be monochrome.
8. Use `CHARSETS.braille` only when ultra-detail matters and the style can handle the texture.

Stop when the subject reads clearly. More cells after that often make the image noisier, not better.

### User Wants Smoother FPS

Reduce hot-path work in this order:

1. Keep `animationStyle: 'none'` and `hoverStrength: 0`.
2. Use compact text-frame-compatible settings: `renderMode: 'ascii'`, no `charsetFrames`.
3. Prefer `accent`, `matrix`, or `grayscale`; keep `fullcolor` only when color matters.
4. Lower `maxRenderDimension`: `2048 -> 1600 -> 1280 -> 960`.
5. Raise `fontSize`: `4 -> 5 -> 6 -> 8`.
6. Lower `fps`: `60 -> 30 -> 24`.
7. Avoid `dots`, per-cell hover, and animated charsets on dense video.

If FPS is still poor, inspect whether the app is resizing the canvas every frame or remounting the component.

### User Wants A Premium Hero

Recommended starting point:

```ts
{
  fitTo: hero,
  objectFit: 'contain',
  objectPosition: 'center bottom',
  width: '100%',
  height: '100%',
  fontSize: 5,
  fps: 60,
  maxRenderDimension: 1280,
  maxCachedFrames: 96,
  artStyle: 'classic',
  options: {
    charset: CHARSETS.dense,
    colorMode: 'accent',
    accentColor: '#e8d7b7',
    normalize: true,
    sourceCrop: { top: 0.08, bottom: 0.16 },
    animationStyle: 'none',
    hoverStrength: 0,
  }
}
```

Design rules:

- Use one restrained accent color pulled from the brand/page palette.
- Put ASCII behind or below the core CTA, not directly under tiny text.
- Use masks or fades at edges when the ASCII meets page content.
- Keep the hero background quiet enough that the headline wins.
- Use scroll scrub only when it tells a story; do not scrub decorative noise.

### User Wants Fullcolor

Use fullcolor when color carries product meaning, artwork, identity, or footage mood.

Start with:

```ts
{
  fontSize: 6,
  fps: 30,
  maxRenderDimension: 1280,
  artStyle: 'art',
  options: {
    charset: CHARSETS.dense,
    colorMode: 'fullcolor',
    normalize: true,
    sourceCrop: { top: 0.08, bottom: 0.16 },
    animationStyle: 'none',
    hoverStrength: 0,
  }
}
```

If it is slow, first lower `maxRenderDimension` or raise `fontSize`. Do not jump straight to `fontSize: 3`.

### User Wants Hover Interaction

Hover is per-cell work. Keep it deliberate:

- Use `fontSize >= 8` for large canvases.
- Use smaller framed demos rather than full-screen 4px ASCII.
- Start with `HOVER_PRESETS.subtle` or `hoverStrength: 0.2`.
- Avoid hover on scroll-synced video unless the canvas is small.
- Prefer hover for static images, generated text backgrounds, or product demos.

### User Says It Is Blurry

Check in this order:

1. Is the canvas CSS size different from its backing `width`/`height`?
2. For video, is `fitTo` provided?
3. Is the source itself low resolution?
4. Is `maxRenderDimension` too low for the displayed size?
5. Is CSS applying `filter`, `transform: scale`, or opacity compositing that softens text?
6. For tiny font ASCII, verify the design accepts raster-like pixel detail.

### User Says It Is Blank

Check:

1. Source loaded and video has metadata.
2. Canvas has nonzero width/height.
3. Video is not `display: none`.
4. `chromaKey` is not removing the subject.
5. `invert` and page background are not making characters invisible.
6. For async React use, cleanup did not run before `asciifyVideo()` resolved.

### User Says It Is Too Large Or Overflows

Use layout fixes before quality fixes:

- Wrap canvas in a positioned container.
- Set canvas CSS to `position:absolute; inset:0; width:100%; height:100%`.
- Use `fitTo: container`.
- Keep the parent aspect ratio or explicit height stable.
- Avoid manually setting `canvas.width = window.innerWidth` in React render.

### User Wants To Remove Empty Space In The Media

Prefer source cropping over layout hacks when the video/image itself has dead space:

```ts
await asciifyVideo(video, canvas, {
  fitTo: hero,
  options: {
    chromaKey: true,
    sourceCrop: { top: 0.08, bottom: 0.22 },
  },
});
```

- `sourceCrop` happens before ASCII sampling, so the subject is reframed without changing the canvas box.
- Default unit is `'percent'`; use values from `0` to `1`.
- Use `top`, `right`, `bottom`, and `left` for CSS-like side crops.
- Use `{ unit: 'pixel', x, y, width, height }` for exact media-pixel crops.
- Keep `preserveAspect` enabled unless you intentionally want an exact source window that can stretch.
- For hero videos, crop the source first, then use small layout overlap only if the next section needs to tuck closer.

### Scroll-Scrub Performance Model

In `1.0.93+`, the fast text-frame scrub path uses a Pretext-inspired split:

- Prepare/cache frames lazily around the current scroll target.
- Render compact row strings instead of object-per-cell frames.
- Diff transparent rows and only redraw rows whose text changed.
- Prefer `fastSeek()` when the browser supports it.
- Prefetch nearby frames around the current target so scrolling back and forth has fewer misses.

For smooth scrub, keep options compatible with this fast path:

```ts
{
  renderMode: 'ascii',
  animationStyle: 'none',
  hoverStrength: 0,
  colorMode: 'accent', // or grayscale/matrix
}
```

## Design Playbooks

### Dark Premium Landing Page

- Use `#121212` or near-black page background.
- Prefer `accent` over `fullcolor` unless the footage itself is beautiful.
- Use warm off-white or brand accent, not neon by default.
- Pair ASCII with framed layout, thin borders, or quiet masks.
- Keep copy short; ASCII should carry some of the storytelling.

### Technical / Infrastructure Aesthetic

- Use `matrix`, `grayscale`, or a cool `accentColor`.
- Use `CHARSETS.dense`, `lines`, `box`, or `geometric`.
- Compose with visible grid lines, clipped containers, and measured spacing.
- Avoid playful emoji/katakana unless the brand asks for it.

### Editorial / Portfolio Aesthetic

- Use `accent` with a soft paper/warm ink palette.
- Use slower video, stills, or subtle scroll reveal.
- Keep `fontSize: 5-8`; avoid over-dense unreadable texture.
- Use ASCII as proof/atmosphere around work, not as a gimmick.

### Playground / Demo Aesthetic

- Show controls that map to real engine tradeoffs: detail, FPS, color, charset, hover.
- Surface live `cols x rows`, FPS, and current source dimensions.
- Include presets: `Smooth`, `Detailed`, `Fullcolor`, `Interactive`.
- When changing presets, explain the performance tradeoff in the UI.

## Quality Checks

- Subject is recognizable in a screenshot.
- FPS is stable for 5-10 seconds, not just on first load.
- The canvas does not resize every frame.
- Text/CTA remains readable over or near the ASCII.
- Mobile uses a less expensive preset than desktop when needed.
- Reduced-motion users still get a static or slower frame.
- Cleanup runs on unmount and cancels video/background loops.

## Simple APIs

### Static Image

```ts
import { asciify, CHARSETS } from 'asciify-engine';

await asciify('/photo.jpg', canvas, {
  fontSize: 6,
  artStyle: 'art',
  options: {
    charset: CHARSETS.dense,
    colorMode: 'fullcolor',
    normalize: true,
  },
});
```

### Live Video

```ts
import { asciifyVideo, CHARSETS } from 'asciify-engine';

const stop = await asciifyVideo('/clip.mp4', canvas, {
  fitTo: container,
  fontSize: 6,
  fps: 60,
  maxRenderDimension: 1280,
  artStyle: 'classic',
  options: {
    charset: CHARSETS.dense,
    colorMode: 'accent',
    accentColor: '#e8d7b7',
    normalize: true,
  },
});

// cleanup
stop();
```

### GIF

```ts
import { asciifyGif } from 'asciify-engine';

const stop = await asciifyGif('/loop.gif', canvas, {
  fontSize: 8,
  artStyle: 'letters',
  options: { colorMode: 'fullcolor' },
});

stop();
```

## Scroll-Synced Video

`asciifyVideo()` supports scroll scrubbing. Use this for landing-page hero reveals, editorial sections, and pinned/scrollytelling moments.

### GSAP ScrollTrigger

```ts
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { asciifyVideo, CHARSETS } from 'asciify-engine';

const stop = await asciifyVideo('/hero.mp4', canvas, {
  fitTo: wrapper,
  fontSize: 4,
  fps: 60,
  maxRenderDimension: 1280,
  trim: { start: 2.2, end: 6.65 },
  scroll: {
    gsap,
    ScrollTrigger,
    trigger: wrapper,
    start: 'top 88%',
    end: 'bottom 18%',
    scrub: 0.45,
    speed: 1.35,
    from: 2.2,
    to: 6.65,
  },
  options: {
    charset: CHARSETS.dense,
    colorMode: 'accent',
    accentColor: '#e8d7b7',
    normalize: true,
    chromaKey: true,
    chromaKeyTolerance: 84,
  },
});
```

### Native Scroll Scrub

```ts
const stop = await asciifyVideo('/hero.mp4', canvas, {
  fitTo: wrapper,
  fontSize: 6,
  scroll: {
    trigger: wrapper,
    from: 0,
    to: 5,
  },
});
```

### Scroll Best Practices

- Use `scroll` for time-to-scroll mapping, not custom `video.currentTime` loops.
- Pass the same `from`/`to` as `trim.start`/`trim.end` when scrubbing a clipped range.
- Use `scroll.speed` for faster or slower scrub pacing. `speed: 2` reaches the end in half the scroll distance; `speed: 0.5` takes twice the distance.
- Use `fps: 30-60`; choose `60` for smooth short hero clips, `24-30` for heavy fullcolor.
- Use `maxRenderDimension: 960-1280` for large full-width hero videos. Use `2048` only when truly needed.
- Use `fontSize: 4-6` for detailed hero ASCII; below `4px` is expensive and should use compact text-frame paths only.
- Avoid hover effects on dense scroll video. Hover is per-cell work.
- Never set the backing video to `display: none`; the API keeps URL-created videos decode-safe automatically.

## Performance Guide

### Fastest Media Settings

For smooth high-density video:

```ts
{
  fontSize: 5,
  fps: 60,
  maxRenderDimension: 1280,
  artStyle: 'classic',
  options: {
    charset: CHARSETS.dense,
    colorMode: 'accent',
    animationStyle: 'none',
    hoverStrength: 0,
    normalize: true,
  }
}
```

### Fullcolor Settings

Fullcolor is supported by the compact text-frame path in `1.0.91+`.

```ts
{
  fontSize: 6,
  fps: 30,
  maxRenderDimension: 1280,
  artStyle: 'art',
  options: {
    charset: CHARSETS.dense,
    colorMode: 'fullcolor',
    animationStyle: 'none',
    hoverStrength: 0,
    normalize: true,
  }
}
```

Use fullcolor when the source color is important. Use `accent` when you want the highest FPS and a more designed monochrome look.

### Detail Tuning

- `fontSize`: main detail/performance knob. Smaller means more cells.
- `maxRenderDimension`: caps media processing resolution before ASCII conversion.
- `CHARSETS.dense`: best general image/video ramp.
- `CHARSETS.braille`: very high visual resolution but can be visually noisy and heavier.
- `normalize: true`: improves contrast/detail for muted media.
- `ditherStrength: 0-0.25`: adds texture but costs more and can shimmer in video.
- `chromaKey`: useful for green/blue-screen subjects over page backgrounds.

### Expensive Features

These are intentionally richer and can reduce FPS on dense canvases:

- `renderMode: 'dots'`
- `hoverStrength > 0`
- `animationStyle !== 'none'`
- `charsetFrames`
- tiny `fontSize` with `fullcolor`
- very high `maxRenderDimension`

For interactive hover demos, use `fontSize >= 8` or smaller canvases.

## Low-Level APIs

### Compact Text Frames

Use for dense static images, GIFs, videos, and fullcolor media where you do not need per-cell mutation.

```ts
import {
  imageToAsciiTextFrame,
  renderTextFrameToCanvas,
  DEFAULT_OPTIONS,
} from 'asciify-engine';

const frame = imageToAsciiTextFrame(img, {
  ...DEFAULT_OPTIONS,
  fontSize: 6,
  colorMode: 'fullcolor',
}, 1280, 720);

renderTextFrameToCanvas(ctx, frame, DEFAULT_OPTIONS, 1280, 720);
```

Available compact APIs:

```ts
imageToAsciiTextFrame(source, options, width?, height?) -> AsciiTextFrame
videoToAsciiTextFrames(video, options, width, height, fps?, maxSec?, onProgress?, startTime?)
gifToAsciiTextFrames(buffer, options, width, height, onProgress?)
renderTextFrameToCanvas(ctx, textFrame, options, width, height)
```

`AsciiTextFrame` contains:

```ts
type AsciiTextFrame = {
  rows: string[];
  cols: number;
  rowCount: number;
  colors?: Uint8ClampedArray; // present for fullcolor compact frames
}
```

### Legacy Object Frames

Use when you need cell objects, hover transforms, dots rendering, or compatibility:

```ts
imageToAsciiFrame(source, options, width?, height?) -> { frame, cols, rows }
videoToAsciiFrames(video, options, width, height, fps?, maxSec?, onProgress?, startTime?)
gifToAsciiFrames(buffer, options, width, height, onProgress?)
renderFrameToCanvas(ctx, frame, options, width, height, time?, mousePos?)
```

### Cache Management

Long-lived editors/playgrounds that cycle many charsets or fonts can clear shared lookup caches:

```ts
import { clearAsciifyCaches } from 'asciify-engine';

clearAsciifyCaches();
```

## React / Next.js Pattern

```tsx
'use client';

import { useEffect, useRef } from 'react';
import { asciifyVideo, CHARSETS } from 'asciify-engine';

export function AsciiHero() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;

    let cleanup: (() => void) | undefined;
    let alive = true;

    asciifyVideo('/hero.mp4', canvas, {
      fitTo: wrapper,
      fontSize: 5,
      fps: 60,
      maxRenderDimension: 1280,
      artStyle: 'classic',
      options: {
        charset: CHARSETS.dense,
        colorMode: 'accent',
        accentColor: '#e8d7b7',
        normalize: true,
      },
    }).then(stop => {
      if (alive) cleanup = stop;
      else stop();
    });

    return () => {
      alive = false;
      cleanup?.();
    };
  }, []);

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width: '100%', height: '100vh' }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
    </div>
  );
}
```

## Animated Backgrounds

```ts
import { asciiBackground } from 'asciify-engine';

const stop = asciiBackground('#hero-bg', {
  type: 'aurora',
  colorScheme: 'auto',
  fontSize: 14,
  speed: 0.8,
  density: 0.55,
  accentColor: '#d4ff00',
});

stop();
```

Available background types:

`wave`, `rain`, `stars`, `pulse`, `noise`, `grid`, `aurora`, `silk`, `void`, `morph`, `fire`, `dna`, `terrain`, `circuit`

Individual `render*Background` functions are also exported for custom canvas loops.

## Options Reference

Common `AsciiOptions`:

| Property | Type | Notes |
|---|---|---|
| `fontSize` | `number` | Main detail/performance knob. |
| `charSpacing` | `number` | Cell spacing multiplier. |
| `brightness` | `number` | `-1` to `1`. |
| `contrast` | `number` | Positive increases contrast. |
| `charset` | `string` | Use `CHARSETS`. |
| `colorMode` | `'grayscale' | 'fullcolor' | 'matrix' | 'accent'` | Fullcolor is fast-path capable in `1.0.91+`. |
| `accentColor` | `string` | Used for accent/matrix-style rendering. |
| `invert` | `boolean | 'auto'` | Use `'auto'` for light/dark themes. |
| `renderMode` | `'ascii' | 'dots'` | Dots is richer/heavier. |
| `animationStyle` | `AnimationStyle` | Keep `'none'` for max FPS. |
| `animationSpeed` | `number` | Animation speed multiplier. |
| `dotSizeRatio` | `number` | Dot size for dots mode. |
| `ditherStrength` | `number` | Use lightly for video. |
| `hoverStrength` | `number` | Set `0` for fast media. |
| `hoverRadius` | `number` | Hover influence radius. |
| `hoverEffect` | `HoverEffect` | Spotlight/magnify/etc. |
| `hoverColor` | `string` | Hover tint. |
| `artStyle` | `ArtStyle` | Preset name. |
| `customText` | `string` | Repeating custom text. |
| `chromaKey` | `boolean | string | {r,g,b} | null` | Green/blue/custom keying. |
| `chromaKeyTolerance` | `number` | Default around `60`; raise for noisy footage. |
| `normalize` | `boolean` | Stretch source luminance. |
| `charsetFrames` | `string[]` | Animated charset sequence; heavier. |
| `charsetFps` | `number` | Charset sequence rate. |

## Charsets And Styles

Use:

```ts
import { CHARSETS, ART_STYLE_PRESETS } from 'asciify-engine';
```

Common charsets:

- `CHARSETS.standard`
- `CHARSETS.dense`
- `CHARSETS.blocks`
- `CHARSETS.braille`
- `CHARSETS.lines`
- `CHARSETS.dots`
- `CHARSETS.letters`
- `CHARSETS.katakana`
- `CHARSETS.circles`
- `CHARSETS.geometric`
- `CHARSETS.shadows`
- `CHARSETS.starfield`

Common art styles:

- `classic`: standard ASCII.
- `art`: dense fullcolor detail.
- `particles`: dots/fullcolor.
- `letters`: alphabet characters.
- `terminal`: matrix green.
- `braille`: high detail.
- `box`, `lines`, `katakana`, `emoji`, `circles`, `shadows`, `geometric`, `waves`, `shards`, `smoke`.

## Hover And Animation

Hover effects:

`spotlight`, `magnify`, `repel`, `glow`, `colorShift`, `attract`, `shatter`, `trail`, `glitchText`

Hover presets:

`none`, `subtle`, `flashlight`, `magnifier`, `forceField`, `neon`, `fire`, `ice`, `gravity`, `shatter`, `ghost`, `glitchReveal`

Animation styles:

`none`, `wave`, `pulse`, `rain`, `breathe`, `sparkle`, `glitch`, `spiral`, `typewriter`, `scatter`, `waveField`, `ripple`, `melt`, `orbit`, `cellular`

Best practice:

- For video backgrounds and scroll heroes, use `animationStyle: 'none'` and `hoverStrength: 0`.
- For interactive hover demos, keep the canvas smaller or use `fontSize >= 8`.
- Avoid combining tiny fonts, fullcolor, hover, and animation unless the visual really needs it.

## Recording And Export

```ts
import { createRecorder, recordAndDownload } from 'asciify-engine';

await recordAndDownload(canvas, { duration: 3000, filename: 'ascii-art' });

const recorder = createRecorder(canvas, { fps: 30 });
recorder.start();
const blob = await recorder.stop();
```

## Type Imports

```ts
import type {
  AsciiOptions,
  AsciiCell,
  AsciiFrame,
  AsciiTextFrame,
  AsciifySimpleOptions,
  AsciifyVideoOptions,
  VideoScrollScrubOptions,
  ColorMode,
  AnimationStyle,
  ArtStyle,
  HoverEffect,
} from 'asciify-engine';
```
