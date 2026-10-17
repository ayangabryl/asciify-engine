# Asciify kit

`asciify-engine/kit` turns the interface components into one call each. Every function mounts a GPU glyph field over or inside your element, follows its size and border radius, inks it from your theme, pauses off screen, honours reduced motion, and cleans up on `destroy()`. Without WebGL2 it returns an inert handle and leaves your HTML as it was.

```ts
import { beam, decode, odometer, buttonLoading, statusOrb, skeleton, pill, tabs, imageGenerate } from 'asciify-engine/kit';
```

Imports are tree-shaken: one component costs about 6–8.5 KB gzip on top of `asciify-engine/field`, which the kit shares rather than bundling again.

## Shared options and handle

Every function takes these options:

| Option | Default | Meaning |
| --- | --- | --- |
| `ink` | per component | A CSS colour, a custom property (`'--brand'`) or `'var(--brand, #888)'`. Re-read when the theme changes (media query, or `class`/`data-theme` on `<html>` or `<body>`). Defaults pick light or dark ink from the element's own opaque background, else from its text colour. |
| `look` | none | Raw glyph-field settings layered over the component's look: `charset`, `cellSize`, `font` and so on. |
| `reducedMotion` | the visitor's setting | `true` or `false` to override `prefers-reduced-motion`. Reduced motion draws each state settled, in one frame. |
| `lazy` | `true` | Mount the field only near the viewport and release it far from it. `false` mounts at once, wherever the element is. See Performance and integration. |
| `poster` | none | A still image under the field: shown until the first GPU frame, while the field is released, and in its place without WebGL. |
| `globalLook` | `true` | `false` keeps this field's own characters and mark when `setGlobalLook` re-skins the page. |

Every handle has `supported`, `field` (the underlying `GlyphField`, or `null` without WebGL), `update(options)`, `play()`, `pause()` and `destroy()`. `update` merges, and `look` merges key by key, so `update({ look: { cellSize: 6 } })` keeps an earlier `charset`; a look key set to `undefined` is removed, so the component's own value comes back. `update({ poster })` points the poster at a new still, such as the other theme's, without remounting. Components add their own methods, listed below.

In React, create the handle in an effect and return `destroy`:

```tsx
useEffect(() => { const b = beam(ref.current!); return () => b.destroy(); }, []);
```

## beam

A band of light round an element's border, as fine halftone dots or small characters inside the edge. The field covers the element exactly and is clipped to its computed corner radii (each corner its own), and dots where a corner curves through a cell are held small enough to sit inside the curve, so nothing lands past the corners.

```ts
const b = beam(card, { palette: 'colorful', mode: 'progress' });
b.progress(0.4);  // progress mode: a ring grows clockwise from the top to 40%
b.success();      // the ring closes, a flash sweeps round, a green fade settles, then back to rest
b.error();        // stops dead, flickers red twice, cracks into dim red fragments until reset() or progress()
```

Options: `palette` (`'colorful' | 'mono' | 'ocean' | 'sunset'` or your own hex stops, default `colorful`), `mode` (`'rotate'` two turning arcs, `'pulse'` a breathing border, `'progress'` all but dark at rest and a progress ring while running; default `rotate`; modes crossfade when changed), `grain` (`'dots' | 'glyphs'`), `speed` (lap multiplier, default 1), `hover` (faster and brighter on hover and visible focus, default true; pointer moves count too, so a pointer already over the element or a scripted one heats it), `depth` (glow depth in px, default 18; it also stops 2px short of the padding). Methods: `progress(0..1)` (in `rotate` and `pulse` the beam speeds up as it fills), `success()`, `error()`, `reset()`. Reduced motion draws one settled frame per state. There is no bloom outside the border.

## decode

A headline that condenses out of a drifting field, left to right. By default it draws the element's own text exactly where the browser laid it out, and keeps the real text in the DOM for selection and screen readers.

```ts
const d = decode(document.querySelector('h1')!, { duration: 800 });
d.replay();
```

