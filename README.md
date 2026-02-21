# asciify-engine

<p align="left">
  <a href="https://www.npmjs.com/package/asciify-engine"><img src="https://img.shields.io/npm/v/asciify-engine?color=d4ff00&labelColor=0a0a0a&style=flat-square" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/asciify-engine"><img src="https://img.shields.io/npm/dm/asciify-engine?color=d4ff00&labelColor=0a0a0a&style=flat-square" alt="downloads" /></a>
  <a href="https://github.com/ayangabryl/asciify/blob/main/packages/asciify-engine/LICENSE"><img src="https://img.shields.io/badge/license-MIT-d4ff00?labelColor=0a0a0a&style=flat-square" alt="MIT license" /></a>
  <a href="https://www.buymeacoffee.com/asciify"><img src="https://img.shields.io/badge/buy_me_a_coffee-support-d4ff00?labelColor=0a0a0a&style=flat-square" alt="Buy Me A Coffee" /></a>
</p>

> Convert images, videos, and GIFs into ASCII art on HTML canvas. 13 art styles, 4 color modes, 10 animated backgrounds, interactive hover effects — zero dependencies.

**[▶ Live Playground](https://asciify.org) · [npm](https://www.npmjs.com/package/asciify-engine) · [Support the project ☕](https://www.buymeacoffee.com/asciify)**

## Features

- **Media → ASCII** — images, videos, and animated GIFs
- **13 art styles** — Standard, Blocks, Circles, Braille, Katakana, Dense, and more
- **4 color modes** — Grayscale, Full Color, Matrix, Accent
- **10 animated backgrounds** — Wave, Rain, Stars, Pulse, Noise, Grid, Aurora, Silk, Void, Morph
- **Interactive hover effects** — Spotlight, Flashlight, Magnifier, Force Field, Neon, Fire, Ice, Gravity, Shatter, Ghost
- **Light & dark mode** — via `colorScheme: 'auto'` or explicit `light` / `dark`
- **Embed generation** — self-contained HTML output (static or animated)
- **Zero dependencies** — works with React, Vue, Angular, Svelte, Next.js, or vanilla JS

## Install

```bash
npm install asciify-engine
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
const stop = asciiBackground('#hero', { type: 'stars' });
stop();
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
import {
  renderRainBackground,
  renderWaveBackground,
  renderStarsBackground,
  renderPulseBackground,
  renderNoiseBackground,
  renderGridBackground,
  renderAuroraBackground,
  renderSilkBackground,
  renderVoidBackground,
  renderMorphBackground,
} from 'asciify-engine';

// Example: drive the rain renderer yourself
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

## Quick Start

### Vanilla JS

```html
<canvas id="ascii" width="800" height="600"></canvas>
<script type="module">
  import {
    imageToAsciiFrame,
    renderFrameToCanvas,
    DEFAULT_OPTIONS,
  } from 'asciify-engine';

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = 'https://picsum.photos/600/400';
  img.onload = () => {
    const canvas = document.getElementById('ascii');
    const options = { ...DEFAULT_OPTIONS, fontSize: 10 };
    const { frame } = imageToAsciiFrame(img, options, canvas.width, canvas.height);
    renderFrameToCanvas(canvas.getContext('2d'), frame, options, canvas.width, canvas.height);
  };
</script>
```

### React

```tsx
import { useEffect, useRef } from 'react';
import {
  imageToAsciiFrame,
  renderFrameToCanvas,
  DEFAULT_OPTIONS,
} from 'asciify-engine';

export function AsciiImage({ src }: { src: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = src;
    img.onload = () => {
      const canvas = ref.current!;
      const opts = { ...DEFAULT_OPTIONS, fontSize: 10 };
      const { frame } = imageToAsciiFrame(img, opts, canvas.width, canvas.height);
      renderFrameToCanvas(canvas.getContext('2d')!, frame, opts, canvas.width, canvas.height);
    };
  }, [src]);

  return <canvas ref={ref} width={800} height={600} />;
}
```

### Angular

```typescript
import { Component, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import {
  imageToAsciiFrame,
  renderFrameToCanvas,
  DEFAULT_OPTIONS,
} from 'asciify-engine';

@Component({
  selector: 'app-ascii',
  template: `<canvas #canvas [width]="800" [height]="600"></canvas>`,
})
export class AsciiComponent implements AfterViewInit {
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  ngAfterViewInit() {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = 'https://picsum.photos/600/400';
    img.onload = () => {
      const canvas = this.canvasRef.nativeElement;
      const opts = { ...DEFAULT_OPTIONS, fontSize: 10 };
      const { frame } = imageToAsciiFrame(img, opts, canvas.width, canvas.height);
      renderFrameToCanvas(canvas.getContext('2d')!, frame, opts, canvas.width, canvas.height);
    };
  }
}
```

### GIF Animation

```ts
import { gifToAsciiFrames, renderFrameToCanvas, DEFAULT_OPTIONS } from 'asciify-engine';

const response = await fetch('https://media.giphy.com/media/ENagATV1Gr9eg/giphy.gif');
const buffer = await response.arrayBuffer();

const canvas = document.getElementById('ascii') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const options = { ...DEFAULT_OPTIONS, fontSize: 8 };

const { frames, fps } = await gifToAsciiFrames(buffer, options, canvas.width, canvas.height);

let i = 0;
setInterval(() => {
  renderFrameToCanvas(ctx, frames[i], options, canvas.width, canvas.height);
  i = (i + 1) % frames.length;
}, 1000 / fps);
```

### Video

```ts
import { videoToAsciiFrames, renderFrameToCanvas, DEFAULT_OPTIONS } from 'asciify-engine';

const video = document.createElement('video');
video.crossOrigin = 'anonymous';
video.src = '/my-video.mp4';
await new Promise((r) => (video.onloadeddata = r));

const canvas = document.getElementById('ascii') as HTMLCanvasElement;
const options = { ...DEFAULT_OPTIONS, fontSize: 8 };

const { frames, fps } = await videoToAsciiFrames(video, options, canvas.width, canvas.height, 12, 10);

let i = 0;
setInterval(() => {
  renderFrameToCanvas(canvas.getContext('2d')!, frames[i], options, canvas.width, canvas.height);
  i = (i + 1) % frames.length;
}, 1000 / fps);
```

## API Reference

### Core Functions

| Function | Returns | Description |
|---|---|---|
| `imageToAsciiFrame(source, options, w?, h?)` | `{ frame, cols, rows }` | Convert an image, video frame, or canvas to ASCII |
| `renderFrameToCanvas(ctx, frame, options, w, h, time?, hoverPos?)` | `void` | Render an ASCII frame to a 2D canvas context |
| `gifToAsciiFrames(buffer, options, w, h, onProgress?)` | `{ frames, cols, rows, fps }` | Parse an animated GIF `ArrayBuffer` into ASCII frames |
| `videoToAsciiFrames(video, options, w, h, fps?, maxDuration?, onProgress?)` | `{ frames, cols, rows, fps }` | Extract and convert video frames to ASCII |
| `asciiBackground(selector, options)` | `() => void` | Mount a live animated ASCII background; returns a cleanup function |
| `generateEmbedCode(frame, options)` | `string` | Self-contained static HTML embed |
| `generateAnimatedEmbedCode(frames, options, fps)` | `string` | Self-contained animated HTML embed |

### Key Options (`AsciiOptions`)

| Option | Type | Default | Description |
|---|---|---|---|
| `fontSize` | `number` | `10` | Character cell size in px |
| `colorMode` | `'grayscale' \| 'fullcolor' \| 'matrix' \| 'accent'` | `'grayscale'` | Color output mode |
| `renderMode` | `'ascii' \| 'dots'` | `'ascii'` | Render as characters or dot particles |
| `charset` | `string` | standard ramp | Custom character density ramp |
| `brightness` | `number` | `0` | Brightness adjustment (-1 → 1) |
| `contrast` | `number` | `1` | Contrast multiplier |
| `invert` | `boolean` | `false` | Invert luminance mapping |
| `hoverEffect` | `string` | `'none'` | Interactive effect name |
| `hoverStrength` | `number` | `0.8` | Effect intensity |
| `hoverRadius` | `number` | `0.3` | Effect radius (0–1 relative to canvas) |

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
