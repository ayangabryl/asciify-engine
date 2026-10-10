import { FIELD_VERTEX, fieldCompositeShader, fieldFluidShader } from './field-shaders';
import { createStableFluid, type StableFluid } from './field-fluid';
import { InkTrail } from '../surface/ink-trail';
import {
  activeFieldHover, fieldCellLayout, fieldGlyphs, fieldLevels, fieldSourceRect, normalizeFieldSettings, parseFieldColor,
  type GlyphFieldInput, type GlyphFieldSettings,
} from './field-model';

export type FieldSource = string | HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | ImageBitmap;

export interface GlyphFieldOptions extends GlyphFieldInput {
  /** Image or video URL, or a decoded element. Without one, `scene` draws generated motion. */
  source?: FieldSource | null;
  /** Where pointer movement is read. Defaults to the window, so overlaid text never blocks the wake. */
  interactionTarget?: HTMLElement | Window | null;
  /** Accessible name for the canvas. */
  label?: string;
  onError?: (error: Error) => void;
}

export interface GlyphField {
  readonly canvas: HTMLCanvasElement;
  /** Resolves once the first frame with the current source has been drawn. */
  readonly ready: Promise<void>;
  /** Merges settings; only the parts that changed are rebuilt. */
  update(options: GlyphFieldOptions): void;
  setSource(source: FieldSource | null): Promise<void>;
  /** Moves the wake programmatically, in CSS pixels relative to the canvas. `null` lifts the pointer. */
  pointer(x: number | null, y?: number): void;
  /** Draws the current frame now, so the canvas can be read with drawImage in the same task. */
  redraw(): void;
  play(): void;
  pause(): void;
  resize(): void;
  destroy(): void;
  readonly settings: GlyphFieldSettings;
}

const VIDEO = /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i;

let tier: 'gpu' | 'software' | 'none' | undefined;
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i;
/** 'gpu', 'software' (WebGL2 emulated on the CPU, such as SwiftShader or llvmpipe) or 'none'. Probed once per page. */
export function glyphFieldTier(): 'gpu' | 'software' | 'none' {
  if (tier) return tier;
  if (typeof document === 'undefined' || typeof (globalThis as { WebGL2RenderingContext?: unknown }).WebGL2RenderingContext === 'undefined') return (tier = 'none');
  try {
    const probe = document.createElement('canvas').getContext('webgl2');
    if (!probe) return (tier = 'none');
    const info = probe.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(probe.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : probe.RENDERER) ?? '');
    probe.getExtension('WEBGL_lose_context')?.loseContext();
    return (tier = SOFTWARE.test(renderer) ? 'software' : 'gpu');
  } catch {
    return (tier = 'none');
  }
}

/**
 * True when WebGL2 runs on a GPU. Software WebGL draws every pixel on the CPU and would starve the rest of the page,
 * so it reports false unless `allowSoftware` is set. Mounting can still fail on a blocked GPU, so handle errors.
 */
export function isGlyphFieldSupported(options: { allowSoftware?: boolean } = {}) {
  const found = glyphFieldTier();
  return found === 'gpu' || (found === 'software' && !!options.allowSoftware);
}

/**
 * A GPU character field: every cell samples the source once and draws its glyph texel for texel,
 * while a small advected fluid bends the sampling and lifts characters under the cursor.
 * Idle fields stop drawing until the pointer, a video frame or generated motion needs a new frame.
 */
