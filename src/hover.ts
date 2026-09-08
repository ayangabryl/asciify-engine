/** Optional GPU surface hovers, living-image motion and fine dither.
 * Importing the engine root or /core never imports this module.
 */
export { mountStudioHover, mountStudioHover as mountHover } from './surface/studio-hover';
export type { StudioHoverOptions, StudioHoverOptions as HoverOptions, StudioHoverEffect } from './surface/studio-hover';
export type { AmbientMotion } from './surface/ambient-motion';
export type HoverController = ReturnType<typeof import('./surface/studio-hover').mountStudioHover>;
