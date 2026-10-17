import type { BackgroundPreset } from '../background';
import { mountCanvas } from './canvas';
import { ditherIndex } from './shared';
/**
 * renderAuroraBackground — premium slow-drifting light bands.
 * Multiple sine layers create smooth organic interference patterns —
 * like silk, aurora borealis, or light through water.
 */
import { GRAPHITE_DARK, GRAPHITE_LIGHT, MONO, band, parseColor, hash2, pixelSnap, toneAlpha } from './shared';

export interface AuroraBackgroundOptions {
  /** Character grid density. Default 13. */
  fontSize?: number;
  /** Ordered Bayer dither amount, 0–1. Default 0. */
  ditherStrength?: number;
  /** Character ramp from sparse to dense. */
  chars?: string;
  /** Base character color. Default theme-aware white/black. */
  color?: string;
  /** Color for intensity peaks. Default: the base color. */
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
    fontSize    = 13,
    chars: charset       = ' .:-=+*#%',
    color,
    accentColor = undefined as string | undefined,
    speed       = 1,
    layers      = 5,
    softness    = 1.2,
    mouseRipple = 0.2,
    lightMode   = false,
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
  let cr = base.r, cg = base.g, cb = base.b;
  const snap = pixelSnap(ctx);
  if (color) { const p = parseColor(color); if (p) { cr = p.r; cg = p.g; cb = p.b; } }
  let acR = cr, acG = cg, acB = cb;
  const ap = accentColor ? parseColor(accentColor) : null; if (ap) { acR = ap.r; acG = ap.g; acB = ap.b; }

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

      // The lower half of the light stays dark, so the bands read as light on an open ground.
      const normalized = band(curved, 0.48, 0.94);
      if (normalized <= 0) continue;
      const charIdx = ditherIndex(normalized, chars.length, col, row, options.ditherStrength);
      const ch = chars[charIdx];
      if (ch === ' ') continue;

      const isAccent = !!ap && curved > 0.86;
      const alpha = toneAlpha(normalized);

      ctx.fillStyle = isAccent
        ? `rgba(${acR},${acG},${acB},${alpha})`
        : `rgba(${cr},${cg},${cb},${alpha})`;

      ctx.fillText(ch, snap(col * charW), snap(row * lineH));
    }
  }
}

/** Soft bands of light drift across the page and ripple under the cursor. */
export const aurora: BackgroundPreset = {
  id: 'aurora', name: 'Aurora', description: 'Soft bands of light drift across the page and ripple under the cursor.', cellSize: 13, speed: 0.6, cursor: true,
  mount: context => mountCanvas(context, (ctx, w, h, t, mouse, o) =>
    renderAuroraBackground(ctx, w, h, t, mouse, { ditherStrength: o.ditherStrength, fontSize: o.fontSize, chars: o.chars, lightMode: o.lightMode, color: o.ink, accentColor: o.accent })),
};
