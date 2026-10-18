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

Nineteen hovers plus Off, in three families. All share `strength` (0–1), `radius` (0.1–1), `decay` (0–1, default .5: lower snaps back, higher lingers), `edgeSafe` and `scope` (below), in both `mountStudio` settings (`hover: {...}`) and `mountHover` options.

| Module `effect` | Family | Behavior | Good for |
| --- | --- | --- | --- |
| `trail` | Change characters | Density wake with a fading tail; glyph grid stays fixed. The signature Asciify hover. | Any portrait or hero; the default. |
| `dissolve` | Change characters | Erases a soft path through the characters; the image reforms. | Quiet editorial pages. |
| `contour` | Change characters | Fine tonal rings trace the path. | Line-art and print looks. |
| `etch` | Change characters | Signed light-and-shadow impression (“Emboss”). | Engraving, paper. |
| `ripple` | Change characters | Expanding signed tonal wave packets; faster strokes ring stronger. | Dot, LED and tile looks. |
| `bleed` | Change characters | Ink bleed: ink wells up where the cursor rests, spreads along a fibrous paper grain, then dries back from its edges. | Sumi, woodcut, stipple, pen and ink. |
| `water` | Move the image | Damped height-field refraction that settles after the stroke. | Frosted glass, water, calm heroes. |
| `silk` | Move the image | Directional folds that follow the hand. | Fabric, fashion, slow motion. |
| `vortex` | Move the image | A swirling wake. | Playful, music. |
| `magnetic` | Move the image | The image gathers toward the stroke, then relaxes. | Product details. |
| `scatter` | Move the image | Characters scatter in soft low-frequency drifts and spring back with one rebound. | Playful campaigns. |
| `elastic` | Move the image | Pushes with the stroke, recoils past rest once, settles in about a second. | Toys, mascots. |
| `lens` | Move the image | Lens wake: a magnifying wake along the stroke. | Detail-rich photos. |
| `smudge` | Move the image | Drags the image along the stroke, no bounce. | Painterly looks. |
| `loupe` | Follow the cursor | A flat-topped glass loupe rides a slightly springy follow, magnifies what it covers and compresses through a soft rim with a faint glint. Shrinks a little while moving fast, settles when you stop. | Products, cut-outs, halo overlays. |
| `reveal` | Follow the cursor | A soft spotlight shows the original photograph through the thinned characters (Studio). On `/hover`, which has no photograph, it lights the characters instead. | Editorial, cinema, cut-outs (`scope: 'subject'`). |
| `repel` | Follow the cursor | Characters part around the cursor into a packed ring, leaving a soft clearing; on leave they spring back with one soft rebound. | Stickers, tiles, mosaics. |
| `tilt` | Follow the cursor | The image leans toward the cursor like a parallax card; bright areas sit nearer and move more (depth from smoothed brightness). | Album covers, posters, lock screens. |
| `haze` | Follow the cursor | Heat haze: a rising shimmer bends the characters above the cursor, livelier while moving, calm at rest. | Neon, broadcast, dusk gradients. |
| `none` | | No hover effect. | |

Retired: `rake` (its combed strips tore the image) now plays `silk`. Saved settings and old integrations keep working; `DEPRECATED_STUDIO_HOVERS` lists the mapping. Cursor hovers (`loupe`, `reveal`, `repel`, `tilt`, `haze`) store a fraction of the artwork, so they scale with it; stroke hovers keep their CSS-pixel reach.

These are `/hover` module `effect` IDs, not the root engine’s legacy `HoverEffect` values. For example, passing `hoverEffect: 'water'` to the published engine is invalid.

## Scope: on the subject, or around it

`scope: 'all' | 'subject' | 'outside'` (default `'all'`; labels in `HOVER_SCOPES`: Everywhere, Subject, Around) decides where a hover acts.

```ts
await mountStudio(canvas, '/product-on-black.jpg', {
  settings: { style: 'mixed', backdrop: { mode: 'transparent' }, hover: { effect: 'reveal', scope: 'subject' } },
});
mountHover(host, canvas, { effect: 'trail', scope: 'outside' }); // a wake around a cut-out, never across it
```

