import { FIELD_COMPOSITE, FIELD_VERTEX, fieldCellShader, fieldFluidShader, sceneId } from './field-shaders';
import { createStableFluid, type FieldProgram, type StableFluid } from './field-fluid';
import { InkTrail } from '../surface/ink-trail';
import {
  FIELD_MARKS, activeFieldHover, fieldCellLayout, fieldCellPitch, fieldClearFromRects, fieldGlyphs, fieldLevels, fieldSourceRect, fieldSourceScale, normalizeFieldSettings, parseFieldColor,
  type GlyphFieldInput, type GlyphFieldSettings,
} from './field-model';

export type FieldSource = string | HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | ImageBitmap;

export interface GlyphFieldOptions extends Omit<GlyphFieldInput, 'clear'> {
  /**
   * Keep the field quiet around content: an element (followed through layout changes), an element with
   * `padding` (CSS px), `feather` (fraction of the shorter side) and `shape`, a zone in field fractions, or `false`.
   */
  clear?: GlyphFieldInput['clear'] | HTMLElement | FieldClearElement;
  /** Image or video URL, or a decoded element. Without one, `scene` draws generated motion. */
  source?: FieldSource | null;
  /** Where pointer movement is read. Defaults to the window, so overlaid text never blocks the wake. */
  interactionTarget?: HTMLElement | Window | null;
  /** Accessible name for the canvas. */
  label?: string;
  onError?: (error: Error) => void;
}

export interface FieldClearElement { element: HTMLElement; padding?: number; feather?: number; shape?: 'ellipse' | 'rect' }

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
  /**
   * Sends a ring through the field, for interface events such as a save or a message.
   * `x` and `y` are CSS pixels relative to the canvas, or pass an element to start from its centre. Ignored under reduced motion.
   */
  pulse(options?: { x?: number; y?: number; element?: Element; strength?: number }): void;
  play(): void;
  pause(): void;
  resize(): void;
  destroy(): void;
  readonly settings: GlyphFieldSettings;
}

const VIDEO = /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i;
type Program = FieldProgram & { fragment: WebGLShader };
type Bitmapish = { width: number; height: number; close(): void };

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
 * Each frame shades one fragment per cell, then draws the glyphs per pixel, so the cost of the scene does not grow with pixel density.
 */
