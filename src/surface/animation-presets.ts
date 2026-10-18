import type { AmbientMotion } from './ambient-motion';
import type { SurfaceHover } from './hover-catalog';

export interface StudioAnimationPreset {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly motion: { readonly type: AmbientMotion; readonly speed: number; readonly amount: number };
  readonly hover: { readonly effect: SurfaceHover; readonly radius: number; readonly strength: number };
}

/** Starting combinations, not new renderer styles. Preserve the image and its look. */
export const STUDIO_ANIMATION_PRESETS = [
  { id: 'quiet-light', label: 'Quiet light', description: 'A key light circles the subject’s own relief, with a soft magnifying wake.',
    motion: { type: 'relight', speed: .6, amount: .8 }, hover: { effect: 'lens', radius: .45, strength: .5 } },
  { id: 'living-paper', label: 'Memory', description: 'A slow push toward the subject; the image leans toward your cursor.',
    motion: { type: 'push', speed: .5, amount: .8 }, hover: { effect: 'tilt', radius: .5, strength: .45 } },
  { id: 'silver-grain', label: 'Silver light', description: 'Sparse glints on bright detail, with a fluid character trail.',
    motion: { type: 'shimmer', speed: .6, amount: .9 }, hover: { effect: 'trail', radius: .35, strength: .55 } },
  { id: 'ripple-study', label: 'Still water', description: 'Smooth water and sky drift like a cinemagraph; your stroke sends out rings.',
    motion: { type: 'current', speed: .6, amount: .8 }, hover: { effect: 'ripple', radius: .45, strength: .7 } },
  { id: 'unfolding-print', label: 'Darkroom', description: 'The print develops from its highlights; your cursor dissolves a soft path.',
    motion: { type: 'develop', speed: .7, amount: 1 }, hover: { effect: 'dissolve', radius: .35, strength: .55 } },
  { id: 'silk-flow', label: 'Morning mist', description: 'Mist drifts through the distance; directional folds follow your hand.',
    motion: { type: 'mist', speed: .6, amount: 1 }, hover: { effect: 'silk', radius: .4, strength: .5 } },
  { id: 'depth-study', label: 'Depth study', description: 'A slow parallax drift from the photo’s own depth, with a loupe under your cursor.',
    motion: { type: 'parallax', speed: .6, amount: .9 }, hover: { effect: 'loupe', radius: .35, strength: .55 } },
] as const satisfies readonly StudioAnimationPreset[];
