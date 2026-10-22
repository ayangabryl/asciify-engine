import { smoothstep } from '../core';
import { vnoise } from './shared';
import { simPreset, SCATTER_LOOK, SIM_GRAPHITE, type Simulation } from './sim';

/**
 * Smoke-soft currents of tone, wider than tall, warping as they drift; dim at rest. The pointer stirs the water (a push and a
 * swirl that relax back) and leaves a glow that lights the currents it passes, so the lit patch keeps their ragged contours
 * and fades over a second or two. Exported for tests.
 */
export class Estuary implements Simulation {
  cols = 0; rows = 0; t = 0;
  u = new Float32Array(0); v = new Float32Array(0); ox = new Float32Array(0); oy = new Float32Array(0);
  /** The pointer's glow, 0–1, decaying. */
  heat = new Float32Array(0);
  private lattice = new Float32Array(0);
  private freq = 0.05; private live = false; private warm = false;
  constructor(public seed = 1) {}
  resize(cols: number, rows: number) {
    this.cols = cols; this.rows = rows;
    const n = cols * rows;
    this.u = new Float32Array(n); this.v = new Float32Array(n); this.ox = new Float32Array(n); this.oy = new Float32Array(n);
    this.heat = new Float32Array(n);
    // About three currents down the stage, whatever the grid: blotches a third of the height tall.
    this.freq = 5.2 / Math.max(8, rows);
    this.live = this.warm = false;
  }
  step(dt: number, speed: number) {
    this.t += dt * speed * 0.16;
    if (!this.live && !this.warm) return speed > 0;
    const { u, v, ox, oy, heat } = this, push = Math.exp(-dt * 1.6), relax = Math.exp(-dt * 0.5), cool = Math.exp(-dt * 0.62);
    let most = 0, hot = 0;
    for (let i = 0; i < u.length; i++) {
      ox[i] = (ox[i] + u[i] * dt) * relax;
      oy[i] = (oy[i] + v[i] * dt) * relax;
      u[i] *= push; v[i] *= push;
      const h = heat[i] * cool;
      heat[i] = h < 0.004 ? 0 : h;
      if (h > hot) hot = h;
      const m = Math.abs(u[i]) + Math.abs(v[i]) + Math.abs(ox[i]) + Math.abs(oy[i]);
      if (m > most) most = m;
    }
    if (most < 0.02) { u.fill(0); v.fill(0); ox.fill(0); oy.fill(0); this.live = false; }
    this.warm = hot > 0;
    return speed > 0 || this.live || this.warm;
  }
  /** The currents at a grid point: smoke-like, warped twice, a little wider than tall, 0–1. */
  water(x: number, y: number) {
    const f = this.freq, t = this.t, s = this.seed * 17.3;
    // Well away from the lattice's origin, where the hash repeats along a row.
    const px = x * f * 0.68 + t + 31.4 + s, py = y * f - t * 0.3 + 57.9;
    const wx = vnoise(px * 0.8 + s, py * 0.8) + 0.5 * vnoise(px * 1.9 - t * 0.7, py * 1.9 + 2.1) - 0.75;
    const wy = vnoise(px * 0.8 - t * 0.5, py * 0.8 + s + 5.2) + 0.5 * vnoise(px * 1.9 + 7.7, py * 1.9 - t * 0.6) - 0.75;
    const qx = px + wx * 2.2, qy = py + wy * 1.6;
    return vnoise(qx, qy) * 0.5 + vnoise(qx * 2.05 + 3.1, qy * 2.2 - t * 0.8) * 0.27 + vnoise(qx * 4.3 - t, qy * 4.6 + s) * 0.15 + vnoise(qx * 8.9 + s, qy * 9.4 - t * 1.3) * 0.08;
  }
  render(out: Float32Array) {
    const { cols, rows, ox, oy, heat } = this;
    // The currents are worked out on a lattice of every other point and read back smoothly: the detail is finer than a letter.
    const lw = (cols >> 1) + 2, lh = (rows >> 1) + 2;
    if (this.lattice.length !== lw * lh) this.lattice = new Float32Array(lw * lh);
    const L = this.lattice;
    for (let j = 0, k = 0; j < lh; j++) for (let i = 0; i < lw; i++, k++) L[k] = this.water(i * 2, j * 2);
    for (let y = 0, i = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++, i++) {
        const gx = Math.min(lw - 1.001, Math.max(0, (x + ox[i]) / 2)), gy = Math.min(lh - 1.001, Math.max(0, (y + oy[i]) / 2));
        const ix = gx | 0, iy = gy | 0, fx = gx - ix, fy = gy - iy, k = iy * lw + ix;
        const n = (L[k] * (1 - fx) + L[k + 1] * fx) * (1 - fy) + (L[k + lw] * (1 - fx) + L[k + lw + 1] * fx) * fy;
        const h = heat[i];
        const rest = 0.015 + 0.21 * smoothstep(0.42, 0.78, n);
        // The glow lights the currents it reaches, brighter the denser they are, so a lit patch keeps their ragged contours.
        const lit = h > 0 ? smoothstep(0.03, 0.4, h) * smoothstep(0.4, 0.56, n + 0.06 * h) * (0.35 + 1.3 * (n - 0.4)) : 0;
        out[i] = rest + 0.72 * Math.min(1, lit);
      }
    }
  }
  /** Pushes the water along the pointer's path inside a soft brush, with a swirl that turns with the direction of travel. */
  move(x: number, y: number, dx: number, dy: number) {
    const m = Math.hypot(dx, dy);
    if (!m || !this.cols) return;
    const R = this.rows * 0.1;
    this.impulse(x, y, dx * 2.5, dy * 2.5, Math.min(m, 6) * 0.7, R);
    this.glow(x, y, R * 1.6, Math.min(0.4, 0.08 + m * 0.04));
  }
  press(x: number, y: number) {
    this.impulse(x, y, 0, 0, 10, this.rows * 0.14, 14);
    this.glow(x, y, this.rows * 0.24, 1);
  }
  private glow(x: number, y: number, R: number, amount: number) {
    const { cols, rows, heat } = this, r = Math.ceil(R * 1.8);
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
  private impulse(x: number, y: number, fx: number, fy: number, swirl: number, R: number, burst = 0) {
    const { cols, rows, u, v } = this, r = Math.ceil(R * 2);
    for (let j = Math.max(0, Math.floor(y - r)); j < Math.min(rows, Math.ceil(y + r)); j++) {
      for (let i = Math.max(0, Math.floor(x - r)); i < Math.min(cols, Math.ceil(x + r)); i++) {
        const ex = i - x, ey = j - y, d2 = (ex * ex + ey * ey) / (R * R);
        if (d2 > 4) continue;
        const w = Math.exp(-d2), k = j * cols + i, d = Math.sqrt(ex * ex + ey * ey) || 1;
        u[k] += (fx - (ey / R) * swirl + (ex / d) * burst) * w;
        v[k] += (fy + (ex / R) * swirl + (ey / d) * burst) * w;
      }
    }
    this.live = true;
  }
}

/** Smoke-soft currents of letters drifting dim; the cursor stirs them and lights the ones it passes, which fade back. */
export const estuary = simPreset({
  id: 'estuary', name: 'Estuary', description: 'Smoke-soft currents of letters drift in the dark; the cursor stirs them and lights the ones it passes, which fade back.',
  cellSize: 10, charset: SCATTER_LOOK.charset, detail: 1 / 4, graphite: SIM_GRAPHITE,
  create: seed => new Estuary(seed),
  tune: SCATTER_LOOK.tune, feather: 0.16,
});
