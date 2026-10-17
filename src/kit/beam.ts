import type { GlyphFieldOptions } from '../field';
import { clamp, handle, hash, mountSurface, smoothstep, type KitHandle, type KitOptions, type Surface } from './core';

export type BeamPalette = 'colorful' | 'mono' | 'ocean' | 'sunset' | readonly string[];
export type BeamMode = 'rotate' | 'pulse' | 'progress';

export interface BeamOptions extends KitOptions {
  /** A named palette, or your own hex stops looped once round the border. `mono` draws in the ink. Default `colorful`. */
  palette?: BeamPalette;
  /** `rotate`: two arcs turn round the border. `pulse`: the whole border breathes. `progress`: all but dark at rest, a progress ring while work runs. */
  mode?: BeamMode;
  /** `dots` is a fine halftone; `glyphs` draws the light in small characters. */
  grain?: 'dots' | 'glyphs';
  /** Lap speed multiplier. 1 is a 2.6 second lap. */
  speed?: number;
  /** Faster and brighter while the pointer is over the element or it holds visible focus. Default true. */
  hover?: boolean;
  /** How far the glow reaches inward, in CSS px. It also stops 2px short of the element's padding. Default 18. */
  depth?: number;
}

export interface BeamHandle extends KitHandle<BeamOptions> {
  /** Work is running, 0–1. In `progress` mode the ring grows clockwise from the top to this point; the other modes speed up as it fills. */
  progress(value: number): void;
  /** The light closes into a full ring, a flash sweeps once round it, a green fade settles, then the beam goes back to rest. */
  success(): void;
  /** Everything stops, flickers red twice and cracks into dim red fragments, which stay until `reset()` or `progress()`. */
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
const DEFAULTS = { palette: 'colorful' as BeamPalette, mode: 'rotate' as BeamMode, grain: 'dots' as const, speed: 1, hover: true, depth: 18 };
const MODES: BeamMode[] = ['rotate', 'pulse', 'progress'];

// Tone is GAIN x the painted luminance (contrast GAIN, brightness GAIN / 2 - 0.5), so a violet or a blue still reaches a full dot.
const GAIN = 2.4;
// The field samples a mip of the source, so a lit cell bleeds into its neighbours; tones under KNEE are cut, so that bleed draws nothing.
const KNEE = 0.12;
const SPIN = 2600, SETTLED = 2700;

const rgbOf = (hex: string) => { const h = /^#[\da-f]{3}$/i.test(hex) ? `#${[...hex.slice(1)].map(c => c + c).join('')}` : hex; return [1, 3, 5].map(i => (parseInt(h.slice(i, i + 2), 16) || 0) / 255); };
const mixRgb = (a: number[], b: number[], k: number) => a.map((v, i) => v + (b[i] - v) * k);
const RED = rgbOf('#ff4a4a'), GREEN = rgbOf('#2fd67b');

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
/** The progress ring: lit clockwise from the top to `p`, brightening toward a head at `p`. */
export const beamRing = (t: number, p: number) => {
  if (t <= p) return 0.42 + 0.4 * (t / Math.max(p, 0.001)) ** 1.6 + 0.38 * Math.exp(-(((p - t) / 0.03) ** 2));
  return t - p < 0.014 ? 1.2 * (1 - (t - p) / 0.014) ** 2 : 0;
};
/** What is left of a cell once the border has cracked `k` of the way: whole runs drop out, then single dots. */
export const beamCracked = (score: number, k: number) => clamp((score - 0.68 * k) / 0.07);

/**
 * For each field cell inside the edge: its depth weight, its turn round the border from the top, clockwise, and its crack score.
 * Depth is the signed distance to the rounded rectangle with each corner's own radius, fading inward over `deep` px. Where a corner
 * curves through a cell, the weight is held to the room inside the curve (`dot` px is a full dot), so the clip never shears one.
 */
export function beamBand(w: number, h: number, cw: number, ch: number, deep: number, radii: readonly number[], dot: number) {
  const cols = Math.ceil(w / cw), hw = w / 2, hh = h / 2, cap = Math.min(hw, hh);
  const [tl, tr, br, bl] = [0, 1, 2, 3].map(i => Math.max(0, Math.min(radii[i] ?? radii[0] ?? 0, cap)));
  const slot = new Int32Array(cols * Math.ceil(h / ch)).fill(-1), weight: number[] = [], turn: number[] = [], crack: number[] = [];
  for (let i = 0; i < slot.length; i++) {
    const px = ((i % cols) + 0.5) * cw - hw, py = (Math.floor(i / cols) + 0.5) * ch - hh;
    const r = px < 0 ? (py < 0 ? tl : bl) : (py < 0 ? tr : br);
    const qx = Math.abs(px) - hw + r, qy = Math.abs(py) - hh + r;
    const depth = -(Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r);
    const k = depth > 0 ? Math.min(Math.max(0, 1 - depth / Math.max(1, deep)) ** 1.7, depth / Math.max(0.1, dot)) : 0;
    if (k < 0.004) continue;
    slot[i] = weight.length; weight.push(k);
    // Angle in a square-normalised frame, so the light keeps an even pace along long and short sides.
    const u = Math.atan2(py / Math.max(1, hh), px / Math.max(1, hw)) / (2 * Math.PI) + 0.25, f = u - Math.floor(u);
    turn.push(f);
    crack.push(0.78 * hash(Math.floor(f * 46), 5) + 0.22 * hash(i, 9));
  }
  const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h)), pixel: number[] = [], owner: number[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const at = slot[Math.min(cols - 1, Math.floor((x + 0.5) / cw)) + cols * Math.floor((y + 0.5) / ch)];
    if (at >= 0) { pixel.push(y * W + x); owner.push(at); }
  }
  return { W, H, weight: Float32Array.from(weight), turn: Float32Array.from(turn), crack: Float32Array.from(crack), pixel: Int32Array.from(pixel), owner: Int32Array.from(owner) };
}

