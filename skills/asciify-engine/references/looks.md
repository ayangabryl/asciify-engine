# Asciify looks

Finished artwork looks for a person's own photo, video or GIF: wallpapers, posters, album and cover art, hero artwork, prints and social images. Each look has the prompt a person gives you and the exact `/studio` settings that reproduce it. Every look is shown live at https://asciify.org/looks on a source image made for it, and opens in the editor at https://asciify.org/editor with the same settings. Every Studio render style has at least one look.

These are artworks, not interface components. For a loading state, a background behind text or another UI piece, use [components.md](components.md) and the kit instead.

Twelve looks are the engine's curated presets: apply them with `studioLook(id)` and enumerate `STUDIO_LOOKS` rather than copying their values. The others are written out in full settings: render styles the presets do not cover, Composed looks that use the backdrop (blur, the photo itself, gradients, transparency) and masks, and Finished looks that turn on the optical finish (vignette, grain, bloom, scanlines, fringe, blur), and Projects looks built for a job, which also fix the frame's `aspectRatio` (a square cover, a 3:4 poster, a 16:9 hero, a 9:16 lock screen) and name the export size. All of them use the `asciify-engine/studio` entry ([studio-workspace.md](studio-workspace.md), [print-styles.md](print-styles.md)); nothing is uploaded, and the person's media stays in the browser.

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

## Character sets

Every set is a first-class ramp, ordered by measured ink from empty to dense, and every one works in the Studio (`charset: CHARACTER_SETS.kanji.chars`), the glyph field and every kit component (`charset: 'kanji'`): Classic ASCII (`standard`), Asciify, Minimal, Detailed, Letters, Technical, Tonal blocks, Braille, Fish and Kanji (Japanese).

- **Fish** (`fish`, ` .'-,:;txoSX%#8@`): the ocean's letters as a ramp, specks and dashes for faint tones, `t o x` for the body, `S X % # 8 @` for the densest. A hand-set, organic texture for creatures, water and photos of living things.
- **Kanji (Japanese)** (`kanji`, ` 一二人小大中日本目田長間語書曜驚霧`): common Jōyō kanji ordered from the lightest strokes (一) to the heaviest (霧), measured the same way as the other sets. Drawn in square cells in the system Japanese faces (Hiragino Sans, Yu Gothic, Noto Sans JP), so the forms are Japanese. Suits bold, graphic subjects at cells of 8px and up; at very small cells it reads as a fine texture.

## How to choose

- The person names a look, or describes one ("newsprint", "riso", "phosphor", "Lego", "engraving", "film still"): use the entry, then adjust only what they asked for.
- Dark, contrasty sources (a subject on black, night scenes) suit character looks and source-color tiles. Bright, high-key sources (white architecture, paper, daylight) suit the paper-ground looks: Newsprint, Two inks, Banknote, Four-color press, Riso duotone, Woodcut, Overprint.
- Subjects with strong local color (fruit, fish, birds, a painting) suit source-color looks: Mosaic study, Brickwork, Pixel, Honeycomb, Pointillist, ANSI blocks, Jewel box.
- The person names a job (album cover, magazine portrait, product hero, poster, postcard, lookbook, game box art, sticker, lock screen): use its Projects entry; it sets the frame and the export size.
- The artwork goes over something else (video, a gradient, a brand color, a product page): use a transparent look (Cutout, Halo overlay) and export PNG, which keeps the alpha.
- The person wants the photo itself to stay present: Frosted glass and Bokeh draw over its blur, Overprint over the sharp original.
- The person asks for a grade, film, broadcast or vintage feel: use a Finished look. Finish effects need WebGL; check `art.capabilities.gpuFinish` and say so when it is unavailable.
- Keep artwork with motion off for video sources unless asked; the footage already moves.
- Say in one line which look you chose and offer one alternative from this file.

## album: Album cover
Category: Projects
Use it for: a performer or portrait lit by colored light, as a square record or single cover; streaming artwork and gig visuals.
Settings: dots, 5px cells, square 1:1, source color at saturation 1.35 on `#060608`, character glow .35, vignette .3, grain .12. Export 3000×3000.