How the subject is found, in order:
1. **Source alpha.** A transparent PNG, WebM or canvas: coverage is its alpha.
2. **A drawn Studio mask** (`mask.enabled`): the mask is the subject (inverted masks invert it), multiplied with alpha.
3. **A plain ground.** An opaque image whose border is one even tone (a product or figure on black or white, as the Cutout, Halo overlay and Mascot sticker looks expect) is keyed by each area's distance from that tone.
4. **Otherwise** (a busy edge-to-edge photo) there is no reliable subject, so every scope behaves like `'all'` rather than guessing.

Coverage is feathered over about 2% of the short side, so a scoped hover fades softly at the boundary and never clips hard. Displacement, tone and light are all weighted by it. With `'outside'` on a transparent ground, tone hovers (Trail, Contour, Emboss, Ripple, Ink bleed, Heat haze) draw their own marks in the ink colour on the empty ground. In `/hover` the subject is read from the drawn canvas once per still (`invalidate()` rereads it); for video the first frame's subject is kept.

## Smart behaviour

- Cursor hovers ease in on entry (no overshoot), start under the pointer instead of sliding in from the last exit, settle when the pointer rests and decay after it leaves; Repel releases with one soft rebound.
- Touch: `mountHover` follows a finger while it drags (`touch: false` turns this off) and lets go when it lifts; a vertical swipe still scrolls the page. `mountStudio` follows touch drags on its canvas.
- Reduced motion turns hovers off; hidden or offscreen surfaces stop drawing; a resting loupe stays drawn without redrawing every frame.

## Still-image motion and dither

Still-image motion reads the photograph itself (its soft luminance, a relief normal, highlight nearness, local detail and an estimated depth, rebuilt per source frame) so light and movement are motivated by the image instead of laid over it. The `motion` IDs:

| ID | Label | Group | What moves | Grid |
|---|---|---|---|---|
| `relight` | Relight | Light | A key light circles the subject and models its own relief; flat areas stay put. | anchored |
| `sheen` | Specular sweep | Light | One slow pass of light across the upper midtones and highlights, bent by their form, then a rest. | anchored |
| `glow` | Highlight bloom | Light | The brightest areas breathe a halo outward; deep shadows stay deep. | anchored |
| `shimmer` | Glints | Light | Sparse, phased glints only on bright fine detail (water, metal, eyes). | anchored |
| `parallax` | Parallax | Depth | Slow camera drift; near and far move against each other. | resampled |
| `push` | Slow push | Depth | Ken Burns push toward the subject's center and back; nearer areas move slightly more. Never samples outside the frame. | resampled |
| `focus` | Focus pull | Depth | Focus racks from subject to background and back; out-of-focus areas flatten toward their neighbourhood. | anchored |
| `mist` | Mist | Atmosphere | Soft mist drifts through the distance and plain areas only. | anchored |
| `current` | Drift | Atmosphere | Cinemagraph flow in smooth, distant areas; the detailed subject holds. | resampled |
| `develop` | Develop | Reveal | Holds, fades, then develops back in from highlights to shadows. | anchored |

"Anchored" motions change light only. "Resampled" motions move the image through a fixed character grid, so every glyph stays aligned and readable. Light motions mostly brighten the ink and change character density for only part of the shift, so light glows instead of flickering. Every motion except Relight, Glints and Mist shows the untouched still at time 0, which is what reduced motion and a paused preview display. Retired IDs still load as their closest replacement (`DEPRECATED_STUDIO_MOTIONS`): `caustics` → `sheen`, `grain` → `shimmer`, `trace` → `relight`, `tidal`/`weave`/`breeze` → `current`, `reform`/`print`/`unfold` → `develop`. Keep source-video motion alone unless the user intentionally wants another animation layered onto it. For a still, select one motion and a restrained `motionSpeed`, rather than stacking effects.

For the website's fine-dither treatment, use the module's `fineDither: true` and `ditherStrength` after matching the backing canvas's character settings. This is separate from the core renderer’s built-in dither behavior. Check a still and a moving scene for flicker before choosing the default.

The module observes reduced motion and visibility. Coordinate explicit pause with the underlying media; destroy both on unmount. Verify performance on the actual target device, especially with full-screen dense color video.

