/** Removed presets must not silently render a different style in JavaScript integrations. */
export function resolveCoreStyle(style: unknown = 'classic'): { artStyle: 'classic' } {
  if (style !== 'classic') throw new RangeError(`Art preset "${String(style)}" was removed in 4.1. Use a StudioStyle with asciify-engine/studio, or supply options.charset directly.`);
  return { artStyle: 'classic' };
}