Prompt:
“Make [my photo] into a square album cover with asciify-engine: halftone dots in the photo's own colored light on black, a soft glow, a vignette and fine grain. Export a 3000×3000 PNG for the streaming stores.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    aspectRatio: '1:1', style: 'dots', cellSize: 5, colorMode: 'source',
    backdrop: { mode: 'solid', color: '#060608' },
    color: { saturation: 1.35, brightness: .1, contrast: 1.1 },
    effects: { characterBloom: .35, vignette: .3, grain: .12 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
// Export with the same settings ("Export a wallpaper, poster or loop" above): { format: 'png', width: 3000, height: 3000, referenceWidth: 720, maxCells: 262144 }
// A fixed aspectRatio letterboxes the artwork inside the canvas; size the frame to match.
```

## editorial: Editorial
Category: Projects
Use it for: a magazine-style portrait engraved in fine ink on warm paper, in a 3:4 cover frame; features, interviews, about pages and print.
Settings: engraving, 4px cells, 3:4, `#1b1a18` on `#f2eee6`, `print.invert: true`, angle −40, weight 1.15, contrast 1.4, midtones .85. Export 2400×3200.

Prompt:
“Engrave [my portrait] as an editorial cover with asciify-engine: fine parallel cuts in near-black ink on warm paper, in a 3:4 frame with room above the head for a masthead. Export a 2400×3200 PNG.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    aspectRatio: '3:4', style: 'engraving', cellSize: 4, ink: '#1b1a18',
    backdrop: { mode: 'solid', color: '#f2eee6' },
    print: { invert: true, angle: -40, weight: 1.15 },
    color: { contrast: 1.4, gamma: .85 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 131072,
});
// Export with the same settings ("Export a wallpaper, poster or loop" above): { format: 'png', width: 2400, height: 3200, referenceWidth: 600, maxCells: 262144 }
// A fixed aspectRatio letterboxes the artwork inside the canvas; size the frame to match.
```

## product: Studio product
Category: Projects
Use it for: a product on a plain backdrop, painted in small strokes of its own colors over a soft studio gradient; product heroes, launch pages and packaging shots.
Settings: pointillism, 3px cells, source color at saturation 1.35, `print.invert: true` so the product carries the strokes, density 1.3, over a gradient from `#f4f1ec` to `#dcd5ca`. Export 3200×2400.

Prompt:
“Redraw [my product photo] for a product hero with asciify-engine: small pigment strokes in the product's own colors, gathered where it is darkest and richest, over a soft warm-grey studio gradient. Export a 3200×2400 PNG and keep it live on [the product page].”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'pointillism', cellSize: 3, colorMode: 'source',
    backdrop: { mode: 'gradient', color: '#f4f1ec', color2: '#dcd5ca' },
    print: { invert: true, density: 1.3, weight: 1.2 },
    color: { saturation: 1.35, contrast: 1.25 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
// Export with the same settings ("Export a wallpaper, poster or loop" above): { format: 'png', width: 3200, height: 2400, referenceWidth: 960, maxCells: 262144 }
```

## concrete: Concrete poster
Category: Projects
Use it for: architecture with a strong repeating structure, cut as cream engraving into a terracotta poster; exhibition, property and city posters.
Settings: engraving, 4px cells, 3:4, cream `#f3e9d8` on terracotta `#a8432a`, angle 0, weight 1.2, contrast 1.6, midtones .8. Export 2400×3200.

Prompt:
“Make [my architecture photo] a poster with asciify-engine: level cream engraving cuts on a terracotta ground, in a 3:4 frame. Export a 2400×3200 PNG and let me swap the ground for [our color].”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    aspectRatio: '3:4', style: 'engraving', cellSize: 4, ink: '#f3e9d8',
    backdrop: { mode: 'solid', color: '#a8432a' },
    print: { angle: 0, weight: 1.2 },
    color: { contrast: 1.6, gamma: .8 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 131072,
});
// Export with the same settings ("Export a wallpaper, poster or loop" above): { format: 'png', width: 2400, height: 3200, referenceWidth: 600, maxCells: 262144 }
// A fixed aspectRatio letterboxes the artwork inside the canvas; size the frame to match.
```

## postcard: Postcard
Category: Projects
Use it for: sunny travel photos as a vintage travel poster in five flat inks; postcards, travel guides, tourism and summer campaigns.
Settings: dither, Atkinson at scale 3, five-ink palette navy `#16324f`, teal `#2f7f86`, mustard `#e9b44c`, coral `#e76f51`, cream `#f4ead5`. Export 2400×1800.

