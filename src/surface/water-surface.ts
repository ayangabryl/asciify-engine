import { RippleField } from './ripple-field';
import { AfterimageField, isAfterimageMode } from './afterimage-field';
import { surfaceEdgeWeight } from './surface-edge';
import { ContourField } from './contour-field';
import { InkTrail, invertTrailTone } from './ink-trail';
import { resolveSurfaceHover, type DeprecatedSurfaceHover, type SurfaceHover } from './hover-catalog';
import type { PointerField } from './fluid-field';
import { CursorField, isCursorMode } from './cursor-field';
import type { HoverGuide } from './hover-guide';

export type HeroHover = SurfaceHover | 'light' | 'scan';
/** Any accepted hover input, including retired IDs that now play their closest current effect. */
export type HoverInput = HeroHover | DeprecatedSurfaceHover;
const QUIET_START = .2, QUIET_RAMP = .6, VELOCITY_GAIN = 3, HEIGHT_LEAK = 7;
const displacementStrength = (mode: HeroHover, amount: number) =>
  mode === 'water' ? 30 * amount / .55 : mode === 'silk' ? 28 * amount : mode === 'vortex' ? 38 * amount :
  ['magnetic','scatter','elastic','lens','smudge'].includes(mode) ? 32 * amount :
  // Cursor hovers store UV displacement over .16, so they scale with the artwork rather than in fixed pixels.
  ['loupe','repel','tilt','haze'].includes(mode) ? .16 * amount / .55 : 0;
/** Maps the 0..1 `decay` option to a settle-speed multiplier: .5 is the tuned default, 0 snaps back, 1 lingers. */
export const hoverSettle = (decay = .5) => Math.pow(2, (.5 - (Number.isFinite(decay) ? Math.max(0, Math.min(1, decay)) : .5)) * 2.4);

export { surfaceEdgeWeight } from './surface-edge';

/** The CPU renderers' tone response to a sampled hover energy (sample()[2] / 3). */
export function hoverTone(effect: HeroHover, tone: number, energy: number, invert = false) {
  if (!energy) return tone;
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  switch (effect) {
    case 'trail': case 'contour': return invertTrailTone(tone, energy);
    case 'etch': case 'ripple': return clamp(tone + energy * .35);
    case 'dissolve': { const gain = Math.max(0, 1 + energy); return invert ? 1 - (1 - tone) * gain : tone * gain; }
    case 'bleed': return clamp(tone + energy * (invert ? -.6 : .6));
    case 'loupe': return clamp(tone + energy * .3);
    case 'haze': return clamp(tone + energy * .5);
    default: return tone;
  }
}
/** Hovers that write character tone, and so can draw marks onto an empty ground. */
export const marksGround = (effect: HeroHover) => ['trail','contour','etch','ripple','bleed','haze'].includes(effect);

export interface SurfaceRefraction {
  width: number;
  height: number;
  pixels: Uint8Array;
  /** Maximum displacement in CSS pixels, independent of viewport size. */
  strength: number;
  mode: HeroHover;
  /** Preserve outer glyph rows and attenuate border displacement. Default false. */
  edgeSafe?: boolean;
  /** Normalized focus and settled intensity; lighting never modifies geometry. */
  focus: [number, number, number, number];
  /** Strength is a fraction of the scene rather than CSS pixels. */
  relative?: boolean;
}

/** Damped shallow-water height field. Pointer travel excites a surface, not a translation. */
export class WaterSurface implements PointerField {
  readonly columns: number;
  readonly rows: number;
  readonly refraction: SurfaceRefraction;
  private readonly trail: InkTrail;
  private readonly contour: ContourField;
  private readonly afterimage: AfterimageField;
  private ripple: RippleField | null = null;
  private cursor: CursorField | null = null;
  private settle = 1;
  private readonly waterPixels: Uint8Array;
  private readonly heights: Float32Array;
  private readonly velocity: Float32Array;
  private readonly next: Float32Array;
  private readonly normals: Float32Array;
  private readonly edgeMask: Float32Array;
  private mode: HeroHover = 'water';
  private amount = .55;
  private radius = .2;
  private lensX = .5;
  private lensY = .5;
  private lensStrength = 0;
  private previous: { x: number; y: number } | null = null;
  private energy = 0;
  private pending = false;
  private remainder = 0;
  private quiet = 0;
  private readonly xScale: number;
  private readonly yScale: number;

