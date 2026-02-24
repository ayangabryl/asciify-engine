// ─── Asciify Types ────────────────────────────────────────────────

export type ColorMode = 'grayscale' | 'fullcolor' | 'matrix' | 'accent';
export type RenderMode = 'ascii' | 'dots';
export type AnimationStyle = 'none' | 'wave' | 'pulse' | 'rain' | 'breathe' | 'sparkle' | 'glitch' | 'spiral' | 'typewriter' | 'scatter' | 'waveField' | 'ripple' | 'melt' | 'orbit' | 'cellular';
export type ArtStyle = 'classic' | 'particles' | 'letters' | 'claudeCode' | 'art' | 'terminal' | 'box' | 'lines' | 'braille' | 'katakana' | 'musical' | 'emoji' | 'circles' | 'shadows' | 'starfield' | 'geometric' | 'pipes' | 'waves' | 'shards' | 'smoke';
export type HoverEffect = 'spotlight' | 'magnify' | 'repel' | 'glow' | 'colorShift' | 'attract' | 'shatter' | 'trail';
export type HoverPreset = 'none' | 'subtle' | 'flashlight' | 'magnifier' | 'forceField' | 'neon' | 'fire' | 'ice' | 'gravity' | 'shatter' | 'ghost';

/**
 * Named colour palette presets — pass as `colorMode` for themed rendering.
 * Applied as a post-process colour remap over the standard grayscale output.
 */
export type PaletteTheme = 'dracula' | 'monokai' | 'nord' | 'catppuccin' | 'solarized' | 'gruvbox';

export const PALETTE_THEMES: Record<PaletteTheme, { name: string; accent: string; bg: string; fg: string }> = {
  dracula:    { name: 'Dracula',    accent: '#bd93f9', bg: '#282a36', fg: '#f8f8f2' },
  monokai:    { name: 'Monokai',   accent: '#a6e22e', bg: '#272822', fg: '#f8f8f2' },
  nord:       { name: 'Nord',      accent: '#88c0d0', bg: '#2e3440', fg: '#eceff4' },
  catppuccin: { name: 'Catppuccin',accent: '#cba6f7', bg: '#1e1e2e', fg: '#cdd6f4' },
  solarized:  { name: 'Solarized', accent: '#268bd2', bg: '#002b36', fg: '#839496' },
  gruvbox:    { name: 'Gruvbox',   accent: '#b8bb26', bg: '#282828', fg: '#ebdbb2' },
};
export type SourceType = 'image' | 'video' | 'gif' | null;

