import { existsSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, extname, join } from 'node:path';
import { MODEL_GAMMA, modelPixelSize } from './model/ascii';
import { renderModel, type ModelRenderOptions } from './model/render';
import type { AsciiModel } from './model/types';
import type { AsciiGrid } from './headless/grid';
import { CliError, HELP, formatOf, parseArgs, type CliFormat, type CliOptions } from './cli/args';
import { openSource, videoFrames, type Picture, type Source } from './cli/media';
import { formatGrids, pixelsPerCell, shapePicture, toGrid, trimRows, type GridSettings, type WriteSettings } from './cli/render';
import { encodeGif, encodePng, encodeVideo, rasterize, rgbOf } from './cli/raster';
import { Player, terminalColors, terminalIsLight, terminalSize, wait } from './cli/terminal';

/* asciify-engine on the command line: see `asciify-engine --help`. */

const out = process.stdout, err = process.stderr;
const isBlock = (mode: string) => mode === 'braille' || mode === 'half' || mode === 'quad' || mode === 'sextant';

const RASTER = new Set<CliFormat>(['png', 'gif', 'mp4', 'webm']);

interface Plan {
  o: CliOptions;
  /** The file this input goes to, or null for standard output. */
  output: string | null;
  format: CliFormat;
  /** Drawing in place in this terminal, as an animation or a 3D view. */
  live: boolean;
  /** stdout is a terminal (for sizing). */
  tty: boolean;
  color: boolean;
  depth: 'truecolor' | '256';
  light: boolean;
  cellAspect: number;
}

function plan(o: CliOptions, output: string | null, several = false): Plan {
  if (output && !o.format && !formatOf(output)) throw new CliError(`Cannot tell what to write from ${basename(output)}: use .txt, .ans, .svg, .html, .json, .png, .gif, .mp4 or .webm, or --format.`);
  const tty = !!out.isTTY && !output;
  const format = o.format ?? (output ? formatOf(output)! : out.isTTY ? 'ansi' : 'text');
  const terminal = terminalColors();
  // --ink and --dark-ink ask for one colour: the picture's own are off unless --color says otherwise.
  const oneInk = !!(o.ink || o.darkInk);
  const color = o.color ?? (oneInk ? false : format === 'svg' || format === 'html' || format === 'json' || RASTER.has(format) ? true : format === 'ansi' ? (output ? true : terminal !== false) : false);
  const depth = o.colorDepth ?? (format === 'ansi' && terminal ? terminal : 'truecolor');
  const light = o.light ?? (tty ? terminalIsLight() : false);
  const markup = format === 'svg' || format === 'html' || format === 'json';
  const cellAspect = o.cellAspect ?? (markup && !isBlock(o.mode) ? 1.93 : 2);
  // Playing in place is for a plain run in a terminal: a named format prints once and exits.
  return { o, output, format, live: tty && !o.format && !o.still && !several, tty, color, depth, light, cellAspect };
}

/** The grid's size for a picture of `width` × `height`: as asked, or filling the terminal, or 80 / 100 columns. */
function gridSize(p: Plan, width: number, height: number, reserve = 0): { columns: number; rows: number } {
  const { o, cellAspect } = p, aspect = height / width;
  if (o.width && o.height) return { columns: o.width, rows: o.height };
  if (o.width) return { columns: o.width, rows: Math.max(1, Math.round((o.width * aspect) / cellAspect)) };
  if (o.height) return { columns: Math.max(1, Math.round((o.height * cellAspect) / aspect)), rows: o.height };
  if (!p.tty) {
    const columns = p.format === 'text' || p.format === 'ansi' ? 80 : 100;
    return { columns, rows: Math.max(1, Math.round((columns * aspect) / cellAspect)) };
  }
  const term = terminalSize();
  let columns = term.columns, rows = Math.max(1, Math.round((columns * aspect) / cellAspect));
  const room = Math.max(4, term.rows - 1 - reserve);
  if (rows > room) { rows = room; columns = Math.max(1, Math.min(term.columns, Math.round((rows * cellAspect) / aspect))); }
  return { columns, rows };
}

function settings(p: Plan, columns: number, rows: number, extra: Partial<GridSettings> = {}): GridSettings {
  const { o } = p;
  return {
    columns, rows, mode: o.mode, cellAspect: p.cellAspect, charset: o.charset, color: p.color, light: p.light, dither: o.dither,
    contrast: o.contrast, brightness: o.brightness, gamma: o.gamma, invert: o.invert, threshold: o.threshold, ...extra,
  };
}

