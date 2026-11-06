import { withNormals } from './normals';
import type { AsciiModel, ModelTexture } from './types';

/*
 * A 3D model drawn into RGBA pixels on the CPU, in any runtime (Node, workers, edge, the browser), for the headless converter
 * to turn into characters. Triangles are rasterised into a visibility buffer (which triangle each pixel sees, and where on
 * it), then every pixel is lit once: a key light, a fill, a rim that brings the outline out of a dark ground, a highlight,
 * the model's colours and textures, and dark lines where one surface passes in front of another, so the converter's shape
 * matching finds the edges. Point clouds are drawn as discs.
 */

export interface ModelView {
  /** Turn about the model's up axis, degrees. Default 30. */
  yaw?: number;
  /** Tilt: positive looks down on the model from above, degrees. Default 20. */
  pitch?: number;
  /** Roll about the line of sight, degrees. Default 0. */
  roll?: number;
  /** Vertical field of view, degrees; 0 draws it orthographic. Default 30. */
  fov?: number;
  /** 1 frames the whole model; 2 is twice as close. Default 1. */
  zoom?: number;
  /** Which axis is up in the file. Default: the model's own (`model.up`). */
  up?: 'y' | 'z';
}

export interface ModelLook {
  /** 'lit' (default); 'toon', lit in flat bands; 'normals', coloured by facing; 'depth', near is light. */
  shading?: 'lit' | 'toon' | 'normals' | 'depth';
  /** One colour for the whole model (a CSS hex colour), in place of its own colours and textures. */
  paint?: string | null;
  /** Where the key light comes from, in view space (x right, y up, z toward the viewer). Default [-0.7, 0.45, 0.55]. */
  light?: [number, number, number];
  /** Light everywhere, 0 to 1. Default 0.04, so the shadowed side reads dark. */
  ambient?: number;
  /** Light along the outline, against the background, 0 to 1. Default 0.3. */
  rim?: number;
  /** Highlights, 0 to 1. Default 0.3. */
  specular?: number;
  /** Dark lines where a surface passes in front of another and along sharp creases, 0 to 1. Default 0.65. */
  outline?: number;
  /** Behind the model: a CSS hex colour, or null for transparent (default). */
  background?: string | null;
  /** Overall brightness. Default 1. */
  exposure?: number;
}

export interface ModelRenderOptions extends ModelView, ModelLook {
  /** Size in pixels. */
  width: number;
  height: number;
  /** Drawn this many times larger each way and averaged down, for smoother edges. Default 1. */
  samples?: number;
  /** A point cloud's points, in pixels across. Default: from how densely the points cover the model. */
  pointSize?: number;
  /** Height over width of one pixel, to draw straight into a grid's cells (6 × 10 pixels a 1 × 2 cell is 1.2). Default 1. */
  pixelAspect?: number;
}

/** RGBA pixels, sRGB, straight alpha: an `AsciiPixels` for `toAsciiGrid` and the other converters. */
export interface RenderedModel {
  data: Uint8Array;
  width: number;
  height: number;
  channels: 4;
}

interface Prepared {
  center: [number, number, number];
  radius: number;
  /** Material per triangle. */
  triangleMaterial: Uint16Array;
  /** Points' spacing as a fraction of the radius, for point clouds. */
  spacing: number;
}
const preparedModels = new WeakMap<AsciiModel, Prepared>();

function prepare(model: AsciiModel): Prepared {
  const known = preparedModels.get(model);
  if (known) return known;
  const b = model.bounds, p = model.positions;
  const center: [number, number, number] = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
  let r2 = 0;
  for (let i = 0; i < p.length; i += 3) {
    const dx = p[i] - center[0], dy = p[i + 1] - center[1], dz = p[i + 2] - center[2], d = dx * dx + dy * dy + dz * dz;
    if (d > r2) r2 = d;
  }
  const radius = Math.sqrt(r2) || 1;
  const triangles = model.indices.length / 3, triangleMaterial = new Uint16Array(triangles);
  for (const group of model.groups) triangleMaterial.fill(Math.min(group.material, model.materials.length - 1), group.start / 3, (group.start + group.count) / 3);
  const points = p.length / 3;
  // Points spread over a sphere's worth of surface: the spacing that covers it.
  const spacing = points ? Math.sqrt((4 * Math.PI) / points) * 1.1 : 0;
  const ready = { center, radius, triangleMaterial, spacing };
  preparedModels.set(model, ready);
  return ready;
}

