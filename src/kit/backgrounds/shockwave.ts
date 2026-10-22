import { smoothstep } from '../core';
import { hash2, vnoise } from './shared';
import { simPreset, SCATTER_LOOK, SIM_GRAPHITE, type Simulation } from './sim';
import { SurfaceTap, type TapStyle } from '../../surface/surface-tap';

const MAX_RINGS = 12;
// Each ring: x, y, age (s), strength.
const STRIDE = 4;
/** The wind: rising gently to the right. */
const WX = Math.cos(-0.42), WY = Math.sin(-0.42);

/**
 * Wind over a dark field of letters: long thin streaks in gusty patches drift downwind. A click sends a front out, fast at
 * first and easing to a stop, its rim a wavering band that lights the streaks as it passes, fading over two seconds or so.
 * By default (`tap: 'surface'`) the front is a wave over the wind itself: it slows and breaks in the dense gusts and slips
 * through the open air, so its rim buckles where the streaks are; `'ring'` keeps the even analytic ring.
 * The cursor stirs gusts that brighten the streaks along its path. Exported for tests.
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
  private freq = 0.05; private warm = false;
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
    if (this.count >= MAX_RINGS) this.drop(0);
    const k = this.count++ * STRIDE;
    this.rings[k] = x; this.rings[k + 1] = y; this.rings[k + 2] = 0; this.rings[k + 3] = strength;
  }
  private drop(n: number) {
    const last = --this.count;
    if (n !== last) this.rings.copyWithin(n * STRIDE, last * STRIDE, last * STRIDE + STRIDE);
  }
  /** A ring's strength at `age` seconds: a quick swell, then a fade over about two seconds. */
  static strength(age: number) { return smoothstep(0, 0.08, age) * Math.exp(-age / 0.95); }
  step(dt: number, speed: number) {
    const pace = Math.max(0.2, speed);
    this.t += dt * speed;
    for (let n = this.count - 1; n >= 0; n--) {
      const k = n * STRIDE;
      this.rings[k + 2] += dt * pace;
      if (this.rings[k + 3] * Shockwave.strength(this.rings[k + 2]) < 0.01 && this.rings[k + 2] > 0.2) this.drop(n);
    }
    if (this.warm) {
      const heat = this.heat, cool = Math.exp(-dt * pace * 1.2);
      let hot = 0;
      for (let i = 0; i < heat.length; i++) { const h = heat[i] * cool; heat[i] = h < 0.004 ? 0 : h; if (h > hot) hot = h; }
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
  /** The ring's radius in cells at `age` seconds: fast at first, easing to a stop near half the stage's height. */
  radius(age: number) { return this.rows * 0.44 * (1 - Math.exp(-Math.max(0, age) / 0.85)); }
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
        out[i] = 0.01 + 0.11 * smoothstep(0.44, 0.74, n) + (h > 0 ? 0.5 * Math.min(1, h) * smoothstep(0.25, 0.6, n) : 0);
      }
    }
    for (let m = 0; m < this.count; m++) {
      const k = m * STRIDE, age = rings[k + 2], amp = rings[k + 3] * Shockwave.strength(age);
      if (amp <= 0.004) continue;
      const cx = rings[k], cy = rings[k + 1], r = this.radius(age), thick = rows * 0.012 + r * 0.022;
      const reach = r * 1.06 + thick * 2.5;
      const y0 = Math.max(0, Math.floor(cy - reach)), y1 = Math.min(rows, Math.ceil(cy + reach));
      const x0 = Math.max(0, Math.floor(cx - reach)), x1 = Math.min(cols, Math.ceil(cx + reach));
      for (let y = y0; y < y1; y++) {
        const ey = y - cy;
        for (let x = x0; x < x1; x++) {
          const ex = x - cx, d = Math.sqrt(ex * ex + ey * ey);
          if (d > reach) continue;
          // A rim that wavers a little round the circle and over time, so it reads as air rather than a drawn circle.
          const wobble = 1 + 0.07 * (vnoise(Math.atan2(ey, ex) * 1.9 + 9.3 + k, age * 1.3) - 0.5);
          const rr = r * wobble, q = (d - rr) / thick;
          const rim = Math.exp(-q * q) * (0.55 + 0.45 * grain[y * cols + x]);
          // Inside the front the streaks it has just passed through stay lit for a moment.
          const inner = d < rr ? Math.exp(-(rr - d) / (rr * 0.3 + 1)) * smoothstep(0.15, 0.6, this.wind(x, y)) : 0;
          const i = y * cols + x, v = out[i] + amp * (1.05 * rim + 0.5 * inner);
          out[i] = v > 1 ? 1 : v;
        }
      }
    }
    const tap = this.tap;
    if (!tap?.live) return;
    // The front's crest lights the streaks it is passing, shaded by its slope against a light from the upper left; the
    // streaks it has crossed stay lit for a moment.
    const amp = Shockwave.strength(tap.age), scale = 1 / Math.max(0.02, tap.front), dens = this.dens, crossed = this.crossed;
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
  /** Gusts along the pointer's path: they brighten the streaks they reach. */
  move(x: number, y: number, dx: number, dy: number) {
    const m = Math.hypot(dx, dy);
    if (!m || !this.cols) return;
    const { cols, rows, heat } = this, R = rows * 0.09, r = Math.ceil(R * 1.8), amount = Math.min(0.45, 0.1 + m * 0.05);
    for (let j = Math.max(0, Math.floor(y - r)); j < Math.min(rows, Math.ceil(y + r)); j++) {
      for (let i = Math.max(0, Math.floor(x - r)); i < Math.min(cols, Math.ceil(x + r)); i++) {
        const ex = i - x, ey = j - y, d2 = (ex * ex + ey * ey) / (R * R);
        if (d2 > 3.2) continue;
        const k = j * cols + i;
        heat[k] = Math.min(1, heat[k] + amount * Math.exp(-d2));
      }
    }
    this.warm = true;
  }
  /** One front out of the press: a wave over the wind, or the plain ring. */
  press(x: number, y: number, tap: TapStyle = 'surface') {
    if (tap === 'ring') { this.add(x, y, 1); return; }
    this.tap ??= new SurfaceTap(this.cols, this.rows);
    this.tap.fade = 2.2; this.tap.calm = 0;
    if (this.crossed.length !== this.cols * this.rows) this.crossed = new Uint8Array(this.cols * this.rows); else this.crossed.fill(0);
    this.tap.drop(x, y, 1, Math.max(2, this.rows * 0.045));
  }
}

/** Wind over a field of letters: streaks drift in gusts; a click sends one ring out that eases to a stop and fades. */
export const shockwave = simPreset({
  id: 'shockwave', name: 'Shockwave', description: 'Wind over a field of letters: streaks drift in gusts and the cursor stirs them; a click sends a front out over the wind that buckles in the gusts, eases to a stop and fades.',
  cellSize: 10, charset: SCATTER_LOOK.charset, detail: 1 / 4, graphite: SIM_GRAPHITE, feather: 0.16,
  create: seed => new Shockwave(seed),
  tune: SCATTER_LOOK.tune,
});