function writeSettings(p: Plan, fps: number, loop: boolean): WriteSettings {
  const { o } = p;
  return {
    colorDepth: p.depth, color: p.color, fps, loop,
    ...(o.fontSize ? { fontSize: o.fontSize } : {}), ...(o.title ? { title: o.title } : {}), ...(o.background && o.background !== 'transparent' ? { background: o.background } : {}),
    ...(o.ink ? { ink: o.ink } : {}), ...(o.darkInk ? { dark: { ink: o.darkInk } } : {}),
  };
}

/** Lines moved to the middle of the terminal. */
function centred(text: string, columns: number) {
  const pad = Math.max(0, Math.floor((terminalSize().columns - columns) / 2));
  return pad ? text.split('\n').map(line => ' '.repeat(pad) + line).join('\n') : text;
}

async function emit(p: Plan, grids: AsciiGrid[], delays: number[], fps: number, loop: boolean) {
  const { o, output } = p, size = `${grids[0].columns}×${grids[0].rows}${grids.length > 1 ? `, ${grids.length} frames` : ''}`;
  if (output) await mkdir(dirname(output), { recursive: true });
  if (RASTER.has(p.format)) {
    // A picture: the cells drawn in DejaVu Sans Mono's shapes and exact blocks, over a ground.
    const ground = o.background === 'transparent' ? null : rgbOf(o.background ?? (p.light ? '#ffffff' : '#000000'));
    const frames = grids.map(grid => rasterize(grid, { size: o.fontSize ?? 20, ink: rgbOf(o.ink ?? (p.light ? '#111111' : '#eeeeee')), background: ground, color: p.color }));
    const pixels = `${frames[0].width}×${frames[0].height} px`;
    if (p.format === 'mp4' || p.format === 'webm') {
      if (!output) throw new CliError(`Video needs a file: -o art.${p.format}.`);
      await encodeVideo(frames, Math.max(1, Math.min(60, fps)), output, p.format);
    } else {
      const bytes = p.format === 'png' ? encodePng(frames, delays, loop) : await encodeGif(frames, delays, loop);
      if (output) await writeFile(output, bytes);
      else if (out.isTTY) throw new CliError(`A ${p.format.toUpperCase()} is not for the terminal: write it to a file with -o art.${p.format}, or pipe it.`);
      else out.write(bytes);
    }
    if (output) err.write(`Wrote ${output} (${size}, ${pixels}).\n`);
    return;
  }
  const text = formatGrids(grids, delays, p.format, writeSettings(p, fps, loop));
  if (output) {
    await writeFile(output, text);
    err.write(`Wrote ${output} (${size}).\n`);
  } else out.write(text);
}

// Pictures: one frame, or an animation (GIF, APNG, WebP through sharp).
async function pictures(p: Plan, all: Picture[], loopCount: number) {
  const { o } = p;
  if (o.frame !== null && o.frame >= all.length) throw new CliError(`--frame ${o.frame}: there ${all.length === 1 ? 'is one frame' : `are ${all.length} frames`} (0 to ${all.length - 1}).`);
  const picked = o.frame !== null ? [all[o.frame]] : all;
  const frames = picked.map(frame => shapePicture(frame, o.crop, o.flip));
  const { columns, rows } = gridSize(p, frames[0].width, frames[0].height);
  const animated = frames.length > 1 && !o.still;
  if (!animated) { await emit(p, [toGrid(frames[0], settings(p, columns, rows))], [0], 12, true); return; }
  const loop = o.loop ?? (loopCount !== 1);
  const steady = settings(p, columns, rows, { dither: o.dither ?? 'ordered' });
  if (!p.live) {
    if (!p.output && !o.frames && !RASTER.has(p.format)) {
      err.write('An animation: writing its first frame. Use -o file.svg (or .gif, .json) for every frame, --frame N for another one, or --frames N.\n');
      await emit(p, [toGrid(frames[0], settings(p, columns, rows))], [0], 12, true);
      return;
    }
    const chosen = frames.slice(0, o.frames ?? frames.length), grids: AsciiGrid[] = [];
    for (const frame of chosen) grids.push(toGrid(frame, steady, grids[grids.length - 1] ?? null));
    await emit(p, grids, chosen.map(f => f.delay || 100), o.fps ?? 12, loop);
    return;
  }
  // In the terminal: converted as they come up, kept for the next loop.
  const cache: string[] = [];
  let previous: AsciiGrid | null = null;
  const player = new Player({ resize: () => { cache.length = 0; } });
  for (let pass = 0; !player.isClosed && (pass === 0 || loop); pass++) {
    for (let i = 0; i < frames.length && !player.isClosed; i++) {
      const start = performance.now();
      if (!cache[i]) {
        const size = gridSize(p, frames[0].width, frames[0].height);
        const grid = toGrid(frames[i], { ...steady, ...size }, previous);
        previous = grid;
        cache[i] = formatGrids([grid], [0], 'ansi', writeSettings(p, 12, loop)).replace(/\n$/, '');
      }
      player.draw(centred(cache[i], gridSize(p, frames[0].width, frames[0].height).columns));
      await wait(player, Math.max(0, (frames[i].delay || 100) - (performance.now() - start)));
      while (player.isPaused && !player.isClosed) await wait(player, 50);
    }
  }
  player.close();
}

