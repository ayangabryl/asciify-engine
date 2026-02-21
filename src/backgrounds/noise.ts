/**
 * renderNoiseBackground — slow-drifting organic fractal noise field.
 * No directional pattern — pure ambient texture. Mouse warps the field.
 */
import { parseColor, vnoise } from './_shared';

export interface NoiseBackgroundOptions {
  /** Font size in CSS pixels (default: 14). */
  fontSize?: number;
  /** Character ramp dark → bright (default: ' .·:;=+*#%@░▒▓'). */
  chars?: string;
  /** Accent colour on intensity peaks (default: '#d4ff00'). */
  accentColor?: string;
  /** Custom base character colour (any CSS colour string). */
  color?: string;
  /** Number of noise octaves for FBM detail (default: 4, max: 6). */
  octaves?: number;
  /** Drift / scroll speed (default: 1). */
  speed?: number;
  /** Noise scale — lower = larger blobs (default: 1). */
  scale?: number;
  /** Accent threshold 0-1 (default: 0.78). */
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
    fontSize        = 14,
    chars           = ' .·:;=+*#%@░▒▓',
    accentColor     = undefined as string | undefined,
    color,
    octaves         = 4,
    speed           = 1,
    scale           = 1,
    accentThreshold = 0.78,
    mouseWarp       = 0.3,
    lightMode       = false,
  } = options;
  const resolvedAccent = accentColor ?? (lightMode ? '#6b8700' : '#d4ff00');

  const charW = fontSize * 0.62;
  const lineH = fontSize * 1.4;
  const cols  = Math.ceil(width  / charW);
  const rows  = Math.ceil(height / lineH);

  ctx.clearRect(0, 0, width, height);
  ctx.font = `${fontSize}px monospace`;
  ctx.textBaseline = 'top';

  let br = 255, bgc = 255, bb = 255;
  if (lightMode) { br = 55; bgc = 55; bb = 55; }
  if (color) { const p = parseColor(color); if (p) { br = p.r; bgc = p.g; bb = p.b; } }
  let acR = 212, acG = 255, acB = 0;
  const ap = parseColor(resolvedAccent); if (ap) { acR = ap.r; acG = ap.g; acB = ap.b; }

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

      const raw  = fbmN(wx, wy); // -1..1
      const norm2 = raw * 0.5 + 0.5; // 0..1

      if (norm2 < 0.12) continue;

      const charIdx = Math.floor(norm2 * (chars.length - 1));
      const ch = chars[charIdx];
      if (ch === ' ') continue;

      const isAccent = norm2 > accentThreshold;
      const alpha = lightMode ? norm2 * 0.82 : norm2 * 0.13;

      ctx.fillStyle = isAccent
        ? `rgba(${acR},${acG},${acB},${lightMode ? 0.92 : 0.28})`
        : `rgba(${br},${bgc},${bb},${alpha})`;

      ctx.fillText(ch, col * charW, row * lineH);
    }
  }
}