const px = (value: string, size: number) => (value.endsWith('%') ? (parseFloat(value) / 100) * size : parseFloat(value) || 0);

/**
 * A band of light round an element's border, drawn as fine halftone dots or small characters inside the edge.
 * The field covers the element exactly and is clipped to its computed corner radii, so nothing lands past its corners.
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
  let then = 0, seen: Phase | null = null, mark = 0, rot = 0.62, hue = 0, v = 0, lift = 0, red = 0, p = 0, clock = 0;
  const weight: Record<BeamMode, number> = { rotate: 0, pulse: 0, progress: 0 };
  weight[state.current.mode] = 1;
  let surface: Surface | null = null;
  surface = mountSurface({
    host: element,
    look,
    ink: dark => state.current.ink ?? (dark ? '#b3b1aa' : '#8a8882'),
    kit: state,
    reducedMotion: () => state.current.reducedMotion,
    onTheme: () => surface && canvasStyle(surface),
    onFail: () => { surface = null; },
    resolution: (w, h) => [Math.max(1, Math.round(w)), Math.max(1, Math.round(h))],
    paint: frame => {
      const { pen, w, h, now, still, dark } = frame, o = state.current;
      const style = getComputedStyle(element), short = Math.min(element.clientWidth || w, element.clientHeight || h);
      const deep = Math.max(2, Math.min(o.depth, Math.min(parseFloat(style.paddingTop) || o.depth, parseFloat(style.paddingLeft) || o.depth) - 2));
      const radii = [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius].map(r => px(r ?? '', short));
      // The band is laid on the field's own cells, so a `look` that changes the cell size moves the band with it.
      const L = look(), glyphs = L.mark !== 'dot', cell = L.cellSize ?? (glyphs ? 5 : 3.5), aspect = L.cellAspect ?? (glyphs ? 0.6 : 1);
      const key = `${w}x${h}:${o.grain}:${deep}:${radii.join(',')}:${cell}:${aspect}`;
      if (key !== size) {
        size = key;
        surface!.canvas.style.clipPath = `inset(0 round ${radii.map(r => `${r}px`).join(' ')})`;
        // The field's own cell in CSS px: whole device pixels, as the engine lays them out.
        const ratio = Math.min(globalThis.devicePixelRatio || 1, L.maxPixelRatio ?? 2), tall = Math.max(2, Math.round(cell * ratio));
        const cw = Math.max(2, Math.round(tall * aspect)) / ratio, ch = tall / ratio;
        band = beamBand(w, h, cw, ch, deep, radii, glyphs ? Math.min(cw, ch) / 2 : ((L.dotScale ?? 0.82) * cw) / 2);
        image = pen.createImageData(band.W, band.H);
        rgb = new Uint8Array(band.weight.length * 3);
      }
      const b = band!, data = image!.data, crack = b.crack;
      /** `light(turn, cell)` is the strength there; `red` and `green` tint toward the error and success colours; `white(turn)` lifts a flash. */
      const draw = (light: (turn: number, cell: number) => number, shift: number, redness: number, greenness: number, white?: (turn: number) => number) => {
        rgb.fill(0);
        for (let i = 0; i < b.weight.length; i++) {
          // Dot size and brightness both follow the tone: large at the border, specks inward. A light ground holds the peak lower.
          const t = b.turn[i], tone = clamp(b.weight[i] * light(t, i)) * (dark ? 1.12 : 0.8);
          if (tone < 0.03) continue;
          const k = (Math.floor(((((t - shift) % 1) + 1) % 1) * 256) & 255) * 4;
          let cr = lut[k], cg = lut[k + 1], cb = lut[k + 2], lum = lut[k + 3];
          // A white flash would vanish on a light ground, so there it stays in colour and reads by size alone.
          const lift = white && dark ? white(t) : 0;
          if (greenness > 0 || redness > 0 || lift > 0) {
            if (greenness > 0) { cr += (GREEN[0] - cr) * greenness; cg += (GREEN[1] - cg) * greenness; cb += (GREEN[2] - cb) * greenness; }
            if (redness > 0) { cr += (RED[0] - cr) * redness; cg += (RED[1] - cg) * redness; cb += (RED[2] - cb) * redness; }
            if (lift > 0) { cr += (1 - cr) * lift; cg += (1 - cg) * lift; cb += (1 - cb) * lift; }
            lum = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
          }
          // Scale the hue so its luminance x GAIN lands on the tone: the field reads that back as the dot's size.
          const scale = Math.min(1, (tone + KNEE) / GAIN / Math.max(lum, 0.01)) * 255;
          rgb[i * 3] = cr * scale; rgb[i * 3 + 1] = cg * scale; rgb[i * 3 + 2] = cb * scale;
        }
        data.fill(0);
        for (let j = 0; j < b.pixel.length; j++) {
          const q = b.pixel[j] * 4, i = b.owner[j] * 3;
          data[q] = rgb[i]; data[q + 1] = rgb[i + 1]; data[q + 2] = rgb[i + 2]; data[q + 3] = 255;
        }
        pen.putImageData(image!, 0, 0);
      };

      if (still) {
        // Reduced motion: one settled frame per state.
        const base = o.mode === 'progress'
          ? (t: number) => (phase === 'running' || phase === 'error' ? beamRing(t, fill) : 0.14)
          : (t: number) => (phase === 'running' ? 0.75 : 0.55) * (0.7 + 0.3 * Math.cos(2 * Math.PI * (t - 0.12)));
        if (phase === 'success') draw(() => 0.62, 0, 0, 0.9);
        else if (phase === 'error') draw((t, i) => base(t) * 0.5 * beamCracked(crack[i], 1), 0, 0.9, 0);
        else draw(base, 0, 0, 0);
        return false;
      }
      const dt = then ? Math.min(48, now - then) : 16;
      then = now;
      if (phase !== seen) { if (phase === 'running' && seen !== 'running') p = 0; mark = now; seen = phase; }
      let since = now - mark;
      if (phase === 'success' && since > SETTLED) { phase = seen = 'idle'; fill = 0; mark = now; since = 0; }
      const running = phase === 'running', failed = phase === 'error', live = phase === 'success', heat = o.hover && hot;
      for (const id of MODES) weight[id] += ((id === o.mode ? 1 : 0) - weight[id]) * (1 - Math.exp(-dt / 260));
      // A failure stops everything dead where it was: the turn, the breath and the ring.
      if (!failed) {
        const lap = (running ? 1500 - 500 * fill : o.mode === 'pulse' ? 9000 : SPIN) / Math.max(0.05, o.speed);
        v += ((1 / lap) * (heat ? 1.35 : 1) - v) * (1 - Math.exp(-dt / 320));
        rot += v * dt;
        clock += dt;
        hue += (dt / (o.mode === 'pulse' ? 14000 : 26000)) * (1 - weight.progress);
        if (running || live) p += ((live ? 1 : fill) - p) * (1 - Math.exp(-dt / 110));
      } else v = 0;
      lift += ((heat ? 1 : 0) - lift) * (1 - Math.exp(-dt / 220));
      red = failed ? smoothstep(0, 60, since) * 0.9 : red * Math.exp(-dt / 180);
      const gain = 1 + 0.22 * lift;
      const breath = 0.32 + 0.68 * (0.5 - 0.5 * Math.cos((2 * Math.PI * clock) / 2400));
      // Progress at rest is all but dark, one slow breath on the hairline; while it runs, the ring.
      const hush = 0.05 + 0.1 * (0.5 - 0.5 * Math.cos((2 * Math.PI * clock) / 5200));
      const rest = running || live || failed;
      const base = (t: number) => gain * (
        weight.rotate * beamArcs(t - rot)
        + weight.pulse * (running || failed ? beamArcs(t - rot) : breath * (0.78 + 0.22 * Math.cos(2 * Math.PI * (t - rot))))
        + weight.progress * (rest ? beamRing(t, p) : hush));

      if (live) {
        // Success: the light closes into a full ring, one flash runs round it from the top, then a soft green settles and fades.
        const close = smoothstep(0, 260, since), head = clamp((since - 240) / 620), passing = 1 - smoothstep(860, 1060, since);
        const settle = smoothstep(780, 1000, since), fade = smoothstep(1350, 2450, since);
        const level = (dark ? 0.86 : 0.55) * close * (1 - settle) + 0.62 * settle * (1 - fade);
        const keep = 1 - close * (1 - smoothstep(1900, SETTLED, since) * (1 - weight.progress));
        const flash = (t: number) => {
          if (since < 240) return 0;
          const d = head - t;
          return passing * (d >= 0 ? (d < 0.2 ? (1 - d / 0.2) ** 2 : 0) : d > -0.02 ? (1 + d / 0.02) ** 2 : 0);
        };
        draw(t => Math.max(base(t) * keep, level * (0.9 + 0.1 * Math.cos(2 * Math.PI * (t - 0.1))), 1.3 * flash(t), weight.progress * hush * fade),
          hue, 0, 0.9 * settle * (1 - fade), t => clamp(flash(t) * 0.8));
        return true;
      }
      if (failed) {
        // Error: stopped dead, two red flickers, then the border cracks into fragments and rests dim red.
        const flick = since < 90 ? 1.2 : since < 170 ? 0.1 : since < 260 ? 1.2 : since < 340 ? 0.1 : 1;
        const k = smoothstep(380, 1150, since), dim = 1 - 0.5 * smoothstep(700, 1500, since), tick = Math.floor(since / 50);
        draw((t, i) => {
          const left = beamCracked(crack[i], k);
          if (left <= 0) return 0;
          return base(t) * flick * left * dim * (1 - 1.4 * k * (1 - k) * hash(i, tick));
        }, hue, red, 0);
        return since < 1600 || Math.abs(lift - (heat ? 1 : 0)) > 0.01;
      }
      draw(base, hue, red, 0);
      return true;
    },
  });

  // Moves count as well as enter, so a pointer that is already over the element, or a scripted one that only sends moves, heats it.
  const onEnter = () => { if (!hot) { hot = true; surface?.kick(); } }, onLeave = () => { hot = false; surface?.kick(); };
  const onFocus = (event: FocusEvent) => { hot = (event.target as Element)?.matches?.(':focus-visible') ?? false; surface?.kick(); };
  if (surface) {
    canvasStyle(surface);
    element.addEventListener('pointerenter', onEnter);
    element.addEventListener('pointermove', onEnter);
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
    element.removeEventListener('pointermove', onEnter);
    element.removeEventListener('pointerleave', onLeave);
    element.removeEventListener('focusin', onFocus);
    element.removeEventListener('focusout', onLeave);
  });
}

/** For tests: the options a beam starts from. */
export const BEAM_DEFAULTS = DEFAULTS;
