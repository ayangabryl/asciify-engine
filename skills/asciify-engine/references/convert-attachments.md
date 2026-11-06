# Asciify an attachment (4.33)

Someone says asciify, or asks for ASCII art, text art, braille or block art, and gives you a picture, GIF, video, 3D model
or link. Convert it now with the `asciify-engine` command and hand back the result. Choose the options yourself from the
file and where the result is going; ask nothing about flags first, and offer one alternative afterwards. If they want the
art live on a web page, see [On their site](#on-their-site-not-a-file).

## 1. Find the file

| Where you run | Where the file is |
| --- | --- |
| Claude Code | A path in the message: dropping a file into the terminal pastes its path. |
| Claude apps (claude.ai, desktop, mobile) | `/mnt/user-data/uploads/` (list it). Write what you hand back to `/mnt/user-data/outputs/`. |
| Cursor, Codex and other coding agents | A path in the workspace, or the file the user named or @-mentioned. |
| A link | Pass an image, GIF or model URL straight to the command. Download a video first (`curl -L -o clip.mp4 <url>`): video is read from files only. A web page is not a picture: use the image they mean (or the page's `og:image`). A YouTube or other player page has no file to read: ask for the video file. |

A picture pasted into the conversation with no file behind it: check where this environment keeps uploads before you
decide (a Claude app saves them in `/mnt/user-data/uploads/`). If there is no file, say in one line that you need the file,
or its path, to convert it. Never draw a stand-in by hand: it would not be their picture.

Several files: one command each (the command takes one input).

## 2. Run the command

```sh
npx -y asciify-engine@latest --version
```

- It must print 4.33.0 or later, and needs Node 18 or later. The command arrived in 4.33.0: if npx answers `could not
  determine executable to run`, npm's latest release is older. Say so in one line (`npm view asciify-engine version` shows
  what npm has) instead of drawing the art yourself.
- In a project that depends on asciify-engine 4.33 or later, run its own copy, `npx asciify-engine` (the same version as the
  app). An older dependency has no command: use `npx -y asciify-engine@latest`, and mention that the project's copy predates
  it if they may want to upgrade ([upgrading.md](upgrading.md)).
- Print text with `-f text`, and add `--still` for a GIF, video or model. Your shell may be a terminal (some editors' are):
  there the command would play the animation, or open the 3D viewer, and not return. Files take `-o`. Playback and the
  viewer (turned with the mouse) are for the user's own terminal: give them the line to run, such as
  `npx asciify-engine helmet.glb`.

## 3. Choose by where it goes

```sh
npx -y asciify-engine@latest photo.jpg -f text -w 80 --cell-aspect 2.4          # your reply, in a chat window
npx -y asciify-engine@latest photo.jpg -f text -w 80                            # your reply, shown in a terminal
npx -y asciify-engine@latest photo.jpg -o photo.svg --background '#000000'      # a file worth keeping
npx -y asciify-engine@latest photo.jpg -o photo.html                            # a page to open or share
npx -y asciify-engine@latest mascot.png -w 60 -o mascot.ans                     # a terminal greeting: cat mascot.ans
npx -y asciify-engine@latest /mnt/user-data/uploads/photo.jpg -o /mnt/user-data/outputs/photo.svg --background '#000000'
```

- **Your reply.** Paste the text in a code block fenced with four backticks (the art itself can hold three in a row), with
  nothing reflowed. Keep it at 80 columns (60 in a narrow side panel, 100 at most) so it does not wrap; put more detail in
  the file. A chat window draws code blocks with taller cells than a terminal (about 2.4 times as tall as wide, against 2):
  `--cell-aspect 2.4` keeps circles round there. Leave it out when your reply shows in a terminal.
- **The file.** Give one with the text: an SVG, in colour where the picture has colour, sharp at any size, animated for a
  GIF, video or 3D turn. Give it a ground (`--background`) so it reads wherever it is opened; a transparent SVG is for
  placing on a page. `-o page.html` writes a whole page with its ground and title. Save it beside the original
  (`photo-ascii.svg`) unless they named a place, or in `/mnt/user-data/outputs/` in a Claude app, and say where it is.
- **A terminal.** ANSI colour: `-o art.ans` (24-bit; add `--256` for older terminals), or `-f ansi` to print it. Dark art on
  white, for a dark terminal: add `--invert`. In their own terminal the plain command fits the window and plays animations.
- **A README.** See [README](#readme).

Then say what you made in one line and offer one alternative that suits the picture (braille for line art, colour blocks
for a colourful photo, the classic ramp, a wider file), not a menu before.

## 4. Defaults by media

Look at the picture before choosing.

**Photo.** Shape mode (the default) follows edges with `/ \ | _ ( )` as well as tone.

```sh
npx -y asciify-engine@latest photo.jpg -f text -w 80 --cell-aspect 2.4
npx -y asciify-engine@latest photo.jpg -o photo.svg --background '#000000' --title "Photo in characters"
```

**Logo, icon, line art, scan, diagram, dark on white.** Add `--light`, which draws the dark marks: the subject then reads in
a light or a dark chat. Black-and-white art also takes `--no-color` in files (smaller, and the ink applies).

```sh
npx -y asciify-engine@latest logo.png -f text -w 80 --light
npx -y asciify-engine@latest logo.png --light --no-color --background '#ffffff' -o logo.svg
```

**Screenshot or interface.** `--light` for a light theme. Small text survives only at high widths, so make the file wide.

```sh
npx -y asciify-engine@latest screenshot.png --light -w 160 -o screenshot.svg --background '#ffffff'
```

**Face or portrait.** Crop to the face first, with any image tool (ffmpeg: `ffmpeg -i in.jpg -vf crop=360:360:200:30 face.jpg`,
width, height, left and top in pixels): a face that fills the frame keeps its features at 80 columns.

```sh
npx -y asciify-engine@latest face.jpg -f text -w 80 --cell-aspect 2.4
```

**Pixel art and sprites.** Half blocks in colour at the sprite's own width in pixels draw every pixel exactly (in an SVG,
as squares). Block modes need at least one picture pixel per dot: on a small picture keep `--half` at or below its width in
columns, and `--braille`, `--quad` and `--sextant` at or below half of it, or the art comes out striped.

```sh
npx -y asciify-engine@latest sprite.png --half --color -w 16 -o sprite.svg
```

**GIF.** The text shows its first frame; the file is an animated SVG with the GIF's own timing, played by CSS (it shows as
an image on GitHub and holds still under reduced motion).

```sh
npx -y asciify-engine@latest loop.gif -f text --still -w 80 --cell-aspect 2.4
npx -y asciify-engine@latest loop.gif -o loop.svg --background '#000000'
```

**Video** (needs ffmpeg). A file holds 48 frames at up to 12 fps by default (4 s from the start); `--frames` and `--fps`
change that. Colour multiplies the size, so a long clip goes without it.

```sh
npx -y asciify-engine@latest clip.mp4 -f text --still -w 80
npx -y asciify-engine@latest clip.mp4 -o clip.svg --no-color --frames 72 --fps 12 -w 80
```

**3D model** (glTF/GLB, OBJ with MTL, STL, PLY). A still view as text, a full turn as an animated SVG, and the live viewer
for their terminal. Textured and coloured models keep their colours in files; grey ones are drawn without colour.

```sh
npx -y asciify-engine@latest helmet.glb -f text --still -w 80 --cell-aspect 2.4
npx -y asciify-engine@latest helmet.glb --spin -o turn.svg --background '#000000'
npx -y asciify-engine@latest part.stl -f text --still --shade toon -w 80
```

**A word or a name.** A figlet banner.

```sh
npx -y asciify-engine@latest --text "Ada" --font Slant -f text
```

**Modes.** `shape` (default) for most pictures; `--tone` with a classic ramp for an old-school look; `--braille` for line art
and fine detail in one colour; `--half`, `--quad` and `--sextant` with `--color` for photographic colour in a terminal (two
colours a cell; sextant needs a recent terminal font). Braille and blocks rely on the reader's font: plain ASCII is the safe
choice for a chat reply.

## 5. Their words

| They say | Use |
| --- | --- |
| "bigger", "more detail" | A wider file (`-w 120` to `-w 200`); keep the text in your reply at 100 columns or fewer. |
| "smaller", "for my phone" | `-w 40`. |
| "in colour" | The SVG or HTML file (colour by default); `--color` in a terminal; `--half --color` for the most colour detail. |
| "black and white" | `--no-color`. |
| "dots", "braille" | `--braille`. |
| "blocky", "pixel", "8-bit" | `--half --color`; `--quad` or `--sextant` for finer blocks. |
| "classic", "old-school", "like jp2a" | `--tone -c ' .:-=+*#%@'`. |
| "only symbols", "no letters" | `-c ' .,:;^-_~=+*<>!?/\()[]{}#%@&$'`. |
| "in our letters", a brand word | `--tone -c ' .:-=+ACME#@'`: light marks first, the word, then the densest. |
| "matrix", "green on black" | `--no-color --ink '#00ff41' --background '#000000'` in a file. |
| "negative", "inverted" | `--invert`. |
| "for a white page", "light background" | `--light`. |
| "for my README", "dark mode" | The [README](#readme) recipe. |
| "smaller file" | `--no-color`, fewer columns, `--frames 24`, `--fps 8`. |
| "more contrast", "brighter", "darker" | `--contrast 1.3`, `--brightness 0.1`, `--gamma 1.3` (shape and tone modes; block modes ignore them). |
| "smoother", "less noisy" | `--dither ordered`, or `--dither none`. |
| "slower turn", "faster turn" | `--frames 72` or `--frames 24`: a file always holds one full turn, at `--fps` (12). |
| "play once" | `--no-loop`. |
| "flat", "cartoon" (3D) | `--shade toon`; `--outline 0` drops the outlines; `--paint '#ff8800'` paints it one colour. |
| "from the side", "from above", "closer" (3D) | `--yaw 90`, `--pitch 60`, `--zoom 1.5`; `--up z` for a CAD model lying on its back. |
| "my name in big letters" | `--text "Ada" --font Slant` (also Standard, Big, Doom, Small, 3-D, "ANSI Shadow", Colossal or any figlet font). |

## README

```sh
npx -y asciify-engine@latest logo.png --light --no-color --ink '#24292f' --dark-ink '#e6edf3' --title "Acme" -o logo.svg
npx -y asciify-engine@latest helmet.glb --spin --no-color --ink '#24292f' --dark-ink '#e6edf3' --title "The helmet, turning" -w 80 -o turn.svg
npx -y asciify-engine@latest photo.jpg --background '#0d1117' --title "The office" -o office.svg
```

- `--ink` and `--dark-ink` (GitHub's text colours here) make one file follow the reader's light or dark theme. They apply
  only without colour, so pass `--no-color`; otherwise the picture's own colours win.
- That swaps the ink, not the shading: right for logos, line art, banners and models. A photo would read as a negative in
  one of the two themes, so give it a ground of its own (`--background`), in colour.
- `--title` names the SVG for screen readers (without it the SVG is hidden from them). Embed it with
  `<img src="turn.svg" alt="…" width="640">` or `![…](turn.svg)`.
- Every frame of an animated SVG is in the file: 24 frames of a colourful clip at 100 columns came to about 1 MB in colour
  and 125 kB without. For a README prefer `--no-color`, 60 to 80 columns and 24 to 48 frames.

## When it fails

| Problem | Do |
| --- | --- |
| `could not determine executable to run` | npm has no asciify-engine 4.33 yet: say so. |
| `npx: command not found`, or Node older than 18 | It needs Node 18 or later (nodejs.org). |
| No network for npx | Use a copy the project or machine already has; otherwise say it needs npm. |
| WebP, AVIF, TIFF or SVG: `Cannot read …` or `No frames came out of …` | Run it with sharp: `npx -y -p asciify-engine@latest -p sharp asciify-engine photo.webp`. |
| HEIC (iPhone photos) | sharp's prebuilt binaries do not decode it: convert it first (`sips -s format jpeg photo.heic --out photo.jpg` on macOS, `heif-convert photo.heic photo.jpg` on Linux). |
| `Playing video needs ffmpeg` | Install ffmpeg (`brew install ffmpeg`, `sudo apt install ffmpeg`), or ask for a GIF. |
| A video from a URL or standard input: `Cannot read …` | Download it to a file first. |
| `KHR_draco_mesh_compression` or meshopt | The model's meshes are compressed: ask for (or re-export) the model without mesh compression. |
| `could not read buffer …`, or a model without its textures | Keep a `.gltf` or `.obj` together with its `.bin`, `.mtl` and texture files, and pass the model's absolute path. |
| A huge picture, a long clip | Pictures are scaled down to `-w` (a 24-megapixel photo takes under a second). For video, `--frames` and `--fps` bound the file; to start later, trim first (`ffmpeg -ss 30 -t 4 -i in.mp4 -an part.mp4`). |
| Striped braille or block art | The picture is smaller than the dots asked for: see pixel art above. |
| They asked for a PNG, GIF or MP4 | The command writes text, ANSI, SVG, HTML and JSON (`-o art.png` would put text in that file). Render the SVG with whatever the machine has (`rsvg-convert -o art.png art.svg`, ImageMagick, a headless browser), or use `/studio` in a browser for PNG, GIF and MP4 ([studio-workspace.md](studio-workspace.md)). |

## On their site, not a file

When they want the art to live on their website (a hero, a background, a component, a model turning on the page), the
command is the wrong tool: use the kit (`asciiVideo`, `ditherImage`, `fieldBackground`, `wordmark`; [components.md](components.md)),
a glyph field over their media (`mountGlyphField(canvas, { source: '/hero.mp4', charset: FIELD_PHOTO_CHARSET, sample: 'shape' })`,
[glyph-field.md](glyph-field.md)) or `modelSource` for a 3D model ([model.md](model.md)), following the house design in
[applying-asciify.md](applying-asciify.md). The command still helps there: its SVG makes a poster or a no-script fallback.
For text on a server, at the edge or in a build, use `/headless` ([headless.md](headless.md)).
