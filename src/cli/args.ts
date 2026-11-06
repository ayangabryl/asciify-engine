/* The command line: flags in, settings out. No dependencies. */

export type CliMode = 'shape' | 'tone' | 'braille' | 'half' | 'quad' | 'sextant';
export type CliFormat = 'text' | 'ansi' | 'svg' | 'html' | 'json';

export interface CliOptions {
  input: string | null;
  output: string | null;
  format: CliFormat | null;
  width: number | null;
  height: number | null;
  cellAspect: number | null;
  mode: CliMode;
  charset: string | null;
  color: boolean | null;
  colorDepth: 'truecolor' | '256' | null;
  light: boolean | null;
  dither: 'diffuse' | 'ordered' | false | null;
  contrast: number | null;
  brightness: number | null;
  gamma: number | null;
  invert: boolean;
  // Animation.
  fps: number | null;
  frames: number | null;
  loop: boolean | null;
  still: boolean;
  // 3D.
  spin: number | null;
  yaw: number | null;
  pitch: number | null;
  zoom: number | null;
  fov: number | null;
  up: 'y' | 'z' | null;
  shade: 'lit' | 'toon' | 'normals' | 'depth' | null;
  paint: string | null;
  outline: number | null;
  // Markup.
  fontSize: number | null;
  title: string | null;
  background: string | null;
  ink: string | null;
  darkInk: string | null;
  // Other inputs.
  text: string | null;
  font: string | null;
  webcam: boolean;
  help: boolean;
  version: boolean;
}

export const HELP = `asciify-engine: pictures, video and 3D models to ASCII art, in your terminal or as SVG, HTML, text and JSON.

Usage
  asciify-engine <input> [options]
  asciify-engine torus                     a spinning donut (also: knot, sphere, cube, icosahedron)
  asciify-engine --text "Hello"            a banner (--font Slant, Big, Doom, 3-D … any figlet font)

Input
  An image (PNG, APNG, JPEG, GIF, BMP, PNM, QOI; WebP, AVIF, TIFF and others through sharp or ffmpeg if
  installed), a video (MP4, WebM, MOV … through ffmpeg), a 3D model (glTF/GLB, OBJ, STL, PLY), a URL,
  or - to read standard input. --webcam reads the camera through ffmpeg.

Output
  -o, --output <file>      Write to a file; .txt .ans .svg .html .json pick the format.
  -f, --format <name>      text | ansi | svg | html | json. Default: ansi in a terminal, text in a pipe.
  -w, --width <columns>    Characters across. Default: fits the terminal (80 in a pipe).
  -H, --height <rows>      Rows. Default: from the picture's shape.
      --cell-aspect <n>    Height over width of a character cell. Default 2.

Look
  -m, --mode <mode>        shape (default: characters that follow edges), tone (a brightness ramp),
                           braille, half, quad or sextant (several pixels a character).
      --braille, --half, --quad, --sextant, --tone   Shorthands for --mode.
  -c, --charset <chars>    Characters to use (a ramp from empty to dense in tone mode).
      --color, --no-color  Colour from the picture. Default: on in a colour terminal and in SVG/HTML.
      --256                256 colours instead of 24-bit.
      --light              Dark characters on a light ground. --dark for the opposite.
      --dither <kind>      diffuse, ordered or none.
      --contrast <n>  --brightness <n>  --gamma <n>  --invert

Animation (GIF, APNG, video, 3D)
      --fps <n>            Frames a second (video, 3D and animated SVG).
      --frames <n>         How many frames to write to a file (default 48 for video, 36 for a model's turn).
      --no-loop            Play once.
      --still              The first frame only (or one view of a 3D model).

3D models
      --spin <deg/s>       Turn the model (default 30 in the terminal; 0 to hold it still).
      --yaw <deg> --pitch <deg> --zoom <n> --fov <deg> --up <y|z>
      --shade <kind>       lit (default), toon, normals or depth.
      --paint <#hex>       One colour for the whole model.
      --outline <0-1>      Lines where surfaces overlap and at sharp creases. Default 0.65.
  In the terminal: drag with the mouse or use the arrow keys to turn it, + and - (or the wheel) to zoom,
  space to pause, r to reset, q to quit.

SVG and HTML
      --font-size <px>  --title <text>  --background <#hex>  --ink <#hex>  --dark-ink <#hex>

Banners
      --text <text>        The text as a banner, in a figlet font.
      --font <name>        Standard (default), Slant, Big, Doom, Small, 3-D or any figlet font.

  -h, --help               This help.
  -v, --version            The version.

Examples
  asciify-engine photo.jpg
  asciify-engine photo.jpg --half --color
  asciify-engine logo.png --light -o logo.svg --title "Our logo"
  asciify-engine clip.mp4 -w 120
  asciify-engine loop.gif -o loop.svg          an animated SVG that plays in a README
  asciify-engine helmet.glb                   turn a 3D model with the mouse
  asciify-engine bunny.ply --spin 45 -o bunny.svg
  curl -s https://example.com/cat.png | asciify-engine - --braille
`;

