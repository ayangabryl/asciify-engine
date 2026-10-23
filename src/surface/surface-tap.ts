import { PHOTO_CUE_STRIDE, type PhotoCues } from './photo-cues';

/** How a tap answers: `'surface'` a wave that travels over what is drawn, `'ring'` the plain expanding ring. */
export type TapStyle = 'surface' | 'ring';
export const tapStyle = (value: unknown, own: TapStyle = 'surface'): TapStyle => value === 'ring' || value === 'surface' ? value : own;

const smooth = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * A tap as a damped 2D wave on a grid of cells, travelling over a medium. Each cell sets the local wave speed (`speed`, 0–1 of
 * `base`), how quickly the wave dies there (`damp`, per second) and how much it holds the wave back (`wall`, 0 open, 1 a wall
 * that reflects it). Speed steps and walls bend, slow and reflect the front, so it is never a perfect circle.
 * `trace` keeps a fading memory of the wave's height, for lighting what the front has just passed.
 */
export class SurfaceTap {
  readonly cols: number; readonly rows: number;
  h: Float32Array; p: Float32Array;
  readonly speed: Float32Array; readonly damp: Float32Array; readonly wall: Float32Array; readonly trace: Float32Array;
  /** Wave speed over a fully open cell, in cells per second. */
  base = 40;
  /** A pull back to rest (per second squared): it lets the drop's centre settle instead of lingering behind the front. */
  mass = 0;
  /** Extra damping (per second) once the front has passed a cell, so the drop's centre falls quiet behind it. */
  calm = 0;
  /** A current carrying the whole surface, in cells per second (wind over the field): the front runs ahead downstream. */
  drift: [number, number] = [0, 0];
  /** How quickly `trace` fades, per second. */
  fade = 3;
  /** Seconds since the last drop. */
  age = 0;
  /** The highest |height| on the grid after the last step. */
  peak = 0;
  /** The highest height where the front is now: cells at the most they have been lately. Use it to scale how the front draws. */
  front = 0;
  live = false;
  private readonly bins = new Uint32Array(64);
  constructor(cols: number, rows: number) {
    this.cols = Math.max(3, cols | 0); this.rows = Math.max(3, rows | 0);
    const n = this.cols * this.rows;
    this.h = new Float32Array(n); this.p = new Float32Array(n);
    this.speed = new Float32Array(n).fill(1); this.damp = new Float32Array(n).fill(1); this.wall = new Float32Array(n); this.trace = new Float32Array(n);
  }
  clear() { this.h.fill(0); this.p.fill(0); this.trace.fill(0); this.live = false; this.peak = 0; }
  /**
   * A drop at a grid point, `radius` cells wide: a bump in a shallow trough that holds as much as it lifts, so the water
   * behind the front settles back rather than staying raised.
   */
  drop(x: number, y: number, strength = 1, radius = 3) {
    const { cols, rows, h, p } = this, r = Math.max(1, radius), reach = Math.ceil(r * 3);
    for (let j = Math.max(1, Math.floor(y - reach)); j < Math.min(rows - 1, Math.ceil(y + reach)); j++) {
      for (let i = Math.max(1, Math.floor(x - reach)); i < Math.min(cols - 1, Math.ceil(x + reach)); i++) {
        const ex = i - x, ey = j - y, q = (ex * ex + ey * ey) / (r * r), v = strength * (1 - q) * Math.exp(-q), k = j * cols + i;
        h[k] += v; p[k] += v;
      }
    }
    this.age = 0; this.live = true; this.peak = Math.max(this.peak, strength); this.front = Math.max(this.front, strength);
  }
  /** Moves the wave on by `dt` seconds; `pace` scales the speed everywhere (a front that is fast at first and eases). */
  step(dt: number, pace = 1) {
    if (!this.live || !(dt > 0)) return this.live;
    dt = Math.min(0.05, dt);
    this.age += dt;
    const { cols, rows, speed, damp, wall, trace } = this;
    const c = Math.max(0, this.base * pace);
    let top = 0;
    for (let i = 0; i < speed.length; i++) if (speed[i] > top) top = speed[i];
    // Courant: a wave never crosses more than about 0.6 of a cell a sub-step.
    const subs = Math.max(1, Math.min(8, Math.ceil(c * dt * Math.sqrt(top) / 0.6)));
    const calm = this.calm, sub = dt / subs, k2 = (c * sub) * (c * sub), pull = this.mass * sub * sub;
    let h = this.h, p = this.p;
    for (let s = 0; s < subs; s++) {
      for (let y = 1; y < rows - 1; y++) {
        for (let x = 1, i = y * cols + 1; x < cols - 1; x++, i++) {
          const hi = h[i], lap = h[i - 1] + h[i + 1] + h[i - cols] + h[i + cols] - 4 * hi;
          const tr = trace[i], behind = tr > 0.02 ? Math.max(0, 1 - Math.abs(hi) / tr) : 0;
          const quiet = calm * behind * behind * sub, keep = 1 - Math.min(0.5, damp[i] * sub + quiet);
          // The previous height is only read here, so the next one is written over it.
          p[i] = (hi + (hi - p[i]) * keep + k2 * speed[i] * lap - pull * hi) * (1 - wall[i]) * (1 - Math.min(0.5, quiet * 0.5));
        }
      }
      const t = h; h = p; p = t;
    }
    this.h = h; this.p = p;
    const ax = this.drift[0] * dt, ay = this.drift[1] * dt;
    if (ax || ay) { this.carry(h, ax, ay); this.carry(p, ax, ay); }
    // The border soaks the wave up rather than throwing it back.
    for (let x = 0; x < cols; x++) { h[x] = h[cols + x] * 0.5; h[(rows - 1) * cols + x] = h[(rows - 2) * cols + x] * 0.5; }
    for (let y = 0; y < rows; y++) { h[y * cols] = h[y * cols + 1] * 0.5; h[y * cols + cols - 1] = h[y * cols + cols - 2] * 0.5; }
    const fade = Math.exp(-dt * this.fade);
    let peak = 0;
    for (let i = 0; i < h.length; i++) {
      const a = Math.abs(h[i]);
      if (a > peak) peak = a;
      const m = trace[i] * fade;
      trace[i] = a >= m ? a : m < 1e-4 ? 0 : m;
    }
    this.peak = peak;
    // The front's height: high among the raised cells, but not the few highest, so a small knot left at the drop or a
    // reflection does not dim the whole front.
    const bins = this.bins.fill(0), floor = peak * 0.05;
    let count = 0;
    for (let i = 0; i < h.length; i++) if (h[i] > floor) { bins[Math.min(63, (h[i] / peak * 64) | 0)]++; count++; }
    let seen = 0, b = 63;
    for (; b > 0; b--) { seen += bins[b]; if (seen >= count * 0.08) break; }
    this.front = Math.max(peak * 0.15, (b + 1) / 64 * peak);
    if (peak < 0.004) { this.clear(); return false; }
    return true;
  }
  private spare = new Float32Array(0);
  /** Moves a grid by (ax, ay) cells, read back bilinearly. */
  private carry(grid: Float32Array, ax: number, ay: number) {
    const { cols, rows } = this;
    if (this.spare.length !== grid.length) this.spare = new Float32Array(grid.length);
    const out = this.spare;
    for (let y = 0, i = 0; y < rows; y++) {
      const sy = Math.min(rows - 1.001, Math.max(0, y - ay)), iy = sy | 0, fy = sy - iy;
      for (let x = 0; x < cols; x++, i++) {
        const sx = Math.min(cols - 1.001, Math.max(0, x - ax)), ix = sx | 0, fx = sx - ix, k = iy * cols + ix;
        out[i] = (grid[k] * (1 - fx) + grid[k + 1] * fx) * (1 - fy) + (grid[k + cols] * (1 - fx) + grid[k + cols + 1] * fx) * fy;
      }
    }
    grid.set(out);
  }
  /** The surface's slope at a cell, into `out` as [dx, dy]. */
  slope(i: number, out: [number, number]) {
    const { h, cols } = this, n = h.length;
    out[0] = (h[Math.min(n - 1, i + 1)] - h[Math.max(0, i - 1)]) * 0.5;
    out[1] = (h[Math.min(n - 1, i + cols)] - h[Math.max(0, i - cols)]) * 0.5;
    return out;
  }
}

