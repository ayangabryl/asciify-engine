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
} from './types';

// Constants & presets
export {
  DEFAULT_OPTIONS,
  HOVER_PRESETS,
  PALETTE_THEMES,
} from './types';

/**
 * ascii-engine.ts — backward-compatible re-export barrel.
 *
 * All public surface is forwarded from the modular sub-packages so that
 * existing imports (`import { ... } from 'asciify-engine'`) continue to work
 * without any changes.
 *
 * DO NOT add logic here — this file is intentionally a pure barrel.
 */

// ── Core rendering ────────────────────────────────────────────────────────────
export type { AsciiTextFrame } from './core/renderer';
export { imageToAsciiFrame, imageToAsciiTextFrame, videoToAsciiFrames, videoToAsciiTextFrames, gifToAsciiFrames, gifToAsciiTextFrames, renderFrameToCanvas, renderTextFrameToCanvas, clearAsciifyCaches }
  from './core/renderer';

// ── Simple one-call API ───────────────────────────────────────────────────────
export type { AsciifySimpleOptions, AsciifyVideoOptions, AsciifyLiveVideoOptions, VideoScrollScrubOptions, CanvasObjectFit, CanvasBleed, CanvasRenderSizeInput } from './core/simple-api';
export { asciify, asciifyGif, asciifyVideo, asciifyLiveVideo, createVideoScrollScrub, computeCanvasRenderSize }
  from './core/simple-api';

// ── asciiText / ANSI export ───────────────────────────────────────────────────
export { asciiText, asciiTextAnsi } from './core/ascii-text';

// ── Text frame / interactive text backgrounds ─────────────────────────────────
export type { TextBackgroundOptions } from './core/text-frame';
export { buildTextFrame, renderTextBackground } from './core/text-frame';

// ── Snapshot API ─────────────────────────────────────────────────────────────
export type { SnapshotOptions } from './core/record';
export { captureSnapshot, snapshotAndDownload } from './core/record';

// ── Webcam API ────────────────────────────────────────────────────────────────
export type { WebcamOptions } from './core/webcam';
export { asciifyWebcam } from './core/webcam';

// ── Big-text / Figlet-style ────────────────────────────────────────────────
export type { BigTextOptions } from './core/big-text';
export { asciifyText, renderTextToCanvas } from './core/big-text';

export { CHARACTER_SETS } from './studio/characters';

/** Data-only catalog; renderer implementations remain in the optional /studio entry. */
export { STUDIO_STYLES } from './studio/model';
export type { StudioStyle } from './studio/model';
