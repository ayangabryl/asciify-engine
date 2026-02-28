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
export { imageToAsciiFrame, videoToAsciiFrames, gifToAsciiFrames, renderFrameToCanvas }
  from './core/renderer';

// ── Simple one-call API ───────────────────────────────────────────────────────
export type { AsciifySimpleOptions, AsciifyVideoOptions, AsciifyLiveVideoOptions } from './core/simple-api';
export { asciify, asciifyGif, asciifyVideo, asciifyLiveVideo }
  from './core/simple-api';

// ── Background renderers ──────────────────────────────────────────────────────
export type { WaveBackgroundOptions }  from './backgrounds/wave';
export { renderWaveBackground }        from './backgrounds/wave';

export type { RainBackgroundOptions }  from './backgrounds/rain';
export { renderRainBackground }        from './backgrounds/rain';

export type { StarsBackgroundOptions } from './backgrounds/stars';
export { renderStarsBackground }       from './backgrounds/stars';

export type { PulseBackgroundOptions } from './backgrounds/pulse';
export { renderPulseBackground }       from './backgrounds/pulse';

export type { NoiseBackgroundOptions } from './backgrounds/noise';
export { renderNoiseBackground }       from './backgrounds/noise';

export type { GridBackgroundOptions }  from './backgrounds/grid';
export { renderGridBackground }        from './backgrounds/grid';

export type { AuroraBackgroundOptions } from './backgrounds/aurora';
export { renderAuroraBackground }       from './backgrounds/aurora';

export type { SilkBackgroundOptions }  from './backgrounds/silk';
export { renderSilkBackground }        from './backgrounds/silk';

export type { VoidBackgroundOptions }  from './backgrounds/void';
export { renderVoidBackground }        from './backgrounds/void';

export type { MorphBackgroundOptions } from './backgrounds/morph';
export { renderMorphBackground }       from './backgrounds/morph';

export type { FireBackgroundOptions }    from './backgrounds/fire';
export { renderFireBackground }          from './backgrounds/fire';

export type { DnaBackgroundOptions }     from './backgrounds/dna';
export { renderDnaBackground }           from './backgrounds/dna';

export type { TerrainBackgroundOptions } from './backgrounds/terrain';
export { renderTerrainBackground }       from './backgrounds/terrain';

export type { CircuitBackgroundOptions } from './backgrounds/circuit';
export { renderCircuitBackground }       from './backgrounds/circuit';

// ── Mount helper + combined options ──────────────────────────────────────────
export type { AsciiBackgroundOptions, BackgroundType, MountWaveOptions } from './backgrounds/index';
export { asciiBackground, BACKGROUND_TYPES, mountWaveBackground }        from './backgrounds/index';

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
