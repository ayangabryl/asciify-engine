import type { GlyphFieldOptions } from '../field';
import { clamp, handle, hash, mountSurface, smoothstep, type KitHandle, type KitOptions, type Surface } from './core';

export type BeamPalette = 'colorful' | 'mono' | 'ocean' | 'sunset' | readonly string[];
export type BeamMode = 'rotate' | 'pulse' | 'progress';

export interface BeamOptions extends KitOptions {
  /** A named palette, or your own hex stops looped once round the border. `mono` draws in the ink. Default `colorful`. */
  palette?: BeamPalette;
  /** `rotate`: two arcs turn round the border. `pulse`: the whole border breathes. `progress`: quiet at rest, lit while work runs. */
  mode?: BeamMode;
  /** `dots` is a fine halftone; `glyphs` draws the light in small characters. */
  grain?: 'dots' | 'glyphs';
  /** Lap speed multiplier. 1 is a 2.6 second lap. */
  speed?: number;
  /** Faster and brighter while the pointer is over the element or it holds visible focus. Default true. */
  hover?: boolean;
  /** How far the glow reaches inward, in CSS px. It also stops 2px short of the element's padding. Default 18. */
  depth?: number;
  /** How far the faint bloom reaches outside the border, in CSS px. Default 7. */
  outset?: number;
}

export interface BeamHandle extends KitHandle<BeamOptions> {
  /** Work is running, 0–1. The beam speeds up as it fills. */
  progress(value: number): void;
  /** One bright pass of light round the whole border, then the beam settles. */
  success(): void;
  /** The turn stutters, then crawls on in red until `reset()` or `progress()`. */
  error(): void;
  /** Back to rest. */
  reset(): void;
}

export const BEAM_PALETTES: Record<'colorful' | 'mono' | 'ocean' | 'sunset', readonly string[]> = {
  colorful: ['#22c55e', '#06b6d4', '#6366f1', '#d946ef', '#f43f5e', '#f59e0b'],
  mono: ['#ffffff'],
  ocean: ['#22d3ee', '#3b82f6', '#2dd4bf', '#818cf8'],
  sunset: ['#f97316', '#f43f5e', '#ec4899', '#fbbf24'],
};
const DEFAULTS = { palette: 'colorful' as BeamPalette, mode: 'rotate' as BeamMode, grain: 'dots' as const, speed: 1, hover: true, depth: 18, outset: 7 };

// Tone is GAIN x the painted luminance (contrast GAIN, brightness GAIN / 2 - 0.5), so a violet or a blue still reaches a full dot.
const GAIN = 2.4;
// The field samples a mip of the source, so a lit cell bleeds into its neighbours; tones under KNEE are cut, so that bleed draws nothing.
const KNEE = 0.12;
const RED = [1, 0.29, 0.29];
const SPIN = 2600;

