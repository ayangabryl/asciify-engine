/**
 * Filled ellipses on the GPU, recorded through the subset of the Canvas 2D API the print painter uses for dots.
 * Pointillism fills tens of thousands of rotated ellipses a frame, which Canvas 2D cannot do in a display frame.
 * This draws them as Chrome's GPU canvas does, in one instanced pass: each ellipse flattened to the same polygon (its
 * four conic quadrants split into the segments Skia's tessellator picks), rasterised into a 4x multisampled target with
 * the same sample pattern, each fill blended once per sample, and resolved. Measured against Canvas 2D it matches but
 * for rounding and a handful of edge samples (tests/studio-parity-browser.mjs).
 */
const VERTEX = `#version 300 es
layout(location=1) in vec4 shape;
layout(location=2) in float angle;
layout(location=3) in vec4 color;
layout(location=4) in float path;
uniform vec2 size;
// Rim vertices per quadrant in this draw: a fan of 4 * slots triangles per ellipse, of which only the
// quadrant's own segment count are not empty.
uniform int slots;
out vec4 ink;
const float W = 0.70710678118;
vec2 turn(vec2 v, vec2 axis) { return vec2(v.x * axis.x - v.y * axis.y, v.x * axis.y + v.y * axis.x); }
// Skia's Wang's formula for a conic at a quarter-pixel tolerance, rounded up to a power of two: how many line segments
// the GPU canvas tessellates the curve into.
float segments(vec2 p0, vec2 p1, vec2 p2) {
  vec2 center = (min(min(p0, p1), p2) + max(max(p0, p1), p2)) * 0.5;
  p0 -= center; p1 -= center; p2 -= center;
  float maxLength = sqrt(max(max(dot(p0, p0), dot(p1, p1)), dot(p2, p2)));
  vec2 dp = -2.0 * W * p1 + p0 + p2;
  float dw = abs(-2.0 * W + 2.0);
  float numer = length(dp) * 4.0 + max(0.0, maxLength * 4.0 - 1.0) * dw;
  float n = sqrt(max(numer / (4.0 * min(W, 1.0)), 0.0));
  return exp2(ceil(log2(max(1.0, ceil(n)))));
}
void main() {
  int triangle = gl_VertexID / 3, corner = gl_VertexID % 3;
  vec2 radii = shape.zw;
  vec2 axis = vec2(cos(angle), sin(angle));
  vec2 unit = vec2(0.0);
  if (corner != 0) {
    int k = triangle + corner - 1, quadrant = k / slots;
    // The quadrant's own conic, in the frame's pixels, decides its segment count.
    vec2 a0 = vec2(1.0, 0.0), a1 = vec2(1.0, 1.0), a2 = vec2(0.0, 1.0);
    if (quadrant == 1) { a0 = vec2(0.0, 1.0); a1 = vec2(-1.0, 1.0); a2 = vec2(-1.0, 0.0); }
    else if (quadrant == 2) { a0 = vec2(-1.0, 0.0); a1 = vec2(-1.0, -1.0); a2 = vec2(0.0, -1.0); }
    else if (quadrant == 3) { a0 = vec2(0.0, -1.0); a1 = vec2(1.0, -1.0); a2 = vec2(1.0, 0.0); }
    float n = min(float(slots), segments(turn(a0 * radii, axis), turn(a1 * radii, axis), turn(a2 * radii, axis)));
    float t = quadrant > 3 ? 0.0 : floor(float(k - quadrant * slots) * n / float(slots)) / n;
    float a = (1.0 - t) * (1.0 - t), b = 2.0 * W * t * (1.0 - t), c = t * t;
    unit = quadrant > 3 ? vec2(1.0, 0.0) : (a0 * a + a1 * b + a2 * c) / (a + b + c);
  }
  vec2 p = shape.xy + turn(unit * radii, axis);
  ink = vec4(color.rgb * color.a, color.a);
  // Drawn upside down and flipped back when resolved: the canvas's multisample pattern is the GPU's, top-left origin.
  // Each fill is one path: a later path is nearer, and a path's own shapes overlap on equal depth, so a sample covered
  // twice by one path is blended once, as a single filled path is.
  gl_Position = vec4(p / size * 2.0 - 1.0, 1.0 - path * exp2(-23.0), 1.0);
}`;
const FRAGMENT = `#version 300 es
precision highp float;
in vec4 ink;
out vec4 outColor;
void main() { outColor = ink; }`;
// A path of one circle is an oval to Chrome's canvas, which covers it analytically instead of tessellating it. Measured
// against it: inside the circle, coverage follows the implicit-function distance estimate (x² + y² - r²) / 2|p|; outside,
// the exact distance to the rim; either as 0.5 minus the distance at the pixel's centre. Each disc is one quad over the
// pixels it can touch.
const DISC_VERTEX = `#version 300 es
layout(location=1) in vec4 shape;
layout(location=3) in vec4 color;
layout(location=4) in float path;
uniform vec2 size;
out vec4 ink;
flat out vec3 disc;
void main() {
  int corner = gl_VertexID;
  vec2 c = vec2(corner == 1 || corner == 2 || corner == 4 ? 1.0 : 0.0, corner == 2 || corner == 4 || corner == 5 ? 1.0 : 0.0);
  float reach = shape.z + 1.0;
  vec2 p = mix(floor(shape.xy - reach), ceil(shape.xy + reach), c);
  ink = vec4(color.rgb * color.a, color.a);
  disc = shape.xyz;
  gl_Position = vec4(p / size * 2.0 - 1.0, 1.0 - path * exp2(-23.0), 1.0);
}`;
const DISC_FRAGMENT = `#version 300 es
precision highp float;
in vec4 ink;
flat in vec3 disc;
out vec4 outColor;
void main() {
  float r = disc.z, d = distance(gl_FragCoord.xy, disc.xy);
  float coverage = clamp(d < r ? 0.5 - (d * d - r * r) / (2.0 * max(d, 1e-6)) : r + 0.5 - d, 0.0, 1.0);
  if (coverage <= 0.0) discard;
  outColor = ink * coverage;
}`;
const FLOATS = 10, SHAPE = 6, FILL = 9;