Options: `text` (draw this instead, centred and as large as fits, in the element's own font weight, family and letter spacing; `\n` breaks lines), `duration` (ms, default 900), `trigger` (`'visible' | 'manual'`), `replayOnHover` (default true; entry is read from pointer moves too, so a scripted cursor replays it), `settle` (`'glyphs'` keeps the headline in characters, `'text'` hands back to the crisp HTML). Ink defaults to the element's text colour. Method: `replay()`.

## odometer

A figure in the page's own font. Only changed digits roll through glyphs, leftmost first, then land back on the crisp digit. A visually hidden `aria-live` copy announces each value.

```ts
const o = odometer(figure, { value: 48290, format: n => `$${n.toLocaleString('en-US')}` });
o.set(49530);
```

Options: `value` (default: parsed from the element's text), `format` (default `toLocaleString()`), `duration` (ms the first column rolls, default 360), `stagger` (ms longer per column, default 60), `glyphs` (default `#%*+=-:`), `face` (`'text'`: crisp text at rest, characters only while a column rolls; `'glyph'`: the whole figure drawn in characters, at rest too; default `text`, and `update({ face })` switches it live). Methods: `set(n)`; getter `value`.

## buttonLoading

The label cycles through characters while the request runs, then decodes into the result. The button never shrinks between states. Use a monospaced label font for the even letter grid.

```ts
const b = buttonLoading(button, { announce: statusLine });
b.start('Deploying');
await deploy().then(() => b.succeed('Deployed'), () => b.fail('Retry'));
```

Options: `text` (idle label, default the label's text), `label` (the element holding the text, when the button also has an icon), `check` (a crisp SVG check before the success label, default true), `icon` (an icon-only button's icon, default its first `svg` when it has no text: one cell breathes through the glyphs over it while loading, and a check takes its place on success; the button's `aria-label` follows each state), `shake` (on failure, default true), `announce` (a live region to write each state to). Methods: `start(label?)`, `succeed(label?)`, `fail(label?)`, `reset(label?)`; getter `state`. Sets `aria-busy` and `data-state` on the button. Without WebGL the methods still change the label text.

## statusOrb

An orb of characters that orbits while work runs, then closes into a ring around a check, `!` or X, tinted by the outcome.

```ts
const orb = statusOrb(span, { colourByState: true, ring: true });
orb.loading();
await save().then(r => (r.warnings ? orb.warning() : orb.success()), () => orb.error());
```

Options: `colourByState` (default true), `ring` (close into a ring, or leave the bare mark; default true), `colors` (`{ success, warning, error }`; defaults read `--ascii-success`, `--ascii-warning`, `--ascii-error`). Ink defaults to `--ascii-ink-strong`. Methods: `idle()`, `loading()`, `success()`, `warning()`, `error()`; getter `state`. Give the element a size, such as 104px square.

## skeleton

Placeholder blocks drawn in characters with a shimmer; on `resolve()` text comes in behind a feathered edge and images develop in characters, then fade to the photo.

```ts
const s = skeleton(card); // blocks: [data-block="text" | "photo" | "avatar"]; images default to photo
await fetchPost();
await s.resolve();
```

Options: `blocks` (selector, default `[data-block]`; `reset()` fades loaded content out under the returning skeleton), `shimmer` (ms per pass of a wave that loops without pausing until `resolve()`, default 1400), `resolve` (ms per block, default 420), `stagger` (ms between blocks unless `data-delay` is set, default 60), `develop` (ms an image develops, default 640). Block shapes come from the blocks' own CSS: an image's `border-radius`, and one bar per rendered line of text, as wide as the words and as tall as the font's x-height, so the skeleton follows the design's tokens without settings. Methods: `resolve()` (a promise for the last block), `reset()`; getter `loading`. Sets `aria-busy` on the element while loading.

## pill

Pills and badges whose characters stay inside them. The pill's own CSS draws its fill and label; the field draws one glyph before the label and is clipped to a stadium one cell row tall inside each pill, so nothing reaches an edge or crosses the text. Status pills get a dot in their tone: it breathes while live, turns as a half-filled spinner (`◐◓◑◒`) while an amber pill is live (syncing), blinks open twice when a pill turns red, and is an open ring for `neutral`. A `new` pill gets a sparkle (`✦`) that twinkles when the pointer arrives. Count pills roll their changed digits through the dot glyphs. Pass one pill to put the field under its text, or a list to share one field (one WebGL context) over their common container; then each pill's labels are lifted above the field (`position: relative; z-index: 2`, bare text wrapped in a span).

```html
<span class="pill" data-tone="green" data-live><span data-dot></span><span>Live</span></span>
<span class="pill" data-tone="new"><span data-dot></span><span>New</span></span>
<span class="pill" data-count>12</span>
```

```ts
const pills = pill(document.querySelectorAll('.pill'));
statusPill.dataset.tone = 'red'; delete statusPill.dataset.live;
pills.refresh();  // tone changes ease over 240ms; red blinks the dot
pills.count(14);  // only the changed digits roll
```

Kinds: `data-count` makes a count pill, `data-tone="new"` a sparkle pill, anything else a status pill. Options: `tone` (fallback for `data-tone`: `green | amber | red | neutral | new`, default `neutral`), `live` (fallback for `data-live`; default false), `indicator` (draw the glyph over the pill's `[data-dot]`, adding a 12px one when missing; default true), `sheen` (twinkle a `new` pill's sparkle when the pointer moves onto it, default true), `tones` (`{ light, dark }` maps of `[r, g, b]` glyph hues; the defaults are `PILL_TONES`, which also suit the pills' CSS text and fill). Methods: `sheen(pill?)` (twinkle), `count(value, pill?)`, `refresh()`. Count pills keep a visually hidden copy of the number for screen readers.

The field uses square 12px cells sampled exactly, so a glyph never leaves a ghost in its neighbours. It moves its grid under the first status dot and nudges any other pill by under half a cell (inline `translate`), so every glyph sits centred; lay pills out in a column (same width, same edge) and rows on multiples of 12px and nothing moves at all. Keep pills at least one cell from the shared container's right and bottom edge. The charset is the kit's own glyph table, so `globalLook` does not apply and `look.charset` should be left alone.

## tabs

Segmented tabs with a gliding indicator. The pill is yours, so its outline stays crisp: style any element from `--tabs-x`, `--tabs-y`, `--tabs-w` and `--tabs-h`, which the kit sets on the tablist every frame (and once at rest without WebGL). The leading end goes first and the trailing end catches up, so it stretches and settles; a new choice mid-glide leaves from where it is. The field draws a row of characters along the pill's foot that glides with it (the grid moves with the indicator, so characters never step from cell to cell), runs dense toward the leading end in flight and settles into an even, tapered line. The kit wires clicks, arrow keys, Home and End, `aria-selected`, roving `tabindex` and the panels named by `aria-controls`.

```html
<div role="tablist" class="tabs">
  <span class="thumb"></span>
  <button role="tab" aria-controls="p1">Overview</button> …
</div>
<style>
  .tabs { position: relative; }
  .thumb { position: absolute; z-index: -2; left: var(--tabs-x); top: var(--tabs-y); width: var(--tabs-w); height: var(--tabs-h); border-radius: 999px; background: var(--surface-2); }
  [role="tab"] { position: relative; z-index: 2; padding-bottom: 6px; } /* room for the row */
</style>
```

```ts
const t = tabs(tablist, { onChange: i => track('tab', i) });
t.select(2);
```

Options: `tabs` (selector, default `[role="tab"]`), `active` (default: the tab with `aria-selected="true"`), `duration` (ms, default 440), `panels` (`'hidden'` toggles the attribute, `'attribute'` toggles `data-active`, `'none'`), `manage` (default true; false leaves events and ARIA to you), `onChange(index, tab)`. Methods: `select(i, focus?)`; getter `active`. The field sits above the tablist's own background (`z-index: -1` in its stacking context) and below the tab labels, so put the pill element at `z-index: -2`. Ink defaults to `--ascii-ink`. Under reduced motion the indicator moves at once. For a figure in the panel that rolls on change, pair it with `odometer` and `update({ value, format })`.

## imageGenerate

An image being generated: the field drifts with an elapsed clock, each streamed preview develops in a step sharper, then the final image, and the photo crossfades in. Every change (a preview, the final, a reset) develops over the same 680ms sine curve whenever it arrives, an incoming picture lays over the outgoing one so the total never jumps, a preview keeps sharpening and the ground keeps drifting faintly over it until the next update, and the photo starts in (560ms) while the characters settle on the final. A new `run()` fades the photo back out over its characters. Wrap any provider (OpenAI partial images, Replicate or fal streams, a poll loop) as an async iterable of `{ preview?, final? }`, each a Blob or URL.

```ts
const gen = imageGenerate(frame, { elapsed: clock }); // frame holds the <img> that shows the result
const state = await gen.run(() => imageStream(prompt)); // 'done' or 'failed'
```

Options: `stream` (starts at once; a function is called again by each `run()`), `image` (default the first `<img>` inside), `elapsed` (an element for the clock), `onState(state, error?)`. Methods: `run(stream?)`, `reset()`; getter `state`. Sets `data-state` (`generating`, `done`, `failed`) and `aria-busy` on the element. Give the frame `overflow: hidden` and a background; the field sits above that background and below the photo. Without WebGL2 each preview goes straight into the `<img>`, which stays hidden until it has a source.

## Your own components

`mountSurface` is the plumbing the kit is built on: give it an element, a look, an ink and a `paint(frame)` that draws white-on-black into `frame.pen` and returns true while it needs more frames.

```ts
import { mountSurface } from 'asciify-engine/kit';
const s = mountSurface({ host: el, look: () => ({ mark: 'glyph', cellSize: 6 }), ink: () => '--ascii-ink-strong', reducedMotion: () => undefined,
  paint: ({ pen, w, h, now, still }) => { pen.fillStyle = '#fff'; pen.fillRect(0, 0, (w * (now % 1000)) / 1000, h); return !still; } });
```

## Performance and integration

A page can hold every kit component at once. The shared core keeps the GPU cost to what is on screen:

- **Lazy mounting.** A field mounts when its element comes within half a viewport of the screen and is released, freeing its WebGL context, beyond one viewport. Mounts that cost more than about 4 ms in a frame wait for the next one, nearest the screen first. The handle survives release and remount: its methods keep working, `update()` calls made while released apply on the next mount, `pause()` holds, and the component paints its current state when it mounts again. `handle.field` stays the same object throughout. A remount swaps a copy of the canvas, with its attributes and inline styles, into the same place. `lazy: false` mounts at once, anywhere on the page, and is never released by distance.
- **Context budget.** At most 12 kit fields hold a WebGL context at once, across all components and page helpers (browsers drop the oldest past about 16). Past the budget the live field farthest off screen is released first, and a waiting field mounts as soon as it is nearer than the farthest live one. Change it with `setFieldBudget(n)`; `getFieldBudget()` reads it.
- **Posters.** `poster: '/stills/hero.webp'` puts an `<img>` under the canvas (`update({ poster })` points it at another still, such as the other theme's), placed exactly where the field draws. It fades out (280 ms, none under reduced motion) when the first GPU frame lands, shows again while the field is released, and stays as the fallback without WebGL or after the field fails, until `destroy()`. `update({ poster })` swaps the still in place, for a theme change, on every component including the page helpers and `asciiVideo`. `asciiVideo` keeps its own poster.
- **Pausing.** As before, a field draws nothing while the page is hidden or its element is off screen.

```ts
import { beam, statusOrb, setFieldBudget, setGlobalLook, subscribeGlobalLook } from 'asciify-engine/kit';

setFieldBudget(10);
const orb = statusOrb(el, { poster: '/stills/orb-dark.webp' });

// A header "Characters" menu: re-skins every glyph field at once.
setGlobalLook({ charset: ' .:-=+YCIFSA#@' });
setGlobalLook({ style: 'lego' });          // any of the Studio's 24 styles, KIT_STYLES
setGlobalLook(null); // each field gets its own characters back
const off = subscribeGlobalLook(look => menu.value = look?.charset ?? '');

// Per-instance tuning from a customise panel.
orb.update({ ink: '--brand', look: { cellSize: 6 } });
```

`setGlobalLook({ style })` takes one of the Studio's 24 render styles (`KIT_STYLES`, typed `KitStyle`, in `STUDIO_STYLES` order). Glyph-like styles (`ascii`, `blocks`, `braille`, `lines`, `cross`, `diagonal`, `diamond`, `mixed`) bring their ramp, which a `charset` beside them overrides; `dots` is the halftone mark; the rest (`pixel`, `mosaic`, `lego`, `voxel`, `disco`, `dither`, `hex`, `led`, `cmyk`, `stipple`, `engraving`, `crosshatch`, `woodblock`, `risograph`, `pointillism`) switch the field's `mark` and keep each field's own charset, which decides the cells left blank. Unknown styles and empty charsets are dropped. `setGlobalLook(null)` gives each field its own mark and characters back.

`setGlobalLook({ charset })` balances the set's weight against classic ASCII: block and solid sets draw smaller glyphs so they keep detail, sets without light glyphs (binary) ease off, and faint sets (minimal, braille, code) draw larger, bolder glyphs; tones are untouched. A look applies to every glyph field, live or released, except dot marks, fields whose own `charset` holds letters (a word or a brand, such as `wordmark`), and fields created with `globalLook: false` (use it for a locked region). An empty `charset` keeps each field's own. `getGlobalLook()` reads the current look, so `subscribeGlobalLook` pairs with React's `useSyncExternalStore`.

Each change sweeps: a field that has drawn its first frame holds that frame over itself and wipes it away left to right in 200ms (after a 40ms beat, `cubic-bezier(.23,1,.32,1)`), led by a 2px scan line, as the new characters land under it. The line is `--ascii-sweep` (default amber `#f3ba32`, at 35% with a soft glow); the held frame and the line are an `aria-hidden` canvas and span marked `data-ascii-sweep`, placed exactly over the field (style them alongside the field, for example with the same mask) and removed when the sweep ends. Under reduced motion (the visitor's, or `reducedMotion: true`), and for a field still on its poster, the characters change at once.

For your own `mountSurface` or `mountPageField` component, pass the options box as `kit` (`kit: state`) and the same box to `handle()`, so `lazy`, `poster` and `globalLook` apply and the poster is removed on `destroy()`.

## Phase 2c: page and field helpers

Whole-element fields that draw their own scene or source: page backgrounds, a wordmark, a video, the sign-in art panel and the pricing card's glow. Each lays one canvas over or under the element (inset 0, following its border radius), inks it from the theme, honours reduced motion and restores the element on `destroy()`. Without WebGL2 they return inert handles and leave the HTML alone.

```ts
import { fieldBackground, wordmark, asciiVideo, artPanel, pricingGlow } from 'asciify-engine/kit';
```

### fieldBackground

The hero's drifting ground of characters under the content, with a soft elliptical clear zone round the headline so a frosted veil over it reads clean; the same ground in the brand colour; or a 404 set large in characters that scatters and re-forms.

```ts
const bg = fieldBackground(hero, { preset: 'hero', clear: headline });
subscribe.onclick = () => bg.pulse(subscribe);   // a ring from the button; cursor ripples hold off for a beat

const lost = fieldBackground(art, { preset: 'notFound' });
home.onclick = async () => { await lost.scatter(home); location.href = '/'; };
```

Options: `preset` (`'hero' | 'brand' | 'notFound'`, default `hero`), `clear` (the element to keep clear; `hero` and `brand`), `palette` (one ink or `{ light, dark }`, winning over `ink`; `brand` defaults to `var(--brand)`), `text` (`notFound`, default `404`), `ripple` (the pointer drops a soft ring every 520ms or so, default true), `label` (`notFound` defaults to its text; the grounds are hidden as decoration). Methods: `pulse(from?, strength?)` (an element, a viewport point or the centre; default 1.4), `scatter(from?)` (a promise for the re-formed numerals; other presets just pulse). The field sits under the content (`isolation: isolate`, `z-index: -1`), so give the hero its own background. Without WebGL2 its poster lies in the same place and the kit isolates the element for it too, so the page's backgrounds never cover it.

### wordmark

A name or a word set in characters with a trail under the pointer. By default it draws the element's own text, which stays in the DOM, transparent, for selection and screen readers; pass `text` to label the canvas instead.

```ts
const mark = wordmark(box, { text: 'asciify' });
input.oninput = () => mark.setText(input.value);
```

Options: `text`, `font` (default `Georgia, "Times New Roman", serif`), `fontWeight` (default 600), `artHeight` (height of the 1800 px wide canvas the word is set on, default 520; a shorter one sets the word larger in a wide element), `label` (the canvas's accessible name when the word is not the element's own text; default the word). Methods: `setText(text)`; getter `text`.

The landing's closing name is `wordmark(box, { text: 'asciify', artHeight: 480, label: 'asciify, drawn in characters', look: { charset: ' .:-=+*#%@', font: '"Geist Mono", ui-monospace, monospace', fontWeight: 400, cellSize: 9, cellAspect: 0.62, glyphScale: 0.92, contrast: 1, shade: 0.5, trail: { strength: 0.9, radius: 0.3 } } })`, and its hero is `fieldBackground(section, { preset: 'hero', ripple: false, palette: { light: '#7d7b75', dark: '#77756f' }, look: { scale: 1.25, cellSize: 12, brightness: 0.24, contrast: 1, charset: ' .:+*#', cellAspect: 0.62, glyphScale: 0.86, clear: { element: copy, padding: -24, feather: 0.6, shape: 'ellipse' } } })` (`scale` 1.6 under 760px).

### asciiVideo

A video drawn in characters, muted and looping. `play()` and `pause()` stop the video and the field together.

```ts
const v = asciiVideo(player, { src: '/magnolia.mp4', poster: '/magnolia-ascii.webp' });
button.onclick = () => { const on = v.toggle(); button.setAttribute('aria-label', on ? 'Pause' : 'Play'); };
```

Options: `src` (a URL or a `<video>`; default the first `<video>` inside, hidden while the field draws it), `autoplay` (default true, false under reduced motion, which shows the first frame), `poster` (an image URL shown, cover-fit, until the first frame is drawn, and under reduced motion until play), `label` (default `Video, drawn in characters`). Methods: `play()`, `pause()`, `toggle()`; getter `playing`. Give the element a size and a play control. Without WebGL2 the video itself plays in the element, muted and looping, with the poster, and the methods control it.

### artPanel

The sign-in page's art: an image in characters with a trail, a ring for form events and a lit band that crosses again and again while a request runs.

```ts
const art = artPanel(panel, { image: '/wing.webp', clear: brandMark });
form.onsubmit = async () => {
  art.pulse(submitButton, 1.8);
  art.shimmer(true);
  await sendLink().finally(() => art.shimmer(false));
  art.pulse(undefined, 0.6);
};
```

Options: `image` (a URL or an `<img>`; default the first `<img>` inside, hidden while drawn), `clear` (a brand mark over the art, kept clear in a soft rectangle), `focus` (cover crop, default `{ x: 0.5, y: 0.4 }`), `label` (default the image's `alt`). Methods: `pulse(from?, strength?)` (default 1), `shimmer(on)`. Give the panel `overflow: hidden` and a background; the field sits under its content.

### pricingGlow

The recommended plan's halftone: light from the top corner, a lantern under the pointer, and the yearly saving set large in dots in the open space between the plan's copy and its price.

```ts
const glow = pricingGlow(card, { price: '.price' });
period.onchange = () => glow.saving(yearly ? '−25%' : null);  // the band sweeps the old halftone out, the new one in
cta.onclick = () => glow.pulse(cta);
```

Options: `saving` (text, default none), `price` (the element or selector the open space ends at, default `[data-price]`; the space starts below the last of the card's children before it, and must be at least 30px tall), `font` (default `"Geist", Arial, sans-serif`). Methods: `sweep()` (one band over the current halftone), `saving(text | null)`, `pulse(from?, strength?)` (default 1.6). Ink defaults read the card's own ground: lighter dots on a dark card, darker on a light one. The field sits under the card's content; the art is rebuilt when the card resizes.

Route transitions are covered by `pageDissolve`.

## Phase 2a: voice, commands, gestures and data

Interactive components that keep their text and controls in HTML and paint the moment in characters. Each one wires its own pointer, keyboard and ARIA, and keeps working as plain HTML without WebGL2: the slider still confirms, the palette still opens, the code input still takes a code.

```ts
import { voiceOrb, commandPalette, slideToConfirm, likeBurst, blockChart, pageDissolve, swipeDeck, codeInput } from 'asciify-engine/kit';
```

### voiceOrb

A sphere of characters that swells with the voice, hums while the reply is worked out and settles when done. The microphone is asked for only when `mic()` is called.

```ts
const orb = voiceOrb(button, { palette: 'aurora' });
orb.listen();
recognizer.onvolume = v => orb.level(v);         // 0–1; fast attack, slower release
recognizer.onend = () => orb.think();
reply.then(() => orb.done());
micButton.onclick = async () => { if (!(await orb.mic())) note.textContent = 'Microphone unavailable'; };
```

Options: `palette` (`'mono' | 'aurora' | 'brand'` or your own hex stops, default `aurora`), `level` (start, default 0), `swell` (scale the element up to 10% with the level, default true; `--ascii-level` is set either way). Methods: `level(v)`, `listen()`, `think()`, `done()`, `idle()`, `mic()` (a promise for whether it got the microphone; `think`, `done`, `idle` and `destroy` stop it); getters `state`, `current`. Sets `data-state`. Give the element a size and a round border radius; the field reaches 8% past it.

### commandPalette

The palette condenses out of its trigger in blocks of characters and dissolves back into it. A crisp HTML highlight glides between rows; rows a search brings in (or moves) resolve out of characters left to right; and a selected AI row shimmers every few seconds, a crest crossing it that turns its letters to characters and back while the row's text is masked under the crest.

```ts
const cmd = commandPalette(panel, { trigger, onRun: (i, row) => commands[row.dataset.id!].run() });
search.oninput = () => render(filter(search.value)); // the kit re-selects row 0 on input
cmd.select(2);
```

Options: `trigger`, `input` (default `input`), `rows` (default `[role="option"]`), `open` (default: open unless the panel has `hidden`), `hotkey` (⌘K / Ctrl+K, default `'k'`, `false` for none), `manage` (arrow keys, Home, End, Enter, Escape, hover, outside clicks, `aria-selected` and `aria-activedescendant`; default true), `closeOnRun` (default true), `onRun(index, row)`, `onOpenChange(open)`, `highlight` (default true; `false` if your rows style `aria-selected` themselves), `ai` (rows that shimmer, default `[data-ai]`). Methods: `open(focus?)`, `close()`, `toggle()`, `select(i)`, `run(i?)`; getters `isOpen`, `selected`. Closed is the `hidden` attribute; `data-state` is `opening` or `closing` in flight, and closing fades the panel's surface as its clip lands so the trigger shows through. Give rows an `id`. The kit adds a `[data-ascii-cmd-highlight]` element as the panel's first child, sized to the selected row with its radius; colour it with `--ascii-cmd-highlight` (default 7% of the text colour). The panel becomes its own stacking context (`isolation: isolate`) and the field lies under the content and over the panel's fill (z-index -1, ignoring the pointer), so the characters never cover text. Rows are watched (a MutationObserver), so a framework re-rendering them after the input event is fine. Without WebGL2 the highlight, keys and the open and close clip still work.

### slideToConfirm

Characters fill the track behind the thumb as it travels; on completion the fill condenses into a disc, opens into a ring and a check draws inside it while the ink eases to the success colour.

```ts
const pay = slideToConfirm(track, { onConfirm: () => charge(), mark: track.querySelector('.done-icon') });
charge().catch(() => pay.reset());
```

The track holds a `[role="slider"]` thumb (or any first child) and an optional `[data-label]`. Options: `onConfirm`, `thumb`, `label`, `mark` (where the check lands, default the track's middle), `threshold` (default 0.9), `resetAfter` (ms, default 0: stays confirmed), `color` (default `--ascii-success`). Drag, fling, a press on the track (a nudge), arrow keys, Home, End, Enter and Space all work; only the pointer that took the thumb drags it, and a pointer that cannot be captured (a scripted one) still drags. Methods: `confirm()`, `reset()`; getter `confirmed`. Sets `data-state` (`idle`, `dragging`, `confirmed`, `resetting` while the fill fades on reset) and `data-confirmed` once the check is in, for your done text.

### likeBurst

The mark springs out of the icon to about 1.5x in characters, an outline rolls out, a few sparks fly, and it lands back in the crisp icon; undo loosens and thins it out.

```ts
const like = likeBurst(button, { limit: postBody, onChange: on => api.like(post.id, on) });
const save = likeBurst(saveButton, { kind: 'save' });
```

Options: `kind` (`'heart' | 'save'`), `icon` (default the first `svg`), `manage` (click toggles `aria-pressed`, default true), `limit` (nothing is drawn above this element's bottom), `outset` (default 40px), `layer` (`'under'`, the default, draws between the button's background and its content so the count and label stay crisp over the sparks; `'over'` draws above), `onChange(pressed)`. Point `icon` at a wrapper when the button swaps a line and a filled icon: the whole wrapper hides while the characters pop and fades up as they land. Ink defaults to `--ascii-like` (`#e5484d`, `#ff6b70` on dark) for hearts. Methods: `burst()`, `undo()`, `toggle(pressed?)`; getter `pressed`. For the count, pair it with `odometer(countEl)` and call `set()` from `onChange`.

### blockChart

A bar chart in columns of characters on a whole-cell grid: every bar is a crisp block of glyphs with one denser cap row, sitting on a dotted baseline. The bars grow in staggered when the chart first comes into view, the last ("today") is lit, and hover, touch or the arrow keys light one bar and fade the rest. `set()` morphs: bars whose label survives glide and resize into place, new ones grow in, dropped ones sink away.

```ts
const chart = blockChart(plot, { values: visits, labels: days, onHover: (i, v, day) => headline.set(i === null ? total : v!) });
range.onchange = () => chart.set(nextVisits, nextDays); // shared days glide, e.g. the last 7 of 30
```

Options: `values`, `labels` (also how `set()` matches bars; without labels they match from the right), `max` (default the largest plus 4%), `duration` (ms for growing, gliding and resizing, default 560), `stagger` (default 45ms up to 7 bars, else 12), `format` (for the screen-reader table), `intro` (grow the bars in when first seen, default true; `false` draws them in place, as in a view that is swapped in), `onHover(index, value, label)`. Methods: `set(values, labels?)`, `highlight(i | null)`; getters `active`, `values`. Cells are square (`look.cellSize`, default 7px) and the canvas is trimmed to whole cells, centred on the plot's bottom edge, so every glyph lands exactly; bars take whole cells, with gaps of about half a bar, and drop the gaps only when there are more bars than fit (about `width / 2` cells): for 30 bars in a 300px plot pass `look: { cellSize: 4.5 }`. Adds a visually hidden table of the values and makes the plot focusable; set `touch-action: pan-y` on the plot so a finger can scrub. Draw the axis labels and the readout in HTML, and roll the readout with `odometer`. Without WebGL2 the bars are plain blocks in the text colour, with the same emphasis.

### pageDissolve

One wave of characters from where the user clicked: the crisp view crossfades into its own characters and breaks up outward, the content swaps underneath once the old HTML has faded, the next view condenses in behind the same wave, and it crossfades back to crisp HTML. About 430ms end to end, never a frame with neither view on screen.

```ts
const page = pageDissolve(body);
tab.onclick = () => page.swap(() => render(tab.dataset.page), tab);
```

Options: `origin` (an element or `{ x, y }`, default top centre), `dissolve` (ms the old view takes to break up, default 300), `condense` (ms the new view takes to land, default 300; it starts about 110ms in, once the old HTML has faded). Methods: `swap(render, origin?)` (a promise; swaps queue, and `render` may be async); getter `busy`. The kit draws the view from its DOM (text in its own font, filled and bordered boxes, media as blocks), never from image pixels; another kit component inside the view, such as a `blockChart`, is drawn as its settled frame, and kit posters and screen-reader-only text are left out. Sets `data-state` (`out`, `in`). Under reduced motion, without WebGL2, or while the field waits for a WebGL context, `render` runs at once. It shows no poster: at rest it is a blank layer over the live view. Mount a `blockChart` inside the view with `lazy: false`, so it has its context as the view lands.

### swipeDeck

A deck of photo cards drawn in characters: drag or press the arrow keys to fling the top card, which breaks into rows of characters along the swipe while the next card rises.

```ts
const deck = swipeDeck(slot, { onSwipe: (dir, i) => (dir > 0 ? save(stays[i]) : pass(stays[i])) });
keep.onclick = () => deck.next(1);
pass.onclick = () => deck.next(-1);
```

Cards are `[data-card]` children stacked in the deck (absolutely, same size), each with an `<img>`. Options: `cards`, `loop` (default true), `threshold` (share of the width, default 0.4), `radius` (default the deck's border radius), `outset` (default 56px; give it the distance to your stage's edge so a fling streams across it, rows thinning before the field's edge), `leanTarget` (the element that receives `--ascii-lean`, such as the row holding your buttons; default the deck), `onSwipe(dir, index, card)`. Methods: `next(dir?)` (false at the end of a deck that does not loop); getter `index`. With the field the cards are drawn rather than shown, so put captions outside the deck; images must be same-origin or CORS-enabled to be drawn. Sets `--ascii-lean` (-1 to 1) for your buttons. Only the pointer that took the card drags it. Without WebGL2 one HTML card shows at a time and follows the drag.

### codeInput

A one-time-code field: each digit resolves out of scattered characters, the caret is a column of characters that breathes, a wrong code breaks up and shakes, and a right one gathers into a check in a ring.

```ts
const code = codeInput(row, { length: 6, onComplete: async c => code.verify(await api.check(c)) });
```

The kit uses the row's `input` (or adds a transparent one, `autocomplete="one-time-code"`) and its `[data-cell]` children (or adds them), writing each digit into a `[data-digit]` span. Options: `length` (default 6), `accept` (`'digits' | 'alphanumeric'`), `cells`, `onComplete(code)`. Methods: `verify(ok)`, `clear()`, `fill(code)` (enters a whole code as a paste or autofill would, the characters resolving one after another, for a “From Mail” button); getters `value`, `state`. Sets `data-state` (`idle`, `error`, `success`) on the row, `data-active` on the caret's cell, `data-shown` once a digit has landed, and `aria-invalid` after a wrong code. Style the cells; the field reaches 16px past the row.

## Phase 2b: feedback, streaming and media

Toasts, assistant replies and image components. Where a component has meaning without the field it keeps working as plain HTML without WebGL2: toasts still stack, `thinking` and `streamText` still write their text, the accordion and dropzone still show photos, `disintegrate` still closes the row and `pullRefresh` still refreshes. Components that build markup add their fallback styles once, as a `<style>` whose rules all sit in `:where()`, so any class of yours overrides them.

```ts
import { toastStack, thinking, streamText, compare, accordion, dropzone, disintegrate, pullRefresh } from 'asciify-engine/kit';
```

### toastStack

Toasts that gather out of scattered characters, newest in front and the rest tucked behind, fanning out while pointed at or focused. Dismissed toasts break into characters that drift up and away while the stack closes up.

```ts
const toasts = toastStack(corner); // corner: a positioned box with a width, such as fixed bottom-right, 360px wide
const id = toasts.push({ title: 'Thread archived', body: 'Q3 planning · Ana', action: { label: 'Undo', onClick: restore } });
toasts.dismiss(id);
```

A toast is `{ title, body?, icon?, action?, duration? }`; `icon` is a node (such as an inline SVG) or a short text. Options: `max` (default 3; the oldest dissolves when another arrives), `duration` (ms each toast stays, default 6000, 0 keeps them; pointing at or focusing the stack holds them), `render(toast, id)` (your own `<li>`; mark parts with `data-paint` = `strong`, `text`, `meta`, `tile`, `icon` or `none` to set how they gather), `label` (the list's name, default `Notifications`), `swipe` (default true: drag a toast sideways and it follows, fading; let go past 64px or on a flick and its characters carry on the way it was thrown). `glint` is deprecated and ignored: nothing draws round a toast at rest. Methods: `push(toast)` (returns an id), `dismiss(id)`, `clear()`; getter `toasts`. The kit adds an `<ol class="ascii-toasts">` and a `role="status"` region that announces each toast. Classes: `ascii-toast`, `-icon`, `-text`, `-title`, `-body`, `-action`, `-close`; `--ascii-toast-bg`, `--ascii-toast-ink` and `--ascii-toast-shadow` set the surface; there is no outline, and tucked-behind toasts dim a step each so the stack reads in layers. New toasts rise 14px as they gather; a dismissed toast's neighbours close up at once while its characters drift. Each toast bridges the 8px gap below it, so pointing between fanned toasts keeps the stack open. The field reaches 24px past the container and lies above every toast, so gathering and breaking characters are never hidden behind one tucked away. A toast pushed before the field is drawing (still mounting, or released off screen) simply shows. The gathering characters are inked like the page, so a toast whose fill is too close to that ink to read them on (contrast under 3:1, such as an inverted dark pill on a light page) keeps its fill and shadow clear, inline and without a transition, until its text lands, then fills in with its own transition; no CSS is needed for it.

### thinking

An assistant reply's thinking state. While the model thinks, a wave runs through the status label: each letter in turn rolls up through glyphs and lands back on itself, in the label's own font, like the odometer. When the answer starts, every letter rolls once more into `Thought for 2s`, and the answer fades in word by word.

```ts
const reply = thinking(answer, { label: status }); // status reads "Thinking…", then "Thought for 2s"
await reply.stream(await ask(question));            // or an async iterable of chunks
regenerate.onclick = () => reply.think();
```

Options: `label` (the status element; the field rolls its characters, and a visually hidden live copy announces each status), `labels` (`{ thinking, done(seconds) }`), `start` (default true; false waits for `think()`), `stagger` (ms between words, default 38), `roll` (ms one letter rolls, default 520), `wave` (ms between neighbouring letters, default 55), `glyphs` (default `#%*+=-:`), `onState(state, seconds)` (for a status you render yourself). `lines` and `rule` are ignored since 4.17. Methods: `think()`, `stream(text | chunks)` (resolves once the last word has faded in; a partial word is held until it is whole); getter `state` (`thinking`, `streaming`, `done`). Sets `aria-busy` while thinking. The answer element is empty while thinking: open it with the reply (for example a `grid-template-rows` transition from `0fr` to `1fr` keyed on the state) rather than holding an empty box. Ink defaults to the label's text colour.

### streamText

Streamed text with a glyph write head: each token lands as flickering character cells that resolve into letters left to right, with a block caret after the last one. The real text is in the DOM all along, for selection and screen readers.

```ts
const out = streamText(paragraph, { transition: 'roll' });
for await (const step of llm.reasoning(prompt)) out.reasoning(step); // optional: a short tail of reasoning above the reply
for await (const token of llm.stream(prompt)) out.write(token);
await out.done();
stopButton.onclick = () => out.stop();
```

Options: `transition` (set at creation: `'flicker'`, the default, or `'roll'`, where each character rolls up through glyphs in the text's own font and settles on the crisp letter like the odometer, the caret riding the front of the roll), `roll` (ms one character rolls, default 300), `glyphs` (what it rolls through, default `#%*+=-:`), `caret` (default true: bright while writing, dim at rest), `settle` (ms the first character of a token flickers, default 60), `stagger` (ms more per character, default 18; under `roll`, the gap between characters starting), `reasoningLines` (reasoning lines kept in view, default 2), `onState(state)`. Methods: `write(token)`, `reasoning(line)` (adds a line to a tail the kit puts just before the element, `.ascii-reasoning`: the newest lines stay in view, older ones scroll up under a fade, and it collapses once the reply is done or stopped), `done()` (resolves once the last characters land), `stop()` (lands what was written at once; stopped while only reasoning, it folds the tail away), `reset()` (clears the text and the reasoning); getters `state` (`idle`, `streaming`, `done`, `stopped`) and `text`. Sets `aria-busy` while streaming. The field covers the content box from a quarter line above to a quarter line below, in cells half a line tall and about a letter wide, so each glyph sits on its line's lowercase letters like a typed character; give the element a fixed `line-height`. New reasoning lines slide in together with the old ones. Ink defaults to the text colour.

### compare

A before and after slider: the photo left of the split and the same photo in characters, in its own colours, on the right. Drag anywhere in the frame, or use the arrow keys, Page Up and Down, Home and End on the handle.

```ts
const c = compare(frame, { image: '/kingfisher.webp', position: 58 }); // frame: a dark, 3:2 box
c.set(30, true);
```

Options: `image` (a URL, or an `<img>`; one already inside the frame is used in place), `position` (0–100 photo share, default 50), `label` (the slider's name), `onChange(position)`. Method: `set(position, glide?)`; getter `position`. The kit adds the photo, a divider and a `role="slider"` handle, or uses your own: an `<img>`, a `[role="slider"]` and a `[data-compare-line]` inside the frame are taken in place, keeping their classes and `aria-label`. It sets `--ascii-pos` on the frame, `aria-valuenow` and `aria-valuetext` on the handle, and `data-dragging` on the frame while a pointer drags. Images from another origin need CORS. Without WebGL2 the frame just shows the photo, with no slider.

### accordion

A strip of image panels: the open one shows its photo, the closed ones the same photos in characters. Pointing at, tapping or focusing a panel opens it. Each panel's width, photo and caption follow one critically damped spring, so the characters cross over to the photo with no gap or flash, and changing panels mid-move carries the motion on. A mouse sweeping fast across the strip waits about 90ms on a panel before opening it; a slow mouse, a tap or a key opens at once.

```ts
const a = accordion(strip, { images: [{ src: '/stairwell.webp', title: 'Stairwell', meta: 'Silver print · $120' }, '/shell.webp'], open: 1 });
```

Each image is a URL or `{ src, alt?, title?, meta?, focus? }`. Options: `images`, `open` (default 0), `duration` (ms the spring takes to settle, default 420), `label` (the group's name, default `Images`), `onChange(index)`. Method: `select(index, focus?)`; getter `open`. The kit adds a `<button class="ascii-acc-panel">` per image with `aria-expanded`, a roving `tabindex` and arrow, Home and End keys, and sets `--ascii-acc-open`, `--ascii-acc-photo` and `--ascii-acc-caption` (0–1) on each panel every frame for your own CSS. Give the strip a height. Closed panels draw the photo as tone (inverted on light grounds); without WebGL2 they show the photo dimmed.

### dropzone

An image dropzone whose border is a quiet ring of the lightest characters. While a file is dragged over it, the ring lifts, packets of denser characters chase round it and a halo a few cells deep leans in on the side nearest the file. A dropped image opens out from the drop point in characters, in its own colours, on a dark ground, and can be saved as a PNG.

```ts
const zone = dropzone(box, { onImage: ({ file, width, height }) => upload(file), onError: message => toast(message) });
zone.setImage('/sample.webp');
saveButton.onclick = () => zone.download();
```

Options: `onImage({ file, src, width, height })`, `onError(message, file)`, `maxBytes` (default 10 MB), `develop` (ms, default 900), `filename` (for `download()`, default `<name>-ascii.png`), `onState(state, name)`. Methods: `setImage(url | Blob)`, `clear()`, `pick()` (opens the file picker), `download(filename?)` (resolves with the PNG Blob, or null); getter `state` (`empty`, `developing`, `done`). Elements inside with `data-dropzone="pick"`, `"clear"` or `"download"` are wired to those actions. An empty element gets a title, hint and Choose file button (`.ascii-drop-empty`, hidden once an image shows); with your own content, style it from `data-state` and `data-over` on the zone. The ring is one even row of characters on every side: the canvas is trimmed to whole cells, centred, and the ring is drawn one block per cell, so no side doubles or thins at any size. Its ink defaults to `--ascii-ink`, else mid graphite. The image develops in a soft circle from where it was dropped (the centre for `setImage()` and the picker), its wavefront lit; under reduced motion it shows at once and the drag look holds still. Give the zone a size and a background. Characters in the photo's own colours need a dark ground, so on a light zone the image is drawn on `#0b0b0a` (pass `look: { background }` for another); `download()` fills with the zone's background, or that ground.

### disintegrate

Deletes a row into characters: its text and icons become shimmering glyphs that thin out from the right and drift up and away while the row closes up. Not a handle: it returns a promise for the end.

```ts
await disintegrate(row);          // then remove the row from your data
await disintegrate(row, { remove: true });
```

Options: `duration` (ms, default 620), `collapse` (close the row's height, default true), `remove` (take the row out of the DOM at the end; default false, which leaves it hidden and collapsed for your framework to remove), `host` (the element the field is drawn over, default the row's parent, so the characters can drift past the row's box). Calling it again on the same row returns the same promise. The row stays as it is until the field can draw its first frame, so a slow mount never leaves a gap. Without WebGL2, or under reduced motion, the row closes at once.

### pullRefresh

Pull to refresh: dragging the content down at the top draws a small ring of characters round in the gap (26px, the size of iOS's indicator), closing it with a small pop at the threshold. Let go past it and the content rests 48px down while the ring opens into a spinning arc as `onRefresh` runs; then it draws a check and springs back, the ring shrinking away with the gap.

```ts
const pull = pullRefresh(screen, { onRefresh: () => loadNewPosts(), reveal: '[data-new]' });
refreshButton.onclick = () => pull.refresh();
pull.revealRows(feed.querySelectorAll('.just-arrived')); // or reveal any rows yourself
```

Options: `onRefresh` (may return a promise; the ring spins at least 600ms), `content` (the element that moves, default the first child), `threshold` (px, default 64), `messages` (`{ refreshing, done, failed }` for the live region), `reveal` (a selector for the rows `onRefresh` added: a frame after it resolves they are hidden behind the check, then resolve in from characters as the content springs back). Methods: `refresh()`, `revealRows(rows)` (each row appears as glyphs of its own text, with its photos drawn as tone rather than flat tiles, following a row that is still opening, then hands over to the HTML over about 760ms; a row is revealed once, and under reduced motion or without WebGL2 rows just show); getter `state` (`idle`, `pulling`, `refreshing`, `done`). Sets `aria-busy` while refreshing. It engages only when the element is scrolled to the top; give it `overflow: hidden` or `auto` and keep a Refresh button for keyboard users.

## Backgrounds

Every background on asciify.org/backgrounds as one call, drawn the same way as the site's stage: the same renderers, clock, pointer smoothing, pixel ratio and graphite inks, so a preset with the same settings matches it in light and dark. The canvas sits under the element's content (`isolation: isolate`, `z-index: -1`), follows the theme, pauses off screen and in hidden tabs, and holds one still frame under reduced motion.

```ts
import { background, caustics, aurora } from 'asciify-engine/kit';

const bg = background(hero, { preset: caustics, clear: headline, speed: 0.8 });
bg.update({ palette: { light: '#5b4bd1', dark: '#8f80ff' }, cellSize: 10 });
bg.setPreset(aurora);   // cross-fades, keeping your options
```

Presets are separate exports, so a page pays only for the ones it imports: `background()` with one canvas preset is about 6.2 KB gzip (6.8 KB for `wave`), and each further canvas preset adds 0.2–0.9 KB (all 22 together: 13.9 KB). `drift`, `halftone`, `swell`, `wordField` and `fluid` drive the GPU glyph field, so they cost about 7 KB (`fluid` 9.7 KB) plus the shared `asciify-engine/field` build, 17 KB gzip, that every field component uses (and take `lazy`, `poster`, `globalLook` and the context budget like every field component); the rest are 2D canvases and need no WebGL. To offer a menu of several, import those you list.

Options: `preset` (required), `palette` (one ink or `{ light, dark }`, winning over `color` and `ink`; default the preset's graphite for the ground), `color` (one ink for both grounds), `accent` (heads, peaks and signals for the presets that draw them; default the preset's own, or one mixed from the ink), `speed` (0–5, default the preset's tuned pace, the Speed control on the site), `cellSize` (character size in CSS px, dot spacing for `halftone` and `swell`; default the preset's), `charset` (characters from empty to dense, or a named set: `standard`, `asciify`, `minimal`, `detailed`, `letters`, `technical`, `blocks`, `braille`, `dots`), `cursor` (pointer response, default on for the presets that answer it; the GPU presets also take `'trail' | 'fluid' | 'lantern'`), `clear` (an element to keep clear: the field fades out round it), `opacity` (default 1, `fluid` 0.7, `swell` 0.6), `dither` (ordered dither 0–1 for the tonal presets), `text` (`wordField`'s word, default `ASCIIFY`), plus `ink`, `look` (glyph-field settings, GPU presets only) and `reducedMotion`. Methods: `setPreset(preset)`; getter `preset`. `field` is the `GlyphField` for the GPU presets and `null` for canvas ones.

`fluid` lays its cells out as the site's hero does: a whole number of 7 × 12.07 px cells (`cellSize` / 0.58 tall) stretched to fill the stage exactly, so rows keep their place down a tall page, drawn at up to 1.5 device pixels per CSS pixel. It does this through the field's `cellFit: 'fill'` (see glyph-field.md).

The canvas templates draw in the page's fonts: load Geist Mono (and JetBrains Mono for `fluid`) as the site does, and note that the page's `-webkit-font-smoothing` changes their weight on macOS just as it does on the site.

| Preset | Kind | Looks like | Size, speed, cursor |
| --- | --- | --- | --- |
| `drift` | GPU | Characters that drift slowly in broad soft lobes and clear round your content | 11, 1, trail |
| `halftone` | GPU | The same drifting ground as dots | 14, 1, lantern |
| `swell` | GPU | A fine dot grid whose dots swell in slow rolling waves, quiet in the middle and clear round your content; dots rise under the pointer and settle behind it | 10, 1, lantern |
| `wordField` | GPU | Your word (`text`) as a flowing field of letters | 13, 1, trail |
| `fluid` | GPU | The original Asciify hero: flowing folds with a wake behind the cursor | 7, 1, wake |
| `caustics` | canvas | Fine pools of light drifting like water across stone | 12, 1, no |
| `contour` | canvas | Fine topographic lines with a slow, rolling drift | 12, 1, no |
| `facet` | canvas | Folded planes catching light along their edges | 12, 1, no |
| `etch` | canvas | Cut-grain lines following a sculpted current | 12, 1, no |
| `moire` | canvas | Two fine line fields overlapping into broad bands | 12, 1, no |
| `weave` | canvas | Interlaced threads with a subtle change in tension | 12, 1, no |
| `veil` | canvas | Tall folds of light across a quiet ground | 12, 1, no |
| `dune` | canvas | Layered sand ridges with slow light and fine grain | 12, 1, no |
| `wave` | canvas | An interference field with a soft vortex at the cursor | 13, 0.6, yes |
| `aurora` | canvas | Soft bands of light that ripple under the cursor | 13, 0.6, yes |
| `noise` | canvas | A slow fractal noise field that warps round the cursor | 13, 0.5, yes |
| `silk` | canvas | Long ribbons following a slow flow field | 13, 1, no |
| `rain` | canvas | Columns of falling characters with bright heads | 13, 1, no |
| `stars` | canvas | A sparse starfield that twinkles and leans to the cursor | 14, 1, yes |
| `pulse` | canvas | Rings of characters rippling out from the cursor | 14, 1, yes |
| `grid` | canvas | Scan bands rolling down a grid, glitching near the cursor | 12, 1, yes |
| `voidWell` | canvas | A gravity well spiralling characters round the cursor (`void` is reserved in JS) | 13, 1, yes |
| `morph` | canvas | Every cell shimmering at its own frequencies | 14, 1, no |
| `fire` | canvas | A cellular flame rising from the bottom edge | 13, 1, no |
| `dna` | canvas | Double helices scrolling past with base-pair letters | 13, 1, no |
| `terrain` | canvas | A side-scrolling landscape in density characters | 13, 1, no |
| `circuit` | canvas | Circuit traces with signals running along them | 13, 1, no |

Your own preset is an object with `id`, `name`, `description`, `cellSize`, `speed`, `cursor` and `mount(context)`; `mountCanvas(context, draw)` runs a 2D template with the same clock and pointer as the built-ins.
