/** One public catalog for the hero, studio, documentation and integrations. */
export const SURFACE_HOVERS = [
  { value: 'none', label: 'Off', group: 'Still', description: 'Keep the artwork still under the pointer.' },
  { value: 'trail', label: 'Trail', group: 'Change characters', description: 'A fluid wake changes character density and settles behind your cursor.' },
  { value: 'dissolve', label: 'Dissolve', group: 'Change characters', description: 'Erase a soft path through the characters; the image gradually reforms.' },
  { value: 'contour', label: 'Contour', group: 'Change characters', description: 'Fine tonal rings trace your path without moving the grid.' },
  { value: 'etch', label: 'Emboss', group: 'Change characters', description: 'Press a light-and-shadow impression into the characters; the grid stays fixed.' },
  { value: 'water', label: 'Water', group: 'Move the image', description: 'Soft ripples refract the image and settle after your stroke.' },
  { value: 'silk', label: 'Silk', group: 'Move the image', description: 'Directional folds follow the movement of your hand.' },
  { value: 'vortex', label: 'Vortex', group: 'Move the image', description: 'A swirling wake curls through the image.' },
  { value: 'magnetic', label: 'Magnetic Pull', group: 'Move the image', description: 'The image gathers toward your stroke, then relaxes.' },
  { value: 'scatter', label: 'Scatter', group: 'Move the image', description: 'A textured outward scatter settles behind your cursor.' },
  { value: 'elastic', label: 'Elastic', group: 'Move the image', description: 'Push the image with your stroke; it recoils and springs back into place.' },
  { value: 'rake', label: 'Rake', group: 'Move the image', description: 'Comb the image into alternating ribbons that glide back into alignment.' },
] as const;

export type SurfaceHover = typeof SURFACE_HOVERS[number]['value'];