export interface AsciiOptions {
  /** Character cell size in pixels. Smaller = more detail, more cells. Default: `10` */
  fontSize: number;
  /** Extra horizontal spacing between characters (pixels). Default: `1` */
  charSpacing: number;
  /**
   * Brightness adjustment applied before luminance mapping.
   * Range −1 (black) → 0 (unchanged) → 1 (white). Default: `0`
   */
  brightness: number;
  /**
   * Contrast boost applied before luminance mapping.
   * `0` = unchanged, positive values increase contrast, negative decrease it.
   * Default: `0`
   */
  contrast: number;
  /**
   * Character density ramp — ordered from lightest to darkest.
   * Use `CHARSETS` for pre-built ramps or supply your own string.
   * Default: `' .:-=+*#%@'`
   */
  charset: string;
  /**
   * Colour output mode.
   * - `'grayscale'` — white-on-black monochrome
   * - `'fullcolor'` — samples pixel colours from the source
   * - `'matrix'` — green phosphor terminal look
   * - `'accent'` — single accent colour with intensity-driven brightness
   * Default: `'grayscale'`
   */
  colorMode: ColorMode;
  /**
   * The accent colour used when `colorMode` is `'accent'` or `'matrix'`.
   * Any CSS colour string. Default: `'#d4ff00'`
   */
  /**
   * Hex color string used when `colorMode` is `'accent'`.
   * Set to `'auto'` to let the engine pick contrasting ink automatically:
   * dark ink (`#0d0d0d`) in light mode, light ink (`#faf9f7`) in dark mode.
   */
  accentColor: string;
  /**
   * Invert luminance mapping (light pixels → dense chars). Default: `false`
   *
   * Set to `'auto'` to let the engine detect the OS color scheme:
   * - Light mode → inverts (bright pixel = dark char = visible on white background)
   * - Dark mode  → normal  (bright pixel = bright char = visible on dark background)
   */
  invert: boolean | 'auto';
  /**
   * Render mode.
   * - `'ascii'` — characters drawn as text
   * - `'dots'` — each cell rendered as a filled circle (particle look)
   * Default: `'ascii'`
   */
  renderMode: RenderMode;
  /**
   * Per-character animation driven over time.
   * Applies wave, glitch, rain-drop, spiral, and other effects to the rendered text.
   * Default: `'none'`
   */
  animationStyle: AnimationStyle;
  /** Speed multiplier for `animationStyle` effects. Default: `1` */
  animationSpeed: number;
  /**
   * Size of each dot relative to the cell when `renderMode === 'dots'`.
   * `1` fills the whole cell, `0.5` draws half-size circles. Default: `0.8`
   */
  dotSizeRatio: number;
  /**
   * Floyd-Steinberg dither strength applied to the luminance map.
   * `0` = no dithering, `1` = full dithering. Default: `0`
   */
  ditherStrength: number;
  /**
   * Assumed aspect ratio (width ÷ height) of a single output character.
   * Controls how many rows vs columns are generated — must match your rendering
   * environment to preserve the source image's proportions.
   * - `0.55` — browser monospace at `line-height: 1.09` (default)
   * - `0.52` — browser monospace at `line-height: 1.15`
   * - `0.5`  — most terminal emulators
   * Default: `0.55`
   */
  charAspect: number;
  /**
   * Auto-stretch the luminance range before charset mapping.
   * When `true`, the darkest pixel in the frame maps to the first charset character
   * and the brightest to the last, maximising perceived detail and contrast.
   * Particularly useful for images with low inherent contrast or muted tones.
   * Default: `false`
   */
  normalize: boolean;
  /**
   * Overall intensity of the hover / cursor interaction effect.
   * `0` disables the effect. Default: `0`
   */
  hoverStrength: number;
  /**
   * Radius of the hover interaction zone as a fraction of the canvas size.
   * `0.1` = 10% of canvas width. Default: `0.2`
   */
  hoverRadius: number;
  /**
   * Which cursor interaction style to apply when `hoverStrength > 0`.
   * See `HoverPreset` or `HOVER_PRESETS` for ready-made configurations.
   * Default: `'spotlight'`
   */
  hoverEffect: HoverEffect;
  /**
   * Tint colour used by hover effects such as spotlight, glow, and colorShift.
   * Any CSS colour string. Default: `'#ffffff'`
   */
  hoverColor: string;
  /**
   * Art style preset applied at render time.
   * Shorthand for a specific combination of `charset`, `renderMode`, and `colorMode`.
   * See `ART_STYLE_PRESETS` for the full list. Default: `'classic'`
   */
  artStyle: ArtStyle;
  /**
   * Custom repeating text used when `artStyle` is `'letters'` or when you set
   * a custom charset. Leave empty to use the selected `charset`. Default: `''`
   */
  customText: string;
  /**
   * Chroma-key colour to remove from the source (green screen / blue screen).
   * Pixels whose RGB distance from this colour is within `chromaKeyTolerance`
   * are keyed out: their character becomes a space and alpha is set to 0,
   * letting the canvas background show through.
   *
   * - `true` — **smart green screen**: heuristic detection (`g > r*1.4 && g > b*1.4`)
   *   catches every shade of green screen (lime, broadcast, chroma green) with no
   *   config. Works on virtually all studio/streaming footage.
   * - `'blue-screen'` — **smart blue screen**: same heuristic for blue.
   * - `{ r, g, b }` or CSS colour string — custom key colour + `chromaKeyTolerance`
   * - `null` / `false` — disabled (default)
   *
   * @example
   * // Standard green screen — zero config:
   * options: { chromaKey: true }
   *
   * // Blue screen — zero config:
   * options: { chromaKey: 'blue-screen' }
   *
   * // Custom CSS colour:
   * options: { chromaKey: '#00b140', chromaKeyTolerance: 70 }
   */
  chromaKey: { r: number; g: number; b: number } | string | boolean | null;
  /**
   * Euclidean RGB tolerance radius for chroma-key detection.
   * `0` = exact match only, `441` ≈ key out everything.
   * Higher values remove more pixels. Default: `60`
   */
  chromaKeyTolerance: number;
  /**
   * Array of charset strings to cycle through over time.
   * The engine picks `charsetFrames[Math.floor(time * charsetFps) % length]` on each
   * render tick, re-mapping characters from stored cell luminance.
   * Pairs beautifully with `animationStyle` and `asciiBackground`.
   *
   * Use `CHARSET_SEQUENCES` for curated combinations or build your own:
   * @example
   * options: { charsetFrames: CHARSET_SEQUENCES.cosmic }
   * options: { charsetFrames: [CHARSETS.standard, CHARSETS.blocks, CHARSETS.circles] }
   */
  charsetFrames?: string[];
  /** Cycle rate for `charsetFrames` in frames-per-second. Default: `2` */
  charsetFps?: number;
}

