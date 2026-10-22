# Applying Asciify: the house design

How asciify.org puts characters into a real interface. Read this before choosing a component or a background, then take the call from [components.md](components.md) and its options from [kit.md](kit.md). Every rule here is one you can check in the browser.

The site's claim is the brief: ASCII that belongs in your interface. Characters are a material the interface uses for a job (showing work, confirming an outcome, moving between states, setting one ground for a page), drawn in the page's own ink, inside its own shapes, at its own pace.

## 1. Give the characters a job

Pick by what the field does for the person, not by how it looks.

| Job | Use |
| --- | --- |
| Show that work is running | `buttonLoading`, `statusOrb`, `thinking`, `streamText`, `skeleton`, `imageGenerate`, `pullRefresh` |
| Confirm or refuse an outcome | `statusOrb` success, warning or error; `slideToConfirm`; `codeInput` `verify()`; `beam` `success()` or `error()` |
| Show a value changing | `odometer`, `pill` counts, `blockChart` |
| Move between states or views | `tabs`, `pageDissolve`, `commandPalette`, `toastStack`, `disintegrate` |
| Answer a gesture | `likeBurst`, `swipeDeck`, `compare`, `accordion`, `dropzone` |
| Follow the pointer across the page | `cursorTrail` (one per page, off on touch and under reduced motion) |
| Carry a brand moment or media | `decode` (and its `scramble`), `wordmark` (and its `assemble`), `morphField`, `ditherImage`, `asciiVideo`, `artPanel`, `pricingGlow`, `fieldBackground` `notFound` |
| Show where: places, reach, a network | `globe` with `points` |
| A playful, living hero ground | `ocean` (fish, sharks, mantas, jellyfish and schools that answer the cursor), or `background()` with `estuary`, `capillary` or `shockwave` for a ground visitors stir, grow and ripple |
| Set the page's one ground | `fieldBackground` `hero`, `ditherGradient`, or `background()` with a preset (section 9) |

Do not use characters:

- behind body copy, forms, tables, code, docs pages or navigation;
- on every card in a grid, or as a second ground on a page that has one;
- as the only carrier of a state: the label, the live region or the HTML still says it;
- for a loader with no real work behind it, or for decoration that never answers an event.

Test: hide the canvas. If the interface loses no feedback and the field was not the page's one ground, remove it. A ground earns its place by answering the interface. On asciify.org the hero field pulses when the command is copied:

```ts
import { fieldBackground } from 'asciify-engine/kit';

const bg = fieldBackground(hero, { preset: 'hero', clear: heroCopy });
copyButton.addEventListener('click', () => bg.pulse(copyButton));
```

## 2. Ink: quiet by default, colour only for meaning

Inks come from the app's own design tokens, never from hex values you pick. Find the app's text, muted-text, background and status tokens first (CSS variables, a Tailwind theme, a tokens file) and derive the Asciify inks from them, so they follow every theme the app already has:

```css
:root {
  /* Map to the app's tokens; the names on the right are examples. */
  --ascii-ink-strong: color-mix(in oklab, var(--foreground) 92%, var(--background)); /* a component that is the focus */
  --ascii-ink: color-mix(in oklab, var(--foreground) 50%, var(--background));        /* grounds, rings, quiet strokes */
  --ascii-success: var(--success); --ascii-warning: var(--warning); --ascii-error: var(--destructive);
}
```

Because these derive from tokens the app already switches per theme, they need no dark-mode block of their own. The kit re-reads them when `prefers-color-scheme` changes and when `class` or `data-theme` changes on `<html>` or `<body>`. Left undefined, `--ascii-ink-strong` falls back to the component element's own text colour, and the status inks to the engine's greens, ambers and reds; define them anyway so nothing is guessed. Only when an app truly has no tokens, use the site's graphite: `#1d1d1b` and `#76746e` on light, `#d8d6cf` and `#7a7872` on dark.

Rules:

