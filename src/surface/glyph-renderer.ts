import { INK_TRAIL_GLSL, isDensityHover } from './ink-trail';
import type { AsciiFrame, AsciiOptions } from '../types';
import { SURFACE_LIGHT_GLSL, type SurfaceRefraction } from './water-surface';

/** A transparent hero renderer, not a replacement for the engine's effects. */
export function supportsGlyphRenderer(options: AsciiOptions): boolean {
  return options.renderMode === 'ascii' && options.artStyle === 'classic' &&
    options.animationStyle === 'none' && !options.charsetFrames?.length && options.hoverStrength === 0 &&
    ['fullcolor', 'accent', 'grayscale', 'matrix'].includes(options.colorMode) &&
    (options.colorMode !== 'accent' || /^#[\da-f]{6}$/i.test(options.accentColor));
}

function graphemes(value: string): string[] {
  const Segmenter = (Intl as unknown as {
    Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => {
      segment(input: string): Iterable<{ segment: string }>;
    };
  }).Segmenter;
  return Segmenter
    ? Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(value), item => item.segment)
    : Array.from(value);
}

export interface GlyphAtlasPlan {
  key: string;
  glyphs: string[];
  indices: Map<string, number>;
  cellWidth: number;
  cellHeight: number;
  fontSize: number;
  padding: number;
  tileWidth: number;
  tileHeight: number;
  atlasColumns: number;
  atlasWidth: number;
  atlasHeight: number;
}

/** Pure atlas planning; unchanged settings retain the same plan and glyph map. */
export function prepareGlyphAtlas(
  previous: GlyphAtlasPlan | null,
  options: Pick<AsciiOptions, 'charset' | 'customText'>,
  width: number, height: number, dpr: number, cols: number, rows: number,
  maxTextureSize = 4096, fontRevision = 0,
): GlyphAtlasPlan {
  if (![width, height, dpr, cols, rows, maxTextureSize].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('Glyph atlas dimensions must be positive and finite.');
  }
  const key = JSON.stringify([options.charset, options.customText, width, height, dpr, cols, rows, maxTextureSize, fontRevision]);
  if (previous?.key === key) return previous;
  // Each cell stores a whole glyph, including surrogate pairs and combining marks.
  const glyphs = [...new Set([' ', ...graphemes(options.charset), ...graphemes(options.customText ?? '')])];
  if (glyphs.length > 65_536) throw new Error('This character set exceeds the glyph texture capacity.');
  const cellWidth = width / cols, cellHeight = height / rows;
  // Match the published renderer's centered/middle text metrics, without its
  // small-font pixel substitution. Atlas dimensions are physical pixels.
  const fontSize = Math.min(cellWidth / .55, cellHeight) * .9;
  const padding = 2;
  const tileWidth = Math.ceil(cellWidth * dpr) + padding * 2;
  const tileHeight = Math.ceil(cellHeight * dpr) + padding * 2;
  const atlasColumns = Math.min(glyphs.length, Math.floor(maxTextureSize / tileWidth));
  if (atlasColumns < 1 || Math.ceil(glyphs.length / atlasColumns) * tileHeight > maxTextureSize) {
    throw new Error('The glyph atlas exceeds the available GPU texture size.');
  }
  return {
    key, glyphs, indices: new Map(glyphs.map((glyph, index) => [glyph, index])),
    cellWidth, cellHeight, fontSize, padding, tileWidth, tileHeight, atlasColumns,
    atlasWidth: atlasColumns * tileWidth,
    atlasHeight: Math.ceil(glyphs.length / atlasColumns) * tileHeight,
  };
}

export interface PackedGlyphFrame {
  cols: number;
  rows: number;
  indices: Uint8Array;
  colors: Uint8ClampedArray;
}

