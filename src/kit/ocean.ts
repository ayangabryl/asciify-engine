import type { GlyphFieldOptions } from '../field';
import { clamp, handle, hexRgb, mixHex, mountSurface, resolveColor, srOnly, styleKeeper, type KitHandle, type KitOptions, type Surface } from './core';

/** What swims. A `school` is one shoal of small fish that move together; its `count` is how many fish are in it. */
export type OceanKind = 'fish' | 'shark' | 'hammerhead' | 'manta' | 'jellyfish' | 'school';
export const OCEAN_KINDS: readonly OceanKind[] = ['fish', 'shark', 'hammerhead', 'manta', 'jellyfish', 'school'];

export interface OceanCreature {
  kind: OceanKind;
  /** Multiplies the kind's own length, which follows the element's shorter side. Default 1. */
  size?: number;
  /** How many: individuals, or for a `school` the fish in it. Default 1 (a school 28). Scaled by `density`. */
  count?: number;
}

export interface OceanOptions extends KitOptions {
  /** What swims. Default three sharks of different sizes, a hammerhead and two schools. */
  creatures?: OceanCreature[];
  /** Swimming pace, 0 holds everything; 1 is natural. Default 1. */
  speed?: number;
  /** Multiplies every count. Default 1. */
  density?: number;
  /** How far the depth layers go, 0 to 1: far creatures are smaller, fainter and slower. 0 puts everything on one plane. Default 0.35. */
  depth?: number;
  /** An ink per kind, as a CSS colour or theme token (`--brand`). Kinds without one use `ink`. Draws in source colour. */
  palette?: Partial<Record<OceanKind, string>>;
  /** `transparent` (default) or a CSS colour or token for the water behind the characters. */
  background?: string;
  /** The cursor scatters small fish and sharks turn to investigate it; a press sends a ripple. Default true. */
  interactive?: boolean;
  /** A press sends a ring through the field and scatters the fish near it. Default true; needs `interactive`. */
  ripples?: boolean;
  /** At the element's edges creatures turn back (`turn`, default) or swim out and come in on the other side (`wrap`). */
  edges?: 'turn' | 'wrap';
  /** The same seed always lays out and moves the same ocean. Default 1. */
  seed?: number;
  /** `under` (default) sits behind the element's content, as a background; `over` draws above it. */
  layer?: 'under' | 'over';
  /** Read to assistive technology. Without one the ocean is decoration. */
  label?: string;
  /** A colour the ink leans toward, 40%, as the reference's bluish-grey bodies: a CSS colour or token, or `false` for the plain ink. Default `#8a96b8`. Ignored with `palette`. */
  tint?: string | false;
  /** Sparse coloured letters, tinted tiles and white glints that twinkle across the bodies: `true` (default), `false`, or the share of lit tiles, up to 0.3. */
  accents?: boolean | number;
}

export interface OceanHandle extends KitHandle<OceanOptions> {
  /** Adds creatures of a kind (a whole school for `school`); returns how many were added. */
  add(kind: OceanKind, options?: { size?: number; count?: number }): number;
  /** Removes the most recently added creature of `kind` (or of any kind), a whole school at once. Returns whether one went. */
  remove(kind?: OceanKind): boolean;
  /** Creatures swimming now, every fish of a school counted. */
  readonly count: number;
}

/* ---------------- Species ---------------- */

interface Species {
  /** Length as a share of the element's shorter side. */
  len: number;
  /** Cruising speed in body lengths a second. */
  speed: number;
  /** Tail beats (or bell pulses, wing strokes) a second. */
  beat: number;
  /** Side-to-side swing of the travelling wave, as a share of the length. */
  amp: number;
  /** Wavelengths along the body. */
  waves: number;
  /** Fastest turn, radians a second. */
  turn: number;
  /** Small fish: flee the cursor, presses and sharks. */
  prey: boolean;
  /** Sharks: turn to investigate the cursor. */
  hunter: boolean;
}

export const SPECIES: Record<OceanKind, Species> = {
  fish: { len: 0.13, speed: 0.55, beat: 2.1, amp: 0.07, waves: 0.9, turn: 1.8, prey: true, hunter: false },
  school: { len: 0.055, speed: 1.15, beat: 3.6, amp: 0.08, waves: 0.9, turn: 3.4, prey: true, hunter: false },
  shark: { len: 0.5, speed: 0.3, beat: 0.8, amp: 0.065, waves: 0.75, turn: 0.6, prey: false, hunter: true },
  hammerhead: { len: 0.46, speed: 0.3, beat: 0.85, amp: 0.065, waves: 0.75, turn: 0.6, prey: false, hunter: true },
  manta: { len: 0.2, speed: 0.3, beat: 0.42, amp: 0.025, waves: 0.5, turn: 0.4, prey: false, hunter: false },
  jellyfish: { len: 0.085, speed: 0.4, beat: 0.6, amp: 0, waves: 0, turn: 0.35, prey: false, hunter: false },
};

/**
 * Half the body's width at `s` (0 the snout, 1 where the tail fin starts) as a share of its length, seen from above.
 * Exported for tests.
 */
export function bodyWidth(kind: OceanKind, s: number) {
  s = clamp(s);
  if (kind === 'shark' || kind === 'hammerhead') {
    const peak = 0.3, max = kind === 'shark' ? 0.1 : 0.085;
    return max * (s < peak ? (s / peak) ** (kind === 'shark' ? 0.6 : 0.4) : ((1 - s) / (1 - peak)) ** 1.35) + 0.008 * s;
  }
  if (kind === 'manta') return s < 0.5 ? 0.09 * Math.sin(Math.PI * (s / 0.5) ** 0.8) : 0;
  if (kind === 'jellyfish') return 0;
  const peak = 0.32, max = kind === 'school' ? 0.14 : 0.16;
  return max * (s < peak ? Math.sin((s / peak) * Math.PI / 2) ** 0.7 : ((1 - s) / (1 - peak)) ** 1.1) + 0.01 * s;
}