- **Default to graphite.** Leave `ink` unset: components pick `--ascii-ink` or `--ascii-ink-strong` and background presets use their graphite. On another brand, map these tokens to its muted text colour, never to its accent.
- **Colour means something.** Green, amber and red are for outcomes only, and come from `--ascii-success`, `--ascii-warning` and `--ascii-error`. The site's phosphor marks live states only and is never a button or text.
- **Palettes are deliberate.** `beam` `colorful`, `voiceOrb` `aurora` and `fieldBackground` `brand` are chosen palettes for one moment the user asked for, not a page default.
- **Never a new colour.** No hex that is not a token (map to the app's tokens as above), no black canvas on a light page, no white glow on a coloured image.

```ts
import { background, swell, statusOrb, beam } from 'asciify-engine/kit';

background(pricing, { preset: swell, clear: pricingCopy, ink: '--ascii-ink' }); // the token, re-read per theme
const orb = statusOrb(orbSlot); // strong ink at rest; outcomes read --ascii-success, --ascii-warning, --ascii-error
beam(planCard, { palette: 'mono', mode: 'pulse' }); // the quiet beam; 'colorful' only when asked for
orb.loading();
```

## 3. Text over a field: clear zone plus frosted veil

Text never sits on raw characters, and never in a box. Two layers do the work:

1. **The clear zone.** Pass the text block as `clear`; the field fades out around it (`fieldBackground` in a soft ellipse, the GPU background presets in a feathered rectangle 32px out, canvas presets in a soft ellipse).
2. **The veil.** A frosted, radially masked wash of the ground behind the text, so characters blur and fade toward the words instead of stopping at an edge. This is asciify.org's CSS:

```css
.hero-copy { position: relative; isolation: isolate; }
.hero-copy::before {
  content: ""; position: absolute; z-index: -1; inset: -36px -64px; pointer-events: none;
  background: color-mix(in oklab, var(--bg) 62%, transparent);
  -webkit-backdrop-filter: blur(9px) saturate(1.1); backdrop-filter: blur(9px) saturate(1.1);
  -webkit-mask-image: radial-gradient(closest-side, #000 52%, rgb(0 0 0 / .6) 74%, transparent);
  mask-image: radial-gradient(closest-side, #000 52%, rgb(0 0 0 / .6) 74%, transparent);
}
/* A smaller block, such as a card's title and button: a tighter veil from the surface it sits on. */
.card-copy::before { inset: -24px -40px; background: color-mix(in oklab, var(--surface-2) 58%, transparent); }
```

- No solid panels, cards or hard-edged scrims behind headline copy. Buttons keep their own opaque fill.
- A header over a field: mask the field to about a quarter strength under the header strip, as the site does: `mask-image: linear-gradient(to bottom, rgb(0 0 0 / .26), rgb(0 0 0 / .26) 56px, #000 152px, #000 80%, transparent)`.
- **Contrast.** Body and lede text 4.5:1, display text of 24px and up 3:1, measured against the busiest frame under the text, in both themes. Fix a failure with the clear zone, the veil, a lower `opacity` or larger cells. Never dim, recolour or shadow the text to fix it.

## 4. Density and cell size by surface

| Surface | Cell size | Characters | Site reference |
| --- | --- | --- | --- |
| Page hero ground | 10–12px, broad shapes | Sparse: `' .:+*#'` in the mono face | `fieldBackground` `hero` (10px), `drift` (11px), `swell` (10px dot spacing), the scene presets (11px) |
| Section band or card stage | 7–10px | Fuller ramp for images (`' .:-=+*#%@'`), quiet ramp for grounds | images 7px, character fields 10px, dots 9px |
| Control: button, pill, tabs, code input, odometer | Leave it to the kit | The kit fits cells to the element's text | Use a monospaced label for `buttonLoading` |

- One density per surface: a stage does not mix a 7px image and a 12px ground.
- Nothing under 6px on a phone; the GPU grounds already enlarge their shapes under 760px.
- Tune with `look: { cellSize }` on a component or `cellSize` on `background()`, and only after looking at it at 1x and 2x.

```ts
import { background, drift } from 'asciify-engine/kit';

const band = background(featureBand, { preset: drift, cellSize: 12, clear: bandCopy }); // a touch quieter than the default 11
band.update({ charset: ' .:+*#' }); // the hero's sparse ramp
```

## 5. Radii and containment

The kit clips every field to its host's computed corner radii, so the shape must be on the host.

- Put `border-radius` on the element you pass, from the project's tokens, never a literal. asciify.org: `--r-xs` 8px, `--r-inner` 18px, `--r-panel` 24px, `--r-dialog` 28px, and every control a pill (`--r-control: 999px`).
- Nest radii: an inner frame inset by `p` takes `calc(var(--r-panel) - p)`, as the site's video frame does (`calc(var(--r-panel) - 8px)` inside an 8px padding).
- Give `overflow: hidden` and a background to hosts the kit draws inside: `artPanel`, `imageGenerate`, `compare`, `accordion`, `dropzone`.
- Some components draw past their host on purpose: `voiceOrb` 8%, `codeInput` 16px, `toastStack` 24px, `likeBurst` 40px (`outset`), `swipeDeck` 56px (`outset`). Their container must have that much room, or bound them:

```ts
import { likeBurst, swipeDeck } from 'asciify-engine/kit';

likeBurst(likeButton, { limit: postBody, outset: 24 }); // nothing above the post body, sparks inside the card's padding
swipeDeck(stack, { outset: 32 }); // the stage's own padding, so a fling thins out before its edge
```

Check: with the page zoomed to 200%, no character lands outside a rounded corner or past a container edge.

## 6. Motion

- **Interface: 280ms or less.** Anything a person waits on: tab indicator (`tabs` defaults to 280), panel open (`accordion` 280), tone change (`pill` 240), poster fade (280), view swap (`pageDissolve` 140 + 160).
- **Decorative: 800ms or less.** One-shot flourishes: `disintegrate` 620, `dropzone` develop 720, the like burst. `decode` defaults to 900, so pass `duration: 800` or less.
- **Ambient loops: slow.** Keep `speed` at or below the preset's own. Motion should be noticed on the second look, not the first.
- **Easing.** CSS around the field uses the house ease-out, `--ease: cubic-bezier(.23, 1, .32, 1)`, with 140ms for control colour changes. The kit's own motion runs on `cubic-bezier(.16, 1, .3, 1)`. No linear or ease-in entries; a spring only where the material earns a settle (a like, a badge).
- **Reduced motion.** The kit draws each state settled in one frame and each background as one still; poster fades become instant. Drop your own transitions too, and never hide a playing canvas with CSS instead.
- **Off screen.** The kit pauses fields off screen and in hidden tabs. Call `pause()` on fields inside closed overlays. Give video and any field that is the content, not a texture, a visible pause control.

```ts
import { tabs, decode } from 'asciify-engine/kit';

tabs(tablist, { duration: 280, panels: 'attribute' }); // interface
decode(headline, { duration: 800, settle: 'text' }); // decorative, under the 800ms ceiling
```

```css
:root { --ease: cubic-bezier(.23, 1, .32, 1); --fast: 140ms; }
@media (prefers-reduced-motion: reduce) { .tab, .panel, .btn { transition: none; animation: none; } }
```

## 7. Performance

- **Fields share one context.** Every field on the page draws through one WebGL2 context, so the count of fields is bounded by what is animating on screen, not by contexts. Static fields draw once and stop. Sharing still helps: one `pill()` call over a list draws every pill with one field.
- **Lazy by default.** Fields mount within half a viewport and release beyond one. Use `lazy: false` only for the hero in the first viewport.
- **Posters.** Give every field above the fold, and every field that matters without WebGL, a still per theme, and swap it on theme change with `update({ poster })` rather than remounting.
- **Canvas presets cost CPU, not contexts.** Count them toward the page anyway; one animated ground per viewport.
- **Import by name.** Presets are separate exports, so import only those you mount.
- **Destroy on unmount.** In React, create the handle in an effect and return its `destroy`.

```ts
import { fieldBackground, setFieldBudget } from 'asciify-engine/kit';

setFieldBudget(10); // a page with heavy media of its own
const dark = matchMedia('(prefers-color-scheme: dark)');
const still = (isDark: boolean) => `/stills/hero-${isDark ? 'dark' : 'light'}.webp`;
const ground = fieldBackground(hero, { preset: 'hero', clear: heroCopy, lazy: false, poster: still(dark.matches) });
dark.addEventListener('change', event => ground.update({ poster: still(event.matches) }));
```

## 8. Accessibility

- **Canvases are decoration.** Kit fields are `aria-hidden` and ignore the pointer. Only the canvases that are the content take a `label`: `fieldBackground` `notFound`, `asciiVideo`, `artPanel`.
- **Real text stays in the DOM.** `decode`, `wordmark` and `streamText` keep the actual words selectable and readable; `odometer` and `pill` counts add a hidden copy; `blockChart` adds a hidden table. Do not replace text with a field.
- **Status is announced.** Pass a live region to `buttonLoading` (`announce`), give `thinking` its `label` (it adds a hidden live copy, so the label itself needs no role), write `statusOrb` outcomes to one yourself, and give `pullRefresh` its `messages`. `toastStack` adds its own `role="status"` region.
- **Keyboard and focus.** The kit wires keys for `tabs`, `commandPalette`, `slideToConfirm`, `compare`, `accordion`, `swipeDeck` and `codeInput`; keep them (`manage` stays true). Keep a Refresh button beside pull to refresh. A field never covers a focus ring: `beam` draws inside the border, so a 2px outline at 3px offset stays clear.

```ts
import { statusOrb, buttonLoading } from 'asciify-engine/kit';

// <p id="publish-status" role="status" aria-live="polite"></p>
const orb = statusOrb(orbSlot, { ring: true });
const button = buttonLoading(publishButton, { announce: publishStatus });
publishButton.addEventListener('click', async () => {
  orb.loading(); button.start('Publishing');
  await save().then(() => { orb.success(); button.succeed('Published'); }, () => { orb.error(); button.fail('Retry'); });
});
```

## 9. Backgrounds

`background(element, { preset })` draws any of the 12 curated presets from asciify.org/backgrounds under the element's content. Choose by surface:

| Surface | Presets | Notes |
| --- | --- | --- |
| Product hero, pricing, docs landing, behind copy | `swell`, `drift`, `halo`, or `fieldBackground` `hero` | Grounds that clear around `clear`. `swell` is the finest, a grid in slow waves (dots, or characters with `mark: 'glyph'`) quiet in the middle even without `clear`; `halo` frames a single headline; `fieldBackground` `hero` is asciify.org's own hero, with ripples and `pulse()`. |
| A brand or name moment | `wordField` (id `field`), `fieldBackground` `brand` | Your word in the field; keep copy off its centre. |
| Art-first hero with little copy | `fluid`, `mesh` | `fluid` is the original Asciify hero, 7px cells at 0.7 opacity; `mesh` is a soft gradient in characters. Not behind reading text. |
| Quiet texture: section bands, footers, empty states, side panels | `caustics`, `contour`, `interference`, `constellation` | Fine lines, slow. Safe behind text with `clear`. |
| An ambient or interactive moment | `ripple`, `cascade` | `ripple` drops rings where the pointer moves; `cascade` falls in three depths. Keep them away from forms and body copy. |

Keep them calm:

- `speed` at or below the preset's default; `cursor: false` near forms and copy.
- Every preset keeps a quiet zone; still `clear` the copy and add the veil from section 3.
- One background per page section, under one `isolation: isolate` host with its own background colour.
- `setPreset()` cross-fades in place for a picker; do not mount a second background.

```ts
import { background, contour, caustics } from 'asciify-engine/kit';

const section = background(features, { preset: contour, clear: featuresCopy, opacity: 0.8, cursor: false });
themePicker.addEventListener('change', () => section.setPreset(caustics)); // keeps clear, opacity and cursor
```

```ts
import { background, drift } from 'asciify-engine/kit';

const bg = background(hero, { preset: drift, clear: heroCopy, poster: '/stills/drift-light.webp' });
signUpButton.addEventListener('click', () => bg.field?.pulse({ element: signUpButton, strength: 1.2 })); // GPU presets expose the field
```

## 9b. Event and launch pages

A conference, launch or campaign page can carry more character than a product page, but the same rules hold: one key visual a section, real HTML for every headline and link, and motion that answers the visitor.

| Section | Piece | Keep it |
| --- | --- | --- |
| Header | `decode(link, { scramble: true, trigger: 'manual', settle: 'text' })` on each nav link | Links rest as plain HTML and only scramble on hover; `cellSize` about 3 so letters stay crisp. |
| Hero | `morphField` of your own frames (`mark: 'engraving'` lines, white ink on the brand ground) and `decode(h1, { scramble: true, settle: 'text' })` | One morph per hero; a counter or caption through `onChange`; a poster per theme. |
| Ambient pointer | `cursorTrail({ style: 'spray', readout: true, zIndex: -1 })` | A background hover: behind cards, off on touch and under reduced motion. |
| Proof sections | `globe` for venues or reach, `ditherImage` for photos in the brand's two tones, `background(el, { preset: wordField, look: { glyphOrder: 'text', … } })` for repeated words | `globe` and `wordField` are section grounds; keep copy off their middle or `clear` it. |
| Call to action | `ditherGradient` on the brand-coloured panel | Light from an edge, the button over the quiet part. |
| Footer | `wordmark(mark, { assemble: 'scroll', look: { hover: 'none' } })` | The page trail draws over it; nothing else moves in the footer. |

Brand colour as the ground: give the section the brand background and draw in white or a light tint of it (`ink: '#fff'` or a token); on a white section draw in the brand token. Check contrast of the HTML over the busiest frame of the morph.

## 10. Checklist before you finish

- [ ] Every field has a job from section 1; hiding it loses feedback, or it is the page's one ground.
- [ ] Ink comes from tokens in both themes; colour appears only for outcomes or a requested palette.
- [ ] Text over a field has `clear` plus the veil; 4.5:1 for body, 3:1 for display, at the busiest frame, light and dark.
- [ ] Cell size matches the surface; nothing under 6px on a 390px-wide phone.
- [ ] Every host carries its radius from tokens; nothing draws past a corner or container edge at 200% zoom.
- [ ] Interface motion ≤ 280ms, decorative ≤ 800ms, on the house ease-out; reduced motion shows settled stills.
- [ ] No more than about 12 fields per page; first-viewport fields have posters per theme; everything else is lazy.
- [ ] Canvases are `aria-hidden` unless labelled content; real text is in the DOM; status reaches a live region.
- [ ] Every handle is destroyed on unmount, and the page still works with WebGL off.