// sRGB to linear for 8-bit values, and linear to sRGB through a fine table.
const TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
const SRGB_STEPS = 4096, TO_SRGB = new Uint8Array(SRGB_STEPS + 1);
for (let i = 0; i <= SRGB_STEPS; i++) { const c = i / SRGB_STEPS; TO_SRGB[i] = Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)); }
const encode = (v: number) => TO_SRGB[v <= 0 ? 0 : v >= 1 ? SRGB_STEPS : (v * SRGB_STEPS + 0.5) | 0];

/** A CSS hex colour (#rgb, #rrggbb) as linear r, g, b; null if it is not one. */
export function linearColor(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const s = m[1].length === 3 ? m[1].replace(/./g, ch => ch + ch) : m[1];
  return [0, 2, 4].map(i => TO_LINEAR[parseInt(s.slice(i, i + 2), 16)]) as [number, number, number];
}

const RAD = Math.PI / 180;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The view's rotation (model to view space, after centring), row by row. */
function rotation(view: ModelView, up: 'y' | 'z') {
  const yaw = (view.yaw ?? 30) * RAD, pitch = (view.pitch ?? 20) * RAD, roll = (view.roll ?? 0) * RAD;
  // z-up files turned y-up: (x, y, z) -> (x, z, -y), so their front (-y) faces the viewer.
  let m = up === 'z' ? [1, 0, 0, 0, 0, 1, 0, -1, 0] : [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const mul = (a: number[], b: number[]) => [0, 1, 2].flatMap(r => [0, 1, 2].map(c => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]));
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  m = mul([cy, 0, sy, 0, 1, 0, -sy, 0, cy], m);
  m = mul([1, 0, 0, 0, cp, -sp, 0, sp, cp], m);
  m = mul([cr, -sr, 0, sr, cr, 0, 0, 0, 1], m);
  return m;
}

/** Buffers kept between frames of the same size, so an animation allocates once. */
interface Buffers {
  size: number;
  tri: Int32Array; depth: Float32Array; b1: Float32Array; b2: Float32Array;
  nx: Float32Array; ny: Float32Array; nz: Float32Array; rgb: Float32Array; edge: Float32Array;
}
let shared: Buffers | null = null;
function buffers(size: number): Buffers {
  if (shared && shared.size === size) return shared;
  shared = {
    size, tri: new Int32Array(size), depth: new Float32Array(size), b1: new Float32Array(size), b2: new Float32Array(size),
    nx: new Float32Array(size), ny: new Float32Array(size), nz: new Float32Array(size), rgb: new Float32Array(size * 3), edge: new Float32Array(size),
  };
  return shared;
}
let vertexScratch: Float32Array | null = null, normalScratchArray: Float32Array | null = null;
const scratch = (length: number) => (vertexScratch && vertexScratch.length >= length ? vertexScratch : (vertexScratch = new Float32Array(length)));
const normalScratch = (length: number) => (normalScratchArray && normalScratchArray.length >= length ? normalScratchArray : (normalScratchArray = new Float32Array(length)));

// A texel index along one axis, wrapped as the texture says (0 repeat, 1 clamp, 2 mirror).
function wrapIndex(k: number, n: number, mode: number) {
  if (mode === 1) return k < 0 ? 0 : k >= n ? n - 1 : k;
  if (mode === 2) { const p = n * 2, m = ((k % p) + p) % p; return m < n ? m : p - 1 - m; }
  return ((k % n) + n) % n;
}

