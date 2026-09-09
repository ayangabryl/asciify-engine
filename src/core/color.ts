/** Parse a hex or rgb CSS colour string into { r, g, b }. Returns null on failure. */
export function parseColor(c: string): { r: number; g: number; b: number } | null {
  const hex = c.match(/^#([0-9a-f]{3,8})$/i)?.[1];
  if (hex) {
    const h = hex.length <= 4
      ? hex.split('').map(x => parseInt(x + x, 16))
      : [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)];
    return { r: h[0], g: h[1], b: h[2] };
  }
  const rgb = c.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3] };
  return null;
}