export interface AsciiCell {
  char: string;
  r: number;
  g: number;
  b: number;
  a: number;
  /** Stored dithered luminance (0–255). Present when the frame was generated by the engine. Used for dynamic charset re-selection at render time via `charsetFrames`. */
  lum?: number;
}

export type AsciiFrame = AsciiCell[][];

export interface AsciiResult {
  frames: AsciiFrame[];
  cols: number;
  rows: number;
  fps: number;
}

export const CHARSETS = {
  standard: ' .:-=+*#%@',
  blocks: ' ░▒▓█',
  minimal: ' .:+',
  dense: ' .\'`^",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$',
  binary: '01',
  dots: ' ⠁⠃⠇⡇⣇⣧⣷⣿',
  letters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  claudeCode: ' ╔╗╚╝║═╠╣╦╩╬░▒▓█│─┌┐└┘├┤┬┴┼',
  box: ' ▪◾◼■█',
  lines: ' ˗‐–—―━',
  braille: ' ⠁⠂⠃⠄⠅⠆⠇⠈⠉⠊⠋⠌⠍⠎⠏⠐⠑⠒⠓⠔⠕⠖⠗⠘⠙⠚⠛⠜⠝⠞⠟⠠⠡⠢⠣⠤⠥⠦⠧⠨⠩⠪⠫⠬⠭⠮⠯⠰⠱⠲⠳⠴⠵⠶⠷⠸⠹⠺⠻⠼⠽⠾⠿⡀⡁⡂⡃⡄⡅⡆⡇⣀⣁⣂⣃⣄⣅⣆⣇⣈⣉⣊⣋⣌⣍⣎⣏⣐⣑⣒⣓⣔⣕⣖⣗⣘⣙⣚⣛⣜⣝⣞⣟⣠⣡⣢⣣⣤⣥⣦⣧⣨⣩⣪⣫⣬⣭⣮⣯⣰⣱⣲⣳⣴⣵⣶⣷⣸⣹⣺⣻⣼⣽⣾⣿',
  katakana: ' ｦｧｨｩｪｫｬｭｮｯｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ',
  musical: ' ♩♪♫♬♭♮♯',
  emoji: ' ⬛🟫🟥🟧🟨🟩🟦🟪⬜',
  circles:   ' .·:∘○◦°•∙',
  shadows:   ' ·∘◦○◎⊙●◉',
  starfield:  ' ˙·∘∗✦✧★◆●',
  geometric:  ' ·△▷◇◈◆▣■█',
  pipes:      ' ╶─┐└├┤┬┴┼╬▒▓█',
  waves:      ' ˜∼≈〰≋∿∾∭∫',
  shards:     ' ╱╲╳◤◥◣◢△▲◆◼█',
  smoke:      ' ·˙⁚⁖∶∷⋮⋰⋱∴∵',
} as const;

