# Optional Studio composition API

Use `asciify-engine/studio` (introduced in 1.4.0) when the task needs saved looks, alternate render styles, crop/masks, backdrops, or deterministic video export. Keep `/core` and `/hover` for existing ASCII integrations and layered interactive heroes; those defaults and entry points are unchanged. Studio settings are a separate schema, not `AsciiOptions`.

## Mount, update, destroy

```ts
import { mountStudio, studioLook } from 'asciify-engine/studio';

const abort = new AbortController();
const studio = await mountStudio(canvas, '/media/your-video.mp4', {
  settings: studioLook('wallpaper'),
  maxDimension: 960,
  maxCells: 12000,
  signal: abort.signal,
  onError: error => console.error(error),
});

// Updates merge nested option groups. Arrays replace their previous contents.
studio.update({ backdrop: { mode: 'blurred', opacity: 0.45 } });
studio.update({ hover: { effect: 'water', radius: 0.35 } });
studio.pause(true);
await studio.seek(1.5);
// Cleanup when the view unmounts:
studio.destroy();
```

Keep complete settings in application state. Apply edits with `updateStudioSettings(settings, patch)` and pass that state to `studio.update`; from 4.6 the mounted instance also exposes a detached `settings` snapshot. Serialize that snapshot or your application state when saving a look.

In React, create the AbortController inside the effect. On cleanup, abort and destroy the returned instance; if setup resolves after disposal, immediately destroy that instance. Do not remount for slider changes: call `update`. The mount owns its loaded media. `mountStudioMedia` takes ownership of an already loaded `StudioMedia`. Use an independent media instance for export.

Sources are local `File` objects or permitted image/video/GIF URLs. Remote servers must permit canvas CORS access. No media is uploaded by this API. A YouTube page or iframe is not a pixel source. HEIC browser decoding is not universal; convert it to PNG/JPG before this optional API.

## Settings and looks

Start with `normalizeStudioSettings({ ... })`, `DEFAULT_STUDIO_SETTINGS`, or `studioLook(id)`. Enumerate `STUDIO_STYLES`, `DITHER_ALGORITHMS`, `STUDIO_PALETTES`, `STUDIO_LOOKS`, and `STUDIO_TEXT_FONTS` rather than guessing IDs. Partial mounts and `update` accept `StudioInput`; complete state is `StudioSettings`.

- `style`: ASCII and character shapes, dots, pixel, mosaic, LEGO-like studded cells (`lego`), isometric tiles (`voxel`), faceted tiles (`disco`), or `dither`. These are canvas treatments, not editable 3D scenes.
- `charset`, `cellSize`, `colorMode` (`accent`, `source`, `gray`), `ink`: rendering choices. Character density is bounded by the working-size and cell budgets.
- `aspectRatio`: `original`, `16:9`, `9:16`, `1:1`, `4:3`, `3:4`, `21:9`. `studioDimensions` resolves dimensions from the source and rotation.
- `crop`: normalized `x`/`y` anchor, `zoom` 1–5, rotation in 90-degree steps. Cover framing fills the output.
- `backdrop`: `solid`, `transparent`, `source`, `blurred`, or `gradient`; `color`, `color2`, `opacity`, `blur`. A wallpaper look is an opt-in composition, not an operating-system wallpaper installer.
- `color`: brightness, contrast, saturation, grayscale, tint amount/color and blend mode. From 4.5, input black/white points, gamma, shadows and highlights are also available. Tint and lights retain the artwork alpha rather than filling empty glyph cells.
- `dither`: algorithm, palette/custom colors, amount, scale, threshold, pattern motion (`none`, `drift`, `shimmer`) and speed. Diffusion and ordered patterns differ; animated thresholds can shimmer intentionally.
- `mask`: enable/invert and a list of rectangle, ellipse, or brush shapes. Coordinates are normalized to the output canvas. Masks are bounded to 64 shapes and 2,048 total brush points. Masking affects the artwork; the backdrop remains visible.
- `lights`: at most four colored radial lights with normalized position, radius, and intensity. This is 2D illumination, not physically based material lighting.
- `effects`: independent character bloom and whole-composition bloom, prism, grain, dust, scanlines, CRT, vignette, glitch, pixelation, halftone, and Gaussian/directional/radial/progressive blur. Optical effects use an optional WebGL pass. Check `capabilities.gpuFinish` after an effect renders; unavailable GPU effects must not be described as applied.
- `hover`: Trail, Water, Contour, Dissolve, Silk, Vortex, Magnetic Pull, Scatter, or none; strength, normalized radius, optional `edgeSafe`. Hover is live interaction; it is not recorded into offline exports.

