import { surfaceEdgeWeight } from './surface-edge';
import { guideAt, type HoverGuide } from './hover-guide';

export type CursorMode = 'loupe' | 'repel' | 'tilt' | 'reveal' | 'haze' | 'bleed';
export const CURSOR_MODES: readonly CursorMode[] = ['loupe', 'repel', 'tilt', 'reveal', 'haze', 'bleed'];
export const isCursorMode = (mode: string): mode is CursorMode => (CURSOR_MODES as readonly string[]).includes(mode);

/** Scalar damped spring, integrated in small fixed steps so 30/60/120Hz settle alike. */
class Spring {
  value = 0; velocity = 0;
  step(target: number, dt: number, stiffness: number, ratio: number) {
    const damping = 2 * Math.sqrt(stiffness) * ratio;
    for (let left = dt; left > 1e-6; left -= 1 / 480) {
      const h = Math.min(1 / 480, left);
      this.velocity += ((target - this.value) * stiffness - this.velocity * damping) * h;
      this.value += this.velocity * h;
    }
  }
  resting(target: number) { return Math.abs(this.value - target) < .0015 && Math.abs(this.velocity) < .01; }
  set(value: number) { this.value = value; this.velocity = 0; }
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const hash = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function noise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

/** Hovers that belong to the cursor rather than to its stroke: a loupe, a parting, a tilt, a spotlight,
 * a heat shimmer and an ink bleed. Position and presence ride springs, so the effect eases in on entry,
 * settles when the pointer rests and decays after it leaves. Displacement is in UV units. */
export class CursorField {
  edgeSafe = false;
  /** Multiplies release and decay speed; 1 is the tuned default. */
  settle = 1;
  readonly width: number; readonly height: number; readonly pixels: Uint8Array;
  /** Normalized centre, presence-scaled amount and radius, for light-style consumers. */
  readonly focus: [number, number, number, number] = [.5, .5, 0, .2];
  guide: HoverGuide | null = null;
  private mode: CursorMode = 'loupe';
  private radius = .35;
  private readonly x = new Spring(); private readonly y = new Spring();
  private readonly tx = new Spring(); private readonly ty = new Spring();
  private readonly presence = new Spring();
  private target: { x: number; y: number; time: number } | null = null;
  private speed = 0; private clock = 0; private inkPeak = 0;
  private readonly sx: number; private readonly sy: number;
  private ink: Float32Array | null = null; private next: Float32Array | null = null; private fiber: Float32Array | null = null;
  private readonly sampled = [0, 0, 0];
  constructor(width: number, height: number) {
    this.width = width; this.height = height;
    this.pixels = new Uint8Array(width * height * 4);
    this.sx = Math.max(1, width / height); this.sy = Math.max(1, height / width);
    this.clear();
  }
  setMode(mode: CursorMode) {
    if (mode === this.mode) return;
    this.mode = mode; this.clear();
    if (mode === 'bleed' && !this.ink) {
      const n = this.width * this.height;
      this.ink = new Float32Array(n); this.next = new Float32Array(n); this.fiber = new Float32Array(n);
      // Paper: long soft fibres plus fine tooth, so the bleed spreads unevenly instead of as a disc.
      for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++)
        this.fiber[y * this.width + x] = .35 + .5 * noise(x * .09, y * .045) + .15 * hash(x, y);
    }
  }
  setRadius(radius: number) { this.radius = Math.max(.1, Math.min(1, radius)); }
  /** Lens radius in aspect-corrected units. */
  private get reach() { return (.05 + this.radius * .25) * (this.mode === 'loupe' ? 1 - this.speed * .14 : 1); }
  get engaged() { return this.presence.value > .002 || this.inkPeak > .002 || Math.abs(this.tx.value) + Math.abs(this.ty.value) > .0004; }
  get active() {
    const goal = this.target ? 1 : 0;
    return !this.presence.resting(goal) || (!!this.target && (!this.x.resting(this.target.x) || !this.y.resting(this.target.y)))
      || !this.tx.resting(this.tiltGoal(0)) || !this.ty.resting(this.tiltGoal(1))
      || this.speed > .01 || (this.mode === 'haze' && this.presence.value > .002) || this.inkPeak > .002;
  }
  private tiltGoal(axis: 0 | 1) { return this.target && this.mode === 'tilt' ? ((axis ? this.target.y : this.target.x) - .5) * 2 : 0; }
  clear() {
    for (const s of [this.x, this.y, this.tx, this.ty, this.presence]) s.set(0);
    this.x.set(.5); this.y.set(.5);
    this.target = null; this.speed = 0; this.inkPeak = 0;
    this.ink?.fill(0); this.next?.fill(0);
    this.encode();
  }
  move(x: number, y: number, time?: number) {
    if (!Number.isFinite(x + y)) return;
    x = Math.max(0, Math.min(1, x)); y = Math.max(0, Math.min(1, y));
    const t = Number.isFinite(time) ? time! / 1000 : this.clock;
    const previous = this.target;
    // Entering: start under the pointer instead of sliding in from the last exit.
    if (!previous && this.presence.value < .05) { this.x.set(x); this.y.set(y); }
    if (previous) {
      const travel = Math.hypot((x - previous.x) * this.sx, (y - previous.y) * this.sy);
      const rate = travel / Math.max(1 / 240, Math.min(.1, t - previous.time || 1 / 60));
      this.speed = Math.max(this.speed, Math.min(1, rate / 1.6));
      if (this.mode === 'bleed') this.deposit(previous.x, previous.y, x, y, Math.min(1, travel * 9));
    } else if (this.mode === 'bleed') this.deposit(x, y, x, y, .5);
    this.target = { x, y, time: t };
  }
  leave() { this.target = null; }
  private deposit(x0: number, y0: number, x1: number, y1: number, amount: number) {
    const ink = this.ink!, w = this.width, h = this.height, r = this.reach * .55;
    const travel = Math.hypot((x1 - x0) * this.sx, (y1 - y0) * this.sy);
    const count = Math.min(48, Math.max(1, Math.ceil(travel / (r * .5))));
    for (let s = 0; s < count; s++) {
      const k = (s + .5) / count, cx = x0 + (x1 - x0) * k, cy = y0 + (y1 - y0) * k;
      const left = Math.max(0, Math.floor((cx - r * 2 / this.sx) * (w - 1))), right = Math.min(w - 1, Math.ceil((cx + r * 2 / this.sx) * (w - 1)));
      const top = Math.max(0, Math.floor((cy - r * 2 / this.sy) * (h - 1))), bottom = Math.min(h - 1, Math.ceil((cy + r * 2 / this.sy) * (h - 1)));
      for (let gy = top; gy <= bottom; gy++) for (let gx = left; gx <= right; gx++) {
        const dx = (gx / (w - 1) - cx) * this.sx / r, dy = (gy / (h - 1) - cy) * this.sy / r, i = gy * w + gx;
        ink[i] = Math.min(1.4, ink[i] + Math.exp(-(dx * dx + dy * dy) * 1.8) * amount / count * 1.6);
      }
    }
    this.inkPeak = Math.max(this.inkPeak, .01);
  }
  step(seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const dt = Math.min(.05, seconds), release = dt * this.settle;
    this.clock += dt;
    const target = this.target, mode = this.mode;
    // Entry eases in without overshoot; the parting releases with one soft rebound.
    if (target) this.presence.step(1, dt, 190, 1);
    else this.presence.step(0, release, mode === 'repel' ? 120 : 70, mode === 'repel' ? .42 : 1);
    if (target) {
      const stiffness = mode === 'tilt' ? 60 : mode === 'haze' ? 90 : 240, ratio = mode === 'loupe' || mode === 'repel' ? .72 : .9;
      this.x.step(target.x, dt, stiffness, ratio); this.y.step(target.y, dt, stiffness, ratio);
    }
    this.tx.step(this.tiltGoal(0), target ? dt : release, 45, .78); this.ty.step(this.tiltGoal(1), target ? dt : release, 45, .78);
    this.speed *= Math.exp(-dt * 7);
    if (mode === 'bleed') this.spread(dt, release, !!target);
    if (!this.engaged && !this.active) { this.presence.set(0); this.tx.set(0); this.ty.set(0); }
    this.focus[0] = this.x.value; this.focus[1] = this.y.value;
    this.focus[2] = Math.max(0, Math.min(1, this.presence.value)); this.focus[3] = this.reach;
    this.encode();
  }
  private spread(dt: number, release: number, held: boolean) {
    const ink = this.ink!, next = this.next!, fiber = this.fiber!, w = this.width, h = this.height;
    // A resting pen keeps feeding the stain, so it keeps blooming outward while you hover.
    if (held && this.target) this.deposit(this.x.value, this.y.value, this.x.value, this.y.value, dt * .9);
    const steps = Math.max(1, Math.ceil(dt / (1 / 240))), h_ = dt / steps;
    const diffusion = 26 * (.4 + this.radius), dry = (held ? .02 : .1) * release / dt, fade = Math.exp(-(held ? .15 : .9) * release / steps);
    let peak = 0;
    for (let s = 0; s < steps; s++) {
      peak = 0;
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = y * w + x, v = ink[i], f = fiber[i];
        const flow = (Math.min(f, fiber[i - 1]) * (ink[i - 1] - v) + Math.min(f, fiber[i + 1]) * (ink[i + 1] - v)
          + Math.min(f, fiber[i - w]) * (ink[i - w] - v) + Math.min(f, fiber[i + w]) * (ink[i + w] - v));
        // Drying pulls the stain back from its thin edges first, so it recedes rather than fading as a disc.
        const value = Math.max(0, (v + flow * Math.min(.24, diffusion * h_)) * fade - dry * h_);
        next[i] = value; if (value > peak) peak = value;
      }
      ink.set(next);
    }
    this.inkPeak = peak;
  }
  /** out: displacement (UV) x, y and a signed tone change. Amount is applied by the caller. */
  sample(x: number, y: number, out: number[]) {
    out[0] = out[1] = out[2] = 0;
    const p = this.presence.value, mode = this.mode;
    if (mode === 'bleed') {
      if (this.inkPeak <= .002) return;
      const w = this.width, h = this.height, ink = this.ink!;
      const gx = Math.max(0, Math.min(w - 1.001, x * (w - 1))), gy = Math.max(0, Math.min(h - 1.001, y * (h - 1)));
      const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy, a = iy * w + ix, b = a + w;
      const v = (ink[a] * (1 - fx) + ink[a + 1] * fx) * (1 - fy) + (ink[b] * (1 - fx) + ink[b + 1] * fx) * fy;
      out[2] = 1 - Math.exp(-v * 2.4);
      return;
    }
    if (mode === 'tilt') {
      const depth = this.guide ? guideAt(this.guide, 'depth', x, y) : .6;
      const lift = .2 + .8 * depth, edge = this.edgeSafe ? surfaceEdgeWeight(x, y, this.sx / this.sy) : 1;
      out[0] = this.tx.value * .024 * lift * edge / this.sx;
      out[1] = this.ty.value * .024 * lift * edge / this.sy;
      return;
    }
    if (p <= .001) return;
    const R = this.reach, dx = (x - this.x.value) * this.sx, dy = (y - this.y.value) * this.sy;
    const q2 = (dx * dx + dy * dy) / (R * R);
    if (mode === 'reveal') { out[2] = Math.exp(-q2 * 2.4) * p; return; }
    if (q2 > 9) return;
    const edge = this.edgeSafe ? surfaceEdgeWeight(x, y, this.sx / this.sy) : 1;
    let ux = 0, uy = 0;
    if (mode === 'loupe') {
      // A flat-topped magnifier: uniform zoom inside, the image compresses through a soft rim, like glass.
      const lens = Math.exp(-q2 * q2) * p * .5;
      ux = dx * lens; uy = dy * lens;
      const rim = Math.sqrt(q2) - 1;
      out[2] = Math.exp(-rim * rim / .018) * p * .55;
    } else if (mode === 'repel') {
      // Characters inside the core are pushed out and packed into a ring, leaving a soft clearing.
      const q = Math.sqrt(q2), push = R * .5 * Math.exp(-q2 / 1.7) * p;
      const len = Math.max(1e-6, Math.sqrt(dx * dx + dy * dy));
      ux = dx / len * Math.min(push, len + R * .5 * p); uy = dy / len * Math.min(push, len + R * .5 * p);
      const t = Math.max(0, Math.min(1, (q - .3) / .32));
      out[2] = -(1 - t * t * (3 - 2 * t)) * p;
    } else if (mode === 'haze') {
      // Heat rises: the shimmer sits above the cursor, and the turbulence scrolls upward.
      const ry = dy / R + .45, envelope = Math.exp(-(dx * dx / (R * R)) - ry * ry / 2.6) * p * (.35 + .65 * Math.min(1, this.speed * 1.4 + .25));
      if (envelope < .002) return;
      const t = this.clock, fx = x * this.sx * 9, fy = y * this.sy * 9 + t * 2.3;
      const n1 = noise(fx, fy) - .5, n2 = noise(fx + 17.3, fy * 1.3 + t * .7) - .5;
      ux = n1 * .06 * envelope; uy = n2 * .026 * envelope;
      out[2] = (noise(fx * 1.7 + 5, fy * 1.7) - .5) * .35 * envelope;
    }
    out[0] = ux * edge / this.sx; out[1] = uy * edge / this.sy;
  }
  /** GPU texture: signed 16-bit x/y displacement in UV/.16, or a signed density for the bleed. */
  private encode() {
    const w = this.width, h = this.height, px = this.pixels, v = this.sampled;
    const live = this.engaged;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (live) this.sample(x / (w - 1), y / (h - 1), v); else v[0] = v[1] = v[2] = 0;
      if (this.mode === 'bleed') {
        const d = Math.round(Math.max(-1, Math.min(1, v[2])) * 32767 + 32768);
        px[i] = d >>> 8; px[i + 1] = d & 255; px[i + 2] = 128; px[i + 3] = 0;
      } else {
        // A pixel-space warp squeezes glyph shapes into rings, so the GPU parting leans on its clearing instead.
        if (this.mode === 'repel') { v[0] *= .3; v[1] *= .3; }
        const a = Math.round(Math.max(-1, Math.min(1, v[0] / .16)) * 32767 + 32768), b = Math.round(Math.max(-1, Math.min(1, v[1] / .16)) * 32767 + 32768);
        px[i] = a >>> 8; px[i + 1] = a & 255; px[i + 2] = b >>> 8; px[i + 3] = b & 255;
      }
    }
  }
}