/**
 * Curated charset sequences for use with `charsetFrames`.
 * Each sequence morphs between 2–3 complementary charsets over time,
 * creating a living texture effect.
 *
 * @example
 * asciiBackground('#hero', { charsetFrames: CHARSET_SEQUENCES.cosmic })
 */
export const CHARSET_SEQUENCES = {
  /** Stars → softcircles → orbs — dreamy space feel */
  cosmic:   [CHARSETS.starfield, CHARSETS.circles, CHARSETS.shadows] as string[],
  /** Katakana → braille dots → binary — hacker rain */
  rain:     [CHARSETS.katakana, CHARSETS.braille, CHARSETS.binary] as string[],
  /** Box pipes → Claude glyphs → classic — terminal morph */
  terminal: [CHARSETS.pipes, CHARSETS.claudeCode, CHARSETS.standard] as string[],
  /** Shards → blocks → squares — shattering crystal */
  crystal:  [CHARSETS.shards, CHARSETS.geometric, CHARSETS.blocks] as string[],
  /** Wave glyphs → smoke dots → circles — fluid / organic */
  fluid:    [CHARSETS.waves, CHARSETS.smoke, CHARSETS.circles] as string[],
  /** Dense classic → art → blocks — maximum detail pulse */
  pulse:    [CHARSETS.dense, CHARSETS.standard, CHARSETS.blocks] as string[],
  /** Braille → shadows → smoke — ethereal / dream-like */
  dream:    [CHARSETS.braille, CHARSETS.shadows, CHARSETS.smoke] as string[],
  /** Geometric shapes → shards → starfield — sci-fi angular */
  angular:  [CHARSETS.geometric, CHARSETS.shards, CHARSETS.starfield] as string[],
} as const;

export type CharsetSequenceKey = keyof typeof CHARSET_SEQUENCES;

export type CharsetKey = keyof typeof CHARSETS;

/**
 * Art Style presets — each one sets render mode, charset, color mode, etc.
 */
export const ART_STYLE_PRESETS: Record<ArtStyle, Partial<AsciiOptions>> = {
  classic: {
    renderMode: 'ascii',
    charset: CHARSETS.standard,
    colorMode: 'grayscale',
  },
  particles: {
    renderMode: 'dots',
    colorMode: 'fullcolor',
    dotSizeRatio: 0.8,
  },
  letters: {
    renderMode: 'ascii',
    charset: CHARSETS.letters,
    colorMode: 'fullcolor',
  },
  claudeCode: {
    renderMode: 'ascii',
    charset: CHARSETS.claudeCode,
    colorMode: 'accent',
    accentColor: '#f97316',
  },
  art: {
    renderMode: 'ascii',
    charset: CHARSETS.dense,
    colorMode: 'fullcolor',
  },
  terminal: {
    renderMode: 'ascii',
    charset: CHARSETS.standard,
    colorMode: 'matrix',
  },
  box: {
    renderMode: 'ascii',
    charset: CHARSETS.box,
    colorMode: 'grayscale',
  },
  lines: {
    renderMode: 'ascii',
    charset: CHARSETS.lines,
    colorMode: 'fullcolor',
  },
  braille: {
    renderMode: 'ascii',
    charset: CHARSETS.braille,
    colorMode: 'fullcolor',
  },
  katakana: {
    renderMode: 'ascii',
    charset: CHARSETS.katakana,
    colorMode: 'matrix',
  },
  musical: {
    renderMode: 'ascii',
    charset: CHARSETS.musical,
    colorMode: 'accent',
    accentColor: '#e040fb',
  },
  emoji: {
    renderMode: 'ascii',
    charset: CHARSETS.emoji,
    colorMode: 'fullcolor',
  },
  circles: {
    renderMode: 'ascii',
    charset: CHARSETS.circles,
    colorMode: 'accent',
    accentColor: '#d4ff00',
  },
  shadows: {
    renderMode: 'ascii',
    charset: CHARSETS.shadows,
    colorMode: 'accent',
    accentColor: '#50a0ff',
  },
  starfield: {
    renderMode: 'ascii',
    charset: CHARSETS.starfield,
    colorMode: 'fullcolor',
  },
  geometric: {
    renderMode: 'ascii',
    charset: CHARSETS.geometric,
    colorMode: 'grayscale',
  },
  pipes: {
    renderMode: 'ascii',
    charset: CHARSETS.pipes,
    colorMode: 'accent',
    accentColor: '#00ff88',
  },
  waves: {
    renderMode: 'ascii',
    charset: CHARSETS.waves,
    colorMode: 'fullcolor',
  },
  shards: {
    renderMode: 'ascii',
    charset: CHARSETS.shards,
    colorMode: 'grayscale',
  },
  smoke: {
    renderMode: 'ascii',
    charset: CHARSETS.smoke,
    colorMode: 'accent',
    accentColor: '#c850ff',
  },
};

