/** Small edge-preserving source filter. One fixed 3×3 neighborhood per sampled
 * pixel, no runtime kernels or growing history. Transparent RGB cannot bleed in.
 */
export class SourceDenoiser {
  private amount = 0;
  private weights = new Float32Array(256);
  private source = new Uint8ClampedArray(0);

  constructor(amount = 0) { this.configure(amount); }

  configure(value = 0) {
    const amount = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
    if (amount === this.amount) return;
    this.amount = amount;
    if (amount === 0) { this.source = new Uint8ClampedArray(0); return; }
    const sigma = 8 + amount * 24;
    for (let i = 0; i < 256; i++) this.weights[i] = Math.exp(-i * i / (2 * sigma * sigma));
  }

  apply(pixels: Uint8ClampedArray, width: number, height: number) {
    if (!this.amount) return;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width * height * 4 !== pixels.length) throw new Error('Denoise dimensions do not match the source.');
    if (this.source.length !== pixels.length) this.source = new Uint8ClampedArray(pixels.length);
    const source = this.source;
    source.set(pixels);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (!source[i + 3]) continue;
      const red = source[i], green = source[i + 1], blue = source[i + 2];
      let r = 0, g = 0, b = 0, total = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const row = y + dy;
        if (row < 0 || row >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const col = x + dx;
          if (col < 0 || col >= width) continue;
          const j = (row * width + col) * 4;
          if (!source[j + 3]) continue;
          const distance = Math.max(Math.abs(source[j] - red), Math.abs(source[j + 1] - green), Math.abs(source[j + 2] - blue));
          const weight = this.weights[distance] * (dx === 0 ? 1 : .6) * (dy === 0 ? 1 : .6) * source[j + 3];
          r += source[j] * weight; g += source[j + 1] * weight; b += source[j + 2] * weight;
          total += weight;
        }
      }
      pixels[i] = red + (r / total - red) * this.amount;
      pixels[i + 1] = green + (g / total - green) * this.amount;
      pixels[i + 2] = blue + (b / total - blue) * this.amount;
    }
  }
}
