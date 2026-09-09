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

Keep complete settings in application state. Apply edits with `updateStudioSettings(settings, patch)` and pass that state to `studio.update`; the mounted instance does not expose a settings getter. Serialize your application state when saving a look.

In React, create the AbortController inside the effect. On cleanup, abort and destroy the returned instance; if setup resolves after disposal, immediately destroy that instance. Do not remount for slider changes: call `update`. The mount owns its loaded media. `mountStudioMedia` takes ownership of an already loaded `StudioMedia`. Use an independent media instance for export.

Sources are local `File` objects or permitted image/video/GIF URLs. Remote servers must permit canvas CORS access. No media is uploaded by this API. A YouTube page or iframe is not a pixel source. HEIC browser decoding is not universal; convert it to PNG/JPG before this optional API.

## Settings and looks

Start with `normalizeStudioSettings({ ... })`, `DEFAULT_STUDIO_SETTINGS`, or `studioLook(id)`. Enumerate `STUDIO_STYLES`, `DITHER_ALGORITHMS`, `STUDIO_PALETTES`, `STUDIO_LOOKS`, and `STUDIO_TEXT_FONTS` rather than guessing IDs. Partial mounts and `update` accept `StudioInput`; complete state is `StudioSettings`.

- `style`: ASCII and character shapes, dots, pixel, mosaic, LEGO-like studded cells (`lego`), isometric tiles (`voxel`), faceted tiles (`disco`), or `dither`. These are canvas treatments, not editable 3D scenes.
- `charset`, `cellSize`, `colorMode` (`accent`, `source`, `gray`), `ink`: rendering choices. Character density is bounded by the working-size and cell budgets.
- `aspectRatio`: `original`, `16:9`, `9:16`, `1:1`, `4:3`, `3:4`, `21:9`. `studioDimensions` resolves dimensions from the source and rotation.
- `crop`: normalized `x`/`y` anchor, `zoom` 1–5, rotation in 90-degree steps. Cover framing fills the output.
- `backdrop`: `solid`, `transparent`, `source`, `blurred`, or `gradient`; `color`, `color2`, `opacity`, `blur`. A wallpaper look is an opt-in composition, not an operating-system wallpaper installer.
- `color`: brightness, contrast, saturation, grayscale, tint amount/color and blend mode. Tint and lights retain the artwork alpha rather than filling empty glyph cells.
- `dither`: algorithm, palette/custom colors, amount, scale, threshold, pattern motion (`none`, `drift`, `shimmer`) and speed. Diffusion and ordered patterns differ; animated thresholds can shimmer intentionally.
- `mask`: enable/invert and a list of rectangle, ellipse, or brush shapes. Coordinates are normalized to the output canvas. Masks are bounded to 64 shapes and 2,048 total brush points. Masking affects the artwork; the backdrop remains visible.
- `lights`: at most four colored radial lights with normalized position, radius, and intensity. This is 2D illumination, not physically based material lighting.
- `effects`: independent character bloom and whole-composition bloom, prism, grain, dust, scanlines, CRT, vignette, glitch, pixelation, halftone, and Gaussian/directional/radial/progressive blur. Optical effects use an optional WebGL pass. Check `capabilities.gpuFinish` after an effect renders; unavailable GPU effects must not be described as applied.
- `hover`: Trail, Water, Contour, Dissolve, Silk, Vortex, or none; strength, normalized radius, optional `edgeSafe`. Hover is live interaction; it is not recorded into offline exports.

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
