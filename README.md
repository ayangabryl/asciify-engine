# asciify-engine

<p align="left">
  <a href="https://www.npmjs.com/package/asciify-engine"><img src="https://img.shields.io/npm/v/asciify-engine?color=d4ff00&labelColor=0a0a0a&style=flat-square" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/asciify-engine"><img src="https://img.shields.io/npm/dm/asciify-engine?color=d4ff00&labelColor=0a0a0a&style=flat-square" alt="downloads" /></a>
  <a href="https://github.com/ayangabryl/asciify-engine/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-d4ff00?labelColor=0a0a0a&style=flat-square" alt="MIT license" /></a>
  <a href="https://www.buymeacoffee.com/asciify"><img src="https://img.shields.io/badge/buy_me_a_coffee-%E2%98%95-d4ff00?labelColor=0a0a0a&style=flat-square" alt="Buy Me A Coffee" /></a>
</p>

A framework-agnostic ASCII art rendering engine for the browser. Convert images, animated GIFs, and video into character-based art rendered onto an HTML canvas — with full color support, animated backgrounds, interactive hover effects, and embed generation. Zero runtime dependencies.

**[&#9654; Live Playground](https://asciify.org) &middot; [npm](https://www.npmjs.com/package/asciify-engine)**

---

## Overview

asciify-engine works in two stages:

1. **Convert** — a source (image, GIF buffer, video element) is sampled and converted into an `AsciiFrame`: a 2D array of character cells, each carrying a character and RGBA color data.
2. **Render** — the frame is drawn onto a `<canvas>` element via a 2D context, with full support for color modes, font sizes, hover effects, and time-based animations.

This separation means you can pre-compute frames once and render them at any frame rate, making it efficient for both static images and smooth animations.

---

## Installation

```bash
npm install asciify-engine
```

Works with any modern bundler (Vite, webpack, esbuild, Rollup) and any framework — React, Vue, Svelte, Angular, Next.js, or vanilla JS.

---

## Converting Media to ASCII

### Images

`imageToAsciiFrame` accepts any `HTMLImageElement`, `HTMLVideoElement`, or `HTMLCanvasElement` and returns a single ASCII frame.

```ts
import { imageToAsciiFrame, renderFrameToCanvas, DEFAULT_OPTIONS } from 'asciify-engine';

const img = new Image();
img.crossOrigin = 'anonymous';
img.src = 'photo.jpg';

img.onload = () => {
  const canvas = document.getElementById('ascii') as HTMLCanvasElement;
  const ctx    = canvas.getContext('2d')!;
  const opts   = { ...DEFAULT_OPTIONS, fontSize: 10, colorMode: 'fullcolor' as const };

  const { frame } = imageToAsciiFrame(img, opts, canvas.width, canvas.height);
  renderFrameToCanvas(ctx, frame, opts, canvas.width, canvas.height);
};
```

### Animated GIFs

`gifToAsciiFrames` parses a GIF `ArrayBuffer` and returns one `AsciiFrame` per GIF frame, preserving the original frame rate.

```ts
import { gifToAsciiFrames, renderFrameToCanvas, DEFAULT_OPTIONS } from 'asciify-engine';

const buffer = await fetch('animation.gif').then(r => r.arrayBuffer());
const canvas = document.getElementById('ascii') as HTMLCanvasElement;
const opts   = { ...DEFAULT_OPTIONS, fontSize: 8 };

const { frames, fps } = await gifToAsciiFrames(buffer, opts, canvas.width, canvas.height);

let frameIndex = 0;
setInterval(() => {
  renderFrameToCanvas(canvas.getContext('2d')!, frames[frameIndex], opts, canvas.width, canvas.height);
  frameIndex = (frameIndex + 1) % frames.length;
}, 1000 / fps);
```

### Video

`asciifyVideo` streams video as live ASCII art in real time. Instant start, constant memory, unlimited duration.

> ⚠️ Never set the backing `<video>` element to `display: none` — browsers skip GPU frame decoding. When given a URL string, `asciifyVideo` handles this automatically.

```ts
import { asciifyVideo } from 'asciify-engine';

const canvas = document.getElementById('ascii') as HTMLCanvasElement;

// Minimal
const stop = await asciifyVideo('/clip.mp4', canvas);

// Fit canvas to a container and re-size automatically on resize:
const stop = await asciifyVideo('/clip.mp4', canvas, {
  fitTo: '#hero',  // or an HTMLElement
});

// Lifecycle hooks — ready state, timers, etc.:
const stop = await asciifyVideo('/clip.mp4', canvas, {
  fitTo: '#hero',
  fontSize: 6,
  onReady: () => setLoading(false),
  onFrame: () => setElapsed(t => t + 1),
});

// Pre-extract all frames before playback (frame-perfect loops, short clips):
const stop = await asciifyVideo('/clip.mp4', canvas, { preExtract: true });

// Clean up:
stop();
```



---

## Rendering Options

All conversion and render functions accept an `AsciiOptions` object. Spread `DEFAULT_OPTIONS` as a base and override what you need.

| Option | Type | Default | Description |
|---|---|---|---|
| `fontSize` | `number` | `10` | Character cell size in pixels. Smaller values increase density and detail. |
| `colorMode` | `'grayscale' \| 'fullcolor' \| 'matrix' \| 'accent'` | `'grayscale'` | Determines how pixel color is mapped to character color. |
| `charset` | `string` | Standard ramp | Characters ordered from dense to sparse, representing brightness levels. |
| `brightness` | `number` | `0` | Brightness adjustment from `-1` (darker) to `1` (lighter). |
| `contrast` | `number` | `1` | Contrast multiplier applied before character mapping. |
| `invert` | `boolean` | `false` | Inverts the luminance mapping — light areas become dense, dark areas sparse. |
| `renderMode` | `'ascii' \| 'dots'` | `'ascii'` | Render as text characters or circular dot particles. |
| `hoverEffect` | `string` | `'none'` | Interactive effect driven by cursor position. See hover effects below. |
| `hoverStrength` | `number` | `0` | Effect intensity (0–1). `0` = hover disabled. |
| `hoverRadius` | `number` | `0.2` | Effect radius relative to canvas size (0–1). |
| `chromaKey` | `{r,g,b} \| string \| null` | `null` | Remove a background colour (green/blue screen). Keyed pixels become transparent spaces. Accepts `{r,g,b}`, any CSS colour string, or `null` to disable. |
| `chromaKeyTolerance` | `number` | `60` | Euclidean RGB distance threshold for chroma-key detection. `0` = exact match, higher = more pixels removed (max useful ~100). |

### Chroma Key (Green/Blue Screen)

Remove a solid background colour from any source — images, GIFs, or video — so the canvas background shows through keyed pixels.

```ts
import { asciify, DEFAULT_OPTIONS } from 'asciify-engine';

// Green screen
asciify(img, canvas, {
  options: {
    ...DEFAULT_OPTIONS,
    chromaKey: '#00ff00',       // CSS colour string — hex, rgb(), named all work
    chromaKeyTolerance: 60,     // tune to your footage (0 = exact, ~80 = loose)
    colorMode: 'fullcolor',
  },
});

// Blue screen
asciify(img, canvas, {
  options: { ...DEFAULT_OPTIONS, chromaKey: 'blue', chromaKeyTolerance: 70 },
});

// Custom RGB key
asciify(img, canvas, {
  options: { ...DEFAULT_OPTIONS, chromaKey: { r: 0, g: 180, b: 90 }, chromaKeyTolerance: 50 },
});

// Live video with green screen
asciifyVideo('/footage.mp4', canvas, {
  fitTo: '#container',
  options: { ...DEFAULT_OPTIONS, chromaKey: '#00b140', chromaKeyTolerance: 65, colorMode: 'fullcolor' },
});
```

**Tolerance guide:**
- `40–60` — tight key, natural green screen under good lighting
- `60–80` — broader key, wrinkled fabric or uneven lighting
- `80–120` — aggressive; expect some spill into the subject

### Color Modes

| Mode | Description |
|---|---|
| `grayscale` | Classic monochrome ASCII. Character brightness maps to source luminance. |
| `fullcolor` | Each character inherits the original pixel color from the source. |
| `matrix` | Monochrome green — inspired by classic terminal aesthetics. |
| `accent` | Single accent color applied uniformly across all characters. |

### Hover Effects

Interactive effects that respond to cursor movement. Pass the effect name to `hoverEffect` and supply the cursor position to `renderFrameToCanvas` at render time.

Available effects: `spotlight` · `flashlight` · `magnifier` · `force-field` · `neon` · `fire` · `ice` · `gravity` · `shatter` · `ghost`

```ts
canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  renderFrameToCanvas(ctx, frame, opts, canvas.width, canvas.height, Date.now() / 1000, {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  });
});
```

---

## Animated Backgrounds

`asciiBackground` mounts a self-animating ASCII renderer onto any DOM element — ideal for hero sections, banners, or full-page backgrounds. It manages its own canvas, animation loop, and resize handling internally.

```ts
import { asciiBackground } from 'asciify-engine';

const stop = asciiBackground('#hero', {
  type: 'rain',
  colorScheme: 'auto', // follows OS dark/light mode
  speed: 1.0,
  density: 0.55,
  accentColor: '#d4ff00',
});

// Stop and clean up when no longer needed
stop();
```

### Available Background Types

| Type | Description |
|---|---|
| `wave` | Flowing sine-wave field with layered noise turbulence |
| `rain` | Vertical column rain with a glowing leading character and fading trail |
| `stars` | Parallax star field that reacts to cursor position |
| `pulse` | Concentric ripple bursts emanating from the cursor |
| `noise` | Smooth value-noise field with organic, fluid motion |
| `grid` | Geometric grid that warps and brightens near the cursor |
| `aurora` | Sweeping borealis-style color bands drifting across the field |
| `silk` | Fluid swirl simulation following cursor movement |
| `void` | Gravitational singularity — characters spiral inward toward the cursor |
| `morph` | Characters morph between shapes over time, driven by noise |

### Background Options

| Option | Type | Default | Description |
|---|---|---|---|
| `type` | `string` | `'wave'` | Which background renderer to use. |
| `colorScheme` | `'auto' \| 'light' \| 'dark'` | `'dark'` | `'auto'` reacts to OS theme changes in real time. |
| `fontSize` | `number` | `13` | Character size in pixels. |
| `speed` | `number` | `1` | Global animation speed multiplier. |
| `density` | `number` | `0.55` | Fraction of grid cells that are active (0–1). |
| `accentColor` | `string` | varies | Highlight or leading-character color (any CSS color string). |
| `color` | `string` | — | Override the body character color. |

---

## React Integration

```tsx
import { useEffect, useRef } from 'react';
import { imageToAsciiFrame, renderFrameToCanvas, DEFAULT_OPTIONS } from 'asciify-engine';

export function AsciiImage({ src }: { src: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = src;
    img.onload = () => {
      const opts = { ...DEFAULT_OPTIONS, fontSize: 10, colorMode: 'fullcolor' as const };
      const { frame } = imageToAsciiFrame(img, opts, canvas.width, canvas.height);
      renderFrameToCanvas(canvas.getContext('2d')!, frame, opts, canvas.width, canvas.height);
    };
  }, [src]);

  return <canvas ref={canvasRef} width={800} height={600} />;
}
```

---

## Embed Generation

Generate self-contained HTML that can be hosted anywhere or dropped directly into a page — no runtime dependency required.

```ts
import { generateEmbedCode, generateAnimatedEmbedCode } from 'asciify-engine';

// Static — produces a single-file HTML with the ASCII art baked in
const staticHtml = generateEmbedCode(frame, options);

// Animated — produces a self-running HTML animation
const animatedHtml = generateAnimatedEmbedCode(frames, options, fps);
```

---

## API Reference

| Function | Signature | Returns |
|---|---|---|
| `asciify` | `(source, canvas, options?)` | `Promise<void>` |
| `asciifyVideo` | `(source, canvas, options?)` | `Promise<() => void>` |
| `asciifyGif` | `(source, canvas, options?)` | `Promise<() => void>` |
| `asciifyWebcam` | `(canvas, options?)` | `Promise<() => void>` |
| `asciiBackground` | `(selector, options)` | `() => void` |
| `imageToAsciiFrame` | `(source, options, w?, h?)` | `{ frame, cols, rows }` |
| `renderFrameToCanvas` | `(ctx, frame, options, w, h, time?, hoverPos?)` | `void` |
| `gifToAsciiFrames` | `(buffer, options, w, h, onProgress?)` | `Promise<{ frames, cols, rows, fps }>` |
| `videoToAsciiFrames` | `(video, options, w, h, fps?, maxSec?, onProgress?)` | `Promise<{ frames, cols, rows, fps }>` |
| `generateEmbedCode` | `(frame, options)` | `string` |
| `generateAnimatedEmbedCode` | `(frames, options, fps)` | `string` |

`asciifyVideo` options: `fitTo` (HTMLElement/selector — fits canvas to container + ResizeObserver), `preExtract` (pre-decode all frames, default false), `onReady(video)`, `onFrame()`

---

## License

MIT © [asciify.org](https://asciify.org)

> ☕ [Buy me a coffee](https://www.buymeacoffee.com/asciify) — if this saved you time, I'd appreciate it!
