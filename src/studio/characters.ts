/** Curated ramps (ASCII, blocks, braille, the ocean's fish letters and Japanese kanji), each ordered by measured glyph ink from empty to dense so tone reads evenly.
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
  fish: { label: 'Fish', chars: " .'-,:;txoSX%#8@" },
  kanji: { label: 'Kanji (Japanese)', chars: ' 一二人小大中日本目田長間語書曜驚霧' },
} as const;

export type CharacterSetName = keyof typeof CHARACTER_SETS;

/** A named set's characters, or your own characters with the empty first step a ramp needs. Undefined for nothing. */
export function resolveCharset(charset: string | undefined): string | undefined {
  if (!charset) return undefined;
  if (Object.prototype.hasOwnProperty.call(CHARACTER_SETS, charset)) return CHARACTER_SETS[charset as CharacterSetName].chars;
  return charset.startsWith(' ') ? charset : ' ' + charset;
}

export const STUDIO_CHARACTER_SETS = CHARACTER_SETS;

const WIDE = /^[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]|^[\u{20000}-\u{3fffd}]/u;
/** A full-width glyph (CJK ideographs, kana, Hangul, full-width forms): it fills a square, not a tall cell. */
export const isWideGlyph = (glyph: string) => WIDE.test(glyph);
/** System Japanese faces first, so kanji take their Japanese forms whatever the field's own font. */
export const WIDE_FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", YuGothic, "Noto Sans JP", "Noto Sans CJK JP", Meiryo, sans-serif';