/** The fill style `fillColor` leaves set: assigning it again keeps that colour. */
export const DOT_FILL = "dot-fill";
/** The recorder's own calls, which take colours as numbers instead of CSS strings. */
export interface DotRecorder {
  /** One filled ellipse in an 8-bit colour, as fillStyle = rgb(), ellipse() and fill() would draw it. */
  fillEllipse(x: number, y: number, rx: number, ry: number, rotation: number, red: number, green: number, blue: number): void;
  /** Sets the fill as fillStyle = `rgb(red,green,blue)` would (channels as given, clamped to 0..255), without the string. */
  fillColor(red: number, green: number, blue: number): void;
}
export interface DotMarks {
  /** A Canvas 2D stand-in that records fills; draw the result with `finish`. */
  readonly ctx: CanvasRenderingContext2D;
  /**
   * Starts a frame; false once the GPU context is lost, or for a while after a frame that mixed discs with other marks,
   * when the caller draws on Canvas 2D instead. A caller whose marks can never be lone circles of a pixel or more (all
   * multi-shape paths, rotated ellipses or fillEllipse) passes `mixed` false, which skips the exact record a mixed
   * frame's replay needs.
   */
  begin(width: number, height: number, mixed?: boolean): boolean;
  /** Draws the recorded marks and returns the layer; null if the GPU failed this frame. */
  finish(): OffscreenCanvas | null;
  destroy(): void;
}

