/**
 * asciify-engine/headless: pixels in, characters out, with no DOM and no dependencies. For Node, Deno, Bun, workers and edge
 * runtimes (OG images, CLIs, emails, READMEs, server-rendered pages) as well as the browser. Importing it never touches the page.
 */
export { toAsciiGrid, glyphInk, ASCII_SYMBOLS } from './headless/grid';
export type { AsciiPixels, AsciiGridOptions, AsciiGrid } from './headless/grid';
export { gridToText, gridToAnsi, gridToSvg, gridToHtml } from './headless/format';
export type { AnsiOptions, MarkupOptions } from './headless/format';
