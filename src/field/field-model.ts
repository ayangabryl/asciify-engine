/** Pure option handling for the GPU glyph field, kept free of DOM and WebGL so it can be tested in Node. */
import { normalizeHoverScope, type HoverScope } from '../surface/hover-guide';

export type FieldColor = 'ink' | 'source';
export type FieldFit = 'cover' | 'contain';
/**
 * Generated motion used when there is no media source. The later ones are the kit's background scenes: caustic light, drifting contour lines, aurora ribbons, water rings, a halo,
 * two interfering ring grids, a gradient mesh, falling streaks in three depths, and linked points.
 */
export const FIELD_SCENES = ['none', 'flow', 'orb', 'drift', 'swell', 'caustics', 'contour', 'aurora', 'ripple', 'halo', 'interference', 'mesh', 'cascade', 'constellation'] as const;
export type FieldScene = typeof FIELD_SCENES[number];
/**
 * What each cell draws. `glyph` draws characters from the atlas; `dot` draws a halftone: one circle per cell, its area
 * following the tone. The rest are the Studio's tile and print styles, drawn per cell from the cell's tone and colour:
 * tiles (`pixel`, `mosaic`, `lego`, `voxel`, `disco`, `hex`, `led`) fade with the tone in ink colour and stay solid in source
 * colour; `dither` lights whole cells through a 4x4 Bayer screen; `cmyk` separates the cell's colour into offset ink dots;
 * the print marks (`stipple`, `engraving`, `crosshatch`, `woodblock`, `risograph`, `pointillism`) carry the tone in their size.
 * Every mark but `dot` leaves empty the cells the charset would leave blank.
 */
export const FIELD_MARKS = ['glyph', 'dot', 'pixel', 'mosaic', 'lego', 'voxel', 'disco', 'dither', 'hex', 'led', 'cmyk',
  'stipple', 'engraving', 'crosshatch', 'woodblock', 'risograph', 'pointillism'] as const;
export type FieldMark = typeof FIELD_MARKS[number];
/**
 * An area the field keeps quiet, so content above it stays readable. Coordinates are fractions of the field,
 * from the top left; `feather` is the soft edge, as a fraction of the field's shorter side.
 */
export interface FieldClearZone { x: number; y: number; width: number; height: number; feather: number; shape: 'ellipse' | 'rect' }
/**
 * How the field answers the pointer.
 * - `fluid`: an incompressible fluid that bends the image and swirls the characters. Bold, liquid.
 * - `lantern`: a soft light that glides after the pointer and lifts the characters it passes. Subtle, no distortion.
 * - `trail`: the Asciify Trail. The same ink field as the studio's Trail; the wake folds each character's tone, then settles.
 * - `loupe`: a glass loupe glides after the pointer and magnifies what it covers, easing through a soft rim. Uses `lantern` for radius, gain and follow.
 * - `reveal`: under a soft spotlight the characters take the source's own colours. Uses `lantern` settings.
 * - `none`: still under the pointer.
 */
export type FieldHover = 'fluid' | 'lantern' | 'trail' | 'loupe' | 'reveal' | 'none';
export const FIELD_HOVERS: readonly { value: FieldHover; label: string; description: string }[] = [
  { value: 'fluid', label: 'Fluid', description: 'An ink-in-water wake that bends the image and swirls the characters.' },
  { value: 'lantern', label: 'Lantern', description: 'A soft light follows the pointer and lifts the characters it passes, without distortion.' },
  { value: 'trail', label: 'Trail', description: 'The Asciify Trail: in the wake, sparse characters fill in and dense ones open up, then settle. No distortion.' },
  { value: 'loupe', label: 'Loupe', description: 'A glass loupe glides after the pointer and magnifies the characters it covers.' },
  { value: 'reveal', label: 'Reveal', description: 'Under a soft spotlight the characters take the source image\'s own colours. Best over a photo or video in one ink.' },
  { value: 'none', label: 'Off', description: 'The field stays still under the pointer.' },
];

