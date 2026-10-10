# Live project integration, then export

Use this decision guide for an application that should keep its ASCII interactive.
A downloaded PNG is one output; it is not a substitute for a live component.

| Desired result | API | Motion/hover owner |
| --- | --- | --- |
| Image/video/GIF hero with HTML titles and text cutouts | `/core` media API + optional `/hover` | Disable core hover/motion when `/hover` owns them. |
| Art-style editor, live still image, saved look, backdrop, masks, PNG/video export | `/studio` → `mountStudio` | Studio owns motion, hover and finishing. Do not stack `mountHover` on it. |
| Multiple media/text layers with independent styles, placement, blends and exports | `/studio` → `mountStudioProject` (4.8+) | One shared loop and budget; see [layered-projects.md](layered-projects.md). |
| Application-owned render loop | `/studio` → `createStudioRenderer` | Caller passes time, pointer input, invalidation and cleanup. |
| ASCII text data | Core frame/text conversion | No animation loop needed unless requested. |
| Full-bleed hero or brand field that must stay smooth under the cursor, or the user's word as the characters | `/field` → `mountGlyphField` (4.11+) | The field owns its wake and drift. Keep a poster and a `/studio` or core fallback for browsers without a GPU; see [glyph-field.md](glyph-field.md). |
| Ambient background with no media | Downloaded template from asciify.org/backgrounds, or a `/field` generated scene | Templates own their loop; call `destroy()` on unmount. |

Choose colors, fonts and sizes from the project's design tokens before writing settings; [design-matching.md](design-matching.md) maps the user's mood words to values.

## Small live component

```ts
import { mountStudio, normalizeStudioSettings, updateStudioSettings } from 'asciify-engine/studio';

const cancellation = new AbortController();
let settings = normalizeStudioSettings({
  style: 'ascii', cellSize: 6,
  ink: tokens.accent, backdrop: { mode: 'solid', color: tokens.background }, // from the project's design tokens
  hover: { effect: 'trail', radius: .45, strength: .55 },
});
const player = await mountStudio(canvas, '/portrait.jpg', {
  settings, width: 960, height: 540, maxDimension: 960,
  maxCells: 12000, signal: cancellation.signal,
});

// Add life to a still without changing the source or remounting.
settings = updateStudioSettings(settings, {motion: {type: 'sheen', speed: .7, amount: .6}});
player.update(settings);
// User controls:
player.pause(true);
player.pause(false);
// On unmount, including while setup is pending:
cancellation.abort();
player.destroy();
```

Keep the instance outside render-time state updates. React effects should abort
pending setup and destroy a late-resolving instance after unmount. Use a
ResizeObserver to call `resize`; avoid remounting on size or slider changes.
`mountStudio` owns the loaded media and its own reduced-motion/visibility handling.
Keep readable HTML content and an error state beside a decorative canvas.

## Export without disturbing live playback

Read [studio-workspace.md](studio-workspace.md#export-the-same-composition).
Snapshot settings, preview time, `player.motionTime`, `maxCells`, logical reference width
(`canvas.width / player.pixelRatio`), and aspect ratio before an asynchronous export.
Load a second `StudioMedia`, seek it for each exported frame, and always destroy it
in `finally`. PNG/JPEG accept `time` and `motionTime`; pass both from the mounted preview so speed edits do not change the exported phase. Animation exports start at time zero.
`exportStudio` returns a Blob; download it with an object URL and revoke that URL.

For a still with ambient motion, one complete cycle is `12 / motion.speed`
seconds. The 60-second export limit means a whole cycle needs speed ≥ 0.2.
Dither shimmer/drift and noise/glitch finishing have independent clocks; stacking
them with an ambient cycle does not guarantee that the combined result loops.
Source video must itself loop to produce a seamless video export.
Hover depends on live pointer input and is not baked into offline export.

A typed reusable helper, including live updates, settings import/export and PNG/
MP4 output, ships at `asciify-engine/examples/studio-composition.ts` in the package
files. Copy that source from the installed package; it is an example, not a public
JavaScript export. Choose source URLs and style settings for the host project.

## Evidence to gather

- Verify a recognizable source, small/large cells, source/accent/gray colors,
  a hover, a still motion and the requested finishing combination.
- Check pause, hidden/offscreen suspension, remount cleanup, and reduced motion.
- Use `studioGrid` for actual density. Settings may request a finer grid than the
  current budget permits; show that explicitly.
- `onFrame(time, costMs)` measures synchronous rendering cost. It does not measure
  GPU completion or displayed FPS. Measure frame pacing in a browser on the target
  device before publishing a performance claim.
- Export a selected still and an entire animation. Compare framing, density,
  colors, transparency and the loop boundary with the preview.
- If browser inspection is unavailable, report code/unit/build evidence separately
  and leave visual, GPU and device-performance claims unverified.