Prompt:
“Print [my travel photo] as a vintage travel postcard with asciify-engine: Atkinson dither in five flat inks (navy, teal, mustard, coral and cream). Export a 2400×1800 PNG.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'dither', cellSize: 6, ink: '#16324f',
    backdrop: { mode: 'solid', color: '#f4ead5' },
    color: { saturation: 1.2, contrast: 1.1 },
    dither: { algorithm: 'atkinson', palette: 'custom', colors: ['#16324f', '#2f7f86', '#e9b44c', '#e76f51', '#f4ead5'], scale: 3 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 131072,
});
// Export with the same settings ("Export a wallpaper, poster or loop" above): { format: 'png', width: 2400, height: 1800, referenceWidth: 960, maxCells: 262144 }
```

## botanical: Botanical plate
Category: Projects
Use it for: a single flower, leaf or specimen on a plain ground as a hand-colored botanical plate; prints, packaging, wellness and garden brands.
Settings: crosshatch, 4px cells, 3:4, source color at saturation 1.3 on paper `#f3efe4`, `print.invert: true`. Export 2480×3307.

Prompt:
“Draw [my flower photo] as a botanical plate with asciify-engine: crossing pen lines in the flower's own colors on warm paper, in a 3:4 frame. Export a 2480×3307 PNG to print.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    aspectRatio: '3:4', style: 'crosshatch', cellSize: 4, colorMode: 'source',
    backdrop: { mode: 'solid', color: '#f3efe4' },
    print: { invert: true },
    color: { saturation: 1.3, contrast: 1.15 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 131072,
});
// Export with the same settings ("Export a wallpaper, poster or loop" above): { format: 'png', width: 2480, height: 3307, referenceWidth: 620, maxCells: 262144 }
// A fixed aspectRatio letterboxes the artwork inside the canvas; size the frame to match.
```

## stadium: Stadium
Category: Projects
Use it for: athletes and action against a pale, open sky as a bold two-ink halftone poster; sports, events, fitness and match-day graphics.
Settings: dither, halftone at scale 3, 3:4, red `#d7322a` and black `#151413` on cream `#f2ebdd`, contrast 1.35, white point .85 so the pale sky stays paper, midtones .85. Export 2400×3200.

Prompt:
“Make [my sports photo] a match-day poster with asciify-engine: a bold halftone in red and black on cream, in a 3:4 frame. Export a 2400×3200 PNG.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    aspectRatio: '3:4', style: 'dither', cellSize: 6, ink: '#151413',
    backdrop: { mode: 'solid', color: '#f2ebdd' },
    color: { contrast: 1.35, whitePoint: .85, gamma: .85 },
    dither: { algorithm: 'halftone', palette: 'custom', colors: ['#f2ebdd', '#d7322a', '#151413'], scale: 3 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 131072,
});
// Export with the same settings ("Export a wallpaper, poster or loop" above): { format: 'png', width: 2400, height: 3200, referenceWidth: 600, maxCells: 262144 }
// A fixed aspectRatio letterboxes the artwork inside the canvas; size the frame to match.
```

## lookbook: Lookbook
Category: Projects
Use it for: full-length fashion and product shots on a pale studio ground, stippled in the garment colors; lookbooks, shop pages and campaign posters.
Settings: stipple, 3px cells, 3:4, source color at saturation 1.5, `print.invert: true`, density 1.4, weight 1.3, on off-white `#efebe4`; the pale set stays bare paper and the garment carries the dots. Export 2400×3200.