const MODES: readonly CliMode[] = ['shape', 'tone', 'braille', 'half', 'quad', 'sextant'];
const FORMATS: readonly CliFormat[] = ['text', 'ansi', 'svg', 'html', 'json'];

export class CliError extends Error {}

/** Reads argv (without node and the script). Throws CliError on a bad flag or value. */
export function parseArgs(argv: readonly string[]): CliOptions {
  const o: CliOptions = {
    input: null, output: null, format: null, width: null, height: null, cellAspect: null, mode: 'shape', charset: null,
    color: null, colorDepth: null, light: null, dither: null, contrast: null, brightness: null, gamma: null, invert: false,
    fps: null, frames: null, loop: null, still: false,
    spin: null, yaw: null, pitch: null, zoom: null, fov: null, up: null, shade: null, paint: null, outline: null,
    fontSize: null, title: null, background: null, ink: null, darkInk: null,
    text: null, font: null, webcam: false, help: false, version: false,
  };
  const args = [...argv];
  const value = (flag: string) => {
    const next = args.shift();
    if (next === undefined) throw new CliError(`${flag} needs a value.`);
    return next;
  };
  const number = (flag: string, min = -Infinity, max = Infinity) => {
    const text = value(flag), n = Number(text);
    if (!Number.isFinite(n) || n < min || n > max) throw new CliError(`${flag} takes a number${Number.isFinite(min) ? ` from ${min}` : ''}${Number.isFinite(max) ? ` to ${max}` : ''}, not "${text}".`);
    return n;
  };
  const hex = (flag: string) => {
    const text = value(flag);
    if (!/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(text)) throw new CliError(`${flag} takes a hex colour such as #ff8800, not "${text}".`);
    return text.startsWith('#') ? text : `#${text}`;
  };
  while (args.length) {
    let arg = args.shift()!;
    // --flag=value
    const eq = /^(--[a-z0-9-]+)=(.*)$/s.exec(arg);
    if (eq) { arg = eq[1]; args.unshift(eq[2]); }
    switch (arg) {
      case '-h': case '--help': o.help = true; break;
      case '-v': case '--version': o.version = true; break;
      case '-o': case '--output': o.output = value(arg); break;
      case '-f': case '--format': {
        const f = value(arg) as CliFormat;
        if (!FORMATS.includes(f)) throw new CliError(`--format is one of ${FORMATS.join(', ')}.`);
        o.format = f; break;
      }
      case '-w': case '--width': case '--columns': o.width = Math.round(number(arg, 1, 2000)); break;
      case '-H': case '--height': case '--rows': o.height = Math.round(number(arg, 1, 2000)); break;
      case '--cell-aspect': o.cellAspect = number(arg, 0.25, 8); break;
      case '-m': case '--mode': {
        const m = value(arg) as CliMode;
        if (!MODES.includes(m)) throw new CliError(`--mode is one of ${MODES.join(', ')}.`);
        o.mode = m; break;
      }
      case '--shape': case '--tone': case '--braille': case '--half': case '--quad': case '--sextant': o.mode = arg.slice(2) as CliMode; break;
      case '-c': case '--charset': o.charset = value(arg); break;
      case '--color': case '--colour': o.color = true; break;
      case '--no-color': case '--no-colour': case '--mono': o.color = false; break;
      case '--256': o.colorDepth = '256'; o.color ??= true; break;
      case '--truecolor': o.colorDepth = 'truecolor'; o.color ??= true; break;
      case '--light': o.light = true; break;
      case '--dark': o.light = false; break;
      case '--dither': {
        const d = value(arg);
        if (d !== 'diffuse' && d !== 'ordered' && d !== 'none' && d !== 'false') throw new CliError('--dither is diffuse, ordered or none.');
        o.dither = d === 'none' || d === 'false' ? false : d; break;
      }
      case '--contrast': o.contrast = number(arg, 0, 3); break;
      case '--brightness': o.brightness = number(arg, -1, 1); break;
      case '--gamma': o.gamma = number(arg, 0.1, 5); break;
      case '--invert': o.invert = true; break;
      case '--fps': o.fps = number(arg, 0.1, 120); break;
      case '--frames': o.frames = Math.round(number(arg, 1, 10000)); break;
      case '--loop': o.loop = true; break;
      case '--no-loop': case '--once': o.loop = false; break;
      case '--still': o.still = true; break;
      case '--spin': {
        // A bare --spin (followed by another flag or nothing) means the default speed.
        const next = args[0];
        o.spin = next !== undefined && /^-?\d+(\.\d+)?$/.test(next) ? number(arg, -720, 720) : 30;
        break;
      }
      case '--yaw': o.yaw = number(arg); break;
      case '--pitch': o.pitch = number(arg, -90, 90); break;
      case '--zoom': o.zoom = number(arg, 0.05, 20); break;
      case '--fov': o.fov = number(arg, 0, 150); break;
      case '--up': {
        const u = value(arg);
        if (u !== 'y' && u !== 'z') throw new CliError('--up is y or z.');
        o.up = u; break;
      }
      case '--shade': {
        const s = value(arg);
        if (s !== 'lit' && s !== 'toon' && s !== 'normals' && s !== 'depth') throw new CliError('--shade is lit, toon, normals or depth.');
        o.shade = s; break;
      }
      case '--paint': o.paint = hex(arg); break;
      case '--outline': o.outline = number(arg, 0, 1); break;
      case '--font-size': o.fontSize = number(arg, 1, 400); break;
      case '--title': o.title = value(arg); break;
      case '--background': case '--bg': o.background = hex(arg); break;
      case '--ink': o.ink = hex(arg); break;
      case '--dark-ink': o.darkInk = hex(arg); break;
      case '--text': o.text = value(arg); break;
      case '--font': o.font = value(arg); break;
      case '--webcam': case '--camera': o.webcam = true; break;
      case '-': o.input = o.input ?? '-'; break;
      default:
        if (arg.startsWith('-') && arg.length > 1) throw new CliError(`Unknown option ${arg}. See asciify-engine --help.`);
        if (o.input !== null) throw new CliError(`One input at a time (got "${o.input}" and "${arg}").`);
        o.input = arg;
    }
  }
  return o;
}

/** The format a file name asks for, by its extension. */
export function formatOf(file: string): CliFormat | null {
  const ext = /\.([a-z0-9]+)$/i.exec(file)?.[1]?.toLowerCase();
  switch (ext) {
    case 'txt': case 'text': case 'asc': return 'text';
    case 'ans': case 'ansi': return 'ansi';
    case 'svg': return 'svg';
    case 'html': case 'htm': return 'html';
    case 'json': return 'json';
    default: return null;
  }
}