export function mountGlyphField(canvas: HTMLCanvasElement, options: GlyphFieldOptions = {}): GlyphField {
  let settings = normalizeFieldSettings(options);
  const onError = options.onError;
  const maybeGl = canvas.getContext('webgl2', { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, powerPreference: 'high-performance' });
  if (!maybeGl) throw new Error('WebGL2 is not available for the glyph field.');
  const gl: WebGL2RenderingContext = maybeGl;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', options.label ?? 'ASCII artwork');
  canvas.dataset.renderer = 'glyph-field';

  let packed = false;
  let composite: WebGLProgram, fluidProgram: WebGLProgram;
  let compositeAt: Record<string, WebGLUniformLocation | null> = {}, fluidAt: Record<string, WebGLUniformLocation | null> = {};
  let atlasTexture: WebGLTexture, sourceTexture: WebGLTexture;
  let fluidTextures: WebGLTexture[] = [], fluidBuffers: WebGLFramebuffer[] = [];
  // The incompressible solver curls and lingers like ink in water; the single-pass wake is its fallback.
  let stable: StableFluid | null = null, stableOn = false;
  let vertexArray: WebGLVertexArrayObject | null = null;
  const shaders: WebGLShader[] = [];

  let width = 0, height = 0, pixelRatio = 1, atlasRatio = 0;
  let layout = fieldCellLayout(settings.cellSize, settings.cellAspect, 1, 2), glyphCount = 2;
  let simWidth = 0, simHeight = 0, read = 0;
  let source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | ImageBitmap | null = null;
  let ownedVideo: HTMLVideoElement | null = null, sourceWidth = 0, sourceHeight = 0, sourceToken = 0;
  let videoFresh = true, videoCallback = 0, levels: [number, number] = [0, 1], levelsAt = -Infinity;
  let raf = 0, last = 0, time = 0, dirty = true, destroyed = false, lost = false, paused = false, visible = true;
  let previous: [number, number] | null = null, pending: { from: [number, number]; to: [number, number] } | null = null;
  // Slow frames for about a second drop the field to 1x pixels, then to no ambient motion; the wake keeps working.
  let frameCost = 1 / 60, slowFrames = 0, degraded = 0;
  // Lantern: the light glides toward the pointer, and its recent positions fade as a short tail.
  const lantern = { target: null as [number, number] | null, at: null as [number, number] | null, strength: 0, trail: [] as { x: number; y: number; born: number }[] };
  const trailUniform = new Float32Array(36);
  // Trail: the studio's own ink field, stepped on the CPU at 128 cells and uploaded as a small texture.
  let inkTrail: InkTrail | null = null, trailTexture: WebGLTexture | null = null, trailUploaded = false;
  const ensureTrail = () => {
    if (!width || !height) return null;
    const aspect = width / height;
    const columns = Math.round(aspect >= 1 ? 128 : 128 * aspect), rows = Math.round(aspect >= 1 ? 128 / aspect : 128);
    if (!inkTrail || inkTrail.width !== columns || inkTrail.height !== rows) {
      inkTrail = new InkTrail(columns, rows);
      if (!trailTexture) trailTexture = texture(gl.LINEAR);
      gl.bindTexture(gl.TEXTURE_2D, trailTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, columns, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, inkTrail.pixels);
      trailUploaded = true;
    }
    return inkTrail;
  };
  const stepTrail = (dt: number) => {
    const trail = ensureTrail();
    if (!trail || !trail.active) return false;
    trail.step(dt);
    gl.bindTexture(gl.TEXTURE_2D, trailTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, trail.width, trail.height, gl.RGBA, gl.UNSIGNED_BYTE, trail.pixels);
    trailUploaded = true;
    return true;
  };
  const stepLantern = (dt: number, now: number) => {
    const options = settings.lantern;
    if (lantern.target) {
      if (!lantern.at || reduced()) lantern.at = [...lantern.target];
      else {
        const k = 1 - Math.exp(-options.follow * dt);
        lantern.at = [lantern.at[0] + (lantern.target[0] - lantern.at[0]) * k, lantern.at[1] + (lantern.target[1] - lantern.at[1]) * k];
      }
      const lastPoint = lantern.trail[lantern.trail.length - 1];
      if (options.trail > 0 && (!lastPoint || (now - lastPoint.born > 28 && Math.hypot(lantern.at[0] - lastPoint.x, lantern.at[1] - lastPoint.y) > 0.004))) {
        lantern.trail.push({ x: lantern.at[0], y: lantern.at[1], born: now });
        if (lantern.trail.length > 12) lantern.trail.shift();
      }
    }
    lantern.strength += ((lantern.target ? 1 : 0) - lantern.strength) * (1 - Math.exp(-dt * (lantern.target ? 9 : 5)));
    lantern.trail = lantern.trail.filter(point => options.trail > 0 && now - point.born < options.trail * 4000);
    trailUniform.fill(0);
    lantern.trail.forEach((point, index) => {
      trailUniform[index * 3] = point.x; trailUniform[index * 3 + 1] = point.y;
      trailUniform[index * 3 + 2] = 0.55 * Math.exp(-(now - point.born) / 1000 / Math.max(0.01, options.trail));
    });
    return lantern.strength > 0.003 || lantern.trail.length > 0;
  };
  let activeUntil = 0;
  const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduced = () => settings.respectReducedMotion && !!reducedQuery?.matches;

  let resolveReady!: () => void;
  const ready = new Promise<void>(resolve => { resolveReady = resolve; });
  let readyPending = true;

  const compile = (type: number, code: string) => {
    const shader = gl.createShader(type)!;
    shaders.push(shader);
    gl.shaderSource(shader, code);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Glyph field shader failed to compile.');
    return shader;
  };
  const link = (fragment: string, names: string[]) => {
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, FIELD_VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Glyph field program failed to link.');
    return { program, at: Object.fromEntries(names.map(name => [name, gl.getUniformLocation(program, name)])) };
  };
  const texture = (filter: number) => {
    const handle = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, handle);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === gl.LINEAR_MIPMAP_LINEAR ? gl.LINEAR : filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return handle;
  };

  const releaseFluid = () => {
    stable?.release();
    stableOn = false;
    fluidTextures.forEach(handle => gl.deleteTexture(handle));
    fluidBuffers.forEach(handle => gl.deleteFramebuffer(handle));
    fluidTextures = []; fluidBuffers = [];
  };
  const resizeFluid = () => {
    releaseFluid();
    if (!settings.fluid || !width || !height) return;
    const resolution = settings.fluid.resolution, aspect = width / height;
    simWidth = aspect >= 1 ? resolution : Math.max(8, Math.round(resolution * aspect));
    simHeight = aspect >= 1 ? Math.max(8, Math.round(resolution / aspect)) : resolution;
    stableOn = !!stable && stable.resize(simWidth, simHeight);
    if (stableOn) { read = 0; return; }
    const allocate = () => {
      releaseFluid();
      for (let i = 0; i < 2; i++) {
        const handle = texture(gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, packed ? gl.RGBA8 : gl.RGBA16F, simWidth, simHeight, 0, gl.RGBA, packed ? gl.UNSIGNED_BYTE : gl.HALF_FLOAT, null);
        const buffer = gl.createFramebuffer()!;
        gl.bindFramebuffer(gl.FRAMEBUFFER, buffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, handle, 0);
        fluidTextures.push(handle); fluidBuffers.push(buffer);
      }
      return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    };
    if (!allocate()) {
      if (packed) throw new Error('The glyph field could not allocate its fluid buffers.');
      packed = true;
      buildPrograms();
      allocate();
    }
    for (const buffer of fluidBuffers) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, buffer);
      gl.viewport(0, 0, simWidth, simHeight);
      gl.clearColor(packed ? 0.5 : 0, packed ? 0.5 : 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    read = 0;
  };

  function buildPrograms() {
    if (composite) gl.deleteProgram(composite);
    if (fluidProgram) gl.deleteProgram(fluidProgram);
    const c = link(fieldCompositeShader(packed), ['uSource', 'uAtlas', 'uFluid', 'uResolution', 'uCell', 'uCount', 'uColumns', 'uSourceMap', 'uScene', 'uInk', 'uHighlight', 'uBackground', 'uBrightness', 'uContrast', 'uGamma', 'uInvert', 'uVignette', 'uSourceColor', 'uRefraction', 'uGlow', 'uTime', 'uDrift', 'uFluidOn', 'uLod', 'uSaturation', 'uBackdrop', 'uLevels', 'uShade', 'uHighlightAuto', 'uFluidMode', 'uFluidTexel', 'uHoverMode', 'uLight', 'uTrail', 'uLightRadius', 'uLightGain', 'uClock', 'uFlicker', 'uTrailMap', 'uTrailAmount']);
    const f = link(fieldFluidShader(packed), ['uPrevious', 'uSize', 'uAspect', 'uDt', 'uDecay', 'uEnergyDecay', 'uRadius', 'uSplat', 'uFrom', 'uTo', 'uForce']);
    composite = c.program; compositeAt = c.at;
    fluidProgram = f.program; fluidAt = f.at;
    stable?.dispose();
    stable = packed ? null : createStableFluid(gl, link);
  }

  const fontString = () => `${settings.fontWeight} ${Math.max(1, layout.height * settings.glyphScale)}px ${settings.font}`;
  const buildAtlas = () => {
    const glyphs = fieldGlyphs(settings.charset);
    glyphCount = glyphs.length;
    layout = fieldCellLayout(settings.cellSize, settings.cellAspect, pixelRatio, glyphCount);
    atlasRatio = pixelRatio;
    const paint = document.createElement('canvas');
    paint.width = layout.atlasWidth; paint.height = layout.atlasHeight;
    const context = paint.getContext('2d')!;
    context.fillStyle = '#fff';
    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';
    context.font = fontString();
    const capital = context.measureText('M');
    const ascent = capital.actualBoundingBoxAscent || layout.height * settings.glyphScale * 0.7;
    const descent = capital.actualBoundingBoxDescent || 0;
    const baseline = (layout.height + ascent - descent) / 2;
    glyphs.forEach((glyph, index) => {
      const x = (index % layout.columns) * layout.width + layout.width / 2;
      const y = Math.floor(index / layout.columns) * layout.height + baseline;
      const measured = context.measureText(glyph).width;
      context.save();
      context.beginPath();
      context.rect(x - layout.width / 2, y - baseline, layout.width, layout.height);
      context.clip();
      context.translate(x, y);
      if (measured > layout.width * 0.96) context.scale((layout.width * 0.96) / measured, 1);
      context.fillText(glyph, 0, 0);
      context.restore();
    });
    gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, paint);
    paint.width = paint.height = 1;
    dirty = true;
  };
  const awaitFont = () => {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (!fonts?.load) return;
    const font = fontString();
    void fonts.load(font, fieldGlyphs(settings.charset).join('')).then(() => {
      if (destroyed || lost || fontString() !== font) return;
      buildAtlas();
      wake();
    }, () => {});
  };

  const measureLevels = () => {
    levels = [0, 1];
    if (!source || settings.levels === 'none') return;
    try {
      const probe = document.createElement('canvas');
      probe.width = probe.height = 64;
      const context = probe.getContext('2d', { willReadFrequently: true })!;
      context.drawImage(source as CanvasImageSource, 0, 0, 64, 64);
      levels = fieldLevels(context.getImageData(0, 0, 64, 64).data);
    } catch {
      levels = [0, 1];
    }
  };
  const uploadSource = () => {
    if (!source) return;
    const now = performance.now();
    if (!(source instanceof HTMLVideoElement) || now - levelsAt > 1500) { measureLevels(); levelsAt = now; }
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
      gl.generateMipmap(gl.TEXTURE_2D);
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  };

  const init = () => {
    packed = !gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float');
    buildPrograms();
    vertexArray = gl.createVertexArray();
    atlasTexture = texture(gl.NEAREST);
    sourceTexture = texture(gl.LINEAR_MIPMAP_LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    gl.generateMipmap(gl.TEXTURE_2D);
    width = height = 0;
    measure();
    buildAtlas();
    awaitFont();
    resizeFluid();
    if (source) uploadSource();
  };

  function measure() {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(globalThis.devicePixelRatio || 1, settings.maxPixelRatio);
    const nextWidth = Math.max(1, Math.round(rect.width * ratio)), nextHeight = Math.max(1, Math.round(rect.height * ratio));
    if (nextWidth === width && nextHeight === height && ratio === pixelRatio) return false;
    const aspectChanged = !width || Math.abs(nextWidth / nextHeight - width / height) > 0.01;
    pixelRatio = ratio; width = nextWidth; height = nextHeight;
    canvas.width = width; canvas.height = height;
    if (atlasTexture && atlasRatio !== pixelRatio) buildAtlas();
    if (fluidProgram && (aspectChanged || !fluidTextures.length)) resizeFluid();
    dirty = true;
    return true;
  }

  const animated = () => {
    if (paused) return false;
    if (degraded >= 2 && !(source instanceof HTMLVideoElement)) return false;
    const playingVideo = source instanceof HTMLVideoElement && !source.paused && !source.ended;
    if (playingVideo) return true;
    if (reduced()) return false;
    return (!source && settings.scene !== 'none') || settings.drift > 0;
  };

  const stepFluid = (dt: number, now: number) => {
    const fluid = settings.fluid;
    if (!fluid || (!fluidBuffers.length && !stableOn)) return;
    const aspect = width / height;
    const splat = pending;
    pending = null;
    if (stableOn && stable) {
      // Pointer travel in field UV becomes velocity in simulation texels per second.
      const push = 5200 * fluid.force * (reduced() ? 0.35 : 1);
      if (splat) activeUntil = now + Math.min(9, 6 / Math.max(0.3, fluid.dissipation)) * 1000;
      stable.step(splat ? { from: splat.from, to: splat.to, force: [(splat.to[0] - splat.from[0]) * push, (splat.to[1] - splat.from[1]) * push] } : null,
        { dt: Math.min(dt, 1 / 60), radius: fluid.radius * 1.1, curl: fluid.curl, dissipation: fluid.dissipation, aspect });
      return;
    }
    let force: [number, number] = [0, 0];
    if (splat) {
      const scale = (reduced() ? 1 : 3) * fluid.force;
      force = [(splat.to[0] - splat.from[0]) * aspect * scale * 4, (splat.to[1] - splat.from[1]) * scale * 4];
      activeUntil = now + (7 / Math.min(fluid.dissipation, fluid.dissipation * 1.1)) * 1000;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fluidBuffers[1 - read]);
    gl.viewport(0, 0, simWidth, simHeight);
    gl.useProgram(fluidProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fluidTextures[read]);
    gl.uniform1i(fluidAt.uPrevious, 0);
    gl.uniform2f(fluidAt.uSize, simWidth, simHeight);
    gl.uniform1f(fluidAt.uAspect, aspect);
    gl.uniform1f(fluidAt.uDt, dt);
    gl.uniform1f(fluidAt.uDecay, fluid.dissipation);
    gl.uniform1f(fluidAt.uEnergyDecay, fluid.dissipation * 1.1);
    gl.uniform1f(fluidAt.uRadius, fluid.radius);
    gl.uniform1f(fluidAt.uSplat, splat ? 1 : 0);
    gl.uniform2f(fluidAt.uFrom, splat?.from[0] ?? 0, splat?.from[1] ?? 0);
    gl.uniform2f(fluidAt.uTo, splat?.to[0] ?? 0, splat?.to[1] ?? 0);
    gl.uniform2f(fluidAt.uForce, force[0], force[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    read = 1 - read;
  };

  const draw = () => {
    const fluid = settings.fluid;
    const map = fieldSourceRect(width, height, sourceWidth || 1, sourceHeight || 1, settings.fit, settings.focus);
    const texelsPerCell = source && sourceHeight ? (layout.height / height) * sourceHeight * map.scale[1] : 1;
    const background = settings.background === 'transparent' ? [0, 0, 0, 0] : [...parseFieldColor(settings.background), 1];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.useProgram(composite);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sourceTexture); gl.uniform1i(compositeAt.uSource, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, atlasTexture); gl.uniform1i(compositeAt.uAtlas, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, (stableOn ? stable?.velocity : fluidTextures[read]) ?? sourceTexture); gl.uniform1i(compositeAt.uFluid, 2);
    gl.uniform1f(compositeAt.uFluidMode, stableOn ? 1 : 0);
    const hover = activeFieldHover(settings);
    gl.uniform1i(compositeAt.uHoverMode, hover === 'fluid' ? 1 : hover === 'lantern' ? 2 : hover === 'trail' && trailUploaded ? 3 : 0);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, trailTexture ?? sourceTexture); gl.uniform1i(compositeAt.uTrailMap, 3);
    gl.uniform1f(compositeAt.uTrailAmount, settings.trail.strength);
    gl.uniform3f(compositeAt.uLight, lantern.at?.[0] ?? -1, lantern.at?.[1] ?? -1, hover === 'lantern' ? lantern.strength : 0);
    gl.uniform3fv(compositeAt.uTrail, trailUniform);
    gl.uniform1f(compositeAt.uLightRadius, settings.lantern.radius);
    gl.uniform1f(compositeAt.uLightGain, settings.lantern.strength);
    gl.uniform1f(compositeAt.uClock, performance.now() / 1000);
    gl.uniform1f(compositeAt.uFlicker, reduced() ? 0 : 1);
    gl.uniform2f(compositeAt.uFluidTexel, 1 / Math.max(1, simWidth), 1 / Math.max(1, simHeight));
    gl.uniform2f(compositeAt.uResolution, width, height);
    gl.uniform2f(compositeAt.uCell, layout.width, layout.height);
    gl.uniform1f(compositeAt.uCount, glyphCount);
    gl.uniform1f(compositeAt.uColumns, layout.columns);
    gl.uniform4f(compositeAt.uSourceMap, map.scale[0], map.scale[1], map.offset[0], map.offset[1]);
    gl.uniform1i(compositeAt.uScene, source ? 0 : settings.scene === 'flow' ? 1 : settings.scene === 'orb' ? 2 : 3);
    gl.uniform3fv(compositeAt.uInk, parseFieldColor(settings.ink));
    gl.uniform3fv(compositeAt.uHighlight, parseFieldColor(settings.highlight === 'auto' ? '#ffffff' : settings.highlight));
    gl.uniform1f(compositeAt.uHighlightAuto, settings.highlight === 'auto' ? 1 : 0);
    gl.uniform4fv(compositeAt.uBackground, background);
    gl.uniform1f(compositeAt.uBrightness, settings.brightness);
    gl.uniform1f(compositeAt.uContrast, settings.contrast);
    gl.uniform1f(compositeAt.uGamma, settings.gamma);
    gl.uniform1f(compositeAt.uInvert, settings.invert ? 1 : 0);
    gl.uniform1f(compositeAt.uVignette, settings.vignette);
    gl.uniform1f(compositeAt.uSourceColor, settings.color === 'source' ? 1 : 0);
    gl.uniform1f(compositeAt.uRefraction, fluid ? fluid.refraction * (reduced() ? 0.25 : 1) : 0);
    gl.uniform1f(compositeAt.uGlow, fluid ? fluid.glow : 0);
    gl.uniform1f(compositeAt.uTime, time);
    gl.uniform1f(compositeAt.uDrift, reduced() ? 0 : settings.drift);
    gl.uniform1f(compositeAt.uFluidOn, fluid && hover === 'fluid' && (fluidTextures.length || stableOn) ? 1 : 0);
    gl.uniform1f(compositeAt.uLod, Math.max(0, Math.log2(Math.max(1, texelsPerCell)) - 0.5));
    gl.uniform1f(compositeAt.uSaturation, settings.saturation);
    gl.uniform1f(compositeAt.uShade, settings.shade);
    gl.uniform1f(compositeAt.uBackdrop, source ? settings.backdrop : 0);
    gl.uniform2f(compositeAt.uLevels, source && settings.levels === 'auto' ? levels[0] : 0, source && settings.levels === 'auto' ? levels[1] : 1);
    gl.bindVertexArray(vertexArray);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const live = () => !destroyed && !lost && visible && !(typeof document !== 'undefined' && document.hidden);
  const frame = (now: number) => {
    raf = 0;
    if (!live()) return;
    const elapsed = (now - last) / 1000;
    const dt = Math.min(1 / 30, Math.max(1 / 480, elapsed));
    last = now;
    frameCost = frameCost * 0.9 + Math.min(elapsed, 0.25) * 0.1;
    slowFrames = frameCost > 1 / 24 ? slowFrames + 1 : 0;
    if (slowFrames > 45 && degraded < 2) {
      slowFrames = 0;
      degraded++;
      if (degraded === 1 && pixelRatio > 1) { settings = { ...settings, maxPixelRatio: 1 }; measure(); }
      else degraded = 2;
    }
    const moving = animated();
    if (moving) time += dt * settings.speed;
    if (source instanceof HTMLVideoElement && source.readyState >= 2 && videoFresh) {
      if (!('requestVideoFrameCallback' in source)) videoFresh = true; else videoFresh = false;
      uploadSource();
      dirty = true;
    }
    const hover = activeFieldHover(settings);
    let simulating = hover === 'fluid' && (pending !== null || now < activeUntil);
    if (simulating) stepFluid(dt, now);
    else pending = null;
    if (hover === 'lantern') simulating = stepLantern(dt, now) || simulating;
    // Draw once more after the wake settles, so the last frame is clean.
    if (hover === 'trail') { const wasActive = !!inkTrail?.active; simulating = stepTrail(dt) || simulating; if (wasActive && !inkTrail?.active) dirty = true; }
    if (moving || simulating || dirty) {
      draw();
      dirty = false;
      if (readyPending && (!sourceToken || source)) { readyPending = false; resolveReady(); }
    }
    if (moving || simulating || pending) raf = requestAnimationFrame(frame);
  };
  function wake() {
    if (raf || !live()) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  const toField = (clientX: number, clientY: number): [number, number] | null => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = (clientX - rect.left) / rect.width, y = (clientY - rect.top) / rect.height;
    if (x < -0.05 || x > 1.05 || y < -0.05 || y > 1.05) return null;
    return [x, 1 - y];
  };
  const moveTo = (point: [number, number] | null) => {
    const hover = activeFieldHover(settings);
    if (hover === 'none' || paused) { previous = null; lantern.target = null; return; }
    if (hover === 'lantern') {
      lantern.target = point ? [point[0], 1 - point[1]] : null;
      previous = null;
      wake();
      return;
    }
    if (hover === 'trail') {
      const trail = ensureTrail();
      if (!trail) return;
      if (point) trail.move(point[0], 1 - point[1], settings.trail.radius, performance.now());
      else trail.leave();
      previous = null;
      wake();
      return;
    }
    if (!point) { previous = null; return; }
    if (previous) pending = pending ? { from: pending.from, to: point } : { from: previous, to: point };
    previous = point;
    wake();
  };
  const onPointerMove = (event: PointerEvent) => moveTo(toField(event.clientX, event.clientY));
  const onPointerLeave = () => { previous = null; inkTrail?.leave(); if (lantern.target) { lantern.target = null; wake(); } };
  const target: HTMLElement | Window = options.interactionTarget ?? window;
  target.addEventListener('pointermove', onPointerMove as EventListener, { passive: true });
  target.addEventListener('pointerdown', onPointerMove as EventListener, { passive: true });
  document.addEventListener('pointerleave', onPointerLeave);
  if (target !== window) target.addEventListener('pointerleave', onPointerLeave);

  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (measure()) wake(); }) : null;
  resizeObserver?.observe(canvas);
  const intersection = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) { dirty = true; wake(); } }, { rootMargin: '120px' })
    : null;
  intersection?.observe(canvas);
  const onVisibility = () => { if (!document.hidden) { dirty = true; wake(); } };
  document.addEventListener('visibilitychange', onVisibility);
  const onMotionPreference = () => { dirty = true; wake(); };
  reducedQuery?.addEventListener?.('change', onMotionPreference);

  const onLost = (event: Event) => { event.preventDefault(); lost = true; if (raf) cancelAnimationFrame(raf); raf = 0; };
  const onRestored = () => {
    lost = false;
    shaders.length = 0;
    fluidTextures = []; fluidBuffers = []; stable = null; stableOn = false; trailTexture = null; inkTrail = null; trailUploaded = false;
    try { init(); dirty = true; wake(); } catch (error) { onError?.(error instanceof Error ? error : new Error(String(error))); }
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  const dropVideo = () => {
    if (ownedVideo) {
      ownedVideo.pause();
      ownedVideo.removeAttribute('src');
      ownedVideo.load();
      ownedVideo = null;
    }
    if (videoCallback && source instanceof HTMLVideoElement && 'cancelVideoFrameCallback' in source) (source as HTMLVideoElement & { cancelVideoFrameCallback(id: number): void }).cancelVideoFrameCallback(videoCallback);
    videoCallback = 0;
  };
  const watchVideo = (video: HTMLVideoElement) => {
    const withFrames = video as HTMLVideoElement & { requestVideoFrameCallback?(callback: () => void): number };
    if (!withFrames.requestVideoFrameCallback) return;
    const next = () => {
      if (destroyed || source !== video) return;
      videoFresh = true;
      wake();
      videoCallback = withFrames.requestVideoFrameCallback!(next);
    };
    videoCallback = withFrames.requestVideoFrameCallback(next);
  };
  type Loaded = { element: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | ImageBitmap; owned: boolean };
  const load = (input: FieldSource): Promise<Loaded> => {
    if (typeof input !== 'string') {
      if (input instanceof HTMLImageElement && !input.complete) return input.decode().then(() => ({ element: input, owned: false }));
      if (input instanceof HTMLVideoElement && input.readyState < 2) return new Promise((resolve, reject) => {
        input.addEventListener('loadeddata', () => resolve({ element: input, owned: false }), { once: true });
        input.addEventListener('error', () => reject(new Error('The glyph field could not load this video.')), { once: true });
      });
      return Promise.resolve({ element: input, owned: false });
    }
    if (VIDEO.test(input)) return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous'; video.muted = true; video.loop = true; video.playsInline = true; video.preload = 'auto';
      video.addEventListener('loadeddata', () => { void video.play().catch(() => {}); resolve({ element: video, owned: true }); }, { once: true });
      video.addEventListener('error', () => reject(new Error('The glyph field could not load this video.')), { once: true });
      video.src = input;
    });
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.decoding = 'async';
      image.onload = () => resolve({ element: image, owned: false });
      image.onerror = () => reject(new Error('The glyph field could not load this image.'));
      image.src = input;
    });
  };
  const setSource = async (input: FieldSource | null) => {
    const token = ++sourceToken;
    if (!input) {
      dropVideo();
      source = null; sourceWidth = sourceHeight = 0;
      dirty = true; wake();
      return;
    }
    try {
      const { element, owned } = await load(input);
      if (destroyed || token !== sourceToken) {
        if (owned && element instanceof HTMLVideoElement) { element.pause(); element.removeAttribute('src'); element.load(); }
        return;
      }
      dropVideo();
      ownedVideo = owned && element instanceof HTMLVideoElement ? element : null;
      source = element;
      sourceWidth = element instanceof HTMLVideoElement ? element.videoWidth : element instanceof HTMLImageElement ? element.naturalWidth : element.width;
      sourceHeight = element instanceof HTMLVideoElement ? element.videoHeight : element instanceof HTMLImageElement ? element.naturalHeight : element.height;
      videoFresh = true;
      if (element instanceof HTMLVideoElement) watchVideo(element);
      if (!lost) uploadSource();
      dirty = true;
      wake();
    } catch (error) {
      if (readyPending && token === sourceToken) { readyPending = false; resolveReady(); }
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  };

  init();
  const initialSource = options.source ?? null;
  if (initialSource) { sourceToken = 1; void setSource(initialSource); } else wake();

  return {
    canvas,
    ready,
    get settings() { return settings; },
    update(next: GlyphFieldOptions) {
      const before = settings;
      settings = normalizeFieldSettings(next, settings);
      if (next.label) canvas.setAttribute('aria-label', next.label);
      if (settings.maxPixelRatio !== before.maxPixelRatio) measure();
      if (settings.charset !== before.charset || settings.cellSize !== before.cellSize || settings.cellAspect !== before.cellAspect
        || settings.font !== before.font || settings.fontWeight !== before.fontWeight || settings.glyphScale !== before.glyphScale) {
        buildAtlas();
        awaitFont();
      }
      if (settings.levels !== before.levels) { measureLevels(); }
      const fluidChanged = !!settings.fluid !== !!before.fluid || (settings.fluid && before.fluid && settings.fluid.resolution !== before.fluid.resolution);
      if (fluidChanged) resizeFluid();
      if ('source' in next) void setSource(next.source ?? null);
      dirty = true;
      wake();
    },
    setSource,
    pointer(x: number | null, y = 0) {
      if (x === null) { moveTo(null); return; }
      const rect = canvas.getBoundingClientRect();
      moveTo(toField(rect.left + x, rect.top + y));
    },
    redraw() {
      if (destroyed || lost || !width) return;
      draw();
    },
    play() {
      paused = false;
      if (source instanceof HTMLVideoElement) void source.play().catch(() => {});
      dirty = true; wake();
    },
    pause() {
      paused = true;
      if (source instanceof HTMLVideoElement) source.pause();
    },
    resize() { if (measure()) wake(); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      target.removeEventListener('pointermove', onPointerMove as EventListener);
      target.removeEventListener('pointerdown', onPointerMove as EventListener);
      document.removeEventListener('pointerleave', onPointerLeave);
      target.removeEventListener('pointerleave', onPointerLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      reducedQuery?.removeEventListener?.('change', onMotionPreference);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      resizeObserver?.disconnect();
      intersection?.disconnect();
      dropVideo();
      source = null;
      if (!lost) {
        releaseFluid();
        gl.deleteTexture(atlasTexture); gl.deleteTexture(sourceTexture);
        gl.deleteProgram(composite); gl.deleteProgram(fluidProgram);
        stable?.dispose();
        if (trailTexture) gl.deleteTexture(trailTexture);
        shaders.forEach(shader => gl.deleteShader(shader));
        if (vertexArray) gl.deleteVertexArray(vertexArray);
      }
    },
  };
}