// Video and the camera, through ffmpeg.
async function movie(p: Plan, source: Extract<Source, { kind: 'video' }>) {
  const { o } = p;
  // Crop and flip happen in ffmpeg, at the video's full size, before it is scaled down.
  let width = source.width, height = source.height, crop: [number, number, number, number] | null = null;
  if (o.crop) {
    let [x, y, w, h] = o.crop;
    if (o.crop.every(n => n <= 1)) { x *= width; y *= height; w *= width; h *= height; }
    x = Math.max(0, Math.min(width - 2, Math.round(x))); y = Math.max(0, Math.min(height - 2, Math.round(y)));
    w = Math.max(2, Math.min(width - x, Math.round(w))); h = Math.max(2, Math.min(height - y, Math.round(h)));
    crop = [x, y, w, h]; width = w; height = h;
  }
  const filters = [...(crop ? [`crop=${crop[2]}:${crop[3]}:${crop[0]}:${crop[1]}`] : []), ...(o.flip === 'h' || o.flip === 'hv' ? ['hflip'] : []), ...(o.flip === 'v' || o.flip === 'hv' ? ['vflip'] : [])];
  const { columns, rows } = gridSize(p, width, height);
  const [pw, ph] = pixelsPerCell(o.mode, p.cellAspect);
  const w = Math.min(width, columns * pw) & ~1 || 2, h = Math.min(height, rows * ph) & ~1 || 2;
  const steady = settings(p, columns, rows, { dither: o.dither ?? 'ordered' });
  // --frame n is the frame n frames in (at the video's own rate), on its own.
  const seek = (o.start ?? 0) + (o.frame !== null ? o.frame / source.fps : 0);
  if (!p.live) {
    const one = o.still || o.frame !== null || (!p.output && !o.frames);
    const fps = o.fps ?? Math.min(12, source.fps), limit = one ? 1 : o.frames ?? 48;
    const stream = videoFrames(source, w, h, { fps, limit, start: seek, filters });
    const grids: AsciiGrid[] = [];
    for await (const data of stream.frames) {
      grids.push(toGrid({ data, width: w, height: h }, steady, grids[grids.length - 1] ?? null));
      if (grids.length >= limit) { stream.stop(); break; }
    }
    if (!grids.length) throw new CliError(`No frames came out of ${source.name}.`);
    await emit(p, grids, grids.map(() => 1000 / fps), fps, o.loop ?? true);
    return;
  }
  const fps = Math.min(o.fps ?? source.fps, 30), step = 1000 / fps;
  const player = new Player({});
  const stream = videoFrames(source, w, h, { fps, loop: o.loop ?? false, start: seek, filters });
  void player.done.then(() => stream.stop());
  let previous: AsciiGrid | null = null, shown = 0, start = performance.now();
  for await (const data of stream.frames) {
    if (player.isClosed) break;
    // Paused: the clock stops too, so playing on does not skip ahead.
    if (player.isPaused) { const held = performance.now(); while (player.isPaused && !player.isClosed) await wait(player, 50); start += performance.now() - held; }
    const due = start + shown * step;
    shown++;
    // Behind: drop this frame rather than fall further behind.
    if (!source.live && performance.now() > due + step) continue;
    const grid = toGrid({ data, width: w, height: h }, steady, previous);
    previous = grid;
    player.draw(centred(formatGrids([grid], [0], 'ansi', writeSettings(p, fps, false)).replace(/\n$/, ''), columns));
    if (!source.live) await wait(player, due + step - performance.now());
  }
  stream.stop();
  player.close();
}