/* ---------------- Spine ---------------- */

export const SPINE = 16;
export interface Spine { x: Float32Array; y: Float32Array; nx: Float32Array; ny: Float32Array }
export const createSpine = (): Spine => ({ x: new Float32Array(SPINE + 1), y: new Float32Array(SPINE + 1), nx: new Float32Array(SPINE + 1), ny: new Float32Array(SPINE + 1) });

/**
 * Lays a body's centre line into `out`, snout at (x, y) facing `heading`, `length` long. `bend` is how far the heading turns
 * from snout to tail (a turning body trails the way it came), and a travelling wave of `amp` lengths, `waves` wavelengths long,
 * runs from snout to tail as `phase` grows, swinging the tail most. Normals point to the body's left. Exported for tests.
 */
export function laySpine(out: Spine, x: number, y: number, heading: number, bend: number, length: number, phase: number, amp: number, waves: number) {
  const seg = length / SPINE;
  let px = x, py = y;
  for (let i = 0; i <= SPINE; i++) {
    const s = i / SPINE, a = heading - bend * s;
    if (i > 0) { px -= Math.cos(a) * seg; py -= Math.sin(a) * seg; }
    const d = amp * length * (0.12 + 0.88 * s * s) * Math.sin(phase - s * waves * Math.PI * 2);
    out.x[i] = px - Math.sin(a) * d;
    out.y[i] = py + Math.cos(a) * d;
  }
  for (let i = 0; i <= SPINE; i++) {
    const a = i > 0 ? i - 1 : 0, b = i < SPINE ? i + 1 : SPINE;
    const tx = out.x[a] - out.x[b], ty = out.y[a] - out.y[b], n = Math.hypot(tx, ty) || 1;
    out.nx[i] = -ty / n; out.ny[i] = tx / n;
  }
}

/* ---------------- World ---------------- */

export interface OceanBody {
  id: number;
  kind: OceanKind;
  size: number;
  x: number; y: number;
  heading: number; omega: number; speed: number; phase: number;
  /** 0 near, 1 far. */
  z: number;
  seed: number;
  /** Shared by the fish of one school; -1 for anything else. */
  group: number;
  fear: number;
}

export interface OceanWorld {
  w: number; h: number; t: number;
  bodies: OceanBody[];
  /** Far to near: the draw order. */
  order: number[];
  pointer: { x: number; y: number; at: number; on: boolean };
  burst: { x: number; y: number; at: number };
  rng: () => number;
  edges: 'turn' | 'wrap';
  nextId: number; nextGroup: number;
  acc: number;
}

const MAX_BODIES = 260;
const STEP = 1 / 60;
const TAU = Math.PI * 2;
const wrapPi = (a: number) => a - TAU * Math.floor((a + Math.PI) / TAU);