const rgbOf = (hex: string) => { const h = /^#[\da-f]{3}$/i.test(hex) ? `#${[...hex.slice(1)].map(c => c + c).join('')}` : hex; return [1, 3, 5].map(i => (parseInt(h.slice(i, i + 2), 16) || 0) / 255); };
const mixRgb = (a: number[], b: number[], k: number) => a.map((v, i) => v + (b[i] - v) * k);

/** 256 steps of a looped palette, each at full value with its luminance, so a pixel is one lookup. */
export function beamPalette(palette: BeamPalette) {
  const stops = (typeof palette === 'string' ? BEAM_PALETTES[palette] ?? BEAM_PALETTES.colorful : palette.length ? palette : BEAM_PALETTES.colorful).map(rgbOf);
  const lut = new Float32Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const x = (i / 256) * stops.length, j = Math.floor(x), t = x - j;
    const c = stops.length === 1 ? stops[0] : mixRgb(stops[j % stops.length], stops[(j + 1) % stops.length], t * t * (3 - 2 * t)), top = Math.max(...c, 0.01);
    lut.set([c[0] / top, c[1] / top, c[2] / top, (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / top], i * 4);
  }
  return lut;
}

/** One arc: a bright head at `f` = 0 with a short soft front, and a tail `len` turns long fading behind it. */
const arc = (f: number, len: number) => {
  const behind = ((-f % 1) + 1) % 1, ahead = 1 - behind;
  return Math.max(behind < len ? (1 - behind / len) ** 2.2 : 0, ahead < 0.03 ? (1 - ahead / 0.03) ** 2 : 0);
};
/** Two arcs half a turn apart, the second shorter and dimmer. */
export const beamArcs = (f: number) => Math.max(arc(f, 0.3), 0.75 * arc(f - 0.5, 0.22));

/**
 * For each field cell near the edge: its depth weight and its angle round the rounded rectangle.
 * Brightest on the edge, fading inward over `deep` px, with a faint bloom `out` px outside.
 */
export function beamBand(w: number, h: number, cw: number, ch: number, deep: number, out: number, radius: number) {
  const cols = Math.ceil(w / cw), hw = (w - 2 * out) / 2, hh = (h - 2 * out) / 2, r = Math.max(0, Math.min(radius, hw, hh));
  const slot = new Int32Array(cols * Math.ceil(h / ch)).fill(-1), weight: number[] = [], turn: number[] = [], outside: number[] = [];
  for (let i = 0; i < slot.length; i++) {
    const px = ((i % cols) + 0.5) * cw - w / 2, py = (Math.floor(i / cols) + 0.5) * ch - h / 2;
    const qx = Math.abs(px) - hw + r, qy = Math.abs(py) - hh + r;
    const depth = -(Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r);
    const k = depth >= 0 ? Math.max(0, 1 - depth / Math.max(1, deep)) ** 1.7 : out > 0 ? 0.22 * Math.max(0, 1 + depth / out) ** 2 : 0;
    if (k < 0.004) continue;
    slot[i] = weight.length; weight.push(k); outside.push(depth < 0 ? 1 : 0);
    // Angle in a square-normalised frame, so the light keeps an even pace along long and short sides.
    turn.push(Math.atan2(py / Math.max(1, hh), px / Math.max(1, hw)) / (2 * Math.PI) + 0.25);
  }
  const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h)), pixel: number[] = [], owner: number[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const at = slot[Math.min(cols - 1, Math.floor((x + 0.5) / cw)) + cols * Math.floor((y + 0.5) / ch)];
    if (at >= 0) { pixel.push(y * W + x); owner.push(at); }
  }
  return { W, H, weight: Float32Array.from(weight), turn: Float32Array.from(turn), outside: Uint8Array.from(outside), pixel: Int32Array.from(pixel), owner: Int32Array.from(owner) };
}

const px = (value: string, size: number) => (value.endsWith('%') ? (parseFloat(value) / 100) * size : parseFloat(value) || 0);

/**
 * A band of light turning round an element's border, drawn as fine halftone dots or small characters.
 * Rounded corners are followed from the element's own border radius.
 */
