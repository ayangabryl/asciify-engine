import type { AsciiFrame } from '../types';

/** Settings can arrive before asynchronous conversion finishes. Keep the
 * current frame drawable until its replacement arrives, without rescanning
 * the same immutable frame or rebuilding an atlas for reordered characters. */
export function createFramePalette() {
  const characters = new WeakMap<AsciiFrame, string[]>();
  return (frame: AsciiFrame | undefined, charset: string, customText = '') => {
    if (!frame) return charset;
    let chars = characters.get(frame);
    if (!chars) {
      const unique = new Set<string>();
      for (const row of frame) for (const cell of row) if (cell.char) unique.add(cell.char);
      chars = [...unique].sort(); characters.set(frame, chars);
    }
    const known = charset + customText;
    return charset + chars.filter(char => !known.includes(char)).join('');
  };
}