`serializeStudioSettings` and `parseStudioSettings` round-trip validated, versioned state. Media URLs/files are excluded. Unknown fields are discarded, values are bounded, future schema versions and oversized imports are rejected. Share source files separately. `restyleStudio` chooses another curated look while preserving crop, ratio, and mask.

## Export the same composition

Exports render explicit frames with encoder backpressure, using a separate renderer. This avoids dropped frames from screen recording and leaves the live preview alone.

```ts
import { loadStudioMedia, exportStudio } from 'asciify-engine/studio';

const cancellation = new AbortController();
const media = await loadStudioMedia(file, cancellation.signal);
try {
  const blob = await exportStudio({
    frame: async (time, signal) => {
      await media.seek(time, signal);
      return media.frame(time);
    },
  }, settings, {
    format: 'mp4', width: 1280, height: 720,
    referenceWidth: 640, // width of the preview: keeps the same cell density at 2×
    duration: 8, fps: 24,
    signal: cancellation.signal,
    onProgress: progress => console.log(progress),
  });
  // Download or otherwise use this Blob in your application.
} finally {
  media.destroy();
}
```

Formats: PNG, JPG (`jpeg`), GIF, MP4/H.264, WebM/VP9. MP4/WebM require a compatible WebCodecs encoder; errors describe unavailable encoding instead of silently changing formats. Choose even dimensions for MP4. Videos are silent. Pointer trails belong in the live integration; offline frames contain the source and chosen motion/effects. PNG retains alpha; opaque formats flatten it. GIF timing uses hundredths of a second, distributing rounding across frames.

Bounds: 4096 pixels per side and 16 megapixels for stills; video at most 3840×2160 pixels in total, 60 seconds, 60 fps; GIF at most 1280×720 pixels and 600 frames at up to 30 fps. Large exports take time and memory. Use MP4 for longer animation. Cancel with AbortController. `referenceWidth` preserves preview character density when increasing export dimensions; `maxCells` controls the render budget separately.

## Text

`createStudioText(text, font)` lazily loads the selected FIGlet font and returns `{ canvas, ascii }`. Copy `ascii` for plain text or use `canvas` as a source for visual treatments and animation. These are FIGlet letterforms, not a replacement for readable HTML headings or a promise that every imported browser font is supported. Font data and encoding libraries load only when used; they are outside `/core` and `/hover`.

## Performance and lower-level rendering

`createStudioRenderer(canvas, settings, limits)` exposes `render(source, time, width, height)`, `configure`, `pointer`, `leave`, `invalidate`, and `destroy` for applications owning their own loop. Call `invalidate` when a canvas source changes in place; source identity alone does not indicate new pixels. Use an increasing time in seconds; pointer timestamps are milliseconds.

`mountStudio` pauses when hidden/offscreen and respects reduced motion. Still scenes sleep when their interaction settles. Video sampling caches decoded frames independently of display-rate pointer animation. Adaptive preview reduces its cell budget when sustained render cost is high; disable with `adaptive: false` for fixed measurement. It does not change saved settings or the standard ASCII editor. Exports use their own explicit budget. Measure sustained behavior on real target devices; no renderer can guarantee 60 fps on every device with arbitrary effects and density.

## Curated characters and the primary editor (2.0)

The site opens the workspace directly at `/editor`. Upload media, choose Style, then use Canvas for framing/backdrops/masks, Effects for motion/hover/finishing, Looks for reuse, and Export for downloads/code. Optical finish and Lighting expand on demand; they keep applied values when collapsed. The prior editor remains at `/editor/classic` for earlier workflows.

```ts
import { STUDIO_CHARACTER_SETS, updateStudioSettings } from 'asciify-engine/studio';
settings = updateStudioSettings(settings, {
  style: 'ascii', charset: STUDIO_CHARACTER_SETS.asciify.chars,
});
player.update(settings);
```

Other renderer styles define their own marks, so character controls only apply to ASCII. Custom strings remain valid; Emoji, Musical and Starfield are no longer bundled presets.

## Size controls and still frames (2.0.1)

Use `studioGrid(width, height, settings, maxCells, pixelRatio)` to inspect `minimum`, `cell`, `columns`, `rows`, and `limited` at the actual preview resolution. ASCII/tile renderers use `cellSize`; Dither uses `dither.scale`. Respect the returned minimum in a size picker instead of offering a range that the performance budget silently clamps. Use the same budget and reference width for export to retain density.

