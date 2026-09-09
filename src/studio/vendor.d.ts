declare module "gifenc" {
  export function GIFEncoder(): {
    writeFrame(
      index: Uint8Array,
      w: number,
      h: number,
      options: { palette: number[][]; delay: number; repeat: number },
    ): void;
    finish(): void;
    bytes(): Uint8Array;
  };
  export function quantize(
    data: Uint8ClampedArray,
    maxColors: number,
  ): number[][];
  export function applyPalette(
    data: Uint8ClampedArray,
    palette: number[][],
  ): Uint8Array;
  const api: {
    GIFEncoder: typeof GIFEncoder;
    quantize: typeof quantize;
    applyPalette: typeof applyPalette;
  };
  export default api;
}
