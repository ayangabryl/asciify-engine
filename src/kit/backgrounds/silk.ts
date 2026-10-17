import type { BackgroundPreset } from '../background';
import { mountCanvas } from './canvas';
import { ditherIndex } from './shared';
/**
 * renderSilkBackground — smooth directional flow-field ribbons.
 * Each cell reads its angle from a slow-drifting vector field.
 * No mouse interaction by design — pure ambient texture.
 */
import { GRAPHITE_DARK, GRAPHITE_LIGHT, MONO, band, parseColor, hash2, pixelSnap, toneAlpha } from './shared';

export interface SilkBackgroundOptions {
  /** Character grid density. Default 13. */
  fontSize?: number;
  /** Ordered Bayer dither amount, 0–1. Default 0. */
  ditherStrength?: number;
  /** Optional density ramp, replacing the directional line glyphs. */
  chars?: string;
  /** Base character color. Default theme-aware white/black. */
  color?: string;
  /** Color for intensity peaks. Default: the base color. */
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

  // Each cell draws the stroke that follows the flow there, so the ribbons read as ASCII line work.
  const customChars = options.chars ? Array.from(options.chars) : undefined;
  const dirChars = ['-', '\\', '|', '/'];

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
      // The layers average near 0.5, so only the brighter ribbons draw and the rest stays open.
      const intensity = band(intensitySum / layers, 0.54, 0.74);

      if (intensity <= 0) continue;

      const heading   = ((angle % Math.PI) + Math.PI) % Math.PI;
      const charIdx   = Math.round(heading / (Math.PI / 4)) % dirChars.length;
      if (!customChars && options.ditherStrength && ditherIndex(intensity, 2, col, row, options.ditherStrength) === 0) continue;
      const ch        = customChars ? customChars[ditherIndex(intensity, customChars.length, col, row, options.ditherStrength)] : dirChars[charIdx];

      if (ch === ' ') continue;
      const isAccent = !!ap && intensity > 0.85;
      const alpha    = toneAlpha(intensity);

      ctx.fillStyle = isAccent
        ? `rgba(${acR},${acG},${acB},${alpha})`
        : `rgba(${cr},${cg},${cb},${alpha})`;

      ctx.fillText(ch, snap(col * charW), snap(row * lineH));
    }
  }
}

/** Long ribbons that follow a slow flow field. */
export const silk: BackgroundPreset = {
  id: 'silk', name: 'Silk', description: 'Long ribbons that follow a slow flow field.', cellSize: 13, speed: 1, cursor: false,
  mount: context => mountCanvas(context, (ctx, w, h, t, _mouse, o) =>
    renderSilkBackground(ctx, w, h, t, { ditherStrength: o.ditherStrength, fontSize: o.fontSize, chars: o.chars, lightMode: o.lightMode, color: o.ink, accentColor: o.accent })),
};