export interface FieldLanternOptions {
  /** Light radius as a fraction of the field height. */
  radius: number;
  /** How far the light lifts characters toward denser glyphs. */
  strength: number;
  /** Seconds the light's tail takes to fade. 0 is no tail. */
  trail: number;
  /** How quickly the light catches the pointer; higher follows more tightly. */
  follow: number;
}
export const DEFAULT_FIELD_LANTERN: FieldLanternOptions = { radius: 0.13, strength: 0.5, trail: 0.45, follow: 12 };

/** Matches the studio's Trail hover settings, so a look moves between renderers unchanged. */
export interface FieldTrailOptions {
  /** 0–1. How far the wake folds tone. */
  strength: number;
  /** 0.1–1. Wake width. */
  radius: number;
}
export const DEFAULT_FIELD_TRAIL: FieldTrailOptions = { strength: 0.55, radius: 0.45 };

export interface FieldFluidOptions {
  /** Brush radius as a fraction of the field height. */
  radius: number;
  /** How strongly pointer speed pushes the fluid. */
  force: number;
  /** Velocity decay per second; higher settles faster. */
  dissipation: number;
  /** How far the fluid bends the sampled image, in field heights per unit of velocity. */
  refraction: number;
  /** How much a wake lifts characters toward denser glyphs and the highlight color. */
  glow: number;
  /** Longest side of the simulation grid in cells. */
  resolution: number;
  /** Vorticity: how strongly the wake curls into eddies. 0 is a straight smear. */
  curl: number;
}

export interface GlyphFieldSettings {
  /** Ordered from empty to dense. Any graphemes, including words such as " .:-+ASCIIFY". */
  charset: string;
  /** Cell height in CSS pixels. */
  cellSize: number;
  /** Cell width divided by height. 1 is a square grid. */
  cellAspect: number;
  /**
   * `pixel` (default) snaps each cell to whole device pixels. `fill` fits a whole number of cells of at least `cellSize` to the
   * canvas and stretches them to fill it exactly, as asciify-engine's core renderer lays out a frame, so rows and columns keep their
   * place however fractional the cell; each glyph sits centred in its cell, texel for texel.
   */
  cellFit: 'pixel' | 'fill';
  font: string;
  fontWeight: number;
  /** Glyph height relative to the cell. */
  glyphScale: number;
  /** See `FIELD_MARKS`. Only `glyph` reads the atlas; the others keep the charset for which cells stay empty. */
  mark: FieldMark;
  /** Largest dot as a fraction of the cell, for `mark: 'dot'`. */
  dotScale: number;
  color: FieldColor;
  ink: string;
  /** Color the wake lifts characters toward. 'auto' brightens each character's own color, so the wake never turns white. */
  highlight: string;
  /** Any CSS hex color, or "transparent". */
  background: string;
  brightness: number;
  contrast: number;
  gamma: number;
  invert: boolean;
  /** Stretch the source's tonal range so the whole charset is used. */
  levels: 'auto' | 'none';
  /**
   * Shades between two characters, drawn by mixing them across neighbouring cells in a fixed 4x4 pattern, as print
   * halftones do. 'auto' turns it on for photo and video sources drawn in nine or fewer characters, whose steps are coarse;
   * drawn interface shapes stay crisp, and ramps of ten and more are left as they are. 'coarse' does the same for any
   * source, for a canvas that paints photos. The pattern is locked to the grid, so it never shimmers.
   */
  blend: 'auto' | 'coarse' | 'on' | 'off';
  /** Glyph color saturation in source color mode. */
  saturation: number;
  /** How far darker tones dim the ink, so same-density glyphs such as words still carry the image. 0 is one flat ink. */
  shade: number;
  /** Opacity of a soft, blurred copy of the source behind the characters. 0 draws characters only. */
  backdrop: number;
  fit: FieldFit;
  /** Crop focus for cover, 0–1 on each axis. */
  focus: { x: number; y: number };
  vignette: number;
  /** Slow ambient sampling drift that keeps a still image alive. 0 is still. */
  drift: number;
  scene: FieldScene;
  /** Size of generated scenes' features; higher is finer. */
  scale: number;
  clear: FieldClearZone | false;
  /** Speed of generated scenes and drift. */
  speed: number;
  /** Which pointer response runs. */
  hover: FieldHover;
  /** Settings for the fluid hover. `false` turns it off. */
  fluid: FieldFluidOptions | false;
  /** Settings for the lantern hover. */
  lantern: FieldLanternOptions;
  /** Settings for the trail hover. */
  trail: FieldTrailOptions;
  /**
   * Where the pointer response acts: `all` (default) everywhere, `subject` only on the source's subject, `outside` only on
   * the ground around it. The subject is the source's alpha, or for an opaque source on a plain, even ground, its distance
   * from that ground; feathered at the edge. A busy photo and generated scenes have no subject, so every scope acts as `all`.
   */
  scope: HoverScope;
  maxPixelRatio: number;
  /** Stop ambient motion and soften the wake when the visitor prefers reduced motion. */
  respectReducedMotion: boolean;
}

