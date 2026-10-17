import type { GlyphFieldOptions } from '../field';
import { hash, type KitHandle, type KitOptions } from './core';
import { blank, mountPageField, pageHandle, pulseAt, sleep, type PageField } from './page-field';

export type FieldPreset = 'hero' | 'notFound' | 'brand';

export interface FieldBackgroundOptions extends KitOptions {
  /** `hero`: a drifting ground of characters. `brand`: the same ground, denser, in the brand colour. `notFound`: the page's code set large in characters. Default `hero`. */
  preset?: FieldPreset;
  /** The headline block to keep clear: the ground fades out in a soft ellipse round it, so a frosted veil over it reads clean. */
  clear?: HTMLElement | false;
  /** The ink, one colour or one per ground. Wins over `ink`. `brand` defaults to `var(--brand)`. */
  palette?: string | { light?: string; dark?: string };
  /** `notFound` only: the characters drawn. Default `404`. */
  text?: string;
  /** The pointer drops a soft ring into the ground every so often (`hero` and `brand`). Default true. */
  ripple?: boolean;
  /** The canvas's accessible name. `notFound` defaults to its text; the grounds are decorative and hidden. */
  label?: string;
}

export interface FieldBackgroundHandle extends KitHandle<FieldBackgroundOptions> {
  /** Sends a ring through the field from an element, a viewport point or the centre. Ripples hold off for a moment after. */
  pulse(from?: Element | { x: number; y: number }, strength?: number): void;
  /** `notFound`: the characters break apart, hang for a beat and re-form, as the next page would load. Other presets pulse. */
  scatter(from?: Element): Promise<void>;
}

const DEFAULTS = { preset: 'hero' as FieldPreset, clear: false as HTMLElement | false, text: '404', ripple: true };
const TILE = 28, LOST_FONT = '600 440px "Geist", Arial, sans-serif';

const narrow = () => typeof innerWidth === 'number' && innerWidth < 760;
/** The drifting ground: the landing's background material. */
const ground = (extra: GlyphFieldOptions): GlyphFieldOptions => ({
  mark: 'glyph', scene: 'drift', levels: 'auto', charset: ' .:+*#', font: '"Geist Mono", ui-monospace, monospace', fontWeight: 400,
  cellSize: 10, cellAspect: 0.62, glyphScale: 0.86, color: 'ink', shade: 0, hover: 'trail', trail: { strength: 0.9, radius: 0.32 }, ...extra,
});
const LOST_LOOK: GlyphFieldOptions = {
  mark: 'glyph', scene: 'none', charset: ' .:-=+*#%@', font: '"Geist", Arial, sans-serif', fontWeight: 500, cellSize: 7, cellAspect: 0.8, glyphScale: 0.8,
  color: 'ink', shade: 0, contrast: 1.4, fit: 'contain', clear: false, focus: { x: 0.5, y: 0.5 }, drift: 0.8, speed: 0.7, levels: 'auto', hover: 'trail', trail: { strength: 1, radius: 0.42 },
};

/** The text drawn on a canvas sized to it, so the field sets it as large as the space allows. */
export function lostArt(text: string) {
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = LOST_FONT;
  const width = Math.max(320, Math.ceil(probe.measureText(text).width) + 160), height = 560;
  const { canvas, pen } = blank(width, height);
  pen.fillStyle = '#fff'; pen.textAlign = 'center'; pen.textBaseline = 'middle';
  pen.font = LOST_FONT;
  pen.letterSpacing = '-10px';
  pen.fillText(text, width / 2, height / 2 + 16);
  return canvas;
}

/** The lit tiles of the art, each with its own direction, so the characters break into drifting fragments. */
export function lostTiles(art: HTMLCanvasElement) {
  const data = art.getContext('2d')!.getImageData(0, 0, art.width, art.height).data;
  const tiles: { x: number; y: number; dx: number; dy: number; lag: number }[] = [];
  for (let y = 0; y < art.height; y += TILE) for (let x = 0; x < art.width; x += TILE) {
    let lit = false;
    for (let k = 0; k < TILE && !lit; k += 4) for (let j = 0; j < TILE && !lit; j += 4) lit = (data[((y + k) * art.width + x + j) * 4] ?? 0) > 40;
    if (!lit) continue;
    const i = tiles.length, angle = hash(i, 1) * Math.PI * 2, reach = 120 + hash(i, 2) * 420;
    tiles.push({ x, y, dx: Math.cos(angle) * reach + (x - art.width / 2) * 0.5, dy: Math.sin(angle) * reach * 0.6, lag: hash(i, 3) * 0.35 });
  }
  return tiles;
}

/** The scatter's frames: out over ten, a three-frame hang, back over fourteen. */
export const SCATTER_STEPS = [...Array.from({ length: 10 }, (_, i) => (i + 1) / 10), 1, 1, 1, ...Array.from({ length: 14 }, (_, i) => 1 - (i + 1) / 14)];

