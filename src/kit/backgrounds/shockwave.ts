import { smoothstep } from '../core';
import { hash2, vnoise } from './shared';
import { simPreset, SCATTER_LOOK, SIM_GRAPHITE, type Simulation } from './sim';
import { SurfaceTap, type TapStyle } from '../../surface/surface-tap';

const MAX_RINGS = 6;
/** Rings drawn at full strength at once; a newer press retires the oldest with a short fade. */
const LIVE_RINGS = 4;
// Each ring: x, y, age (s), strength, age it was retired at (-1 while live), its patch seed.
const STRIDE = 6;
/** The wind: rising gently to the right. */
const WX = Math.cos(-0.42), WY = Math.sin(-0.42);
/** The cursor's glow fades on this clock; a retired ring fades out over RETIRE. */
const GLOW_TAU = 0.5, RETIRE = 0.18;
/** The ring opens on r = REACH·rows·(1 − e^(−(t + LEAD)/EASE)) and fades as e^(−(t/FADE)²), measured off the reference. */
const REACH = 0.436, LEAD = 0.09, EASE = 0.82, FADE = 1.6;
/** The rim's cross-section and the trailing band, in fractions of the stage height, and their strengths. */
/** The smoke: warp of the front as a fraction of its radius (early, added late), lump size and drift as fractions of the
 * stage height (drift per second), the ring's downwind carry, thickness variation, and how dim the rim is between streaks. */
const SMOKE = { warp0: 0.07, warp1: 0.28, size: 0.3, flow: 0.08, carry: 0.025, thick0: 0.45, thick1: 0.6, wisp0: 0.45 };
const RIM = { out0: 0.004, out1: 0.017, in0: 0.01, in1: 0.028, gain: 0.85, gap0: 0.22, gap1: 0.14, trail: 0.23, trailW: 0.025, trailFade: 2.0, fill: 0.05 };
/** Value noise read round a circle of `k` lobes' scale: seamless in angle, so the pattern never shows a seam. */
/** The cursor brush's reach along the wind: twice as far downwind as up. */
const a0 = (along: number) => along > 0 ? 2.1 : 1.05;
const around = (cx: number, cy: number, k: number, s: number) => vnoise(cx * k + s, cy * k + s * 1.7);

/**
 * Wind over a dark field of letters: long thin streaks in gusty patches drift downwind. A click (`tap: 'ring'`, the default)
 * sends one pressure front out, drawn in the field's own letters: a dense band about 3% of the stage height across whose
 * outline billows like smoke (broad lumps that grow and drift downwind, uneven thickness, a frayed leading edge, lit most
 * along the wind's streaks), opening fast and easing to a stop, a broad dimmer band of lit streaks trailing it. As it fades its breaks widen and it frays into arcs that dissolve. Every ring has the same timing and character;
 * only its patch pattern differs. A press stacks on the rings still out, and past four the oldest fades out quickly.
 * `tap: 'surface'` sends a wave over the wind instead, slowed and bent by the gusts. The cursor brightens the streaks near
 * its path, smeared downwind. Exported for tests.
 */