Prompt:
“Set [my fashion photo] as a lookbook page with asciify-engine: fine stipple in the garment's own colors on an off-white ground, the pale set left as bare paper, in a 3:4 frame. Export a 2400×3200 PNG.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    aspectRatio: '3:4', style: 'stipple', cellSize: 3, colorMode: 'source',
    backdrop: { mode: 'solid', color: '#efebe4' },
    print: { invert: true, density: 1.4, weight: 1.3 },
    color: { saturation: 1.5, contrast: 1.3 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
// Export with the same settings ("Export a wallpaper, poster or loop" above): { format: 'png', width: 2400, height: 3200, referenceWidth: 600, maxCells: 262144 }
// A fixed aspectRatio letterboxes the artwork inside the canvas; size the frame to match.
```

## nightcity: Night city
Category: Projects
Use it for: neon streets, rain and city lights as a glowing 16:9 cyberpunk frame; game, music, tech and event heroes.
Settings: dots, 4px cells, 16:9, source color at saturation 1.5, brightness .25, character glow .45, RGB split .15, scanlines .12, vignette .3. Export 3840×2160.

Prompt:
“Make [my night street photo] a cyberpunk frame with asciify-engine: halftone dots in the neon's own colors with a strong glow, a slight RGB split, faint scanlines and a vignette, in 16:9. Show it live in [the hero] and export a 3840×2160 PNG.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    aspectRatio: '16:9', style: 'dots', cellSize: 4, colorMode: 'source',
    backdrop: { mode: 'solid', color: '#05050a' },
    color: { saturation: 1.5, brightness: .25, gamma: 1.3 },
    effects: { characterBloom: .45, rgbSplit: .15, scanlines: .12, vignette: .3 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
// Export with the same settings ("Export a wallpaper, poster or loop" above): { format: 'png', width: 3840, height: 2160, referenceWidth: 960, maxCells: 262144 }
// A fixed aspectRatio letterboxes the artwork inside the canvas; size the frame to match.
```

## sumi: Sumi ink
Category: Projects
Use it for: quiet, misty subjects with lots of empty space as an ink-wash study; tea, wellness, calm brands and minimal print.
Settings: stipple, 4px cells, sumi `#161513` on washi `#efe8da`, `print.invert: true`, density 1.3, weight 1.3, contrast 1.6. Export 3000×2250.

Prompt:
“Paint [my photo] as a sumi ink study with asciify-engine: fine ink dots on warm washi paper that gather only in the darks, leaving the mist as bare paper. Export a 3000×2250 PNG.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'stipple', cellSize: 4, ink: '#161513',
    backdrop: { mode: 'solid', color: '#efe8da' },
    print: { invert: true, density: 1.3, weight: 1.3 },
    color: { contrast: 1.6 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 131072,
});
// Export with the same settings ("Export a wallpaper, poster or loop" above): { format: 'png', width: 3000, height: 2250, referenceWidth: 960, maxCells: 262144 }
```

## wirephoto: Wire photo
Category: Projects
Use it for: news-like and historic moments as a grainy wire-service halftone on newsprint; anniversaries, timelines, editorial and documentary pages.
Settings: dither, halftone at scale 2, `#1c1b18` on newsprint `#e9e3d6`, contrast 1.25, white point .72 so the sky and smoke print as clean paper, shadows lifted .35, grain .3, vignette .2. Export 2400×1800.

Prompt:
“Print [my photo] like a wire photo in an old newspaper with asciify-engine: a coarse black halftone on yellowed newsprint with grain and a soft vignette. Export a 2400×1800 PNG.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'dither', cellSize: 6, ink: '#1c1b18',
    backdrop: { mode: 'solid', color: '#e9e3d6' },
    color: { contrast: 1.25, whitePoint: .72, shadows: .35 },
    dither: { algorithm: 'halftone', palette: 'custom', colors: ['#e9e3d6', '#1c1b18'], scale: 2 },
    effects: { grain: .3, vignette: .2 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 131072,
});
// Export with the same settings ("Export a wallpaper, poster or loop" above): { format: 'png', width: 2400, height: 1800, referenceWidth: 960, maxCells: 262144 }
```

## gamebox: Game box
Category: Projects
Use it for: fantasy and adventure scenes as 16-color box art from an old cartridge; indie game pages, streams and merch.
Settings: dither, Bayer 4×4 at scale 3, PICO-8 palette, saturation 1.2. Export 1200×900.

Prompt:
“Make [my fantasy illustration or photo] into retro game box art with asciify-engine: a Bayer 4×4 dither in the 16-color PICO-8 palette with chunky pixels. Export a 1200×900 PNG with crisp, unsmoothed pixels.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'dither', cellSize: 6, ink: '#fff1e8',
    backdrop: { mode: 'solid', color: '#000000' },
    color: { saturation: 1.2, contrast: 1.1 },
    dither: { algorithm: 'bayer4', palette: 'pico8', scale: 3 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 131072,
});
// Export with the same settings ("Export a wallpaper, poster or loop" above): { format: 'png', width: 1200, height: 900, referenceWidth: 960, maxCells: 262144 }
```

## sticker: Mascot sticker
Category: Projects
Use it for: a character, toy or logo mark on a plain dark ground as a chunky transparent sticker; mascots, app icons, chat stickers and merch.
Settings: blocks, 5px cells, square 1:1, source color at saturation 1.4, transparent backdrop. Export 2048×2048.

