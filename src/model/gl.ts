import { drawable, linearColor, renderModel, type ModelLook, type ModelView } from './render';
import type { AsciiModel } from './types';

/*
 * A 3D model drawn on the GPU into a canvas of its own, for a glyph field (or the GPU text converter) to read as a live
 * source: `mountGlyphField(el, { source: model.canvas, live: true })`. The same light, outline and framing as the CPU
 * renderer (render.ts), so a model looks alike in the terminal, in an SVG and on a page. It turns by itself, follows the
 * pointer over an element, and draws only when something moved. Without WebGL2 it falls back to the CPU renderer.
 */

export interface ModelSourceOptions extends ModelView, Omit<ModelLook, 'background'> {
  /** The drawing's size in pixels. Default 640 × 640. */
  width?: number;
  height?: number;
  /** Degrees a second it turns about its up axis. Default 20; 0 holds it still. Reduced motion holds it still. */
  spin?: number;
  /** An element whose pointer turns the model. */
  orbit?: HTMLElement | null;
  /** 'drag' turns it while the pointer is held (default); 'hover' leans it toward the pointer. */
  orbitMode?: 'drag' | 'hover';
  /** Behind the model: a CSS hex colour, or null for transparent (default). */
  background?: string | null;
  /** Called after each new drawing. */
  onFrame?: () => void;
}

export interface ModelSource {
  /** The drawing. Pass it as a field's `source` with `live: true`. */
  readonly canvas: HTMLCanvasElement;
  /** Whether it draws with WebGL2 (false: the CPU fallback). */
  readonly gpu: boolean;
  update(options: Partial<ModelSourceOptions>): void;
  setModel(model: AsciiModel): void;
  /** Draws now. */
  render(): void;
  destroy(): void;
}