// 3D models: a still view, a turn written to a file, or a live view to turn with the mouse.
async function model(p: Plan, model: AsciiModel, name: string) {
  const { o } = p;
  // A model with no colours of its own draws in grey: colour output would only repeat the shading, at many times the size.
  const grey = (c: readonly number[]) => Math.abs(c[0] - c[1]) < 0.02 && Math.abs(c[1] - c[2]) < 0.02;
  const colourful = !!o.paint || !!model.colors || model.materials.some(m => !!m.texture?.image || !grey(m.color));
  if (o.color === null && !colourful) p = { ...p, color: false };
  if (o.crop || o.flip) err.write('--crop and --flip are for pictures and video; a model turns with --yaw and --pitch instead.\n');
  const view = (): ModelRenderOptions => ({
    width: 1, height: 1, yaw: o.yaw ?? 30, pitch: o.pitch ?? 20, zoom: o.zoom ?? 1, ...(o.fov !== null ? { fov: o.fov } : {}),
    ...(o.up ? { up: o.up } : {}), ...(o.shade ? { shading: o.shade } : {}), ...(o.paint ? { paint: o.paint } : {}),
    ...(o.outline !== null ? { outline: o.outline } : {}),
  });
  const gridFor = (columns: number, rows: number, options: ModelRenderOptions, previous: AsciiGrid | null, dither?: 'ordered') => {
    const [width, height, pixelAspect] = modelPixelSize(columns, rows, p.cellAspect, o.mode);
    const pixels = renderModel(model, { ...options, width, height, pixelAspect, background: null });
    return toGrid(pixels, settings(p, columns, rows, { gamma: o.gamma ?? (isBlock(o.mode) ? null : MODEL_GAMMA), ...(dither && o.dither === null ? { dither } : {}) }), previous);
  };
  const square = (reserve = 0) => gridSize(p, 1, 1, reserve);
  if (!p.live) {
    const { columns, rows } = square();
    const spin = o.spin;
    if (!spin || o.still || (!p.output && !RASTER.has(p.format))) {
      if (spin && !p.output && !o.still) err.write('A turning model needs a file to go to (-o turn.svg) or a terminal.\n');
      await emit(p, trimRows([gridFor(columns, rows, view(), null)]), [0], 12, true);
      return;
    }
    const frames = o.frames ?? 36, fps = o.fps ?? 12, grids: AsciiGrid[] = [];
    for (let i = 0; i < frames; i++) grids.push(gridFor(columns, rows, { ...view(), yaw: (o.yaw ?? 30) + (Math.sign(spin) * 360 * i) / frames }, grids[i - 1] ?? null, 'ordered'));
    await emit(p, trimRows(grids), grids.map(() => 1000 / fps), fps, o.loop ?? true);
    return;
  }
  // Live: turned by time, the mouse and the keys; drawn only when something moved.
  const start = view();
  let yaw = start.yaw!, pitch = start.pitch!, zoom = start.zoom!, spin = o.spin ?? 30, dirty = true;
  let size = square(1), previous: AsciiGrid | null = null;
  const triangles = model.indices.length / 3, points = model.positions.length / 3;
  const label = `${name.split(/[\\/]/).pop()} · ${triangles ? `${triangles.toLocaleString('en')} triangles` : `${points.toLocaleString('en')} points`} · drag or arrows to turn, +/- zoom, space pause, q quit`;
  const player = new Player({
    turn: (dx, dy) => { yaw += dx; pitch = Math.max(-89, Math.min(89, pitch + dy)); dirty = true; },
    zoom: f => { zoom = Math.max(0.2, Math.min(20, zoom * f)); dirty = true; },
    reset: () => { yaw = start.yaw!; pitch = start.pitch!; zoom = start.zoom!; dirty = true; },
    pause: () => { dirty = true; },
    resize: () => { size = square(1); previous = null; dirty = true; },
  }, true);
  const fps = Math.min(o.fps ?? 30, 60), step = 1000 / fps;
  let last = performance.now();
  while (!player.isClosed) {
    const now = performance.now(), dt = (now - last) / 1000;
    last = now;
    if (!player.isPaused && spin) { yaw += spin * dt; dirty = true; }
    if (dirty) {
      dirty = false;
      const grid = gridFor(size.columns, size.rows, { ...start, yaw, pitch, zoom }, previous, 'ordered');
      previous = grid;
      const status = `\x1b[2m${label.slice(0, terminalSize().columns - 1)}\x1b[22m`;
      player.draw(`${centred(formatGrids([grid], [0], 'ansi', writeSettings(p, fps, true)).replace(/\n$/, ''), size.columns)}\n${status}`);
    }
    // Still and paused: wait for input rather than drawing the same frame again.
    await wait(player, (!spin || player.isPaused) && !dirty ? 50 : Math.max(1, step - (performance.now() - now)));
  }
  player.close();
}

