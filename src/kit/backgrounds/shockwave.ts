import { hash2, vnoise } from './shared';
import { simPreset, type Simulation } from './sim';

const MAX_RINGS = 40;
// Each ring: x, y, age (s, negative while it waits), strength.
const STRIDE = 4;

/**
 * Rings of characters that a click sends out: a strong front and two fainter echoes, each slowing as it spreads, thickening and
 * fading. A moving pointer leaves small gusts. Under it lies a faint, still grain. Exported for tests.
 */
export class Shockwave implements Simulation {
  cols = 0; rows = 0;
  ground = new Float32Array(0); grain = new Float32Array(0);
  readonly rings = new Float32Array(MAX_RINGS * STRIDE);
  count = 0;
  private walked = 0;
  constructor(public seed = 1) {}
  resize(cols: number, rows: number) {
    this.cols = cols; this.rows = rows;
    this.ground = new Float32Array(cols * rows); this.grain = new Float32Array(cols * rows);
    const f = 6 / Math.max(cols, rows), s = this.seed * 31.7;
    for (let y = 0, i = 0; y < rows; y++) for (let x = 0; x < cols; x++, i++) {
      const n = vnoise(x * f + s, y * f);
      this.ground[i] = 0.035 * n * n;
      this.grain[i] = 0.7 + 0.3 * hash2(x + 7, y * 3 + 11);
    }
  }
  add(x: number, y: number, strength: number, delay = 0) {
    if (this.count >= MAX_RINGS) this.drop(0);
    const k = this.count++ * STRIDE;
    this.rings[k] = x; this.rings[k + 1] = y; this.rings[k + 2] = -delay; this.rings[k + 3] = strength;
  }
  private drop(n: number) {
    const last = --this.count;
    if (n !== last) this.rings.copyWithin(n * STRIDE, last * STRIDE, last * STRIDE + STRIDE);
  }
  step(dt: number, speed: number) {
    const go = dt * Math.max(0.2, speed);
    for (let n = this.count - 1; n >= 0; n--) {
      const k = n * STRIDE;
      this.rings[k + 2] += go;
      if (this.rings[k + 3] * Math.exp(-this.rings[k + 2] * 1.3) < 0.01) this.drop(n);
    }
    return this.count > 0;
  }
  /** The ring's radius in cells at `age` seconds: fast at first, slowing as it spreads. */
  radius(age: number) { return Math.max(this.cols, this.rows) * 0.2 * Math.pow(Math.max(0, age), 0.7); }
  render(out: Float32Array) {
    const { cols, rows, rings, grain } = this;
    out.set(this.ground);
    for (let n = 0; n < this.count; n++) {
      const k = n * STRIDE, age = rings[k + 2];
      if (age <= 0) continue;
      const cx = rings[k], cy = rings[k + 1], r = this.radius(age), thick = 0.8 + r * 0.035, amp = rings[k + 3] * Math.exp(-age * 1.3);
      const reach = r + thick * 3;
      const y0 = Math.max(0, Math.floor(cy - reach)), y1 = Math.min(rows, Math.ceil(cy + reach));
      const x0 = Math.max(0, Math.floor(cx - reach)), x1 = Math.min(cols, Math.ceil(cx + reach));
      const inner = Math.max(0, r - thick * 3 - r * 0.25);
      for (let y = y0; y < y1; y++) {
        const ey = y - cy;
        for (let x = x0; x < x1; x++) {
          const ex = x - cx, d = Math.sqrt(ex * ex + ey * ey);
          if (d > reach || d < inner) continue;
          const a = (d - r) / thick, b = (d - r * 0.8) / thick;
          const i = y * cols + x, v = out[i] + amp * (Math.exp(-a * a) + 0.35 * Math.exp(-b * b)) * grain[i];
          out[i] = v > 1 ? 1 : v;
        }
      }
    }
  }
  /** A small gust every so often along the pointer's path. */
  move(_x: number, _y: number, dx: number, dy: number) {
    this.walked += Math.hypot(dx, dy);
    if (this.walked < Math.max(this.cols, this.rows) * 0.12) return;
    this.walked = 0;
    this.add(_x, _y, 0.22);
  }
  /** A front and two echoes. */
  press(x: number, y: number) { this.add(x, y, 0.95); this.add(x, y, 0.5, 0.14); this.add(x, y, 0.26, 0.3); }
  leave() { this.walked = 0; }
}

/** Rings of characters a click sends out across the field, a strong front and two echoes, over a faint grain. */
export const shockwave = simPreset({
  id: 'shockwave', name: 'Shockwave', description: 'A click sends rings of characters out across the field: a front and two echoes, slowing and fading. Gusts follow the cursor.',
  cellSize: 9, charset: ' .·:-=+*#', detail: 1 / 4,
  create: seed => new Shockwave(seed),
});
