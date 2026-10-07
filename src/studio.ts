/** Optional creative studio. Importing /core never loads this module. */
export * from './studio/model';
export * from './studio/presets';
export * from './studio/renderer';
export * from './studio/media';
export * from './studio/export';
export * from './studio/mount';
export * from './studio/text';
export * from './studio/characters';
export * from './studio/curves';
export * from './studio/print-model';
export { STUDIO_WARPS, MAX_STUDIO_WARPS, normalizeStudioWarps } from './studio/warps';
export type { StudioWarp, StudioWarpType, StudioWarpEdge } from './studio/warps';
export * from './studio/project-model';
export * from './studio/project-renderer';
export * from './studio/project-mount';
export * from './studio/project-export';
export type { StudioProjectSource, StudioProjectSources, StudioProjectMedia, StudioProjectTextSource } from './studio/project-media';

export { MOTION_STYLES as STUDIO_MOTIONS } from './surface/ambient-motion';

export { SURFACE_HOVERS as STUDIO_HOVERS } from './surface/hover-catalog';
export { STUDIO_ANIMATION_PRESETS } from './surface/animation-presets';
export type { StudioAnimationPreset } from './surface/animation-presets';