// A banner in a figlet font (figlet comes with the engine), as text or any of the other formats.
async function banner(p: Plan, text: string) {
  const { default: figlet } = await import('figlet') as unknown as { default: { textSync(text: string, options: { font?: string; width?: number; whitespaceBreak?: boolean }): string } };
  let art: string;
  try { art = figlet.textSync(text, { font: p.o.font ?? 'Standard', width: p.o.width ?? (p.tty ? terminalSize().columns : 100), whitespaceBreak: true }); }
  catch { throw new CliError(`No figlet font called "${p.o.font}". Try Standard, Slant, Big, Doom, Small or 3-D.`); }
  const lines = art.replace(/\s+$/, '').split('\n');
  const columns = Math.max(1, ...lines.map(line => line.length));
  const grid: AsciiGrid = { columns, rows: lines.length, lines: lines.map(line => line.padEnd(columns, ' ')), colors: null, background: p.light ? 'light' : 'dark', cellAspect: p.cellAspect };
  await emit({ ...p, color: false }, [grid], [0], 12, true);
}

/** Where one of several inputs goes: the pattern with {name} filled in, or a file in the folder named. */
function outputFor(pattern: string, input: string, format: CliFormat): string {
  const name = input === '-' ? 'stdin' : basename(input).replace(/\.[^.]+$/, '') || 'art';
  if (pattern.includes('{name}')) return pattern.split('{name}').join(name);
  if (pattern.endsWith('/') || (existsSync(pattern) && statSync(pattern).isDirectory())) return join(pattern, `${name}.${format === 'text' ? 'txt' : format === 'ansi' ? 'ans' : format}`);
  throw new CliError(`With several inputs, -o needs {name} in it or a folder: -o 'ascii/{name}.svg' or -o ascii/.`);
}

async function one(o: CliOptions, input: string, output: string | null, several: boolean) {
  const p = plan(o, output, several);
  if (isBlock(o.mode) && o.charset) err.write(`--charset is for shape and tone modes; ${o.mode} draws its own characters.\n`);
  const source = await openSource(input, { webcam: o.webcam, maxFrames: Math.max(o.frames ?? 0, (o.frame ?? 0) + 1, 500) });
  if (source.kind === 'image') await pictures(p, source.frames, source.loop);
  else if (source.kind === 'video') await movie(p, source);
  else await model(p, source.model, source.name);
}

async function main(argv: string[]) {
  const o = parseArgs(argv);
  if (o.help) { out.write(HELP); return; }
  if (o.version) { out.write(`${(createRequire(import.meta.url)('../package.json') as { version: string }).version}\n`); return; }
  if (!o.inputs.length && !o.text && !o.webcam) {
    if (!process.stdin.isTTY) o.inputs.push('-');
    else { err.write('Usage: asciify-engine <image, video, 3D model or URL> [options]. Try asciify-engine torus, or --help.\n'); process.exitCode = 1; return; }
  }
  if (o.text !== null) { await banner(plan(o, o.output), o.text); return; }
  if (o.webcam || o.inputs.length === 1) { await one(o, o.inputs[0] ?? '-', o.output, false); return; }
  // Several inputs: one after another, each to its own file (or printed with its name), carrying on past a failure.
  const format = o.format ?? (o.output ? formatOf(o.output.replace('{name}', 'x')) ?? (o.output.endsWith('/') ? 'text' : null) : null) ?? (out.isTTY ? 'ansi' : 'text');
  let failed = 0;
  for (const [i, input] of o.inputs.entries()) {
    const output = o.output ? outputFor(o.output, input, format) : null;
    if (!output) out.write(`${i ? '\n' : ''}==> ${input} <==\n`);
    try { await one({ ...o, input, format: o.format ?? (output ? null : format) }, input, output, true); }
    catch (error) { failed++; err.write(`asciify-engine: ${input}: ${messageOf(error)}\n`); }
  }
  if (failed) process.exitCode = 1;
}

/** An error as one line: the stack only with ASCIIFY_DEBUG set, since a stack says nothing to someone running a command. */
function messageOf(error: unknown) {
  if (error instanceof CliError) return error.message;
  if (process.env.ASCIIFY_DEBUG) return (error as Error)?.stack ?? String(error);
  return (error as Error)?.message ?? String(error);
}

main(process.argv.slice(2)).catch(error => {
  // A closed pipe (asciify-engine big.mp4 | head) is not an error.
  if ((error as NodeJS.ErrnoException)?.code === 'EPIPE') return;
  err.write(`asciify-engine: ${messageOf(error)}\n`);
  process.exitCode = 1;
});