/** A small, fast seeded generator: the same seed gives the same ocean. */
export function seeded(seed: number) {
  let a = (Math.floor(seed * 2654435761) ^ 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const unit = (w: OceanWorld) => Math.max(40, Math.min(w.w, w.h));
/** A body's length in CSS pixels, depth included. */
export const bodyLength = (world: OceanWorld, body: OceanBody, depth: number) => SPECIES[body.kind].len * body.size * unit(world) * (1 - 0.5 * body.z * depth);

export function createWorld(w: number, h: number, seed = 1, edges: 'turn' | 'wrap' = 'turn'): OceanWorld {
  return {
    w, h, t: 0, bodies: [], order: [], pointer: { x: 0, y: 0, at: -1e9, on: false }, burst: { x: 0, y: 0, at: -1e9 },
    rng: seeded(seed), edges, nextId: 1, nextGroup: 0, acc: 0,
  };
}

function sortOrder(world: OceanWorld) {
  const { bodies, order } = world;
  order.length = bodies.length;
  for (let i = 0; i < bodies.length; i++) order[i] = i;
  for (let i = 1; i < order.length; i++) {
    const v = order[i], z = bodies[v].z;
    let j = i - 1;
    while (j >= 0 && bodies[order[j]].z < z) { order[j + 1] = order[j]; j--; }
    order[j + 1] = v;
  }
}

/** Adds creatures to the world at seeded places; returns how many. */
export function spawn(world: OceanWorld, kind: OceanKind, count: number, size = 1) {
  const r = world.rng, room = MAX_BODIES - world.bodies.length;
  const n = Math.max(0, Math.min(room, Math.round(count)));
  if (!n || !SPECIES[kind]) return 0;
  const u = unit(world);
  const group = kind === 'school' ? world.nextGroup++ : -1;
  const cx = world.w * (0.15 + 0.7 * r()), cy = world.h * (0.15 + 0.7 * r()), heading = r() * TAU, z = r();
  for (let i = 0; i < n; i++) {
    const school = group >= 0;
    const spread = school ? SPECIES.school.len * size * u * 0.85 * Math.sqrt(n) : 0;
    const a = r() * TAU, d = Math.sqrt(r()) * spread;
    world.bodies.push({
      id: world.nextId++, kind, size,
      x: school ? cx + Math.cos(a) * d : world.w * r(),
      y: school ? cy + Math.sin(a) * d : world.h * r(),
      heading: school ? heading + (r() - 0.5) * 0.4 : r() * TAU,
      omega: 0, speed: 0, phase: r() * TAU,
      z: school ? clamp(z + (r() - 0.5) * 0.15) : r(),
      seed: school ? group * 7.31 + r() * 0.2 : r() * 100,
      group, fear: 0,
    });
  }
  sortOrder(world);
  return n;
}

/** Removes the latest creature of `kind` (or any), a whole school at once. */
export function despawn(world: OceanWorld, kind?: OceanKind) {
  const { bodies } = world;
  for (let i = bodies.length - 1; i >= 0; i--) {
    const b = bodies[i];
    if (kind && b.kind !== kind) continue;
    if (b.group >= 0) { const g = b.group; world.bodies = bodies.filter(o => o.group !== g); }
    else bodies.splice(i, 1);
    sortOrder(world);
    return true;
  }
  return false;
}

/** Re-fits positions to a new size, so a resize keeps the composition. */
export function resizeWorld(world: OceanWorld, w: number, h: number) {
  if (world.w === w && world.h === h) return;
  const kx = w / (world.w || w), ky = h / (world.h || h);
  for (const b of world.bodies) { b.x *= kx; b.y *= ky; }
  world.w = w; world.h = h;
}

const wander = (seed: number, t: number) => Math.sin(t * 0.37 + seed * 6.1) * 0.6 + Math.sin(t * 0.91 + seed * 2.3) * 0.4;

export interface StepSettings { speed: number; depth: number; interactive: boolean }

/** Moves every creature on by `dt` seconds: steering, wander, schooling, the cursor and the edges. Exported for tests. */
export function stepWorld(world: OceanWorld, dt: number, settings: StepSettings) {
  const { bodies, pointer, burst } = world;
  const u = unit(world), t = world.t, pace = Math.max(0, settings.speed), depth = settings.depth;
  const pointerOn = settings.interactive && pointer.on && t - pointer.at < 2.5;
  const burstOn = settings.interactive && t - burst.at < 0.9;
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i], sp = SPECIES[b.kind];
    const L = bodyLength(world, b, depth), far = 1 - 0.5 * b.z * depth;
    let dx = Math.cos(b.heading), dy = Math.sin(b.heading), fear = 0, curious = 0;

    if (world.edges === 'turn') {
      const m = Math.min(0.16 * u + 0.4 * L, Math.min(world.w, world.h) / 3);
      if (b.x < m) dx += 2.5 * (m - b.x) / m; else if (b.x > world.w - m) dx -= 2.5 * (b.x - world.w + m) / m;
      if (b.y < m) dy += 2.5 * (m - b.y) / m; else if (b.y > world.h - m) dy -= 2.5 * (b.y - world.h + m) / m;
    }

    if (sp.prey) {
      if (pointerOn) {
        const R = 0.24 * u, ox = b.x - pointer.x, oy = b.y - pointer.y, d = Math.hypot(ox, oy);
        if (d < R && d > 0) { const k = (1 - d / R) ** 2; dx += (ox / d) * k * 5; dy += (oy / d) * k * 5; fear = Math.max(fear, k * 1.6); }
      }
      if (burstOn) {
        const R = 0.42 * u, ox = b.x - burst.x, oy = b.y - burst.y, d = Math.hypot(ox, oy);
        if (d < R && d > 0) { const k = 1 - d / R; dx += (ox / d) * k * 6; dy += (oy / d) * k * 6; fear = Math.max(fear, k * 2); }
      }
      for (let j = 0; j < bodies.length; j++) {
        const o = bodies[j];
        if (!SPECIES[o.kind].hunter) continue;
        const R = bodyLength(world, o, depth) * 0.55, ox = b.x - o.x, oy = b.y - o.y, d = Math.hypot(ox, oy);
        if (d < R && d > 0) { const k = 1 - d / R; dx += (ox / d) * k * 3; dy += (oy / d) * k * 3; fear = Math.max(fear, k); }
      }
    } else if (sp.hunter && (pointerOn || burstOn)) {
      const tx = burstOn ? burst.x : pointer.x, ty = burstOn ? burst.y : pointer.y;
      const R = 0.65 * u, ox = tx - b.x, oy = ty - b.y, d = Math.hypot(ox, oy);
      if (d < R && d > 0) {
        const k = 1 - d / R;
        // Toward it from afar; close in, it circles rather than bumping into the cursor.
        if (d > 0.7 * L) { dx += (ox / d) * k * 2.4; dy += (oy / d) * k * 2.4; }
        else { const side = Math.sign(wrapPi(Math.atan2(oy, ox) - b.heading)) || 1; dx += (-oy / d) * side * 1.6; dy += (ox / d) * side * 1.6; }
        curious = k;
      }
    }

    if (b.group >= 0) {
      let ax = 0, ay = 0, cx = 0, cy = 0, sx = 0, sy = 0, n = 0;
      const sep = L * 1.0, see = L * 8;
      for (let j = 0; j < bodies.length; j++) {
        const o = bodies[j];
        if (o === b || o.group !== b.group) continue;
        const ox = o.x - b.x, oy = o.y - b.y, d = Math.hypot(ox, oy);
        if (d > see) continue;
        n++; ax += Math.cos(o.heading); ay += Math.sin(o.heading); cx += ox; cy += oy;
        if (d < sep && d > 0) { const k = (1 - d / sep) / d; sx -= ox * k; sy -= oy * k; }
      }
      if (n) {
        const an = Math.hypot(ax, ay) || 1, cn = Math.hypot(cx, cy) || 1;
        dx += (ax / an) * 1.1 + (cx / cn) * 1.1 + sx * 1.8;
        dy += (ay / an) * 1.1 + (cy / cn) * 1.1 + sy * 1.8;
      }
    }

    b.fear = Math.max(b.fear - dt * 0.9, fear);
    const turn = sp.turn * (1 + b.fear * 2 + curious * 0.6);
    const want = clamp(wrapPi(Math.atan2(dy, dx) - b.heading) * 3 + wander(b.seed, t) * sp.turn * 0.7, -turn, turn);
    b.omega += (want - b.omega) * Math.min(1, dt * 3);
    b.heading = wrapPi(b.heading + b.omega * dt * Math.min(1, pace));

    const beat = sp.beat * TAU * (1 + b.fear * 1.4);
    b.phase += beat * dt * pace;
    let cruise = sp.speed * L * far * pace * (1 + b.fear * 1.8 + curious * 0.25);
    if (b.kind === 'jellyfish') { const p = Math.max(0, Math.sin(b.phase)); cruise *= 0.25 + 1.6 * p * p; }
    b.speed += (cruise - b.speed) * Math.min(1, dt * (b.fear > 0.1 ? 5 : 2));
    b.x += Math.cos(b.heading) * b.speed * dt;
    b.y += Math.sin(b.heading) * b.speed * dt;

    const pad = L * 1.1;
    if (world.edges === 'wrap' || b.x < -2 * pad || b.x > world.w + 2 * pad || b.y < -2 * pad || b.y > world.h + 2 * pad) {
      if (b.x < -pad) b.x += world.w + 2 * pad; else if (b.x > world.w + pad) b.x -= world.w + 2 * pad;
      if (b.y < -pad) b.y += world.h + 2 * pad; else if (b.y > world.h + pad) b.y -= world.h + 2 * pad;
    }
  }
  world.t += dt;
}

