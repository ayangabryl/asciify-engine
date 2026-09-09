# Text cutouts, peripheral texture, and physical Trail

**Availability: asciify-engine 1.3.0+.** These additions ship in the optional `/hover` entry. Upgrade projects still using 1.2.0 before using these options. Existing media and hover APIs remain supported.

## Intended result

Keep the headline as accessible HTML. Gray ASCII crosses over it, but the character ink turns charcoal only inside the chosen text shapes. Transparent gaps reveal the yellow headline. A stationary peripheral finish adds small directional fringes and scanline breaks, while the middle remains clear. Trail has local momentum: strokes transport image detail through a fixed character grid, open dense areas, fill sparse ones, then return to the source.

This is a rendering treatment, not a background-color key. It does not change the media's colors or remove regions by color. It does not infer which yellow elements are text: explicitly pass the intended heading elements.

## Integration

Use a host fitted to the source canvas. Keep headline, artwork, and controls in the layer order described in [layered-hero.md](layered-hero.md). For the exact glyph path, pass the current object frame and matching character settings:

```js
import { DEFAULT_OPTIONS, imageToAsciiFrame, renderFrameToCanvas } from 'asciify-engine/core';
import { mountHover } from 'asciify-engine/hover';

const options = {
  ...DEFAULT_OPTIONS,
  charset: ' .:-=+*#%@',
  fontSize: 8, charAspect: 0.58,
  colorMode: 'accent', accentColor: '#888888',
  normalize: false, hoverStrength: 0, animationStyle: 'none',
};
let frame;
function draw(media) {
  frame = imageToAsciiFrame(media, options, width, height).frame;
  renderFrameToCanvas(canvas.getContext('2d'), frame, options, width, height, 0, null);
}
draw(image); // Use your loaded image; width/height are the canvas's CSS size.
const surface = mountHover(host, canvas, {
  getFrame: () => frame,
  effect: 'trail', strength: 0.55, radius: 0.45,
  fontSize: options.fontSize, charAspect: options.charAspect,
  charset: options.charset,
  colorMode: 'accent', accentColor: '#888888',
  textMask: host.querySelector('h1'),
  filter: 'prism', edgeEffect: 0.95, edgeSoftness: 0.35,
});
surface.canvas.style.zIndex = '1';
surface.canvas.setAttribute('aria-hidden', 'true');
// After drawing a different still: draw(nextImage); surface.invalidate();
// On cleanup: surface.destroy();
```

For live video, coordinate the source loop with `animated: true, fps: 30` (or the source frame rate) and update `frame` when decoding produces a new image. Keep pointer updates independent of the source frame rate. `paused` controls the surface; also pause the video element and its drawing loop.

## Controls

| Option | Default | Behavior |
| --- | --- | --- |
| `edgeSafe` | `false` | Opt in to fixed outer Trail rows and softened border displacement. Does not change Prism softness. |
| `radius` | `0.45` for Trail; `0.2` otherwise | Hover size from `0.1` to `1`. |
| `textMask` | unset | One HTML element or an array of elements. Darkens ASCII only over their text. `update({ textMask: undefined })` removes it. |
| `filter` | `prism` (inactive) | `clean`, `signal`, `prism`, or `etch`. Select a treatment independently of the hover effect. |
| `edgeEffect` | `0` without `filter`; `1` when a filter is selected | Intensity from 0 to 1 on the GPU ASCII glyph path with `getFrame`. `clean` always disables the finish. |
| `edgeSoftness` | `0` | Prism-only blur/fade at the perimeter, from 0 to 1. The center stays crisp. Ignored by Clean, Signal and Etch. |
| `colorMode` | `fullcolor` | Match source frame rendering: `fullcolor`, `grayscale`, `accent`, or `matrix`. |
| `accentColor` | `#888888` | Six-digit hex ink color for `colorMode: 'accent'`. |
| `effect` | `trail` | Trail transports cached source detail and remaps character density on a fixed grid. Other hover modes retain their own behavior. |

