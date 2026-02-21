/**
 * renderVoidBackground — gravitational singularity follows the cursor.
 * Characters are pulled inward and spiral around the attractor.
 */
import { parseColor, hash2 } from './_shared';

export interface VoidBackgroundOptions {
  /** Character grid density. Default 13. */
  fontSize?: number;
  /** Character ramp. Default space-to-dense. */
  chars?: string;
  /** Base character color. Default theme-aware. */
  color?: string;
  /** Accent color for the inner singularity ring. Default '#d4ff00'. */
  accentColor?: string;
  /** Animation speed multiplier. Default 1. */
  speed?: number;
  /** Gravity well radius (fraction of canvas width). Default 0.38. */
  radius?: number;
  /** Spiral tightness — higher = more rotation per unit distance. Default 3. */
  swirl?: number;
  /** Force light mode. Default false. */
  lightMode?: boolean;
}

export function renderVoidBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  mousePos: { x: number; y: number } = { x: 0.5, y: 0.5 },
  options: VoidBackgroundOptions = {},
): void {
  const {
    fontSize    = 13,
    chars       = ' ·:;=+*#%@',
    color,
    accentColor = undefined as string | undefined,
    speed       = 1,
    radius      = 0.38,
    swirl       = 3,
    lightMode   = false,
  } = options;
  const resolvedAccent = accentColor ?? (lightMode ? '#6b8700' : '#d4ff00');

  const charW  = fontSize * 0.62;
  const lineH  = fontSize * 1.4;
  const cols   = Math.ceil(width  / charW);
  const rows   = Math.ceil(height / lineH);
  const aspect = width / height;

  ctx.clearRect(0, 0, width, height);
  ctx.font = `${fontSize}px monospace`;
  ctx.textBaseline = 'top';

  let cr = 255, cg = 255, cb = 255;
  if (lightMode) { cr = 55; cg = 55; cb = 55; }
  if (color) { const p = parseColor(color); if (p) { cr = p.r; cg = p.g; cb = p.b; } }
  let acR = 212, acG = 255, acB = 0;
  const ap = parseColor(resolvedAccent); if (ap) { acR = ap.r; acG = ap.g; acB = ap.b; }

  const t = time * speed;

  for (let row = 0; row < rows; row++) {
    const ny = row / rows;
    for (let col = 0; col < cols; col++) {
      const nx = col / cols;

      const dx   = (nx - mousePos.x) * aspect;
      const dy   = ny - mousePos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const r    = dist / radius;

      // Outside radius: very faint scattered field
      if (r > 1) {
        const outerNoise = hash2(col * 3, row * 7) * Math.max(0, 1 - (r - 1) * 3);
        if (outerNoise < 0.62) continue;
        const alpha = outerNoise * (lightMode ? 0.28 : 0.04);
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha})`;
        ctx.fillText(chars[1], col * charW, row * lineH);
        continue;
      }

      // Spiral displacement: angle rotates faster near center
      const baseAngle = Math.atan2(dy, dx * aspect);
      const swirlAmt  = (1 - r) * swirl;
      const angle     = baseAngle + swirlAmt + t * 0.4;

      // Intensity: rises sharply toward center, with animated pulse ring
      const pulseRing = Math.max(0, 1 - Math.abs(r - (0.15 + 0.12 * Math.sin(t * 1.1))) / 0.07);
      const gravity   = Math.pow(1 - r, 2.2);
      const intensity = Math.min(1, gravity + pulseRing * 0.6);

      if (intensity < 0.06) continue;

      void angle; // angle influences char variety at mid-range (kept for future use)
      const densityI = Math.floor(intensity * (chars.length - 1));
      const charIdx  = Math.min(chars.length - 1, densityI);
      const ch       = chars[charIdx];

      const isAccent = pulseRing > 0.35 || r < 0.08;
      const alpha    = lightMode ? intensity * 0.85 : intensity * 0.18;

      ctx.fillStyle = isAccent
        ? `rgba(${acR},${acG},${acB},${lightMode ? 0.95 : 0.38})`
        : `rgba(${cr},${cg},${cb},${alpha})`;

      ctx.fillText(ch, col * charW, row * lineH);
    }
  }
}