/** Runs the world on in fixed steps, so the same frames give the same ocean whatever the frame rate. */
export function advanceWorld(world: OceanWorld, dt: number, settings: StepSettings) {
  world.acc = Math.min(world.acc + Math.max(0, dt), STEP * 6);
  while (world.acc >= STEP) { stepWorld(world, STEP, settings); world.acc -= STEP; }
}

/* ---------------- Drawing ---------------- */

let gray: string[] | null = null;
const grays = () => gray ??= Array.from({ length: 256 }, (_, i) => `rgb(${i},${i},${i})`);
const SHADES = 64;
/** A colour at a tone: its hue, brightened toward white until its luminance (which the field reads as density) is `tone`. */
export function tint(rgb: number[], tone: number) {
  const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 || 0.001;
  if (tone <= lum) return rgb.map(v => v * tone / lum);
  const k = (tone - lum) / (1 - lum);
  return rgb.map(v => v + (255 - v) * k);
}

interface Pen { pen: CanvasRenderingContext2D; styles: (string[] | null)[]; kind: number; cw: number; ch: number }
const style = (p: Pen, tone: number) => {
  const own = p.styles[p.kind];
  return own ? own[Math.round(clamp(tone) * (SHADES - 1))] : grays()[Math.round(clamp(tone) * 255)];
};

/**
 * Half a body's width at spine point `i`, held to at least `least` cells where the body is thick, so a small or distant body
 * keeps a solid run of tiles rather than fraying into specks; the floor eases off toward the snout and the tail stalk.
 */
function half(p: Pen, kind: OceanKind, length: number, k: number, i: number, least: number) {
  const s = i / SPINE, w = bodyWidth(kind, s) * length * k;
  if (!least) return w;
  const taper = Math.min(1, s / 0.12) * (s < 0.65 ? 1 : 1 - 0.3 * Math.min(1, (s - 0.65) / 0.2));
  return Math.max(w, least * k * Math.min(p.cw, p.ch) * taper);
}

function fillBody(p: Pen, sp: Spine, kind: OceanKind, length: number, k: number, from: number, to: number, tone: number, least = 0) {
  const pen = p.pen;
  pen.fillStyle = style(p, tone);
  pen.beginPath();
  for (let i = from; i <= to; i++) {
    const w = half(p, kind, length, k, i, least);
    if (i === from) pen.moveTo(sp.x[i] + sp.nx[i] * w, sp.y[i] + sp.ny[i] * w); else pen.lineTo(sp.x[i] + sp.nx[i] * w, sp.y[i] + sp.ny[i] * w);
  }
  for (let i = to; i >= from; i--) {
    const w = half(p, kind, length, k, i, least);
    pen.lineTo(sp.x[i] - sp.nx[i] * w, sp.y[i] - sp.ny[i] * w);
  }
  pen.closePath();
  pen.fill();
}

function tri(pen: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
  pen.beginPath(); pen.moveTo(ax, ay); pen.lineTo(bx, by); pen.lineTo(cx, cy); pen.closePath(); pen.fill();
}
function dot(pen: CanvasRenderingContext2D, x: number, y: number, r: number) {
  pen.beginPath(); pen.arc(x, y, Math.max(0.3, r), 0, TAU); pen.fill();
}

/** A pair of fins from spine point `i`: reaching `out` lengths sideways and `back` lengths behind, `root` long at the body. */
function fins(p: Pen, sp: Spine, kind: OceanKind, L: number, i: number, out: number, back: number, root: number, tone: number) {
  const pen = p.pen, fx = sp.ny[i], fy = -sp.nx[i]; // forward, from the left normal
  const w = bodyWidth(kind, i / SPINE) * L * 0.9;
  pen.fillStyle = style(p, tone);
  for (let side = -1; side <= 1; side += 2) {
    const nx = sp.nx[i] * side, ny = sp.ny[i] * side, rx = sp.x[i] + nx * w, ry = sp.y[i] + ny * w;
    tri(pen, rx + fx * root * 0.3 * L, ry + fy * root * 0.3 * L, rx + nx * out * L - fx * back * L, ry + ny * out * L - fy * back * L, rx - fx * root * L, ry - fy * root * L);
  }
}