export class Shockwave implements Simulation {
  cols = 0; rows = 0; t = 0;
  heat = new Float32Array(0); grain = new Float32Array(0);
  /** The wind's density at each cell as last drawn: the medium the surface tap travels over. */
  dens = new Float32Array(0);
  tap: SurfaceTap | null = null;
  private crossed = new Uint8Array(0);
  readonly rings = new Float32Array(MAX_RINGS * STRIDE);
  count = 0;
  /** The gust strength at the last point `wind` read. */
  gust = 0;
  /** The gusts at each cell as last drawn, 0–1. */
  gusts = new Float32Array(0);
  private freq = 0.05; private warm = false; private vel = 0; private presses = 0;
  constructor(public seed = 1) {}
  resize(cols: number, rows: number) {
    this.cols = cols; this.rows = rows;
    this.heat = new Float32Array(cols * rows); this.grain = new Float32Array(cols * rows); this.dens = new Float32Array(cols * rows); this.gusts = new Float32Array(cols * rows);
    this.tap = null;
    for (let y = 0, i = 0; y < rows; y++) for (let x = 0; x < cols; x++, i++) this.grain[i] = hash2(x * 3 + 7, y * 5 + 11);
    this.freq = 3.6 / Math.max(8, rows);
    this.warm = false;
  }
  add(x: number, y: number, strength: number) {
    let live = 0;
    for (let n = 0; n < this.count; n++) if (this.rings[n * STRIDE + 4] < 0) live++;
    for (let n = 0; n < this.count && live >= LIVE_RINGS; n++) {
      const k = n * STRIDE;
      if (this.rings[k + 4] < 0) { this.rings[k + 4] = this.rings[k + 2]; live--; }
    }
    if (this.count >= MAX_RINGS) this.drop(0);
    const k = this.count++ * STRIDE;
    this.rings[k] = x; this.rings[k + 1] = y; this.rings[k + 2] = 0; this.rings[k + 3] = strength; this.rings[k + 4] = -1;
    this.rings[k + 5] = (this.seed * 7.31 + ++this.presses * 13.7) % 97;
  }
  private drop(n: number) {
    this.rings.copyWithin(n * STRIDE, (n + 1) * STRIDE, this.count * STRIDE);
    this.count--;
  }
  /** The surface tap's strength at `age` seconds: a 60 ms rise, then an ease-out fade to nothing at 1.6 s. */
  static strength(age: number) { return age >= 1.6 ? 0 : smoothstep(0, 0.06, age) * (1 - age / 1.6) ** 1.5; }
  /** A ring's brightness at `age` seconds: a 60 ms rise, held near full for half a second, then gone by about 3.5 s. */
  static glow(age: number) { return smoothstep(0, 0.06, age) * Math.exp(-((age / FADE) ** 2)); }
  private amp(k: number) {
    const r = this.rings, age = r[k + 2], out = r[k + 4];
    return r[k + 3] * Shockwave.glow(age) * (out < 0 ? 1 : 1 - smoothstep(0, RETIRE, age - out));
  }
  step(dt: number, speed: number) {
    const pace = Math.max(0.2, speed);
    this.t += dt * speed;
    // Rings are kept in press order, so the oldest is first.
    for (let n = this.count - 1; n >= 0; n--) {
      const k = n * STRIDE;
      this.rings[k + 2] += dt * pace;
      if (this.amp(k) <= 0.002 && this.rings[k + 2] > 0.1) this.drop(n);
    }
    if (this.warm) {
      const heat = this.heat, cool = Math.exp(-dt * pace / GLOW_TAU);
      let hot = 0;
      for (let i = 0; i < heat.length; i++) { const h = heat[i] * cool; heat[i] = h < 0.003 ? 0 : h; if (h > hot) hot = h; }
      this.warm = hot > 0;
    }
    const tap = this.tap;
    if (tap?.live) {
      // The wind is the medium: dense gusts slow the front and hold part of it back, open air lets it run.
      const { dens, gusts } = this;
      for (let i = 0; i < dens.length; i++) {
        const d = 0.6 * smoothstep(0.2, 0.7, gusts[i]) + 0.4 * smoothstep(0.25, 0.65, dens[i]), s = 1 - 0.85 * d;
        tap.speed[i] = s * s; tap.damp[i] = 0.4 + 2.4 * d; tap.wall[i] = 0.07 * smoothstep(0.6, 0.85, dens[i]);
      }
      tap.base = this.rows * 0.8;
      // The wind carries the front: it runs ahead downwind and lags upwind, and the carry eases with the front.
      const carry = this.rows * 0.32 * (0.3 + 0.7 * Math.exp(-tap.age / 0.6));
      tap.drift[0] = WX * carry; tap.drift[1] = WY * carry;
      tap.step(dt * pace, 0.16 + 0.84 * Math.exp(-tap.age / 0.55));
      if (Shockwave.strength(tap.age) < 0.01 && tap.age > 0.2) tap.clear();
    }
    return speed > 0 || this.count > 0 || this.warm || !!tap?.live;
  }
  /** How far a ring travels before it stops, in cells: 0.43 of the stage's height. */
  get reach() { return REACH * this.rows; }
  /** The ring's radius in cells at `age` seconds: an exponential ease to a stop, 60% of the way out by 0.67 s. */
  radius(age: number) { return this.reach * (1 - Math.exp(-(Math.max(0, age) + LEAD) / EASE)); }
  /** Streaks at a grid point, 0–1: long along the wind, thin across it, gathered in drifting gusts. */
  wind(x: number, y: number) {
    const f = this.freq, t = this.t, s = this.seed * 23.1;
    const a = (x * WX + y * WY) * f + 29.3, c = (-x * WY + y * WX) * f + 43.1;
    const streak = vnoise(a * 0.9 - t * 0.55 + s, c * 5.2) * 0.65 + vnoise(a * 2.1 - t * 0.9, c * 9.5 + s) * 0.35;
    const gust = vnoise(a * 0.45 - t * 0.3, c * 0.9 + s + 4.4);
    this.gust = gust;
    return streak * smoothstep(0.38, 0.75, gust);
  }
  render(out: Float32Array) {
    const { cols, rows, rings, grain, heat } = this;
    for (let y = 0, i = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++, i++) {
        const n = this.wind(x, y), h = heat[i];
        this.dens[i] = n; this.gusts[i] = this.gust;
        out[i] = 0.01 + 0.04 * smoothstep(0.52, 0.8, n) + (h > 0 ? 0.7 * Math.min(1, h) * (0.15 + 0.85 * smoothstep(0.25, 0.6, n)) : 0);
      }
    }
    const dens = this.dens;
    for (let m = 0; m < this.count; m++) {
      const k = m * STRIDE, amp = this.amp(k);
      if (amp <= 0.002) continue;
      const age = rings[k + 2], seed = rings[k + 5], r = this.radius(age), cx = rings[k], cy = rings[k + 1];
      const g = Shockwave.glow(age), held = g > 1e-4 ? amp / g : 0;
      // The rim, in fractions of the stage height (measured off the reference): flat and dense for about 1.2% of the height
      // behind the front, a crisp outer edge, and a short ramp in from the inside; about 3% across at half height.
      const px = rows, o0 = Math.max(0.3, px * RIM.out0), o1 = Math.max(o0 + 0.5, px * RIM.out1);
      const i0 = Math.max(0.6, px * RIM.in0), i1 = Math.max(i0 + 0.6, px * RIM.in1);
      // Breaks: a few small ones early, opening wide only as it fades.
      const gap = RIM.gap0 + RIM.gap1 * smoothstep(0.5, 1.6, age), soft = 0.08;
      // A broad, dim band of lit streaks trails the rim, a second softer front about 0.3–0.5 s behind it.
      const r2 = this.radius(age - (0.36 + 0.15 * smoothstep(0.4, 1.33, age))), s2 = Math.max(1, px * RIM.trailW);
      const a2 = held * RIM.trail * smoothstep(0, 0.1, age) * Math.exp(-((age / RIM.trailFade) ** 4));
      // Smoke, not a drawn circle: the front's distance is warped by a field of broad lumps in space (2–6 round the ring),
      // growing as it spreads and drifting downwind, so it billows; the whole ring is carried a little downwind too.
      const lump = r * (SMOKE.warp0 + SMOKE.warp1 * smoothstep(0.3, 1.4, age)), carry = px * SMOKE.carry * (1 - Math.exp(-age / 0.6));
      const ox = cx + WX * carry, oy = cy + WY * carry, flow = px * SMOKE.flow * age, sc = 1 / (px * SMOKE.size);
      const fx = -WX * flow + seed * 3.1, fy = -WY * flow + seed * 1.9;
      const thick = SMOKE.thick0 + SMOKE.thick1 * smoothstep(0.3, 1.4, age);
      const reach = r + lump + o1 * (1 + thick) + 1;
      const y0 = Math.max(0, Math.floor(oy - reach)), y1 = Math.min(rows, Math.ceil(oy + reach));
      const x0 = Math.max(0, Math.floor(ox - reach)), x1 = Math.min(cols, Math.ceil(ox + reach));
      for (let y = y0; y < y1; y++) {
        const ey = y - oy;
        for (let x = x0, i = y * cols + x0; x < x1; x++, i++) {
          const ex = x - ox, d = Math.sqrt(ex * ex + ey * ey);
          if (d > reach) continue;
          // The lumps live in space and scale with the ring, so the outline changes smoothly: no shimmer frame to frame.
          const wx = x * sc + fx, wy = y * sc + fy;
          const w = 0.7 * vnoise(wx, wy) + 0.3 * vnoise(wx * 2.3 + 17.1, wy * 2.3 + 5.7) - 0.5;
          const re = r + 2 * lump * w, e = d - re;
          if (e > o1 * (1 + thick) + 0.5) continue;
          // Uneven thickness round the rim, and a leading edge frayed letter by letter.
          const tf = 1 + thick * 2 * (vnoise(wx * 1.7 + 41.3, wy * 1.7 + 9.2) - 0.5), fray = 0.55 + 0.9 * ((grain[i] * 7.31) % 1);
          const band = e >= 0 ? 1 - smoothstep(o0 * tf * fray, o1 * tf * fray, e) : smoothstep(-i1 * tf, -i0 * tf, e);
          const lit = smoothstep(0.15, 0.6, dens[i]);
          let add = 0;
          if (band > 0) {
            const ux = d > 0 ? ex / d : 1, uy = d > 0 ? ey / d : 0;
            // Breaks where the patch noise runs thin; lit most where the wind's streaks are, so it reads as wisps.
            const patch = 0.5 * around(ux, uy, 2.6, seed) + 0.5 * around(ux, uy, 7.5, seed + 5.3);
            const keep = smoothstep(gap, gap + soft, patch) * (0.7 + 0.6 * patch);
            const wisp = SMOKE.wisp0 + (1 - SMOKE.wisp0) * smoothstep(0.1, 0.55, dens[i]);
            add = amp * RIM.gain * band * keep * wisp * (0.65 + 0.35 * grain[i]);
          }
          if (e < 0) {
            const q = (d - (r2 + 2 * lump * w * (r2 / Math.max(1, r)))) / s2;
            add += lit * (a2 * Math.exp(-0.5 * q * q) + amp * RIM.fill * (d > r2 ? 1 : 0.5)) * (1 - band);
          }
          // Screen, not add: stacked rings brighten without burning out to flat white.
          out[i] = 1 - (1 - out[i]) * (1 - (add > 1 ? 1 : add));
        }
      }
    }
    const tap = this.tap;
    if (!tap?.live) return;
    // The front's crest lights the streaks it is passing, shaded by its slope against a light from the upper left; the
    // streaks it has crossed stay lit for a moment.
    const amp = Shockwave.strength(tap.age), scale = 1 / Math.max(0.02, tap.front), crossed = this.crossed;
    const H = tap.h, T = tap.trace;
    for (let y = 1, i = cols + 1; y < rows - 1; y++, i += 2) {
      for (let x = 1; x < cols - 1; x++, i++) {
        const v = H[i] * scale;
        if (v < 0.02 && T[i] * scale < 0.04) continue;
        const sx = (H[i + 1] - H[i - 1]) * scale, sy = (H[i + cols] - H[i - cols]) * scale;
        // One front, like the ring: a cell the crest has crossed draws no more crests (the drop's later swells stay dark).
        let crest = v > 0 ? smoothstep(0.12, 0.6, v) : 0;
        const state = crossed[i];
        if (state === 2) crest = 0;
        else if (state === 0 && crest > 0.5) crossed[i] = 1;
        else if (state === 1 && crest < 0.05) crossed[i] = 2;
        const lit = 0.75 + 0.5 * Math.max(-1, Math.min(1, (sx * 0.55 + sy * 0.8) * 2.4));
        const rim = crest * lit * (0.5 + 0.5 * grain[i]) * (0.6 + 0.6 * smoothstep(0.2, 0.6, dens[i]));
        const inner = smoothstep(0.2, 0.9, T[i] * scale) * (1 - crest) * smoothstep(0.25, 0.65, dens[i]);
        const o = out[i] + amp * (1.5 * rim + 0.55 * inner);
        out[i] = o > 1 ? 1 : o;
      }
    }
  }
  /**
   * The pointer brightens the streaks near its path: a soft brush stretched along the wind, with a longer tail downwind,
   * stamped evenly along the segment since the last event, as bright as the pointer is fast (smoothed, so the glow does not
   * flicker with the event rate), never stacking past that, and fading on a half-second clock.
   */
  move(x: number, y: number, dx: number, dy: number) {
    const m = Math.hypot(dx, dy);
    if (!m || !this.cols) return;
    const { cols, rows, heat } = this, R = rows * 0.075, r = Math.ceil(R * 4.4);
    this.vel += (Math.min(m, rows * 0.2) - this.vel) * 0.35;
    const level = 0.3 + 0.7 * smoothstep(0, rows * 0.05, this.vel);
    const steps = Math.max(1, Math.ceil(m / (R * 0.3)));
    for (let s = 1; s <= steps; s++) {
      const px = x - dx * (1 - s / steps), py = y - dy * (1 - s / steps);
      for (let j = Math.max(0, Math.floor(py - r)); j < Math.min(rows, Math.ceil(py + r)); j++) {
        for (let i = Math.max(0, Math.floor(px - r)); i < Math.min(cols, Math.ceil(px + r)); i++) {
          const ex = i - px, ey = j - py, a = (ex * WX + ey * WY) / (a0(ex * WX + ey * WY) * R), c = (ey * WX - ex * WY) / (R * 0.7);
          const d2 = a * a + c * c;
          if (d2 > 4.4) continue;
          const k = j * cols + i, v = level * Math.exp(-d2);
          if (v > heat[k]) heat[k] = v;
        }
      }
    }
    this.warm = true;
  }
  leave() { this.vel = 0; }
  /** One front out of the press: the ring of lit letters (default), or a wave over the wind. */
  press(x: number, y: number, tap: TapStyle = 'ring') {
    if (tap === 'ring') { this.add(x, y, 1); return; }
    this.tap ??= new SurfaceTap(this.cols, this.rows);
    this.tap.fade = 2.2; this.tap.calm = 0;
    if (this.crossed.length !== this.cols * this.rows) this.crossed = new Uint8Array(this.cols * this.rows); else this.crossed.fill(0);
    this.tap.drop(x, y, 1, Math.max(2, this.rows * 0.045));
  }
}

/** Wind over a field of letters: streaks drift in gusts; a click sends one ring of lit letters out that eases to a stop and breaks up. */
export const shockwave = simPreset({
  id: 'shockwave', name: 'Shockwave', description: 'Wind over a field of letters: streaks drift in gusts and the cursor stirs them; a click sends one ring of lit letters out that eases to a stop and breaks into arcs as it fades.',
  cellSize: 10, charset: SCATTER_LOOK.charset, detail: 1 / 4, graphite: SIM_GRAPHITE, feather: 0.16,
  create: seed => new Shockwave(seed),
  tune: SCATTER_LOOK.tune,
});