  constructor(aspect = 1) {
    aspect = Math.max(.25, Math.min(4, aspect));
    this.columns = Math.round(aspect >= 1 ? 128 : 128 * aspect);
    this.rows = Math.round(aspect >= 1 ? 128 / aspect : 128);
    this.xScale = Math.max(1, aspect); this.yScale = Math.max(1, 1 / aspect);
    this.heights = new Float32Array(this.columns * this.rows);
    this.velocity = new Float32Array(this.heights.length);
    this.next = new Float32Array(this.heights.length);
    this.normals = new Float32Array(this.heights.length * 2);
    this.edgeMask = new Float32Array(this.heights.length);
    for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.columns; x++) {
      this.edgeMask[y * this.columns + x] = surfaceEdgeWeight(x / (this.columns - 1), y / (this.rows - 1), aspect);
    }
    this.refraction = { width: this.columns, height: this.rows, pixels: new Uint8Array(this.heights.length * 4), strength: 30, mode: 'water', focus: [.5, .5, 0, .2] };
    this.waterPixels = this.refraction.pixels;
    this.trail = new InkTrail(this.columns, this.rows);
    this.contour = new ContourField(this.columns, this.rows);
    this.afterimage = new AfterimageField(this.columns,this.rows);
    this.clear();
  }
  get invertsDensity() { return this.mode === 'trail'; }
  get densityTrail() { return ['trail','contour','dissolve','etch','ripple','bleed'].includes(this.mode); }
  get hasRefraction() { return this.active || this.lensStrength > .00015; }
  /** The current effect, after retired IDs are mapped. */
  get effect() { return this.mode; }
  /** Something is visible, though it may be at rest (a loupe held still). */
  get engaged() { return isCursorMode(this.mode) ? this.cursor!.engaged : this.active; }
  /** Spotlight centre, presence and radius while Reveal is engaged. */
  get spotlight() { return this.mode === 'reveal' && this.cursor ? this.cursor.focus : null; }
  /** Changes whenever a resting cursor hover would draw differently. */
  get signature() { return isCursorMode(this.mode) && this.cursor!.engaged ? this.cursor!.focus.map(n => n.toFixed(4)).join(',') : ''; }
  /** Subject coverage and depth, for scoped and depth-aware hovers. */
  setGuide(guide: HoverGuide | null) { if (this.cursor) this.cursor.guide = guide; this.guide = guide; }
  private guide: HoverGuide | null = null;
  get active() { if(isCursorMode(this.mode))return this.cursor!.active; if(this.mode==='ripple')return this.ripple?.active??false; if(isAfterimageMode(this.mode))return this.afterimage.active; if(this.mode==='contour') return this.contour.active; if (this.mode === 'trail') return this.trail.active; return this.pending || this.energy > .00015; }
  setMode(input: HoverInput) {
    const mode: HeroHover = input === 'light' || input === 'scan' ? input : resolveSurfaceHover(input) ?? 'none';
    if (mode === this.mode) return;
    this.clear(); this.mode = mode; this.refraction.mode = mode;
    if(isAfterimageMode(mode))this.afterimage.setMode(mode);
    if(mode==='ripple'&&!this.ripple)this.ripple=new RippleField(this.columns,this.rows);
    if(isCursorMode(mode)){ this.cursor??=new CursorField(this.columns,this.rows); this.cursor.guide=this.guide; this.cursor.setMode(mode); }
    this.refraction.pixels = isCursorMode(mode) ? this.cursor!.pixels : mode === 'ripple' ? this.ripple!.pixels : mode === 'trail' ? this.trail.pixels : mode === 'contour' ? this.contour.pixels : isAfterimageMode(mode) ? this.afterimage.pixels : this.waterPixels;
    this.refraction.strength = displacementStrength(mode, this.amount);
    this.refraction.relative = isCursorMode(mode);
  }
  /** `decay` (0..1, default .5) sets how long the effect lingers after the pointer moves on or leaves. */
  configure(mode: HoverInput, amount = .55, radius = .2, edgeSafe = false, decay = .5) {
    this.setMode(mode);
    this.settle = hoverSettle(decay);
    this.refraction.edgeSafe = edgeSafe;
    this.afterimage.edgeSafe = edgeSafe;
    if(this.ripple)this.ripple.edgeSafe=edgeSafe;
    this.amount = Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : .55;
    this.radius = Number.isFinite(radius) ? Math.max(.1, Math.min(1, radius)) : .2;
    if(this.cursor){ this.cursor.edgeSafe=edgeSafe; this.cursor.settle=this.settle; this.cursor.setRadius(this.radius); }
    this.refraction.strength = displacementStrength(this.mode, this.amount);
    this.refraction.focus[2] = this.densityTrail ? this.amount : this.lensStrength * this.amount;
    this.refraction.focus[3] = this.radius;
    if(this.mode==='reveal'||this.mode==='repel') this.syncSpot();
  }
  private syncSpot() { const f=this.cursor!.focus; this.refraction.focus=[f[0],f[1],f[2]*(this.mode==='repel'?Math.min(1,this.amount/.55):this.amount),f[3]]; }
  move(x: number, y: number, time?: number) {
    if (this.mode === 'none' || this.amount === 0) return;
    if (!Number.isFinite(x + y)) return;
    x = Math.max(0, Math.min(1, x)); y = Math.max(0, Math.min(1, y));
    if(isCursorMode(this.mode)){this.cursor!.move(x,y,time);return;}
    if(this.mode==='ripple'){this.ripple!.move(x,y,this.radius,time);return;}
    if(isAfterimageMode(this.mode)){this.afterimage.move(x,y,this.radius);return;}
    if (this.mode === 'contour') { this.contour.move(x,y,this.radius); return; }
    if (this.mode === 'trail') { this.trail.move(x, y, this.radius, time); return; }
    if (this.mode !== 'water') {
      if (!this.previous && this.lensStrength < .001) { this.lensX = x; this.lensY = y; }
      this.previous = { x, y }; this.pending = true; return;
    }
    if (!this.previous) { this.previous = { x, y }; return; }
    const from = this.previous;
    this.previous = { x, y };
    const dx = (x - from.x) * this.xScale, dy = (y - from.y) * this.yScale;
    const travel = Math.hypot(dx, dy);
    if (travel < .00001) return;
    // Segment deposition is independent of browser event frequency. A stroke
    // depresses the surface; its slopes spread sideways and oscillate after exit.
    const radius = .035 + this.radius * .1, margin = radius * 3;
    const count = Math.min(192, Math.max(1, Math.ceil(travel / (radius * .5))));
    const impulse = Math.min(travel, 1) * 95 / count;
    // Work only inside each splat's bounds, even for a screen-wide coalesced event.
    for (let s = 0; s < count; s++) {
      const along = (s + .5) / count;
      const cx = from.x + (x - from.x) * along, cy = from.y + (y - from.y) * along;
      const left = Math.max(1, Math.floor((cx - margin / this.xScale) * (this.columns - 1)));
      const right = Math.min(this.columns - 2, Math.ceil((cx + margin / this.xScale) * (this.columns - 1)));
      const top = Math.max(1, Math.floor((cy - margin / this.yScale) * (this.rows - 1)));
      const bottom = Math.min(this.rows - 2, Math.ceil((cy + margin / this.yScale) * (this.rows - 1)));
      for (let gy = top; gy <= bottom; gy++) for (let gx = left; gx <= right; gx++) {
        const rx = (gx / (this.columns - 1) - cx) * this.xScale;
        const ry = (gy / (this.rows - 1) - cy) * this.yScale;
        const force = Math.exp(-(rx * rx + ry * ry) / (radius * radius)) * impulse;
        const i = gy * this.columns + gx;
        this.velocity[i] = Math.max(-12, this.velocity[i] - force);
      }
    }
    this.pending = true; this.quiet = 0;
  }
  leave() { this.cursor?.leave(); this.ripple?.leave(); this.afterimage.leave(); this.contour.leave(); this.trail.leave(); this.previous = null; if (this.mode !== 'water' && this.lensStrength) this.pending = true; }
  clear() {
    this.trail.clear(); this.contour.clear(); this.afterimage.clear(); this.ripple?.clear(); this.cursor?.clear();
    this.heights.fill(0); this.velocity.fill(0); this.next.fill(0); this.normals.fill(0);
    this.refraction.focus[2] = 0;
    this.previous = null; this.lensStrength = 0; this.energy = 0; this.pending = false; this.remainder = 0; this.quiet = 0;
    for (let i = 0; i < this.waterPixels.length; i += 4) {
      this.waterPixels[i] = this.waterPixels[i + 2] = 128;
      this.waterPixels[i + 1] = this.waterPixels[i + 3] = 0;
    }
  }
  step(seconds: number) {
    if (!this.active || !Number.isFinite(seconds)) return;
    if(isCursorMode(this.mode)){this.cursor!.step(seconds);if(this.mode==='reveal'||this.mode==='repel')this.syncSpot();return;}
    // Stroke memories decay on their own clocks; `decay` stretches or shortens that clock.
    seconds*=this.settle;
    if(this.mode==='ripple'){this.ripple!.step(seconds);return;}
    if(isAfterimageMode(this.mode)){this.afterimage.step(seconds);return;}
    if (this.mode === 'contour') { this.contour.step(seconds); return; }
    if (this.mode === 'trail') { this.trail.step(seconds); return; }
    if (this.mode !== 'water') { this.stepLight(Math.max(0, Math.min(.05, seconds))); return; }
    this.remainder += Math.max(0, Math.min(.05, seconds));
    const dt = 1 / 120;
    const waveSpeed = Math.min(this.columns, this.rows) * .30;
    while (this.remainder + 1e-8 >= dt) {
      this.remainder -= dt;
      // Damping firms up once the stroke stops, so the wake reads as one clear settle rather than a long low wobble.
      this.quiet += dt;
      const t = Math.max(0, Math.min(1, (this.quiet - QUIET_START) / QUIET_RAMP)), firm = t * t * (3 - 2 * t);
      const damping = Math.exp(-(3.8 + firm * VELOCITY_GAIN) * dt), leak = Math.exp(-firm * HEIGHT_LEAK * dt);
      let peak = 0;
      for (let y = 1; y < this.rows - 1; y++) for (let x = 1; x < this.columns - 1; x++) {
        const i = y * this.columns + x, h = this.heights[i];
        const laplacian = this.heights[i - 1] + this.heights[i + 1] + this.heights[i - this.columns] + this.heights[i + this.columns] - 4 * h;
        const edge = Math.min(x, y, this.columns - 1 - x, this.rows - 1 - y);
        const absorption = edge < 5 ? .88 + edge * .024 : 1;
        const speed = (this.velocity[i] + (laplacian * waveSpeed * waveSpeed - h * 8) * dt) * damping * absorption;
        this.velocity[i] = speed;
        this.next[i] = (h + speed * dt) * absorption * leak;
        peak = Math.max(peak, Math.abs(this.next[i]), Math.abs(speed) * .1);
      }
      this.heights.set(this.next); this.energy = peak; this.pending = false;
    }
    if (!this.active) { this.clear(); return; }
    const scale = Math.min(this.columns, this.rows) * .18;
    for (let y = 0; y < this.rows; y++) for (let x = 0; x < this.columns; x++) {
      const i = y * this.columns + x;
      const nx = (this.heights[y * this.columns + Math.max(0, x - 1)] - this.heights[y * this.columns + Math.min(this.columns - 1, x + 1)]) * scale;
      const ny = (this.heights[Math.max(0, y - 1) * this.columns + x] - this.heights[Math.min(this.rows - 1, y + 1) * this.columns + x]) * scale;
      const a = Math.tanh(nx) * (this.refraction.edgeSafe ? this.edgeMask[i] : 1), b = Math.tanh(ny) * (this.refraction.edgeSafe ? this.edgeMask[i] : 1);
      this.normals[i * 2] = a; this.normals[i * 2 + 1] = b;
      const ex = Math.round(a * 32767 + 32768), ey = Math.round(b * 32767 + 32768);
      this.refraction.pixels[i * 4] = ex >>> 8; this.refraction.pixels[i * 4 + 1] = ex & 255;
      this.refraction.pixels[i * 4 + 2] = ey >>> 8; this.refraction.pixels[i * 4 + 3] = ey & 255;
    }
  }
  private stepLight(dt: number) {
    const target = this.previous;
    const follow = 1 - Math.exp(-30 * dt), fade = 1 - Math.exp(-12 * dt);
    if (target) { this.lensX += (target.x - this.lensX) * follow; this.lensY += (target.y - this.lensY) * follow; }
    this.lensStrength += ((target ? 1 : 0) - this.lensStrength) * fade;
    this.energy = Math.max(target ? Math.abs(target.x - this.lensX) + Math.abs(target.y - this.lensY) : 0, Math.abs((target ? 1 : 0) - this.lensStrength));
    this.pending = false;
    if (!target && !this.active) { this.clear(); return; }
    this.refraction.focus = [this.lensX, this.lensY, this.lensStrength * this.amount, this.radius];
  }
  sample(x: number, y: number, out: number[]) {
    if(isCursorMode(this.mode)){this.cursor!.sample(x,y,out);out[0]*=this.amount/.55;out[1]*=this.amount/.55;out[2]*=this.mode==='reveal'||this.mode==='repel'?Math.min(1,this.amount/.55):this.amount*3;return;}
    if(this.mode==='ripple'){this.ripple!.sample(x,y,out);out[2]*=this.amount;return;}
    if(isAfterimageMode(this.mode)){this.afterimage.sample(x,y,out);out[0]*=this.amount;out[1]*=this.amount;out[2]*=this.amount;return;}
    if(this.mode==='contour'){out[0]=out[1]=0;out[2]=this.contour.sample(x,y)*this.amount*3;return;}
    if (this.mode === 'trail') { out[0]=out[1]=0; out[2]=this.trail.sample(x,y)*this.amount*3; return; }
    const gx = Math.max(0, Math.min(this.columns - 1.001, x * (this.columns - 1)));
    const gy = Math.max(0, Math.min(this.rows - 1.001, y * (this.rows - 1)));
    const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
    const a = (iy * this.columns + ix) * 2, b = a + this.columns * 2;
    for (let c = 0; c < 2; c++) out[c] = ((this.normals[a + c] * (1 - fx) + this.normals[a + 2 + c] * fx) * (1 - fy) + (this.normals[b + c] * (1 - fx) + this.normals[b + 2 + c] * fx) * fy) * .08;
    out[0] *= this.amount / .55; out[1] *= this.amount / .55;
    out[2] = this.mode === 'light' || this.mode === 'scan' ? surfaceLight(x, y, this.refraction, this.xScale / this.yScale) : 0;
  }
}

