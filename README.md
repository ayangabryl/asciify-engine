# asciify-engine

<p align="left">
  <a href="https://www.npmjs.com/package/asciify-engine"><img src="https://img.shields.io/npm/v/asciify-engine?color=d4ff00&labelColor=0a0a0a&style=flat-square" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/asciify-engine"><img src="https://img.shields.io/npm/dm/asciify-engine?color=d4ff00&labelColor=0a0a0a&style=flat-square" alt="downloads" /></a>
  <a href="https://github.com/ayangabryl/asciify-engine/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-d4ff00?labelColor=0a0a0a&style=flat-square" alt="MIT license" /></a>
  <a href="https://www.buymeacoffee.com/asciify"><img src="https://img.shields.io/badge/buy_me_a_coffee-support-d4ff00?labelColor=0a0a0a&style=flat-square" alt="Buy Me A Coffee" /></a>
</p>

> Convert images, videos, and GIFs into ASCII art on HTML canvas. 13 art styles, 4 color modes, 10 animated backgrounds, interactive hover effects — zero dependencies.

**[▶ Live Playground](https://asciify.org) · [npm](https://www.npmjs.com/package/asciify-engine) · [Support the project ☕](https://www.buymeacoffee.com/asciify)**

## Features

- **Media → ASCII** — images, videos, and animated GIFs
- **13 art styles** — Standard, Blocks, Circles, Braille, Katakana, Dense, and more
- **4 color modes** — Grayscale, Full Color, Matrix, Accent
- **14 animated backgrounds** — Wave, Rain, Stars, Pulse, Noise, Grid, Aurora, Silk, Void, Morph, Fire, DNA, Terrain, Circuit
- **Interactive hover effects** — Spotlight, Flashlight, Magnifier, Force Field, Neon, Fire, Ice, Gravity, Shatter, Ghost
- **Light & dark mode** — via `colorScheme: 'auto'` or explicit `light` / `dark`
- **Embed generation** — self-contained HTML output (static or animated)
- **Zero dependencies** — works with React, Vue, Angular, Svelte, Next.js, or vanilla JS

## Install

```bash
npm install asciify-engine
```

## Quick Start

### Image → ASCII

```ts
import { asciify } from 'asciify-engine';

const canvas = document.querySelector('canvas')!;

// Minimal — just a URL and a canvas, no img.onload boilerplate needed
await asciify('https://example.com/photo.jpg', canvas);

// With an art style preset
await asciify('photo.jpg', canvas, { artStyle: 'letters' });

// Full control
await asciify('photo.jpg', canvas, {
  fontSize: 8,
  artStyle: 'art',
  options: {
    colorMode: 'fullcolor',
    invert: true,
    hoverEffect: 'spotlight',
    hoverStrength: 0.5,
  },
});
```

> **Canvas sizing:** Set `width` and `height` as HTML attributes on the `<canvas>` element — these control the pixel grid. CSS sizing alone (`style="width:100%"`) won't work (the canvas will be 0×0). Use `canvas.width = el.clientWidth` to fill a container.

### Webcam → ASCII

```ts
import { asciifyWebcam } from 'asciify-engine';

const canvas = document.querySelector('canvas')!;

// Requests camera access, starts a live rAF loop, returns stop()
const stop = await asciifyWebcam(canvas, {
  artStyle: 'terminal',
  mirror: true,           // horizontal flip (selfie mode)
});

// Release camera + cancel loop
stop();
```

### GIF Animation

```ts
import { asciifyGif } from 'asciify-engine';

// Fetches, converts, and starts the animation loop — returns a stop() function
const stop = await asciifyGif('animation.gif', canvas);

// Clean up the animation loop when done
stop();
```

### Video

```ts
import { asciifyVideo } from 'asciify-engine';

// Accepts a URL string or an existing HTMLVideoElement
const stop = await asciifyVideo('/my-video.mp4', canvas, { artStyle: 'terminal' });

// Cancel when unmounting / navigating away
stop();
```

### React

```tsx
import { useEffect, useRef } from 'react';
import { asciify } from 'asciify-engine';

export function AsciiImage({ src }: { src: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (ref.current) asciify(src, ref.current, { artStyle: 'art' });
  }, [src]);

  return <canvas ref={ref} width={800} height={600} />;
}
```

### Animated GIF or video in React

```tsx
import { useEffect, useRef } from 'react';
import { asciifyGif } from 'asciify-engine';

export function AsciiGif({ src }: { src: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let stop: (() => void) | undefined;
    asciifyGif(src, ref.current!).then(fn => { stop = fn; });
    return () => stop?.();  // cancels the rAF loop on unmount
  }, [src]);

  return <canvas ref={ref} width={800} height={600} />;
}
```

### Vue

```vue
<template>
  <canvas ref="canvasRef" width="800" height="600" />
</template>

<script setup lang="ts">
import { useTemplateRef, onMounted } from 'vue';
import { asciify } from 'asciify-engine';

const props = defineProps<{ src: string; artStyle?: string }>();
const canvasRef = useTemplateRef<HTMLCanvasElement>('canvasRef');

onMounted(() => asciify(props.src, canvasRef.value!, { artStyle: props.artStyle as any }));
</script>
```

### Angular

```typescript
import { Component, ElementRef, ViewChild, AfterViewInit, Input } from '@angular/core';
import { asciify } from 'asciify-engine';

@Component({
  selector: 'app-ascii',
  template: `<canvas #canvas width="800" height="600"></canvas>`,
})
export class AsciiComponent implements AfterViewInit {
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;
  @Input() src = '';
  @Input() artStyle = 'classic';

