# Print and illustration (4.9)

Six local Canvas renderers live in the optional `asciify-engine/studio` entry. They do not change the default ASCII style or add a server/provider. They share source grading, curves, warps, masks, hover, still-image motion, finishing, saved settings, single-image export and layered projects.

| Style ID | Mechanism | Useful controls |
| --- | --- | --- |
| `stipple` | Four spatially jittered dots per sample; tone changes their area | Coverage, weight, texture, seed |
| `engraving` | Parallel world-anchored cuts with tone-dependent width | Coverage, weight, angle, texture |
| `crosshatch` | Up to three crossing screens appear across the tonal range | Coverage, weight, angle, texture |
| `woodblock` | Five tone steps in broad carved bands with correlated irregular edges | Coverage, weight, angle, texture |
| `risograph` | Two overlapping ink-dot screens; source warmth separates coverage in source-color mode | Second ink, registration offset/direction, texture |
| `pointillism` | Four small elliptical pigment strokes per sample | Source color, weight, texture, seed |

`STUDIO_PRINT_STYLES` supplies `value`, `label`, and `description` for selectors. `isStudioPrintStyle(style)` identifies this family. The full `STUDIO_STYLES` catalog has 24 styles. Existing `riso` and `print` look IDs remain dither presets; choose `style: 'risograph'` to use the new two-screen renderer. These are print-inspired raster treatments, not physical ink simulation, CMYK separations or vector paths.

## Live still image

```ts
import { mountStudio } from 'asciify-engine/studio';

const player = await mountStudio(canvas, '/your-image.jpg', {
  settings: {
    style: 'engraving', cellSize: 7, colorMode: 'accent', ink: '#becbbe',
    print: { angle: -35, weight: 1.1, roughness: .3 },
    backdrop: { color: '#101810' },
    motion: { type: 'sheen', speed: .5, amount: .4 },
    hover: { effect: 'water', radius: .4, strength: .5 },
  },
  maxDimension: 960, maxCells: 12000,
  onError: console.error,
});
player.update({ print: { angle: 20 } }); // retains the other print settings
const settings = player.settings;       // detached snapshot for saving/export
// On unmount:
player.destroy();
```

For dark ink on paper, use `print.invert: true`, a dark `ink`, and a light `backdrop.color`. Inversion chooses which source tones receive ink; it does not change the ink or backdrop automatically. Dissolve reduces ink in either polarity. Trail still inverts the local tonal response. The motion engine retains its own `12 / speed` cycle; the print texture has no independent time source.

## Exact settings

`print` is an optional nested group in `StudioInput` and saved version-1 `StudioSettings`. Old files receive compatible defaults. Partial updates merge this group. `normalizeStudioPrint`, `DEFAULT_STUDIO_PRINT`, and `StudioPrintSettings` are exported from `/studio`.

| Field | Range / default | Meaning |
| --- | --- | --- |
| `density` | 0–2 / 1 | Tonal coverage; zero draws no print marks |
| `weight` | .25–2 / 1 | Dot/stroke size; size is bounded within the screen |
| `angle` | −180–180° / −35 | Line angle for engraving/crosshatch/woodblock; registration direction for risograph |
| `roughness` | 0–1 / .35 | Spatial texture variation; not random animation |
| `invert` | boolean / false | False draws highlights; true draws shadows |
| `secondaryInk` | six-digit hex / `#ec6752` | Second risograph ink only |
| `registration` | 0–1 / .2 | Risograph offset, up to .38 of one cell |
| `seed` | integer 0–65535 / 7 | Repeatable spatial texture |

All print styles use square sampling cells. `cellSize` accepts 1–60 in the reference frame; `studioGrid` still reports any effective budget limit. It is independent of `dither.scale`. Source color and gray modes remain available. Only Pointillism's source-color mode separates pigment hues; accent mode retains the chosen ink. Risograph mixes its two screens on transparent artwork with multiply, then composes that artwork over the chosen backdrop.

## Work and quality limits

Compiled screen directions and texture buffers are reused. No per-cell canvas, save/rotate/clip, or new simulation loop is created. A stable still caches the complete composition. Spatial texture uses a deterministic seed and bounded lookup; source tone changes can still change coverage. Woodblock intentionally has stepped tones. Do not label it smooth continuous shading.

Dense live print rendering costs more than the sample count alone: Pointillism draws four strokes per cell, Crosshatch up to three screens, and Woodblock emits carved polygons. Start with 12,000 cells, retain adaptive quality for motion, and measure the real device. High-resolution still exports can use a larger explicit budget. Keep the same reference pixel ratio/grid for preview and export.

The regression suite checks geometry, normalization, scaling, deterministic texture, composition caching and every hover/motion path. CPU geometry timings exclude actual Canvas drawing, decoding, GPU work and browser frame pacing. Visual output, browser export and mobile frame-rate acceptance are still unverified; do not claim competitor parity or guaranteed FPS from these tests.