/** Pack exact 8-bit RGBA channels; no palette or high-nibble quantization. */
export function packGlyphFrame(
  frame: AsciiFrame, glyphIndices: ReadonlyMap<string, number>, options: AsciiOptions,
  previous?: PackedGlyphFrame, preserveEmpty = false,
): PackedGlyphFrame {
  const rows = frame.length, cols = frame[0]?.length ?? 0;
  const packed = previous?.cols === cols && previous.rows === rows ? previous : {
    cols, rows, indices: new Uint8Array(cols * rows * 4), colors: new Uint8ClampedArray(cols * rows * 4),
  };
  packed.indices.fill(0); packed.colors.fill(0);
  const accent = options.colorMode === 'accent'
    ? [1, 3, 5].map(start => parseInt(options.accentColor.slice(start, start + 2), 16)) : null;
  for (let y = 0; y < rows; y++) {
    if (frame[y].length !== cols) throw new Error('Glyph frames must have a rectangular cell grid.');
    for (let x = 0; x < cols; x++) {
      const cell = frame[y][x];
      if (!cell.char || (!preserveEmpty && cell.char === ' ') || cell.a < 10) continue;
      const index = glyphIndices.get(cell.char);
      if (index === undefined) throw new Error(`Glyph is absent from the configured character set: ${cell.char}`);
      const offset = (y * cols + x) * 4;
      let r = cell.r, g = cell.g, b = cell.b;
      if (accent) [r, g, b] = accent;
      else if (options.colorMode !== 'fullcolor') {
        const luminance = (r * .299 + g * .587 + b * .114) | 0;
        r = options.colorMode === 'matrix' ? 0 : luminance;
        g = luminance; b = r;
      }
      // Hero backgrounds leave black and empty cells transparent.
      if (!preserveEmpty && r === 0 && g === 0 && b === 0) continue;
      packed.indices[offset] = index & 255;
      packed.indices[offset + 1] = index >>> 8;
      packed.colors[offset] = r; packed.colors[offset + 1] = g; packed.colors[offset + 2] = b;
      packed.colors[offset + 3] = cell.a;
    }
  }
  return packed;
}

export interface GlyphRenderer {
  resize(width: number, height: number, dpr: number): void;
  render(frame: AsciiFrame, options: AsciiOptions, width: number, height: number, refraction?: SurfaceRefraction): void;
  destroy(): void;
}

const VERTEX_SHADER = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

const FRAGMENT_SHADER = `
precision highp float;
uniform sampler2D glyphs;
uniform sampler2D colors;
uniform sampler2D atlas;
uniform sampler2D surface;
uniform vec2 surfaceSize;
uniform float refractionStrength;
uniform vec2 resolution;
uniform vec2 sceneSize;
uniform vec2 gridSize;
uniform vec2 cellSize;
uniform vec2 atlasSize;
uniform vec2 tileSize;
uniform float atlasColumns;
uniform float padding;
uniform float glyphCount;
${INK_TRAIL_GLSL}
${SURFACE_LIGHT_GLSL}
void main() {
  vec2 pixel = vec2(gl_FragCoord.x, resolution.y - gl_FragCoord.y);
  if (pixel.x >= sceneSize.x || pixel.y >= sceneSize.y) {
    gl_FragColor = vec4(0.0); return;
  }
  if (refractionStrength > 0.0) {
    vec4 normal = texture2D(surface, ((pixel / sceneSize) * (surfaceSize - 1.0) + .5) / surfaceSize) * 255.0;
    vec2 slope = (vec2(normal.r * 256.0 + normal.g, normal.b * 256.0 + normal.a) - 32768.0) / 32767.0;
    // Refract the complete glyph surface: both grid and image bend continuously.
    // Pin two complete outer rows/columns, then ease into the water surface.
    // No displaced sample can expose a gap or pull the perimeter out of line.
    vec2 edgeCells = min(pixel, sceneSize - pixel) / cellSize;
    float edgeHold = smoothstep(2.0, 8.0, min(edgeCells.x, edgeCells.y));
    pixel -= slope * refractionStrength * edgeHold;
    if (pixel.x < 0.0 || pixel.y < 0.0 || pixel.x >= sceneSize.x || pixel.y >= sceneSize.y) {
      gl_FragColor = vec4(0.0); return;
    }
  }
  vec2 cell = floor(pixel / cellSize);
  vec2 address = (cell + 0.5) / gridSize;
  vec2 code = floor(texture2D(glyphs, address).rg * 255.0 + 0.5);
  float index = code.x + code.y * 256.0;
  vec4 color = texture2D(colors, address);
  float density = trailAmount > 0.0 ? trailDensity(address) : 0.0;
  index = trailIndex(index, glyphCount, density, cell);
  color.rgb = trailInk(color.rgb, density);
  if (index < 0.5 || color.a == 0.0) {
    gl_FragColor = vec4(0.0); return;
  }
  vec2 slot = vec2(mod(index, atlasColumns), floor(index / atlasColumns));
  vec2 local = pixel - cell * cellSize;
  vec2 uv = (slot * tileSize + vec2(padding) + local) / atlasSize;
  float alpha = texture2D(atlas, uv).a * color.a;
  // Canvas drawImage expects this context's premultiplied RGBA output.
  gl_FragColor = vec4(illuminate(color.rgb, surfaceLight(address, sceneSize)) * alpha, alpha);
}
`;