`createTextMask(host, elements, onChange)` is also exported for custom integrations. Its `read()` returns a cached `{ canvas, revision }`; `invalidate()` refreshes it and `destroy()` releases observers. This helper does not itself draw ASCII.

## Layering, layout, and limitations

- Use normal horizontal HTML headings/labels. The mask is a rasterized helper; the original HTML stays searchable, selectable, and accessible.
- Plain untransformed Latin text is the supported baseline. Rotated/transformed text, vertical writing, ligatures and complex-script shaping require a dedicated mask implementation. Do not silently promise exact glyph alignment for those cases.
- Fonts, text changes, and observed resizes invalidate the mask. After an external layout change that moves the heading without resizing it, call `surface.invalidate()`.
- Keep controls above the artwork at z-index 2 or 3. Do not include buttons in `textMask`. Avoid a positioned/filtered ancestor that traps the headline and CTA in one stacking context.
- The mask automatically keeps the direct glyph surface transparent between characters. Do not add a solid background to the overlay canvas.
- The peripheral finish is a GPU enhancement for the glyph path. Canvas fallback keeps text cutouts and fixed-grid source flow; it does not reproduce the full optical finish. Fine dither retains a coverage-based wake.

## Performance and motion

The text mask rebuilds on changes, not on every video frame. It uses a bounded canvas and one cached GPU texture. Peripheral samples stay inside the current glyph tile. Trail uses a fixed-size field and transports cached source metadata through it. The GPU interpolates four small metadata samples before choosing one glyph, replacing the previous four-glyph overlap pass. Glyph positions stay fixed; source sampling is bounded to 2.6% per axis. With `edgeSafe: true`, it eases to zero across the outer rows. There are no DOM particles or growing particle lists.

Reduced motion and paused state stop continuous interaction. The edge finish is stationary, with no random time-based flicker. Validate performance on the target device, viewport, source and maximum intended hover strength. A 30 fps video cannot contain 60 distinct source frames; independently updating hover is what keeps input responsive between decoded frames.


### Fluid character Trail (1.3.0+)

Pointer speed controls the impulse width and force. Visible density follows the moving velocity field, with a small deposited-density contribution; it is not simply a painted path. Fast sweeps open a wider clearing that rolls and dissipates after release, while slow sweeps stay restrained. Damping uses elapsed time and the solver advances on every display frame (with bounded substeps for long gaps), including 120 Hz. Each animation frame consumes up to six timestamped pointer samples so fast direction changes retain their path. This does not guarantee a particular FPS on every device. Reversal redirects the flow while older momentum continues. A stationary pointer adds no new force. The grid stays aligned: source detail moves through the cells and their selected glyphs change with the flow. A continuous tonal fold opens dense regions and gives sparse regions more marks. A small, stable per-cell variation breaks the tail into individual marks without random flicker or fading the whole stroke. It does not fade all characters into a translucent brush or add white ink.

Use `effect: 'trail', strength: 0.55, radius: 0.45`. No new option is required. The existing character ramp supplies the available glyphs; order custom character sets from sparse to dense when a tonal ramp is desired. Accent ink stays fixed; full-color input transports its existing colors. Transparent source regions remain transparent. A formerly empty cell may gain a glyph as density changes.

The GPU and Canvas paths share source transport and density mapping. Bilinear interpolation happens in cached metadata before glyph selection, so there is one glyph per destination cell. Outer rows are pinned and the result returns exactly to the resting source after the field settles. Source media conversion and font-atlas generation remain outside pointer-only redraws.

### Character finishes (1.3.0+)

- **Signal:** displaced scanline fragments toward the perimeter; monochrome ink and a sharp center.
- **Prism:** a soft red/cyan fringe around peripheral characters. The hero defaults to Prism at 95% with 35% edge softness. This deliberately introduces small color separations, even with gray base ink.
- **Etch:** fine diagonal linework cut into the ink. No color fringe.
- **Clean:** disables the optical treatment completely.

