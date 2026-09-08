/** A fixed outer band with a smooth, precomputed return to full movement. */
export function surfaceEdgeWeight(x: number, y: number, aspect: number) {
  const edge = Math.min(x * Math.max(1, aspect), (1 - x) * Math.max(1, aspect), y * Math.max(1, 1 / aspect), (1 - y) * Math.max(1, 1 / aspect));
  const t = Math.max(0, Math.min(1, (edge - .035) / .105));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