export const DEFAULT_FIELD_FLUID: FieldFluidOptions = {
  radius: 0.075,
  force: 1,
  dissipation: 1.6,
  refraction: 0.03,
  glow: 0.55,
  resolution: 128,
  curl: 24,
};

export const DEFAULT_FIELD_SETTINGS: GlyphFieldSettings = {
  charset: ' .,:-=+*#%@',
  cellSize: 12,
  cellAspect: 1,
  cellFit: 'pixel',
  font: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  fontWeight: 500,
  glyphScale: 0.8,
  mark: 'glyph',
  dotScale: 0.9,
  color: 'ink',
  ink: '#f3ba32',
  highlight: 'auto',
  background: 'transparent',
  brightness: 0,
  contrast: 1,
  gamma: 1,
  invert: false,
  levels: 'auto',
  blend: 'auto',
  saturation: 1.1,
  shade: 0.5,
  backdrop: 0,
  fit: 'cover',
  focus: { x: 0.5, y: 0.5 },
  vignette: 0,
  drift: 0,
  scene: 'flow',
  scale: 1,
  clear: false,
  speed: 1,
  hover: 'fluid',
  fluid: DEFAULT_FIELD_FLUID,
  lantern: DEFAULT_FIELD_LANTERN,
  trail: DEFAULT_FIELD_TRAIL,
  scope: 'all',
  maxPixelRatio: 2,
  respectReducedMotion: true,
};

export type GlyphFieldInput = Partial<Omit<GlyphFieldSettings, 'fluid' | 'focus' | 'lantern' | 'trail' | 'clear'>> & {
  clear?: Partial<FieldClearZone> | false;
  trail?: Partial<FieldTrailOptions>;
  fluid?: Partial<FieldFluidOptions> | boolean;
  lantern?: Partial<FieldLanternOptions>;
  focus?: Partial<GlyphFieldSettings['focus']>;
};

const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const hex = (value: unknown, fallback: string) =>
  typeof value === 'string' && /^#([\da-f]{3}|[\da-f]{6})$/i.test(value.trim()) ? value.trim().toLowerCase() : fallback;

// Code points that never join a neighbour into one grapheme: Latin, Greek, Cyrillic, punctuation, symbols, box drawing,
// blocks, braille. Charsets made only of them skip the segmenter, whose first use loads ICU data for a few milliseconds.
const SINGLE_CODE_POINTS = /^[\u0020-\u007e\u00a0-\u02ff\u0370-\u0482\u048a-\u052f\u2010-\u20cf\u2100-\u2bff]*$/;
let segmenter: { segment(input: string): Iterable<{ segment: string }> } | null | undefined;
/** Splits a charset into graphemes so emoji, block elements and accented letters each take one cell. */
export function fieldGlyphs(charset: string): string[] {
  if (!SINGLE_CODE_POINTS.test(charset) && segmenter === undefined) {
    const Segmenter = (Intl as { Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => NonNullable<typeof segmenter> }).Segmenter;
    segmenter = Segmenter ? new Segmenter(undefined, { granularity: 'grapheme' }) : null;
  }
  const glyphs = segmenter && !SINGLE_CODE_POINTS.test(charset) ? Array.from(segmenter.segment(charset), part => part.segment) : Array.from(charset);
  return glyphs.filter(glyph => glyph !== '\n' && glyph !== '\r' && glyph !== '\t').slice(0, 256);
}

