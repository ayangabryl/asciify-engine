# Asciify kit

`asciify-engine/kit` turns the interface components into one call each. Every function mounts a GPU glyph field over or inside your element, follows its size and border radius, inks it from your theme, pauses off screen, honours reduced motion, and cleans up on `destroy()`. Without WebGL2 it returns an inert handle and leaves your HTML as it was.

```ts
import { beam, decode, odometer, buttonLoading, statusOrb, skeleton, pill, tabs, imageGenerate } from 'asciify-engine/kit';
```

Imports are tree-shaken: one component costs about 4–5.5 KB gzip on top of `asciify-engine/field`, which the kit shares rather than bundling again.

## Shared options and handle

Every function takes these options:

| Option | Default | Meaning |
| --- | --- | --- |
| `ink` | per component | A CSS colour, a custom property (`'--brand'`) or `'var(--brand, #888)'`. Re-read when the theme changes (media query, or `class`/`data-theme` on `<html>` or `<body>`). |
| `look` | none | Raw glyph-field settings layered over the component's look: `charset`, `cellSize`, `font` and so on. |
| `reducedMotion` | the visitor's setting | `true` or `false` to override `prefers-reduced-motion`. Reduced motion draws each state settled, in one frame. |

Every handle has `supported`, `field` (the underlying `GlyphField`, or `null`), `update(options)`, `play()`, `pause()` and `destroy()`. Components add their own methods, listed below.

In React, create the handle in an effect and return `destroy`:

```tsx
useEffect(() => { const b = beam(ref.current!); return () => b.destroy(); }, []);
```

## beam

A band of light turning round an element's border, as fine halftone dots or small characters. It follows the element's border radius.

```ts
const b = beam(card, { palette: 'colorful', mode: 'progress' });
b.progress(0.4);  // running; faster as it fills
b.success();      // one bright lap, then it settles
b.error();        // stutters, then crawls in red until reset() or progress()
```

Options: `palette` (`'colorful' | 'mono' | 'ocean' | 'sunset'` or your own hex stops, default `colorful`), `mode` (`'rotate' | 'pulse' | 'progress'`, default `rotate`), `grain` (`'dots' | 'glyphs'`), `speed` (lap multiplier, default 1), `hover` (faster on hover and focus, default true), `depth` (glow depth in px, default 18; it also stops 2px short of the padding), `outset` (bloom outside the border in px, default 7; set at mount). Methods: `progress(0..1)`, `success()`, `error()`, `reset()`.

## decode

A headline that condenses out of a drifting field, left to right. By default it draws the element's own text exactly where the browser laid it out, and keeps the real text in the DOM for selection and screen readers.

```ts
const d = decode(document.querySelector('h1')!, { duration: 900 });
d.replay();
```

Options: `text` (draw this instead, centred and as large as fits; `\n` breaks lines), `duration` (ms, default 900), `trigger` (`'visible' | 'manual'`), `replayOnHover` (default true), `settle` (`'glyphs'` keeps the headline in characters, `'text'` hands back to the crisp HTML). Ink defaults to the element's text colour. Method: `replay()`.

## odometer

A figure in the page's own font. Only changed digits roll through glyphs, leftmost first, then land back on the crisp digit. A visually hidden `aria-live` copy announces each value.

```ts
const o = odometer(figure, { value: 48290, format: n => `$${n.toLocaleString('en-US')}` });
o.set(49530);
```

