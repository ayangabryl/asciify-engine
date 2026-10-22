import { smoothstep } from '../core';
import { vnoise } from './shared';
import { simPreset, type Simulation } from './sim';

/**
 * Soft blotches of tone drifting on a slow current, read through a displacement field the pointer stirs: each move pushes the
 * water along its path with a little swirl, and the push decays while the displacement it left relaxes back. Exported for tests.
 */
export class Estuary implements Simulation {
  cols = 0; rows = 0; t = 0;
  u = new Float32Array(0); v = new Float32Array(0); ox = new Float32Array(0); oy = new Float32Array(0);
  private freq = 0.05; private live = false;
  constructor(public seed = 1) {}
  resize(cols: number, rows: number) {
    this.cols = cols; this.rows = rows;
    const n = cols * rows;
    this.u = new Float32Array(n); this.v = new Float32Array(n); this.ox = new Float32Array(n); this.oy = new Float32Array(n);
    this.freq = 5 / Math.max(cols, rows);
    this.live = false;
  }
  step(dt: number, speed: number) {
    this.t += dt * speed * 0.12;
    if (!this.live) return speed > 0;
    const { u, v, ox, oy } = this, push = Math.exp(-dt * 1.4), relax = Math.exp(-dt * 0.45);
    let most = 0;
    for (let i = 0; i < u.length; i++) {
      ox[i] = (ox[i] + u[i] * dt) * relax;
      oy[i] = (oy[i] + v[i] * dt) * relax;
      u[i] *= push; v[i] *= push;
      const m = Math.abs(u[i]) + Math.abs(v[i]) + Math.abs(ox[i]) + Math.abs(oy[i]);
      if (m > most) most = m;
    }
    if (most < 0.02) { u.fill(0); v.fill(0); ox.fill(0); oy.fill(0); this.live = false; }
    return speed > 0 || this.live;
  }
  render(out: Float32Array) {
    const { cols, rows, ox, oy, u, v, freq, t } = this, s = this.seed * 17.3;
    for (let y = 0, i = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++, i++) {
        const px = (x + ox[i]) * freq, py = (y + oy[i]) * freq;
        const n = vnoise(px + t + s, py - t * 0.6) * 0.62 + vnoise(px * 2.3 - t * 1.4, py * 2.3 + t * 0.9 + s) * 0.28 + vnoise(px * 5.1 + t, py * 5.1) * 0.1;
        const stir = Math.min(0.45, (Math.abs(u[i]) + Math.abs(v[i])) * 0.03);
        out[i] = 0.03 + 0.3 * smoothstep(0.5, 0.8, n) + stir * (0.4 + n);
      }
    }
  }
  /** Pushes the water along the pointer's path inside a soft brush, with a swirl that turns with the direction of travel. */
  move(x: number, y: number, dx: number, dy: number) {
    const m = Math.hypot(dx, dy);
    if (!m || !this.cols) return;
    this.impulse(x, y, dx * 9, dy * 9, Math.min(m, 6) * 2.2, Math.max(this.cols, this.rows) * 0.07);
  }
  press(x: number, y: number) { this.impulse(x, y, 0, 0, 30, Math.max(this.cols, this.rows) * 0.1, 40); }
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

/** Soft blotches drifting on a slow current; the pointer stirs them into swirls that settle back. */
export const estuary = simPreset({
  id: 'estuary', name: 'Estuary', description: 'Soft blotches drift on a slow current; the cursor stirs them into swirls that settle back.',
  cellSize: 9, charset: ' .·:-=+', detail: 1 / 4,
  create: seed => new Estuary(seed),
});