/**
 * What a photograph means for a tap, per cell of a `cols` × `rows` tap grid from cues read on the same grid: water carries a
 * long-lived wave fast, sky a soft swell, smooth areas carry it, detail slows it, strong edges and the subject's silhouette
 * hold it back so it wraps round the subject, and solid ground damps it to a short shudder. The cues may be on a coarser
 * `cw` × `ch` grid (a video's, read every frame) and are then read at the nearest cell.
 * Also returns where the light comes from: the side of the frame its highlights gather on.
 */
export function photoMedium(tap: SurfaceTap, cues: PhotoCues, light: [number, number] = [-0.5, -0.8], cw = tap.cols, ch = tap.rows) {
  const { cols, rows, speed, damp, wall } = tap, S = PHOTO_CUE_STRIDE;
  if (cues.length !== cw * ch * S) return light;
  let gx = 0, gy = 0, gw = 0;
  for (let y = 0, i = 0; y < rows; y++) {
    const cy = Math.min(ch - 1, (y * ch / rows) | 0);
    for (let x = 0; x < cols; x++, i++) {
      const cx = Math.min(cw - 1, (x * cw / cols) | 0), o = (cy * cw + cx) * S, detail = cues[o + 3], water = cues[o + 8], sky = cues[o + 9], glow = cues[o + 2], depth = cues[o + 1];
      // Silhouette: depth that changes sharply across the cell, the subject's outline against what lies behind it.
      const r = cx < cw - 1 ? S : 0, l = cx > 0 ? -S : 0, d = cy < ch - 1 ? cw * S : 0, u = cy > 0 ? -cw * S : 0;
      const dz = Math.hypot(cues[o + 1 + r] - cues[o + 1 + l], cues[o + 1 + d] - cues[o + 1 + u]);
      const edge = Math.hypot(cues[o + 4], cues[o + 5]);
      const open = Math.max(water, sky * 0.9);
      const smoothness = 1 - smooth(0.2, 0.8, detail);
      const s = Math.max(0.12, Math.max(open, 0.2 + 0.65 * smoothness) * (1 - 0.45 * smooth(0.55, 0.95, depth) * (1 - water)));
      speed[i] = s * s;
      // Water carries the front furthest, sky lets its swell settle, smooth ground lets it pass briefly, busy ground stops it
      // in a few tenths of a second.
      const ground = Math.max(0, 1 - open);
      damp[i] = 0.9 * water + 1.6 * sky * (1 - water) + ground * (1.4 + 6.5 * smooth(0.25, 0.9, detail));
      // Soft walls: enough to slow and wrap the front round the subject, too little to throw it back as an echo.
      wall[i] = Math.min(0.4, 0.35 * smooth(0.12, 0.35, dz) * (1 - water * 0.6) + 0.1 * smooth(0.6, 1, edge) * (1 - open));
      gx += (x / (cols - 1) - 0.5) * glow; gy += (y / (rows - 1) - 0.5) * glow; gw += glow;
    }
  }
  // A medium that changes from cell to cell scatters the front into noise; softened over a few cells it bends it instead.
  soften(speed, cols, rows, 2); soften(damp, cols, rows, 1);
  if (gw > 0.5) {
    const m = Math.hypot(gx, gy);
    if (m / gw > 0.02) { light[0] = gx / m; light[1] = gy / m; }
  }
  return light;
}

