/** One public catalog for the hero, studio, documentation and integrations. */
export const SURFACE_HOVERS = [
  { value: 'none', label: 'Off', group: 'Still', description: 'Keep the artwork still under the pointer.' },
  { value: 'trail', label: 'Trail', group: 'Change characters', description: 'A fluid wake changes character density and settles behind your cursor.' },
  { value: 'dissolve', label: 'Dissolve', group: 'Change characters', description: 'Erase a soft path through the characters; the image gradually reforms.' },
  { value: 'contour', label: 'Contour', group: 'Change characters', description: 'Fine tonal rings trace your path without moving the grid.' },
  { value: 'etch', label: 'Emboss', group: 'Change characters', description: 'Press a light-and-shadow impression into the characters; the grid stays fixed.' },
  { value: 'ripple', label: 'Ripple rings', group: 'Change characters', description: 'Expanding light-and-shadow rings follow your stroke. Faster movement excites stronger rings; the grid stays still.' },
  { value: 'bleed', label: 'Ink bleed', group: 'Change characters', description: 'Ink wells up where the cursor rests, spreads along the paper grain, then dries back.' },
  { value: 'water', label: 'Water', group: 'Move the image', description: 'Soft ripples refract the image and settle after your stroke.' },
  { value: 'silk', label: 'Silk', group: 'Move the image', description: 'Directional folds follow the movement of your hand.' },
  { value: 'vortex', label: 'Vortex', group: 'Move the image', description: 'A swirling wake curls through the image.' },
  { value: 'magnetic', label: 'Magnetic Pull', group: 'Move the image', description: 'The image gathers toward your stroke, then relaxes.' },
  { value: 'scatter', label: 'Scatter', group: 'Move the image', description: 'Characters scatter in soft drifts from your stroke, then spring back into place.' },
  { value: 'elastic', label: 'Elastic', group: 'Move the image', description: 'Push the image with your stroke; it recoils past its rest once, then settles.' },
  { value: 'lens', label: 'Lens wake', group: 'Move the image', description: 'A soft magnifying wake brings details closer, then relaxes back into focus.' },
  { value: 'smudge', label: 'Smudge', group: 'Move the image', description: 'Drag the image in the direction of your stroke; a smooth, lingering pull settles without a bounce.' },
  { value: 'loupe', label: 'Loupe', group: 'Follow the cursor', description: 'A glass loupe glides after the cursor and magnifies what it covers, easing through a soft rim.' },
  { value: 'reveal', label: 'Reveal', group: 'Follow the cursor', description: 'A soft spotlight shows the original photograph through the characters.' },
  { value: 'repel', label: 'Repel', group: 'Follow the cursor', description: 'Characters part around the cursor and spring back with one soft rebound when it leaves.' },
  { value: 'tilt', label: 'Tilt', group: 'Follow the cursor', description: 'The image leans toward the cursor; bright areas sit nearer and move more, like a parallax card.' },
  { value: 'haze', label: 'Heat haze', group: 'Follow the cursor', description: 'A rising shimmer bends the characters above the cursor, livelier while you move.' },
] as const;

/** Retired hover IDs and the effect each one now plays. Saved settings and old integrations keep working. */
export const DEPRECATED_SURFACE_HOVERS = { rake: 'silk' } as const;
export type DeprecatedSurfaceHover = keyof typeof DEPRECATED_SURFACE_HOVERS;

export type SurfaceHover = typeof SURFACE_HOVERS[number]['value'];

/** Ranges, steps and defaults of the controls every hover shares, as the Studio and `mountHover` read them. */
export const HOVER_CONTROLS = {
  radius: { label: 'Hover size', min: .1, max: 1, step: .05, default: .2 },
  strength: { label: 'Hover strength', min: 0, max: 1, step: .05, default: .55 },
  decay: { label: 'Linger', min: 0, max: 1, step: .05, default: .5 },
} as const;
/** The Studio's default hover. `mountHover` matches it, except that Trail starts with a wider radius (.45). */
export const DEFAULT_HOVER = { effect: 'trail', strength: .55, radius: .2, decay: .5, scope: 'all', edgeSafe: false } as const;

/** A current hover ID for any saved or legacy value, or undefined when it is unknown. */
export function resolveSurfaceHover(value: unknown): SurfaceHover | undefined {
  if (typeof value !== 'string') return undefined;
  if (value in DEPRECATED_SURFACE_HOVERS) return DEPRECATED_SURFACE_HOVERS[value as DeprecatedSurfaceHover];
  return SURFACE_HOVERS.some(hover => hover.value === value) ? value as SurfaceHover : undefined;
}