/** The texture's colour at u, v: bilinear, sRGB texels to linear. */
function sampleTexture(texture: ModelTexture, u: number, v: number, out: number[]) {
  const image = texture.image!;
  const w = image.width, h = image.height, data = image.data;
  const mode = texture.wrap === 'clamp' ? 1 : texture.wrap === 'mirror' ? 2 : 0;
  const x = u * w - 0.5, y = v * h - 0.5, fx0 = Math.floor(x), fy0 = Math.floor(y);
  const fx = x - fx0, fy = y - fy0;
  const x0 = wrapIndex(fx0, w, mode), x1 = wrapIndex(fx0 + 1, w, mode), y0 = wrapIndex(fy0, h, mode), y1 = wrapIndex(fy0 + 1, h, mode);
  const a = (y0 * w + x0) * 4, b = (y0 * w + x1) * 4, c = (y1 * w + x0) * 4, d = (y1 * w + x1) * 4;
  const wa = (1 - fx) * (1 - fy), wb = fx * (1 - fy), wc = (1 - fx) * fy, wd = fx * fy;
  for (let k = 0; k < 3; k++) out[k] = TO_LINEAR[data[a + k]] * wa + TO_LINEAR[data[b + k]] * wb + TO_LINEAR[data[c + k]] * wc + TO_LINEAR[data[d + k]] * wd;
  out[3] = (data[a + 3] * wa + data[b + 3] * wb + data[c + 3] * wc + data[d + 3] * wd) / 255;
}

/** Triangles into the visibility buffer: for each pixel, the nearest triangle and where on it (perspective-correct). */
function rasterTriangles(indices: Uint32Array, vs: Float32Array, W: number, H: number, tri: Int32Array, depth: Float32Array, b1: Float32Array, b2: Float32Array) {
  const triangles = indices.length / 3;
  for (let t = 0; t < triangles; t++) {
    const i0 = indices[t * 3], i1 = indices[t * 3 + 1], i2 = indices[t * 3 + 2];
    const o0 = i0 * 7, o1 = i1 * 7, o2 = i2 * 7;
    const w0 = vs[o0 + 5], w1 = vs[o1 + 5], w2 = vs[o2 + 5];
    // Behind the camera (only when zoomed past the model's own bounds).
    if (w0 <= 0 || w1 <= 0 || w2 <= 0) continue;
    const x0 = vs[o0 + 3], y0 = vs[o0 + 4];
    let x1 = vs[o1 + 3], y1 = vs[o1 + 4], x2 = vs[o2 + 3], y2 = vs[o2 + 4], z1 = w1, z2 = w2;
    let area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (!(Math.abs(area) > 1e-9)) continue;
    // Wound one way, so the inside test is one sign; remember which corner is which.
    const swapped = area < 0;
    if (swapped) {
      let k = x1; x1 = x2; x2 = k;
      k = y1; y1 = y2; y2 = k;
      k = z1; z1 = z2; z2 = k;
      area = -area;
    }
    const minX = Math.max(0, Math.ceil(Math.min(x0, x1, x2) - 0.5)), maxX = Math.min(W - 1, Math.floor(Math.max(x0, x1, x2) - 0.5));
    const minY = Math.max(0, Math.ceil(Math.min(y0, y1, y2) - 0.5)), maxY = Math.min(H - 1, Math.floor(Math.max(y0, y1, y2) - 0.5));
    if (minX > maxX || minY > maxY) continue;
    const inv = 1 / area;
    const d0x = y1 - y2, d1x = y2 - y0, d2x = y0 - y1;
    for (let py = minY; py <= maxY; py++) {
      const y = py + 0.5, x = minX + 0.5;
      let e0 = (x1 - x) * (y2 - y) - (x2 - x) * (y1 - y);
      let e1 = (x2 - x) * (y0 - y) - (x0 - x) * (y2 - y);
      let e2 = (x0 - x) * (y1 - y) - (x1 - x) * (y0 - y);
      let row = py * W + minX;
      for (let px = minX; px <= maxX; px++, row++, e0 += d0x, e1 += d1x, e2 += d2x) {
        if (e0 < 0 || e1 < 0 || e2 < 0) continue;
        const l0 = e0 * inv, l1 = e1 * inv, l2 = e2 * inv;
        const iz = l0 * w0 + l1 * z1 + l2 * z2;
        if (iz <= depth[row]) continue;
        depth[row] = iz; tri[row] = t;
        const p1 = (l1 * z1) / iz, p2 = (l2 * z2) / iz;
        if (swapped) { b1[row] = p2; b2[row] = p1; } else { b1[row] = p1; b2[row] = p2; }
      }
    }
  }
}

