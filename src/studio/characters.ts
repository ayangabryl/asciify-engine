/** Curated ASCII ramps, each ordered by measured glyph ink from empty to dense so tone reads evenly.
 *  Use custom text to supply a different alphabet. */
export const CHARACTER_SETS = {
  standard: { label: 'Classic ASCII', chars: ' .:-=+*#%@' },
  asciify: { label: 'Asciify', chars: ' .:-=+YCIFSA#@' },
  minimal: { label: 'Minimal', chars: ' .:+' },
  detailed: { label: 'Detailed', chars: ' .,:;-~=+*xX#%@' },
  letters: { label: 'Letters', chars: ' .liLTYCFSAWM' },
  technical: { label: 'Technical', chars: ' ._:;+/>=][{}*$#@' },
  blocks: { label: 'Tonal blocks', chars: ' ░▒▓█' },
  braille: { label: 'Braille', chars: ' ⠁⠃⠇⡇⣇⣧⣷⣿' },
} as const;

export const STUDIO_CHARACTER_SETS = CHARACTER_SETS;
