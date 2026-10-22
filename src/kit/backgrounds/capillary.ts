import { simPreset, rng, type Simulation } from './sim';

const MAX_TIPS = 500;
const STEP = 0.7;

/**
 * Thin branching veins. A faint network is grown once from seeded tips; the pointer sprouts new veins from that network toward
 * itself and from its own path, each tip wandering, branching now and then and fading as it ages. Exported for tests.
 */
export class Capillary implements Simulation {
  cols = 0; rows = 0;
  /** The resting network, and the live growth that fades. */
  rest = new Float32Array(0); live = new Float32Array(0);
  tips = 0;
  readonly x = new Float32Array(MAX_TIPS); readonly y = new Float32Array(MAX_TIPS); readonly a = new Float32Array(MAX_TIPS);
  readonly life = new Float32Array(MAX_TIPS); readonly span = new Float32Array(MAX_TIPS); readonly ink = new Float32Array(MAX_TIPS);
  private random: () => number; private pull = { x: 0, y: 0, on: false }; private walked = 0; private fade = 0; private lit = false;
  constructor(public seed = 1) { this.random = rng(seed); }

  resize(cols: number, rows: number) {
    this.cols = cols; this.rows = rows;
    this.rest = new Float32Array(cols * rows); this.live = new Float32Array(cols * rows);
    this.random = rng(this.seed);
    this.tips = 0; this.pull.on = false;
    const r = this.random, seeds = Math.max(3, Math.round((cols * rows) / 2600));
    for (let s = 0; s < seeds; s++) this.sprout(r() * cols, r() * rows, r() * Math.PI * 2, 60 + r() * 90, 1);
    for (let guard = 0; this.tips && guard < 4000; guard++) this.grow(this.rest);
    this.tips = 0;
  }
  sprout(x: number, y: number, angle: number, life: number, ink: number) {
    if (this.tips >= MAX_TIPS) return;
    const k = this.tips++;
    this.x[k] = x; this.y[k] = y; this.a[k] = angle; this.life[k] = life; this.span[k] = life; this.ink[k] = ink;
  }
  /** One growth step for every tip, written into `grid`. */
  grow(grid: Float32Array) {
    const { cols, rows, x, y, a, life, span, ink } = this, r = this.random;
    for (let k = this.tips - 1; k >= 0; k--) {
      a[k] += (r() - 0.5) * 0.45;
      if (this.pull.on && grid === this.live) {
        const want = Math.atan2(this.pull.y - y[k], this.pull.x - x[k]);
        let turn = want - a[k];
        turn -= Math.PI * 2 * Math.floor((turn + Math.PI) / (Math.PI * 2));
        a[k] += Math.max(-0.06, Math.min(0.06, turn)) * 0.6;
      }
      x[k] += Math.cos(a[k]) * STEP; y[k] += Math.sin(a[k]) * STEP;
      life[k] -= 1;
      const cx = x[k] | 0, cy = y[k] | 0;
      if (life[k] <= 0 || x[k] < 0 || y[k] < 0 || cx >= cols || cy >= rows) { this.kill(k); continue; }
      const i = cy * cols + cx, tone = ink[k] * (0.35 + 0.65 * (life[k] / span[k]));
      if (tone > grid[i]) grid[i] = tone;
      if (r() < 0.022 && this.tips < MAX_TIPS) this.sprout(x[k], y[k], a[k] + (r() < 0.5 ? -1 : 1) * (0.45 + r() * 0.6), life[k] * 0.8, ink[k] * 0.9);
    }
  }
  private kill(k: number) {
    const last = --this.tips;
    if (k === last) return;
    this.x[k] = this.x[last]; this.y[k] = this.y[last]; this.a[k] = this.a[last];
    this.life[k] = this.life[last]; this.span[k] = this.span[last]; this.ink[k] = this.ink[last];
  }
  step(dt: number, speed: number) {
    if (!this.lit && !this.tips) return false;
    const steps = Math.min(8, Math.round(dt * 60 * Math.max(0.25, speed) * 1.6));
    for (let s = 0; s < steps && this.tips; s++) this.grow(this.live);
    const decay = Math.exp(-dt * 0.4), live = this.live;
    let most = 0;
    for (let i = 0; i < live.length; i++) { const v = live[i] * decay; live[i] = v < 0.004 ? 0 : v; if (v > most) most = v; }
    this.fade = most;
    this.lit = most > 0;
    if (!this.lit && !this.tips) this.pull.on = false;
    return this.lit || this.tips > 0;
  }
  render(out: Float32Array) {
    const { rest, live } = this;
    for (let i = 0; i < out.length; i++) { const a = rest[i] * 0.16, b = live[i] * 0.9; out[i] = a > b ? a : b; }
  }
  /** Sprouts from the resting veins near the pointer, growing toward it, and now and then from the pointer's own path. */
  move(x: number, y: number, dx: number, dy: number) {
    if (!this.cols) return;
    this.pull.x = x; this.pull.y = y; this.pull.on = true;
    this.walked += Math.hypot(dx, dy);
    if (this.walked < 2.5) return;
    this.walked = 0;
    const r = this.random, R = Math.max(this.cols, this.rows) * 0.12;
    for (let tries = 0; tries < 6; tries++) {
      const px = x + (r() - 0.5) * 2 * R, py = y + (r() - 0.5) * 2 * R, cx = px | 0, cy = py | 0;
      if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows || this.rest[cy * this.cols + cx] < 0.3) continue;
      this.sprout(px, py, Math.atan2(y - py, x - px) + (r() - 0.5), 30 + r() * 40, 0.8);
      break;
    }
    this.sprout(x, y, Math.atan2(dy, dx) + Math.PI + (r() - 0.5) * 2, 20 + r() * 30, 0.7);
    this.lit = true;
  }
  /** A burst of veins out of the press. */
  press(x: number, y: number) {
    const r = this.random;
    for (let k = 0; k < 9; k++) this.sprout(x, y, (k / 9) * Math.PI * 2 + r() * 0.5, 50 + r() * 60, 1);
    this.lit = true;
  }
  leave() { this.pull.on = false; }
  get level() { return this.fade; }
}

/** Thin branching veins: a faint network at rest, and new veins that grow toward the cursor and burst from a click. */
export const capillary = simPreset({
  id: 'capillary', name: 'Capillary', description: 'Thin branching veins: a faint network at rest, new veins that grow toward the cursor and burst from a click.',
  cellSize: 8, charset: ' .·:-+*', detail: 1 / 3,
  create: seed => new Capillary(seed),
});