function scatterFrame(art: HTMLCanvasElement, work: HTMLCanvasElement, tiles: ReturnType<typeof lostTiles>, amount: number) {
  const pen = work.getContext('2d')!;
  pen.globalAlpha = 1; pen.fillStyle = '#000'; pen.fillRect(0, 0, work.width, work.height);
  for (const tile of tiles) {
    const k = Math.min(1, Math.max(0, (amount - tile.lag * (1 - amount)) / (1 - tile.lag * 0.5))), e = k * k * (3 - 2 * k);
    pen.globalAlpha = 1 - e * 0.72;
    pen.drawImage(art, tile.x, tile.y, TILE, TILE, tile.x + tile.dx * e, tile.y + tile.dy * e, TILE, TILE);
  }
  pen.globalAlpha = 1;
}

/**
 * A page background drawn in characters: the hero's drifting ground with a soft clear zone round the headline, the same ground in
 * the brand colour, or a 404 set large that scatters and re-forms.
 */
export function fieldBackground(element: HTMLElement, options: FieldBackgroundOptions = {}): FieldBackgroundHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  const lost = () => state.current.preset === 'notFound';
  let run = 0, busy = false, hold = 0;
  const ripple = { x: -1e4, y: -1e4, at: -1e6 };

  const look = (): GlyphFieldOptions => {
    const o = state.current, clear = o.clear;
    const zone = (feather: number) => (clear ? { element: clear, padding: -14, feather, shape: 'ellipse' as const } : false);
    const base = o.preset === 'notFound' ? LOST_LOOK
      : o.preset === 'brand' ? ground({ scale: narrow() ? 1.4 : 1.6, brightness: 0.24, contrast: 1.1, clear: zone(0.3) })
      : ground({ scale: narrow() ? 1.6 : 1.9, brightness: 0.26, contrast: 1.15, clear: zone(0.22) });
    return { ...base, ...o.look };
  };
  const ink = (dark: boolean) => {
    const o = state.current, p = o.palette;
    const chosen = typeof p === 'string' ? p : p?.[dark ? 'dark' : 'light'];
    if (chosen ?? o.ink) return chosen ?? o.ink;
    if (o.preset === 'notFound') return dark ? '#d8d6cf' : '#1d1d1b';
    if (o.preset === 'brand') return `var(--brand, ${dark ? '#8f80ff' : '#5b4bd1'})`;
    return dark ? '#8a8881' : '#6b6964';
  };
  const draw = () => lostArt(state.current.text);

  let page: PageField | null = null;
  page = mountPageField({
    host: element,
    look,
    ink,
    source: lost() ? draw() : null,
    label: state.current.label ?? (lost() ? state.current.text : undefined),
    kit: state,
    reducedMotion: () => state.current.reducedMotion,
    onFail: () => { page = null; },
  });
  // The numerals wait for the display font, then are set again in it.
  if (page && lost()) void document.fonts?.load?.(LOST_FONT).then(() => { if (page && lost() && !busy) void page.field.setSource(draw()); }, () => {});

  const pulse = (from?: Element | { x: number; y: number }, strength = 1.4) => {
    if (!page || page.still()) return;
    hold = performance.now() + 1400;
    pulseAt(page.field, from, strength);
  };
  // The cursor drops a soft ring every so often, so the ground answers movement, not only the trail.
  const move = (event: PointerEvent) => {
    const o = state.current, now = performance.now();
    if (!page || lost() || !o.ripple || page.still() || now < hold || now - ripple.at < 520) return;
    if (Math.hypot(event.clientX - ripple.x, event.clientY - ripple.y) < 36) return;
    Object.assign(ripple, { x: event.clientX, y: event.clientY, at: now });
    pulseAt(page.field, { x: event.clientX, y: event.clientY }, 0.65);
  };
  if (page) element.addEventListener('pointermove', move);

  const scatter = async (from?: Element) => {
    const f = page?.field;
    if (!f) return;
    if (!lost()) { pulse(from); return; }
    if (from) pulse(from, 1.2);
    if (busy || page!.still()) return;
    busy = true;
    const id = ++run, shown = draw(), tiles = lostTiles(shown), work = blank(shown.width, shown.height).canvas;
    for (const amount of SCATTER_STEPS) {
      const t = performance.now();
      scatterFrame(shown, work, tiles, amount);
      await f.setSource(work);
      await sleep(Math.max(0, 44 - (performance.now() - t)));
      if (id !== run || !page) { busy = false; return; }
    }
    await f.setSource(shown);
    busy = false;
  };

  let preset = state.current.preset, text = state.current.text;
  return pageHandle(() => page, state, next => {
    if (!page) return;
    if (next.preset !== preset || (next.preset === 'notFound' && next.text !== text)) {
      run++; busy = false;
      void page.field.setSource(next.preset === 'notFound' ? draw() : null);
    }
    preset = next.preset; text = next.text;
  }, { pulse, scatter }, () => {
    run++;
    element.removeEventListener('pointermove', move);
  });
}

export const FIELD_BACKGROUND_DEFAULTS = DEFAULTS;