/**
 * One GPU draw for a transparent, static ASCII hero. Use a dedicated canvas:
 * even failed WebGL initialization can prevent getContext('2d') on that canvas.
 * Copy it immediately after render() when preserveDrawingBuffer is false.
 * Unsupported options or context failure throw and call onError once; the caller
 * owns fallback to its separate Canvas2D renderer. Font loads invalidate the
 * atlas on the next render, so paused callers should request a refresh then.
 */
export function createGlyphRenderer(canvas: HTMLCanvasElement, onError?: (error: Error) => void): GlyphRenderer | null {
  let gl: WebGLRenderingContext | null;
  try {
    gl = canvas.getContext('webgl', {
      alpha: true, antialias: false, premultipliedAlpha: true,
      depth: false, stencil: false, preserveDrawingBuffer: false,
    });
  } catch (error) {
    onError?.(error instanceof Error ? error : new Error('WebGL is unavailable.'));
    return null;
  }
  if (!gl) { onError?.(new Error('WebGL is unavailable.')); return null; }
  const gpu = gl;
  const textures: WebGLTexture[] = [], shaders: WebGLShader[] = [];
  let program: WebGLProgram | null = null, buffer: WebGLBuffer | null = null;
  let disposed = false, failure: Error | null = null;
  let dpr = 1, fontRevision = 0, plan: GlyphAtlasPlan | null = null;
  let packed: PackedGlyphFrame | undefined, uploadedCols = 0, uploadedRows = 0;
  const maxTextureSize = gpu.getParameter(gpu.MAX_TEXTURE_SIZE) as number;
  const fail = (error: unknown): Error => {
    if (!failure) {
      failure = error instanceof Error ? error : new Error(String(error));
      onError?.(failure);
    }
    return failure;
  };
  const removeResources = () => {
    textures.forEach(texture => gpu.deleteTexture(texture));
    shaders.forEach(shader => gpu.deleteShader(shader));
    if (buffer) gpu.deleteBuffer(buffer);
    if (program) gpu.deleteProgram(program);
  };
  const check = () => {
    if (disposed) throw new Error('The glyph renderer has been destroyed.');
    if (failure) throw failure;
  };
  try {
    const compile = (type: number, source: string) => {
      const shader = gpu.createShader(type);
      if (!shader) throw new Error('Could not allocate a glyph shader.');
      shaders.push(shader); gpu.shaderSource(shader, source); gpu.compileShader(shader);
      if (!gpu.getShaderParameter(shader, gpu.COMPILE_STATUS)) throw new Error(gpu.getShaderInfoLog(shader) || 'Glyph shader compilation failed.');
      return shader;
    };
    program = gpu.createProgram();
    if (!program) throw new Error('Could not allocate the glyph shader program.');
    gpu.attachShader(program, compile(gpu.VERTEX_SHADER, VERTEX_SHADER));
    gpu.attachShader(program, compile(gpu.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gpu.linkProgram(program);
    if (!gpu.getProgramParameter(program, gpu.LINK_STATUS)) throw new Error(gpu.getProgramInfoLog(program) || 'Glyph shader linking failed.');
    gpu.useProgram(program);
    buffer = gpu.createBuffer();
    if (!buffer) throw new Error('Could not allocate the glyph draw buffer.');
    gpu.bindBuffer(gpu.ARRAY_BUFFER, buffer);
    gpu.bufferData(gpu.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gpu.STATIC_DRAW);
    const position = gpu.getAttribLocation(program, 'position');
    gpu.enableVertexAttribArray(position); gpu.vertexAttribPointer(position, 2, gpu.FLOAT, false, 0, 0);
    const locations = Object.fromEntries([
      'glyphs', 'colors', 'atlas', 'resolution', 'sceneSize', 'gridSize', 'cellSize',
      'atlasSize', 'tileSize', 'atlasColumns', 'padding', 'surface', 'surfaceSize', 'refractionStrength', 'hoverMode', 'hoverFocus', 'trailKind', 'trailAmount', 'glyphCount',
    ].map(name => [name, gpu.getUniformLocation(program!, name)]));
    const texture = (unit: number, filter: number) => {
      const result = gpu.createTexture();
      if (!result) throw new Error('Could not allocate a glyph texture.');
      textures.push(result); gpu.activeTexture(gpu.TEXTURE0 + unit); gpu.bindTexture(gpu.TEXTURE_2D, result);
      gpu.texParameteri(gpu.TEXTURE_2D, gpu.TEXTURE_MIN_FILTER, filter);
      gpu.texParameteri(gpu.TEXTURE_2D, gpu.TEXTURE_MAG_FILTER, filter);
      gpu.texParameteri(gpu.TEXTURE_2D, gpu.TEXTURE_WRAP_S, gpu.CLAMP_TO_EDGE);
      gpu.texParameteri(gpu.TEXTURE_2D, gpu.TEXTURE_WRAP_T, gpu.CLAMP_TO_EDGE);
      return result;
    };
    const glyphTexture = texture(0, gpu.NEAREST), colorTexture = texture(1, gpu.NEAREST), atlasTexture = texture(2, gpu.LINEAR);
    const surfaceTexture = texture(3, gpu.LINEAR);
    gpu.texImage2D(gpu.TEXTURE_2D, 0, gpu.RGBA, 1, 1, 0, gpu.RGBA, gpu.UNSIGNED_BYTE, new Uint8Array([128, 0, 128, 0]));
    gpu.uniform1i(locations.surface, 3);
    let surfaceWidth = 1, surfaceHeight = 1;
    let uploadedFrame: AsciiFrame | undefined;
    gpu.uniform1i(locations.glyphs, 0); gpu.uniform1i(locations.colors, 1); gpu.uniform1i(locations.atlas, 2);
    gpu.pixelStorei(gpu.UNPACK_ALIGNMENT, 1);
    gpu.pixelStorei(gpu.UNPACK_FLIP_Y_WEBGL, false);
    gpu.pixelStorei(gpu.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gpu.pixelStorei(gpu.UNPACK_COLORSPACE_CONVERSION_WEBGL, gpu.NONE);
    gpu.disable(gpu.BLEND); gpu.disable(gpu.DEPTH_TEST); gpu.disable(gpu.DITHER);
    gpu.clearColor(0, 0, 0, 0);
    const atlasCanvas = document.createElement('canvas');
    const atlasCtx = atlasCanvas.getContext('2d');
    if (!atlasCtx) throw new Error('Could not create the glyph atlas canvas.');
    const resize = (width: number, height: number, ratio: number) => {
      check();
      if (![width, height, ratio].every(value => Number.isFinite(value) && value > 0)) {
        throw fail(new Error('Glyph render dimensions must be positive and finite.'));
      }
      dpr = ratio;
      const physicalWidth = Math.max(1, Math.round(width * ratio)), physicalHeight = Math.max(1, Math.round(height * ratio));
      if (canvas.width !== physicalWidth) canvas.width = physicalWidth;
      if (canvas.height !== physicalHeight) canvas.height = physicalHeight;
      gpu.viewport(0, 0, canvas.width, canvas.height);
    };
    const render = (frame: AsciiFrame, options: AsciiOptions, width: number, height: number, refraction?: SurfaceRefraction) => {
      check();
      try {
        if (!supportsGlyphRenderer(options)) throw new Error('These options require the full Canvas2D engine renderer.');
        resize(width, height, dpr);
        if (!frame.length || !frame[0].length) { gpu.clear(gpu.COLOR_BUFFER_BIT); return; }
        const cols = frame[0].length, rows = frame.length;
        if (cols > maxTextureSize || rows > maxTextureSize) throw new Error('The cell grid exceeds the available GPU texture size.');
        const nextPlan = prepareGlyphAtlas(plan, options, width, height, dpr, cols, rows, maxTextureSize, fontRevision);
        const atlasChanged = nextPlan !== plan;
        if (atlasChanged) {
          atlasCanvas.width = nextPlan.atlasWidth; atlasCanvas.height = nextPlan.atlasHeight;
          atlasCtx.fillStyle = '#fff'; atlasCtx.textAlign = 'center'; atlasCtx.textBaseline = 'middle';
          atlasCtx.font = `${nextPlan.fontSize * dpr}px "JetBrains Mono", monospace`;
          nextPlan.glyphs.forEach((glyph, index) => {
            if (index === 0) return;
            const x = (index % nextPlan.atlasColumns) * nextPlan.tileWidth + nextPlan.padding + nextPlan.cellWidth * dpr * .5;
            const y = Math.floor(index / nextPlan.atlasColumns) * nextPlan.tileHeight + nextPlan.padding + nextPlan.cellHeight * dpr * .5;
            atlasCtx.fillText(glyph, x, y);
          });
          gpu.activeTexture(gpu.TEXTURE2); gpu.bindTexture(gpu.TEXTURE_2D, atlasTexture);
          gpu.texImage2D(gpu.TEXTURE_2D, 0, gpu.RGBA, gpu.RGBA, gpu.UNSIGNED_BYTE, atlasCanvas);
          if (gpu.getError() !== gpu.NO_ERROR) throw new Error('Could not upload the glyph atlas.');
        }
        plan = nextPlan;
        const frameChanged = !refraction || uploadedFrame !== frame || atlasChanged;
        if (frameChanged) packed = packGlyphFrame(frame, plan.indices, options, packed, true);
        const changedGrid = uploadedCols !== cols || uploadedRows !== rows;
        const upload = (unit: number, targetTexture: WebGLTexture, data: Uint8Array | Uint8ClampedArray) => {
          gpu.activeTexture(gpu.TEXTURE0 + unit); gpu.bindTexture(gpu.TEXTURE_2D, targetTexture);
          if (changedGrid) gpu.texImage2D(gpu.TEXTURE_2D, 0, gpu.RGBA, cols, rows, 0, gpu.RGBA, gpu.UNSIGNED_BYTE, data);
          else gpu.texSubImage2D(gpu.TEXTURE_2D, 0, 0, 0, cols, rows, gpu.RGBA, gpu.UNSIGNED_BYTE, data);
        };
        if (frameChanged) {
          upload(0, glyphTexture, packed!.indices); upload(1, colorTexture, packed!.colors);
          uploadedFrame = frame;
        }
        if (refraction) {
          gpu.activeTexture(gpu.TEXTURE3); gpu.bindTexture(gpu.TEXTURE_2D, surfaceTexture);
          if (surfaceWidth !== refraction.width || surfaceHeight !== refraction.height) {
            gpu.texImage2D(gpu.TEXTURE_2D, 0, gpu.RGBA, refraction.width, refraction.height, 0, gpu.RGBA, gpu.UNSIGNED_BYTE, refraction.pixels);
            surfaceWidth = refraction.width; surfaceHeight = refraction.height;
          } else gpu.texSubImage2D(gpu.TEXTURE_2D, 0, 0, 0, refraction.width, refraction.height, gpu.RGBA, gpu.UNSIGNED_BYTE, refraction.pixels);
        }
        gpu.uniform1f(locations.trailKind,refraction?.mode==='dissolve'?2:0);
        gpu.uniform1f(locations.trailAmount, refraction && isDensityHover(refraction.mode) ? refraction.focus[2] : 0);
        gpu.uniform1f(locations.glyphCount, plan.glyphs.length);
        gpu.uniform1f(locations.hoverMode, refraction?.mode === 'light' ? 1 : refraction?.mode === 'scan' ? 2 : 0);
        gpu.uniform4fv(locations.hoverFocus, refraction?.focus ?? [.5, .5, 0, .2]);
        gpu.uniform2f(locations.surfaceSize, surfaceWidth, surfaceHeight);
        gpu.uniform1f(locations.refractionStrength, (refraction?.strength ?? 0) * dpr);
        if (changedGrid && gpu.getError() !== gpu.NO_ERROR) throw new Error('Could not upload the glyph cell grid.');
        uploadedCols = cols; uploadedRows = rows;
        gpu.uniform2f(locations.resolution, canvas.width, canvas.height);
        gpu.uniform2f(locations.sceneSize, width * dpr, height * dpr);
        gpu.uniform2f(locations.gridSize, cols, rows);
        gpu.uniform2f(locations.cellSize, plan.cellWidth * dpr, plan.cellHeight * dpr);
        gpu.uniform2f(locations.atlasSize, plan.atlasWidth, plan.atlasHeight);
        gpu.uniform2f(locations.tileSize, plan.tileWidth, plan.tileHeight);
        gpu.uniform1f(locations.atlasColumns, plan.atlasColumns); gpu.uniform1f(locations.padding, plan.padding);
        gpu.drawArrays(gpu.TRIANGLE_STRIP, 0, 4);
      } catch (error) { throw fail(error); }
    };
    const fontLoaded = () => { fontRevision++; };
    const contextLost = () => { fail(new Error('The glyph GPU context was lost.')); };
    document.fonts?.addEventListener('loadingdone', fontLoaded);
    canvas.addEventListener('webglcontextlost', contextLost);
    return {
      resize, render,
      destroy() {
        if (disposed) return;
        disposed = true;
        document.fonts?.removeEventListener('loadingdone', fontLoaded);
        canvas.removeEventListener('webglcontextlost', contextLost);
        removeResources(); plan = null; packed = undefined;
        atlasCanvas.width = atlasCanvas.height = 1;
        gpu.getExtension('WEBGL_lose_context')?.loseContext();
      },
    };
  } catch (error) {
    fail(error); removeResources();
    return null;
  }
}
