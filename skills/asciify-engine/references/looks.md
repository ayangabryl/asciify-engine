# Asciify looks

Finished artwork looks for a person's own photo, video or GIF: wallpapers, posters, album and cover art, hero artwork, prints and social images. Each look has the prompt a person gives you and the exact `/studio` settings that reproduce it. Every look is shown live at https://asciify.org/looks on a source image made for it, and opens in the editor at https://asciify.org/editor with the same settings. Every Studio render style has at least one look.

These are artworks, not interface components. For a loading state, a background behind text or another UI piece, use [components.md](components.md) and the kit instead.

Twelve looks are the engine's curated presets: apply them with `studioLook(id)` and enumerate `STUDIO_LOOKS` rather than copying their values. The others are written out in full settings: render styles the presets do not cover, Composed looks that use the backdrop (blur, the photo itself, gradients, transparency) and masks, and Finished looks that turn on the optical finish (vignette, grain, bloom, scanlines, fringe, blur). All of them use the `asciify-engine/studio` entry ([studio-workspace.md](studio-workspace.md), [print-styles.md](print-styles.md)); nothing is uploaded, and the person's media stays in the browser.

## Reproduce a look

Mount it on a canvas, sized to the element it fills. Cell sizes are logical pixels: the renderer draws at the width and height you pass, and multiplies cells by the pixel ratio. Pass the element's CSS size times the ratio, with that ratio, to keep the density you see on asciify.org with sharp marks. The source is cover-cropped into that frame. Raise `maxCells` for fine dither and print looks.

```ts
import { mountStudio, studioLook } from 'asciify-engine/studio';

const box = frame.getBoundingClientRect(), ratio = Math.min(devicePixelRatio, 2);
const width = Math.round(box.width * ratio), height = Math.round(box.height * ratio);
const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: studioLook('riso'), // or a full settings object from an entry below
  width, height, maxDimension: 2048, maxCells: 65536,
});
art.resize(width, height, ratio); // the same grid as at 1×, drawn sharper; call again when the frame resizes
// Let the cursor work through the artwork: art.update({ hover: { effect: 'trail' } });
// On unmount: art.destroy();
```

The entries below pass the element's CSS size at 1× for brevity; add the ratio as above for high-density screens.

Give the canvas `width: 100%; height: 100%` in CSS and an `aria-label` or adjacent caption describing the image; the artwork is an image, not text. Keep `crop.x`/`crop.y` (0–1) to frame the subject, and `aspectRatio` (`'1:1'`, `'4:3'`, `'3:4'`, `'16:9'`, `'9:16'`, `'21:9'`) when the frame is fixed rather than the element's.

## Export a wallpaper, poster or loop

Export renders a separate, deterministic frame; it never screenshots the live canvas. `referenceWidth` is the logical width the look is designed at, so the same cells scale up sharply instead of multiplying.

```ts
import { exportStudio, loadStudioMedia, normalizeStudioSettings, studioLook } from 'asciify-engine/studio';

const media = await loadStudioMedia(file);
try {
  const settings = studioLook('ascii'); // or normalizeStudioSettings({ ...an entry's settings })
  const wallpaper = await exportStudio({ frame: () => media.frame(0) }, settings, {
    format: 'png', width: 3840, height: 2160, referenceWidth: 960, maxCells: 262144,
  });
  const phone = await exportStudio({ frame: () => media.frame(0) }, settings, {
    format: 'png', width: 1290, height: 2796, referenceWidth: 430, maxCells: 262144,
  });
  // Looks with motion loop every 12 / motion.speed seconds; export one loop for a seamless video wallpaper.
  const loop = await exportStudio({ frame: async (t, signal) => { await media.seek(t, signal); return media.frame(t); } }, settings, {
    format: 'mp4', width: 1920, height: 1080, referenceWidth: 960, fps: 30,
    duration: settings.motion.type === 'none' ? 6 : 12 / settings.motion.speed, maxCells: 131072,
  });
} finally {
  media.destroy();
}
```

Common sizes: desktop 3840×2160 (`referenceWidth: 960`), phone 1290×2796 (`430`), square post 2160×2160 (`720`), A4 at 300 dpi 2480×3508 (`620`). Stills are bounded at 4096 pixels a side and 16 megapixels, so larger print sizes need a lower dpi. MP4 needs a WebCodecs encoder and even dimensions; report an encoder error rather than switching format silently. Hover is live only and is never recorded.

## How to choose

- The person names a look, or describes one ("newsprint", "riso", "phosphor", "Lego", "engraving", "film still"): use the entry, then adjust only what they asked for.
- Dark, contrasty sources (a subject on black, night scenes) suit character looks and source-color tiles. Bright, high-key sources (white architecture, paper, daylight) suit the paper-ground looks: Newsprint, Two inks, Banknote, Four-color press, Riso duotone, Woodcut, Overprint.
- Subjects with strong local color (fruit, fish, birds, a painting) suit source-color looks: Mosaic study, Brickwork, Pixel, Honeycomb, Pointillist, ANSI blocks, Jewel box.
- The artwork goes over something else (video, a gradient, a brand color, a product page): use a transparent look (Cutout, Halo overlay) and export PNG, which keeps the alpha.
- The person wants the photo itself to stay present: Frosted glass and Bokeh draw over its blur, Overprint over the sharp original.
- The person asks for a grade, film, broadcast or vintage feel: use a Finished look. Finish effects need WebGL; check `art.capabilities.gpuFinish` and say so when it is unavailable.
- Keep artwork with motion off for video sources unless asked; the footage already moves.
- Say in one line which look you chose and offer one alternative from this file.