/** Mount options may carry an element-based clear zone; normalizing ignores it, since only a mounted field can measure it. */
type ClearElementLike = { element: unknown } | { nodeType: number };
export function normalizeFieldSettings(input: Omit<GlyphFieldInput, 'clear'> & { clear?: GlyphFieldInput['clear'] | ClearElementLike } = {}, base: GlyphFieldSettings = DEFAULT_FIELD_SETTINGS): GlyphFieldSettings {
  const charset = typeof input.charset === 'string' && fieldGlyphs(input.charset).length >= 2 ? input.charset : base.charset;
  const fluidBase = base.fluid || DEFAULT_FIELD_FLUID;
  const fluidInput = input.fluid === undefined ? base.fluid : input.fluid;
  const fluid: FieldFluidOptions | false = fluidInput === false ? false : (() => {
    const next = fluidInput === true || !fluidInput ? fluidBase : { ...fluidBase, ...fluidInput };
    return {
      radius: clamp(next.radius, 0.005, 0.5, DEFAULT_FIELD_FLUID.radius),
      force: clamp(next.force, 0, 8, DEFAULT_FIELD_FLUID.force),
      dissipation: clamp(next.dissipation, 0.05, 20, DEFAULT_FIELD_FLUID.dissipation),
      refraction: clamp(next.refraction, 0, 0.5, DEFAULT_FIELD_FLUID.refraction),
      glow: clamp(next.glow, 0, 2, DEFAULT_FIELD_FLUID.glow),
      resolution: Math.round(clamp(next.resolution, 16, 512, DEFAULT_FIELD_FLUID.resolution)),
      curl: clamp(next.curl, 0, 80, DEFAULT_FIELD_FLUID.curl),
    };
  })();
  const scene = FIELD_SCENES.includes(input.scene as FieldScene) ? input.scene as FieldScene : base.scene;
  const elementLike = !!input.clear && typeof input.clear === 'object' && ('element' in input.clear || 'nodeType' in input.clear);
  const clearInput = input.clear === undefined || elementLike ? base.clear : input.clear as Partial<FieldClearZone> | false;
  const clear: FieldClearZone | false = !clearInput ? false : {
    x: clamp(clearInput.x, -0.5, 1.5, 0.25),
    y: clamp(clearInput.y, -0.5, 1.5, 0.3),
    width: clamp(clearInput.width, 0, 2, 0.5),
    height: clamp(clearInput.height, 0, 2, 0.4),
    feather: clamp(clearInput.feather, 0.005, 1, 0.12),
    shape: clearInput.shape === 'rect' ? 'rect' : 'ellipse',
  };
  return {
    charset,
    cellSize: clamp(input.cellSize, 3, 96, base.cellSize),
    cellAspect: clamp(input.cellAspect, 0.3, 2, base.cellAspect),
    cellFit: input.cellFit === 'fill' || input.cellFit === 'pixel' ? input.cellFit : base.cellFit,
    font: typeof input.font === 'string' && input.font.trim() ? input.font : base.font,
    fontWeight: Math.round(clamp(input.fontWeight, 100, 900, base.fontWeight)),
    glyphScale: clamp(input.glyphScale, 0.3, 1.6, base.glyphScale),
    mark: FIELD_MARKS.includes(input.mark as FieldMark) ? input.mark as FieldMark : base.mark,
    dotScale: clamp(input.dotScale, 0.1, 1.4, base.dotScale),
    color: input.color === 'source' || input.color === 'ink' ? input.color : base.color,
    ink: hex(input.ink, base.ink),
    highlight: input.highlight === 'auto' ? 'auto' : hex(input.highlight, base.highlight),
    background: input.background === 'transparent' ? 'transparent' : hex(input.background, base.background),
    brightness: clamp(input.brightness, -1, 1, base.brightness),
    contrast: clamp(input.contrast, 0, 4, base.contrast),
    gamma: clamp(input.gamma, 0.2, 5, base.gamma),
    invert: typeof input.invert === 'boolean' ? input.invert : base.invert,
    levels: input.levels === 'none' || input.levels === 'auto' ? input.levels : base.levels,
    blend: input.blend === 'auto' || input.blend === 'coarse' || input.blend === 'on' || input.blend === 'off' ? input.blend : base.blend,
    saturation: clamp(input.saturation, 0, 3, base.saturation),
    shade: clamp(input.shade, 0, 1, base.shade),
    backdrop: clamp(input.backdrop, 0, 1, base.backdrop),
    fit: input.fit === 'contain' || input.fit === 'cover' ? input.fit : base.fit,
    focus: {
      x: clamp(input.focus?.x, 0, 1, base.focus.x),
      y: clamp(input.focus?.y, 0, 1, base.focus.y),
    },
    vignette: clamp(input.vignette, 0, 1, base.vignette),
    drift: clamp(input.drift, 0, 2, base.drift),
    scene,
    scale: clamp(input.scale, 0.2, 6, base.scale),
    clear,
    speed: clamp(input.speed, 0, 5, base.speed),
    hover: FIELD_HOVERS.some(h => h.value === input.hover) ? input.hover! : base.hover,
    fluid,
    lantern: {
      radius: clamp(input.lantern?.radius, 0.02, 0.6, base.lantern.radius),
      strength: clamp(input.lantern?.strength, 0, 1.5, base.lantern.strength),
      trail: clamp(input.lantern?.trail, 0, 3, base.lantern.trail),
      follow: clamp(input.lantern?.follow, 1, 60, base.lantern.follow),
    },
    trail: {
      strength: clamp(input.trail?.strength, 0, 1, base.trail.strength),
      radius: clamp(input.trail?.radius, 0.1, 1, base.trail.radius),
    },
    scope: input.scope === undefined ? base.scope : normalizeHoverScope(input.scope),
    maxPixelRatio: clamp(input.maxPixelRatio, 0.5, 4, base.maxPixelRatio),
    respectReducedMotion: typeof input.respectReducedMotion === 'boolean' ? input.respectReducedMotion : base.respectReducedMotion,
  };
}

