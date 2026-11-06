import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { MODEL_GAMMA, modelPixelSize } from './model/ascii';
import { renderModel, type ModelRenderOptions } from './model/render';
import type { AsciiModel } from './model/types';
import type { AsciiGrid } from './headless/grid';
import { CliError, HELP, formatOf, parseArgs, type CliFormat, type CliOptions } from './cli/args';
import { openSource, videoFrames, type Picture, type Source } from './cli/media';
import { formatGrids, pixelsPerCell, toGrid, trimRows, type GridSettings, type WriteSettings } from './cli/render';
import { Player, terminalColors, terminalIsLight, terminalSize, wait } from './cli/terminal';

/* asciify-engine on the command line: see `asciify-engine --help`. */

const out = process.stdout, err = process.stderr;
const isBlock = (mode: string) => mode === 'braille' || mode === 'half' || mode === 'quad' || mode === 'sextant';

interface Plan {
  o: CliOptions;
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

function plan(o: CliOptions): Plan {
  const tty = !!out.isTTY && !o.output;
  const format = o.format ?? (o.output ? formatOf(o.output) ?? 'text' : out.isTTY ? 'ansi' : 'text');
  const terminal = terminalColors();
  const color = o.color ?? (format === 'svg' || format === 'html' || format === 'json' ? true : format === 'ansi' ? (o.output ? true : terminal !== false) : false);
  const depth = o.colorDepth ?? (format === 'ansi' && terminal ? terminal : 'truecolor');
  const light = o.light ?? (tty ? terminalIsLight() : false);
  const markup = format === 'svg' || format === 'html' || format === 'json';
  const cellAspect = o.cellAspect ?? (markup && !isBlock(o.mode) ? 1.93 : 2);
  return { o, format, live: tty && (format === 'ansi' || format === 'text') && !o.still, tty, color, depth, light, cellAspect };
}

/** The grid's size for a picture of `width` × `height`: as asked, or filling the terminal, or 80 / 100 columns. */
function gridSize(p: Plan, width: number, height: number, reserve = 0): { columns: number; rows: number } {
  const { o, cellAspect } = p, aspect = height / width;
  if (o.width && o.height) return { columns: o.width, rows: o.height };
  if (o.width) return { columns: o.width, rows: Math.max(1, Math.round((o.width * aspect) / cellAspect)) };
  if (o.height) return { columns: Math.max(1, Math.round((o.height * cellAspect) / aspect)), rows: o.height };
  if (!p.tty) {
    const columns = p.format === 'svg' || p.format === 'html' || p.format === 'json' ? 100 : 80;
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
    contrast: o.contrast, brightness: o.brightness, gamma: o.gamma, invert: o.invert, ...extra,
  };
}

function writeSettings(p: Plan, fps: number, loop: boolean): WriteSettings {
  const { o } = p;
  return {
    colorDepth: p.depth, color: p.color, fps, loop,
    ...(o.fontSize ? { fontSize: o.fontSize } : {}), ...(o.title ? { title: o.title } : {}), ...(o.background ? { background: o.background } : {}),
    ...(o.ink ? { ink: o.ink } : {}), ...(o.darkInk ? { dark: { ink: o.darkInk } } : {}),
  };
}

/** Lines moved to the middle of the terminal. */
function centred(text: string, columns: number) {
  const pad = Math.max(0, Math.floor((terminalSize().columns - columns) / 2));
  return pad ? text.split('\n').map(line => ' '.repeat(pad) + line).join('\n') : text;
}

async function emit(p: Plan, grids: AsciiGrid[], delays: number[], fps: number, loop: boolean) {
  const text = formatGrids(grids, delays, p.format, writeSettings(p, fps, loop));
  if (p.o.output) {
    await writeFile(p.o.output, text);
    err.write(`Wrote ${p.o.output} (${grids[0].columns}×${grids[0].rows}${grids.length > 1 ? `, ${grids.length} frames` : ''}).\n`);
  } else out.write(text);
}

// Pictures: one frame, or an animation (GIF, APNG, WebP through sharp).
async function pictures(p: Plan, frames: Picture[], loopCount: number) {
  const { o } = p;
  const { columns, rows } = gridSize(p, frames[0].width, frames[0].height);
  const animated = frames.length > 1 && !o.still;
  if (!animated) { await emit(p, [toGrid(frames[0], settings(p, columns, rows))], [0], 12, true); return; }
  const loop = o.loop ?? (loopCount !== 1);
  const steady = settings(p, columns, rows, { dither: o.dither ?? 'ordered' });
  if (!p.live) {
    if (!p.o.output && !o.frames) {
      err.write('An animation: writing its first frame. Use -o file.svg (or .json) for every frame, or --frames N.\n');
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
  const { columns, rows } = gridSize(p, source.width, source.height);
  const [pw, ph] = pixelsPerCell(o.mode, p.cellAspect);
  const w = Math.min(source.width, columns * pw) & ~1 || 2, h = Math.min(source.height, rows * ph) & ~1 || 2;
  const steady = settings(p, columns, rows, { dither: o.dither ?? 'ordered' });
  if (!p.live) {
    const fps = o.fps ?? Math.min(12, source.fps), limit = o.still || !o.output ? 1 : o.frames ?? 48;
    const stream = videoFrames(source, w, h, { fps, limit });
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
  const stream = videoFrames(source, w, h, { fps, loop: o.loop ?? false });
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
    if (!spin || o.still || !o.output) {
      if (spin && !o.output && !o.still) err.write('A turning model needs a file to go to (-o turn.svg) or a terminal.\n');
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

async function main(argv: string[]) {
  const o = parseArgs(argv);
  if (o.help) { out.write(HELP); return; }
  if (o.version) { out.write(`${(createRequire(import.meta.url)('../package.json') as { version: string }).version}\n`); return; }
  if (!o.input && !o.text && !o.webcam) {
    if (!process.stdin.isTTY) o.input = '-';
    else { err.write('Usage: asciify-engine <image, video, 3D model or URL> [options]. Try asciify-engine torus, or --help.\n'); process.exitCode = 1; return; }
  }
  const p = plan(o);
  if (o.text !== null) { await banner(p, o.text); return; }
  const source = await openSource(o.input ?? '-', { webcam: o.webcam, maxFrames: Math.max(o.frames ?? 0, 500) });
  if (source.kind === 'image') await pictures(p, source.frames, source.loop);
  else if (source.kind === 'video') await movie(p, source);
  else await model(p, source.model, source.name);
}

main(process.argv.slice(2)).catch(error => {
  // A closed pipe (asciify-engine big.mp4 | head) is not an error.
  if ((error as NodeJS.ErrnoException)?.code === 'EPIPE') return;
  err.write(`asciify-engine: ${error instanceof CliError ? error.message : (error as Error)?.stack ?? error}\n`);
  process.exitCode = 1;
});
