# The command line (4.33)

`asciify-engine` is also a command: pictures, animations, video and 3D models to ASCII, in the terminal or as SVG, HTML, text,
ANSI and JSON. It needs only Node 18 or later; images are decoded by the engine's own decoders, with no native modules.

```bash
npx asciify-engine photo.jpg                       # fits the terminal, in colour where the terminal has it
npx asciify-engine photo.jpg --half                # two true-colour pixels a character (or --quad, --sextant, --braille)
npx asciify-engine logo.png --light -o logo.svg    # a vector file for a README or Figma
npx asciify-engine loop.gif -o loop.svg            # an animated SVG, CSS only, plays as an <img> on GitHub
npx asciify-engine clip.mp4 -w 120                 # plays in the terminal (needs ffmpeg)
npx asciify-engine helmet.glb                      # turn a 3D model with the mouse
npx asciify-engine bunny.ply --spin 45 -o bunny.svg
npx asciify-engine torus                           # the classic spinning donut; also knot, sphere, cube, icosahedron
curl -s https://example.com/cat.png | npx asciify-engine - --braille
```

## Inputs

- Images: PNG and APNG, JPEG (baseline and progressive, EXIF orientation), GIF (animated), BMP, PNM, QOI, decoded with no
  dependencies. WebP, AVIF, HEIC, TIFF and SVG are read through `sharp` if it is installed, or `ffmpeg`.
- Video: anything `ffmpeg` plays (MP4, WebM, MOV, MKV …); `--webcam` reads the camera (macOS, Linux).
- 3D models: glTF/GLB (with external buffers and textures), OBJ (with MTL), STL, PLY.
- A URL, `-` for standard input, or a built-in shape's name.

## Options

| Option | What it does |
| --- | --- |
| `-o, --output <file>` | Write to a file; `.txt`, `.ans`, `.svg`, `.html`, `.json` pick the format. |
| `-f, --format <name>` | `text`, `ansi`, `svg`, `html`, `json`. Default: ANSI in a terminal, plain text in a pipe. |
| `-w, --width`, `-H, --height` | Characters across and down. Default: fit the terminal (80 columns in a pipe, 100 in SVG/HTML/JSON). |
| `-m, --mode` | `shape` (default; characters follow edges), `tone`, `braille`, `half`, `quad`, `sextant`. Shorthands `--tone`, `--braille` … |
| `-c, --charset` | The characters to use. |
| `--color` / `--no-color`, `--256` | Colour from the picture (default on in colour terminals and SVG/HTML), 256 colours instead of 24-bit. Honours `NO_COLOR`/`FORCE_COLOR`. |
| `--light` / `--dark` | Dark characters on a light ground (read from `COLORFGBG` where the terminal sets it). |
| `--dither`, `--contrast`, `--brightness`, `--gamma`, `--invert` | Tone shaping. |
| `--fps`, `--frames`, `--no-loop`, `--still` | Animation: frame rate, frames written to a file (48 by default for video, 36 for a model's turn), play once, or only the first frame. |
| `--spin`, `--yaw`, `--pitch`, `--zoom`, `--fov`, `--up`, `--shade`, `--paint`, `--outline` | 3D: see [model.md](model.md). |
| `--font-size`, `--title`, `--background`, `--ink`, `--dark-ink` | SVG and HTML. `--dark-ink` follows the reader's dark scheme. |
| `--text "Hi"`, `--font Slant` | A banner in a figlet font (Standard, Slant, Big, Doom, Small, 3-D or any other figlet font), as text, SVG or HTML. |

In a pipe the command writes plain text with no escape codes, and an animation's first frame (use `-o` for every frame).
In a terminal, animations, video and models play full-screen on the alternate screen and put the terminal back on exit; space
pauses, `q` quits, and models turn with the mouse, the arrow keys, `+`/`-` and the wheel.
