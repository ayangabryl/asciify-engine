# The command line (4.33)

`asciify-engine` is also a command: pictures, animations, video and 3D models to ASCII, in the terminal or as SVG, HTML, text,
ANSI and JSON. It needs only Node 18 or later; images are decoded by the engine's own decoders, with no native modules. To
convert something a person attached or linked, follow [convert-attachments.md](convert-attachments.md).

```bash
npx asciify-engine photo.jpg                       # fits the terminal, in colour where the terminal has it
npx asciify-engine photo.jpg --half --color        # two true-colour pixels a character (or --quad, --sextant)
npx asciify-engine photo.jpg --braille             # 2 × 4 dots a character
npx asciify-engine logo.png --light -o logo.svg --title "Our logo"   # a vector file for a README or Figma
npx asciify-engine loop.gif -o loop.svg            # an animated SVG, CSS only, plays as an <img> on GitHub
npx asciify-engine clip.mp4 -w 120                 # plays in the terminal (needs ffmpeg)
npx asciify-engine helmet.glb                      # turn a 3D model with the mouse
npx asciify-engine bunny.ply --spin -o bunny.svg   # a full turn as an animated SVG
npx asciify-engine torus                           # the classic spinning donut; also knot, sphere, cube, icosahedron
npx asciify-engine --text "Hello" --font Slant     # a banner in a figlet font
curl -s https://example.com/cat.png | npx asciify-engine - --braille
```

`npx asciify-engine` runs the project's own copy where it depends on asciify-engine 4.33 or later; elsewhere use
`npx -y asciify-engine@latest`. Releases before 4.33.0 have no command (`could not determine executable to run`).

## Inputs

- **Images:** PNG and APNG, JPEG (baseline and progressive, EXIF orientation applied), GIF (animated), BMP, PNM and QOI, with
  no dependencies. WebP (animated too), AVIF, TIFF and SVG are read through `sharp`; with npx, add it to the same run:
  `npx -y -p asciify-engine@latest -p sharp asciify-engine photo.webp` (in a project, install `sharp` beside asciify-engine).
  Without sharp the command falls back to ffmpeg, which reads AVIF but not every still WebP or TIFF (`No frames came out of
  …`). HEIC: convert it to JPEG first (`sips` on macOS, `heif-convert` on Linux).
- **Video:** anything ffmpeg plays (MP4, WebM, MOV, MKV …), from a file: download a video URL first. `--webcam` reads the
  camera through ffmpeg (macOS and Linux).
- **3D models:** glTF/GLB (with external buffers and textures; Draco and meshopt compression are not read), OBJ (with MTL),
  STL, PLY (meshes, point clouds, Gaussian splats). Keep a model's files together and pass its absolute path.
- **Other:** a URL (images, GIFs and models), `-` for standard input (images and models), or a built-in shape: `torus` (or
  `donut`), `knot`, `sphere`, `cube`, `icosahedron`.

## Where it writes

- **A terminal:** ANSI colour, fitted to the window. Animations, video and models play full-screen on the alternate screen,
  drawn in place, and put the terminal back on exit: space pauses and `q` quits; a model turns with a mouse drag or the arrow
  keys, zooms with `+`/`-` or the wheel, and `r` resets the view.
