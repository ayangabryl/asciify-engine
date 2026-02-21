/**
 * renderGridBackground — CRT-style horizontal scan-line sweep.
 * Bright scan bands travel downward continuously; cursor creates a local glitch zone.
 */
import { parseColor, hash2 } from './_shared';

export interface GridBackgroundOptions {
  /** Font size in CSS pixels (default: 12). */
  fontSize?: number;
  /** Character set (default: '·-=+|/'). */
  chars?: string;
  /** Accent / scan-band colour (default: '#d4ff00'). */
  accentColor?: string;
  /** Custom base character colour (any CSS colour string). */
  color?: string;
  /** Number of scan bands visible at once (default: 3). */
  bands?: number;
  /** Band travel speed (default: 1). */
  speed?: number;
  /** Band width as fraction of canvas height (default: 0.12). */
  bandWidth?: number;
  /** Enable cursor disruption glitch zone (default: true). */
  glitch?: boolean;
  /** Light mode (default: false). */
  lightMode?: boolean;
}

export function renderGridBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  mousePos: { x: number; y: number } = { x: 0.5, y: 0.5 },
  options: GridBackgroundOptions = {},
): void {
  const {
    fontSize  = 12,
    chars     = '·-=+|/',
    accentColor = undefined as string | undefined,
    color,
    bands     = 3,
    speed     = 1,
    bandWidth = 0.12,
    glitch    = true,
    lightMode = false,
  } = options;
  const resolvedAccent = accentColor ?? (lightMode ? '#6b8700' : '#d4ff00');

  const charW = fontSize * 0.62;
  const lineH = fontSize * 1.4;
  const cols  = Math.ceil(width  / charW);
  const rows  = Math.ceil(height / lineH);

  ctx.clearRect(0, 0, width, height);
  ctx.font = `${fontSize}px monospace`;
  ctx.textBaseline = 'top';

  let br = 255, bgv = 255, bb = 255;
  if (lightMode) { br = 55; bgv = 55; bb = 55; }
  if (color) { const p = parseColor(color); if (p) { br = p.r; bgv = p.g; bb = p.b; } }
  let acR = 212, acG = 255, acB = 0;
  const ap = parseColor(resolvedAccent); if (ap) { acR = ap.r; acG = ap.g; acB = ap.b; }

  const t = time * speed;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const ny = row / rows;

      // Scan-band phase: bands cycle 0→1 over time
      const scanPhase = ((ny * bands - t * 0.5) % 1.0 + 1.0) % 1.0;
      // Intensity spike at scanPhase ≈ 0 (leading edge)
      const bandIntensity = Math.max(0, 1 - scanPhase / bandWidth);

      // Base grid texture via hash
      const gridSeed = hash2(col * 3, row * 7);
      const gridBase = (gridSeed * 0.5 + 0.5) * 0.35;

      // Cursor glitch zone
      let glitchBump = 0;
      if (glitch) {
        const dx = col / cols - mousePos.x;
        const dy = ny - mousePos.y;
        const d  = Math.sqrt(dx * dx + dy * dy);
        if (d < 0.18) {
          const g = hash2(col * 11 + Math.floor(t * 12), row * 5);
          glitchBump = Math.max(0, 1 - d / 0.18) * (g > 0.5 ? g - 0.3 : 0);
        }
      }

      const intensity = Math.min(1, gridBase + bandIntensity * 0.8 + glitchBump * 0.6);
      if (intensity < 0.04) continue;

      const charIdx = Math.floor(intensity * (chars.length - 1));
      const ch = chars[charIdx];

      const isAccent = bandIntensity > 0.55;
      const alpha = lightMode ? intensity * 0.82 : intensity * 0.12;

      ctx.fillStyle = isAccent
        ? `rgba(${acR},${acG},${acB},${lightMode ? 0.92 : 0.28})`
        : `rgba(${br},${bgv},${bb},${alpha})`;

      ctx.fillText(ch, col * charW, row * lineH);
    }
  }
}
