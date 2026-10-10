# Match the request, the user and the design

An Asciify integration is good when it looks like it was made for that page: the user's words decide the effect, the project's design decides the look, and the measured result decides the budget. Work through these steps before writing code.

## 1. Read the request

Note, in the user's own terms:

- **Subject.** What is drawn: their photo or video, a product shot, a logo or word, or no media at all (an ambient background).
- **Placement and role.** A hero, a section background behind text, a card or thumbnail, a loading state, a text banner, or an editor feature.
- **Mood words.** Calm, bold, retro, editorial, techy, playful, premium, minimal. Map them with the table in step 4.
- **Interaction.** Whether it should answer the cursor, move by itself, play a video, scroll-scrub, or stay still.
- **References.** "Like unseen.co", "like a terminal", "like a newspaper print". Name what you take from the reference (technique, density, palette) and what you keep from the user's brand.

Ask only for what you cannot infer, and ask once:

- The media, when the result depends on their photo or video and none is in the project.
- Whether motion is welcome, when the site has no motion at all and the request did not mention it.

Otherwise decide, and state your choices in one line ("phosphor ink from `--accent`, 12px cells, field with a fluid wake, still under reduced motion").

## 2. Read the project's design

Before choosing colors or sizes, open the project's source of truth:

- **Tokens.** CSS custom properties (`:root`, `[data-theme]`), the Tailwind theme, a `brand.json` or design-tokens file. Collect the page background, surface, text colors, the one accent, and the mono and display font stacks.
- **Theme.** Dark, light, or both (`prefers-color-scheme`, a theme attribute). If both exist, the art must work in both.
- **Motion language.** Existing durations, easing variables and `prefers-reduced-motion` handling. Asciify motion should sit inside it.
- **Density of the layout.** A sparse editorial page wants larger, quieter cells; a dense product UI wants the art contained in one place.
- **Components.** Reuse the project's poster, skeleton, error and button patterns around the canvas instead of inventing new ones.

Never introduce a new brand color, a black canvas on a light site, or a second accent. If the brand has no accent, use its text color for ink.

## 3. Pick the tool

| The user wants | Use | Notes |
| --- | --- | --- |
| A photo, video or GIF converted on their page, with optional hover | `asciify`, `asciifyVideo`, `asciifyGif` (+ `mountHover` from `/hover`) | Lightest path. Disable core hover and motion when `/hover` owns them. |
| A full-bleed hero or brand field that must feel smooth under the cursor, their name or word as the characters, an Unseen-style look | `mountGlyphField` from `/field` | WebGL2 on a GPU, 120 fps class. Glyph ramps only. Keep a poster and a fallback. See [glyph-field.md](glyph-field.md). |
| Art styles (halftone, dither, braille, print, mosaic, LED…), saved looks, backdrops, masks, effects, PNG/MP4/GIF export | `mountStudio` from `/studio` | Studio owns motion, hover and finish. Start from `studioLook(id)` when one of the 12 looks matches the mood. |
| Several media and text layers in one artwork | `mountStudioProject` from `/studio` | One loop and budget for up to eight layers. See [layered-projects.md](layered-projects.md). |
| An ambient animated background with no media (rain, stars, waves, aurora…) | A background template from asciify.org/backgrounds | Downloaded files, not npm exports. Or a `/field` generated scene (`flow`, `orb`) for a GPU field. |
| A text banner or lettering | `asciifyText` / `renderTextToCanvas` | Plain text output works anywhere; canvas for color. |
| Headline text visible through the art | Layered HTML, see [layered-hero.md](layered-hero.md) | Real text stays in the DOM. |

## 4. Turn mood words into settings

