/** Curated ASCII ramps. Use custom text to supply a different alphabet. */
export const CHARACTER_SETS = {
  standard: { label: 'Classic ASCII', chars: ' .:-=+*#%@' },
  asciify: { label: 'Asciify', chars: ' .:-=+ASCIIFY#@' },
  minimal: { label: 'Minimal', chars: ' .:+' },
  detailed: { label: 'Detailed', chars: ' .,:;i1tfLCG08@' },
  letters: { label: 'Letters', chars: ' .ilLCFTYASMW' },
  technical: { label: 'Technical', chars: ' .:;>_/[{}]=+*#@$' },
  blocks: { label: 'Tonal blocks', chars: ' ░▒▓█' },
  braille: { label: 'Braille', chars: ' ⠁⠃⠇⡇⣇⣧⣷⣿' },
} as const;

export const STUDIO_CHARACTER_SETS = CHARACTER_SETS;