Use `surface.update({ filter: 'prism', edgeEffect: 0.95, edgeSoftness: 0.35 })`. `edgeSoftness: 0` keeps the sharper fringe; increasing it blends a short blur and gentle fade into the outer characters. It reuses the five Prism samples, and all lookups stay within the glyph tile's three-pixel padding. Modes are stationary: they do not add random flashing or whole-canvas blur. Clean/Etch use one atlas lookup; Signal uses at most two; Prism uses at most five, in the existing draw pass. The center remains unchanged. Canvas fallback, dots, emoji, and non-glyph paths do not reproduce these optical finishes; use Clean there.

The website exposes these in Hero → Customize → Finish and Playground → Effects → Character finish. Hero finish changes reuse converted media. Preview metadata is mapped to the surface API, not a new core conversion filter. PNG snapshots capture the visible finish; text/SVG exports remain character data and do not reproduce the GPU treatment. These features ship in npm 1.3.0.

### Frame pacing and mobile

The playground's old 60 Hz hover gate has been removed. Hover redraws follow requestAnimationFrame; decoded video frames retain their own source cadence. Auto performance estimates the display cadence and normalizes its capacity score, so rendering at 60 on a 120 Hz screen no longer counts as full capacity. Under pressure it trades preview detail for responsiveness. The hero retains its bounded glyph count, 1.5× maximum backing ratio, four-million-pixel cap, cached frame textures, and one in-flight media conversion.

Do not promise a 120 FPS minimum on every mobile device or arbitrary character count. A 60 Hz display cannot display 120 distinct refreshes; browser scheduling, device power/thermal state, GPU cost and decoding also constrain delivery. Validate high-refresh hardware separately from emulated mobile layout. Reduced motion and offscreen/hidden suspension remain in effect. Reference: https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame

### Hero character catalog

Hero → Customize → Characters uses the same 15 render-style tiles as the editor, with six primary styles and nine under More render styles. Custom letters are available under ASCII. Alternate styles use the published Studio renderer and share the hero's video; they are not aliases for old alphabets. Default ASCII retains its GPU hover and Prism finish. Selecting styles works while paused or with reduced motion.

The default Trail radius is now `0.45` in the hero, playground preset and optional engine mount. This widens the nominal fluid impulse by about 51% versus `0.2`, while preserving the same strength, bounded flow field. Pass `radius: 0.2` explicitly for the previous narrower reach. Other hover presets keep their existing sizes.

### Motion verification

Test slow sweeps, rapid reversal, stationary recovery and pointer exit. Confirm that destination cells remain aligned, source colors remain intact and the final image equals the resting frame. Profile with recording disabled: 60 FPS is a measured target, not a guarantee for every device or source size. Pause and reduced motion stop continuous interaction.


### Hover reach and optional edge protection (1.3.0+)

`mountHover(host, canvas, { effect: 'trail', radius: 0.45, edgeSafe: false })` lets the interaction reach the borders. `edgeSafe` defaults to **false**. Set it to `true` to preserve Trail's outer glyph rows and attenuate Water, Silk and Vortex displacement near the boundary. Source coordinates remain clamped with either setting; this option does not control Prism edge softness or change the fixed Trail glyph grid. Contour and Dissolve already keep glyph positions fixed.

`radius` is normalized from `0.1` (focused) to `1` (expansive). The hero starts at `0.45`; adjust **Customize → Hover → Hover size**. Edge protection is in the same tab. Characters and optical finishes have separate tabs, with state preserved between them. Reset restores size 45% and protection off. Preview hover demonstrates the current effect; it is disabled when motion is paused, reduced, or Off. In the playground these settings are under **Effects → Cursor response → Fine-tune cursor response**. The exported snippet includes the chosen `edgeSafe` value and the minimum package version.

Update a mounted engine instance with `hover.update({ radius: 0.7, edgeSafe: true })`. No media re-conversion is required. A larger radius still uses the same bounded simulation grid, although target-device profiling remains necessary.
