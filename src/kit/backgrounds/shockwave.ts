import { smoothstep } from '../core';
import { hash2, vnoise } from './shared';
import { simPreset, SCATTER_LOOK, SIM_GRAPHITE, type Simulation } from './sim';
import { SurfaceTap, type TapStyle } from '../../surface/surface-tap';

const MAX_RINGS = 6;
/** Rings drawn at full strength at once; a newer press retires the oldest with a short fade. */
const LIVE_RINGS = 4;
// Each ring: x, y, age (s), strength, age it was retired at (-1 while live).
const STRIDE = 5;
/** The wind: rising gently to the right. */
const WX = Math.cos(-0.42), WY = Math.sin(-0.42);
/** One timing family for the whole preset: a ring's life, and the cursor's glow fading on the same clock. */
const LIFE = 1.6, GLOW_TAU = 0.5, RETIRE = 0.18;
const quintOut = (u: number) => 1 - (1 - u) ** 5;

/**
 * Wind over a dark field of letters: long thin streaks in gusty patches drift downwind. A click (`tap: 'ring'`, the default)
 * sends one pressure front out: a clean ring that expands fast and eases out (quint-out over 1.6 s), its crisp rim lighting
 * the streaks it passes, fading out on the same curve. Every ring has the same shape and timing; a press stacks on the
 * ones still out, and past four the oldest fades out quickly. `tap: 'surface'` sends a wave over the wind instead, slowed
 * and bent by the gusts. The cursor brightens the streaks along its path by how fast it moves, fading on the same clock.
 * Exported for tests.
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
  private freq = 0.05; private warm = false; private vel = 0;
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
  }
  private drop(n: number) {
    this.rings.copyWithin(n * STRIDE, (n + 1) * STRIDE, this.count * STRIDE);
    this.count--;
  }
  /** A ring's strength at `age` seconds: a 60 ms rise, then an ease-out fade to nothing at 1.6 s. */
  static strength(age: number) { return age >= LIFE ? 0 : smoothstep(0, 0.06, age) * (1 - age / LIFE) ** 1.5; }
  private amp(k: number) {
    const r = this.rings, age = r[k + 2], out = r[k + 4];
    return r[k + 3] * Shockwave.strength(age) * (out < 0 ? 1 : 1 - smoothstep(0, RETIRE, age - out));
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
  /** How far a ring travels before it stops, in cells: a little over half the stage's diagonal from the press. */
  get reach() { return 0.26 * Math.hypot(this.cols, this.rows); }
  /** The ring's radius in cells at `age` seconds: quint-out, most of the way out in the first half second. */
  radius(age: number) { return this.reach * quintOut(Math.min(1, Math.max(0, age) / LIFE)); }
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
        out[i] = 0.01 + 0.11 * smoothstep(0.44, 0.74, n) + (h > 0 ? 0.7 * Math.min(1, h) * (0.15 + 0.85 * smoothstep(0.25, 0.6, n)) : 0);
      }
    }
    const dens = this.dens;
    for (let m = 0; m < this.count; m++) {
      const k = m * STRIDE, amp = this.amp(k);
      if (amp <= 0.002) continue;
      const age = rings[k + 2], u = Math.min(1, age / LIFE), r = this.radius(age);
      // The wind leans the whole ring a touch downwind as it opens: a skew, never a wobble.
      const lean = rows * 0.03 * quintOut(u), cx = rings[k] + WX * lean, cy = rings[k + 1] + WY * lean;
      // A pressure front: a crisp leading edge and a softer trailing one, a little wider as it slows.
      const thick = rows * 0.012 + r * 0.03, outer = thick * 0.55, inner = thick * 1.4;
      const reach = r + outer * 3;
      const y0 = Math.max(0, Math.floor(cy - reach)), y1 = Math.min(rows, Math.ceil(cy + reach));
      const x0 = Math.max(0, Math.floor(cx - reach)), x1 = Math.min(cols, Math.ceil(cx + reach));
      for (let y = y0; y < y1; y++) {
        const ey = y - cy;
        for (let x = x0, i = y * cols + x0; x < x1; x++, i++) {
          const ex = x - cx, d = Math.sqrt(ex * ex + ey * ey);
          if (d > reach) continue;
          const q = d > r ? (d - r) / outer : (r - d) / inner, rim = Math.exp(-q * q);
          const lit = smoothstep(0.15, 0.6, dens[i]);
          // The streaks just passed stay lit a moment behind the rim.
          const wake = d < r ? Math.exp(-(r - d) / (r * 0.3 + 1)) * lit : 0;
          const add = amp * (rim * (0.55 + 0.6 * lit) * (0.85 + 0.15 * grain[i]) * 1.15 + 0.55 * wake);
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
   * The pointer brightens the streaks along its path: a soft round brush stamped evenly along the segment since the last
   * event, as bright as the pointer is fast (smoothed, so the glow does not flicker with the event rate), never stacking
   * past that, and fading on the rings' clock.
   */
  move(x: number, y: number, dx: number, dy: number) {
    const m = Math.hypot(dx, dy);
    if (!m || !this.cols) return;
    const { cols, rows, heat } = this, R = rows * 0.085, r = Math.ceil(R * 2.1);
    this.vel += (Math.min(m, rows * 0.2) - this.vel) * 0.35;
    const level = 0.3 + 0.7 * smoothstep(0, rows * 0.05, this.vel);
    const steps = Math.max(1, Math.ceil(m / (R * 0.3)));
    for (let s = 1; s <= steps; s++) {
      const px = x - dx * (1 - s / steps), py = y - dy * (1 - s / steps);
      for (let j = Math.max(0, Math.floor(py - r)); j < Math.min(rows, Math.ceil(py + r)); j++) {
        for (let i = Math.max(0, Math.floor(px - r)); i < Math.min(cols, Math.ceil(px + r)); i++) {
          const ex = i - px, ey = j - py, d2 = (ex * ex + ey * ey) / (R * R);
          if (d2 > 4.4) continue;
          const k = j * cols + i, v = level * Math.exp(-d2);
          if (v > heat[k]) heat[k] = v;
        }
      }
    }
    this.warm = true;
  }
  leave() { this.vel = 0; }
  /** One front out of the press: the clean ring (default), or a wave over the wind. */
  press(x: number, y: number, tap: TapStyle = 'ring') {
    if (tap === 'ring') { this.add(x, y, 1); return; }
    this.tap ??= new SurfaceTap(this.cols, this.rows);
    this.tap.fade = 2.2; this.tap.calm = 0;
    if (this.crossed.length !== this.cols * this.rows) this.crossed = new Uint8Array(this.cols * this.rows); else this.crossed.fill(0);
    this.tap.drop(x, y, 1, Math.max(2, this.rows * 0.045));
  }
}

/** Wind over a field of letters: streaks drift in gusts; a click sends one clean ring out that eases to a stop and fades. */
export const shockwave = simPreset({
  id: 'shockwave', name: 'Shockwave', description: 'Wind over a field of letters: streaks drift in gusts and the cursor stirs them; a click sends one clean pressure ring out that eases to a stop and fades.',
  cellSize: 10, charset: SCATTER_LOOK.charset, detail: 1 / 4, graphite: SIM_GRAPHITE, feather: 0.16,
  create: seed => new Shockwave(seed),
  tune: SCATTER_LOOK.tune,
});
