/**
 * renderSilkBackground — smooth directional flow-field ribbons.
 * Each cell reads its angle from a slow-drifting vector field.
 * No mouse interaction by design — pure ambient texture.
 */
import { parseColor, hash2 } from './_shared';

export interface SilkBackgroundOptions {
  /** Character grid density. Default 13. */
  fontSize?: number;
  /** Base character color. Default theme-aware white/black. */
  color?: string;
  /** Accent color for intensity peaks. Default '#d4ff00'. */
  accentColor?: string;
  /** Animation speed multiplier. Default 0.4 (intentionally slow). */
  speed?: number;
  /** Number of flow-field layers. More = richer ribbons. Default 4. */
  layers?: number;
  /** Flow turbulence (0–2). Higher = more folded, tangled ribbons. Default 0.8. */
  turbulence?: number;
  /** Force light mode. Default false. */
  lightMode?: boolean;
}

export function renderSilkBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  options: SilkBackgroundOptions = {},
): void {
  const {
    fontSize   = 13,
    color,
    accentColor = undefined as string | undefined,
    speed      = 0.4,
    layers     = 4,
    turbulence = 0.8,
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

  // Direction chars: flow-angle-mapped for the ribbon illusion
  const dirChars = ['─', '─', '╌', '·', '╌', '─', '─', '╌', '·'];

  for (let row = 0; row < rows; row++) {
    const ny = row / rows;
    for (let col = 0; col < cols; col++) {
      const nx = col / cols;

      // Stack multiple sine-based flow layers
      let angleSum = 0;
      let intensitySum = 0;
      for (let l = 0; l < layers; l++) {
        const ls  = hash2(l * 13, l * 7 + 3);
        const ls2 = hash2(l * 29, l * 11 + 1);
        const fx  = 1.1 + ls  * 2.4;
        const fy  = 0.9 + ls2 * 2.0;
        const ph  = ls * Math.PI * 6;
        const dr  = (0.2 + hash2(l * 41, l * 17) * 0.5) * (l % 2 === 0 ? 1 : -1.3);

        const u = Math.sin(nx * fx * Math.PI * 2 + t * dr + ph);
        const v = Math.cos(ny * fy * Math.PI * 2 + t * dr * 0.6 + ph * 1.7);

        const cross = Math.sin(nx * fy * Math.PI * turbulence + ny * fx * Math.PI * turbulence + t * dr * 0.4);

        angleSum     += Math.atan2(v + cross * 0.3, u);
        intensitySum += (u * v + 1) * 0.5;
      }

      const angle     = angleSum / layers;
      const intensity = Math.min(1, intensitySum / layers);

      if (intensity < 0.1) continue;

      const angleNorm = (angle + Math.PI) / (Math.PI * 2);
      const charIdx   = Math.floor(angleNorm * dirChars.length) % dirChars.length;
      const ch        = dirChars[charIdx];

      const isAccent = intensity > 0.80;
      const alpha    = lightMode ? intensity * 0.80 : intensity * 0.13;

      ctx.fillStyle = isAccent
        ? `rgba(${acR},${acG},${acB},${lightMode ? 0.90 : 0.26})`
        : `rgba(${cr},${cg},${cb},${alpha})`;

      ctx.fillText(ch, col * charW, row * lineH);
    }
  }
}
