# Optional studio surface effects

Use this only when the requested behavior should match the Asciify website's enhanced interactions or living-image treatments. It ships with `asciify-engine@1.2.0` and later as an optional entry point. Root and `/core` imports do not load its code.

Install `npm install asciify-engine`, then import from `asciify-engine/hover`. No extra package or file download is required. For a project without a bundler, the standalone ES module remains available at https://asciify.org/background-sources/studio-hover.js; save it locally and import `mountHover` from that file. Prefer npm for versioned updates and TypeScript types.

After the engine has rendered the source canvas:

```js
import { mountHover } from 'asciify-engine/hover';
const surface = mountHover(host, canvas, {
  effect: 'trail',
  strength: 0.55,
  radius: 0.2,
  animated: true, // false for a still; true for video or GIF
  fps: 24,
  fontSize: 7,
  charAspect: 0.58,
  charset: ' .:-=+*#%@',
});
// After replacing a still: surface.invalidate();
// Pause surface updates together with the backing video:
// surface.update({ paused: true });
// On unmount: surface.destroy(); then stop the engine renderer.
```

Keep engine `options.hoverStrength: 0` and `animationStyle: 'none'`. Pass the same charset, font size, aspect, charSpacing, dots mode, and custom text used to draw the backing canvas. `animated: true` refreshes the rendered source; it does not play the video itself.

The positioned host must fit the displayed source canvas. The surface appends a visible overlay canvas and keeps the source for sampling. If using the layered hero, assign the overlay the same artwork stacking level as the source. Do not put the description or links inside a lower stacking context. When a `cover` canvas extends beyond its host, crop it with `overflow: hidden` and check pointer alignment at both edges.

## Hover choices

| Module `effect` | Behavior |
| --- | --- |
| `trail` | Density wake with a fading tail; glyph grid remains fixed. |
| `water` | Local refraction; opt into protected boundaries with `edgeSafe: true`. |
| `contour` | Expanding ring echoes along the pointer path. |
| `dissolve` | Fading/reforming density trace with a lingering tail. |
| `silk` | Directional folds following the stroke. |
| `vortex` | Local rotational wake. |
| `magnetic` | Attracts the field toward a stroke, then relaxes. |
| `scatter` | Spatially varied radial scatter with a decaying wake. |
| `etch` | Signed light-and-shadow impression; the glyph grid stays fixed. |
| `elastic` | Directional momentum, damped recoil and a return to rest. |
| `rake` | Alternating strips shear with the pointer, then align again. |
| `lens` | Smooth local magnification, relaxing when the pointer stops. |
| `smudge` | Directional source drag with a non-oscillating release. |
| `ripple` | Expanding signed tonal wave packets; speed-sensitive and fixed-grid. |
| `none` | No hover effect. |

These are `/hover` module `effect` IDs, not the root engine’s legacy `HoverEffect` values. For example, passing `hoverEffect: 'water'` to the published engine is invalid.

## Still-image motion and dither

The module's `motion` IDs are `none`, `caustics` (traveling light on a fixed grid), `current` (Slow Current), `reform` (Reveal & Reform), `sheen` (diagonal light sweep), `tidal` (Tidal Rings), and `grain` (Living Grain). 4.4 adds `parallax` (shallow drift), `weave` (interlaced flow), `print` (staggered row registration), and `trace` (light that follows source-image tonal contours). Sheen, Living Grain and Contour Light keep the grid anchored. Contour Light uses source luminance; pass `getFrame` for exact source tones when layering a surface over an existing canvas. Keep source-video motion alone unless the user intentionally wants another animation layered onto it. For a still, select one motion and a restrained `motionSpeed`, rather than stacking effects.

For the website's fine-dither treatment, use the module's `fineDither: true` and `ditherStrength` after matching the backing canvas's character settings. This is separate from the core renderer’s built-in dither behavior. Check a still and a moving scene for flicker before choosing the default.

The module observes reduced motion and visibility. Coordinate explicit pause with the underlying media; destroy both on unmount. Verify performance on the actual target device, especially with full-screen dense color video.

## Updates and cleanup

`surface.update({ effect: 'water' })` replaces the effect and clears the previous wake. `surface.invalidate()` uploads a newly drawn still. `surface.canvas` is the visible overlay, useful for layering or snapshots; the supplied canvas remains the source. `surface.destroy()` removes the overlay, listeners and observers and restores the source visibility. Stop the source renderer separately. Reduced motion disables hover and ambient motion; offscreen and hidden surfaces stop scheduling frames. Canvas 2D fallback preserves artwork when WebGL is unavailable, with simpler spatial refraction.