export function mountGlyphField(canvas: HTMLCanvasElement, options: GlyphFieldOptions = {}): GlyphField {
  const isElement = (value: unknown): value is HTMLElement => typeof HTMLElement !== 'undefined' && value instanceof HTMLElement;
  const splitClear = (input: GlyphFieldOptions): { element: FieldClearElement | null; rest: GlyphFieldInput } => {
    const clear = input.clear as unknown;
    if (isElement(clear)) return { element: { element: clear }, rest: { ...input, clear: undefined } as GlyphFieldInput };
    if (clear && typeof clear === 'object' && isElement((clear as FieldClearElement).element)) return { element: clear as FieldClearElement, rest: { ...input, clear: undefined } as GlyphFieldInput };
    return { element: null, rest: input as GlyphFieldInput };
  };
  let clearElement = splitClear(options).element;
  let settings = normalizeFieldSettings(splitClear(options).rest);
  const onError = options.onError;
  const maybeGl = canvas.getContext('webgl2', { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, powerPreference: 'high-performance' });
  if (!maybeGl) throw new Error('WebGL2 is not available for the glyph field.');
  const gl: WebGL2RenderingContext = maybeGl;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', options.label ?? 'ASCII artwork');
  canvas.dataset.renderer = 'glyph-field';

  let packed = false;
  const parallel = gl.getExtension('KHR_parallel_shader_compile') as { COMPLETION_STATUS_KHR: number } | null;
  let cellProgram: Program | null = null, pixelProgram: Program | null = null, fluidProgram: Program | null = null;
  let atlasTexture: WebGLTexture, sourceTexture: WebGLTexture;
  let cells: { ink: WebGLTexture; under: WebGLTexture; buffer: WebGLFramebuffer; columns: number; rows: number } | null = null;
  let fluidTextures: WebGLTexture[] = [], fluidBuffers: WebGLFramebuffer[] = [];
  // The incompressible solver curls and lingers like ink in water; the single-pass wake is its fallback.
  let stable: StableFluid | null = null, stableOn = false;
  let vertexArray: WebGLVertexArrayObject | null = null;
  let vertexShader: WebGLShader | null = null;
  const shaders: WebGLShader[] = [];

  let width = 0, height = 0, pixelRatio = 1, atlasRatio = 0;
  let layout = fieldCellLayout(settings.cellSize, settings.cellAspect, 1, 2), glyphCount = 2;
  let simWidth = 0, simHeight = 0, read = 0;
  let source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | ImageBitmap | null = null;
  // A photo or video source; drawn interface states (canvases, bitmaps) stay crisp under blend 'auto'.
  let photographic = false;
  let ownedVideo: HTMLVideoElement | null = null, sourceWidth = 0, sourceHeight = 0, sourceToken = 0;
  // An image the field decoded itself, and the height it was uploaded at.
  let ownedBitmap: Bitmapish | null = null, textureHeight = 0;
  let videoFresh = true, videoCallback = 0, levels: [number, number] = [0, 1], levelsAt = -Infinity;
  let raf = 0, last = 0, time = 0, dirty = true, destroyed = false, lost = false, failed = false, paused = false, visible = true;
  let previous: [number, number] | null = null, pending: { from: [number, number]; to: [number, number] } | null = null;
  // Slow frames for about a second drop the field to 1x pixels, then to no ambient motion; the wake keeps working.
  let frameCost = 1 / 60, slowFrames = 0, degraded = 0;
  // Pulses live about 2.4 seconds; four at a time is plenty for interface events.
  let pulses: { x: number; y: number; born: number; strength: number }[] = [];
  const pulseUniform = new Float32Array(16);
  const measureClear = () => {
    if (!clearElement) return;
    const { element, padding = 32, feather = 0.16, shape = 'rect' } = clearElement;
    const zone = fieldClearFromRects(canvas.getBoundingClientRect(), element.getBoundingClientRect(), padding, feather, shape);
    const previous = settings.clear;
    if (JSON.stringify(previous) === JSON.stringify(zone)) return;
    settings = { ...settings, clear: zone };
    dirty = true;
  };
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
    const target = lantern.target;
    if (target) {
      const at = lantern.at;
      if (!at) lantern.at = [target[0], target[1]];
      else if (reduced()) { at[0] = target[0]; at[1] = target[1]; }
      else {
        const k = 1 - Math.exp(-options.follow * dt);
        at[0] += (target[0] - at[0]) * k; at[1] += (target[1] - at[1]) * k;
      }
      const point = lantern.at!, lastPoint = lantern.trail[lantern.trail.length - 1];
      if (options.trail > 0 && (!lastPoint || (now - lastPoint.born > 28 && Math.hypot(point[0] - lastPoint.x, point[1] - lastPoint.y) > 0.004))) {
        lantern.trail.push({ x: point[0], y: point[1], born: now });
        if (lantern.trail.length > 12) lantern.trail.shift();
      }
    }
    lantern.strength += ((target ? 1 : 0) - lantern.strength) * (1 - Math.exp(-dt * (target ? 9 : 5)));
    const trail = lantern.trail;
    for (let i = trail.length - 1; i >= 0; i--) if (!(options.trail > 0 && now - trail[i].born < options.trail * 4000)) trail.splice(i, 1);
    trailUniform.fill(0);
    for (let i = 0; i < trail.length; i++) {
      const point = trail[i];
      trailUniform[i * 3] = point.x; trailUniform[i * 3 + 1] = point.y;
      trailUniform[i * 3 + 2] = 0.55 * Math.exp(-(now - point.born) / 1000 / Math.max(0.01, options.trail));
    }
    return lantern.strength > 0.003 || trail.length > 0;
  };
  let activeUntil = 0;
  const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduced = () => settings.respectReducedMotion && !!reducedQuery?.matches;

  let resolveReady!: () => void;
  const ready = new Promise<void>(resolve => { resolveReady = resolve; });
  let readyPending = true;
  const report = (error: unknown) => onError?.(error instanceof Error ? error : new Error(String(error)));

  const compile = (type: number, code: string) => {
    const shader = gl.createShader(type)!;
    shaders.push(shader);
    gl.shaderSource(shader, code);
    gl.compileShader(shader);
    return shader;
  };
  // Linking starts here and finishes in the browser's compiler; `linked` collects it without waiting where that is supported.
  const link = (fragment: string): Program => {
    vertexShader ??= compile(gl.VERTEX_SHADER, FIELD_VERTEX);
    const program = gl.createProgram()!;
    const shader = compile(gl.FRAGMENT_SHADER, fragment);
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, shader);
    gl.linkProgram(program);
    return { program, locations: null, fragment: shader };
  };
  const linked = (entry: FieldProgram, wait = false): boolean => {
    if (entry.locations) return true;
    const { program, fragment } = entry as Program;
    if (!wait && parallel && !gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR)) return false;
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      if (gl.isContextLost()) return false;
      throw new Error(gl.getShaderInfoLog(fragment) || gl.getProgramInfoLog(program) || 'Glyph field program failed to link.');
    }
    // Uniforms the compiler removed are absent; WebGL ignores a missing location.
    const locations: Record<string, WebGLUniformLocation | null> = {};
    for (let i = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) - 1; i >= 0; i--) {
      const name = gl.getActiveUniform(program, i)!.name.replace(/\[0\]$/, '');
      locations[name] = gl.getUniformLocation(program, name);
    }
    entry.locations = locations;
    return true;
  };
  const programsReady = (wait = false) => !!cellProgram && !!pixelProgram && linked(cellProgram, wait) && linked(pixelProgram, wait);
  const texture = (filter: number) => {
    const handle = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, handle);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === gl.LINEAR_MIPMAP_LINEAR ? gl.LINEAR : filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return handle;
  };

  /** One texel per cell: the cell pass writes ink with glyph index (or dot tone), and what lies under the glyph. */
  const releaseCells = () => {
    if (!cells) return;
    gl.deleteTexture(cells.ink); gl.deleteTexture(cells.under); gl.deleteFramebuffer(cells.buffer);
    cells = null;
  };
  const pitch = () => fieldCellPitch(settings.cellFit, settings.cellSize, settings.cellAspect, pixelRatio, width, height, layout);
  const ensureCells = () => {
    const [pitchX, pitchY] = pitch();
    const columns = Math.ceil(width / pitchX - 1e-4), rows = Math.ceil(height / pitchY - 1e-4);
    if (cells && cells.columns === columns && cells.rows === rows) return cells;
    releaseCells();
    // Half floats keep the dot tone smooth; 8 bits where float targets are missing.
    const target = () => { const handle = texture(gl.NEAREST); gl.texStorage2D(gl.TEXTURE_2D, 1, packed ? gl.RGBA8 : gl.RGBA16F, columns, rows); return handle; };
    const ink = target(), under = target(), buffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, buffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, ink, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, under, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    return (cells = { ink, under, buffer, columns, rows });
  };

  const wantsFluid = () => !!settings.fluid && activeFieldHover(settings) === 'fluid';
  const releaseFluid = () => {
    stable?.release();
    stableOn = false;
    fluidTextures.forEach(handle => gl.deleteTexture(handle));
    fluidBuffers.forEach(handle => gl.deleteFramebuffer(handle));
    fluidTextures = []; fluidBuffers = [];
  };
  // The wake's programs are only built for fields whose hover is fluid.
  function buildFluid() {
    if (fluidProgram) gl.deleteProgram(fluidProgram.program);
    fluidProgram = link(fieldFluidShader(packed));
    stable?.dispose();
    stable = packed ? null : createStableFluid(gl, link, entry => linked(entry));
  }
  const resizeFluid = () => {
    releaseFluid();
    const fluid = settings.fluid;
    if (!fluid || !wantsFluid() || !width || !height) return;
    if (!fluidProgram) buildFluid();
    const resolution = fluid.resolution, aspect = width / height;
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
      buildFluid();
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
    if (cellProgram) gl.deleteProgram(cellProgram.program);
    if (pixelProgram) gl.deleteProgram(pixelProgram.program);
    releaseCells();
    cellProgram = link(fieldCellShader(packed));
    pixelProgram = link(FIELD_COMPOSITE);
    // Without parallel compilation the check blocks either way, so a broken driver still throws from mount.
    if (!parallel) programsReady(true);
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
  const fonts = typeof document === 'undefined' ? undefined : (document as Document & { fonts?: FontFaceSet }).fonts;
  const awaitFont = () => {
    if (!fonts?.load) return;
    const font = fontString();
    void fonts.load(font, fieldGlyphs(settings.charset).join('')).then(() => {
      if (destroyed || lost || fontString() !== font) return;
      buildAtlas();
      wake();
    }, () => {});
  };
  // A stylesheet that declares the font after mounting (loaded without blocking render) is picked up when a face arrives.
  const unquote = (family: string) => family.trim().replace(/^["']|["']$/g, '').toLowerCase();
  const onFontsLoaded = (event: Event) => {
    const faces = (event as Event & { fontfaces?: readonly FontFace[] }).fontfaces ?? [];
    const wanted = settings.font.split(',').map(unquote);
    if (faces.some(face => wanted.includes(unquote(face.family)))) awaitFont();
  };

  const measureLevels = () => {
    levels = [0, 1];
    if (!source || settings.levels === 'none') return;
    try {
      const probe = document.createElement('canvas');
      probe.width = probe.height = 64;
      const context = probe.getContext('2d', { willReadFrequently: true })!;
      // An image element is sampled from a decode at this size; averaging the field's own bitmap the same way keeps levels unchanged.
      if (source === ownedBitmap) context.imageSmoothingQuality = 'medium';
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
      report(error);
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
    // Measuring from zero builds the atlas for this pixel ratio and the wake's buffers.
    width = height = 0; atlasRatio = 0;
    measure();
    awaitFont();
    if (source) uploadSource();
  };

  function measure() {
    // Layout size, not getBoundingClientRect: a transform (a dialog scaling open) must not bake a stretched size in.
    const rect = canvas.clientWidth || canvas.clientHeight ? { width: canvas.clientWidth, height: canvas.clientHeight } : canvas.getBoundingClientRect();
    const ratio = Math.min(globalThis.devicePixelRatio || 1, settings.maxPixelRatio);
    const nextWidth = Math.max(1, Math.round(rect.width * ratio)), nextHeight = Math.max(1, Math.round(rect.height * ratio));
    if (nextWidth === width && nextHeight === height && ratio === pixelRatio) return false;
    const aspectChanged = !width || Math.abs(nextWidth / nextHeight - width / height) > 0.01;
    pixelRatio = ratio; width = nextWidth; height = nextHeight;
    canvas.width = width; canvas.height = height;
    if (atlasRatio !== pixelRatio) buildAtlas();
    if (aspectChanged || (wantsFluid() && !fluidTextures.length && !stableOn)) resizeFluid();
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
    // Still compiling: keep the stroke and apply it once the wake can run.
    if (stableOn ? !stable?.ready() : !fluidProgram || !linked(fluidProgram)) return;
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
    let forceX = 0, forceY = 0;
    if (splat) {
      const scale = (reduced() ? 1 : 3) * fluid.force;
      forceX = (splat.to[0] - splat.from[0]) * aspect * scale * 4; forceY = (splat.to[1] - splat.from[1]) * scale * 4;
      activeUntil = now + (7 / Math.min(fluid.dissipation, fluid.dissipation * 1.1)) * 1000;
    }
    const at = fluidProgram!.locations!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fluidBuffers[1 - read]);
    gl.viewport(0, 0, simWidth, simHeight);
    gl.useProgram(fluidProgram!.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fluidTextures[read]);
    gl.uniform1i(at.uPrevious, 0);
    gl.uniform2f(at.uSize, simWidth, simHeight);
    gl.uniform1f(at.uAspect, aspect);
    gl.uniform1f(at.uDt, dt);
    gl.uniform1f(at.uDecay, fluid.dissipation);
    gl.uniform1f(at.uEnergyDecay, fluid.dissipation * 1.1);
    gl.uniform1f(at.uRadius, fluid.radius);
    gl.uniform1f(at.uSplat, splat ? 1 : 0);
    gl.uniform2f(at.uFrom, splat?.from[0] ?? 0, splat?.from[1] ?? 0);
    gl.uniform2f(at.uTo, splat?.to[0] ?? 0, splat?.to[1] ?? 0);
    gl.uniform2f(at.uForce, forceX, forceY);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    read = 1 - read;
  };

  // Values derived from settings and the source, recomputed only when those change.
  let derivedFor: GlyphFieldSettings | null = null;
  let inkColor: [number, number, number] = [0, 0, 0], highlightColor: [number, number, number] = [1, 1, 1], backgroundColor = [0, 0, 0, 0];
  let map = fieldSourceRect(1, 1, 1, 1, 'cover'), mapFor: GlyphFieldSettings | null = null, mapWidth = 0, mapHeight = 0, mapSourceWidth = 0, mapSourceHeight = 0;
  const derive = () => {
    if (derivedFor !== settings) {
      derivedFor = settings;
      inkColor = parseFieldColor(settings.ink);
      highlightColor = parseFieldColor(settings.highlight === 'auto' ? '#ffffff' : settings.highlight);
      backgroundColor = settings.background === 'transparent' ? [0, 0, 0, 0] : [...parseFieldColor(settings.background), 1];
    }
    if (mapFor !== settings || mapWidth !== width || mapHeight !== height || mapSourceWidth !== sourceWidth || mapSourceHeight !== sourceHeight) {
      mapFor = settings; mapWidth = width; mapHeight = height; mapSourceWidth = sourceWidth; mapSourceHeight = sourceHeight;
      map = fieldSourceRect(width, height, sourceWidth || 1, sourceHeight || 1, settings.fit, settings.focus);
    }
  };

  const draw = () => {
    derive();
    const fluid = settings.fluid;
    const texelsPerCell = source && textureHeight ? (layout.height / height) * textureHeight * map.scale[1] : 1;
    const target = ensureCells();
    const u = cellProgram!.locations!, p = pixelProgram!.locations!;
    const hover = activeFieldHover(settings);
    const motion = !reduced();
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.buffer);
    gl.viewport(0, 0, target.columns, target.rows);
    gl.useProgram(cellProgram!.program);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sourceTexture); gl.uniform1i(u.uSource, 0);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, (stableOn ? stable?.velocity : fluidTextures[read]) ?? sourceTexture); gl.uniform1i(u.uFluid, 2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, trailTexture ?? sourceTexture); gl.uniform1i(u.uTrailMap, 3);
    gl.uniform1f(u.uFluidMode, stableOn ? 1 : 0);
    gl.uniform1i(u.uHoverMode, hover === 'fluid' ? 1 : hover === 'lantern' ? 2 : hover === 'trail' && trailUploaded ? 3 : 0);
    gl.uniform1f(u.uTrailAmount, settings.trail.strength);
    gl.uniform3f(u.uLight, lantern.at?.[0] ?? -1, lantern.at?.[1] ?? -1, hover === 'lantern' ? lantern.strength : 0);
    gl.uniform3fv(u.uTrail, trailUniform);
    gl.uniform1f(u.uLightRadius, settings.lantern.radius);
    gl.uniform1f(u.uLightGain, settings.lantern.strength);
    gl.uniform1f(u.uClock, performance.now() / 1000);
    gl.uniform1f(u.uFlicker, motion ? 1 : 0);
    gl.uniform2f(u.uFluidTexel, 1 / Math.max(1, simWidth), 1 / Math.max(1, simHeight));
    gl.uniform2f(u.uResolution, width, height);
    const [pitchX, pitchY] = pitch();
    gl.uniform2f(u.uCell, pitchX, pitchY);
    gl.uniform1f(u.uCount, glyphCount);
    gl.uniform1f(u.uBlend, settings.blend === 'on' || (glyphCount <= 9 && (settings.blend === 'coarse' || (settings.blend === 'auto' && photographic))) ? 1 : 0);
    gl.uniform4f(u.uSourceMap, map.scale[0], map.scale[1], map.offset[0], map.offset[1]);
    gl.uniform1i(u.uScene, source ? 0 : sceneId(settings.scene));
    gl.uniform1i(u.uMark, FIELD_MARKS.indexOf(settings.mark));
    gl.uniform1f(u.uScale, settings.scale);
    const zone = settings.clear;
    gl.uniform4f(u.uClear, zone ? zone.x : 0, zone ? zone.y : 0, zone ? zone.width : 0, zone ? zone.height : 0);
    gl.uniform1f(u.uClearFeather, zone ? zone.feather : 0.1);
    gl.uniform1f(u.uClearShape, zone && zone.shape === 'rect' ? 1 : 0);
    const nowMs = performance.now();
    pulseUniform.fill(0);
    for (let i = 0; i < pulses.length; i++) {
      const pulse = pulses[i], offset = i * 4;
      pulseUniform[offset] = pulse.x; pulseUniform[offset + 1] = pulse.y;
      pulseUniform[offset + 2] = (nowMs - pulse.born) / 1000; pulseUniform[offset + 3] = pulse.strength;
    }
    gl.uniform4fv(u.uPulse, pulseUniform);
    gl.uniform3fv(u.uInk, inkColor);
    gl.uniform3fv(u.uHighlight, highlightColor);
    gl.uniform1f(u.uHighlightAuto, settings.highlight === 'auto' ? 1 : 0);
    gl.uniform4fv(u.uBackground, backgroundColor);
    gl.uniform1f(u.uBrightness, settings.brightness);
    gl.uniform1f(u.uContrast, settings.contrast);
    gl.uniform1f(u.uGamma, settings.gamma);
    gl.uniform1f(u.uInvert, settings.invert ? 1 : 0);
    gl.uniform1f(u.uVignette, settings.vignette);
    gl.uniform1f(u.uSourceColor, settings.color === 'source' ? 1 : 0);
    gl.uniform1f(u.uRefraction, fluid ? fluid.refraction * (motion ? 1 : 0.25) : 0);
    gl.uniform1f(u.uGlow, fluid ? fluid.glow : 0);
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uDrift, motion ? settings.drift : 0);
    gl.uniform1f(u.uFluidOn, fluid && hover === 'fluid' && (fluidTextures.length || stableOn) ? 1 : 0);
    gl.uniform1f(u.uLod, Math.max(0, Math.log2(Math.max(1, texelsPerCell)) - 0.5));
    gl.uniform1f(u.uSaturation, settings.saturation);
    gl.uniform1f(u.uShade, settings.shade);
    gl.uniform1f(u.uBackdrop, source ? settings.backdrop : 0);
    gl.uniform2f(u.uLevels, source && settings.levels === 'auto' ? levels[0] : 0, source && settings.levels === 'auto' ? levels[1] : 1);
    gl.bindVertexArray(vertexArray);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.useProgram(pixelProgram!.program);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, atlasTexture); gl.uniform1i(p.uAtlas, 1);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, target.ink); gl.uniform1i(p.uCells, 4);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, target.under); gl.uniform1i(p.uUnder, 5);
    gl.uniform2f(p.uResolution, width, height);
    gl.uniform2f(p.uCell, layout.width, layout.height);
    gl.uniform2f(p.uPitch, pitchX, pitchY);
    gl.uniform1f(p.uColumns, layout.columns);
    gl.uniform1f(p.uDotScale, settings.dotScale);
    gl.uniform1i(p.uMark, FIELD_MARKS.indexOf(settings.mark));
    gl.uniform1f(p.uSourceColor, settings.color === 'source' ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  // The first frame draws even off screen, so a field mounted ahead of the viewport is ready when it scrolls in.
  const live = () => !destroyed && !lost && !failed && (visible || readyPending) && !(typeof document !== 'undefined' && document.hidden);
  const frame = (now: number) => {
    raf = 0;
    if (!live()) return;
    const elapsed = (now - last) / 1000;
    const dt = Math.min(1 / 30, Math.max(1 / 480, elapsed));
    last = now;
    frameCost = frameCost * 0.9 + Math.min(elapsed, 0.25) * 0.1;
    slowFrames = frameCost > 1 / 24 ? slowFrames + 1 : 0;
    try {
      if (slowFrames > 45 && degraded < 2) {
        slowFrames = 0;
        degraded++;
        if (degraded === 1 && pixelRatio > 1) { settings = { ...settings, maxPixelRatio: 1 }; measure(); }
        else degraded = 2;
      }
      const compiled = programsReady();
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
      if (pulses.length) {
        for (let i = pulses.length - 1; i >= 0; i--) if (now - pulses[i].born >= 2400) pulses.splice(i, 1);
        simulating = true;
        if (!pulses.length) dirty = true;
      }
      if (compiled && (moving || simulating || dirty)) {
        draw();
        dirty = false;
        if (readyPending && (!sourceToken || source)) { readyPending = false; resolveReady(); }
      }
      if (moving || simulating || pending || !compiled) raf = requestAnimationFrame(frame);
    } catch (error) {
      failed = true;
      report(error);
    }
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

  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { const resized = measure(); measureClear(); if (resized || dirty) wake(); }) : null;
  resizeObserver?.observe(canvas);
  if (clearElement) resizeObserver?.observe(clearElement.element);
  const intersection = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) { dirty = true; wake(); } }, { rootMargin: '120px' })
    : null;
  intersection?.observe(canvas);
  const onVisibility = () => { if (!document.hidden) { dirty = true; wake(); } };
  document.addEventListener('visibilitychange', onVisibility);
  const onMotionPreference = () => { dirty = true; wake(); };
  reducedQuery?.addEventListener?.('change', onMotionPreference);
  fonts?.addEventListener?.('loadingdone', onFontsLoaded);

  const onLost = (event: Event) => { event.preventDefault(); lost = true; if (raf) cancelAnimationFrame(raf); raf = 0; };
  const onRestored = () => {
    lost = false;
    shaders.length = 0; vertexShader = null;
    cellProgram = pixelProgram = fluidProgram = null; cells = null;
    fluidTextures = []; fluidBuffers = []; stable = null; stableOn = false; trailTexture = null; inkTrail = null; trailUploaded = false;
    try { init(); dirty = true; wake(); } catch (error) { report(error); }
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
  const dropBitmap = () => {
    ownedBitmap?.close();
    ownedBitmap = null;
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
  type Loaded = { element: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | ImageBitmap; owned: boolean; natural?: [number, number] };
  // Decoding and scaling run off the main thread; only the small result is uploaded.
  const decodeBlob = async (blob: Blob): Promise<Loaded> => {
    const full = await createImageBitmap(blob, { premultiplyAlpha: 'none' });
    const natural: [number, number] = [full.width, full.height];
    // Larger images are scaled down to what the cells can show; the field samples a mip level near one texel per cell.
    const scale = fieldSourceScale(full.width, full.height, width, height, layout.height, settings.fit);
    if (scale === 1) return { element: full, owned: true, natural };
    try {
      const small = await createImageBitmap(full, {
        resizeWidth: Math.max(1, Math.round(full.width * scale)), resizeHeight: Math.max(1, Math.round(full.height * scale)), resizeQuality: 'medium', premultiplyAlpha: 'none',
      });
      return { element: small, owned: true, natural };
    } finally {
      full.close();
    }
  };
  const loadImage = (url: string) => new Promise<Loaded>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => resolve({ element: image, owned: false });
    image.onerror = () => reject(new Error('The glyph field could not load this image.'));
    image.src = url;
  });
  const load = async (input: FieldSource): Promise<Loaded> => {
    if (typeof input !== 'string') {
      if (input instanceof HTMLImageElement && !input.complete) return input.decode().then(() => ({ element: input, owned: false }));
      if (input instanceof HTMLVideoElement && input.readyState < 2) return new Promise((resolve, reject) => {
        input.addEventListener('loadeddata', () => resolve({ element: input, owned: false }), { once: true });
        input.addEventListener('error', () => reject(new Error('The glyph field could not load this video.')), { once: true });
      });
      return { element: input, owned: false };
    }
    if (VIDEO.test(input)) return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous'; video.muted = true; video.loop = true; video.playsInline = true; video.preload = 'auto';
      video.addEventListener('loadeddata', () => { void video.play().catch(() => {}); resolve({ element: video, owned: true }); }, { once: true });
      video.addEventListener('error', () => reject(new Error('The glyph field could not load this video.')), { once: true });
      video.src = input;
    });
    if (typeof createImageBitmap !== 'function' || typeof fetch !== 'function') return loadImage(input);
    let blob: Blob;
    try {
      blob = await (await fetch(input).then(response => {
        if (!response.ok) throw new Error('The glyph field could not load this image.');
        return response;
      })).blob();
    } catch (error) {
      // A policy that blocks fetch can still allow images; a missing file fails the same way either way.
      if (error instanceof Error && error.message.startsWith('The glyph field')) throw error;
      return loadImage(input);
    }
    if (!/svg/i.test(blob.type)) {
      try { return await decodeBlob(blob); } catch { /* A format this browser decodes only in an image element. */ }
    }
    const local = URL.createObjectURL(blob);
    try { return await loadImage(local); } finally { URL.revokeObjectURL(local); }
  };
  const setSource = async (input: FieldSource | null) => {
    const token = ++sourceToken;
    if (!input) {
      dropVideo(); dropBitmap();
      source = null; sourceWidth = sourceHeight = textureHeight = 0;
      photographic = false;
      dirty = true; wake();
      return;
    }
    try {
      const loaded = await load(input);
      const { element, owned } = loaded;
      if (destroyed || token !== sourceToken) {
        if (owned && element instanceof HTMLVideoElement) { element.pause(); element.removeAttribute('src'); element.load(); }
        else if (owned) (element as ImageBitmap).close();
        return;
      }
      dropVideo(); dropBitmap();
      ownedVideo = owned && element instanceof HTMLVideoElement ? element : null;
      if (owned && !(element instanceof HTMLVideoElement)) ownedBitmap = element as ImageBitmap;
      source = element;
      photographic = typeof input === 'string' || input instanceof HTMLImageElement || input instanceof HTMLVideoElement;
      textureHeight = element instanceof HTMLVideoElement ? element.videoHeight : element instanceof HTMLImageElement ? element.naturalHeight : element.height;
      sourceWidth = loaded.natural?.[0] ?? (element instanceof HTMLVideoElement ? element.videoWidth : element instanceof HTMLImageElement ? element.naturalWidth : element.width);
      sourceHeight = loaded.natural?.[1] ?? textureHeight;
      videoFresh = true;
      if (element instanceof HTMLVideoElement) watchVideo(element);
      if (!lost) uploadSource();
      dirty = true;
      wake();
    } catch (error) {
      if (readyPending && token === sourceToken) { readyPending = false; resolveReady(); }
      report(error);
    }
  };

  init();
  measureClear();
  const initialSource = options.source ?? null;
  if (initialSource) { sourceToken = 1; void setSource(initialSource); } else wake();

  return {
    canvas,
    ready,
    get settings() { return settings; },
    update(next: GlyphFieldOptions) {
      const before = settings;
      const { element, rest } = splitClear(next);
      if ('clear' in next) {
        if (clearElement && clearElement.element !== element?.element) resizeObserver?.unobserve(clearElement.element);
        clearElement = element;
        if (element) resizeObserver?.observe(element.element);
      }
      settings = normalizeFieldSettings(element ? { ...rest, clear: settings.clear } : rest, settings);
      measureClear();
      if (next.label) canvas.setAttribute('aria-label', next.label);
      if (settings.maxPixelRatio !== before.maxPixelRatio) measure();
      if (settings.charset !== before.charset || settings.cellSize !== before.cellSize || settings.cellAspect !== before.cellAspect
        || settings.font !== before.font || settings.fontWeight !== before.fontWeight || settings.glyphScale !== before.glyphScale) {
        buildAtlas();
        awaitFont();
      }
      if (settings.levels !== before.levels) { measureLevels(); }
      const wasFluid = !!before.fluid && activeFieldHover(before) === 'fluid';
      const fluidChanged = wasFluid !== wantsFluid() || (settings.fluid && before.fluid && settings.fluid.resolution !== before.fluid.resolution);
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
      if (destroyed || lost || failed || !width) return;
      try {
        if (programsReady(true)) draw();
      } catch (error) {
        failed = true;
        report(error);
      }
    },
    pulse(options: { x?: number; y?: number; element?: Element; strength?: number } = {}) {
      if (destroyed || reduced()) return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      let x = options.x ?? rect.width / 2, y = options.y ?? rect.height / 2;
      if (options.element) {
        const box = options.element.getBoundingClientRect();
        x = box.left + box.width / 2 - rect.left; y = box.top + box.height / 2 - rect.top;
      }
      const strength = Math.max(0, Math.min(2, options.strength ?? 1));
      pulses = [...pulses, { x: x / rect.width, y: y / rect.height, born: performance.now(), strength }].slice(-4);
      wake();
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
      fonts?.removeEventListener?.('loadingdone', onFontsLoaded);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      resizeObserver?.disconnect();
      intersection?.disconnect();
      dropVideo();
      dropBitmap();
      source = null;
      if (!lost) {
        releaseFluid();
        releaseCells();
        gl.deleteTexture(atlasTexture); gl.deleteTexture(sourceTexture);
        for (const entry of [cellProgram, pixelProgram, fluidProgram]) if (entry) gl.deleteProgram(entry.program);
        stable?.dispose();
        if (trailTexture) gl.deleteTexture(trailTexture);
        shaders.forEach(shader => gl.deleteShader(shader));
        if (vertexArray) gl.deleteVertexArray(vertexArray);
      }
    },
  };
}