For PNG/JPEG, pass `time: player.time` and `motionTime: player.motionTime` to `exportStudio` to save the selected frame. Default time is zero; animation exports start at zero. Snapshot the time/settings/preview size before asynchronous loading. The editor's Export tab separates Image and Animation, shows validated pixel sizes and keeps website code in an expandable section.

## Still-image motion (3.0)

Import `STUDIO_MOTIONS` from `/studio` to populate controls; each item has `value`, `label`, and `description`. Use `motion: { type: 'caustics' | 'current' | 'reform' | 'none', speed: 1 }`. Off is the default. Caustics preserves the grid, Current introduces fluid displacement, and Reform uses a staggered dissolve with a readable hold. Loops last 12 / speed seconds and preserve source/accent/gray color choice. Speed is 0.1–3. Do not combine source video with ambient motion unless requested. Hover remains independently configurable. Retired saved motion names normalize to Off. See [upgrading.md](upgrading.md) before moving an existing integration to 3.0.

## Sharp previews (3.0.1)

Studio defaults to a 6-unit cell size. Separate the sampling grid from canvas backing resolution: `instance.resize(width, height, pixelRatio)` updates the backing size and raster scale together without remounting media. Doubling dimensions and passing 2 keeps the same character count while drawing sharper glyphs. Use a bounded backing dimension and at most the device DPR; avoid stretching a small bitmap with CSS. `instance.pixelRatio` reports the scale. When exporting, pass `referenceWidth: canvas.width / instance.pixelRatio` to preserve logical density. Explicit saved cell sizes remain valid. Do not force a tile style's coarse cell size onto ASCII when changing render styles.


## Fine grids and sharp previews (4.0)

Start with `cellSize: 6`; the editor remembers each style's size. A Retina preview uses `resize(width, height, pixelRatio)` on a `mountStudioMedia` handle to keep logical cells independent of physical raster resolution. Its `setBudget(maxCells)` changes the upper sampling budget; automatic adaptation may reduce it when frames are slow. At a 960×540 logical canvas, 32,768 cells permit Lego size 4, and 65,536 permit dither scale 3. Keep ASCII at a measured budget such as 12,000 cells. Smaller requested cells cannot bypass the active budget; show `studioGrid`'s actual minimum in controls. Fine grids cost more, so profile hover and motion on target devices. Studio caches Lego stud artwork.

For menus shared with a media hero, import the eight `CHARACTER_SETS` from `asciify-engine/core`; `STUDIO_CHARACTER_SETS` is the identical catalog through `/studio`. A hero need not load the Studio runtime.


## Fine detail and controls (4.2)

- The style catalog adds `hex` (hexagonal tiles), `led` (circular emitters), and `cmyk` (offset cyan/magenta/yellow/black ink dots on white paper). CMYK derives channel coverage from the selected color mode and tonal hover/motion. These remain in the optional `/studio` entry; `/core` does not import them.
- Tile styles accept `cellSize: 1`; glyph styles retain a minimum of 3. Dither uses `dither.scale` from 1 to 12, independent of `cellSize`. Values are logical pixels in the reference frame, not device pixels.
- `studioGrid(width, height, settings, maxCells, pixelRatio)` reports the actual grid, `minimum`, and `limited`. Explain a limit in the UI rather than presenting a requested 1px value as an actual 1px grid.
- `maxCells` can be explicitly raised to 1,048,576. Defaults remain bounded. For a 960 × 540 reference, `maxCells: 1048576` allows one-pixel dithering. This is a detail option, not a promise of real-time performance at that density. Larger reference frames can still be limited.
- Mounts expose `setAdaptive(boolean)` and `setBudget(cells)`. The budget cannot exceed the mount's original `maxCells`. Adaptive mode can reduce the grid during animation/hover; disable it deliberately when exact density is more important. Static dither is cached until its source/settings/grid change.
- New dither algorithms: `vertical-lines`, `diagonal-lines`, `radial`. `lines` remains horizontal; `noise` remains deterministic white noise, not blue noise. New palettes: `gray4`, `gray8`, `rgb8`, `cyberpunk`, `pastel`.
- `dither.colorSpace` is `rgb` (nearest palette color) or `luminance` (nearest perceived brightness); default `rgb`. `dither.direction` is degrees from −180 to 180, with 0 toward positive X and 90 toward positive Y. It controls drift, with `motion: 'drift'` and `speed: 0.1–3`. Radial drift travels through concentric thresholds, so direction does not apply. Diffusion has no ordered matrix to translate; choose an ordered algorithm for drift.
- `effects.rgbSplit` and `effects.sharpen` are 0–1, default 0. RGB split is uniform channel separation; `prism` remains peripheral separation. Both need WebGL finishing. Do not silently claim unsupported effects were rendered.
- `motion.amount` is 0–2, default 1. It changes displacement/light/dissolve strength without changing phase or speed. Zero retains the stationary image. Enumerate `STUDIO_MOTIONS` for all supported motion types, including the 4.3 additions below.

