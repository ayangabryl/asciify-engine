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
| `water` | Local refraction with aligned outer boundaries. |
| `contour` | Expanding ring echoes along the pointer path. |
| `dissolve` | Fading/reforming density trace with a lingering tail. |
| `silk` | Directional folds following the stroke. |
| `vortex` | Local rotational wake. |
| `none` | No hover effect. |

These are `/hover` module `effect` IDs, not the root engine’s legacy `HoverEffect` values. For example, passing `hoverEffect: 'water'` to the published engine is invalid.

## Still-image motion and dither

The module's `motion` IDs are `none`, `caustics` (traveling light on a fixed grid), `current` (Slow Current), and `reform` (Reveal & Reform). Keep source-video motion alone unless the user intentionally wants another animation layered onto it. For a still, select one motion and a restrained `motionSpeed`, rather than stacking effects.

For the website's fine-dither treatment, use the module's `fineDither: true` and `ditherStrength` after matching the backing canvas's character settings. This is separate from the core renderer’s built-in dither behavior. Check a still and a moving scene for flicker before choosing the default.

The module observes reduced motion and visibility. Coordinate explicit pause with the underlying media; destroy both on unmount. Verify performance on the actual target device, especially with full-screen dense color video.

## Updates and cleanup

`surface.update({ effect: 'water' })` replaces the effect and clears the previous wake. `surface.invalidate()` uploads a newly drawn still. `surface.canvas` is the visible overlay, useful for layering or snapshots; the supplied canvas remains the source. `surface.destroy()` removes the overlay, listeners and observers and restores the source visibility. Stop the source renderer separately. Reduced motion disables hover and ambient motion; offscreen and hidden surfaces stop scheduling frames. Canvas 2D fallback preserves artwork when WebGL is unavailable, with simpler spatial refraction.

When using the low-level object-frame API, pass `getFrame: () => currentFrame` to preserve exact glyph identities and colors. With canvas-only integrations the module estimates density from sampled ink coverage.


## Hero finish

Version 1.3.0 adds text-shaped charcoal cutouts (`textMask`), peripheral scanline/fringe control (`edgeEffect`), fixed accent ink, Prism edge softness (`edgeSoftness`), and fixed-grid fluid Trail. These additions ship in **npm 1.3.0**. Upgrade older applications before using them. See the [complete API, layering example, lifecycle, and fallback limits](hero-finish.md).