/** Maps field UV (0–1, top left) to source UV as `source = uv * scale + offset`. */
export function fieldSourceRect(fieldWidth: number, fieldHeight: number, sourceWidth: number, sourceHeight: number, fit: FieldFit, focus = { x: 0.5, y: 0.5 }) {
  if (!(fieldWidth > 0 && fieldHeight > 0 && sourceWidth > 0 && sourceHeight > 0)) return { scale: [1, 1] as [number, number], offset: [0, 0] as [number, number] };
  const field = fieldWidth / fieldHeight, source = sourceWidth / sourceHeight;
  const wider = source > field;
  const scale: [number, number] = fit === 'cover'
    ? (wider ? [field / source, 1] : [1, source / field])
    : (wider ? [1, source / field] : [field / source, 1]);
  const offset: [number, number] = fit === 'cover'
    ? [(1 - scale[0]) * focus.x, (1 - scale[1]) * focus.y]
    : [(1 - scale[0]) * 0.5, (1 - scale[1]) * 0.5];
  return { scale, offset };
}

/**
 * The share of an image's resolution worth uploading to a field `width` × `height` device pixels with `cellHeight`-pixel
 * cells: at least `texelsPerCell` source texels per cell, in halving steps so the texture's mip levels sit on the
 * original's and the sampled cells stay the same. 1 keeps the image as it is, as does an unknown field size.
 */
