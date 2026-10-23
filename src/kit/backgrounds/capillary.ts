import { smoothstep } from '../core';
import { hash2, vnoise } from './shared';
import { SurfaceTap, type TapStyle } from '../../surface/surface-tap';
import { simPreset, SCATTER_LOOK, SIM_GRAPHITE, type Simulation } from './sim';

/** The light the vein halos fall away from: up and to the left, so each vein has a crisp lit edge and a soft shaded one. */
const LX = 0.83, LY = -0.55;

/**
 * A network of veins, the walls between warped cells, laid once for the stage: thin cores that thicken here and there, each with a
 * soft halo on its shaded side, faint at rest. The pointer lights the veins it touches and the light runs along them, thinning
 * out with distance; a click floods them from that point. Static once the light has gone, so it costs nothing at rest.
 * Exported for tests.
 */
export class Capillary implements Simulation {
  cols = 0; rows = 0;
  /** The resting network, 0–1 (core and halo), its core alone, and the light running along it. */
  vein = new Float32Array(0); core = new Float32Array(0); light = new Float32Array(0);
  private spare = new Float32Array(0);
  /** 0 just shown, 1 fully faded in. Starts full, so a still frame (reduced motion) shows the whole network. */
  intro = 1;
  private started = false; private lit = false; private walked = 0;
  constructor(public seed = 1) {}