```ts
const studio = await mountStudio(canvas, file, {
  width: 960, height: 540, maxDimension: 960,
  maxCells: 1048576, adaptive: false,
  settings: {
    style: 'dither',
    dither: { scale: 1, algorithm: 'bayer8', palette: 'gray4',
      colorSpace: 'luminance', motion: 'drift', direction: 90, speed: .5 },
    motion: { type: 'current', speed: .4, amount: .35 },
    effects: { sharpen: .15 },
  },
});
// Return to an interactive budget without remounting:
studio.setAdaptive(true);
studio.setBudget(65536);
```

When exporting, pass the same `maxCells` and logical `referenceWidth` as the preview to retain cell density. Increasing output resolution alone should not invent a different composition. Older projects normalize new fields to neutral defaults.


## Additional local interactions (4.3)

Studio and `asciify-engine/hover` support `magnetic` (gathers toward a stroke)
and `scatter` (radial, spatially varied scatter that relaxes). Both retain a
bounded field after cursor exit; radius and strength control the response.
Use `hover.effect` in Studio and `effect` in mountHover. Defaults remain unchanged.

Still-image motion now has six active choices: `caustics`, `current`, `reform`,
`sheen`, `tidal`, and `grain`, plus `none`. Sheen and Living Grain change tone
without displacement; Tidal Rings moves the image with protected edges.
Set Studio `motion: { type: 'sheen', speed: 0.7, amount: 0.6 }`.
Core uses `animationStyle`; mountHover uses `motion` and `motionSpeed`.
Base cycles last 12 seconds; speed scales duration. Studio amount scales strength.
Keep automatic motion off for source video unless requested. Respect reduced motion.
These are local effects, not AI-generated frames. Frame rate depends on device,
resolution and other effects; no universal FPS guarantee.

## Performance fixes (4.3.1)

Stationary artwork, masks, lights, backdrops and character bloom are cached while finishing grain/dust/glitch continue. Source/settings/layout edits invalidate the composition; pointer motion redraws until the field settles and restores a clean final frame. Unused dither motion on other styles and zero-strength ambient motion no longer keep a still preview awake. Ordered Bayer threshold tables avoid per-pixel recurrence without changing quantized output. CMYK now honors tonal hover/motion and gray/accent color modes. Still exports accept `motionTime` from the mounted preview to preserve the selected phase after speed edits; animation exports still start at zero.

## Expanded motion library (4.4)

Use `STUDIO_HOVERS` and `STUDIO_MOTIONS` to show all eleven hovers and ten still-image motions, plus Off, grouped by behavior. New hover IDs are `etch`, `elastic`, `rake`; new motion IDs are `parallax`, `weave`, `print`, `trace`. `hover.radius` and `hover.strength` are independent of `motion.speed` and `motion.amount`. All remain serialized in look links and saved projects. A static photo needs no video input or AI service to animate.

