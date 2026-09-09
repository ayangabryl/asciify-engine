import type { AsciiFrame, AsciiOptions } from '../types';

/** Only ordinary glyph ink bypasses the full renderer. Dynamic palettes and
 * color emoji keep their existing Canvas behavior. Ambient motion is composed
 * later by the surface shader and does not require repainting the glyphs. */
export function supportsSurfaceGlyphs(options?: AsciiOptions): boolean {
  return !!options && options.renderMode === 'ascii' && options.artStyle !== 'emoji' &&
    !options.charsetFrames?.length && ['fullcolor', 'grayscale', 'matrix', 'accent'].includes(options.colorMode) &&
    (options.colorMode !== 'accent' || /^#[\da-f]{6}$/i.test(options.accentColor));
}

/** Match the engine's backdrop decision without rasterizing the artwork. */
export function hasSurfaceTransparency(frame: AsciiFrame): boolean {
  const rows = frame.length, cols = frame[0]?.length ?? 0;
  for (let y = 0; y < rows; y += Math.max(1, rows >> 2))
    for (let x = 0; x < cols; x += Math.max(1, cols >> 2))
      if (frame[y][x].a < 200) return true;
  return false;
}

export function surfaceBackdrop(source: HTMLElement): number[] {
  for (let element: HTMLElement | null = source; element; element = element.parentElement) {
    const parts = getComputedStyle(element).backgroundColor.match(/[\d.]+/g)?.map(Number);
    if (parts && parts.length >= 3 && (parts[3] ?? 1) > .5)
      return (parts[0] * .299 + parts[1] * .587 + parts[2] * .114) / 255 < .4 ? [10 / 255, 10 / 255, 10 / 255, 1] : [250 / 255, 249 / 255, 247 / 255, 1];
  }
  const theme = document.documentElement.dataset.theme;
  if (theme !== 'dark' && theme !== 'light' && !source.isConnected && document.body) return surfaceBackdrop(document.body);
  const dark = theme === 'dark' || theme !== 'light' && (document.documentElement.classList.contains('dark') || matchMedia('(prefers-color-scheme: dark)').matches);
  return dark ? [10 / 255, 10 / 255, 10 / 255, 1] : [250 / 255, 249 / 255, 247 / 255, 1];
}
