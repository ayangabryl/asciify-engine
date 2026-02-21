/**
 * renderRainBackground — digital column rain (Matrix-style).
 */
import { parseColor, hash2 } from './_shared';

export interface RainBackgroundOptions {
  fontSize?: number;
  /** Characters drawn in columns */
  chars?: string;
  /** Head / accent colour (default: '#d4ff00') */
  accentColor?: string;
  /** Custom character colour */
  color?: string;
  /** Global speed multiplier (default: 1) */
  speed?: number;
  /** Fraction of columns active at once 0-1 (default: 0.55) */
  density?: number;
  /** Number of cells in the fading tail (default: 14) */
  tailLength?: number;
  /** Light mode (default: false) */
  lightMode?: boolean;
}

export function renderRainBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  options: RainBackgroundOptions = {},
): void {
  const {
    fontSize    = 13,
    chars       = '0123456789ABCDEF@#$&*+=/<>',
    accentColor = undefined as string | undefined,
    color,
    speed       = 1,
    density     = 0.55,
    tailLength  = 14,
    lightMode   = false,
  } = options;
  const resolvedAccent = accentColor ?? (lightMode ? '#6b8700' : '#d4ff00');

  const charW = fontSize * 0.62;
  const lineH = fontSize * 1.4;
  const cols  = Math.ceil(width  / charW);
  const rows  = Math.ceil(height / lineH);

  ctx.clearRect(0, 0, width, height);
  ctx.font = `${fontSize}px monospace`;
  ctx.textBaseline = 'top';

  let br = 255, bg = 255, bb = 255;
  if (lightMode) { br = 55; bg = 55; bb = 55; }
  if (color) {
    const p = parseColor(color);
    if (p) { br = p.r; bg = p.g; bb = p.b; }
  }

  let acR = 212, acG = 255, acB = 0;
  const ap = parseColor(resolvedAccent);
  if (ap) { acR = ap.r; acG = ap.g; acB = ap.b; }

  const period = rows + tailLength;

  for (let c = 0; c < cols; c++) {
    if (hash2(c * 17, 3) > density) continue;

    const colSpeed = (0.5 + hash2(c * 31, 7) * 1.5) * speed;
    const phase    = hash2(c * 13, 11) * period;
    const headRow  = Math.floor((time * colSpeed * 7 + phase) % period);
    const x        = c * charW;

    for (let k = 0; k <= tailLength; k++) {
      const row = headRow - (tailLength - k);
      if (row < 0 || row >= rows) continue;

      const y = row * lineH;
      const charSeed = hash2(c * 53 + Math.floor(time * 5 + k), row * 7);
      const ch = chars[Math.floor(charSeed * chars.length)];
      const tRatio = k / tailLength;

      if (k === tailLength) {
        ctx.fillStyle = `rgba(${acR},${acG},${acB},${lightMode ? 0.70 : 0.85})`;
      } else {
        const alpha = lightMode ? tRatio * 0.85 : tRatio * 0.15;
        ctx.fillStyle = `rgba(${br},${bg},${bb},${alpha})`;
      }
      ctx.fillText(ch, x, y);
    }
  }
}