export function fieldSourceScale(naturalWidth: number, naturalHeight: number, width: number, height: number, cellHeight: number, fit: FieldFit, texelsPerCell = 8) {
  if (!(width >= 16 && height >= 16 && naturalWidth > 0 && naturalHeight > 0 && cellHeight > 0)) return 1;
  const density = fit === 'cover' ? Math.min(naturalWidth / width, naturalHeight / height) : Math.max(naturalWidth / width, naturalHeight / height);
  const needed = texelsPerCell / cellHeight / density;
  return needed > 0.5 ? 1 : 2 ** -Math.floor(Math.log2(1 / needed));
}

/** The grid pitch in device pixels: the atlas cell for `pixel`, or a whole number of cells stretched across the canvas for `fill`. */
export function fieldCellPitch(cellFit: 'pixel' | 'fill', cellSize: number, cellAspect: number, pixelRatio: number, width: number, height: number, cell: { width: number; height: number }): [number, number] {
  if (cellFit !== 'fill' || !(width > 0 && height > 0)) return [cell.width, cell.height];
  const h = cellSize * pixelRatio, w = h * cellAspect;
  return [width / Math.max(1, Math.floor(width / w + 1e-6)), height / Math.max(1, Math.floor(height / h + 1e-6))];
}

/** Device-pixel cell and atlas layout. Cells are whole pixels so glyphs are sampled texel for texel. */
export function fieldCellLayout(cellSize: number, cellAspect: number, pixelRatio: number, glyphCount: number) {
  const height = Math.max(2, Math.round(cellSize * pixelRatio));
  const width = Math.max(2, Math.round(height * cellAspect));
  const columns = Math.min(16, Math.max(1, glyphCount));
  const rows = Math.ceil(glyphCount / columns);
  return { width, height, columns, rows, atlasWidth: columns * width, atlasHeight: rows * height };
}

export function parseFieldColor(color: string): [number, number, number] {
  const value = color.replace('#', '');
  const full = value.length === 3 ? value.split('').map(part => part + part).join('') : value;
  const number = Number.parseInt(full, 16);
  return Number.isFinite(number) && full.length === 6
    ? [((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255]
    : [0, 0, 0];
}

/** 2nd and 98th luminance percentiles of RGBA pixels, used to stretch a source across the charset. */
export function fieldLevels(pixels: Uint8ClampedArray | Uint8Array): [number, number] {
  const histogram = new Uint32Array(256);
  let count = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 8) continue;
    histogram[Math.round(0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2])]++;
    count++;
  }
  if (!count) return [0, 1];
  const at = (fraction: number) => {
    let seen = 0;
    for (let value = 0; value < 256; value++) {
      seen += histogram[value];
      if (seen >= count * fraction) return value / 255;
    }
    return 1;
  };
  const low = at(0.02), high = at(0.98);
  return high - low < 0.08 ? [0, 1] : [low, high];
}

/** The hover that actually runs: fluid needs its settings, and anything is off without a pointer response. */
export const activeFieldHover = (settings: GlyphFieldSettings): FieldHover =>
  settings.hover === 'fluid' && !settings.fluid ? 'none' : settings.hover;

/** The clear zone around an element, in field fractions; `padding` is CSS pixels added on every side. */
export function fieldClearFromRects(field: { left: number; top: number; width: number; height: number }, element: { left: number; top: number; width: number; height: number }, padding = 24, feather = 0.12, shape: FieldClearZone['shape'] = 'ellipse'): FieldClearZone | false {
  if (!(field.width > 0 && field.height > 0)) return false;
  return {
    x: (element.left - padding - field.left) / field.width,
    y: (element.top - padding - field.top) / field.height,
    width: (element.width + padding * 2) / field.width,
    height: (element.height + padding * 2) / field.height,
    feather, shape,
  };
}
