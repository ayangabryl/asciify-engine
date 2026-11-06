/**
 * Image files to pixels with no dependencies, in any runtime (Node, Deno, Bun, browsers, workers, edge): PNG and APNG,
 * JPEG (baseline and progressive), GIF (animated), BMP, PNM and QOI. Pairs with `asciify-engine/headless`:
 * `toAsciiGrid(decodeImage(bytes).frames[0] …)`. Importing does nothing.
 */
export { decodeImage, imageFormat, inflate, inflateRaw } from './decode/index';
export type { DecodedImage, DecodedFrame, DecodeOptions, ImageFormat } from './decode/index';