export function createDotMarks(): DotMarks | null {
  if (typeof OffscreenCanvas !== "function") return null;
  const canvas = new OffscreenCanvas(300, 150);
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false }) as WebGL2RenderingContext | null;
  if (!gl) return null;
  const compile = (type: number, code: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, code);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "Dot shader failed");
    return shader;
  };
  const link = (vertex: string, fragment: string) => {
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
  };
  let program: WebGLProgram | null, discs: WebGLProgram | null;
  try {
    program = link(VERTEX, FRAGMENT);
    discs = link(DISC_VERTEX, DISC_FRAGMENT);
  } catch {
    return null;
  }
  if (!program || !discs) return null;
  const size = gl.getUniformLocation(program, "size"), slotsAt = gl.getUniformLocation(program, "slots");
  const discSize = gl.getUniformLocation(discs, "size");
  // Each call is recorded first, exactly (shapes as doubles, colours as given), and turned into instances at the end of
  // the frame. A frame of lone circles is drawn with analytic discs, a frame of any other marks tessellated; a frame that
  // mixes the two Chrome draws differently from either (one such mark switches its whole canvas to another
  // antialiasing), so it is replayed on Canvas 2D instead.
  let discMarks = false, pathMarks = false;
  /** Per mark: x, y, rx, ry, rotation, path. */
  let shapes = new Float64Array(SHAPE * 4096);
  /** Per path: fill alpha and colour as blended (0..1), then globalAlpha, the colour given to fillColor and the style's index. */
  let fills = new Float64Array(FILL * 1024);
  let styles: string[] = [];
  // Frames left to draw on Canvas 2D after one had to: a look that mixes marks usually keeps doing so.
  let skip = 0;
  let rawRed = 0, rawGreen = 0, rawBlue = 0;
  let fallback: OffscreenCanvasRenderingContext2D | null = null;
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const instances = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instances);
  const stride = FLOATS * 4;
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0); gl.vertexAttribDivisor(1, 1);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 16); gl.vertexAttribDivisor(2, 1);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, 20); gl.vertexAttribDivisor(3, 1);
  gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 36); gl.vertexAttribDivisor(4, 1);
  gl.bindVertexArray(null);

  const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) as number);
  const framebuffer = gl.createFramebuffer(), target = gl.createRenderbuffer(), depthTarget = gl.createRenderbuffer();
  let targetWidth = 0, targetHeight = 0;
  const resolved = gl.createFramebuffer(), single = gl.createRenderbuffer();
  let data = new Float32Array(FLOATS * 4096), count = 0, width = 1, height = 1, paths = 0;
  // The current path: ellipses waiting for fill().
  let path = new Float64Array(5 * 8), pathCount = 0;
  let alpha = 1, red = 0, green = 0, blue = 0, fillAlpha = 1, style = "#000000";
  // Fill colours as Canvas 2D keeps them: channels as parsed, not rounded to 8 bits until they are blended.
  const parsed = new Map<string, [number, number, number, number]>();
  const probe = new OffscreenCanvas(1, 1).getContext("2d")!;
  const channel = (value: string) => Math.max(0, Math.min(255, Number(value))) / 255;
  const parse = (value: string): [number, number, number, number] | null => {
    let rgba = parsed.get(value);
    if (rgba) return rgba;
    const rgb = /^rgb\(([-+.\deE]+),([-+.\deE]+),([-+.\deE]+)\)$/.exec(value);
    const hex = rgb ? null : /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value);
    if (rgb && rgb.slice(1).every(part => Number.isFinite(Number(part)))) rgba = [channel(rgb[1]), channel(rgb[2]), channel(rgb[3]), 1];
    else if (hex) rgba = [parseInt(hex[1], 16) / 255, parseInt(hex[2], 16) / 255, parseInt(hex[3], 16) / 255, 1];
    else {
      // Anything else goes through the browser's own parser: what Canvas 2D would fill with.
      probe.fillStyle = "#010203";
      probe.fillStyle = value;
      // Canvas ignores a colour it cannot parse and keeps its fill.
      if (probe.fillStyle === "#010203" && !/^(#010203|rgb\(1,2,3\))$/i.test(value.replace(/\s/g, ""))) return null;
      probe.clearRect(0, 0, 1, 1);
      probe.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
      rgba = [r / 255, g / 255, b / 255, a / 255];
    }
    if (parsed.size >= 4096) parsed.clear();
    parsed.set(value, rgba);
    return rgba;
  };
  const push = (cx: number, cy: number, rx: number, ry: number, rotation: number) => {
    if (pathCount * 5 + 5 > path.length) { const next = new Float64Array(path.length * 2); next.set(path); path = next; }
    const o = pathCount++ * 5;
    path[o] = cx; path[o + 1] = cy; path[o + 2] = rx; path[o + 3] = ry; path[o + 4] = rotation;
  };
  // A frame whose marks cannot mix (a caller that only draws paths) skips the exact record: instances are written as they come.
  let exact = true, largest = 0;
  const shape = (x: number, y: number, rx: number, ry: number, rotation: number, id: number) => {
    if ((count + 1) * SHAPE > shapes.length) { const next = new Float64Array(shapes.length * 2); next.set(shapes); shapes = next; }
    const e = count++ * SHAPE;
    shapes[e] = x; shapes[e + 1] = y; shapes[e + 2] = rx; shapes[e + 3] = ry; shapes[e + 4] = rotation; shapes[e + 5] = id;
  };
  const write = (x: number, y: number, rx: number, ry: number, rotation: number, r: number, g: number, b: number, a: number, id: number) => {
    if ((count + 1) * FLOATS > data.length) { const next = new Float32Array(data.length * 2); next.set(data); data = next; }
    const o = count++ * FLOATS;
    if (rx > largest) largest = rx;
    if (ry > largest) largest = ry;
    data[o] = x; data[o + 1] = y; data[o + 2] = rx; data[o + 3] = ry; data[o + 4] = rotation;
    data[o + 5] = r; data[o + 6] = g; data[o + 7] = b; data[o + 8] = a; data[o + 9] = id;
  };
  const filled = (id: number, a: number, r: number, g: number, b: number, own: boolean, rr: number, rg: number, rb: number) => {
    if ((id + 1) * FILL > fills.length) { const next = new Float64Array(fills.length * 2); next.set(fills); fills = next; }
    const o = id * FILL;
    fills[o] = a; fills[o + 1] = r; fills[o + 2] = g; fills[o + 3] = b;
    fills[o + 4] = alpha; fills[o + 5] = rr; fills[o + 6] = rg; fills[o + 7] = rb;
    if (!own && styles[styles.length - 1] !== style) styles.push(style);
    fills[o + 8] = own ? -1 : styles.length - 1;
  };
  const ctx = {
    get globalAlpha() { return alpha; },
    // Canvas ignores an alpha outside 0..1, keeping the previous one.
    set globalAlpha(value: number) { if (value >= 0 && value <= 1) alpha = value; },
    get fillStyle() { return style; },
    set fillStyle(value: string) {
      if (typeof value !== "string" || value === style) return;
      style = value;
      const rgba = parse(value);
      if (rgba) [red, green, blue, fillAlpha] = rgba;
    },
    strokeStyle: "#000000",
    globalCompositeOperation: "source-over",
    font: "", textBaseline: "alphabetic", textAlign: "start",
    beginPath() { pathCount = 0; },
    moveTo() {},
    closePath() {},
    arc(x: number, y: number, radius: number) { push(x, y, radius, radius, 0); },
    ellipse(x: number, y: number, rx: number, ry: number, rotation: number) { push(x, y, rx, ry, rotation); },
    fill() {
      const a = alpha * fillAlpha;
      if (a <= 0) return;
      const id = ++paths;
      let drawn = false;
      // A degenerate ellipse fills nothing.
      for (let i = 0; i < pathCount; i++) {
        const p = i * 5;
        if (!(path[p + 2] > 0 && path[p + 3] > 0)) continue;
        if (exact) shape(path[p], path[p + 1], path[p + 2], path[p + 3], path[p + 4], id);
        else write(path[p], path[p + 1], path[p + 2], path[p + 3], path[p + 4], red, green, blue, a, id);
        drawn = true;
      }
      if (!drawn) return;
      // A lone circle of a pixel or more is an oval to Chrome; smaller ones and everything else are paths.
      if (pathCount === 1 && path[2] === path[3] && path[4] === 0 && path[2] >= 1) discMarks = true; else pathMarks = true;
      if (exact) filled(id, a, red, green, blue, style === DOT_FILL, rawRed, rawGreen, rawBlue);
    },
    fillColor(r: number, g: number, b: number) {
      style = DOT_FILL;
      rawRed = r; rawGreen = g; rawBlue = b;
      red = Math.max(0, Math.min(255, r)) / 255; green = Math.max(0, Math.min(255, g)) / 255; blue = Math.max(0, Math.min(255, b)) / 255; fillAlpha = 1;
    },
    fillEllipse(x: number, y: number, rx: number, ry: number, rotation: number, r: number, g: number, b: number) {
      if (alpha <= 0) return;
      const id = ++paths;
      if (!(rx > 0 && ry > 0)) return;
      pathMarks = true;
      const red = Math.max(0, Math.min(255, r)) / 255, green = Math.max(0, Math.min(255, g)) / 255, blue = Math.max(0, Math.min(255, b)) / 255;
      if (!exact) return write(x, y, rx, ry, rotation, red, green, blue, alpha, id);
      shape(x, y, rx, ry, rotation, id);
      filled(id, alpha, red, green, blue, true, r, g, b);
    },
  };
  /** The frame's marks on Canvas 2D, exactly as the calls recorded would have drawn them there. */
  const replay = () => {
    if (!fallback) fallback = new OffscreenCanvas(width, height).getContext("2d");
    const c = fallback;
    if (!c) return null;
    if (c.canvas.width !== width || c.canvas.height !== height) { c.canvas.width = width; c.canvas.height = height; }
    else c.clearRect(0, 0, width, height);
    for (let i = 0; i < count;) {
      const id = shapes[i * SHAPE + 5], f = id * FILL;
      c.globalAlpha = fills[f + 4];
      c.fillStyle = fills[f + 8] < 0 ? `rgb(${fills[f + 5]},${fills[f + 6]},${fills[f + 7]})` : styles[fills[f + 8]];
      c.beginPath();
      const many = i + 1 < count && shapes[(i + 1) * SHAPE + 5] === id;
      for (; i < count && shapes[i * SHAPE + 5] === id; i++) {
        const e = i * SHAPE, x = shapes[e], y = shapes[e + 1], rx = shapes[e + 2], ry = shapes[e + 3], rotation = shapes[e + 4];
        if (many) c.moveTo(x + rx, y);
        if (rx === ry && rotation === 0) c.arc(x, y, rx, 0, Math.PI * 2); else c.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2);
      }
      c.fill();
    }
    c.globalAlpha = 1;
    return c.canvas;
  };
  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    begin(w, h, mixed = true) {
      if (gl.isContextLost()) return false;
      if (skip > 0) { skip--; return false; }
      exact = mixed; largest = 0;
      width = w; height = h; count = 0; styles = []; discMarks = pathMarks = false; pathCount = 0; paths = 0; alpha = 1; style = "#000000"; red = green = blue = 0; fillAlpha = 1;
      return true;
    },
    finish() {
      if (discMarks && pathMarks && exact) { skip = 30; return replay(); }
      if (gl.isContextLost()) return null;
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      if (targetWidth !== width || targetHeight !== height) {
        targetWidth = width; targetHeight = height;
        gl.bindRenderbuffer(gl.RENDERBUFFER, target);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, width, height);
        gl.bindRenderbuffer(gl.RENDERBUFFER, depthTarget);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, width, height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, target);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthTarget);
        gl.bindRenderbuffer(gl.RENDERBUFFER, single);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, width, height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, resolved);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, single);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (count) {
        if (count * FLOATS > data.length) data = new Float32Array(Math.max(data.length * 2, count * FLOATS));
        if (exact) for (let i = 0; i < count; i++) {
          const e = i * SHAPE, id = shapes[e + 5], f = id * FILL, o = i * FLOATS;
          const rx = shapes[e + 2], ry = shapes[e + 3];
          if (rx > largest) largest = rx;
          if (ry > largest) largest = ry;
          data[o] = shapes[e]; data[o + 1] = shapes[e + 1]; data[o + 2] = rx; data[o + 3] = ry; data[o + 4] = shapes[e + 4];
          data[o + 5] = fills[f + 1]; data[o + 6] = fills[f + 2]; data[o + 7] = fills[f + 3]; data[o + 8] = fills[f]; data[o + 9] = id;
        }
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LESS);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, instances);
        gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * FLOATS), gl.STREAM_DRAW);
        if (discMarks && !pathMarks) {
          gl.useProgram(discs);
          gl.uniform2f(discSize, width, height);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
        } else {
          // Enough rim slots for the largest ellipse this frame (a circle bounds its ellipse's segment count).
          const n = Math.sqrt(Math.max(0, 2 * largest - .207)), slots = Math.min(64, 2 ** Math.ceil(Math.log2(Math.max(1, Math.ceil(n)))));
          gl.useProgram(program);
          gl.uniform2f(size, width, height);
          gl.uniform1i(slotsAt, slots);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, slots * 4 * 3, count);
        }
        gl.bindVertexArray(null);
      }
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      // Resolve the samples, then turn the frame the right way up.
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, resolved);
      gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, resolved);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, width, height, 0, height, width, 0, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return canvas;
    },
    destroy() {
      if (fallback) fallback.canvas.width = fallback.canvas.height = 1;
      gl.deleteProgram(program);
      gl.deleteProgram(discs);
      gl.deleteRenderbuffer(target);
      gl.deleteRenderbuffer(depthTarget);
      gl.deleteRenderbuffer(single);
      gl.deleteFramebuffer(framebuffer);
      gl.deleteFramebuffer(resolved);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.width = canvas.height = 1;
    },
  };
}