/** CPU fallback counterpart of SURFACE_LIGHT_GLSL. Coordinates stay unchanged. */
export function surfaceLight(x: number, y: number, surface: SurfaceRefraction, aspect: number) {
  const [cx, cy, amount, radius] = surface.focus;
  const dx = (x - cx) * Math.max(1, aspect) / radius;
  const dy = (y - cy) * Math.max(1, 1 / aspect) / radius;
  if (surface.mode === 'light') return Math.exp(-3 * (dx * dx + dy * dy)) * amount;
  if (surface.mode === 'scan') return (Math.exp(-dx * dx * 110) * 1.3 - Math.exp(-dx * dx * 12) * .3) * Math.exp(-dy * dy * 1.8) * amount;
  return 0;
}

/** Shared by the hero glyph shader and the playground's cached-surface shader. */
export const SURFACE_LIGHT_GLSL = `
uniform float hoverMode;
uniform vec4 hoverFocus;
float surfaceLight(vec2 uv, vec2 size) {
  vec2 delta = (uv - hoverFocus.xy) * size / min(size.x, size.y) / hoverFocus.w;
  float light = exp(-3.0 * dot(delta, delta));
  if (hoverMode > 2.5) light = -smoothstep(.85, .35, length(delta));
  else if (hoverMode > 1.5) light = (exp(-delta.x * delta.x * 110.0) * 1.3 - exp(-delta.x * delta.x * 12.0) * .3) * exp(-delta.y * delta.y * 1.8);
  return hoverMode > .5 ? light * hoverFocus.z : 0.0;
}
vec3 illuminate(vec3 ink, float light) {
  return mix(ink, vec3(1.0), max(0.0, light) * .82) * (1.0 + min(0.0, light));
}
`;