  resize(cols: number, rows: number) {
    this.cols = cols; this.rows = rows;
    const n = cols * rows;
    this.vein = new Float32Array(n); this.core = new Float32Array(n); this.light = new Float32Array(n); this.spare = new Float32Array(n); this.wave = null;
    this.lit = false;
    const S = Math.max(6, rows * 0.46), warp = S * 0.42, fw = 1.4 / S, s = this.seed * 13.7;
    const gx = Math.ceil(cols / S) + 2, gy = Math.ceil(rows / S) + 2;
    const px = new Float32Array(gx * gy), py = new Float32Array(gx * gy);
    for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
      const k = j * gx + i;
      px[k] = (i - 1 + 0.15 + 0.7 * hash2(i * 3 + 11 + this.seed * 7, j * 5 + 3)) * S;
      py[k] = (j - 1 + 0.15 + 0.7 * hash2(i * 7 + 2, j * 3 + 17 + this.seed * 5)) * S;
    }
    for (let y = 0, o = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++, o++) {
        // Warped, so the walls bend and wander instead of running straight between the cells.
        const qx = x + (vnoise(x * fw + s, y * fw) - 0.5) * 2 * warp, qy = y + (vnoise(x * fw - 7.1, y * fw + s + 3.3) - 0.5) * 2 * warp;
        const ci = Math.floor(qx / S) + 1, cj = Math.floor(qy / S) + 1;
        let d1 = Infinity, d2 = Infinity, a = 0, b = 0;
        for (let j = cj - 1; j <= cj + 1; j++) {
          if (j < 0 || j >= gy) continue;
          for (let i = ci - 1; i <= ci + 1; i++) {
            if (i < 0 || i >= gx) continue;
            const k = j * gx + i, dx = qx - px[k], dy = qy - py[k], d = dx * dx + dy * dy;
            if (d < d1) { d2 = d1; b = a; d1 = d; a = k; } else if (d < d2) { d2 = d; b = k; }
          }
        }
        // Distance to the wall between the two nearest cells, and which way that wall faces.
        let nx = px[a] - px[b], ny = py[a] - py[b];
        const span = Math.hypot(nx, ny) || 1;
        nx /= span; ny /= span;
        const e = (d2 - d1) / (2 * span);
        const thick = 0.45 + 1.4 * smoothstep(0.5, 0.92, vnoise(x * fw * 0.6 + 9.1, y * fw * 0.6 - s));
        const c = Math.exp(-((e / thick) ** 2));
        const side = smoothstep(-0.1, 0.7, nx * LX + ny * LY);
        const halo = Math.exp(-e / (thick * 4)) * 0.42 * side;
        this.core[o] = c;
        this.vein[o] = Math.min(1, c + halo) * (0.55 + 0.6 * vnoise(x * fw * 0.8 + s * 2, y * fw * 0.8 + 1.7));
      }
    }
  }

  step(dt: number, speed: number) {
    if (!this.started) { this.started = true; this.intro = 0; }
    const pace = Math.max(0.25, speed);
    if (this.intro < 1) this.intro = Math.min(1, this.intro + dt * pace / 0.7);
    if (this.lit) {
      // The light runs along the cores a cell or so a step, losing a little each cell, and fades everywhere.
      const { cols, rows, core } = this, decay = Math.exp(-dt * pace * 0.7);
      let a = this.light, b = this.spare, most = 0;
      const passes = Math.max(1, Math.min(4, Math.round(dt * 60 * pace * 1.4)));
      for (let pass = 0; pass < passes; pass++) {
        for (let y = 0, i = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++, i++) {
            let m = 0;
            if (x > 0 && a[i - 1] > m) m = a[i - 1];
            if (x < cols - 1 && a[i + 1] > m) m = a[i + 1];
            if (y > 0 && a[i - cols] > m) m = a[i - cols];
            if (y < rows - 1 && a[i + cols] > m) m = a[i + cols];
            const spread = m * 0.98 * Math.min(1, core[i] * 1.6), own = a[i];
            b[i] = own > spread ? own : spread;
          }
        }
        const t = a; a = b; b = t;
      }
      for (let i = 0; i < a.length; i++) { const v = a[i] * decay; a[i] = v < 0.01 ? 0 : v; if (v > most) most = v; }
      this.light = a; this.spare = b;
      this.lit = most > 0;
    }
    const wave = this.wave;
    if (wave?.live) {
      wave.step(dt * pace, 0.3 + 0.7 * Math.exp(-wave.age / 0.6));
      const { light, vein, core } = this, scale = 1 / Math.max(0.03, wave.front), fade = Math.exp(-wave.age / 1.2);
      for (let i = 0; i < light.length; i++) {
        const v = wave.h[i] * scale;
        if (v <= 0.12) continue;
        const l = smoothstep(0.12, 0.7, v) * fade * 1.4 * Math.min(1, vein[i] * 3.5 + core[i] * 1.5);
        if (l > light[i]) light[i] = l;
      }
      this.lit = true;
      if (fade < 0.05) wave.clear();
    }
    return this.lit || this.intro < 1 || !!wave?.live;
  }

  render(out: Float32Array) {
    const { vein, core, light, intro } = this, rest = 0.17 * intro * intro * (3 - 2 * intro);
    for (let i = 0; i < out.length; i++) {
      const l = light[i];
      out[i] = vein[i] * rest + (l > 0 ? Math.min(1, l * 1.3) * Math.min(1, 1.2 * core[i] + 1.5 * vein[i]) * 0.9 : 0);
    }
  }

  /** Lights the veins under the pointer: the faster it moves, the more. */
  move(x: number, y: number, dx: number, dy: number) {
    if (!this.cols) return;
    this.walked += Math.hypot(dx, dy);
    if (this.walked < 0.6) return;
    this.ignite(x, y, this.rows * 0.13, Math.min(1.2, 0.7 + this.walked * 0.15));
    this.walked = 0;
  }
  /**
   * A press: by default (`tap: 'surface'`) a wave that runs fast along the veins and drags through the cells between, lighting
   * the veins its crest crosses, so the flood follows the network outward; `'ring'` floods a round patch as before.
   */
  press(x: number, y: number, tap: TapStyle = 'surface') {
    if (tap === 'ring') { this.ignite(x, y, this.rows * 0.18, 1.5); return; }
    this.ignite(x, y, this.rows * 0.07, 1.4);
    if (!this.wave) {
      const wave = this.wave = new SurfaceTap(this.cols, this.rows);
      for (let i = 0; i < this.vein.length; i++) {
        const open = Math.min(1, this.core[i] * 1.6 + this.vein[i] * 0.6), s = 0.45 + 0.55 * open;
        wave.speed[i] = s * s; wave.damp[i] = 0.4 + 1.4 * (1 - open);
      }
    }
    this.wave.base = this.rows * 0.75; this.wave.calm = 8;
    this.wave.drop(x, y, 1, Math.max(1.5, this.rows * 0.03));
    this.lit = true;
  }
  wave: SurfaceTap | null = null;
  leave() { this.walked = 0; }

  private ignite(x: number, y: number, R: number, amount: number) {
    const { cols, rows, light, vein } = this, r = Math.ceil(R * 1.8);
    for (let j = Math.max(0, Math.floor(y - r)); j < Math.min(rows, Math.ceil(y + r)); j++) {
      for (let i = Math.max(0, Math.floor(x - r)); i < Math.min(cols, Math.ceil(x + r)); i++) {
        const ex = i - x, ey = j - y, d2 = (ex * ex + ey * ey) / (R * R);
        if (d2 > 3.2) continue;
        const k = j * cols + i, v = amount * Math.exp(-d2) * Math.min(1, vein[k] * 3);
        if (v > light[k]) light[k] = v;
      }
    }
    this.lit = true;
  }
  /** The brightest light on the network now. */
  get level() { let m = 0; for (let i = 0; i < this.light.length; i++) if (this.light[i] > m) m = this.light[i]; return m; }
}

/** A network of faint veins in letters; the cursor lights the veins it touches and the light runs along them. */
export const capillary = simPreset({
  id: 'capillary', name: 'Capillary', description: 'A faint network of veins in letters; the cursor lights the veins it touches and the light runs along them, and a click sends a wave out along them.',
  cellSize: 10, charset: SCATTER_LOOK.charset, detail: 1 / 4, graphite: SIM_GRAPHITE, feather: 0.16,
  create: seed => new Capillary(seed),
  tune: SCATTER_LOOK.tune,
});
