/** Input/output coordinates use 0–1. Curves have at most 16 points, including endpoints. */
export type StudioCurvePoint = [number, number];
export const STUDIO_CURVE_CHANNELS = ['rgb', 'red', 'green', 'blue'] as const;
export type StudioCurveChannel = typeof STUDIO_CURVE_CHANNELS[number];
export type StudioCurves = Record<StudioCurveChannel, StudioCurvePoint[]>;

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Accept saved settings safely. Repeated inputs keep the last valid point. */
export function normalizeStudioCurve(input: unknown): StudioCurvePoint[] {
  const points = new Map<number, number>([[0, 0], [1, 1]]);
  if (Array.isArray(input)) for (const point of input.slice(0, 64)) {
    if (!Array.isArray(point) || point.length < 2 ||
      typeof point[0] !== 'number' || !Number.isFinite(point[0]) ||
      typeof point[1] !== 'number' || !Number.isFinite(point[1])) continue;
    const x = Math.round(clamp(point[0]) * 255) / 255;
    if (!points.has(x) && points.size >= 16) continue;
    points.set(x, clamp(point[1]));
  }
  return [...points].sort((a, b) => a[0] - b[0]);
}

export function normalizeStudioCurves(input: unknown): StudioCurves {
  const value = input && typeof input === 'object' ? input as Partial<StudioCurves> : {};
  return Object.fromEntries(STUDIO_CURVE_CHANNELS.map(channel =>
    [channel, normalizeStudioCurve(value[channel])])) as StudioCurves;
}

/** Shape-preserving cubic interpolation: no overshoot between control points.
 * The same 256 samples drive the editor graph and the pre-conversion transform.
 * Build on settings changes, never inside the per-pixel loop.
 */
export function createStudioCurveLookup(input: unknown): Uint8Array {
  const points = normalizeStudioCurve(input), count = points.length;
  const intervals = points.slice(1).map((point, i) => point[0] - points[i][0]);
  const slopes = points.slice(1).map((point, i) => (point[1] - points[i][1]) / intervals[i]);
  const tangents = new Float64Array(count);
  // Secant endpoints keep the curve bounded even when the first/last segment is inverted.
  tangents[0] = slopes[0]; tangents[count - 1] = slopes[count - 2];
  for (let i = 1; i < count - 1; i++) {
    const before = slopes[i - 1], after = slopes[i];
    if (before * after <= 0) continue;
    const w1 = 2 * intervals[i] + intervals[i - 1], w2 = intervals[i] + 2 * intervals[i - 1];
    tangents[i] = (w1 + w2) / (w1 / before + w2 / after);
  }
  const lookup = new Uint8Array(256);
  let segment = 0;
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    while (segment < count - 2 && x > points[segment + 1][0]) segment++;
    const width = intervals[segment], t = (x - points[segment][0]) / width;
    const t2 = t * t, t3 = t2 * t;
    const y = (2 * t3 - 3 * t2 + 1) * points[segment][1]
      + (t3 - 2 * t2 + t) * width * tangents[segment]
      + (-2 * t3 + 3 * t2) * points[segment + 1][1]
      + (t3 - t2) * width * tangents[segment + 1];
    lookup[i] = Math.round(clamp(y) * 255);
  }
  return lookup;
}