When using the low-level object-frame API, pass `getFrame: () => currentFrame` to preserve exact glyph identities and colors. With canvas-only integrations the module estimates density from sampled ink coverage.


## Hero finish

Version 1.3.0 adds text-shaped charcoal cutouts (`textMask`), peripheral scanline/fringe control (`edgeEffect`), fixed accent ink, Prism edge softness (`edgeSoftness`), and fixed-grid fluid Trail. These additions ship in **npm 1.3.0**. Upgrade older applications before using them. See the [complete API, layering example, lifecycle, and fallback limits](hero-finish.md).

## Catalogs and useful combinations (4.4)

Build controls from `STUDIO_HOVERS` and `STUDIO_MOTIONS`, exported by `/studio` and `/hover`. Each entry includes `value`, `label`, `group`, and `description`. Use the `value` as the API ID; “Emboss” is `etch` and “Contour Light” is `trace`. Do not maintain a second hard-coded menu or use the legacy core hover IDs for these interactions.

For a fixed grid, try Contour Light with Emboss. For continuous spatial movement, try Parallax with Elastic. For a fabric-like treatment, try Woven Flow with Rake. These are combinations of two independent settings, not additional art styles. Keep strength restrained until you have checked the source at actual display size.

All ambient modes repeat after `12 / speed` seconds. Looping the motion does not guarantee that a source video, film grain, dust, glitch or animated dither has the same boundary. Exported PNG/JPEG captures one frame; MP4/WebM/GIF carries autonomous motion, not live pointer movement. For complete composition export, use `/studio` rather than capturing the hover overlay.

The pointer simulations have bounded storage. Elastic allocates its two velocity buffers only when first selected; idle effects stop. This is not a device-independent FPS promise. Test dense grids, fast reversal and the actual finish stack on the target device.

## Lively images (4.10)

The catalogs contain fourteen active hover effects and fourteen active ambient motions, plus Off for each. New motion IDs are `relight`, `shimmer`, `breeze`, and `unfold`. Relight models midtones with a rotating light field; Shimmer slowly animates source highlights. Both keep geometry stationary. Breeze bends the image with a traveling sway. Unfold closes and opens staggered panels, then holds the complete image. All use deterministic 12-second base cycles; `motion.speed` changes cycle duration, `motion.amount` changes strength. These are local image treatments, not AI-generated scene or subject motion.

`STUDIO_ANIMATION_PRESETS` is exported by `/studio` and `/hover`. Its six entries have `id`, `label`, `description`, `motion: {type,speed,amount}`, and `hover: {effect,radius,strength}`. These are editable combinations, not additional renderer styles. Do not overwrite the rest of a user's settings to apply one:

```ts
import { mountStudio, STUDIO_ANIMATION_PRESETS } from 'asciify-engine/studio';
const preset = STUDIO_ANIMATION_PRESETS.find(item => item.id === 'quiet-light')!;
const player = await mountStudio(canvas, '/photo.webp', {
  settings: { style: 'ascii', cellSize: 6, motion: preset.motion, hover: preset.hover },
  maxDimension: 960,
});
player.update({ motion: { amount: .6 }, hover: { radius: .55 } });
// Stop on unmount. Do not mount a second /hover instance on this canvas.
player.destroy();
```

For a complete integration with independent PNG/MP4 export, copy the repository's `examples/living-image.ts` and `examples/studio-composition.ts`. Keep their relative import together; these helpers are example application code, not npm exports. Saved Studio state stores the resolved settings, so later catalog edits do not change a saved look.

For `/hover`, the same catalog needs an explicit shape conversion: `surface.update({ motion: preset.motion.type, motionSpeed: preset.motion.speed, effect: preset.hover.effect, radius: preset.hover.radius, strength: preset.hover.strength })`. `/hover` has no `motion.amount` option; use Studio for independently adjustable motion strength. Do not spread the nested Studio groups directly into surface options.

Ripple rings uses at most eight wave packets and a fixed-resolution field. It does not allocate particles per character. Lens and Smudge reuse the existing field; their release integrates elapsed time, not a fixed frame count. Zero strength suppresses hover input; completed wakes sleep. These bounds and tests are not a guaranteed frame rate on every device.

To export a loop of a photo, use duration `12 / speed`. Restrict the speed/duration to your encoder's limits and use a frame count that fits whole cycles. Film grain, dust, glitch, pattern animation and input videos may not loop at that boundary. Pointer paths are not included in offline export. Respect reduced motion and provide pause; do not advertise artificial depth as true scene reconstruction.
