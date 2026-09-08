/** Optional procedural background generators. Prefer asciify-engine/core for media. */
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

