// ─── Asciify Types ────────────────────────────────────────────────

export type ColorMode = 'grayscale' | 'fullcolor' | 'matrix' | 'accent';
export type RenderMode = 'ascii' | 'dots';
export type AnimationStyle = 'none' | 'wave' | 'pulse' | 'rain' | 'breathe' | 'sparkle' | 'glitch' | 'spiral' | 'typewriter' | 'scatter' | 'waveField' | 'ripple' | 'melt' | 'orbit' | 'cellular';
export type ArtStyle = 'classic' | 'particles' | 'letters' | 'claudeCode' | 'art' | 'terminal' | 'box' | 'lines' | 'braille' | 'katakana' | 'musical' | 'emoji' | 'circles';
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
  fontSize: number;
  charSpacing: number;
  brightness: number;
  contrast: number;
  charset: string;
  colorMode: ColorMode;
  accentColor: string;
  invert: boolean;
  renderMode: RenderMode;
  animationStyle: AnimationStyle;
  animationSpeed: number;
  dotSizeRatio: number;
  ditherStrength: number;
  hoverStrength: number;
  hoverRadius: number;
  hoverEffect: HoverEffect;
  hoverColor: string;
  artStyle: ArtStyle;
  customText: string;
}

export interface AsciiCell {
  char: string;
  r: number;
  g: number;
  b: number;
  a: number;
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
  circles: ' .·:∘○◦°•∙',
} as const;

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
  hoverStrength: 0,
  hoverRadius: 0.2,
  hoverEffect: 'spotlight',
  hoverColor: '#ffffff',
  artStyle: 'classic',
  customText: '',
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