- **A pipe** (and an agent's shell that is not a terminal): plain text with no escape codes, 80 columns; an animation's first
  frame (with a note on stderr) and a model's still view.
- **A file** (`-o`): the format from the extension, `.txt`, `.ans`, `.svg`, `.html` or `.json`; any other extension gets plain
  text. Files are 100 columns by default, and an animation, a video or a model's turn writes every frame: SVG and HTML as one
  animated SVG played by CSS (it loops or plays once, and holds the first frame under `prefers-reduced-motion`), JSON as
  `{ columns, rows, background, cellAspect, frames: [{ lines, delay, colors?, backgrounds? }] }`.

`-f text` in a terminal still plays animations and opens the 3D viewer; add `--still` for one frame that returns at once.

## Options

| Option | What it does |
| --- | --- |
| `-o, --output <file>` | Write to a file; `.txt`, `.ans`, `.svg`, `.html`, `.json` pick the format. |
| `-f, --format <name>` | `text`, `ansi`, `svg`, `html`, `json`. Default: ANSI in a terminal, plain text in a pipe. |
| `-w, --width <n>`, `-H, --height <n>` | Characters across and down, 1 to 2000 (also `--columns`, `--rows`). Default: fit the terminal; 80 columns in a pipe, 100 in SVG, HTML and JSON. Give one and the other follows the picture's shape. |
| `--cell-aspect <n>` | Height over width of a character where the text is shown. Default 2, a terminal (1.93 for shape and tone in SVG, HTML and JSON, which are drawn at line-height 1). About 2.4 for a code block in a chat window or on a web page. |
| `-m, --mode <mode>` | `shape` (default: characters that follow edges), `tone` (a brightness ramp), `braille`, `half`, `quad` or `sextant` (several pixels a character). Shorthands: `--shape`, `--tone`, `--braille`, `--half`, `--quad`, `--sextant`. |
| `-c, --charset <chars>` | The characters to use: in shape mode any subset of printable ASCII, in tone mode a ramp from empty to dense. Block modes draw their own. |
| `--color`, `--no-color` | Colour from the picture (also `--colour`, `--no-colour`, `--mono`). Default: on in a colour terminal and in SVG, HTML, JSON and `.ans` files. Honours `NO_COLOR` and `FORCE_COLOR`. |
| `--256`, `--truecolor` | 256-colour ANSI instead of 24-bit, or 24-bit whatever the terminal reports. |
| `--light`, `--dark` | Dark characters on a light ground, or light on dark (the default; in a terminal, read from `COLORFGBG` where it is set). |
| `--dither <kind>` | `diffuse` (stills), `ordered` (animations: calm from frame to frame) or `none`. |
| `--contrast <n>`, `--brightness <n>`, `--gamma <n>` | Tone shaping in shape and tone modes: contrast 0 to 3 (1), brightness -1 to 1 (0), gamma 0.1 to 5 (1, above opens the shadows). |
| `--invert` | Inverts the picture before converting it. |
| `--fps <n>` | Frames a second for video, a model's turn and their animated SVG (a GIF keeps its own timing). Video defaults to its own rate, at most 12 in a file and 30 in a terminal. |
| `--frames <n>` | Frames written to a file: 48 by default for video (from the start), 36 for a model's turn, every frame of a GIF. |
| `--loop`, `--no-loop` | Loop, or play once and hold the last frame (also `--once`). Files loop by default, a GIF as its own loop count says; video in a terminal plays once. |
| `--still` | Only the first frame, or one view of a model, and never play. |
| `--spin [deg/s]` | Turn a model: in a terminal at that speed (default 30; 0 holds it still); in a file, one full turn over `--frames` (a negative speed turns the other way). |
| `--yaw <deg>`, `--pitch <deg>`, `--zoom <n>`, `--fov <deg>`, `--up <y\|z>` | The view: yaw 30 and pitch 20 by default, zoom 1 frames the model, field of view 30 (0 is orthographic); `--up z` for z-up files. |
| `--shade <kind>` | `lit` (default), `toon` (flat bands), `normals`, `depth`. |
| `--paint <#hex>` | One colour for the whole model. |
| `--outline <0–1>` | Lines where surfaces overlap and at sharp creases. Default 0.65. |
| `--font-size <px>`, `--title <text>` | SVG and HTML: the font size (default 12), and an accessible name (without one the SVG is `aria-hidden`). |
| `--background <#hex>`, `--ink <#hex>`, `--dark-ink <#hex>` | SVG and HTML: a ground (SVG is transparent without one; `--bg` for short), the ink of uncoloured art, and the ink where the reader prefers a dark scheme. `--ink` and `--dark-ink` apply without colour: add `--no-color` for a picture that has colour. The `#` is optional. |
| `--text <text>`, `--font <name>` | A banner in a figlet font: Standard (default), Slant, Big, Doom, Small, 3-D, "ANSI Shadow", Colossal or any other of figlet's fonts, as text, SVG or HTML. |
| `--webcam` | The camera, through ffmpeg (macOS and Linux; also `--camera`). |
| `-h, --help`, `-v, --version` | Help, and the version. |

A value follows its flag after a space or `=` (`-w 80`, `--width=80`). 3D options in more depth: [model.md](model.md). The same conversion as a library,
in Node, workers and edge runtimes: [headless.md](headless.md).