/** The tail fin: two lobes behind the last spine point, swept by the wave. `upper` and `lower` are lobe lengths. */
function tail(p: Pen, sp: Spine, L: number, reach: number, spread: number, upper: number, lower: number, tone: number) {
  const pen = p.pen, e = SPINE, bx = -sp.ny[e], by = sp.nx[e], nx = sp.nx[e], ny = sp.ny[e];
  const ex = sp.x[e], ey = sp.y[e];
  pen.fillStyle = style(p, tone);
  pen.beginPath();
  pen.moveTo(ex + nx * 0.02 * L, ey + ny * 0.02 * L);
  pen.lineTo(ex + (bx * reach * upper + nx * spread * upper) * L, ey + (by * reach * upper + ny * spread * upper) * L);
  pen.quadraticCurveTo(ex + bx * reach * 0.5 * L, ey + by * reach * 0.5 * L, ex + (bx * reach * lower - nx * spread * lower) * L, ey + (by * reach * lower - ny * spread * lower) * L);
  pen.lineTo(ex - nx * 0.02 * L, ey - ny * 0.02 * L);
  pen.closePath();
  pen.fill();
}

const SHADOW = 0;

function drawFish(p: Pen, sp: Spine, b: OceanBody, L: number, tone: number) {
  const kind = b.kind, small = kind === 'school';
  if (small && L < 8 * p.cw) {
    // A schooling fish a few cells long reads as one faint dash, as it does at sea from above: a cell-sized bar at the tone of
    // the charset's dash, faint enough that it draws the character with next to no tile.
    p.pen.fillStyle = style(p, 0.15);
    p.pen.fillRect(Math.floor(b.x / p.cw) * p.cw, Math.floor(b.y / p.ch) * p.ch, p.cw, p.ch);
    return;
  }
  tail(p, sp, L, small ? 0.2 : 0.22, 0.14, 1, 1, tone * 0.8);
  if (!small) fins(p, sp, kind, L, 5, 0.09, 0.08, 0.05, tone * 0.7);
  fillBody(p, sp, kind, L, 1, 0, SPINE, tone * 0.72);
  fillBody(p, sp, kind, L, 0.55, 1, SPINE - 2, tone * 0.9);
  if (!small) {
    fillBody(p, sp, kind, L, 0.22, 1, SPINE - 4, tone);
    p.pen.fillStyle = style(p, SHADOW);
    const w = bodyWidth(kind, 2 / SPINE) * L * 0.7;
    dot(p.pen, sp.x[2] + sp.nx[2] * w, sp.y[2] + sp.ny[2] * w, 0.025 * L);
    dot(p.pen, sp.x[2] - sp.nx[2] * w, sp.y[2] - sp.ny[2] * w, 0.025 * L);
  }
}

function drawShark(p: Pen, sp: Spine, b: OceanBody, L: number, tone: number) {
  const kind = b.kind, pen = p.pen;
  // Fins and tail thicken to about a cell when the body is small, so they stay a run of tiles rather than specks.
  const small = Math.min(p.cw, p.ch) / L;
  tail(p, sp, L, 0.19, 0.17 + small * 0.5, 1.2, 0.8, tone * 0.55);
  fins(p, sp, kind, L, 5, 0.19, 0.2, 0.1 + small * 0.7, tone * 0.56);
  fins(p, sp, kind, L, 10, 0.07, 0.06, 0.04 + small * 0.4, tone * 0.5);
  // Shaded from the flanks in to the back, so the body reads as a rounded form: darker edges, a light spine.
  fillBody(p, sp, kind, L, 1, 0, SPINE, tone * 0.52, 1.1);
  fillBody(p, sp, kind, L, 0.72, 1, SPINE - 1, tone * 0.66, 0.75);
  fillBody(p, sp, kind, L, 0.46, 1, SPINE - 3, tone * 0.82);
  // The dorsal fin seen from above: a bright blade along the back.
  fillBody(p, sp, kind, L, 0.3, 3, 9, tone * 0.96);
  if (kind === 'hammerhead') {
    const fx = sp.ny[0], fy = -sp.nx[0], nx = sp.nx[0], ny = sp.ny[0], x = sp.x[0] - fx * 0.015 * L, y = sp.y[0] - fy * 0.015 * L;
    const span = 0.2 * L, deep = 0.055 * L;
    pen.fillStyle = style(p, tone * 0.7);
    pen.beginPath();
    pen.moveTo(x + nx * span, y + ny * span);
    pen.quadraticCurveTo(x + fx * 0.04 * L, y + fy * 0.04 * L, x - nx * span, y - ny * span);
    pen.lineTo(x - nx * span * 0.9 - fx * deep, y - ny * span * 0.9 - fy * deep);
    pen.quadraticCurveTo(x - fx * deep * 0.4, y - fy * deep * 0.4, x + nx * span * 0.9 - fx * deep, y + ny * span * 0.9 - fy * deep);
    pen.closePath();
    pen.fill();
    pen.fillStyle = style(p, SHADOW);
    dot(pen, x + nx * span * 0.95 - fx * deep * 0.4, y + ny * span * 0.95 - fy * deep * 0.4, 0.014 * L);
    dot(pen, x - nx * span * 0.95 - fx * deep * 0.4, y - ny * span * 0.95 - fy * deep * 0.4, 0.014 * L);
  } else {
    pen.fillStyle = style(p, SHADOW);
    const w = bodyWidth(kind, 1.4 / SPINE) * L * 0.8, i = 1;
    dot(pen, sp.x[i] + sp.nx[i] * w, sp.y[i] + sp.ny[i] * w, 0.011 * L);
    dot(pen, sp.x[i] - sp.nx[i] * w, sp.y[i] - sp.ny[i] * w, 0.011 * L);
  }
}

