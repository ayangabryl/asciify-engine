# asciify-engine

<p align="left">
  <a href="https://www.npmjs.com/package/asciify-engine"><img src="https://img.shields.io/npm/v/asciify-engine?color=d4ff00&labelColor=0a0a0a&style=flat-square" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/asciify-engine"><img src="https://img.shields.io/npm/dm/asciify-engine?color=d4ff00&labelColor=0a0a0a&style=flat-square" alt="downloads" /></a>
  <a href="https://github.com/ayangabryl/asciify-engine/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-d4ff00?labelColor=0a0a0a&style=flat-square" alt="MIT license" /></a>
  <a href="https://www.buymeacoffee.com/asciify"><img src="https://img.shields.io/badge/buy_me_a_coffee-☕-d4ff00?labelColor=0a0a0a&style=flat-square" alt="Buy Me A Coffee" /></a>
</p>

Turn any image, video, or GIF into ASCII art on an HTML canvas — with live animated backgrounds, hover effects, and zero dependencies.

**[▶ Try the live playground](https://asciify.org) · [npm](https://www.npmjs.com/package/asciify-engine)**

---

## Install

```bash
npm install asciify-engine
```

---

## The 30-second version

```ts
import { imageToAsciiFrame, renderFrameToCanvas, DEFAULT_OPTIONS } from 'asciify-engine';

const img = new Image();
img.src = 'your-image.jpg';
img.onload = () => {
  const canvas = document.getElementById('ascii') as HTMLCanvasElement;
  const { frame } = imageToAsciiFrame(img, DEFAULT_OPTIONS, canvas.width, canvas.height);
  renderFrameToCanvas(canvas.getContext('2d')!, frame, DEFAULT_OPTIONS, canvas.width, canvas.height);
};
```

That's it — one function to convert, one to draw. Everything else is optional.

---

## Animated backgrounds

Add a living ASCII animation to any element with one line:

```ts
import { asciiBackground } from 'asciify-engine';

asciiBackground('#hero', { type: 'rain' });
```

Returns a cleanup function when you're done:

```ts
const stop = asciiBackground('#hero', { type: 'aurora', colorScheme: 'auto' });
// later…
stop();
```

**Available types:** `wave` · `rain` · `stars` · `pulse` · `noise` · `grid` · `aurora` · `silk` · `void` · `morph`

**Common options:**

```ts
asciiBackground('#el', {
  type: 'stars',
  colorScheme: 'auto',   // 'auto' | 'light' | 'dark' — 'auto' follows OS theme
  fontSize: 13,          // character size in px
  speed: 1.2,            // animation speed multiplier
  density: 0.6,          // how many cells are active (0–1)
  accentColor: '#d4ff00' // highlight colour
});
```

---

## More recipes

### React

```tsx
import { useEffect, useRef } from 'react';
import { imageToAsciiFrame, renderFrameToCanvas, DEFAULT_OPTIONS } from 'asciify-engine';

export function AsciiImage({ src }: { src: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = src;
    img.onload = () => {
      const canvas = ref.current!;
      const opts = { ...DEFAULT_OPTIONS, fontSize: 10, colorMode: 'fullcolor' as const };
      const { frame } = imageToAsciiFrame(img, opts, canvas.width, canvas.height);
      renderFrameToCanvas(canvas.getContext('2d')!, frame, opts, canvas.width, canvas.height);
    };
  }, [src]);

  return <canvas ref={ref} width={800} height={600} />;
}
```

### Animated GIF

```ts
import { gifToAsciiFrames, renderFrameToCanvas, DEFAULT_OPTIONS } from 'asciify-engine';

const buf = await fetch('animation.gif').then(r => r.arrayBuffer());
const canvas = document.getElementById('ascii') as HTMLCanvasElement;
const opts = { ...DEFAULT_OPTIONS, fontSize: 8 };

const { frames, fps } = await gifToAsciiFrames(buf, opts, canvas.width, canvas.height);

let i = 0;
setInterval(() => {
  renderFrameToCanvas(canvas.getContext('2d')!, frames[i], opts, canvas.width, canvas.height);
  i = (i + 1) % frames.length;
}, 1000 / fps);
```

### Video

```ts
import { videoToAsciiFrames, renderFrameToCanvas, DEFAULT_OPTIONS } from 'asciify-engine';

const video = document.createElement('video');
video.src = '/clip.mp4';
await new Promise(r => (video.onloadeddata = r));

const canvas = document.getElementById('ascii') as HTMLCanvasElement;
const opts = { ...DEFAULT_OPTIONS, fontSize: 8 };

const { frames, fps } = await videoToAsciiFrames(video, opts, canvas.width, canvas.height);

let i = 0;
setInterval(() => {
  renderFrameToCanvas(canvas.getContext('2d')!, frames[i], opts, canvas.width, canvas.height);
  i = (i + 1) % frames.length;
}, 1000 / fps);
```

---

## Tweaking the output

Pass options to any function to change the look:

```ts
const opts = {
  ...DEFAULT_OPTIONS,
  fontSize: 8,                // smaller = more detail
  colorMode: 'matrix',        // 'grayscale' | 'fullcolor' | 'matrix' | 'accent'
  charset: '@#S%?*+;:,. ',   // custom brightness ramp (dense → light)
  brightness: 0.1,            // -1 to 1
  contrast: 1.2,
  invert: false,
  hoverEffect: 'spotlight',   // interactive effect on cursor move
};
```

**Color modes at a glance:**

| Mode | What it does |
|---|---|
| `grayscale` | Classic monochrome ASCII |
| `fullcolor` | Preserves original pixel colours |
| `matrix` | Everything in green, like the film |
| `accent` | Single highlight colour |

**Hover effects:** `spotlight` · `flashlight` · `magnifier` · `force-field` · `neon` · `fire` · `ice` · `gravity` · `shatter` · `ghost`

---

## Embed generation

Export your ASCII art as a self-contained HTML file:

```ts
import { generateEmbedCode, generateAnimatedEmbedCode } from 'asciify-engine';

// Static image
const html = generateEmbedCode(frame, options);

// Animated
const html = generateAnimatedEmbedCode(frames, options, fps);
```

---

## API summary

| Function | Description |
|---|---|
| `imageToAsciiFrame(img, opts, w, h)` | Convert an image/video/canvas element to an ASCII frame |
| `renderFrameToCanvas(ctx, frame, opts, w, h, time?, pos?)` | Draw an ASCII frame onto a canvas 2D context |
| `gifToAsciiFrames(buffer, opts, w, h)` | Parse an animated GIF into ASCII frames |
| `videoToAsciiFrames(video, opts, w, h, fps?, maxSec?)` | Extract video frames and convert them to ASCII |
| `asciiBackground(selector, opts)` | Mount a live animated ASCII background |
| `generateEmbedCode(frame, opts)` | Self-contained static HTML snippet |
| `generateAnimatedEmbedCode(frames, opts, fps)` | Self-contained animated HTML snippet |

---

## License

MIT © [asciify.org](https://asciify.org)

> ☕ [Buy me a coffee](https://www.buymeacoffee.com/asciify) — if this saved you time, I'd appreciate it!
