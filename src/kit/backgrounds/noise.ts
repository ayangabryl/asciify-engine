import type { BackgroundPreset } from '../background';
import { mountCanvas } from './canvas';
import { ditherIndex } from './shared';
/**
 * renderNoiseBackground — slow-drifting organic fractal noise field.
 * No directional pattern — pure ambient texture. Mouse warps the field.
 */
import { GRAPHITE_DARK, GRAPHITE_LIGHT, MONO, band, parseColor, pixelSnap, toneAlpha, vnoise } from './shared';

export interface NoiseBackgroundOptions {
  /** Font size in CSS pixels (default: 13). */
  fontSize?: number;
  /** Ordered Bayer dither amount, 0–1. Default 0. */
  ditherStrength?: number;
  /** Character ramp dark → bright (default: ' .:-=+*#%@'). */
  chars?: string;
  /** Colour for intensity peaks (default: the base colour). */
  accentColor?: string;
  /** Custom base character colour (any CSS colour string). */
  color?: string;
  /** Number of noise octaves for FBM detail (default: 4, max: 6). */
  octaves?: number;
  /** Drift / scroll speed (default: 1). */
  speed?: number;
  /** Noise scale — lower = larger blobs (default: 1). */
  scale?: number;
  /** Accent threshold 0-1 (default: 0.9). */
  accentThreshold?: number;
  /** Mouse warp radius 0-1 (default: 0.3). */
  mouseWarp?: number;
  /** Light mode (default: false). */
  lightMode?: boolean;
}

export function renderNoiseBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  mousePos: { x: number; y: number } = { x: 0.5, y: 0.5 },
  options: NoiseBackgroundOptions = {},
): void {
  const {
    fontSize        = 13,
    chars: charset           = ' .:-=+*#%@',
    accentColor     = undefined as string | undefined,
    color,
    octaves         = 4,
    speed           = 1,
    scale           = 1,
    accentThreshold = 0.9,
    mouseWarp       = 0.3,
    lightMode       = false,
  } = options;
  const chars = Array.from(charset);

  const charW = fontSize * 0.62;
  const lineH = fontSize * 1.3;
  const cols  = Math.ceil(width  / charW);
  const rows  = Math.ceil(height / lineH);

  ctx.clearRect(0, 0, width, height);
  ctx.font = `${fontSize}px ${MONO}`;
  ctx.textBaseline = 'top';

  const base = lightMode ? GRAPHITE_LIGHT : GRAPHITE_DARK;
  let br = base.r, bgc = base.g, bb = base.b;
  const snap = pixelSnap(ctx);
  if (color) { const p = parseColor(color); if (p) { br = p.r; bgc = p.g; bb = p.b; } }
  let acR = br, acG = bgc, acB = bb;
  const ap = accentColor ? parseColor(accentColor) : null; if (ap) { acR = ap.r; acG = ap.g; acB = ap.b; }

  const noiseScale = 0.035 * scale;
  const t = time * speed;
  const oct = Math.min(6, Math.max(1, octaves));

  // FBM with configurable octaves
  const fbmN = (x: number, y: number): number => {
    let v = 0, amp = 0.5, freq = 1, norm = 0;
    for (let o = 0; o < oct; o++) {
      v    += vnoise(x * freq, y * freq) * amp;
      norm += amp;
      amp  *= 0.5;
      freq *= 2.1;
    }
    return v / norm; // -1..1
  };

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const nx = col * noiseScale + t * 0.06;
      const ny = row * noiseScale * 1.3 - t * 0.04;

      // Mouse warp: displace sample coords near cursor
      const dx = col / cols - mousePos.x;
      const dy = row / rows - mousePos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const warp = mouseWarp > 0 ? Math.max(0, 1 - dist / mouseWarp) * 0.12 : 0;
      const wx = nx + warp * Math.sin(t * 1.3 + dy * 8);
      const wy = ny + warp * Math.cos(t * 0.9 + dx * 8);

      const raw  = fbmN(wx, wy);
      const norm2 = raw * 0.5 + 0.5;
      // Only the upper part of the field draws, so the texture keeps open ground between its forms.
      const tone = band(norm2, 0.7, 0.83);
      if (tone <= 0) continue;

      const charIdx = ditherIndex(tone, chars.length, col, row, options.ditherStrength);
      const ch = chars[charIdx];
      if (ch === ' ') continue;

      const isAccent = !!ap && tone > accentThreshold;
      const alpha = toneAlpha(tone);

      ctx.fillStyle = isAccent
        ? `rgba(${acR},${acG},${acB},${alpha})`
        : `rgba(${br},${bgc},${bb},${alpha})`;

      ctx.fillText(ch, snap(col * charW), snap(row * lineH));
    }
  }
}

/**
 * A slow fractal noise field that warps around the cursor.
 * @deprecated Retired from the curated set; kept so existing code still runs. `mesh` is the closest current preset.
 */
export const noise: BackgroundPreset = {
  id: 'noise', name: 'Noise', description: 'A slow fractal noise field that warps around the cursor.', cellSize: 13, speed: 0.5, cursor: true,
  mount: context => mountCanvas(context, (ctx, w, h, t, mouse, o) =>
    renderNoiseBackground(ctx, w, h, t, mouse, { ditherStrength: o.ditherStrength, fontSize: o.fontSize, chars: o.chars, lightMode: o.lightMode, color: o.ink, accentColor: o.accent })),
};