## frost: Frosted glass
Category: Composed
Use it for: sunsets, skylines and silhouettes as white frost characters over a soft, full-color blur of the photo; premium wallpapers and covers.
Settings: ASCII, 5px cells, ink `#121110` with the tone curve inverted so shadows carry the characters, over the source blurred 24px at full opacity.

Prompt:
“Frost [my photo] like glass with asciify-engine: fine white characters where the photo is bright, over a soft, full-color blur of the same photo, so dark shapes stay clean silhouettes. Export a 3840×2160 PNG wallpaper and a 1290×2796 phone version.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'ascii', cellSize: 4, ink: '#fff7ef',
    backdrop: { mode: 'blurred', blur: 10, opacity: 1 },
    color: { contrast: 1.2, brightness: .05 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
// The blur is the untouched photo; color adjustments only change the characters.
```

## bokeh: Bokeh
Category: Composed
Use it for: flowers, gardens and lights as glowing color dots over their own soft focus; spring campaigns, calm wallpapers, music covers.
Settings: dots, 6px cells, source color at saturation 1.3, brightness .12, over the source blurred 32px, character glow .25.

Prompt:
“Turn [my photo] into a bokeh artwork with asciify-engine: halftone dots in the photo's own colors, slightly brighter, floating over a deep blur of the same photo with a soft glow. Export a 2160×2700 PNG.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'dots', cellSize: 6, colorMode: 'source',
    backdrop: { mode: 'blurred', blur: 32, opacity: 1 },
    color: { saturation: 1.3, brightness: .12, contrast: 1.1 },
    effects: { characterBloom: .25 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
```

## cutout: Cutout
Category: Composed
Use it for: a subject on a dark or plain background as a sticker with a transparent ground; overlays on any color, product cut-outs, layered heroes.
Settings: mixed type, 4px cells, source color at saturation 1.4, brightness .15, transparent backdrop.

Prompt:
“Cut [my subject on a dark background] out as an ASCII sticker with asciify-engine: fine mixed type in the photo's colors on a transparent ground, so only the subject remains. Place it over [our brand color] in the hero and export a transparent 2160×2160 PNG.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'mixed', cellSize: 4, colorMode: 'source',
    backdrop: { mode: 'transparent' },
    color: { saturation: 1.4, contrast: 1.2, brightness: .15 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
// Export as PNG to keep the transparency; JPEG and MP4 fill it with black.
```

## halo: Halo overlay
Category: Composed
Use it for: a glowing white dot artwork with a transparent ground, to lay over video, gradients or brand color; launch heroes and title cards.
Settings: dots, 5px cells, `#f4f1ea` ink, transparent backdrop, character glow .4.

Prompt:
“Make [my photo] a glowing dot overlay with asciify-engine: white halftone dots with a soft halo on a transparent ground, so it sits over [our hero gradient]. Keep the canvas pointer-events free and export a transparent 3840×2160 PNG.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'dots', cellSize: 5, ink: '#f4f1ea',
    backdrop: { mode: 'transparent' },
    color: { contrast: 1.2 },
    effects: { characterBloom: .4 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
// canvas { position: absolute; inset: 0; pointer-events: none } over the layer it decorates.
```

## afterglow: Afterglow
Category: Composed
Use it for: a bright figure or object on black, redrawn in warm light characters over a dusk gradient; event posters, music and campaign heroes.
Settings: ASCII, 4px cells, black point .25, `#fff0dc` ink over a gradient from `#1c1433` to `#b4492f`, character glow .3.

Prompt:
“Draw [my photo] in warm light characters over a dusk gradient with asciify-engine: violet into ember, the characters glowing softly. Export a 2160×2700 PNG poster and let me swap the two gradient colors for [our palette].”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'ascii', cellSize: 4, ink: '#fff0dc',
    backdrop: { mode: 'gradient', color: '#1c1433', color2: '#b4492f' },
    color: { contrast: 1.2, blackPoint: .25 },
    effects: { characterBloom: .3 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
art.update({ backdrop: { color: '#0e2a3a', color2: '#d98f3c' } }); // the gradient runs top left to bottom right
```

## neon: Neon
Category: Composed
Use it for: night photos with bright, saturated lights, redrawn as glowing colored characters; nightlife, festival and music artwork.
Settings: ASCII, 4px cells, source color at saturation 1.3 on `#07070a`, character glow .6.

Prompt:
“Light [my night photo] up as neon with asciify-engine: fine characters in the photo's own saturated colors, each glowing like a lit tube, on black. Play it live in [the hero] and export a 2160×2700 PNG.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'ascii', cellSize: 4, colorMode: 'source',
    backdrop: { mode: 'solid', color: '#07070a' },
    color: { saturation: 1.3 },
    effects: { characterBloom: .6 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
```

## cobalt: Cobalt
Category: Composed
Use it for: a pale sculpture, portrait or product on a dark ground, set in cream characters on saturated ultramarine; gallery posters and confident brand heroes.
Settings: ASCII, 3px cells, `#f2ede2` ink on solid `#1f3ea8`, contrast 1.3, black point .15.

Prompt:
“Set [my photo] in cream characters on deep cobalt blue with asciify-engine, like a gallery poster. Export a 2480×3508 PNG, and let me swap the blue for [our brand color] without changing the ink.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'ascii', cellSize: 3, ink: '#f2ede2',
    backdrop: { mode: 'solid', color: '#1f3ea8' },
    color: { contrast: 1.3, blackPoint: .15 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
art.update({ backdrop: { color: '#0f5c4a' } });
```

## cameo: Cameo
Category: Composed
Use it for: a portrait engraved inside an oval on warm paper, like a stamp or banknote vignette; invitations, about pages, memorial and heritage artwork.
Settings: engraving, 4px cells, `#2a2620` on `#ece6d8`, `print.invert: true`, angle −30, inside an ellipse mask.

Prompt:
“Engrave [my portrait] inside an oval cameo with asciify-engine: fine parallel cuts in dark ink on warm paper, only within a centered oval, the paper plain around it. Export a 2480×3508 PNG for an invitation.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'engraving', cellSize: 4, ink: '#2a2620',
    backdrop: { mode: 'solid', color: '#ece6d8' },
    print: { invert: true, angle: -30, weight: 1.05 },
    mask: { enabled: true, shapes: [{ kind: 'ellipse', x: .31, y: .1, width: .38, height: .8 }] },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 131072,
});
// Mask shapes are 0–1 of the frame (left, top, width, height); move the oval to frame the face.
```

## gilded: Gilded
Category: Composed
Use it for: jewelry, watches, metalwork and ornament as gold engraving on black; luxury product pages, labels and premium dark heroes.
Settings: engraving, 4px cells, gold `#d9b26a` on `#0b0a08`, angle −35, weight 1.1, contrast 1.35, character glow .2.

Prompt:
“Engrave [my product photo] in gold on black with asciify-engine: fine parallel cuts in warm gold whose weight follows the light, with a faint glow. Export a 2160×2160 PNG and a 3840×2160 wallpaper.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'engraving', cellSize: 4, ink: '#d9b26a',
    backdrop: { mode: 'solid', color: '#0b0a08' },
    print: { angle: -35, weight: 1.1 },
    color: { contrast: 1.35, brightness: .05 },
    effects: { characterBloom: .2 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 131072,
});
```

## overprint: Overprint
Category: Composed
Use it for: bright, airy photos with dark characters printed straight over the sharp original; travel, editorial and summer campaign artwork.
Settings: ASCII, 5px cells, deep teal `#0f2a33` ink, contrast 1.2, over the source photo at full opacity.

Prompt:
“Overprint [my bright photo] with asciify-engine: keep the photo sharp underneath and print deep teal characters over its light areas, like a type screen inked onto the print. Export a 2160×2700 PNG.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'ascii', cellSize: 5, ink: '#0f2a33',
    backdrop: { mode: 'source', opacity: 1 },
    color: { contrast: 1.2 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
```

## cinema: Cinema
Category: Finished
Use it for: landscapes, roads and wide scenes as a film still: warm-white characters over the photo's own soft color, with a vignette, film grain and a little bloom; trailers, story heroes and posters.
Settings: ASCII, 4px cells, warm-white `#fff1de` ink over the source blurred 14px, contrast 1.15, vignette .45, grain .22, bloom .15.

Prompt:
“Grade [my photo] like a film still with asciify-engine: fine warm-white characters over a soft blur of the photo's own colors, finished with a vignette, a little bloom and film grain. Export a 3840×1646 PNG in 21:9 and keep it live in [the hero].”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'ascii', cellSize: 4, ink: '#fff1de',
    backdrop: { mode: 'blurred', blur: 14, opacity: 1 },
    color: { contrast: 1.15 },
    effects: { vignette: .45, grain: .22, bloom: .15 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
// Finish effects need WebGL: check art.capabilities.gpuFinish before saying they were applied.
```

## darkroom: Darkroom
Category: Finished
Use it for: still lifes, portraits and low-key photos as a print glowing out of the dark; book covers, gallery walls and quiet dark heroes.
Settings: ASCII, 5px cells, `#efe6d6` on `#080706`, contrast 1.2, brightness .3, midtones 1.7, vignette .55, bloom .35, grain .12.

Prompt:
“Print [my photo] like it is coming up in a darkroom with asciify-engine: warm paper-white characters on black, a heavy vignette, a soft glow on the highlights and a little grain. Export a 2480×3508 PNG.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'ascii', cellSize: 5, ink: '#efe6d6',
    backdrop: { mode: 'solid', color: '#080706' },
    color: { contrast: 1.2, brightness: .3, gamma: 1.7 },
    effects: { vignette: .55, bloom: .35, grain: .12 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
```

## broadcast: Broadcast
Category: Finished
Use it for: space, sport and news-like photos as a live transmission: a fine pixel picture with scanlines, a chromatic fringe, RGB split and a slight tube curve; launch and live-event artwork.
Settings: pixel, 3px cells, source color at saturation 1.15, scanlines .35, prism .3, RGB split .25, CRT .15, vignette .25.

Prompt:
“Make [my photo] look like a live broadcast with asciify-engine: a fine pixel picture in the photo's colors on a screen with scanlines, a chromatic fringe, a little RGB split and a slight tube curve. Show it live in [the hero] and export a 1920×1080 PNG.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'pixel', cellSize: 3, colorMode: 'source',
    backdrop: { mode: 'solid', color: '#06080b' },
    color: { saturation: 1.15, contrast: 1.05 },
    effects: { scanlines: .35, prism: .3, rgbSplit: .25, crt: .15, vignette: .25 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 131072,
});
```

## tape: Tape
Category: Finished
Use it for: action, skate and music photos as a worn tape frame: halftone dots in source color with glitch bands, color split, scanlines and grain; merch, flyers and social cuts.
Settings: dots, 4px cells, source color at saturation 1.3, brightness .15, glitch .15, RGB split .35, scanlines .2, grain .25.

Prompt:
“Run [my photo] through an old tape with asciify-engine: halftone dots in the photo's colors with glitch bands, an RGB split, faint scanlines and grain. Export a 1080×1350 PNG and a 6-second 1080×1350 MP4 loop.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'dots', cellSize: 4, colorMode: 'source',
    backdrop: { mode: 'solid', color: '#0b0a0c' },
    color: { saturation: 1.3, contrast: 1.1, brightness: .15 },
    effects: { glitch: .15, rgbSplit: .35, scanlines: .2, grain: .25 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
// Glitch bands move over time; mountStudio holds still under prefers-reduced-motion.
```

## miniature: Miniature
Category: Finished
Use it for: aerial views of towns, harbors and crowds as a tilt-shift model, sharp in a band and softly blurred above and below; travel and city artwork.
Settings: pixel, 4px cells, source color at saturation 1.35, progressive blur 6 focused at .55, sharpen .3.

Prompt:
“Turn [my aerial photo] into a tilt-shift miniature with asciify-engine: small square pixels in boosted source colors, sharp through the middle band and blurring toward the top and bottom. Export a 3840×2160 PNG wallpaper.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'pixel', cellSize: 4, colorMode: 'source',
    backdrop: { mode: 'solid', color: '#0b0b0a' },
    color: { saturation: 1.35, contrast: 1.1 },
    effects: { blur: 6, blurType: 'progressive', focus: .55, sharpen: .3 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
art.update({ effects: { focus: .4 } }); // moves the sharp band
```

## archive: Archive
Category: Finished
Use it for: historic, travel and heritage photos as an aged print, with sepia ink, dust, grain and a vignette; anniversaries, museums and about pages.
Settings: ASCII, 4px cells, sepia ink `#e9d8b4` on `#17130e`, contrast 1.4, dust .45, grain .3, vignette .4.

Prompt:
“Age [my photo] into an archive print with asciify-engine: warm sepia characters on dark brown with dust, film grain and a vignette, like a print found in a drawer. Export a 2480×3508 PNG.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'ascii', cellSize: 4, ink: '#e9d8b4',
    backdrop: { mode: 'solid', color: '#17130e' },
    color: { contrast: 1.4 },
    effects: { dust: .45, grain: .3, vignette: .4 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
```

## velocity: Velocity
Category: Finished
Use it for: headlights, tunnels and anything rushing toward the camera, with a radial speed blur and glowing highlights; automotive, sport and launch heroes.
Settings: ASCII, 4px cells, source color at saturation 1.25 lifted (brightness .2, midtones 1.3), radial blur 4 around the center, bloom .3, vignette .25.

Prompt:
“Give [my photo] speed with asciify-engine: characters in the photo's colors streaking out from the center with a radial blur, glowing highlights and a vignette. Export a 1920×1080 PNG and keep it live in [the hero].”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'ascii', cellSize: 4, colorMode: 'source',
    backdrop: { mode: 'solid', color: '#08080a' },
    color: { saturation: 1.25, brightness: .2, gamma: 1.3 },
    effects: { blur: 4, blurType: 'radial', focus: .5, bloom: .3, vignette: .25 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
```

## poppress: Pop press
Category: Finished
Use it for: bold, saturated product and car photos as a comic-print page, with a halftone screen over shaded blocks in source color; packaging, merch and pop posters.
Settings: blocks, 4px cells, source color at saturation 1.4 lifted (brightness .2, midtones 1.3), halftone screen .35, sharpen .4.

Prompt:
“Print [my photo] as a pop comic page with asciify-engine: shaded blocks in the photo's saturated colors under a halftone screen, sharpened. Export a 2480×3508 PNG poster.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'blocks', cellSize: 4, colorMode: 'source',
    backdrop: { mode: 'solid', color: '#0b0b0a' },
    color: { saturation: 1.4, contrast: 1.15, brightness: .2, gamma: 1.3 },
    effects: { halftone: .35, sharpen: .4 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
```

## ascii: Signature ASCII
Category: Characters
Use it for: the house look; a portrait, sculpture or product as a dark wallpaper, a hero artwork or a cover.
Settings: `studioLook('ascii')`: ASCII, 5px cells, paper-white `#e6e3da` on `#0b0b0a`, contrast 1.12.

Prompt:
“Turn [my photo] into Signature ASCII artwork with asciify-engine: paper-white characters on near black, fine 5px cells. Show it live on a canvas that fills [the hero], let the cursor leave a soft trail, and add a button that downloads a 3840×2160 PNG wallpaper.”

```ts
import { mountStudio, studioLook } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: { ...studioLook('ascii'), hover: { effect: 'trail', strength: .7, radius: .4 } },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
// On unmount: art.destroy();
```

## night: Night signal
Category: Characters
Use it for: moodier, filmic portraits and night scenes; album art and dark posters.
Settings: `studioLook('night')`: ASCII, graphite ink `#a9a69d` on `#0b0b0a`, prism .18, scanlines .08, vignette .25.

Prompt:
“Make [my photo] a Night signal poster with asciify-engine: graphite characters on near black with a faint prism fringe, scanlines and a vignette. Export a 2160×2700 PNG for an album cover and keep the settings so I can reuse the look.”

```ts
import { mountStudio, studioLook } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: studioLook('night'),
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
// Optical finish needs WebGL: check art.capabilities.gpuFinish before saying it was applied.
```

## terminal: Phosphor
Category: Characters
Use it for: a CRT or terminal feel on a portrait or product; developer-tool heroes and dark wallpapers.
Settings: `studioLook('terminal')`: ASCII, sage `#a4c9b3` on `#0a0d0b`, bloom .16, scanlines .12, CRT .06.

Prompt:
“Render [my video] in the Phosphor look with asciify-engine: soft sage characters on a near-black green, a faint glow, scanlines and a slight CRT curve. Play it live in [the hero], muted and looping, and keep it still for reduced motion.”

```ts
import { mountStudio, studioLook } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-video.mp4', {
  settings: studioLook('terminal'),
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 32768,
});
// mountStudio pauses off screen and under prefers-reduced-motion; on unmount: art.destroy();
```

## wallpaper: Wallpaper
Category: Characters
Use it for: a living desktop or phone wallpaper, a screensaver, or a full-bleed artwork that moves on its own.
Settings: `studioLook('wallpaper')`: ASCII, `#e6e3da` ink over the source blurred 18px at .4 opacity on `#0b0b0a`, caustics motion at speed .35.

Prompt:
“Make [my photo] into a living wallpaper with asciify-engine: ASCII characters over a softened, blurred copy of the photo, with slow caustic light moving through them. Export one seamless loop as a 1920×1080 MP4, plus a 3840×2160 PNG still and a 1290×2796 phone version.”

```ts
import { exportStudio, loadStudioMedia, studioLook } from 'asciify-engine/studio';

const settings = studioLook('wallpaper');
const media = await loadStudioMedia(file);
try {
  const loop = await exportStudio({ frame: () => media.frame(0) }, settings, {
    format: 'mp4', width: 1920, height: 1080, referenceWidth: 960, fps: 30,
    duration: 12 / settings.motion.speed, maxCells: 131072, // one full caustics cycle loops cleanly
  });
} finally { media.destroy(); }
```

## blueprint: Blueprint
Category: Characters
Use it for: architecture, machines and products drawn as technical linework; engineering and hardware heroes.
Settings: `studioLook('blueprint')`: lines style, 6px cells, pale blue `#b3c9d8` on navy `#0e1b28`.

Prompt:
“Turn [my product photo] into a Blueprint artwork with asciify-engine: fine line marks in pale blue on deep navy, like a technical drawing. Put it live behind [our hardware page's hero] with the copy kept clear, and export a 2400×1600 PNG.”

```ts
import { mountStudio, studioLook } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: studioLook('blueprint'),
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
```

## mixed: Type case
Category: Characters
Use it for: a playful, typographic take on a colorful subject; posters, merch and editorial openers.
Settings: mixed style, 5px cells, source color, contrast 1.2, brightness .15 on `#0b0b0a`.

Prompt:
“Set [my photo] in mixed type with asciify-engine: a blend of character shapes in the photo's own colors on black, like a type specimen. Export it as a 2160×2160 square for social and a 2480×3508 poster.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'mixed', cellSize: 5, colorMode: 'source',
    backdrop: { mode: 'solid', color: '#0b0b0a' },
    color: { contrast: 1.2, brightness: .15 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
```

## blocks: ANSI blocks
Category: Characters
Use it for: bold, colorful subjects as shaded block characters, like ANSI art from a BBS; retro, game and music artwork.
Settings: blocks style (` ░▒▓█`), 5px cells, source color at saturation 1.15, contrast 1.1 on `#0b0b0a`.

Prompt:
“Draw [my photo] in ANSI blocks with asciify-engine: shaded block characters in the photo's own colors on black, like a BBS splash screen. Export a 2160×2160 PNG and a 3840×2160 wallpaper.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'blocks', cellSize: 5, colorMode: 'source',
    backdrop: { mode: 'solid', color: '#0b0b0a' },
    color: { saturation: 1.15, contrast: 1.1 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
```

## braille: Braille
Category: Characters
Use it for: fine, graphic subjects on black (leaves, feathers, line-like forms) drawn in tiny braille dots; delicate dark wallpapers and editorial openers.
Settings: braille style (` ⠁⠃⠇⡇⣇⣧⣷⣿`), 3px cells, source color at saturation 1.3 on `#0b0b0a`, contrast 1.4, brightness .15, midtones 1.3.

Prompt:
“Draw [my photo] in braille dots with asciify-engine: fine braille characters in the photo's own colors on black, so the light shapes read as clusters of dots. Export a 3840×2160 PNG wallpaper.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'braille', cellSize: 3, colorMode: 'source',
    backdrop: { mode: 'solid', color: '#0b0b0a' },
    color: { contrast: 1.4, brightness: .15, saturation: 1.3, gamma: 1.3 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
```

## cross: Cross-stitch
Category: Characters
Use it for: birds, flowers and folk subjects as colored stitches on dark cloth; craft, seasonal and gift artwork.
Settings: cross style (` ·+xX#`), 4px cells, source color at saturation 1.5, brightness .2, contrast 1.2 on indigo cloth `#191d26`.

Prompt:
“Stitch [my photo] in cross-stitch with asciify-engine: small crosses in the photo's colors on dark indigo cloth, like an embroidered sampler. Export a 2160×2160 PNG for a card.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'cross', cellSize: 4, colorMode: 'source',
    backdrop: { mode: 'solid', color: '#191d26' },
    color: { saturation: 1.5, brightness: .2, contrast: 1.2 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
```

## diagonal: Storm
Category: Characters
Use it for: rain, wind and streaks of light drawn in slanted strokes; moody posters, weather stories and dark section artwork.
Settings: diagonal style (` /╱╳`), 4px cells, `#dfe7ea` on `#0c1013`, contrast 1.3, midtones 1.3.

Prompt:
“Draw [my photo] in slanted strokes with asciify-engine: diagonal line characters in cool grey on blue-black, like rain across the image. Export a 2160×2700 PNG.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'diagonal', cellSize: 4, ink: '#dfe7ea',
    backdrop: { mode: 'solid', color: '#0c1013' },
    color: { contrast: 1.3, gamma: 1.3 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
```

## diamond: Jewel box
Category: Characters
Use it for: iridescent, richly colored subjects (feathers, gems, beetles, fabric) set in diamond characters; fashion, beauty and jewelry artwork.
Settings: diamond style (` ·◇◈◆`), 7px cells, source color at saturation 1.5, brightness .35, midtones 1.5 on `#0b0b0a`, character glow .3.

Prompt:
“Set [my photo] in diamond characters with asciify-engine: diamonds in the photo's jewel colors on black with a soft sparkle, solid where it is bright and outlined where it is dim. Export a 2160×2700 PNG.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'diamond', cellSize: 7, colorMode: 'source',
    backdrop: { mode: 'solid', color: '#0b0b0a' },
    color: { saturation: 1.5, brightness: .35, gamma: 1.5 },
    effects: { characterBloom: .3 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
```

## print: Newsprint
Category: Dither
Use it for: bright, high-key photos as an editorial print; zines, press pages, quiet light-theme heroes.
Settings: `studioLook('print')`: Floyd–Steinberg dither, scale 2, `#1d1c19` on warm paper `#efece4`.

Prompt:
“Print [my photo] as Newsprint with asciify-engine: fine Floyd–Steinberg diffusion in soft black on warm paper. Show it on [our press page] and export a 2480×3508 PNG poster at the same grain.”

```ts
import { mountStudio, studioLook } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: studioLook('print'),
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 131072, // dither cells are fine
});
```

## handheld: Pocket camera
Category: Dither
Use it for: a nostalgic, low-fi portrait or pet photo; game and music artwork.
Settings: `studioLook('handheld')`: Bayer 4×4 ordered dither, scale 2, four graphite tones `#121211 #3e3d39 #8a8880 #dedbd2`.

Prompt:
“Make [my photo] look like it came off a pocket camera with asciify-engine: a four-tone ordered dither in graphite. Export a 1080×1350 PNG for a post, and a 1290×2796 phone wallpaper.”

```ts
import { mountStudio, studioLook } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: studioLook('handheld'),
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 131072,
});
```

## riso: Two inks
Category: Dither
Use it for: posters, gig flyers and covers with a printed, two-color feel on warm paper.
Settings: `studioLook('riso')`: Atkinson dither, scale 2, paper `#f0ece3` with coral `#c27461` and blue `#3d5068`.

Prompt:
“Turn [my photo] into a two-ink riso-style print with asciify-engine: Atkinson dither in muted blue and coral on warm paper. Make a 2480×3508 poster PNG, and let me swap the two inks for [our brand colors] without changing the grain.”

```ts
import { mountStudio, studioLook } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: studioLook('riso'),
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 131072,
});
// Swap inks; colors replace the palette array in order (paper first):
art.update({ ink: '#1f3b73', dither: { colors: ['#f0ece3', '#e0674a', '#1f3b73'] } });
```

## dots: Halftone
Category: Print
Use it for: a bold, graphic portrait; band posters, covers and dark heroes that read from far away.
Settings: dots style, 5px cells, `#e6e3da` on `#0b0b0a`, contrast 1.3, brightness .15.

Prompt:
“Make [my photo] a halftone artwork with asciify-engine: round dots in paper white on near black whose size carries the image. Export a 2160×2700 PNG and a 3840×2160 wallpaper at the same dot size.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'dots', cellSize: 5, ink: '#e6e3da',
    backdrop: { mode: 'solid', color: '#0b0b0a' },
    color: { contrast: 1.3, brightness: .15 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
```

## cmyk: Four-color press
Category: Print
Use it for: bright, saturated product and still-life photos as a pop print; packaging, merch and posters.
Settings: CMYK style, 5px cells, source color; it always prints on white paper.

Prompt:
“Print [my product photo] as a four-color press halftone with asciify-engine: offset cyan, magenta, yellow and black dots on white paper, in the photo's colors. Export a 2480×3508 poster PNG.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: { style: 'cmyk', cellSize: 5, colorMode: 'source' },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
```

## stipple: Stipple
Category: Print
Use it for: a quiet, drawn portrait in fine dots; book covers, editorial portraits, dark wallpapers.
Settings: stipple style, 4px cells, `#e6e3da` on `#0b0b0a`, contrast 1.35, brightness .2, midtones 1.3.

Prompt:
“Draw [my portrait] in stipple with asciify-engine: thousands of fine paper-white dots on near black, scattered so the light shapes the face. Export a 2480×3508 PNG for a book cover.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'stipple', cellSize: 4, ink: '#e6e3da',
    backdrop: { mode: 'solid', color: '#0b0b0a' },
    color: { contrast: 1.35, brightness: .2, gamma: 1.3 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 131072,
});
```

## engraving: Banknote
Category: Print
Use it for: architecture, portraits and objects as a steel engraving; certificates, invitations, premium light-theme heroes.
Settings: engraving style, 5px cells, dark ink `#22201c` on paper `#ece8de`, `print.invert: true`, angle −35, weight 1.1, contrast 1.25.

Prompt:
“Engrave [my photo] like a banknote with asciify-engine: parallel cuts in dark ink on warm paper whose weight follows the shadows. Export a 2480×3508 PNG, and keep the line angle adjustable.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'engraving', cellSize: 5, ink: '#22201c',
    backdrop: { mode: 'solid', color: '#ece8de' },
    print: { invert: true, angle: -35, weight: 1.1 },
    color: { contrast: 1.25 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 131072,
});
art.update({ print: { angle: 20 } }); // keeps the other print settings
```

## crosshatch: Pen and ink
Category: Print
Use it for: sculpture, portraits and figures drawn in crossing pen lines; editorial illustration and posters.
Settings: crosshatch style, 5px cells, `#22201c` on `#ece8de`, `print.invert: true`.

Prompt:
“Draw [my photo] in pen and ink with asciify-engine: crossing hatch lines in dark ink on warm paper, building up in the shadows. Export a 2480×3508 PNG illustration.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'crosshatch', cellSize: 5, ink: '#22201c',
    backdrop: { mode: 'solid', color: '#ece8de' },
    print: { invert: true },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 131072,
});
```

## pointillism: Pointillist
Category: Print
Use it for: still lifes, fruit, flowers and landscapes as a painted canvas; gallery-style wallpapers.
Settings: pointillism style, 3px cells, source color, brightness .25, saturation 1.3 on `#0b0b0a`.

Prompt:
“Paint [my photo] in pointillist strokes with asciify-engine: small dabs of the photo's own colors on black, like a Seurat up close. Export a 3840×2160 PNG wallpaper.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'pointillism', cellSize: 3, colorMode: 'source', print: { weight: 1.6, density: 1.3 },
    backdrop: { mode: 'solid', color: '#0b0b0a' },
    color: { brightness: .25, saturation: 1.3 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 131072,
});
```

## woodblock: Woodcut
Category: Print
Use it for: landscapes and silhouettes with big tonal masses as a carved woodblock print on paper; book covers, labels and outdoor brand artwork.
Settings: woodblock style, 8px cells, `#1d1a16` on `#ebe3d2`, `print.invert: true`, level bands (angle 0), roughness .3, weight .9, contrast 1.2, white point .7 so the sky stays bare paper, midtones 1.6 and shadows .3 so each ridge keeps its own band.

Prompt:
“Carve [my landscape photo] as a woodcut with asciify-engine: broad, rough-edged bands in dark ink on warm paper, stepping through a few tones. Export a 2480×3508 PNG print.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'woodblock', cellSize: 8, ink: '#1d1a16',
    backdrop: { mode: 'solid', color: '#ebe3d2' },
    print: { invert: true, angle: 0, roughness: .3, weight: .9 },
    color: { contrast: 1.2, whitePoint: .7, gamma: 1.6, shadows: .3 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 131072,
});
```

## risograph: Riso duotone
Category: Print
Use it for: bright, saturated photos (pools, sport, summer) as a two-screen riso print with offset registration; zines, gig posters and summer campaigns.
Settings: risograph style, 5px cells, source color for the first screen, a coral `#f2594b` second screen overprinted on warm areas, on `#f4ebd0`, density 1.2, registration .35.

Prompt:
“Print [my photo] as a riso duotone with asciify-engine: a dot screen in the photo's own colors with a coral second screen overprinted slightly out of register on the warm areas, on cream paper. Export a 2480×3508 PNG poster.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'risograph', cellSize: 5, colorMode: 'source', ink: '#2853a5',
    backdrop: { mode: 'solid', color: '#f4ebd0' },
    print: { secondaryInk: '#f2594b', registration: .35, density: 1.2 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 131072,
});
// With colorMode 'accent' both screens use ink and secondaryInk; print.invert puts the ink in the shadows.
art.update({ print: { registration: .1 } }); // tighter registration
```

## mosaic: Mosaic study
Category: Tiles
Use it for: colorful subjects as separated tiles; gallery walls, covers and calm wallpapers.
Settings: `studioLook('mosaic')`: mosaic style, 9px cells, source color at saturation .55, contrast 1.05 on `#0b0b0a`.

Prompt:
“Lay [my photo] out as a mosaic with asciify-engine: separated square tiles in the photo's own colors, softened, on near black. Export a 2160×2160 square and a 3840×2160 wallpaper.”

```ts
import { mountStudio, studioLook } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: studioLook('mosaic'),
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 32768,
});
```

## bricks: Brickwork
Category: Tiles
Use it for: a toy-brick build of a photo; playful posters, kids' and game artwork.
Settings: `studioLook('bricks')`: lego style, 12px studded cells, source color at saturation .55 on `#0b0b0a`.

Prompt:
“Build [my photo] out of toy bricks with asciify-engine: studded square bricks in softened source colors on black. Export a 2160×2160 PNG and show the live version on [our page] with the cursor rippling through it.”

```ts
import { mountStudio, studioLook } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: { ...studioLook('bricks'), hover: { effect: 'water', radius: .35 } },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 32768,
});
```

## voxel: Little volumes
Category: Tiles
Use it for: a photo as small isometric blocks; game, 3D and product artwork with depth.
Settings: `studioLook('voxel')`: voxel style, 12px cells, source color at saturation .5 on `#0b0b0a`.

Prompt:
“Rebuild [my photo] as little isometric volumes with asciify-engine: three-face voxel tiles in muted source colors on black. Export a 3840×2160 PNG wallpaper.”

```ts
import { mountStudio, studioLook } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: studioLook('voxel'),
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 32768,
});
```

## disco: Mirror room
Category: Tiles
Use it for: night scenes, music and event artwork as faceted mirror tiles under one light.
Settings: `studioLook('disco')`: disco style, 11px cells, source color at saturation .5, one soft light at (.35, .25).

Prompt:
“Turn [my photo] into a mirror-ball artwork with asciify-engine: faceted tiles in muted source colors under one soft light. Export a 2160×2700 PNG for an event poster, and move the light to [the top right].”

```ts
import { mountStudio, studioLook } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: studioLook('disco'),
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 32768,
});
art.update({ lights: [{ x: .75, y: .2, radius: .28, intensity: .28, color: '#f4efe4' }] }); // arrays replace
```

## pixel: Pixel
Category: Tiles
Use it for: an eight-bit take on a colorful photo; game, music and avatar artwork.
Settings: pixel style, 6px cells, source color at saturation .85 on `#0b0b0a`.

Prompt:
“Pixelate [my photo] into clean eight-bit art with asciify-engine: square pixels in the photo's colors at 6px. Export a 1080×1080 avatar and a 3840×2160 wallpaper with crisp, unsmoothed pixels.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'pixel', cellSize: 6, colorMode: 'source',
    backdrop: { mode: 'solid', color: '#0b0b0a' },
    color: { saturation: .85 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
```

## hex: Honeycomb
Category: Tiles
Use it for: landscapes, water and skies as hexagonal tiles; calm wallpapers and section artwork.
Settings: hex style, 7px cells, source color at saturation .6 on `#0b0b0a`.

Prompt:
“Tile [my landscape photo] as a honeycomb with asciify-engine: hexagonal cells in the photo's softened colors on black. Export a 3840×2160 desktop wallpaper and a 1290×2796 phone version.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'hex', cellSize: 7, colorMode: 'source',
    backdrop: { mode: 'solid', color: '#0b0b0a' },
    color: { saturation: .6 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
```

## led: Scoreboard
Category: Tiles
Use it for: cities, stages and night photos as a wall of round emitters; event, sport and music artwork.
Settings: LED style, 5px cells, source color at saturation 1.2, contrast 1.1, brightness .2 on `#0b0b0a`.

Prompt:
“Show [my photo] on an LED wall with asciify-engine: round emitters in the photo's colors on black, like a stadium scoreboard. Play [my video] through it live in [the hero], and export a 1920×1080 MP4.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-video.mp4', {
  settings: {
    style: 'led', cellSize: 5, colorMode: 'source',
    backdrop: { mode: 'solid', color: '#0b0b0a' },
    color: { saturation: 1.2, contrast: 1.1, brightness: .2 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 32768,
});
```