const VERTEX = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aColor;
layout(location=3) in vec2 aUv;
uniform mat3 uRot;
uniform vec3 uCenter;
uniform float uDistance, uNear, uFar, uPointSize;
uniform vec2 uScale;
uniform bool uOrtho;
out vec3 vPos;
out vec3 vNormal;
out vec3 vColor;
out vec2 vUv;
void main() {
  vec3 p = uRot * (aPos - uCenter);
  vPos = p; vNormal = uRot * aNormal; vColor = aColor; vUv = aUv;
  float depth = uDistance - p.z;
  if (uOrtho) {
    gl_Position = vec4(p.xy * uScale, (depth - uNear) / (uFar - uNear) * 2.0 - 1.0, 1.0);
    gl_PointSize = uPointSize;
  } else {
    float a = (uFar + uNear) / (uFar - uNear), b = -2.0 * uFar * uNear / (uFar - uNear);
    gl_Position = vec4(p.xy * uScale, a * depth + b, depth);
    gl_PointSize = uPointSize / depth;
  }
}`;

// Lit as render.ts lights a pixel.
const SHADE = `#version 300 es
precision highp float;
in vec3 vPos;
in vec3 vNormal;
in vec3 vColor;
in vec2 vUv;
uniform vec4 uBase;
uniform vec3 uEmissive, uPaint, uLight, uFill;
uniform sampler2D uTex;
uniform bool uHasTex, uHasNormal, uPoints, uOrtho, uPaintOn;
uniform int uShading;
uniform float uDistance, uNear, uFar, uAmbient, uRim, uSpecular, uExposure;
layout(location=0) out vec4 oColor;
layout(location=1) out vec4 oNormal;
void main() {
  vec3 n;
  if (uPoints) {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    if (dot(c, c) > 1.0) discard;
    n = uHasNormal ? normalize(vNormal) : vec3(0.0, 0.0, 1.0);
  } else n = uHasNormal ? normalize(vNormal) : normalize(cross(dFdx(vPos), dFdy(vPos)));
  vec3 v = uOrtho ? vec3(0.0, 0.0, 1.0) : normalize(vec3(-vPos.xy, uDistance - vPos.z));
  float facing = dot(n, v);
  if (facing < 0.0) { n = -n; facing = -facing; }
  vec3 albedo = uBase.rgb * vColor;
  if (uHasTex) albedo *= texture(uTex, vUv).rgb;
  if (uPaintOn) albedo = uPaint;
  vec3 c;
  if (uShading == 2) c = pow(n * 0.5 + 0.5, vec3(2.2));
  else if (uShading == 3) {
    float t = clamp((uFar - (uDistance - vPos.z)) / (uFar - uNear), 0.0, 1.0);
    c = vec3(t * t);
  } else {
    float key = max(dot(n, uLight), 0.0), fill = max(dot(n, uFill), 0.0) * 0.12;
    float spec = pow(max(dot(n, normalize(uLight + v)), 0.0), 32.0) * uSpecular;
    float edge = 1.0 - facing, rim = edge * edge * edge * uRim;
    if (uShading == 1) {
      key = key > 0.6 ? 1.0 : key > 0.25 ? 0.55 : key > 0.05 ? 0.25 : 0.0;
      fill = fill > 0.12 ? 0.3 : 0.0;
      spec = spec > 0.15 * uSpecular ? uSpecular : 0.0;
      rim = rim > 0.18 * uRim ? uRim * 0.6 : 0.0;
    }
    c = albedo * (uAmbient + key + fill) + spec + rim * 0.9 + uEmissive;
  }
  c *= uExposure;
  oColor = vec4(c * 1.15 / (1.0 + c * 0.15), 1.0);
  oNormal = vec4(n * 0.5 + 0.5, 1.0);
}`;

const QUAD = `#version 300 es
void main() { vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0); gl_Position = vec4(p, 0.0, 1.0); }`;

// Outlines, then out to the canvas in sRGB.
const FINISH = `#version 300 es
precision highp float;
uniform sampler2D uColor, uNormal, uDepth;
uniform vec2 uTexel;
uniform float uOutline, uGap, uNear, uFar;
uniform bool uOrtho, uPoints;
uniform vec4 uGround;
out vec4 oColor;
float dist(float z) {
  return uOrtho ? mix(uNear, uFar, z) : (2.0 * uNear * uFar) / (uFar + uNear - (z * 2.0 - 1.0) * (uFar - uNear));
}
vec3 encode(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  float z = texture(uDepth, uv).r;
  if (z >= 1.0) { oColor = vec4(encode(uGround.rgb) * uGround.a, uGround.a); return; }
  vec3 c = texture(uColor, uv).rgb;
  if (uOutline > 0.0) {
    float d = dist(z), edge = 0.0;
    vec3 n = texture(uNormal, uv).xyz * 2.0 - 1.0;
    for (int k = 0; k < 4; k++) {
      vec2 o = k == 0 ? vec2(-1.0, 0.0) : k == 1 ? vec2(1.0, 0.0) : k == 2 ? vec2(0.0, -1.0) : vec2(0.0, 1.0);
      float zq = texture(uDepth, uv + o * uTexel).r;
      if (zq >= 1.0) continue;
      if (d - dist(zq) > uGap) { edge = 1.0; break; }
      vec3 nq = texture(uNormal, uv + o * uTexel).xyz * 2.0 - 1.0;
      if (!uPoints && dot(n, nq) < 0.5) edge = max(edge, 0.6);
    }
    c *= 1.0 - uOutline * edge;
  }
  oColor = vec4(encode(clamp(c, 0.0, 1.0)), 1.0);
}`;

const RAD = Math.PI / 180;

function rotation(yawDeg: number, pitchDeg: number, rollDeg: number, up: 'y' | 'z') {
  const yaw = yawDeg * RAD, pitch = pitchDeg * RAD, roll = rollDeg * RAD;
  let m = up === 'z' ? [1, 0, 0, 0, 0, 1, 0, -1, 0] : [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const mul = (a: number[], b: number[]) => [0, 1, 2].flatMap(r => [0, 1, 2].map(c => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]));
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  m = mul([cy, 0, sy, 0, 1, 0, -sy, 0, cy], m);
  m = mul([1, 0, 0, 0, cp, -sp, 0, sp, cp], m);
  m = mul([cr, -sr, 0, sr, cr, 0, 0, 0, 1], m);
  return m;
}

function program(gl: WebGL2RenderingContext, vertex: string, fragment: string) {
  const make = (type: number, text: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, text);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`modelSource: ${gl.getShaderInfoLog(shader)}`);
    return shader;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, make(gl.VERTEX_SHADER, vertex));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`modelSource: ${gl.getProgramInfoLog(p)}`);
  const uniforms = new Map<string, WebGLUniformLocation | null>();
  return { program: p, u: (name: string) => { if (!uniforms.has(name)) uniforms.set(name, gl.getUniformLocation(p, name)); return uniforms.get(name)!; } };
}

interface Uploaded {
  /** The model as uploaded (with normals worked out where it had none). */
  model: AsciiModel;
  vao: WebGLVertexArrayObject;
  buffers: WebGLBuffer[];
  textures: (WebGLTexture | null)[];
  center: [number, number, number];
  radius: number;
  spacing: number;
}

/** A model as a live canvas for a field: drawn on the GPU, turning, following the pointer. */
export function modelSource(initial: AsciiModel, initialOptions: ModelSourceOptions = {}): ModelSource {
  let options: ModelSourceOptions = { ...initialOptions };
  let model = initial;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(options.width ?? 640));
  canvas.height = Math.max(1, Math.round(options.height ?? 640));
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true });
  const reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  let yaw = options.yaw ?? 30, pitch = options.pitch ?? 20, lean = [0, 0], leanTarget = [0, 0];
  let frame = 0, last = 0, destroyed = false;

  // The CPU fallback: the same picture, drawn by render.ts into a 2D canvas.
  const pen = gl ? null : canvas.getContext('2d');
  let shade: ReturnType<typeof program> | null = null, finish: ReturnType<typeof program> | null = null;
  let uploaded: Uploaded | null = null;
  let target: { fb: WebGLFramebuffer; color: WebGLTexture; normal: WebGLTexture; depth: WebGLTexture; w: number; h: number } | null = null;

  function upload(input: AsciiModel): Uploaded {
    const g = gl!, m = drawable(input);
    const vao = g.createVertexArray()!;
    g.bindVertexArray(vao);
    const buffers: WebGLBuffer[] = [];
    const attribute = (location: number, data: Float32Array | null, size: number, fallback: number[]) => {
      if (!data) { g.disableVertexAttribArray(location); g.vertexAttrib4f(location, fallback[0], fallback[1], fallback[2] ?? 0, 1); return; }
      const buffer = g.createBuffer()!;
      buffers.push(buffer);
      g.bindBuffer(g.ARRAY_BUFFER, buffer);
      g.bufferData(g.ARRAY_BUFFER, data, g.STATIC_DRAW);
      g.enableVertexAttribArray(location);
      g.vertexAttribPointer(location, size, g.FLOAT, false, 0, 0);
    };
    attribute(0, m.positions, 3, [0, 0, 0]);
    attribute(1, m.normals, 3, [0, 0, 1]);
    attribute(2, m.colors, 3, [1, 1, 1]);
    attribute(3, m.uvs, 2, [0, 0]);
    if (m.indices.length) {
      const index = g.createBuffer()!;
      buffers.push(index);
      g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, index);
      g.bufferData(g.ELEMENT_ARRAY_BUFFER, m.indices, g.STATIC_DRAW);
    }
    g.bindVertexArray(null);
    const textures = m.materials.map(material => {
      const image = material.texture?.image;
      if (!image) return null;
      const texture = g.createTexture()!;
      g.bindTexture(g.TEXTURE_2D, texture);
      g.texImage2D(g.TEXTURE_2D, 0, g.SRGB8_ALPHA8, image.width, image.height, 0, g.RGBA, g.UNSIGNED_BYTE, image.data);
      g.generateMipmap(g.TEXTURE_2D);
      const wrap = material.texture!.wrap === 'clamp' ? g.CLAMP_TO_EDGE : material.texture!.wrap === 'mirror' ? g.MIRRORED_REPEAT : g.REPEAT;
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, wrap);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, wrap);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR);
      return texture;
    });
    const b = m.bounds, center: [number, number, number] = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
    let r2 = 0;
    for (let i = 0; i < m.positions.length; i += 3) {
      const dx = m.positions[i] - center[0], dy = m.positions[i + 1] - center[1], dz = m.positions[i + 2] - center[2];
      r2 = Math.max(r2, dx * dx + dy * dy + dz * dz);
    }
    const points = m.positions.length / 3;
    return { model: m, vao, buffers, textures, center, radius: Math.sqrt(r2) || 1, spacing: points ? Math.sqrt((4 * Math.PI) / points) * 1.1 : 0 };
  }

  function release() {
    if (!gl || !uploaded) return;
    gl.deleteVertexArray(uploaded.vao);
    for (const buffer of uploaded.buffers) gl.deleteBuffer(buffer);
    for (const texture of uploaded.textures) if (texture) gl.deleteTexture(texture);
    uploaded = null;
  }

  function targets(w: number, h: number) {
    const g = gl!;
    if (target && target.w === w && target.h === h) return target;
    if (target) { g.deleteFramebuffer(target.fb); g.deleteTexture(target.color); g.deleteTexture(target.normal); g.deleteTexture(target.depth); }
    const texture = (internal: number) => {
      const t = g.createTexture()!;
      g.bindTexture(g.TEXTURE_2D, t);
      g.texStorage2D(g.TEXTURE_2D, 1, internal, w, h);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
      return t;
    };
    const color = texture(g.SRGB8_ALPHA8), normal = texture(g.RGBA8), depth = texture(g.DEPTH_COMPONENT24);
    const fb = g.createFramebuffer()!;
    g.bindFramebuffer(g.FRAMEBUFFER, fb);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, color, 0);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT1, g.TEXTURE_2D, normal, 0);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.DEPTH_ATTACHMENT, g.TEXTURE_2D, depth, 0);
    g.drawBuffers([g.COLOR_ATTACHMENT0, g.COLOR_ATTACHMENT1]);
    // Left bound, a target would be read while it is drawn into (WebGL refuses such a draw).
    g.bindTexture(g.TEXTURE_2D, null);
    target = { fb, color, normal, depth, w, h };
    return target;
  }

  function draw() {
    if (destroyed) return;
    const w = canvas.width, h = canvas.height;
    const view = { ...options, yaw: yaw + lean[0], pitch: Math.max(-89, Math.min(89, pitch + lean[1])) };
    if (!gl) {
      if (!pen) return;
      const pixels = renderModel(model, { ...view, width: w, height: h, background: options.background ?? null });
      pen.putImageData(new ImageData(new Uint8ClampedArray(pixels.data.buffer, pixels.data.byteOffset, pixels.data.length), w, h), 0, 0);
      options.onFrame?.();
      return;
    }
    shade ??= program(gl, VERTEX, SHADE);
    finish ??= program(gl, QUAD, FINISH);
    uploaded ??= upload(model);
    const { center, radius } = uploaded, drawn = uploaded.model;
    const t = targets(w, h);
    const fov = Math.max(0, Math.min(150, view.fov ?? 30)), zoom = Math.max(0.05, view.zoom ?? 1), ortho = fov <= 0.5;
    const half = (fov * RAD) / 2, distance = ortho ? radius * 3 : (radius / Math.sin(half)) * 1.02;
    const k = ortho ? ((Math.min(w, h) / 2) / (radius * 1.02)) * zoom : (Math.min(w, h) / 2) / (Math.tan(half) / zoom);
    const near = Math.max(distance * 0.01, distance - radius * 1.05), far = distance + radius * 1.05;
    const R = rotation(view.yaw, view.pitch, view.roll ?? 0, view.up ?? drawn.up);
    const light = (() => { const l = view.light ?? [-0.7, 0.45, 0.55], n = Math.hypot(l[0], l[1], l[2]) || 1; return [l[0] / n, l[1] / n, l[2] / n]; })();
    const fill = (() => { const f = [-light[0] * 0.8, -0.25, Math.max(0.3, light[2])], n = Math.hypot(f[0], f[1], f[2]); return [f[0] / n, f[1] / n, f[2] / n]; })();
    const points = drawn.indices.length === 0;

    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.viewport(0, 0, w, h);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.COLOR, 1, [0.5, 0.5, 1, 0]);
    gl.clearBufferfv(gl.DEPTH, 0, [1]);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    const s = shade;
    gl.useProgram(s.program);
    // GL's matrices are column by column: transpose the row-major rotation.
    gl.uniformMatrix3fv(s.u('uRot'), true, R);
    gl.uniform3fv(s.u('uCenter'), center);
    gl.uniform1f(s.u('uDistance'), distance);
    gl.uniform1f(s.u('uNear'), near);
    gl.uniform1f(s.u('uFar'), far);
    gl.uniform2f(s.u('uScale'), k / (w / 2), k / (h / 2));
    gl.uniform1i(s.u('uOrtho'), ortho ? 1 : 0);
    gl.uniform1f(s.u('uPointSize'), points ? Math.max(1, uploaded.spacing * radius * k) : 1);
    gl.uniform3fv(s.u('uLight'), light);
    gl.uniform3fv(s.u('uFill'), fill);
    gl.uniform1i(s.u('uHasNormal'), drawn.normals ? 1 : 0);
    gl.uniform1i(s.u('uPoints'), points ? 1 : 0);
    const paint = view.paint ? linearColor(view.paint) : null;
    gl.uniform1i(s.u('uPaintOn'), paint ? 1 : 0);
    gl.uniform3fv(s.u('uPaint'), paint ?? [1, 1, 1]);
    gl.uniform1i(s.u('uShading'), ({ lit: 0, toon: 1, normals: 2, depth: 3 } as const)[view.shading ?? 'lit']);
    gl.uniform1f(s.u('uAmbient'), view.ambient ?? 0.04);
    gl.uniform1f(s.u('uRim'), view.rim ?? 0.3);
    gl.uniform1f(s.u('uSpecular'), view.specular ?? 0.3);
    gl.uniform1f(s.u('uExposure'), view.exposure ?? 1);
    gl.uniform1i(s.u('uTex'), 0);
    gl.bindVertexArray(uploaded.vao);
    if (points) {
      const m = drawn.materials[0];
      gl.uniform4fv(s.u('uBase'), m.color);
      gl.uniform3fv(s.u('uEmissive'), m.emissive);
      gl.uniform1i(s.u('uHasTex'), 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.drawArrays(gl.POINTS, 0, drawn.positions.length / 3);
    } else {
      for (const group of drawn.groups) {
        const m = drawn.materials[group.material] ?? drawn.materials[0], texture = uploaded.textures[group.material];
        gl.uniform4fv(s.u('uBase'), m.color);
        gl.uniform3fv(s.u('uEmissive'), m.emissive);
        gl.uniform1i(s.u('uHasTex'), texture && drawn.uvs ? 1 : 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.drawElements(gl.TRIANGLES, group.count, gl.UNSIGNED_INT, group.start * 4);
      }
    }
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    const f = finish;
    gl.useProgram(f.program);
    [t.color, t.normal, t.depth].forEach((texture, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, texture); });
    gl.uniform1i(f.u('uColor'), 0);
    gl.uniform1i(f.u('uNormal'), 1);
    gl.uniform1i(f.u('uDepth'), 2);
    gl.uniform2f(f.u('uTexel'), 1 / w, 1 / h);
    gl.uniform1f(f.u('uOutline'), view.outline ?? 0.65);
    gl.uniform1f(f.u('uGap'), radius * 0.05);
    gl.uniform1f(f.u('uNear'), near);
    gl.uniform1f(f.u('uFar'), far);
    gl.uniform1i(f.u('uOrtho'), ortho ? 1 : 0);
    gl.uniform1i(f.u('uPoints'), points ? 1 : 0);
    const ground = options.background ? linearColor(options.background) : null;
    gl.uniform4f(f.u('uGround'), ground?.[0] ?? 0, ground?.[1] ?? 0, ground?.[2] ?? 0, ground ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
    options.onFrame?.();
  }

  const moving = () => !destroyed && (((options.spin ?? 20) !== 0 && !reduced?.matches) || Math.abs(lean[0] - leanTarget[0]) + Math.abs(lean[1] - leanTarget[1]) > 0.05);
  const tick = (now: number) => {
    frame = 0;
    if (destroyed) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    if (typeof document !== 'undefined' && document.hidden) { last = 0; return; }
    if (!reduced?.matches) yaw += (options.spin ?? 20) * dt;
    const ease = 1 - Math.exp(-dt * 8);
    lean = [lean[0] + (leanTarget[0] - lean[0]) * ease, lean[1] + (leanTarget[1] - lean[1]) * ease];
    draw();
    if (moving()) frame = requestAnimationFrame(tick);
  };
  const wake = () => { if (!frame && !destroyed) { last = 0; frame = requestAnimationFrame(tick); } };
  const onVisibility = () => { if (!document.hidden && moving()) wake(); };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

  // The pointer: drag to turn, or lean toward it.
  let held: { x: number; y: number; id: number } | null = null;
  const onDown = (e: PointerEvent) => { if (options.orbitMode === 'hover') return; held = { x: e.clientX, y: e.clientY, id: e.pointerId }; };
  const onMove = (e: PointerEvent) => {
    const el = options.orbit;
    if (!el) return;
    if (options.orbitMode === 'hover') {
      const box = el.getBoundingClientRect();
      leanTarget = [((e.clientX - box.left) / box.width - 0.5) * 50, ((e.clientY - box.top) / box.height - 0.5) * 30];
      wake();
    } else if (held && e.pointerId === held.id) {
      yaw += (e.clientX - held.x) * 0.5;
      pitch = Math.max(-89, Math.min(89, pitch + (e.clientY - held.y) * 0.4));
      held = { x: e.clientX, y: e.clientY, id: e.pointerId };
      if (!frame) draw();
    }
  };
  const onUp = () => { held = null; };
  const onLeave = () => { if (options.orbitMode === 'hover') { leanTarget = [0, 0]; wake(); } };
  let bound: HTMLElement | null = null;
  const bind = (el: HTMLElement | null | undefined) => {
    if (bound === (el ?? null)) return;
    if (bound) {
      bound.removeEventListener('pointerdown', onDown);
      bound.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }
    bound = el ?? null;
    if (bound) {
      bound.addEventListener('pointerdown', onDown);
      bound.addEventListener('pointerleave', onLeave);
      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerup', onUp, { passive: true });
    }
  };
  bind(options.orbit);

  draw();
  if (moving()) wake();
  return {
    canvas,
    gpu: !!gl,
    update(next) {
      const resized = (next.width !== undefined && Math.round(next.width) !== canvas.width) || (next.height !== undefined && Math.round(next.height) !== canvas.height);
      options = { ...options, ...next };
      if (next.yaw !== undefined) yaw = next.yaw;
      if (next.pitch !== undefined) pitch = next.pitch;
      if (resized) { canvas.width = Math.max(1, Math.round(options.width ?? canvas.width)); canvas.height = Math.max(1, Math.round(options.height ?? canvas.height)); }
      if ('orbit' in next) bind(next.orbit);
      draw();
      if (moving()) wake();
    },
    setModel(next) { release(); model = next; draw(); },
    render: draw,
    destroy() {
      destroyed = true;
      if (frame) cancelAnimationFrame(frame);
      bind(null);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      release();
      if (gl && target) { gl.deleteFramebuffer(target.fb); gl.deleteTexture(target.color); gl.deleteTexture(target.normal); gl.deleteTexture(target.depth); }
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