/** The manta's frame, kept outside the call so a frame allocates nothing. */
const F = { cx: 0, cy: 0, fx: 1, fy: 0 };
const X = (a: number, s: number) => F.cx + F.fx * a - F.fy * s, Y = (a: number, s: number) => F.cy + F.fy * a + F.fx * s;

function drawManta(p: Pen, sp: Spine, b: OceanBody, L: number, tone: number) {
  const pen = p.pen, c = 4, back = 8;
  // The disc in its own frame: `a` forward from the middle, `s` to the left. The wings beat, so their span breathes and the tips lag.
  let fx = sp.x[2] - sp.x[6], fy = sp.y[2] - sp.y[6];
  const fn = Math.hypot(fx, fy) || 1;
  fx /= fn; fy /= fn;
  F.cx = sp.x[c]; F.cy = sp.y[c]; F.fx = fx; F.fy = fy;
  const S = 0.8 * L * (0.8 + 0.2 * Math.cos(b.phase)), lag = 0.08 * L * Math.sin(b.phase - 0.7);
  pen.strokeStyle = style(p, tone * 0.7);
  pen.lineWidth = Math.max(0.6, 0.022 * L);
  pen.lineCap = 'round'; pen.lineJoin = 'round';
  pen.beginPath();
  pen.moveTo(sp.x[back], sp.y[back]);
  for (let i = back + 1; i <= SPINE; i++) pen.lineTo(sp.x[i], sp.y[i]);
  pen.stroke();
  pen.fillStyle = style(p, tone * 0.72);
  pen.beginPath();
  pen.moveTo(X(0.46 * L, 0.08 * L), Y(0.46 * L, 0.08 * L));
  pen.quadraticCurveTo(X(0.3 * L, 0.6 * S), Y(0.3 * L, 0.6 * S), X(-0.2 * L - lag, S), Y(-0.2 * L - lag, S));
  pen.quadraticCurveTo(X(-0.12 * L, 0.3 * S), Y(-0.12 * L, 0.3 * S), X(-0.44 * L, 0.05 * L), Y(-0.44 * L, 0.05 * L));
  pen.lineTo(X(-0.44 * L, -0.05 * L), Y(-0.44 * L, -0.05 * L));
  pen.quadraticCurveTo(X(-0.12 * L, -0.3 * S), Y(-0.12 * L, -0.3 * S), X(-0.2 * L - lag, -S), Y(-0.2 * L - lag, -S));
  pen.quadraticCurveTo(X(0.3 * L, -0.6 * S), Y(0.3 * L, -0.6 * S), X(0.46 * L, -0.08 * L), Y(0.46 * L, -0.08 * L));
  pen.closePath();
  pen.fill();
  // Cephalic fins, the two lobes either side of the mouth.
  pen.fillStyle = style(p, tone * 0.8);
  for (let side = -1; side <= 1; side += 2) tri(pen, X(0.46 * L, side * 0.12 * L), Y(0.46 * L, side * 0.12 * L), X(0.62 * L, side * 0.08 * L), Y(0.62 * L, side * 0.08 * L), X(0.48 * L, side * 0.03 * L), Y(0.48 * L, side * 0.03 * L));
  fillBody(p, sp, 'manta', L * 1.4, 1, 0, back, tone * 0.86);
  fillBody(p, sp, 'manta', L * 1.4, 0.4, 1, back - 1, tone);
}

function drawJelly(p: Pen, sp: Spine, b: OceanBody, L: number, tone: number) {
  const pen = p.pen, push = Math.max(0, Math.sin(b.phase)), r = 0.5 * L * (1.08 - 0.16 * push);
  const cx = sp.x[0], cy = sp.y[0];
  pen.lineCap = 'round'; pen.lineJoin = 'round';
  // Tentacles trail along the path, each with its own slow wave.
  pen.strokeStyle = style(p, tone * 0.6);
  pen.lineWidth = Math.max(0.5, 0.035 * L);
  for (let j = 0; j < 7; j++) {
    const a = b.heading + Math.PI + (j / 6 - 0.5) * 2.4, rx = cx + Math.cos(a) * r * 0.85, ry = cy + Math.sin(a) * r * 0.85;
    const reach = 0.9 + 0.35 * Math.sin(b.seed + j * 1.7);
    pen.beginPath();
    pen.moveTo(rx, ry);
    for (let i = 2; i <= SPINE; i += 2) {
      const s = i / SPINE, sway = Math.sin(b.phase * 0.8 + j * 0.9 - s * 5) * 0.12 * L * s;
      pen.lineTo(rx + (sp.x[i] - cx) * reach + sp.nx[i] * sway, ry + (sp.y[i] - cy) * reach + sp.ny[i] * sway);
    }
    pen.stroke();
  }
  // Oral arms: shorter, thicker, brighter, from the middle.
  pen.strokeStyle = style(p, tone * 0.7);
  pen.lineWidth = Math.max(0.8, 0.08 * L);
  for (let j = -1; j <= 1; j++) {
    pen.beginPath();
    pen.moveTo(cx, cy);
    for (let i = 2; i <= SPINE / 2; i += 2) {
      const s = i / SPINE, sway = (j * 0.08 + Math.sin(b.phase + j * 2 - s * 6) * 0.06) * L;
      pen.lineTo(cx + (sp.x[i] - cx) * 0.9 + sp.nx[i] * sway, cy + (sp.y[i] - cy) * 0.9 + sp.ny[i] * sway);
    }
    pen.stroke();
  }
  pen.fillStyle = style(p, tone * 0.6);
  dot(pen, cx, cy, r);
  pen.strokeStyle = style(p, tone);
  pen.lineWidth = Math.max(0.6, r * 0.2);
  pen.beginPath(); pen.arc(cx, cy, r * 0.88, 0, TAU); pen.stroke();
  pen.fillStyle = style(p, tone * 0.78);
  for (let k = 0; k < 4; k++) { const a = b.heading + Math.PI / 4 + k * Math.PI / 2; dot(pen, cx + Math.cos(a) * r * 0.32, cy + Math.sin(a) * r * 0.32, r * 0.13); }
}

