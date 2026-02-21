/**
 * renderAuroraBackground — premium slow-drifting light bands.
 * Multiple sine layers create smooth organic interference patterns —
 * like silk, aurora borealis, or light through water.
 */
import { parseColor, hash2 } from './_shared';

export interface AuroraBackgroundOptions {
  /** Character grid density. Default 14. */
  fontSize?: number;
  /** Character ramp from sparse to dense. */
  chars?: string;
  /** Base character color. Default theme-aware white/black. */
  color?: string;
  /** Accent color for intensity peaks. Default '#d4ff00'. */
  accentColor?: string;
  /** Animation speed multiplier. Default 1. */
  speed?: number;
  /** Number of wave layers stacked. More = richer interference. Default 5. */
  layers?: number;
  /** Wave spread/softness — higher = broader, more diffuse bands. Default 1.2. */
  softness?: number;
  /** Mouse distortion radius (0–1). Elegant ripple that follows the cursor. Default 0.2. */
  mouseRipple?: number;
  /** Force light mode (dark chars on light bg). Default false. */
  lightMode?: boolean;
}

export function renderAuroraBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  mousePos: { x: number; y: number } = { x: 0.5, y: 0.5 },
  options: AuroraBackgroundOptions = {},
): void {
  const {
    fontSize    = 14,
    chars       = ' ·∙•:;+=≡≣#@',
    color,
    accentColor = undefined as string | undefined,
    speed       = 1,
    layers      = 5,
    softness    = 1.2,
    mouseRipple = 0.2,
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

  let cr = 255, cg = 255, cb = 255;
  if (lightMode) { cr = 55; cg = 55; cb = 55; }
  if (color) { const p = parseColor(color); if (p) { cr = p.r; cg = p.g; cb = p.b; } }
  let acR = 212, acG = 255, acB = 0;
  const ap = parseColor(resolvedAccent); if (ap) { acR = ap.r; acG = ap.g; acB = ap.b; }

  const t = time * speed;

  // Pre-bake layer parameters — each layer has unique freq, direction, phase offset
  const layerParams: Array<{ fx: number; fy: number; phase: number; dt: number; amp: number }> = [];
  for (let l = 0; l < layers; l++) {
    const seed  = hash2(l * 17, l * 31 + 7);
    const seed2 = hash2(l * 23 + 5, l * 11);
    layerParams.push({
      fx:    0.8 + seed  * 2.2,
      fy:    1.2 + seed2 * 1.8,
      phase: seed * Math.PI * 4,
      dt:    (0.3 + hash2(l * 7, l * 13 + 3) * 0.5) * (l % 2 === 0 ? 1 : -1),
      amp:   0.55 + hash2(l * 29, l * 3) * 0.45,
    });
  }

  for (let row = 0; row < rows; row++) {
    const ny = row / rows;

    for (let col = 0; col < cols; col++) {
      const nx = col / cols;

      // Mouse distortion: gaussian lens warp
      const mdx = nx - mousePos.x;
      const mdy = ny - mousePos.y;
      const md  = Math.sqrt(mdx * mdx + mdy * mdy);
      const warp = mouseRipple * Math.exp(-md * md / 0.06);
      const wx   = nx + mdx * warp;
      const wy   = ny + mdy * warp;

      // Sum wave layers
      let sum = 0;
      let totalAmp = 0;
      for (let l = 0; l < layers; l++) {
        const { fx, fy, phase, dt, amp } = layerParams[l];
        const wave = Math.sin(wx * fx * Math.PI * 2 + t * dt + phase)
                   * Math.cos(wy * fy * Math.PI * 2 + t * dt * 0.7 + phase * 1.3);
        sum      += wave * amp;
        totalAmp += amp;
      }

      // Normalise to 0→1 with soft sigmoid
      const rawVal = sum / totalAmp;
      const curved = 0.5 + 0.5 * Math.tanh(rawVal * softness * 2.2);

      if (curved < 0.12) continue;

      const normalized = (curved - 0.12) / 0.88;
      const charIdx = Math.min(chars.length - 1, Math.floor(normalized * chars.length));
      const ch = chars[charIdx];

      const isAccent = curved > 0.82;
      const alpha = lightMode ? curved * 0.82 : curved * 0.14;

      ctx.fillStyle = isAccent
        ? `rgba(${acR},${acG},${acB},${lightMode ? 0.92 : 0.32})`
        : `rgba(${cr},${cg},${cb},${alpha})`;

      ctx.fillText(ch, col * charW, row * lineH);
    }
  }
}
