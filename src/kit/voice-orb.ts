import type { GlyphFieldOptions } from '../field';
import { clamp, handle, house, mountSurface, styleKeeper, type KitHandle, type KitOptions, type Surface } from './core';

export type VoicePalette = 'mono' | 'aurora' | 'brand' | readonly string[];
export type VoiceState = 'idle' | 'listening' | 'thinking' | 'done';

export interface VoiceOrbOptions extends KitOptions {
  /** `mono` draws in the ink; `aurora`, `brand` or your own hex stops tint the sphere, sliding as the voice gets louder. Default `aurora`. */
  palette?: VoicePalette;
  /** The starting level, 0–1. Default 0. */
  level?: number;
  /** Swell the element by up to 10% with the level (sets `scale`). It also sets `--ascii-level` either way. Default true. */
  swell?: boolean;
}

export interface VoiceOrbHandle extends KitHandle<VoiceOrbOptions> {
  /** The voice's loudness, 0–1. The orb follows it with a fast attack and a slower release. */
  level(value: number): void;
  /** Listening: the orb follows `level()` (or the microphone). */
  listen(): void;
  /** Thinking: a slow low hum while the reply is worked out. Stops the microphone. */
  think(): void;
  /** Done: the level falls away over 420ms. Stops the microphone. */
  done(): void;
  /** Back to rest. Stops the microphone. */
  idle(): void;
  /** Asks for the microphone (only now) and listens to it. Resolves false when it is unavailable or refused. */
  mic(): Promise<boolean>;
  readonly state: VoiceState;
  /** The level the orb is drawing now, after smoothing. */
  readonly current: number;
}

export const VOICE_PALETTES: Record<'aurora' | 'brand', readonly string[]> = {
  aurora: ['#2ee6c8', '#9d7bff', '#ff6fb5'],
  brand: ['#ffb000', '#ffd84d'],
};
const DEFAULTS = { palette: 'aurora' as VoicePalette, swell: true };
// Tone is GAIN x the painted luminance, so painted greys stay low enough to carry full colour.
const GAIN = 2.2;

const stopsOf = (palette: VoicePalette) => (palette === 'mono' ? [] : typeof palette === 'string' ? [...(VOICE_PALETTES[palette as 'aurora'] ?? VOICE_PALETTES.aurora)] : [...palette]);
function mixStops(stops: string[], u: number) {
  if (stops.length === 1) return stops[0];
  const x = clamp(u) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
  const [a, b] = [stops[i], stops[i + 1]].map(hex => [1, 3, 5].map(k => parseInt(hex.slice(k, k + 2), 16) || 0));
  return `rgb(${a.map((v, c) => Math.round(v + (b[c] - v) * f)).join(' ')})`;
}

/**
 * The orb: a lit sphere with turning meridians and a soft halo, in greys, then (with `stops`) coloured with the `color` blend,
 * which keeps each pixel's luminance, the glyph density, and takes the gradient's hue. Louder swells it and slides the gradient on.
 */
export function paintOrb(pen: CanvasRenderingContext2D, w: number, h: number, sec: number, lv: number, stops: string[]) {
  const shade = (tone: number) => { const v = Math.round((clamp(tone) * 255) / GAIN); return `rgb(${v} ${v} ${v})`; };
  const cx = w / 2, cy = h / 2, r = (0.36 / (0.92 - 0.16 * lv)) * Math.min(w, h), gain = 0.86 + 0.46 * lv, a = sec * (0.25 + 0.6 * lv);
  const halo = pen.createRadialGradient(cx, cy, r * 0.92, cx, cy, r * 1.3);
  halo.addColorStop(0, shade(0.36 * gain)); halo.addColorStop(1, '#000');
  pen.fillStyle = halo; pen.fillRect(0, 0, w, h);
  pen.save();
  pen.beginPath(); pen.arc(cx, cy, r, 0, Math.PI * 2); pen.clip();
  const hx = cx + Math.cos(a) * 0.8 * r * 0.62, hy = cy - 0.55 * r * 0.62;
  const body = pen.createRadialGradient(hx, hy, 0, hx, hy, r * 1.7);
  body.addColorStop(0, shade(0.95 * gain)); body.addColorStop(0.55, shade(0.5 * gain)); body.addColorStop(1, shade(0.18));
  pen.fillStyle = body; pen.fillRect(cx - r, cy - r, r * 2, r * 2);
  pen.globalCompositeOperation = 'lighter'; pen.lineWidth = Math.max(1.5, r * 0.05);
  for (let k = 0; k < 6; k++) {
    const phase = (k / 6) * Math.PI + sec * 0.35, depth = Math.sin(phase);
    if (depth < 0) continue;
    pen.strokeStyle = shade(0.16 * depth);
    pen.beginPath(); pen.ellipse(cx, cy, r * Math.abs(Math.cos(phase)), r, 0, 0, Math.PI * 2); pen.stroke();
  }
  // The rim adds light at the edge, still in 'lighter', so the sphere reads round and bright to its outline.
  const rim = pen.createRadialGradient(cx, cy, r * 0.7, cx, cy, r);
  rim.addColorStop(0, '#000'); rim.addColorStop(1, shade(0.3));
  pen.fillStyle = rim; pen.fillRect(cx - r, cy - r, r * 2, r * 2);
  pen.restore();
  pen.globalCompositeOperation = 'source-over';
  if (!stops.length) return;
  pen.globalCompositeOperation = 'color';
  const turn = sec * 0.4, shift = lv * 0.5;
  const tint = pen.createLinearGradient(cx - Math.cos(turn) * r, cy - Math.sin(turn) * r, cx + Math.cos(turn) * r, cy + Math.sin(turn) * r);
  tint.addColorStop(0, mixStops(stops, shift)); tint.addColorStop(0.5, mixStops(stops, shift + 0.25)); tint.addColorStop(1, mixStops(stops, shift + 0.5));
  pen.fillStyle = tint; pen.fillRect(0, 0, w, h);
  pen.globalCompositeOperation = 'source-over';
}

