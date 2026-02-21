/**
 * renderMorphBackground — per-cell multi-frequency oscillation.
 * Each cell uses a unique rhythm. Pure ambient texture. No mouse interaction.
 */
import { parseColor, hash2 } from './_shared';

export interface MorphBackgroundOptions {
  /** Character grid density. Default 14. */
  fontSize?: number;
  /** Character ramp. Default clean gradient. */
  chars?: string;
  /** Base character color. Default theme-aware. */
  color?: string;
  /** Accent color for intensity peaks. Default '#d4ff00'. */
  accentColor?: string;
  /** Animation speed multiplier. Default 0.5 (intentionally slow). */
  speed?: number;
  /** How many frequency harmonics per cell. More = richer shimmer. Default 3. */
  harmonics?: number;
  /** Force light mode. Default false. */
  lightMode?: boolean;
}

export function renderMorphBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  options: MorphBackgroundOptions = {},
): void {
  const {
    fontSize   = 14,
    chars      = ' ·∙•:-=+*#',
    color,
    accentColor = undefined as string | undefined,
    speed      = 0.5,
    harmonics  = 3,
    lightMode  = false,
  } = options;
  const resolvedAccent = accentColor ?? (lightMode ? '#6b8700' : '#d4ff00');

  const charW = fontSize * 0.62;
  const lineH = fontSize * 1.4;
  const cols  = Math.ceil(width  / charW);
  const rows  = Math.ceil(height / lineH);

  ctx.clearRect(0, 0, width, height);
  ctx.font = `${fontSize}px monospace`;
  ctx.textBaseline = 'top';

  let cr = 255, cg = 255, cb = 255;
  if (lightMode) { cr = 55; cg = 55; cb = 55; }
  if (color) { const p = parseColor(color); if (p) { cr = p.r; cg = p.g; cb = p.b; } }
  let acR = 212, acG = 255, acB = 0;
  const ap = parseColor(resolvedAccent); if (ap) { acR = ap.r; acG = ap.g; acB = ap.b; }

  const t = time * speed;

  // Max possible sum: sum(1/(h+1)) for h=0..harmonics-1
  const maxV = Array.from({ length: harmonics }, (_, h) => 1 / (h + 1)).reduce((a, b) => a + b, 0);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // Each cell gets unique frequency seeds derived from its position
      let v = 0;
      for (let h = 0; h < harmonics; h++) {
        const fBase  = hash2(col * (h + 3) + 7, row * (h + 5) + 11);
        const fineF  = 0.18 + fBase * 1.4;
        const phase  = hash2(col * (h + 7), row * (h + 9) + 3) * Math.PI * 2;
        const weight = 1 / (h + 1);
        v += Math.sin(t * fineF + phase) * weight;
      }

      const norm = (v / maxV + 1) * 0.5; // 0→1

      if (norm < 0.28) continue;

      const remapped = (norm - 0.28) / 0.72;
      const charIdx  = Math.min(chars.length - 1, Math.floor(remapped * chars.length));
      const ch       = chars[charIdx];

      const isAccent = norm > 0.88;
      const alpha    = lightMode ? remapped * 0.82 : remapped * 0.13;

      ctx.fillStyle = isAccent
        ? `rgba(${acR},${acG},${acB},${lightMode ? 0.92 : 0.28})`
        : `rgba(${cr},${cg},${cb},${alpha})`;

      ctx.fillText(ch, col * charW, row * lineH);
    }
  }
}