Prompt:
“Turn [my mascot on a dark background] into a sticker with asciify-engine: shaded blocks in its own colors on a transparent ground, square. Export a transparent 2048×2048 PNG.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    aspectRatio: '1:1', style: 'blocks', cellSize: 5, colorMode: 'source',
    backdrop: { mode: 'transparent' },
    color: { saturation: 1.4, contrast: 1.15, brightness: .05 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
// Export with the same settings ("Export a wallpaper, poster or loop" above): { format: 'png', width: 2048, height: 2048, referenceWidth: 720, maxCells: 262144 }
// PNG keeps the transparency; JPEG and MP4 fill it with black.
```

## lockscreen: Lock screen
Category: Projects
Use it for: tall subjects (waterfalls, trees, towers, a standing figure) as a 9:16 phone wallpaper with glowing dots over a deep gradient.
Settings: dots, 4px cells, 9:16, source color at saturation 1.3 over a gradient from `#04120d` to `#12332a`, character glow .3. Export 1290×2293.

Prompt:
“Make [my photo] a phone lock screen with asciify-engine: dots in the photo's own colors with a soft glow over a deep green gradient, in 9:16 with the subject down the middle. Export a 1290×2293 PNG and a 1080×1920 version.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    aspectRatio: '9:16', style: 'dots', cellSize: 4, colorMode: 'source',
    backdrop: { mode: 'gradient', color: '#04120d', color2: '#12332a' },
    color: { saturation: 1.3, brightness: .1, contrast: 1.1 },
    effects: { characterBloom: .3 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
// Export with the same settings ("Export a wallpaper, poster or loop" above): { format: 'png', width: 1290, height: 2293, referenceWidth: 430, maxCells: 262144 }
// A fixed aspectRatio letterboxes the artwork inside the canvas; size the frame to match.
```

## frost: Frosted glass
Category: Composed
Use it for: sunsets, skylines and silhouettes as white frost characters over a soft, full-color blur of the photo; premium wallpapers and covers.
Settings: ASCII, 5px cells, ink `#121110` with the tone curve inverted so shadows carry the characters, over the source blurred 24px at full opacity.

Prompt:
“Frost [my photo] like glass with asciify-engine: fine white characters where the photo is bright, over a soft, full-color blur of the same photo, so dark shapes stay clean silhouettes. Export a 3200×2400 PNG wallpaper.”

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
“Turn [my photo] into a bokeh artwork with asciify-engine: halftone dots in the photo's own colors, slightly brighter, floating over a deep blur of the same photo with a soft glow. Export a 3200×2400 PNG.”

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
Settings: mixed type, 5px cells, source color at saturation 1.8, contrast 1.3, a `#7d7368` multiply tint at .45, transparent backdrop; the tint pulls white areas down to mid-tones, so every mark reads on light and dark grounds alike.

Prompt:
“Cut [my subject on a dark background] out as an ASCII sticker with asciify-engine: fine mixed type in the photo's colors on a transparent ground, so only the subject remains. Place it over [our brand color] in the hero and export a transparent 2400×1800 PNG.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'mixed', cellSize: 5, colorMode: 'source',
    backdrop: { mode: 'transparent' },
    color: { saturation: 1.8, contrast: 1.3, tint: '#7d7368', amount: .45, blend: 'multiply' },
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
“Make [my photo] a glowing dot overlay with asciify-engine: white halftone dots with a soft halo on a transparent ground, so it sits over [our hero gradient]. Keep the canvas pointer-events free and export a transparent 3200×2400 PNG.”

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
“Draw [my photo] in warm light characters over a dusk gradient with asciify-engine: violet into ember, the characters glowing softly. Export a 3200×2400 PNG poster and let me swap the two gradient colors for [our palette].”

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
“Light [my night photo] up as neon with asciify-engine: fine characters in the photo's own saturated colors, each glowing like a lit tube, on black. Play it live in [the hero] and export a 3200×2400 PNG.”

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
“Set [my photo] in cream characters on deep cobalt blue with asciify-engine, like a gallery poster. Export a 3200×2400 PNG, and let me swap the blue for [our brand color] without changing the ink.”

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
“Engrave [my portrait] inside an oval cameo with asciify-engine: fine parallel cuts in dark ink on warm paper, only within a centered oval, the paper plain around it. Export a 3200×2400 PNG for an invitation.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'engraving', cellSize: 4, ink: '#2a2620',
    backdrop: { mode: 'solid', color: '#ece6d8' },
    print: { invert: true, angle: -30, weight: 1.05 },
    mask: { enabled: true, shapes: [{ kind: 'ellipse', x: .32, y: .12, width: .36, height: .76 }] },
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
“Engrave [my product photo] in gold on black with asciify-engine: fine parallel cuts in warm gold whose weight follows the light, with a faint glow. Export a 3200×2400 PNG wallpaper.”

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
Use it for: bright photos with hard, graphic shadows, where the shadows fill with type over the sharp original; travel, editorial and summer campaign artwork.
Settings: ASCII, 6px cells, deep teal `#0b2530` ink, plain levels and a steep inverted tone curve so only the shadows carry type, over the source photo at full opacity.

Prompt:
“Overprint [my bright photo] with asciify-engine: keep the photo sharp underneath and print deep teal characters only into its shadows, so the lit areas stay clean, like a type screen inked onto the print. Export a 3200×2400 PNG.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'ascii', cellSize: 6, ink: '#0b2530',
    backdrop: { mode: 'source', opacity: 1 },
    color: { levels: 'none', curves: { rgb: [[0, 1], [.3, 1], [.45, 0], [1, 0]] } },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
```

## cinema: Cinema
Category: Finished
Use it for: landscapes, roads and wide scenes as a film still: warm-white characters over the photo's own soft color, with a vignette, film grain and a little bloom; trailers, story heroes and posters.
Settings: ASCII, 4px cells, warm-white `#fff1de` ink over the source blurred 14px, contrast 1.15, vignette .45, grain .22, bloom .15.

Prompt:
“Grade [my photo] like a film still with asciify-engine: fine warm-white characters over a soft blur of the photo's own colors, finished with a vignette, a little bloom and film grain. Export a 3200×2400 PNG and keep it live in [the hero].”

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
Settings: ASCII, 5px cells, `#efe6d6` on `#080706`, contrast 1.15, brightness .35, midtones 2, vignette .45, bloom .4, grain .12.

Prompt:
“Print [my photo] like it is coming up in a darkroom with asciify-engine: warm paper-white characters on black, a heavy vignette, a soft glow on the highlights and a little grain. Export a 3200×2400 PNG.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'ascii', cellSize: 5, ink: '#efe6d6',
    backdrop: { mode: 'solid', color: '#080706' },
    color: { contrast: 1.15, brightness: .35, gamma: 2 },
    effects: { vignette: .45, bloom: .4, grain: .12 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
```

## broadcast: Broadcast
Category: Finished
Use it for: space, sport and news-like photos as a live transmission: a fine pixel picture with scanlines, a chromatic fringe, RGB split and a slight tube curve; launch and live-event artwork.
Settings: pixel, 3px cells, source color at saturation 1.15, scanlines .35, prism .3, RGB split .25, CRT .15, vignette .25.

Prompt:
“Make [my photo] look like a live broadcast with asciify-engine: a fine pixel picture in the photo's colors on a screen with scanlines, a chromatic fringe, a little RGB split and a slight tube curve. Show it live in [the hero] and export a 1920×1440 PNG.”

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
“Run [my photo] through an old tape with asciify-engine: halftone dots in the photo's colors with glitch bands, an RGB split, faint scanlines and grain. Export a 2400×1800 PNG and a 6-second 2400×1800 MP4 loop.”

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
“Turn [my aerial photo] into a tilt-shift miniature with asciify-engine: small square pixels in boosted source colors, sharp through the middle band and blurring toward the top and bottom. Export a 3200×2400 PNG wallpaper.”

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
“Age [my photo] into an archive print with asciify-engine: warm sepia characters on dark brown with dust, film grain and a vignette, like a print found in a drawer. Export a 3200×2400 PNG.”

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
“Give [my photo] speed with asciify-engine: characters in the photo's colors streaking out from the center with a radial blur, glowing highlights and a vignette. Export a 1920×1440 PNG and keep it live in [the hero].”

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
“Print [my photo] as a pop comic page with asciify-engine: shaded blocks in the photo's saturated colors under a halftone screen, sharpened. Export a 3200×2400 PNG poster.”

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
Settings: `studioLook('ascii')`: ASCII, 4px cells, paper-white `#ece9e0` on `#0b0b0a`, contrast 1.25, midtones 1.25, character glow .12.

Prompt:
“Turn [my photo] into Signature ASCII artwork with asciify-engine: paper-white characters on near black, fine 4px cells with a faint glow. Show it live on a canvas that fills [the hero], let the cursor leave a soft trail, and add a button that downloads a 3200×2400 PNG wallpaper.”

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
Settings: `studioLook('night')`: ASCII, 4px cells, pale graphite `#cdc9be` on `#0b0b0a`, contrast 1.2, midtones 1.2, prism .2, scanlines .08, vignette .3, bloom .12.

Prompt:
“Make [my photo] a Night signal poster with asciify-engine: graphite characters on near black with a faint prism fringe, scanlines and a vignette. Export a 3200×2400 PNG poster and keep the settings so I can reuse the look.”

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
“Render [my video] in the Phosphor look with asciify-engine: soft sage characters on a near-black green, a faint glow, scanlines and a slight CRT curve. Play it live in [the hero], muted and looping, keep it still for reduced motion, and export a 2400×1800 PNG still.”

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
Settings: `studioLook('wallpaper')`: ASCII, `#e6e3da` ink over the source blurred 18px at .4 opacity on `#0b0b0a`, Relight motion at speed .35 and strength .8.

Prompt:
“Make [my photo] into a living wallpaper with asciify-engine: ASCII characters over a softened, blurred copy of the photo, with slow caustic light moving through them. Export one seamless loop as a 1920×1440 MP4 and a 3200×2400 PNG still.”

```ts
import { exportStudio, loadStudioMedia, studioLook } from 'asciify-engine/studio';

const settings = studioLook('wallpaper');
const media = await loadStudioMedia(file);
try {
  const loop = await exportStudio({ frame: () => media.frame(0) }, settings, {
    format: 'mp4', width: 1920, height: 1440, referenceWidth: 960, fps: 30,
    duration: 12 / settings.motion.speed, maxCells: 131072, // one full Relight orbit loops cleanly
  });
} finally { media.destroy(); }
```

## blueprint: Blueprint
Category: Characters
Use it for: architecture, machines and products drawn as technical linework; engineering and hardware heroes.
Settings: `studioLook('blueprint')`: lines style, 6px cells, pale blue `#b3c9d8` on navy `#0e1b28`.

Prompt:
“Turn [my product photo] into a Blueprint artwork with asciify-engine: fine line marks in pale blue on deep navy, like a technical drawing. Put it live behind [our hardware page's hero] with the copy kept clear, and export a 2400×1800 PNG.”

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
“Set [my photo] in mixed type with asciify-engine: a blend of character shapes in the photo's own colors on black, like a type specimen. Export a 3200×2400 PNG poster and a 2400×1800 version for social.”

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
“Draw [my photo] in ANSI blocks with asciify-engine: shaded block characters in the photo's own colors on black, like a BBS splash screen. Export a 3200×2400 PNG wallpaper.”

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
“Draw [my photo] in braille dots with asciify-engine: fine braille characters in the photo's own colors on black, so the light shapes read as clusters of dots. Export a 3200×2400 PNG wallpaper.”

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
“Stitch [my photo] in cross-stitch with asciify-engine: small crosses in the photo's colors on dark indigo cloth, like an embroidered sampler. Export a 2400×1800 PNG for a card.”

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
Settings: diagonal style (` /╱╳`), 4px cells, `#eef3f5` on blue-black `#10161b`, contrast 1.25, brightness .15, midtones 1.8.

Prompt:
“Draw [my photo] in slanted strokes with asciify-engine: diagonal line characters in cool grey on blue-black, like rain across the image. Export a 3200×2400 PNG.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'diagonal', cellSize: 4, ink: '#eef3f5',
    backdrop: { mode: 'solid', color: '#10161b' },
    color: { contrast: 1.25, brightness: .15, gamma: 1.8 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
```

## diamond: Jewel box
Category: Characters
Use it for: iridescent, richly colored subjects (feathers, gems, beetles, fabric) set in diamond characters; fashion, beauty and jewelry artwork.
Settings: diamond style (` ·◇◈◆`), 5px cells, source color at saturation 1.4, brightness .3, contrast 1.25, midtones 1.6, black point .15 on `#07070a`, character glow .35.

Prompt:
“Set [my photo] in diamond characters with asciify-engine: diamonds in the photo's jewel colors on black with a soft sparkle, solid where it is bright and outlined where it is dim. Export a 3200×2400 PNG.”

```ts
import { mountStudio } from 'asciify-engine/studio';

const art = await mountStudio(canvas, '/your-photo.jpg', {
  settings: {
    style: 'diamond', cellSize: 5, colorMode: 'source',
    backdrop: { mode: 'solid', color: '#07070a' },
    color: { saturation: 1.4, brightness: .3, contrast: 1.25, gamma: 1.6, blackPoint: .15 },
    effects: { characterBloom: .35 },
  },
  width: frame.clientWidth, height: frame.clientHeight, maxCells: 65536,
});
```

## print: Newsprint
Category: Dither
Use it for: bright, high-key photos as an editorial print; zines, press pages, quiet light-theme heroes.
Settings: `studioLook('print')`: Floyd–Steinberg dither, scale 2, `#1d1c19` on warm paper `#efece4`.

Prompt:
“Print [my photo] as Newsprint with asciify-engine: fine Floyd–Steinberg diffusion in soft black on warm paper. Show it on [our press page] and export a 3200×2400 PNG poster at the same grain.”

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
“Make [my photo] look like it came off a pocket camera with asciify-engine: a four-tone ordered dither in graphite. Export a 2400×1800 PNG for a post.”

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
“Turn [my photo] into a two-ink riso-style print with asciify-engine: Atkinson dither in muted blue and coral on warm paper. Make a 3200×2400 poster PNG, and let me swap the two inks for [our brand colors] without changing the grain.”

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
“Make [my photo] a halftone artwork with asciify-engine: round dots in paper white on near black whose size carries the image. Export a 3200×2400 PNG at the same dot size.”

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
“Print [my product photo] as a four-color press halftone with asciify-engine: offset cyan, magenta, yellow and black dots on white paper, in the photo's colors. Export a 3200×2400 poster PNG.”

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
“Draw [my portrait] in stipple with asciify-engine: thousands of fine paper-white dots on near black, scattered so the light shapes the face. Export a 3200×2400 PNG for a book cover.”

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
“Engrave [my photo] like a banknote with asciify-engine: parallel cuts in dark ink on warm paper whose weight follows the shadows. Export a 3200×2400 PNG, and keep the line angle adjustable.”

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
“Draw [my photo] in pen and ink with asciify-engine: crossing hatch lines in dark ink on warm paper, building up in the shadows. Export a 3200×2400 PNG illustration.”

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
“Paint [my photo] in pointillist strokes with asciify-engine: small dabs of the photo's own colors on black, like a Seurat up close. Export a 3200×2400 PNG wallpaper.”

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
“Carve [my landscape photo] as a woodcut with asciify-engine: broad, rough-edged bands in dark ink on warm paper, stepping through a few tones. Export a 3200×2400 PNG print.”

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
“Print [my photo] as a riso duotone with asciify-engine: a dot screen in the photo's own colors with a coral second screen overprinted slightly out of register on the warm areas, on cream paper. Export a 3200×2400 PNG poster.”

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
“Lay [my photo] out as a mosaic with asciify-engine: separated square tiles in the photo's own colors, softened, on near black. Export a 3200×2400 wallpaper and a 2400×1800 PNG.”

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
“Build [my photo] out of toy bricks with asciify-engine: studded square bricks in softened source colors on black. Export a 2400×1800 PNG and show the live version on [our page] with the cursor rippling through it.”

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
“Rebuild [my photo] as little isometric volumes with asciify-engine: three-face voxel tiles in muted source colors on black. Export a 3200×2400 PNG wallpaper.”

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
“Turn [my photo] into a mirror-ball artwork with asciify-engine: faceted tiles in muted source colors under one soft light. Export a 3200×2400 PNG for an event poster, and move the light to [the top right].”

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
“Pixelate [my photo] into clean eight-bit art with asciify-engine: square pixels in the photo's colors at 6px. Export a 3200×2400 wallpaper and a 2400×1800 PNG with crisp, unsmoothed pixels.”

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
“Tile [my landscape photo] as a honeycomb with asciify-engine: hexagonal cells in the photo's softened colors on black. Export a 3200×2400 desktop wallpaper.”

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
“Show [my photo] on an LED wall with asciify-engine: round emitters in the photo's colors on black, like a stadium scoreboard. Play [my video] through it live in [the hero], and export a 1920×1440 MP4.”

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