/** Draws the world into `pen` in its own CSS pixels, far to near. Exported for tests. */
export function drawWorld(pen: CanvasRenderingContext2D, world: OceanWorld, spine: Spine, depth: number, styles: (string[] | null)[] = [], cell: [number, number] = [0, 0]) {
  const p: Pen = DRAW;
  p.pen = pen; p.styles = styles; p.cw = cell[0]; p.ch = cell[1];
  const { bodies, order } = world;
  for (let o = 0; o < order.length; o++) {
    const b = bodies[order[o]];
    if (!b) continue;
    const sp = SPECIES[b.kind], L = bodyLength(world, b, depth), tone = 1 - 0.2 * b.z * depth;
    const bend = clamp(b.speed > 1 ? (b.omega * L) / b.speed * 0.7 : 0, -1.6, 1.6);
    p.kind = OCEAN_KINDS.indexOf(b.kind);
    if (b.kind === 'jellyfish') laySpine(spine, b.x, b.y, b.heading, bend, L * 1.9, b.phase * 0.5, 0.02, 0.6);
    else if (b.kind === 'manta') laySpine(spine, b.x + Math.cos(b.heading) * L * 0.5, b.y + Math.sin(b.heading) * L * 0.5, b.heading, bend, L * 2, b.phase, sp.amp, sp.waves);
    else laySpine(spine, b.x, b.y, b.heading, bend, L, b.phase, sp.amp, sp.waves);
    if (b.kind === 'fish' || b.kind === 'school') drawFish(p, spine, b, L, tone);
    else if (b.kind === 'shark' || b.kind === 'hammerhead') drawShark(p, spine, b, L, tone);
    else if (b.kind === 'manta') drawManta(p, spine, b, L, tone);
    else drawJelly(p, spine, b, L, tone);
  }
}
const DRAW: Pen = { pen: null as unknown as CanvasRenderingContext2D, styles: [], kind: 0, cw: 0, ch: 0 };

/* ---------------- Component ---------------- */

/** Specks for a body's frayed edge, a dash (two steps wide, so a fish straddling cells still reads as one) for a distant fish, then letters and marks that fill a cell more and more. */
export const OCEAN_CHARSET = " .--',:;toxXS%#8@";

const DEFAULT_CREATURES: OceanCreature[] = [
  { kind: 'shark' }, { kind: 'shark', size: 0.7 }, { kind: 'hammerhead', size: 0.85 }, { kind: 'shark', size: 0.5 },
  { kind: 'school', count: 40 }, { kind: 'school', count: 34 }, { kind: 'school', count: 30 }, { kind: 'school', count: 24 }, { kind: 'school', count: 20 },
];
const DEFAULTS = { speed: 1, density: 1, depth: 0.35, interactive: true, ripples: true, edges: 'turn' as const, seed: 1, layer: 'under' as const, accents: true as boolean | number, tint: '#8a96b8' as string | false };
const MAX_SOURCE = 560;
const WARM = 1.5;

/**
 * An ocean drawn as characters: fish, sharks, hammerheads, mantas, jellyfish and schools seen from above, each a procedural body
 * that swims with a travelling wave, steers, wanders and schools, in depth layers that are smaller and fainter the deeper they
 * swim. The cursor scatters small fish and sharks turn to investigate it; a press sends a ripple. It holds a still composition
 * under reduced motion, and pauses off screen and in a hidden tab.
 */
