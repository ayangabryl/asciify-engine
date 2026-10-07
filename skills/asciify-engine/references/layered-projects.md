# Layered projects — 4.8+

Use `asciify-engine/studio` to combine up to eight images, videos, GIFs or FIGlet text sources on one canvas. Each layer has its own Studio settings, placement, opacity and blend mode. This is a local composition API. Keep accessible headlines, links and controls in HTML; raster text layers are artwork or export content.

## Live component

```ts
import { mountStudioProject, normalizeStudioProject } from 'asciify-engine/studio';
const project = normalizeStudioProject({
  width: 1280, height: 720, background: '#0c1711',
  layers: [
    { id: 'scene', source: 'photo', name: 'Landscape', settings: {
      cellSize: 6, ink: '#93b79b',
      motion: { type: 'parallax', amount: .3, speed: .8 },
      hover: { effect: 'trail', strength: .55, radius: .45 },
    } },
    { id: 'title', source: 'caption', name: 'Caption',
      placement: { width: .8, height: .25 },
      settings: { cellSize: 3, ink: '#b3ed82', hover: { effect: 'elastic' } },
    },
  ],
});
const sources = {
  photo: '/your-owned-photo.webp', // or a user-selected File
  caption: { text: 'HELLO', font: 'Small' as const },
};
const controller = new AbortController();
const player = await mountStudioProject(canvas, project, sources, {
  maxDimension: 1280, maxCells: 24000, maxRasterPixels: 2097152,
  signal: controller.signal, onError: error => showError(error.message),
});
player.updateLayer('scene', { settings: { hover: { effect: 'water' } } });
player.updateLayer('title', { placement: { y: .65 }, opacity: .8 });
// On unmount: controller.abort(); player.destroy();
```

Do not attach `mountHover` or one RAF per layer. This player owns the combined loop, input, visibility/reduced-motion handling and loaded assets. Shared media is sampled once per frame; unchanged child canvases are cached. Ordinary settings edits do not reload assets. See the typed package example `examples/layered-composition.ts`.

## Model and placement

`kind: 'asciify-project'`, `version: 1`; dimensions are 2–4096 pixels per side. Empty projects are valid. Layer arrays run **back to front**. Layer IDs must be unique. IDs/source keys are 1–64 letters, numbers, colons, hyphens or underscores, starting with a letter or number; names are display labels up to 80 characters.

Placement is center-based: `x/y` default `.5` (range −1…2), `width/height` default `1` (range .01…2), relative to the project canvas. Rotation is degrees −180…180; `flipX/flipY` default false. Use the layer's Studio `crop` and `warps` for source framing. Opacity is 0…1; `visible` defaults true; blending uses `BLEND_MODES`. Project background accepts a six-digit hex or `null`. Layers default to transparent backdrops; an explicit opaque layer backdrop covers artwork behind it.

`pointerMode: 'top'` targets the frontmost interactive rectangle; `'all'` targets all rectangles beneath the pointer. Rotation/flips are inverted for input. Picking is rectangular, **not alpha/glyph hit testing**: transparent holes do not pass input through. Off/zero-strength layers are skipped.

Every layer accepts the complete `StudioInput`: all 18 styles, dither, masks, curves, source warps, hover, ambient motion and finishing. Use the published catalogs; source warps, motion and hover are independent.

## Assets and lifecycle

`StudioProjectSources` maps keys to `File`, direct CORS-compatible media URLs or `{text, font?, ink?}`. Text uses `STUDIO_TEXT_FONTS`, defaults to white on transparency and can be recolored by layer settings. YouTube page URLs are not media URLs.

Up to eight bindings are loaded, including unused supplied bindings. Every referenced source, even on a hidden layer, must be supplied. Multiple layers can share one key. To add/replace a binding, destroy the old player and mount the new dictionary. Reordering, visibility, placement and settings use `player.update(project)` or `updateLayer` without media reload. Remove unused bindings when remounting. Files stay local; URLs still make normal media requests.

`mountStudioProjectMedia` accepts a `ReadonlyMap<string, StudioMedia>` and takes ownership on successful setup. It destroys each unique asset once. If setup fails before returning, the caller retains cleanup responsibility for supplied media. `mountStudioProject` cleans up its own failed loads. Never give the same owned media instance to two players or export.

`createStudioProjectRenderer` is the lower-level alternative: no media loading, RAF or events. Supply a `ReadonlyMap<string, StudioSource>` to `render`, and `invalidate(key)` when external code changes pixels in place. Video frame stamps invalidate automatically. `render` returns whether it repainted; `configure` replaces the project. Always destroy it.

The player exposes `pause`, `seek`, `resize(width,height,pixelRatio?)`, `redraw`, `setBudget`, `setAdaptive`, `update`, `updateLayer` and idempotent `destroy`. Read detached `project` and `motionTimes` snapshots and current `time`. New seeks cancel older ones with `AbortError`; custom media `seek` must honor its AbortSignal. Native videos use independent browser playback, not frame-locked live playback. Export seeks each source deterministically.

## Budgets and timing

One cell budget (default 24,000; range 2,048–1,048,576) is divided by layer area, with a 256-cell minimum per visible layer. One **child-output raster** budget (default 4,194,304; range 65,536–16,777,216 pixels) caps combined child output size. It does not cap decoders or all internal surfaces. Hidden, transparent and offscreen layers skip rendering; loaded assets can still occupy memory. Their native videos pause.

`quality` reports per-layer `{id,maxCells,width,height}` allocations, not achieved FPS. Adaptive mode lowers the total cell budget after sustained render cost. `maxDimension` bounds root output; `pixelRatio` describes requested raster scale and preserves logical density through downsampling. Stills stop scheduling when unchanged; motion/hover wakes them. Reduced motion, hidden documents and offscreen canvases pause playback. Multiple optical finishes or dense dither still have real cost; measure target hardware.

Do not promise seamless combined loops unless source lengths and effect periods align. Ambient cycles last 12/speed seconds; temporal grain, dust, glitch, dither and media have separate timing.

## Save and reopen

`serializeStudioProject(player.project)` saves settings/source keys, never files or URLs. `parseStudioProject` validates kind/version, unique IDs and the eight-layer limit, with a 1 MB settings-text limit. Single-source `serializeStudioSettings` JSON is a different format. Maintain a separate asset manifest and ask for missing files; do not substitute artwork silently.

Asciify's layered editor adds optional `textSources` metadata so text is portable. The engine parser ignores app metadata. Integrations must validate/rebind that dictionary themselves or supply their own bindings. Never execute imported fields or fetch arbitrary metadata URLs.

## Export independently

```ts
import { exportStudioProject } from 'asciify-engine/studio';
const png = await exportStudioProject(player.project, sources, {
  format: 'png', width: 1280, height: 720,
  referenceWidth: canvas.width / player.pixelRatio,
  maxCells: player.maxCells, time: player.time, motionTimes: player.motionTimes,
  signal: exportController.signal,
});
```

Export freezes the project/bindings/phases and loads independent media. It never seeks, pauses or destroys the preview. Visible shared sources seek once per frame. Failure/cancellation aborts sibling seeks and releases all export resources. PNG/JPEG capture specified time/phases; GIF/MP4/WebM start at zero and do not record pointer paths. Generic Studio export size/codec/GIF limits apply. WebGL-only finishes error if unavailable. Actual GPU appearance and codec playback require browser verification.

Update the runtime and installed agent skill separately: [upgrading.md](upgrading.md).
