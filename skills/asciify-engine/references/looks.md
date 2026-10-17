# Asciify looks

Finished artwork looks for a person's own photo, video or GIF: wallpapers, posters, album and cover art, hero artwork, prints and social images. Each look has the prompt a person gives you and the exact `/studio` settings that reproduce it. Every look is shown live at https://asciify.org/looks on the site's sample images, and opens in the editor at https://asciify.org/editor with the same settings.

These are artworks, not interface components. For a loading state, a background behind text or another UI piece, use [components.md](components.md) and the kit instead.

Twelve looks are the engine's curated presets: apply them with `studioLook(id)` and enumerate `STUDIO_LOOKS` rather than copying their values. The others are written out in full settings for render styles the presets do not cover. All of them use the `asciify-engine/studio` entry ([studio-workspace.md](studio-workspace.md), [print-styles.md](print-styles.md)); nothing is uploaded, and the person's media stays in the browser.

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

- The person names a look, or describes one ("newsprint", "riso", "phosphor", "Lego", "engraving"): use the entry, then adjust only what they asked for.
- Dark, contrasty sources (a subject on black, night scenes) suit character looks and source-color tiles. Bright, high-key sources (white architecture, paper, daylight) suit the paper-ground looks: Newsprint, Two inks, Banknote, Four-color press.
- Subjects with strong local color (fruit, fish, birds, a painting) suit source-color looks: Mosaic study, Brickwork, Pixel, Honeycomb, Pointillist.
- Keep artwork with motion off for video sources unless asked; the footage already moves.
- Say in one line which look you chose and offer one alternative from this file.

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
Settings: dots style, 6px cells, `#e6e3da` on `#0b0b0a`, contrast 1.15, brightness .05.

Prompt:
“Make [my photo] a halftone artwork with asciify-engine: round dots in paper white on near black whose size carries the image. Export a 2160×2700 PNG and a 3840×2160 wallpaper at the same dot size.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'dots', cellSize: 6, ink: '#e6e3da',
    backdrop: { mode: 'solid', color: '#0b0b0a' },
    color: { contrast: 1.15, brightness: .05 },
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
Settings: stipple style, 4px cells, `#e6e3da` on `#0b0b0a`, contrast 1.25, brightness .08.

Prompt:
“Draw [my portrait] in stipple with asciify-engine: thousands of fine paper-white dots on near black, scattered so the light shapes the face. Export a 2480×3508 PNG for a book cover.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'stipple', cellSize: 4, ink: '#e6e3da',
    backdrop: { mode: 'solid', color: '#0b0b0a' },
    color: { contrast: 1.25, brightness: .08 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 131072,
});
```

## engraving: Banknote
Category: Print
Use it for: architecture, portraits and objects as a steel engraving; certificates, invitations, premium light-theme heroes.
Settings: engraving style, 5px cells, dark ink `#22201c` on paper `#ece8de`, `print.invert: true`, angle −35, weight 1.1.

Prompt:
“Engrave [my photo] like a banknote with asciify-engine: parallel cuts in dark ink on warm paper whose weight follows the shadows. Export a 2480×3508 PNG, and keep the line angle adjustable.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'engraving', cellSize: 5, ink: '#22201c',
    backdrop: { mode: 'solid', color: '#ece8de' },
    print: { invert: true, angle: -35, weight: 1.1 },
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
Settings: pointillism style, 3px cells, source color, brightness .1, saturation 1.1 on `#0b0b0a`.

Prompt:
“Paint [my photo] in pointillist strokes with asciify-engine: small dabs of the photo's own colors on black, like a Seurat up close. Export a 3840×2160 PNG wallpaper.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'pointillism', cellSize: 3, colorMode: 'source', print: { weight: 1.6, density: 1.3 },
    backdrop: { mode: 'solid', color: '#0b0b0a' },
    color: { brightness: .1, saturation: 1.1 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 131072,
});
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
Settings: LED style, 6px cells, source color at saturation .7, contrast 1.1 on `#0b0b0a`.

Prompt:
“Show [my photo] on an LED wall with asciify-engine: round emitters in the photo's colors on black, like a stadium scoreboard. Play [my video] through it live in [the hero], and export a 1920×1080 MP4.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-video.mp4', {
  settings: {
    style: 'led', cellSize: 6, colorMode: 'source',
    backdrop: { mode: 'solid', color: '#0b0b0a' },
    color: { saturation: .7, contrast: 1.1 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 32768,
});
```