  ngAfterViewInit() {
    asciify(this.src, this.canvasRef.nativeElement, { artStyle: this.artStyle as any });
  }
}
```

## Animated Backgrounds

Drop a live ASCII animation into any element with one call.

```ts
import { asciiBackground } from 'asciify-engine';

// Attach to any selector — animates the element's background
asciiBackground('#hero', { type: 'rain' });

// Follows OS dark/light mode automatically
asciiBackground('#hero', { type: 'aurora', colorScheme: 'auto' });

// Force light mode (dark characters on light background)
asciiBackground('#hero', { type: 'wave', colorScheme: 'light' });

// Stop / clean up
const { destroy } = asciiBackground('#hero', { type: 'stars' });
destroy();
```

### Background Types

| Type | Description |
|---|---|
| `wave` | Flowing sine-wave field with noise turbulence |
| `rain` | Matrix-style vertical column rain with glowing head and fading tail |
| `stars` | Parallax star field that reacts to cursor position |
| `pulse` | Concentric ripple bursts that emanate from the cursor |
| `noise` | Smooth value-noise field with organic flow |
| `grid` | Geometric grid that warps and glows at cursor proximity |
| `aurora` | Sweeping borealis-style colour bands |
| `silk` | Silky fluid swirls following the cursor |
| `void` | Gravitational singularity — characters spiral inward toward cursor |
| `morph` | Characters morph between shapes driven by noise |
| `fire` | Upward-drifting flame columns with heat-gradient character mapping |
| `dna` | Rotating double-helix strands with base-pair characters |
| `terrain` | Procedural heightmap landscape with parallax depth layers |
| `circuit` | PCB trace network that pulses with traveling electric signals |

### `asciiBackground` Options

| Option | Type | Default | Description |
|---|---|---|---|
| `type` | `string` | `'wave'` | Which background renderer to use |
| `colorScheme` | `'auto' \| 'light' \| 'dark'` | `'dark'` | `'auto'` follows OS theme live; `'light'` = dark chars on light bg |
| `fontSize` | `number` | `13` | Character size in px |
| `accentColor` | `string` | varies | Head/highlight colour (CSS colour string) |
| `color` | `string` | — | Override body character colour |
| `speed` | `number` | `1` | Global animation speed multiplier |
| `density` | `number` | `0.55` | Fraction of cells active (0–1) |
| `lightMode` | `boolean` | `false` | Dark characters on light background |

Each background type also accepts its own specific options — see the individual type exports (e.g. `RainBackgroundOptions`, `WaveBackgroundOptions`, etc.) for the full list.

### Low-level background renderers

All renderers are also exported individually for direct canvas use:

```ts
import { renderRainBackground } from 'asciify-engine';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
let t = 0;

function tick() {
  renderRainBackground(ctx, canvas.width, canvas.height, t, {
    speed: 1.2,
    density: 0.6,
    accentColor: '#00ffcc',
    lightMode: false,
  });
  t += 0.016;
  requestAnimationFrame(tick);
}
tick();
```

## Low-level API

For cases where the one-call API is too limiting — direct frame manipulation, custom render loops, progress callbacks, etc.

### GIF (low-level)

```ts
import { gifToAsciiFrames, renderFrameToCanvas, DEFAULT_OPTIONS } from 'asciify-engine';