export function ocean(element: HTMLElement, options: OceanOptions = {}): OceanHandle {
  const state = { current: { ...DEFAULTS, ...options } as OceanOptions & typeof DEFAULTS };
  const o = () => state.current;
  const styles = styleKeeper();
  const spine = createSpine();
  const cell: [number, number] = [10, 15];
  const tables: (string[] | null)[] = OCEAN_KINDS.map(() => null);
  const label = o().label ? srOnly(o().label) : null;
  let world = createWorld(0, 0, o().seed, o().edges), built = false, paintedAt = 0, surface: Surface | null = null;
  const step: StepSettings = { speed: 1, depth: 0.7, interactive: true };
  const settings = () => { step.speed = o().speed; step.depth = clamp(o().depth); step.interactive = o().interactive; return step; };
  let lastBuild = { creatures: o().creatures, seed: o().seed, density: o().density };

  const build = (w: number, h: number) => {
    world = createWorld(w, h, o().seed, o().edges);
    for (const c of o().creatures ?? DEFAULT_CREATURES) {
      const base = c.kind === 'school' ? 28 : 1;
      spawn(world, c.kind, (c.count ?? base) * Math.max(0, o().density), c.size ?? 1);
    }
    // A moment of swimming before the first frame, so the still composition and the opening frame are already natural.
    const warm = { speed: 1, depth: clamp(o().depth), interactive: false };
    for (let t = 0; t < WARM; t += STEP) stepWorld(world, STEP, warm);
    built = true;
  };
  const retable = () => {
    const pal = o().palette;
    for (let k = 0; k < OCEAN_KINDS.length; k++) {
      const token = pal?.[OCEAN_KINDS[k]];
      const hex = token ? resolveColor(token, element) : null;
      tables[k] = hex ? Array.from({ length: SHADES }, (_, i) => { const [r, g, b] = tint(hexRgb(hex), i / (SHADES - 1)); return `rgb(${r | 0},${g | 0},${b | 0})`; }) : null;
    }
    if (pal) {
      // Kinds without an entry keep the ink, so in source colour they take its hue too.
      const ink = resolveColor(o().ink ?? '--ascii-ink-strong', element) ?? resolveColor(getComputedStyle(element).color, element);
      for (let k = 0; k < OCEAN_KINDS.length; k++) {
        if (!tables[k] && ink) tables[k] = Array.from({ length: SHADES }, (_, i) => { const [r, g, b] = tint(hexRgb(ink), i / (SHADES - 1)); return `rgb(${r | 0},${g | 0},${b | 0})`; });
      }
    }
  };
  const look = (): GlyphFieldOptions => {
    const bg = o().background;
    const background = bg && bg !== 'transparent' ? resolveColor(bg, element) ?? 'transparent' : 'transparent';
    const a = o().accents;
    return {
      mark: 'inlay', charset: OCEAN_CHARSET, cellSize: 15, cellAspect: 0.66, glyphScale: 0.7, fontWeight: 500, contrast: 1, background,
      color: o().palette ? 'source' : 'ink', saturation: 1, accents: a === true ? 0.07 : typeof a === 'number' ? a : 0, shuffle: 2, sample: 'point', ...o().look,
    };
  };
  retable();

  surface = mountSurface({
    host: element,
    kit: state,
    look,
    layer: o().layer,
    ink: () => {
      const ink = o().ink ?? '--ascii-ink-strong', tint = o().tint;
      if (!tint) return ink;
      const a = resolveColor(ink, element), b = resolveColor(tint, element);
      return a && b ? mixHex(a, b, 0.4) : ink;
    },
    reducedMotion: () => o().reducedMotion,
    resolution: (w, h) => { const k = Math.min(0.6, MAX_SOURCE / Math.max(w, h)); return [Math.max(8, Math.round(w * k)), Math.max(8, Math.round(h * k))]; },
    onFail: () => { surface = null; styles.restore(); },
    onTheme: () => { retable(); if (o().background && o().background !== 'transparent') surface?.refresh(); },
    paint: ({ pen, width, height, w, h, now, still }) => {
      if (!built) build(w, h); else resizeWorld(world, w, h);
      const dt = paintedAt ? Math.min(0.1, Math.max(0, now - paintedAt) / 1000) : 0;
      paintedAt = now;
      if (!still) advanceWorld(world, dt, settings());
      pen.setTransform(width / w, 0, 0, height / h, 0, 0);
      // The field's grid in CSS pixels, whole device pixels a cell as it lays them out, so a one-cell fish lands on one cell.
      const lk = look(), dpr = Math.min(2, globalThis.devicePixelRatio || 1), ch = Math.max(2, Math.round((lk.cellSize ?? 15) * dpr));
      cell[0] = Math.max(2, Math.round(ch * (lk.cellAspect ?? 0.66))) / dpr; cell[1] = ch / dpr;
      drawWorld(pen, world, spine, clamp(o().depth), tables, cell);
      return !still && o().speed > 0;
    },
  });

  const at = (event: PointerEvent) => {
    const rect = element.getBoundingClientRect();
    world.pointer.x = event.clientX - rect.left; world.pointer.y = event.clientY - rect.top;
  };
  const move = (event: PointerEvent) => {
    if (!o().interactive) return;
    at(event); world.pointer.on = true; world.pointer.at = world.t;
    surface?.kick();
  };
  const leave = () => { world.pointer.on = false; };
  const down = (event: PointerEvent) => {
    if (!o().interactive || !o().ripples || event.button !== 0 || !surface) return;
    at(event);
    world.burst.x = world.pointer.x; world.burst.y = world.pointer.y; world.burst.at = world.t;
    surface.field.pulse({ x: world.burst.x, y: world.burst.y, strength: 0.1 });
    surface.kick();
  };
  if (surface) {
    if (label) element.appendChild(label);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerleave', leave);
    element.addEventListener('pointerdown', down);
  }

  const total = () => world.bodies.length;
  return handle(() => surface, state, next => {
    if (label) label.textContent = next.label ?? '';
    world.edges = next.edges;
    if (built && (lastBuild.creatures !== next.creatures || lastBuild.seed !== next.seed || lastBuild.density !== next.density)) build(world.w, world.h);
    lastBuild = { creatures: next.creatures, seed: next.seed, density: next.density };
    retable();
    surface?.refresh();
  }, {
    add(kind: OceanKind, opts: { size?: number; count?: number } = {}) {
      if (!built) build(world.w || 800, world.h || 450);
      const n = spawn(world, kind, opts.count ?? (kind === 'school' ? 28 : 1), opts.size ?? 1);
      surface?.kick();
      return n;
    },
    remove(kind?: OceanKind) {
      if (!built) build(world.w || 800, world.h || 450);
      const gone = despawn(world, kind);
      surface?.kick();
      return gone;
    },
    get count() { if (!built) build(world.w || 800, world.h || 450); return total(); },
  }, () => {
    element.removeEventListener('pointermove', move);
    element.removeEventListener('pointerleave', leave);
    element.removeEventListener('pointerdown', down);
    label?.remove();
    styles.restore();
  }) as OceanHandle;
}
