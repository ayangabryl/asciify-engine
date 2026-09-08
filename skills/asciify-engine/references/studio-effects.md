# Optional studio surface effects

Use this only when the requested behavior should match the Asciify website's enhanced interactions or living-image treatments. It is application code, separate from the npm engine. It is not required for ordinary ASCII conversion.

Download https://asciify.org/background-sources/studio-hover.js into the consuming app (for example, `src/vendor/studio-hover.js`). Keep a reviewed local copy with the project rather than relying on an unversioned runtime import. Source files are available alongside it at https://asciify.org/background-sources/studio-hover.ts.

After the engine has rendered the source canvas:

```js
import { mountStudioHover } from './vendor/studio-hover.js';
const surface = mountStudioHover(host, canvas, {
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

Keep engine `options.hoverStrength: 0` and `animationStyle: 'none'`. Pass the same charset, font size, aspect, dots mode, and custom text used to draw the backing canvas. `animated: true` refreshes the rendered source; it does not play the video itself.

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

These are module IDs, not npm `HoverEffect` values. For example, passing `hoverEffect: 'water'` to the published engine is invalid.

## Still-image motion and dither

The module's `motion` IDs are `none`, `print` (Living Print), `current` (Slow Current), and `reform` (Reveal & Reform). Keep source-video motion alone unless the user intentionally wants another animation layered onto it. For a still, select one motion and a restrained `motionSpeed`, rather than stacking effects.

For the website's fine-dither treatment, use the module's `fineDither: true` and `ditherStrength` after matching the backing canvas's character settings. This is separate from the published engine's built-in dither behavior. Check a still and a moving scene for flicker before choosing the default.

The module observes reduced motion and visibility. Coordinate explicit pause with the underlying media; destroy both on unmount. Verify performance on the actual target device, especially with full-screen dense color video.
