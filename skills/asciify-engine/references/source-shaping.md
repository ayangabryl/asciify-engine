# Ordered source shaping (4.7+)

Use `/studio` when a source needs local distortion before ASCII or dither conversion. These are static source transforms, independent of pointer hover and autonomous still-image motion. No AI service, external image upload or new animation clock is involved. Empty stacks are the default.

```ts
import { mountStudio, STUDIO_WARPS, MAX_STUDIO_WARPS } from 'asciify-engine/studio';

const player = await mountStudio(canvas, '/photo.webp', {
  settings: {
    style: 'ascii', cellSize: 6,
    warps: [
      { type: 'sphere', amount: .3, x: .5, y: .5, radius: .65 },
      { type: 'shear', amount: .12, angle: 25 },
    ],
    warpEdge: 'clamp',
    motion: { type: 'parallax', speed: .6, amount: .5 },
    hover: { effect: 'elastic', radius: .4, strength: .5 },
  },
});
// STUDIO_WARPS supplies value, label, description, direction and frequency.
// Keep add/reorder/disable controls bounded by MAX_STUDIO_WARPS (8).
player.update({ warps: [{ type: 'ripple', amount: .2, frequency: 6 }] });
const snapshot = player.settings; // persist / export this same state
player.update({ warps: [] });     // remove shaping without changing motion
// Call player.destroy() when its owning component unmounts.
```

## Catalog and controls

| Type | Mechanism | Extra controls |
|---|---|---|
| `twirl` | Continuous regional rotation, fading to a fixed boundary | — |
| `pinch` | Contract the center; negative strength expands | — |
| `sphere` | Rounded lens magnification; negative strength recedes | — |
| `ripple` | Smooth concentric displacement bands | `frequency` |
| `zigzag` | Angular twist bands with a triangular profile | `frequency` |
| `shear` | Regional slant along a chosen direction | `angle` |
| `smudge` | Pull a soft region along a chosen direction | `angle` |
| `polar` | Polar coordinate unwrap; negative strength wraps | `angle` |
| `fragment` | Stable hashed tile offsets; intentionally discontinuous | `angle`, `frequency` |

Every stage accepts `enabled` (default true), `amount` (−1…1, default .35), normalized center `x`/`y` (0…1, default .5) and `radius` (.05…2, default .55). Radius is a fraction of the **canvas's shorter side**, not a width percentage. This keeps circular regions circular in portrait and landscape output. `angle` is degrees −180…180, default 0. `frequency` is 1…24, default 5. Only expose angle/frequency when the catalog says that transform uses it. Zero strength and disabled stages preserve the source. Negative strength reverses the transform's direction but is not an exact inverse for every mechanism.

Stacks apply in array order. The engine composes inverse coordinates in reverse order, then resamples the source once, avoiding repeated raster blur. `player.update({warps:[...]})` replaces the entire array; it does not append or merge stages. Preserve the other entries when changing one. `normalizeStudioWarps` is available to control builders and returns independent normalized objects. At most eight valid stages are retained; unknown types are omitted, never aliased to another effect. Settings version remains 1. Older package versions ignore these fields, so upgrade npm and refresh the installed skill before using them.

`warpEdge:'clamp'` extends the nearest source edge when a coordinate leaves the source. `'transparent'` samples transparent virtual pixels, interpolating alpha correctly. Transparent areas reveal the selected backdrop; also select `backdrop.mode:'transparent'` for a cutout. Polar has a coordinate seam; Fragment has intentional tile boundaries. Do not describe either as an imperceptible photographic correction.

## Composition, export and performance

Processing order: crop/sample → source noise/grade/levels/channel curves → source warps → hover and still-image motion → selected render style/dither → masks, lights, backdrop and finish. Shaping applies to the converted source, not the independent source/blurred backdrop. All 18 styles share it. Save `player.settings` for JSON or independent export; do not recreate a different stack in the exporter. Animated exports include autonomous motion but do not record live pointer events. A warp stack by itself does not animate a static picture.

Static sources reuse the final shaped pixels during hover/motion. Video frames reuse the coordinate map and require one premultiplied-alpha bilinear sample per output sample; map construction occurs only when source-grid dimensions/aspect or warp controls change. Empty stacks add no pixel pass. A changed warp at a very dense source grid can be expensive; keep interactive preview `maxCells` bounded and let the user explicitly choose finer export density. Do not animate warp parameters every frame as a substitute for the existing motion system.

Measured CPU-only on an Apple M4 Pro / Node 25.9.0: an eight-stage map at 320×180 samples took 1.049 ms p95 per cached video-frame resample; editing it and rebuilding took 9.857 ms p95. At 960×540 the corresponding times were 8.909 and 72.833 ms. These numbers exclude decode, quantization, Canvas, GPU and display; they do not establish browser FPS or mobile performance. The default identity path preserves prior output; transformed pixels intentionally change. Moving dither now interpolates alpha with RGB to avoid stepped transparent edges or hidden-color halos.