## Updates and cleanup

`surface.update({ effect: 'water' })` replaces the effect and clears the previous wake. `surface.invalidate()` uploads a newly drawn still. `surface.canvas` is the visible overlay, useful for layering or snapshots; the supplied canvas remains the source. `surface.destroy()` removes the overlay, listeners and observers and restores the source visibility. Stop the source renderer separately. Reduced motion disables hover and ambient motion; offscreen and hidden surfaces stop scheduling frames. Canvas 2D fallback preserves artwork when WebGL is unavailable, with simpler spatial refraction.

When using the low-level object-frame API, pass `getFrame: () => currentFrame` to preserve exact glyph identities and colors. With canvas-only integrations the module estimates density from sampled ink coverage.


## Hero finish

Version 1.3.0 adds text-shaped charcoal cutouts (`textMask`), peripheral scanline/fringe control (`edgeEffect`), fixed accent ink, Prism edge softness (`edgeSoftness`), and fixed-grid fluid Trail. These additions ship in **npm 1.3.0**. Upgrade older applications before using them. See the [complete API, layering example, lifecycle, and fallback limits](hero-finish.md).

## Catalogs and useful combinations (4.4)

Build controls from `STUDIO_HOVERS`, `HOVER_SCOPES` and `STUDIO_MOTIONS`, exported by `/studio` and `/hover`. Each entry includes `value`, `label` and `description` (hovers also a `group`). Show the scope control as a segmented choice next to the hover settings. Use the `value` as the API ID; “Emboss” is `etch`, “Specular sweep” is `sheen` and “Drift” is `current`. Do not maintain a second hard-coded menu or use the legacy core hover IDs for these interactions.

For a fixed grid, try Relight with Emboss. For depth, try Parallax or Slow push with Tilt. For water and sky, try Drift with Ripple rings. These are combinations of two independent settings, not additional art styles. Keep strength restrained until you have checked the source at actual display size.

All ambient modes repeat after `12 / speed` seconds. Looping the motion does not guarantee that a source video, film grain, dust, glitch or animated dither has the same boundary. Exported PNG/JPEG captures one frame; MP4/WebM/GIF carries autonomous motion, not live pointer movement. For complete composition export, use `/studio` rather than capturing the hover overlay.

The pointer simulations have bounded storage. Elastic allocates its two velocity buffers only when first selected; idle effects stop. This is not a device-independent FPS promise. Test dense grids, fast reversal and the actual finish stack on the target device.

## Lively images

The catalogs contain nineteen active hover effects and ten active ambient motions, plus Off for each (see the table above). All use deterministic 12-second base cycles; `motion.speed` changes cycle duration, `motion.amount` (0–2) changes strength. These are local image treatments driven by the photo's own light and depth estimate, not AI-generated scene or subject motion; the depth estimate favours a subject found from alpha or a plain ground, then sharp, central, lower detail.

`STUDIO_ANIMATION_PRESETS` is exported by `/studio` and `/hover`. Its seven entries have `id`, `label`, `description`, `motion: {type,speed,amount}`, and `hover: {effect,radius,strength}`. These are editable combinations, not additional renderer styles. Do not overwrite the rest of a user's settings to apply one:

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

Every hover runs on one fixed field (128 cells on the long side) whatever the image size; cursor hovers are a few springs plus that field, and Ink bleed diffuses on it in fixed sub-steps. Measured in the Studio renderer at 640×480, 6px cells: 5–7ms per frame p50 for every hover, under 10ms p95. Ripple rings uses at most eight wave packets and a fixed-resolution field. It does not allocate particles per character. Lens and Smudge reuse the existing field; their release integrates elapsed time, not a fixed frame count. Zero strength suppresses hover input; completed wakes sleep. These bounds and tests are not a guaranteed frame rate on every device.

To export a loop of a photo, use duration `12 / speed`. Restrict the speed/duration to your encoder's limits and use a frame count that fits whole cycles. Film grain, dust, glitch, pattern animation and input videos may not loop at that boundary. Pointer paths are not included in offline export. Respect reduced motion and provide pause; do not advertise artificial depth as true scene reconstruction.