export function beam(element: HTMLElement, options: BeamOptions = {}): BeamHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  type Phase = 'idle' | 'running' | 'success' | 'error';
  let phase = 'idle' as Phase, fill = 0, lut = beamPalette(state.current.palette), hot = false;
  const mono = () => state.current.palette === 'mono';
  const look = (): GlyphFieldOptions => ({
    ...(state.current.grain === 'glyphs'
      ? { mark: 'glyph', charset: ' ·.:-+*', font: '"Geist Mono", ui-monospace, monospace', fontWeight: 500, cellSize: 5, cellAspect: 0.6, glyphScale: 1 }
      : { mark: 'dot', cellSize: 3.5, cellAspect: 1, dotScale: 0.82 }),
    color: mono() ? 'ink' : 'source', saturation: 1.25, shade: 0.55, contrast: GAIN, brightness: GAIN / 2 - 0.5 - KNEE,
    ...state.current.look,
  });

  const canvasStyle = (s: Surface) => {
    const light = !s.dark();
    s.canvas.style.opacity = light ? '0.72' : '';
    s.canvas.style.filter = light && !mono() ? 'brightness(1.45) saturate(.9)' : '';
  };

  let band: ReturnType<typeof beamBand> | null = null, image: ImageData | null = null, rgb = new Uint8Array(0), size = '';
  let then = 0, seen: Phase | null = null, mark = 0, rot = 0.62, hue = 0, v = 0, lift = 0, red = 0, flash = 0, presence = 1;
  let surface: Surface | null = null;
  surface = mountSurface({
    host: element,
    outset: state.current.outset,
    look,
    ink: dark => state.current.ink ?? (dark ? '#b3b1aa' : '#8a8882'),
    reducedMotion: () => state.current.reducedMotion,
    onTheme: () => surface && canvasStyle(surface),
    onFail: () => { surface = null; },
    resolution: (w, h) => [Math.max(1, Math.round(w)), Math.max(1, Math.round(h))],
    paint: frame => {
      const { pen, w, h, now, still, dark } = frame, o = state.current;
      const style = getComputedStyle(element);
      const deep = Math.max(2, Math.min(o.depth, Math.min(parseFloat(style.paddingTop) || o.depth, parseFloat(style.paddingLeft) || o.depth) - 2));
      const radius = px(style.borderTopLeftRadius, Math.min(element.clientWidth, element.clientHeight));
      const key = `${w}x${h}:${o.grain}:${deep}:${radius}:${o.outset}`;
      if (key !== size) {
        size = key;
        // The field's own cell in CSS px: whole device pixels, as the engine lays them out.
        const ratio = Math.min(globalThis.devicePixelRatio || 1, 2), tall = Math.max(2, Math.round((o.grain === 'glyphs' ? 5 : 3.5) * ratio));
        band = beamBand(w, h, (o.grain === 'glyphs' ? Math.max(2, Math.round(tall * 0.6)) : tall) / ratio, tall / ratio, deep, o.outset, radius);
        image = pen.createImageData(band.W, band.H);
        rgb = new Uint8Array(band.weight.length * 3);
      }
      const b = band!, data = image!.data;
      const draw = (light: (turn: number) => number, shift: number, redness: number) => {
        rgb.fill(0);
        for (let i = 0; i < b.weight.length; i++) {
          if (!dark && b.outside[i]) continue;
          // Dot size and brightness both follow the tone: large at the border, specks inward. A light ground holds the peak lower.
          const t = b.turn[i], tone = clamp(b.weight[i] * light(t)) * (dark ? 1.12 : 0.8);
          if (tone < 0.03) continue;
          const k = (Math.floor(((((t - shift) % 1) + 1) % 1) * 256) & 255) * 4;
          let cr = lut[k], cg = lut[k + 1], cb = lut[k + 2], lum = lut[k + 3];
          if (redness > 0) { cr += (RED[0] - cr) * redness; cg += (RED[1] - cg) * redness; cb += (RED[2] - cb) * redness; lum = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb; }
          // Scale the hue so its luminance x GAIN lands on the tone: the field reads that back as the dot's size.
          const scale = Math.min(1, (tone + KNEE) / GAIN / Math.max(lum, 0.01)) * 255;
          rgb[i * 3] = cr * scale; rgb[i * 3 + 1] = cg * scale; rgb[i * 3 + 2] = cb * scale;
        }
        data.fill(0);
        for (let j = 0; j < b.pixel.length; j++) {
          const p = b.pixel[j] * 4, i = b.owner[j] * 3;
          data[p] = rgb[i]; data[p + 1] = rgb[i + 1]; data[p + 2] = rgb[i + 2]; data[p + 3] = 255;
        }
        pen.putImageData(image!, 0, 0);
      };

      if (still) {
        // Reduced motion: a still gradient border, one level per state.
        const level = phase === 'success' ? 0.9 : phase === 'running' ? 0.75 : 0.55;
        draw(t => level * (0.7 + 0.3 * Math.cos(2 * Math.PI * (t - 0.12))), 0, phase === 'error' ? 0.85 : 0);
        return false;
      }
      const dt = then ? Math.min(48, now - then) : 16;
      then = now;
      if (phase !== seen) { if (phase === 'success' || phase === 'error') mark = now; seen = phase; }
      const running = phase === 'running', failed = phase === 'error', since = now - mark, heat = o.hover && hot;
      const lap = (running ? 1500 - 500 * fill : o.mode === 'progress' ? 7000 : o.mode === 'pulse' ? 9000 : SPIN) / Math.max(0.05, o.speed);
      v += ((1 / lap) * (heat ? 1.35 : 1) * (failed ? 0.4 : 1) - v) * (1 - Math.exp(-dt / 320));
      // An error stutters: the turn catches and jumps for a second, then crawls on in red.
      const stutter = failed && since < 1100 ? hash(Math.floor(since / 85), 7) : -1;
      rot += v * dt * (stutter < 0 ? 1 : stutter < 0.45 ? 0 : 2.6);
      hue += dt / (o.mode === 'pulse' ? 14000 : 26000);
      lift += ((heat ? 1 : 0) - lift) * (1 - Math.exp(-dt / 220));
      red += ((failed ? 0.85 : 0) - red) * (1 - Math.exp(-dt / (failed ? 140 : 420)));
      flash = phase === 'success' ? smoothstep(0, 120, since) * (1 - clamp((since - 420) / 1400)) ** 1.6 : flash * Math.exp(-dt / 200);
      const quiet = o.mode === 'progress' && !running && !failed && flash < 0.01;
      presence += ((quiet ? 0.3 : 1) - presence) * (1 - Math.exp(-dt / 400));
      const flicker = stutter < 0 ? 1 : 0.55 + 0.45 * hash(Math.floor(since / 60), 3);
      const gain = presence * (1 + 0.22 * lift) * flicker;
      const breath = 0.32 + 0.68 * (0.5 - 0.5 * Math.cos((2 * Math.PI * now) / 2400));
      const shape = o.mode === 'pulse' && !running ? (t: number) => breath * (0.78 + 0.22 * Math.cos(2 * Math.PI * (t - rot))) : (t: number) => beamArcs(t - rot);
      draw(t => Math.max(shape(t) * gain, flash * 1.05), hue, red);
      return true;
    },
  });

  const onEnter = () => { hot = true; }, onLeave = () => { hot = false; };
  const onFocus = (event: FocusEvent) => { hot = (event.target as Element)?.matches?.(':focus-visible') ?? false; };
  if (surface) {
    canvasStyle(surface);
    element.addEventListener('pointerenter', onEnter);
    element.addEventListener('pointerleave', onLeave);
    element.addEventListener('focusin', onFocus);
    element.addEventListener('focusout', onLeave);
  }
  const set = (next: Phase) => { phase = next; surface?.kick(); };

  return handle(() => surface, state, next => {
    lut = beamPalette(next.palette);
    surface?.refresh();
    if (surface) canvasStyle(surface);
  }, {
    progress(value: number) { fill = clamp(Number.isFinite(value) ? value : 0); set('running'); },
    success() { set('success'); },
    error() { set('error'); },
    reset() { fill = 0; set('idle'); },
  }, () => {
    element.removeEventListener('pointerenter', onEnter);
    element.removeEventListener('pointerleave', onLeave);
    element.removeEventListener('focusin', onFocus);
    element.removeEventListener('focusout', onLeave);
  });
}

/** For tests: the options a beam starts from. */
export const BEAM_DEFAULTS = DEFAULTS;