export const DEFAULT_OPTIONS: AsciiOptions = {
  fontSize: 10,
  charSpacing: 1,
  brightness: 0,
  contrast: 0,
  charset: CHARSETS.standard,
  colorMode: 'grayscale',
  accentColor: '#d4ff00',
  invert: false,
  renderMode: 'ascii',
  animationStyle: 'none',
  animationSpeed: 1,
  dotSizeRatio: 0.8,
  ditherStrength: 0,
  charAspect: 0.55,
  normalize: false,
  hoverStrength: 0,
  hoverRadius: 0.2,
  hoverEffect: 'spotlight',
  hoverColor: '#ffffff',
  artStyle: 'classic',
  customText: '',
  chromaKey: null,
  chromaKeyTolerance: 60,
};

/**
 * Hover presets — one-click configurations for the hover system.
 */
export const HOVER_PRESETS: Record<HoverPreset, { label: string; options: Partial<AsciiOptions> }> = {
  none: {
    label: 'Off',
    options: { hoverStrength: 0, hoverEffect: 'spotlight', hoverRadius: 0.2, hoverColor: '#ffffff' },
  },
  subtle: {
    label: 'Subtle',
    options: { hoverStrength: 0.25, hoverEffect: 'glow', hoverRadius: 0.12, hoverColor: '#ffffff' },
  },
  flashlight: {
    label: 'Flashlight',
    options: { hoverStrength: 0.6, hoverEffect: 'spotlight', hoverRadius: 0.15, hoverColor: '#fffbe6' },
  },
  magnifier: {
    label: 'Magnifier',
    options: { hoverStrength: 0.7, hoverEffect: 'magnify', hoverRadius: 0.12, hoverColor: '#ffffff' },
  },
  forceField: {
    label: 'Force Field',
    options: { hoverStrength: 0.7, hoverEffect: 'repel', hoverRadius: 0.15, hoverColor: '#a0e8ff' },
  },
  neon: {
    label: 'Neon',
    options: { hoverStrength: 0.6, hoverEffect: 'colorShift', hoverRadius: 0.15, hoverColor: '#d946ef' },
  },
  fire: {
    label: 'Fire',
    options: { hoverStrength: 0.7, hoverEffect: 'spotlight', hoverRadius: 0.15, hoverColor: '#ff6b2b' },
  },
  ice: {
    label: 'Ice',
    options: { hoverStrength: 0.5, hoverEffect: 'glow', hoverRadius: 0.15, hoverColor: '#60d5f7' },
  },
  gravity: {
    label: 'Gravity',
    options: { hoverStrength: 0.7, hoverEffect: 'attract', hoverRadius: 0.18, hoverColor: '#a5d6ff' },
  },
  shatter: {
    label: 'Shatter',
    options: { hoverStrength: 0.8, hoverEffect: 'shatter', hoverRadius: 0.14, hoverColor: '#ff6090' },
  },
  ghost: {
    label: 'Ghost',
    options: { hoverStrength: 0.55, hoverEffect: 'trail', hoverRadius: 0.2, hoverColor: '#b39ddb' },
  },
};
