// ─── Asciify Engine ───────────────────────────────────────────────
// Public API — re-exports everything from the engine and types.

// Types
export type {
  ColorMode,
  RenderMode,
  AnimationStyle,
  ArtStyle,
  HoverEffect,
  HoverPreset,
  HoverShape,
  PaletteTheme,
  SourceType,
  AsciiOptions,
  AsciiCell,
  AsciiFrame,
  AsciiResult,
  CharsetKey,
  CharsetSequenceKey,
} from './types';

// Constants & presets
export {
  CHARSETS,
  CHARSET_SEQUENCES,
  ART_STYLE_PRESETS,
  DEFAULT_OPTIONS,
  HOVER_PRESETS,
  PALETTE_THEMES,
} from './types';

// Simple one-call API
export type { AsciifySimpleOptions, AsciifyVideoOptions, AsciifyLiveVideoOptions } from './ascii-engine';
export { asciify, asciifyGif, asciifyVideo, asciifyLiveVideo, asciifyWebcam } from './ascii-engine';
export type { WebcamOptions } from './ascii-engine';

// Core engine functions
export type {
  WaveBackgroundOptions,
  RainBackgroundOptions,
  StarsBackgroundOptions,
  PulseBackgroundOptions,
  NoiseBackgroundOptions,
  GridBackgroundOptions,
  MountWaveOptions,
  AsciiBackgroundOptions,
  AuroraBackgroundOptions,
  SilkBackgroundOptions,
  VoidBackgroundOptions,
  MorphBackgroundOptions,
  FireBackgroundOptions,
  DnaBackgroundOptions,
  TerrainBackgroundOptions,
  CircuitBackgroundOptions,
  BackgroundType,
  SnapshotOptions,
  TextBackgroundOptions,
} from './ascii-engine';
export {
  imageToAsciiFrame,
  videoToAsciiFrames,
  gifToAsciiFrames,
  renderFrameToCanvas,
  renderWaveBackground,
  renderRainBackground,
  renderStarsBackground,
  renderPulseBackground,
  renderNoiseBackground,
  renderGridBackground,
  renderAuroraBackground,
  renderSilkBackground,
  renderVoidBackground,
  renderMorphBackground,
  renderFireBackground,
  renderDnaBackground,
  renderTerrainBackground,
  renderCircuitBackground,
  asciiBackground,
  BACKGROUND_TYPES,
  mountWaveBackground,
  asciiText,
  asciiTextAnsi,
  buildTextFrame,
  renderTextBackground,
  captureSnapshot,
  snapshotAndDownload,
} from './ascii-engine';