function soften(values: Float32Array, cols: number, rows: number, radius: number) {
  const copy = new Float32Array(values.length);
  for (let pass = 0; pass < 2; pass++) {
    const from = pass ? copy : values, to = pass ? values : copy;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      let sum = 0, n = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = pass ? x : x + k, yy = pass ? y + k : y;
        if (xx < 0 || yy < 0 || xx >= cols || yy >= rows) continue;
        sum += from[yy * cols + xx]; n++;
      }
      to[y * cols + x] = sum / n;
    }
  }
}

/**
 * The tap's tone at each cell of a photograph, written as RGBA for the GPU: R/G a signed lift (16 bits, 0.5 is none) and B a
 * highlight. Water draws its rings, both crests and troughs, with a specular glint where a crest's slope faces the light; sky
 * a soft swell of the wave's memory; ground a small shudder of the wave itself. The slope is shaded against the photograph's
 * own relief and light, so the front reads as lying on the surface rather than over it.
 */
export function shadePhotoTap(tap: SurfaceTap, cues: PhotoCues, light: readonly [number, number], out: Uint8Array, gain = 1, cw = tap.cols, ch = tap.rows) {
  const { cols, rows, h, trace } = tap, S = PHOTO_CUE_STRIDE;
  const scale = gain / Math.max(0.01, tap.front);
  const lx = light[0], ly = light[1], valid = cues.length === cw * ch * S;
  for (let y = 0, i = 0; y < rows; y++) {
    const cy = Math.min(ch - 1, (y * ch / rows) | 0);
    for (let x = 0; x < cols; x++, i++) {
      const v = h[i] * scale, o = (cy * cw + Math.min(cw - 1, (x * cw / cols) | 0)) * S;
      // Very smooth, unbroken areas ring like water even where the photo is not read as water (a still pond in shade).
      const sky = valid ? cues[o + 9] : 0, water = valid ? Math.max(cues[o + 8], 0.75 * (1 - smooth(0.1, 0.45, cues[o + 3])) * (1 - sky)) : 0;
      const ground = Math.max(0, 1 - Math.max(water, sky));
      const sx = (h[x < cols - 1 ? i + 1 : i] - h[x > 0 ? i - 1 : i]) * 0.5 * scale;
      const sy = (h[y < rows - 1 ? i + cols : i] - h[y > 0 ? i - cols : i]) * 0.5 * scale;
      // A wave normal tilted by its slope, added to the photo's own normal, lit from the photo's light.
      const nx = -sx * 6 + (valid ? cues[o + 4] * 0.35 : 0), ny = -sy * 6 + (valid ? cues[o + 5] * 0.35 : 0);
      const facing = nx * lx + ny * ly;
      const shade = Math.max(-1, Math.min(1, facing));
      // Crests lift more than troughs sink, so a ring reads on a dark photo as well as a light one.
      const wave = v > 0 ? v : v * 0.45;
      let lift = water * (wave * 0.8 + shade * 0.4 * Math.min(1, Math.abs(v) * 4))
        + sky * (Math.min(1, trace[i] * scale) * 0.3 + wave * 0.15)
        + ground * (wave * 0.55 + shade * 0.25 * Math.min(1, Math.abs(v) * 4));
      const glint = water * Math.max(0, shade) ** 3 * Math.min(1, Math.max(0, v) * 3) * 0.9 + ground * Math.max(0, shade) ** 4 * Math.min(1, Math.max(0, v) * 3) * 0.25;
      lift = Math.max(-1, Math.min(1, lift));
      const packed = Math.round(lift * 32767 + 32768);
      out[i * 4] = packed >>> 8; out[i * 4 + 1] = packed & 255;
      out[i * 4 + 2] = Math.round(Math.min(1, glint) * 255); out[i * 4 + 3] = 255;
    }
  }
  return out;
}