Example: `player.update({ motion: { type: 'trace', speed: 1, amount: .7 }, hover: { effect: 'etch', radius: .45, strength: .65 } })`. Tone and character choices remain yours. See [effect behaviors and combinations](studio-effects.md#catalogs-and-useful-combinations-44). Do not run several looping thumbnail canvases just to display this catalog; apply the selected treatment to one shared preview.

## Tonal detail and blue noise (4.5)

Use `color.gamma` to lift midtones (above 1) or deepen them (below 1), from 0.25 to 4. `color.shadows` and `color.highlights` range from −1 to 1; positive lifts that region, negative darkens it. They form a monotone curve with fixed black, middle and white anchors. This is a bounded tonal curve, not a freely editable per-channel curve graph. It cannot recover clipped source detail.

`color.blackPoint` (0–0.99, default 0) and `color.whitePoint` (default 1) map the input range before gamma. White is normalized to at least 1/255 above black. These controls apply equally to all Studio renderers before dither/character conversion, preserve source alpha, and round-trip in settings. Neutral settings skip the transform. The 256-entry lookup is rebuilt on configuration changes and reused for source frames. Reset with `{ blackPoint: 0, whitePoint: 1, gamma: 1, shadows: 0, highlights: 0 }`.

`blue-noise` uses a deterministic 64×64 toroidal rank tile generated offline with void-and-cluster relaxation. It suppresses low-frequency clumping; it is not white noise with a different label. A palette-pair projection controls coverage, preserving flat grayscale means for a black/white palette at full strength. Arbitrary color palettes still approximate the source. The original palette uses web-safe channel quantization. The rank tile is 8 KiB in memory, loads only with `/studio`, and has no network request or runtime generator.

Keep `dither.motion: 'none'` for a stationary pattern. `drift`, direction and speed translate the matrix; `shimmer` modulates tone. As with Bayer, stable thresholds do not guarantee flicker-free source video—changing source tones can change the quantized result. Start around a 320×180 sampling grid for animated artwork, then measure the target device. More detail is an explicit CPU tradeoff.

```ts
const player = await mountStudio(canvas, '/portrait.jpg', {
  settings: {
    style: 'dither',
    color: { gamma: 1.12, shadows: .15, highlights: -.12 },
    dither: { algorithm: 'blue-noise', palette: 'gray8', scale: 3 },
    motion: { type: 'trace', speed: .7, amount: .25 },
  },
  maxDimension: 960,
  maxCells: 65536,
});
// Use the same player.settings for live embedding and independent export.
// On unmount: player.destroy().
```

## Channel curves and source noise (4.6)

`color.curves` accepts `rgb`, `red`, `green` and `blue` arrays of `[input, output]` points in 0–1. Each curve holds up to 16 points including input endpoints 0 and 1. Missing endpoints use the identity; coordinates are clamped, input positions quantize to 1/255, repeated inputs retain the last valid point and points are sorted. Output points may reverse direction for an intentional inverted/solarized treatment. Shape-preserving cubic interpolation avoids overshoot between points. `createStudioCurveLookup(points)` returns the same 256 samples used by the renderer for a custom graph; `normalizeStudioCurve` and `STUDIO_CURVE_CHANNELS` are public helpers.

Incremental `player.update({color:{curves:{red: [...]}}})` preserves the other channels. Each supplied channel array replaces that channel. Reset a channel with `[[0,0],[1,1]]`; reset all with `normalizeStudioCurves({})`. Keep input ordering and show precise values in a curve editor; do not call an arbitrary point graph a fixed shadow/highlight control.

`color.denoise` is 0–1, default 0. It performs a bounded 3×3 edge-preserving filter on sampled source pixels, preserving alpha and excluding hidden transparent colors. Use it for small source noise; strong settings can remove intentional texture and do not recover clipped or missing detail. It is not generative restoration or temporal video denoising.

Processing order: crop/sample → reduce noise → brightness/contrast/saturation/grayscale → levels/gamma/shadow/highlight tone → RGB curve → individual channel curves → source warps (4.7+) → hover/motion → style/dither → composition/finish. Use `colorMode:'source'` to retain the resulting colors; accent and gray modes use the adjusted source tones for their own ink mapping. The backdrop remains its existing source/background pipeline.

Curves compile to three 256-entry tables only when configured. Noise reduction uses one bounded source copy; static images reuse their processed pixels during motion/hover. Video must process changed source frames, so dense one-pixel sampling adds CPU cost. Start with the default 12,000-cell budget or measure a larger budget on the target device. Neutral settings skip both processing paths; root/core/hover entry points do not load them.

```ts
player.update({
  color: {
    denoise: .25,
    curves: {
      rgb: [[0,0], [.25,.2], [.75,.8], [1,1]],
      blue: [[0,.04], [1,.95]],
    },
  },
});
const saved = serializeStudioSettings(player.settings);
// For export, snapshot player.settings once before async media loading.
// The independent export renderer applies the same source controls.
```

`player.settings` is an owned snapshot, not a live mutable reference. Use `player.update()` to edit. Reuse it for JSON, independent PNG/video export and restoring a live component. Check installed version before using this getter (4.6+).

## Ordered source shaping (4.7)

`warps` stores up to eight optional transforms applied in array order before all styles. `warpEdge` selects extended or transparent edges. Read [source shaping](source-shaping.md) for the nine mechanisms, controls, normalization, editor construction and dense-video cost. This is separate from art-style selection, pointer response and autonomous motion. The default stack is empty.

## Print and illustration (4.9)

The catalog adds six print treatments with fine square cells and an optional `print` settings group. See [print-styles.md](print-styles.md) for the mechanisms, controls, polarity, bounded rendering and living-image example. They use the same Studio pipeline, saved settings and exports.