| Mood | Characters | Color | Size and density | Motion and hover |
| --- | --- | --- | --- | --- |
| Calm, premium, minimal | Round ramp `' .:*oO0@'` or `' .:-=+*'` | One ink from the brand, or source color with a soft `backdrop` 0.2–0.4 | 8–12px cells; vignette 0.2–0.4 | Field `hover: 'lantern'` or studio Trail; slow drift (0.1–0.3) or none |
| Bold, poster, loud | Dense ramp `' .:-=+*#%@'`, blocks | High contrast (1.2–1.5), brand ink on page background | 12–20px cells | Field `hover: 'fluid'` with `glow` 0.7–0.9, or studio Ripple / Elastic |
| Retro terminal, hacker | Mono ramp, `technical` set | `matrix` (core) or `terminal` look (studio), or the brand accent as phosphor | 7–10px | Scanlines, CRT, character bloom (studio effects); Trail |
| Editorial, print, craft | Print styles: engraving, crosshatch, woodblock, risograph, stipple | Dark ink on the paper color; two inks for risograph | Fine (4–6px marks) | Little or no motion; Print shift at most |
| Techy, data, futuristic | Braille, blocks, dots, LED, hex | Source color with saturation 1.1–1.3, or a cool brand ink | 5–9px | Silk, Contour, Lens; field with `orb` or `flow` |
| Playful | Emoji or custom glyphs, mosaic, bricks, voxels | Source color | 9–14px | Elastic, Scatter, Ripple rings |
| Brand, identity, "our name in the art" | The brand word after a quiet ramp: `' .,:-+' + WORD` | One ink (`color: 'ink'`, `shade: 1`) so density and brightness carry the image | 10–14px; `cellAspect` 0.75–0.85 for display fonts | Field `hover: 'fluid'` (Unseen-like) or `'lantern'` (quieter); video or generated scene underneath |
| Behind body text | Light ramp, no dense glyphs | Ink at low contrast against the background; opacity 0.15–0.35 | 10–14px | Ambient only, or none; never strong refraction behind reading text |

Hover choice by intent:

- **Bold, liquid, "like unseen.co":** field `hover: 'fluid'`. The pointer stirs an incompressible fluid that bends the image and lights the characters in eddies. Use it on heroes and brand fields, not behind reading text.
- **Pure characters, the classic Asciify feel:** Trail. In the wake the characters fold their tone, sparse marks fill in and dense marks open up, then they settle; nothing bends. On `/field` use `hover: 'trail'` with `backdrop: 0` (GPU, 120 fps class); in `/studio` or `/hover` use `hover: { effect: 'trail' }` with a solid backdrop in the page color and `effects.characterBloom: 0`. Both run the same ink field with the same `strength` and `radius`, so the canvas renderer is a faithful fallback.
- **Subtle but premium, no watery distortion:** field `hover: 'lantern'`. A soft light glides after the pointer and lifts the characters it passes, with a short fading tail. Good near text, on product imagery and on calm brands.
- **Canvas pipelines (`/hover`, `/studio`):** Trail or Dissolve keep the image still; Water and Ripple are liquid; Magnetic and Scatter are playful; Lens magnifies detail.
- **Off:** when the art sits behind body text, in dense UIs, or when the user asks for none.

## Living or still

A still photo can be made to feel alive, and many users want that. Others want it still. Decide from the user's words first, then the content and the context, and say which you chose.

**Make it live** when the user says alive, moving, dynamic, ambient or "like a video", and when the art is the subject: heroes, portfolios, brand moments, campaign pages, empty states.

**Keep it still** when the user says static, still, no animation or "just the effect"; when the art sits behind body text, forms or pricing; in product grids, dashboards and data views; for editorial and print looks; for exports, email and social images; on pages with many instances; and on low-power targets. Reduced motion always gets a still, whatever was chosen.

**The middle ground** is still until touched: no autonomous motion, only a hover. Lantern is the calmest version of this.

| API | Living | Still |
| --- | --- | --- |
| `/field` | `drift: 0.15–0.35` so a photo breathes; or a video `source`; or `scene: 'flow' \| 'orb'` with no media | A media `source`, `drift: 0`, and `hover: 'lantern'` or `'none'`. With no pointer it draws once and stops working |
| `/studio` | `motion: { type: 'sheen' \| 'breeze' \| 'relight' \| 'shimmer', speed: 0.4–0.8, amount: 0.3–0.6 }` for calm life; `'current'`, `'tidal'`, `'caustics'` for stronger; or a `STUDIO_ANIMATION_PRESETS` entry such as `quiet-light` | `motion: { type: 'none' }`, and `hover.effect: 'none'` or a stationary one such as `'trail'` |
| `/hover` over a core render | `motion: 'sheen'` (any `AmbientMotion`) | `motion: 'none'`; core `animationStyle: 'none'` |

Autonomous motion that lasts longer than five seconds needs a visible pause control (WCAG 2.2.2). Prefer slow speeds; motion should be noticed on the second look, not the first.

## 5. Derive concrete values from the tokens