const buffer = await fetch('animation.gif').then(r => r.arrayBuffer());
const options = { ...DEFAULT_OPTIONS, fontSize: 8 };
const { frames, fps } = await gifToAsciiFrames(buffer, options, canvas.width, canvas.height);

const ctx = canvas.getContext('2d')!;
let i = 0;
let last = performance.now();
const interval = 1000 / fps;

let animId: number;
const tick = (now: number) => {
  if (now - last >= interval) {
    renderFrameToCanvas(ctx, frames[i], options, canvas.width, canvas.height);
    i = (i + 1) % frames.length;
    last = now;
  }
  animId = requestAnimationFrame(tick);
};
animId = requestAnimationFrame(tick);

// Clean up → cancelAnimationFrame(animId);
```

### Video (low-level)

```ts
import { videoToAsciiFrames, renderFrameToCanvas, DEFAULT_OPTIONS } from 'asciify-engine';

const video = document.createElement('video');
video.crossOrigin = 'anonymous';
video.src = '/my-video.mp4';
// Guard against cached video where onloadeddata already fired
if (video.readyState < 2) {
  await new Promise<void>(r => { video.onloadeddata = () => r(); });
}

const options = { ...DEFAULT_OPTIONS, fontSize: 8 };
const { frames, fps } = await videoToAsciiFrames(video, options, canvas.width, canvas.height, 12, 10);

const ctx = canvas.getContext('2d')!;
let i = 0;
let last = performance.now();
const interval = 1000 / fps;

let animId: number;
const tick = (now: number) => {
  if (now - last >= interval) {
    renderFrameToCanvas(ctx, frames[i], options, canvas.width, canvas.height);
    i = (i + 1) % frames.length;
    last = now;
  }
  animId = requestAnimationFrame(tick);
};
animId = requestAnimationFrame(tick);

// Clean up → cancelAnimationFrame(animId);
```

### Vanilla JS (low-level image)

```html
<canvas id="ascii" width="800" height="600"></canvas>
<script type="module">
  import { imageToAsciiFrame, renderFrameToCanvas, DEFAULT_OPTIONS } from 'asciify-engine';

  const canvas = document.getElementById('ascii');
  const ctx = canvas.getContext('2d');
  const options = { ...DEFAULT_OPTIONS, fontSize: 10 };

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = 'https://picsum.photos/600/400';
  img.onload = () => {
    const { frame } = imageToAsciiFrame(img, options, canvas.width, canvas.height);
    renderFrameToCanvas(ctx, frame, options, canvas.width, canvas.height);
  };