Options: `value` (default: parsed from the element's text), `format` (default `toLocaleString()`), `duration` (ms the first column rolls, default 360), `stagger` (ms longer per column, default 60), `glyphs` (default `#%*+=-:`). Methods: `set(n)`; getter `value`.

## buttonLoading

The label cycles through characters while the request runs, then decodes into the result. The button never shrinks between states. Use a monospaced label font for the even letter grid.

```ts
const b = buttonLoading(button, { announce: statusLine });
b.start('Deploying');
await deploy().then(() => b.succeed('Deployed'), () => b.fail('Retry'));
```

Options: `text` (idle label, default the label's text), `label` (the element holding the text, when the button also has an icon), `check` (a check before the success label, default true), `shake` (on failure, default true), `announce` (a live region to write each state to). Methods: `start(label?)`, `succeed(label?)`, `fail(label?)`, `reset(label?)`; getter `state`. Sets `aria-busy` and `data-state` on the button. Without WebGL the methods still change the label text.

## statusOrb

An orb of characters that orbits while work runs, then closes into a ring around a check, `!` or X, tinted by the outcome.

```ts
const orb = statusOrb(span, { colourByState: true, ring: true });
orb.loading();
await save().then(r => (r.warnings ? orb.warning() : orb.success()), () => orb.error());
```

Options: `colourByState` (default true), `ring` (close into a ring, or leave the bare mark; default true), `colors` (`{ success, warning, error }`; defaults read `--ascii-success`, `--ascii-warning`, `--ascii-error`). Ink defaults to `--ascii-ink-strong`. Methods: `idle()`, `loading()`, `success()`, `warning()`, `error()`; getter `state`. Give the element a size, such as 104px square.

## skeleton

Placeholder blocks drawn in characters with a shimmer; on `resolve()` text wipes in left to right and images develop in characters, then fade to the photo.

```ts
const s = skeleton(card); // blocks: [data-block="text" | "photo" | "avatar"]; images default to photo
await fetchPost();
await s.resolve();
```

Options: `blocks` (selector, default `[data-block]`), `shimmer` (ms per sweep, default 1250), `resolve` (ms per block, default 240), `stagger` (ms between blocks unless `data-delay` is set, default 60), `develop` (ms an image develops, default 560). Methods: `resolve()` (a promise for the last block), `reset()`; getter `loading`. Sets `aria-busy` on the element while loading.

## pill

Pill and badge fills drawn in characters in their tone. Pass one pill to put the field under its text, or a list to share one field (one WebGL context) over their common container, with the labels kept clear.

```ts
const pills = pill(document.querySelectorAll('.status-pill')); // data-tone="green|amber|red|neutral|new", data-shimmer for live states
statusPill.dataset.tone = 'red';
pills.refresh(); // tone changes ease over 220ms
```

Options: `tone` (fallback when a pill has no `data-tone`, default `neutral`), `shimmer` (fallback for `data-shimmer`, default false), `sparkle` (flare on hover; default only for `new`), `tones` (`{ light, dark }` maps of `[r, g, b]`). Methods: `sparkle(pill?)`, `refresh()`.

## tabs

Segmented tabs whose indicator is a pill of characters that streams across and condenses under the new tab. The kit wires clicks, arrow keys, Home and End, `aria-selected`, roving `tabindex` and the panels named by `aria-controls`.

```ts
const t = tabs(tablist, { onChange: i => track('tab', i) });
t.select(2);
```

Options: `tabs` (selector, default `[role="tab"]`), `active` (default: the tab with `aria-selected="true"`), `duration` (ms, default 280), `panels` (`'hidden'` toggles the attribute, `'attribute'` toggles `data-active`, `'none'`), `manage` (default true; false leaves events and ARIA to you), `onChange(index, tab)`. Methods: `select(i, focus?)`; getter `active`. The tablist needs a transparent background where the indicator shows; the field sits above the tablist's own background and below the tab labels.

## imageGenerate

An image being generated: the field drifts with an elapsed clock, each streamed preview develops in a step sharper, then the final image, and the photo crossfades in. Wrap any provider (OpenAI partial images, Replicate or fal streams, a poll loop) as an async iterable of `{ preview?, final? }`, each a Blob or URL.

```ts
const gen = imageGenerate(frame, { elapsed: clock }); // frame holds the <img> that shows the result
const state = await gen.run(() => imageStream(prompt)); // 'done' or 'failed'
```

Options: `stream` (starts at once; a function is called again by each `run()`), `image` (default the first `<img>` inside), `elapsed` (an element for the clock), `onState(state, error?)`. Methods: `run(stream?)`, `reset()`; getter `state`. Sets `data-state` (`generating`, `done`, `failed`) and `aria-busy` on the element. Give the frame `overflow: hidden` and a background; the field sits above that background and below the photo.

## Your own components

`mountSurface` is the plumbing the kit is built on: give it an element, a look, an ink and a `paint(frame)` that draws white-on-black into `frame.pen` and returns true while it needs more frames.

```ts
import { mountSurface } from 'asciify-engine/kit';
const s = mountSurface({ host: el, look: () => ({ mark: 'glyph', cellSize: 6 }), ink: () => '--ascii-ink-strong', reducedMotion: () => undefined,
  paint: ({ pen, w, h, now, still }) => { pen.fillStyle = '#fff'; pen.fillRect(0, 0, (w * (now % 1000)) / 1000, h); return !still; } });
```