// A model with triangles but no normals is drawn with normals worked out once (smooth, split at sharp creases).
const smoothed = new WeakMap<AsciiModel, AsciiModel>();
/** The model as it is drawn: with normals. @internal */
export function drawable(model: AsciiModel): AsciiModel {
  if (model.normals || !model.indices.length) return model;
  let known = smoothed.get(model);
  if (!known) { known = withNormals(model); smoothed.set(model, known); }
  return known;
}

/** Draws a model into RGBA pixels. Pure computation: no DOM, no GPU. */
export function renderModel(input: AsciiModel, options: ModelRenderOptions): RenderedModel {
  const model = drawable(input);
  const samples = Math.max(1, Math.min(4, Math.round(options.samples ?? 1)));
  const outW = Math.max(1, Math.round(options.width)), outH = Math.max(1, Math.round(options.height));
  const W = outW * samples, H = outH * samples, size = W * H;
  if (size > 64e6) throw new Error('renderModel: at most 64 million pixels (width × height × samples²).');
  const prep = prepare(model), { center, radius } = prep;
  const up = options.up ?? model.up;
  const R = rotation(options, up);
  const fov = Math.max(0, Math.min(150, options.fov ?? 30)), zoom = Math.max(0.05, options.zoom ?? 1);
  const perspective = fov > 0.5, pixelAspect = options.pixelAspect && options.pixelAspect > 0 ? options.pixelAspect : 1;
  const half = (fov * RAD) / 2;
  const distance = perspective ? (radius / Math.sin(half)) * 1.02 : radius * 3;
  // Framed to the shorter side, measured in widths of a pixel.
  const fit = Math.min(W, H * pixelAspect) / 2;
  const scale = perspective ? fit / (Math.tan(half) / zoom) : (fit / (radius * 1.02)) * zoom, scaleY = scale / pixelAspect;
  const cxs = W / 2, cys = H / 2;

  // Vertices into view space and onto the screen.
  const positions = model.positions, count = positions.length / 3, modelNormals = model.normals;
  const vs = scratch(count * 7); // view x, y, z, screen x, y, 1 / depth, (spare)
  // Normals into view space once a vertex, not once a pixel.
  const vn = modelNormals ? normalScratch(count * 3) : null;
  if (vn && modelNormals) {
    for (let i = 0; i < count * 3; i += 3) {
      const x = modelNormals[i], y = modelNormals[i + 1], z = modelNormals[i + 2];
      vn[i] = R[0] * x + R[1] * y + R[2] * z; vn[i + 1] = R[3] * x + R[4] * y + R[5] * z; vn[i + 2] = R[6] * x + R[7] * y + R[8] * z;
    }
  }
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3] - center[0], y = positions[i * 3 + 1] - center[1], z = positions[i * 3 + 2] - center[2];
    const vx = R[0] * x + R[1] * y + R[2] * z, vy = R[3] * x + R[4] * y + R[5] * z, vz = R[6] * x + R[7] * y + R[8] * z;
    const depth = distance - vz, o = i * 7;
    vs[o] = vx; vs[o + 1] = vy; vs[o + 2] = vz;
    if (perspective) { vs[o + 3] = cxs + (vx * scale) / depth; vs[o + 4] = cys - (vy * scaleY) / depth; }
    else { vs[o + 3] = cxs + vx * scale; vs[o + 4] = cys - vy * scaleY; }
    vs[o + 5] = 1 / depth;
  }

  const buf = buffers(size), { tri, depth, b1, b2 } = buf;
  tri.fill(-1); depth.fill(0);
  const indices = model.indices, triangles = indices.length / 3;
  const points = triangles === 0;
  if (!points) {
    rasterTriangles(indices, vs, W, H, tri, depth, b1, b2);
  } else {
    // A point cloud: each point a disc, nearest wins.
    const pointPx = options.pointSize ? options.pointSize * samples : null;
    for (let i = 0; i < count; i++) {
      const o = i * 7, w = vs[o + 5];
      if (w <= 0) continue;
      const r = Math.max(0.5, (pointPx ?? prep.spacing * radius * scale * (perspective ? w : 1)) / 2);
      const sx = vs[o + 3], sy = vs[o + 4];
      const minX = Math.max(0, Math.ceil(sx - r - 0.5)), maxX = Math.min(W - 1, Math.floor(sx + r - 0.5));
      const minY = Math.max(0, Math.ceil(sy - r - 0.5)), maxY = Math.min(H - 1, Math.floor(sy + r - 0.5));
      const r2 = r * r;
      for (let py = minY; py <= maxY; py++) for (let px = minX; px <= maxX; px++) {
        const dx = px + 0.5 - sx, dy = py + 0.5 - sy, at = py * W + px;
        if (dx * dx + dy * dy > r2 || w <= depth[at]) continue;
        depth[at] = w; tri[at] = i;
      }
    }
  }

  // Light every pixel once.
  const shading = options.shading ?? 'lit';
  const paint = options.paint ? linearColor(options.paint) : null;
  const L = (() => { const l = options.light ?? [-0.7, 0.45, 0.55], n = Math.sqrt(l[0] * l[0] + l[1] * l[1] + l[2] * l[2]) || 1; return [l[0] / n, l[1] / n, l[2] / n]; })();
  // The fill comes from the other side, lower and weaker.
  const F = (() => { const f = [-L[0] * 0.8, -0.25, Math.max(0.3, L[2])], n = Math.sqrt(f[0] * f[0] + f[1] * f[1] + f[2] * f[2]); return [f[0] / n, f[1] / n, f[2] / n]; })();
  const ambient = clamp01(options.ambient ?? 0.04), rimStrength = clamp01(options.rim ?? 0.3), specular = clamp01(options.specular ?? 0.3);
  const exposure = Math.max(0, options.exposure ?? 1);
  const colors = model.colors, uvs = model.uvs;
  const { nx: NX, ny: NY, nz: NZ, rgb } = buf;
  const texel = [0, 0, 0, 1];
  const near = distance - radius, far = distance + radius;
  for (let at = 0; at < size; at++) {
    const t = tri[at];
    if (t < 0) continue;
    let nx: number, ny: number, nz: number, vx: number, vy: number, vz: number;
    let ar = 0.8, ag = 0.8, ab = 0.8, er = 0, eg = 0, eb = 0;
    if (points) {
      const o = t * 7;
      vx = vs[o]; vy = vs[o + 1]; vz = vs[o + 2];
      if (vn) { nx = vn[t * 3]; ny = vn[t * 3 + 1]; nz = vn[t * 3 + 2]; } else { nx = 0; ny = 0; nz = 1; }
      const m = model.materials[0];
      ar = m.color[0]; ag = m.color[1]; ab = m.color[2];
      if (colors) { ar *= colors[t * 3]; ag *= colors[t * 3 + 1]; ab *= colors[t * 3 + 2]; }
    } else {
      const i0 = indices[t * 3], i1 = indices[t * 3 + 1], i2 = indices[t * 3 + 2];
      const c1 = b1[at], c2 = b2[at], c0 = 1 - c1 - c2;
      const o0 = i0 * 7, o1 = i1 * 7, o2 = i2 * 7;
      vx = vs[o0] * c0 + vs[o1] * c1 + vs[o2] * c2;
      vy = vs[o0 + 1] * c0 + vs[o1 + 1] * c1 + vs[o2 + 1] * c2;
      vz = vs[o0 + 2] * c0 + vs[o1 + 2] * c1 + vs[o2 + 2] * c2;
      if (vn) {
        nx = vn[i0 * 3] * c0 + vn[i1 * 3] * c1 + vn[i2 * 3] * c2;
        ny = vn[i0 * 3 + 1] * c0 + vn[i1 * 3 + 1] * c1 + vn[i2 * 3 + 1] * c2;
        nz = vn[i0 * 3 + 2] * c0 + vn[i1 * 3 + 2] * c1 + vn[i2 * 3 + 2] * c2;
      } else {
        // No normals: the face's own, from its corners in view space.
        const ax = vs[o1] - vs[o0], ay = vs[o1 + 1] - vs[o0 + 1], az = vs[o1 + 2] - vs[o0 + 2];
        const bx = vs[o2] - vs[o0], by = vs[o2 + 1] - vs[o0 + 1], bz = vs[o2 + 2] - vs[o0 + 2];
        nx = ay * bz - az * by; ny = az * bx - ax * bz; nz = ax * by - ay * bx;
      }
      const m = model.materials[prep.triangleMaterial[t]];
      ar = m.color[0]; ag = m.color[1]; ab = m.color[2];
      er = m.emissive[0]; eg = m.emissive[1]; eb = m.emissive[2];
      if (colors) {
        ar *= colors[i0 * 3] * c0 + colors[i1 * 3] * c1 + colors[i2 * 3] * c2;
        ag *= colors[i0 * 3 + 1] * c0 + colors[i1 * 3 + 1] * c1 + colors[i2 * 3 + 1] * c2;
        ab *= colors[i0 * 3 + 2] * c0 + colors[i1 * 3 + 2] * c1 + colors[i2 * 3 + 2] * c2;
      }
      if (uvs && m.texture?.image) {
        sampleTexture(m.texture, uvs[i0 * 2] * c0 + uvs[i1 * 2] * c1 + uvs[i2 * 2] * c2, uvs[i0 * 2 + 1] * c0 + uvs[i1 * 2 + 1] * c1 + uvs[i2 * 2 + 1] * c2, texel);
        ar *= texel[0]; ag *= texel[1]; ab *= texel[2];
      }
    }
    if (paint) { ar = paint[0]; ag = paint[1]; ab = paint[2]; }
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    // Toward the viewer.
    let wx = 0, wy = 0, wz = 1;
    if (perspective) { wx = -vx; wy = -vy; wz = distance - vz; const l = Math.sqrt(wx * wx + wy * wy + wz * wz) || 1; wx /= l; wy /= l; wz /= l; }
    let facing = nx * wx + ny * wy + nz * wz;
    // Both sides of a surface are lit as its front.
    if (facing < 0) { nx = -nx; ny = -ny; nz = -nz; facing = -facing; }
    NX[at] = nx; NY[at] = ny; NZ[at] = nz;
    let r: number, g: number, b: number;
    if (shading === 'normals') {
      r = TO_LINEAR[Math.round((nx * 0.5 + 0.5) * 255)]; g = TO_LINEAR[Math.round((ny * 0.5 + 0.5) * 255)]; b = TO_LINEAR[Math.round((nz * 0.5 + 0.5) * 255)];
    } else if (shading === 'depth') {
      const d = 1 / depth[at], tone = clamp01((far - d) / (far - near));
      r = g = b = tone * tone;
    } else {
      let key = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
      let fill = Math.max(0, nx * F[0] + ny * F[1] + nz * F[2]) * 0.12;
      const hx = L[0] + wx, hy = L[1] + wy, hz = L[2] + wz, hl = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1;
      let spec = Math.max(0, (nx * hx + ny * hy + nz * hz) / hl);
      spec *= spec; spec *= spec; spec *= spec; spec *= spec; spec *= spec; // to the 32nd
      spec *= specular;
      const edge = 1 - facing;
      let rim = edge * edge * edge * rimStrength;
      if (shading === 'toon') {
        key = key > 0.6 ? 1 : key > 0.25 ? 0.55 : key > 0.05 ? 0.25 : 0;
        fill = fill > 0.12 ? 0.3 : 0;
        spec = spec > 0.15 * specular ? specular : 0;
        rim = rim > 0.18 * rimStrength ? rimStrength * 0.6 : 0;
      }
      const lightLevel = ambient + key + fill;
      r = ar * lightLevel + spec + rim * 0.9 + er;
      g = ag * lightLevel + spec + rim * 0.9 + eg;
      b = ab * lightLevel + spec + rim * 0.9 + eb;
    }
    // Highlights rolled off rather than clipped.
    r *= exposure; g *= exposure; b *= exposure;
    rgb[at * 3] = (r * 1.15) / (1 + r * 0.15);
    rgb[at * 3 + 1] = (g * 1.15) / (1 + g * 0.15);
    rgb[at * 3 + 2] = (b * 1.15) / (1 + b * 0.15);
  }

  // Outlines: a pixel is darkened when a neighbour is clearly nearer (another surface in front of it) or faces a very
  // different way (a crease). Lines are as wide as one output pixel.
  const outline = clamp01(options.outline ?? 0.65);
  if (outline > 0 && shading !== 'normals') {
    const gap = radius * 0.05, reach = samples, dark = buf.edge;
    // Marked first, applied after, so every test reads the picture as lit.
    for (let y = 0; y < H; y++) {
      for (let x = 0, at = y * W; x < W; x++, at++) {
        dark[at] = 0;
        const t = tri[at];
        if (t < 0) continue;
        const d = 1 / depth[at], nx = NX[at], ny = NY[at], nz = NZ[at];
        let edge = 0;
        for (let k = 0; k < 4; k++) {
          let q: number;
          if (k === 0) { if (x < reach) continue; q = at - reach; }
          else if (k === 1) { if (x + reach >= W) continue; q = at + reach; }
          else if (k === 2) { if (y < reach) continue; q = at - reach * W; }
          else { if (y + reach >= H) continue; q = at + reach * W; }
          const u = tri[q];
          // The same triangle on both sides: no edge between them.
          if (u === t || u < 0) continue;
          if (d - 1 / depth[q] > gap) { edge = 1; break; }
          if (!points && edge < 0.6 && nx * NX[q] + ny * NY[q] + nz * NZ[q] < 0.5) edge = 0.6;
        }
        dark[at] = edge;
      }
    }
    for (let at = 0; at < size; at++) {
      const e = dark[at];
      if (!e || tri[at] < 0) continue;
      const keep = 1 - outline * e;
      rgb[at * 3] *= keep; rgb[at * 3 + 1] *= keep; rgb[at * 3 + 2] *= keep;
    }
  }

  // Down to the output size, over the background.
  const ground = options.background ? linearColor(options.background) : null;
  const out = new Uint8Array(outW * outH * 4), n = samples * samples;
  if (samples === 1) {
    for (let at = 0, o = 0; at < size; at++, o += 4) {
      if (tri[at] < 0) {
        if (ground) { out[o] = encode(ground[0]); out[o + 1] = encode(ground[1]); out[o + 2] = encode(ground[2]); out[o + 3] = 255; }
        continue;
      }
      out[o] = encode(rgb[at * 3]); out[o + 1] = encode(rgb[at * 3 + 1]); out[o + 2] = encode(rgb[at * 3 + 2]); out[o + 3] = 255;
    }
    return { data: out, width: outW, height: outH, channels: 4 };
  }
  for (let y = 0; y < outH; y++) for (let x = 0; x < outW; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < samples; sy++) for (let sx = 0; sx < samples; sx++) {
      const at = (y * samples + sy) * W + x * samples + sx;
      if (tri[at] < 0) continue;
      r += rgb[at * 3]; g += rgb[at * 3 + 1]; b += rgb[at * 3 + 2]; a++;
    }
    const o = (y * outW + x) * 4;
    if (ground) {
      const cover = a / n, rest = 1 - cover;
      out[o] = encode(r / n + ground[0] * rest); out[o + 1] = encode(g / n + ground[1] * rest); out[o + 2] = encode(b / n + ground[2] * rest); out[o + 3] = 255;
    } else if (a) {
      out[o] = encode(r / a); out[o + 1] = encode(g / a); out[o + 2] = encode(b / a); out[o + 3] = Math.round((255 * a) / n);
    }
  }
  return { data: out, width: outW, height: outH, channels: 4 };
}

/** Frames of the model turning about its up axis: `frames` views, `turn` degrees in all (default 360), from `yaw`. */
export function modelFrames(model: AsciiModel, options: ModelRenderOptions & { frames?: number; turn?: number }): RenderedModel[] {
  const frames = Math.max(1, Math.round(options.frames ?? 36)), turn = options.turn ?? 360, yaw = options.yaw ?? 30;
  return Array.from({ length: frames }, (_, i) => renderModel(model, { ...options, yaw: yaw + (turn * i) / frames }));
}