</script>
```

## API Reference

### Core Functions

| Function | Returns | Description |
|---|---|---|
| `asciify(source, canvas, opts?)` | `Promise<void>` | Render a **single** ASCII frame from an image (or URL). For animated loops use `asciifyGif` / `asciifyVideo` |
| `asciifyGif(source, canvas, opts?)` | `Promise<() => void>` | Fetch a GIF, convert, and start an animation loop — returns `stop()` |
| `asciifyVideo(source, canvas, opts?)` | `Promise<() => void>` | Convert a video and start an animation loop — returns `stop()` |
| `imageToAsciiFrame(source, options, w?, h?)` | `{ frame, cols, rows }` | Convert an image, video frame, or canvas to a raw ASCII frame |
| `renderFrameToCanvas(ctx, frame, options, w, h, time?, hoverPos?)` | `void` | Render a raw ASCII frame to a 2D canvas context |
| `gifToAsciiFrames(buffer, options, w, h, onProgress?)` | `{ frames, cols, rows, fps }` | Parse an animated GIF `ArrayBuffer` into ASCII frames |
| `videoToAsciiFrames(video, options, w, h, fps?, maxDuration?, onProgress?)` | `{ frames, cols, rows, fps }` | Extract and convert video frames to ASCII |
| `asciifyWebcam(canvas, opts?)` | `Promise<() => void>` | Start a live webcam → ASCII loop; returns `stop()` to cancel and release the camera |
| `asciiBackground(target, options)` | `{ destroy: () => void }` | Mount a live animated ASCII background; call `destroy()` to stop and remove |
| `generateEmbedCode(frame, options)` | `string` | Self-contained static HTML embed |
| `generateAnimatedEmbedCode(frames, options, fps)` | `string` | Self-contained animated HTML embed |

### Simple API Options (`AsciifySimpleOptions`)

Used by `asciify()`, `asciifyGif()`, and `asciifyVideo()`:

| Option | Type | Default | Description |
|---|---|---|---|
| `fontSize` | `number` | `10` | Character cell size in px |
| `artStyle` | `ArtStyle` | `'classic'` | Art style preset — sets charset, render mode, and color mode together |
| `options` | `Partial<AsciiOptions>` | `{}` | Fine-grained overrides applied on top of the preset |

### Key Options (`AsciiOptions`)

| Option | Type | Default | Description |
|---|---|---|---|
| `fontSize` | `number` | `10` | Character cell size in px |
| `colorMode` | `'grayscale' \| 'fullcolor' \| 'matrix' \| 'accent'` | `'grayscale'` | Color output mode |
| `renderMode` | `'ascii' \| 'dots'` | `'ascii'` | Render as characters or dot particles |
| `charset` | `string` | `' .:-=+*#%@'` | Custom character density ramp (light → dark) |
| `brightness` | `number` | `0` | Brightness adjustment (−1 → 0 → 1) |
| `contrast` | `number` | `0` | Contrast boost (0 = unchanged, positive = more contrast) |
| `invert` | `boolean` | `false` | Invert luminance mapping |
| `animationStyle` | `AnimationStyle` | `'none'` | Per-character animation driven over time |
| `hoverEffect` | `HoverEffect` | `'spotlight'` | Cursor interaction style |
| `hoverStrength` | `number` | `0` | Effect intensity (0 = disabled) |
| `hoverRadius` | `number` | `0.2` | Effect radius as a fraction of canvas size |
| `artStyle` | `ArtStyle` | `'classic'` | Art style preset (see `ART_STYLE_PRESETS`) |
| `ditherStrength` | `number` | `0` | Floyd-Steinberg dither intensity (0–1) |
| `dotSizeRatio` | `number` | `0.8` | Dot size when `renderMode === 'dots'` (fraction of cell) |
| `charAspect` | `number` | `0.55` | Width ÷ height of a single output character. Set to `0.5` for terminal emulators, `0.52` for browser `line-height: 1.15`, `0.55` for `line-height: 1.09`. Ensuring this matches your rendering environment keeps the output proportional to the source. |
| `normalize` | `boolean` | `false` | Auto-stretch the luminance range of the frame before charset mapping. Maximises detail and contrast for low-contrast or muted images. |

### Art Styles (`artStyle`)

| Value | Color mode | Description |
|---|---|---|
| `classic` | Grayscale | Standard density ramp — clean, universally readable |
| `art` | Full color | 70-char dense ramp for maximum tonal detail |
| `particles` | Full color | Dot circles (`renderMode: 'dots'`) — great for photos |
| `letters` | Full color | Alphabet characters with pixel-accurate color |
| `terminal` | Matrix | Classic charset with green phosphor / Matrix look |
| `claudeCode` | Accent | Box-drawing chars with accent color — technical/hacker aesthetic |
| `braille` | Full color | 256-char braille block — ultra-dense, printed feel |
| `katakana` | Matrix | Half-width katakana — anime / cyberpunk aesthetic |
| `box` | Grayscale | Filled block elements `▪◾◼■█` |
| `lines` | Grayscale | Dash/em-dash ramp — minimalist typographic look |
| `circles` | Accent | Concentric circle chars with accent highlight |
| `musical` | Accent | Music notation ♩♪♫♬♭♮♯ — playful, low density |
| `emoji` | Full color | Block emoji mosaic — best at larger `fontSize` |

### Background Options

| Option | Type | Default | Description |
|---|---|---|---|
| `type` | `string` | `'wave'` | Background renderer |
| `colorScheme` | `'auto' \| 'light' \| 'dark'` | `'dark'` | Theme; `'auto'` follows OS preference |
| `fontSize` | `number` | `13` | Character size |
| `speed` | `number` | `1` | Animation speed multiplier |
| `density` | `number` | `0.55` | Fraction of cells active (0–1) |
| `accentColor` | `string` | varies | Highlight / head colour |

## License

MIT © [asciify.org](https://asciify.org)

---

<p align="left">
  <a href="https://www.buymeacoffee.com/asciify">☕ Buy me a coffee — if this saved you time, I'd appreciate it!</a>
</p>
