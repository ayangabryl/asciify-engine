/** Shared input contract for procedural flow and the hero water surface. */
export interface PointerField {
  readonly densityTrail?: boolean;
  readonly active: boolean;
  readonly hasRefraction?: boolean;
  move(x: number, y: number): void;
  leave(): void;
  clear(): void;
  step(seconds: number): void;
  sample(x: number, y: number, out: number[]): void;
}

/** A bounded, advected pointer field. Coordinates are relative to the viewport. */
export class FluidField {
  readonly columns: number;
  readonly rows: number;
  private front: Float32Array;
  private back: Float32Array;
  private strokes: { x: number; y: number; dx: number; dy: number; speed: number; fromX: number; fromY: number }[] = [];
  private readonly advected = [0, 0, 0];
  private previous: { x: number; y: number } | null = null;
  private energy = 0;
  private aspect: number;
  private decayRate: number;
  private readonly continuousWake: boolean;

  constructor(aspect = 1, decayRate = 3.5, continuousWake = false) {
    this.continuousWake = continuousWake;
    this.decayRate = decayRate;
    this.aspect = Math.max(.25, Math.min(4, aspect));
    const resolution = continuousWake ? 96 : 64;
    this.columns = this.aspect >= 1 ? resolution : Math.round(resolution * this.aspect);
    this.rows = this.aspect >= 1 ? Math.round(resolution / this.aspect) : resolution;
    this.front = new Float32Array(this.columns * this.rows * 3);
    this.back = new Float32Array(this.front.length);
  }
  get active() { return this.energy > .0005 || this.strokes.length > 0; }
  move(x: number, y: number) {
    if (!Number.isFinite(x + y)) return;
    // Entry establishes an anchor; it must not paint a dot or connect to an old exit.
    if (this.continuousWake && !this.previous) { this.previous = { x, y }; return; }
    const previous = this.previous ?? { x: x - .004, y: y - .001 };
    const dx = Math.max(-.09, Math.min(.09, x - previous.x));
    const dy = Math.max(-.09, Math.min(.09, y - previous.y));
    this.previous = { x, y };
    if (Math.abs(dx) + Math.abs(dy) < .0001) return;
    const speed = Math.min(1, Math.hypot(dx * this.aspect, dy) * 25 + .06);
    this.strokes.push({ x, y, dx, dy, speed, fromX: previous.x, fromY: previous.y });
    if (this.strokes.length > 12) this.strokes.shift();
  }
  leave() { this.previous = null; }
  clear() {
    this.front.fill(0); this.back.fill(0); this.strokes.length = 0;
    this.previous = null; this.energy = 0;
  }
  private read(data: Float32Array, x: number, y: number, out: number[]) {
    const gx = Math.max(0, Math.min(this.columns - 1.001, x * (this.columns - 1)));
    const gy = Math.max(0, Math.min(this.rows - 1.001, y * (this.rows - 1)));
    const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
    const top = (iy * this.columns + ix) * 3, bottom = top + this.columns * 3;
    const leftWeight = 1 - fx, topWeight = 1 - fy;
    // All channels use the same bounded cell and bilinear weights. Preserve
    // operation order so the velocity and ink stay identical to scalar reads.
    out[0] = (data[top] * leftWeight + data[top + 3] * fx) * topWeight
      + (data[bottom] * leftWeight + data[bottom + 3] * fx) * fy;
    out[1] = (data[top + 1] * leftWeight + data[top + 4] * fx) * topWeight
      + (data[bottom + 1] * leftWeight + data[bottom + 4] * fx) * fy;
    out[2] = (data[top + 2] * leftWeight + data[top + 5] * fx) * topWeight
      + (data[bottom + 2] * leftWeight + data[bottom + 5] * fx) * fy;
  }
  sample(x: number, y: number, out: number[]) {
    this.read(this.front, x, y, out);
  }
  step(seconds: number) {
    if (!this.active) return;
    const dt = Math.max(0, Math.min(.05, seconds));
    const decay = Math.exp(-dt * this.decayRate), inkDecay = Math.exp(-dt * (this.decayRate + .5));
    const xScale = Math.max(1, this.aspect), yScale = Math.max(1, 1 / this.aspect);
    let peak = 0;
    for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.columns; x++) {
      const i = (y * this.columns + x) * 3, u = x / (this.columns - 1), v = y / (this.rows - 1);
      const transport = this.continuousWake ? .65 : 2;
      const sx = u - this.front[i] * dt * transport, sy = v - this.front[i + 1] * dt * transport;
      this.read(this.front, sx, sy, this.advected);
      let dx = this.advected[0] * decay;
      let dy = this.advected[1] * decay;
      let ink = this.advected[2] * inkDecay;
      for (const stroke of this.strokes) {
        let rx = (u - stroke.x) * xScale, ry = (v - stroke.y) * yScale;
        if (this.continuousWake) {
          // Deposit along the complete travelled segment, not isolated mouse events.
          // A quick sweep stays connected even when the browser coalesces input.
          const ax = (u - stroke.fromX) * xScale, ay = (v - stroke.fromY) * yScale;
          const bx = (stroke.x - stroke.fromX) * xScale, by = (stroke.y - stroke.fromY) * yScale;
          const along = Math.max(0, Math.min(1, (ax * bx + ay * by) / (bx * bx + by * by || 1)));
          rx = ax - bx * along; ry = ay - by * along;
          const distance = rx * rx + ry * ry;
          if (distance > .0225) continue;
          const weight = Math.exp(-distance / .0032);
          const travel = Math.hypot(stroke.dx * xScale, stroke.dy * yScale);
          const curl = Math.min(.025, travel * .55);
          dx += (stroke.dx * 4.2 - ry * curl) * weight;
          dy += (stroke.dy * 4.2 + rx * curl) * weight;
          ink = Math.max(ink, Math.min(.7, travel * 18) * weight);
          continue;
        }
        const distance = rx * rx + ry * ry;
        if (distance > .045) continue;
        const weight = Math.exp(-distance / .0075);
        const speed = stroke.speed;
        // Momentum and a small transverse curl bend the sampled image together.
        dx += (stroke.dx * 2.8 - ry * speed * .16) * weight;
        dy += (stroke.dy * 2.8 + rx * speed * .16) * weight;
        ink += speed * weight * .3;
      }
      this.back[i] = Math.max(-.18, Math.min(.18, dx));
      this.back[i + 1] = Math.max(-.18, Math.min(.18, dy));
      this.back[i + 2] = Math.min(.8, ink);
      peak = Math.max(peak, Math.abs(dx), Math.abs(dy), ink);
    }
    [this.front, this.back] = [this.back, this.front];
    this.strokes.length = 0; this.energy = peak;
    if (!this.active) this.clear();
  }
}

/** Original monochrome liquid source, converted to glyphs by asciify-engine. */
export function paintLiquidSource(pixels: Uint8ClampedArray, width: number, height: number, aspect: number, time: number, flow: PointerField) {
  const field = [0, 0, 0], moving = flow.active;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / width, v = y / height;
    if (moving) flow.sample(u, v, field);
    const px = (u - .5 - field[0]) * aspect, py = v - .5 - field[1];
    const qx = px + .22 * Math.sin(py * 5.2 + time * .17) + .15 * Math.sin(px * 2.4 - py * 3.1 - time * .1);
    const qy = py + .19 * Math.sin(px * 3.5 + time * .13);
    const radius = Math.hypot(qx * .8 + .18, qy * 1.1);
    const folds = .5 + .5 * Math.sin(radius * 14 - qx * 2.8 + Math.sin(qy * 5) * 1.4 - time * .24);
    const cloud = .5 + .5 * Math.sin(qx * 3.6 - qy * 2.9 + time * .09);
    const light = Math.max(0, Math.min(1, folds * folds * (.48 + cloud * .32) - .075 + field[2] * .75));
    const value = Math.round(light * 255), i = (y * width + x) * 4;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = value; pixels[i + 3] = 255;
  }
}