/** A voice orb of characters that swells with the voice, hums while thinking and settles when done. */
export function voiceOrb(element: HTMLElement, options: VoiceOrbOptions = {}): VoiceOrbHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  const styles = styleKeeper();
  let phase: VoiceState = 'idle', at = 0, raw = clamp(state.current.level ?? 0), shown = raw, from = 0, then = 0;
  let stops = stopsOf(state.current.palette), surface: Surface | null = null;
  let mic: { stream: MediaStream; context: AudioContext; read: () => number } | null = null, asking = 0;
  const look = (): GlyphFieldOptions => ({
    mark: 'glyph', charset: ' .:-=+*#%@', font: '"Geist Mono", ui-monospace, monospace', fontWeight: 500,
    cellSize: 6, cellAspect: 0.62, glyphScale: 0.92, fit: 'cover',
    color: stops.length ? 'source' : 'ink', contrast: GAIN, brightness: GAIN / 2 - 0.5, saturation: 1.4, ...state.current.look,
  });
  const canvasStyle = (s: Surface) => { s.canvas.style.filter = !s.dark() && stops.length ? 'brightness(.68) saturate(1.35)' : ''; };
  const swell = (lv: number) => {
    element.style.setProperty('--ascii-level', lv.toFixed(3));
    if (state.current.swell) styles.set(element, 'scale', String(1 + lv * 0.1));
  };

  const target = (now: number) => {
    if (phase === 'listening') return mic ? mic.read() : raw;
    if (phase === 'thinking') return 0.2 + 0.1 * Math.sin((now - at) / 120);
    if (phase === 'done') return from * (1 - house(clamp((now - at) / 420)));
    return raw;
  };

  surface = mountSurface({
    host: element,
    outset: Math.round((element.offsetWidth || 0) * 0.08),
    look,
    ink: () => state.current.ink ?? '--ascii-ink-strong',
    kit: state,
    reducedMotion: () => state.current.reducedMotion,
    onTheme: () => surface && canvasStyle(surface),
    onFail: () => { surface = null; },
    paint: ({ pen, w, h, now, still }) => {
      const dt = then ? Math.min(64, now - then) : 16;
      then = now;
      const want = clamp(target(now));
      if (still || phase === 'done') shown = want;
      else shown += (want - shown) * (1 - (1 - (want > shown ? 0.45 : 0.12)) ** (dt / 16.7));
      if (!still) swell(shown);
      paintOrb(pen, w, h, still ? 0 : now / 1000, shown, stops);
      return true;
    },
  });
  if (surface) canvasStyle(surface);

  const endMic = () => {
    asking++;
    if (!mic) return;
    mic.stream.getTracks().forEach(track => track.stop());
    void mic.context.close().catch(() => {});
    mic = null;
  };
  const show = (next: VoiceState) => {
    if (next !== 'listening') endMic();
    if (next === 'done') from = shown;
    phase = next; at = performance.now();
    element.dataset.state = next;
    if (!surface) swell(next === 'listening' ? raw : 0);
    surface?.kick();
  };

  return handle(() => surface, state, next => {
    stops = stopsOf(next.palette);
    if (next.level !== undefined) raw = clamp(next.level);
    surface?.refresh();
    if (surface) canvasStyle(surface);
  }, {
    level(value: number) { raw = clamp(Number.isFinite(value) ? value : 0); if (!surface && phase === 'listening') swell(raw); surface?.kick(); },
    listen: () => show('listening'),
    think: () => show('thinking'),
    done: () => show('done'),
    idle: () => { raw = 0; show('idle'); },
    async mic() {
      endMic();
      const ticket = asking, media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
      const Context = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
      if (!media?.getUserMedia || !Context) return false;
      let stream: MediaStream;
      try { stream = await media.getUserMedia({ audio: true }); } catch { return false; }
      if (ticket !== asking) { stream.getTracks().forEach(track => track.stop()); return false; }
      const context = new Context(), analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      mic = {
        stream, context,
        read() {
          analyser.getByteTimeDomainData(samples);
          let sum = 0;
          for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
          return Math.sqrt(sum / samples.length) * 5;
        },
      };
      show('listening');
      return true;
    },
    get state() { return phase; },
    get current() { return shown; },
  }, () => {
    endMic();
    styles.restore();
    element.style.removeProperty('--ascii-level');
    delete element.dataset.state;
  });
}

export const VOICE_ORB_DEFAULTS = DEFAULTS;