- **Ink.** One-ink looks use the accent token. Photo looks keep source color unless the brand is strictly monochrome.
- **Ground.** Use the page background token exactly, or a transparent canvas over it. On light themes draw dark ink on the light ground: core `invert: true` or `'auto'`, field `background: <page color>` with a dark `ink` and `invert: true`, studio dark `ink` with a light `backdrop.color`.
- **Backdrop.** `backdrop` puts a blurred copy of the source under the characters. It enriches a photo but reads as a pale photographic wash on light subjects. Leave it at 0 when the user wants pure ASCII, and never use it behind text.
- **Wake color.** Keep the field's default `highlight: 'auto'`, which brightens each character's own color. Only set a hex highlight when the brand asks for a second color; never default to white on a colored artwork.
- **Fonts.** Use the project's mono stack for ramps and its display face for words (`font`, `fontWeight`).
- **Size.** Start from the role in step 4, then check the narrowest supported viewport. Cells under 6px on phones turn to texture.
- **Contrast.** Text over art needs 4.5:1 at its busiest frame. Reach it with the scrim of the page background, lower opacity, vignette or `shade`, not by dimming the text.
- **Motion.** Match the project's easing and duration tokens for any UI around the canvas. Respect `prefers-reduced-motion`: stills or posters, no autonomous drift.

## 6. Recipes

Each recipe states the request it answers. Replace token values with the project's.

**"Make our hero feel alive like unseen.co, with our name in it."**

```ts
import { isGlyphFieldSupported, mountGlyphField } from 'asciify-engine/field';
const css = getComputedStyle(document.documentElement);
if (isGlyphFieldSupported()) {
  const field = mountGlyphField(heroCanvas, {
    source: '/media/hero-loop.mp4',                 // their footage; omit for a generated scene
    charset: ' .,:-+' + 'NORTHWIND',
    font: css.getPropertyValue('--font-display') || 'Inter, sans-serif',
    cellSize: 12, cellAspect: 0.8,
    color: 'ink', ink: css.getPropertyValue('--accent').trim(), shade: 1,
    vignette: 0.35,
    fluid: { radius: 0.08, refraction: 0.03, glow: 0.6 },
    interactionTarget: heroSection,
    label: 'Northwind, drawn in characters',
  });
  await field.ready;                                 // then hide the poster
}
```

**"Turn our product photo into ASCII that reacts to the mouse, keep its colors."**

```ts
const field = mountGlyphField(canvas, {
  source: '/img/product.jpg',
  charset: ' .:*oO0@', font: css.getPropertyValue('--font-mono'),
  cellSize: 8, cellAspect: 0.6,
  color: 'source', backdrop: 0.35, saturation: 1.2, contrast: 1.2,
  fluid: { radius: 0.085, refraction: 0.035, glow: 0.6 },
});
```

For a quieter product page, add `hover: 'lantern'` (a soft light, no distortion) and keep `drift: 0` so the photo stays still until touched. Use `/studio` instead when they also want halftone, dither or an export button.

**"A subtle animated background behind our pricing section."** Download a template (for example Aurora or Silk) from asciify.org/backgrounds and mount it with the page's colors, low opacity and the cursor off:

```js
import { asciiBackground } from './aurora.js';
const { destroy } = asciiBackground('#pricing', { colorScheme: 'auto', color: tokens.textMuted, opacity: 0.2, fontSize: 12, speed: 0.6 });
```

**"Retro terminal look for our launch video."**

```ts
import { mountStudio, studioLook } from 'asciify-engine/studio';
const player = await mountStudio(canvas, '/launch.mp4', { settings: { ...studioLook('terminal'), ink: tokens.accent }, maxCells: 20000 });
```

**"An editorial, printed feel for the about page portrait."**

```ts
const player = await mountStudio(canvas, '/portrait.jpg', {
  settings: { style: 'engraving', colorMode: 'accent', ink: tokens.text, backdrop: { mode: 'solid', color: tokens.paper }, print: { density: 1, weight: 1, invert: true } },
});
```

**"Our logo word as big ASCII text in the footer."**

```ts
import { asciifyText, renderTextToCanvas } from 'asciify-engine';
footerPre.textContent = asciifyText('NORTHWIND', { char: '#', scale: 2 });   // plain text, copyable
// or, in color: renderTextToCanvas(canvas, 'NORTHWIND', { char: '█', scale: 2, color: tokens.accent });
```

**"Same hero, but our site is light."**

```ts
mountGlyphField(canvas, {
  source: '/img/hero.jpg', background: tokens.paper, color: 'ink', ink: tokens.text, invert: true, shade: 0.8,
  charset: ' .:-=+*#', cellSize: 10, cellAspect: 0.6,
});
```

## 7. Verify against the request

- Show the user what each mood word became, in one line, and offer one alternative (for example "denser" or "calmer") instead of a menu.
- Check the busiest frame for text contrast, the narrowest viewport, a light theme if the site has one, reduced motion, and the fallback path (no WebGL2 or software rendering for `/field`).
- Measure smoothness on the target device while moving the pointer, and report the device and settings with any number.
- Clean up on unmount and confirm nothing keeps drawing off screen.
