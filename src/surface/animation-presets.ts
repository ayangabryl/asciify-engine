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
  { id: 'quiet-light', label: 'Quiet light', description: 'Stationary detail with slowly turning light and a soft magnifying wake.',
    motion: { type: 'relight', speed: .6, amount: .7 }, hover: { effect: 'lens', radius: .45, strength: .5 } },
  { id: 'living-paper', label: 'Living paper', description: 'A gentle traveling bend and a directional pull under your cursor.',
    motion: { type: 'breeze', speed: .8, amount: .6 }, hover: { effect: 'smudge', radius: .4, strength: .5 } },
  { id: 'silver-grain', label: 'Silver grain', description: 'Slow highlight glints with a fluid character trail.',
    motion: { type: 'shimmer', speed: .75, amount: .85 }, hover: { effect: 'trail', radius: .35, strength: .55 } },
  { id: 'ripple-study', label: 'Ripple study', description: 'Soft moving light and expanding tonal rings on an anchored grid.',
    motion: { type: 'caustics', speed: .6, amount: .55 }, hover: { effect: 'ripple', radius: .45, strength: .75 } },
  { id: 'unfolding-print', label: 'Unfolding print', description: 'Panels turn and reassemble; your cursor dissolves a soft path.',
    motion: { type: 'unfold', speed: .7, amount: .75 }, hover: { effect: 'dissolve', radius: .35, strength: .55 } },
  { id: 'silk-flow', label: 'Silk flow', description: 'A slow current with directional folds that follow your hand.',
    motion: { type: 'current', speed: .6, amount: .55 }, hover: { effect: 'silk', radius: .4, strength: .5 } },
] as const satisfies readonly StudioAnimationPreset[];
