import type { BackgroundPreset } from '../background';
import { mountCanvas } from './canvas';
import { hexRgb } from '../core';
import { ditherIndex } from './shared';
/**
 * renderWaveBackground — interactive ASCII wave field with vortex, sparkles,
 * breathe pulse, and cursor proximity spotlight.
 */
import { MONO, band, hash2, fbm, parseColor, pixelSnap, toneAlpha } from './shared';

export interface WaveBackgroundOptions {
  /** Font size in CSS pixels (default: 13) */
  fontSize?: number;
  /** Ordered Bayer dither amount, 0–1. Default 0. */
  ditherStrength?: number;
  /** Character aspect ratio width/height (default: 0.62) */
  charAspect?: number;
  /** Line height multiplier (default: 1.3) */
  lineHeightRatio?: number;
  /** Character set from dark→bright (default: ' .:-=+*#%@') */
  chars?: string;
  /** Base colour — use '{a}' as alpha placeholder */
  baseColor?: string;
  /** Colour near the cursor and on wave peaks (default: the base colour) */
  accentColor?: string;
  /** Accent threshold: normalised intensity above which accent kicks in (default: 0.52) */
  accentThreshold?: number;
  /** How strongly the mouse influences local intensity (default: 0.4) */
  mouseInfluence?: number;
  /** Radial falloff for mouse influence (default: 2.8) */
  mouseFalloff?: number;
  /** Base wave animation speed (default: 1) */
  speed?: number;
  /** Enable vortex swirl effect around cursor (default: true) */
  vortex?: boolean;
  /** Enable sparkle / pop flicker (default: false) */
  sparkles?: boolean;
  /** Enable a slow global breathe pulse (default: true) */
  breathe?: boolean;
  /** Light mode: swap fill colours to dark-on-light (default: false) */
  lightMode?: boolean;
}

export function renderWaveBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  mousePos: { x: number; y: number } = { x: 0.5, y: 0.5 },
  options: WaveBackgroundOptions = {},
): void {
  const {
    fontSize        = 13,
    charAspect      = 0.62,
    lineHeightRatio = 1.3,
    chars: charset           = ' .:-=+*#%@',
    baseColor       = null as string | null,
    accentColor     = undefined as string | undefined,
    accentThreshold = 0.52,
    mouseInfluence  = 0.4,
    mouseFalloff    = 2.8,
    speed           = 1,
    vortex          = true,
    sparkles        = false,
    breathe         = true,
    lightMode       = false,
  } = options;
  const chars = Array.from(charset);

  const charW = fontSize * charAspect;
  const lineH = fontSize * lineHeightRatio;
  const cols  = Math.ceil(width  / charW);
  const rows  = Math.ceil(height / lineH);
  const mx = mousePos.x;
  const my = mousePos.y;

  const accent = accentColor ? parseColor(accentColor) : null;

  ctx.clearRect(0, 0, width, height);
  ctx.font = `${fontSize}px ${MONO}`;
  const snap = pixelSnap(ctx);
  ctx.textBaseline = 'top';

  const t = time * speed;
  const breatheAmp = breathe ? (Math.sin(t * 0.22) * 0.5 + 0.5) * 0.12 : 0;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const nx = col / cols;
      const ny = row / rows;

      const w1 = Math.sin(col * 0.08 + row * 0.05 + t * 0.60) * 0.5 + 0.5;
      const w2 = Math.sin(col * 0.03 - row * 0.07 + t * 0.40) * 0.5 + 0.5;
      const w3 = Math.sin(col * 0.05 + row * 0.03 + t * 0.80) * 0.5 + 0.5;
      const sinePart = (w1 + w2 + w3) / 3;

      const noiseScale = 0.045;
      const noiseShift = t * 0.08;
      const noisePart = (fbm(col * noiseScale + noiseShift, row * noiseScale * 1.4 - noiseShift * 0.7) * 0.5 + 0.5);

      const driftFreq = 0.06;
      const driftPart = Math.sin((col + row * 0.65) * driftFreq + t * 1.1) * 0.5 + 0.5;

      const wavePart = sinePart * 0.45 + noisePart * 0.35 + driftPart * 0.20 + breatheAmp;

      const dxRaw = nx - mx;
      const dyRaw = ny - my;
      const distRaw = Math.sqrt(dxRaw * dxRaw + dyRaw * dyRaw);
      let vortexBump = 0;
      if (vortex && distRaw < 0.35) {
        const angle = Math.atan2(dyRaw, dxRaw);
        const swirl = Math.sin(angle * 4 + t * 2.2 - distRaw * 14);
        const falloff = Math.max(0, 1 - distRaw / 0.35);
        vortexBump = swirl * falloff * falloff * 0.22;
      }

      const proximity = Math.max(0, 1 - distRaw * mouseFalloff);
      const intensity = (
        wavePart * (1 - mouseInfluence) +
        (proximity + vortexBump * 0.5) * mouseInfluence
      ) + vortexBump * 0.15;
      const clamped = Math.min(1, Math.max(0, intensity));

      let finalIntensity = clamped;
      if (sparkles && clamped > 0.72) {
        const bucket = Math.floor(t * 8);
        const sparkleSeed = hash2(col * 7 + bucket * 3, row * 11 + bucket);
        if (sparkleSeed > 0.88) {
          finalIntensity = Math.min(1, clamped + (sparkleSeed - 0.88) * 4);
        }
      }

      // The quiet troughs stay empty; the crests and the cursor zone carry the characters.
      const tone = band(finalIntensity, 0.32, 0.9);
      if (tone <= 0) continue;
      const charIdx = ditherIndex(tone, chars.length, col, row, options.ditherStrength);
      if (chars[charIdx] === ' ') continue;

      const alpha = toneAlpha(tone);
      if (accent && finalIntensity > accentThreshold) {
        ctx.fillStyle = `rgba(${accent.r},${accent.g},${accent.b},${alpha})`;
      } else if (baseColor) {
        ctx.fillStyle = baseColor.replace('{a}', String(alpha));
      } else if (lightMode) {
        ctx.fillStyle = `rgba(111,109,103,${alpha})`;
      } else {
        ctx.fillStyle = `rgba(143,141,134,${alpha})`;
      }

      ctx.fillText(chars[charIdx], snap(col * charW), snap(row * lineH));
    }
  }
}

/**
 * An interference field with a soft vortex at the cursor and a slow breath.
 * @deprecated Retired from the curated set; kept so existing code still runs. `swell` is the closest current preset.
 */
export const wave: BackgroundPreset = {
  id: 'wave', name: 'Wave', description: 'An interference field with a soft vortex at the cursor and a slow breath.', cellSize: 13, speed: 0.6, cursor: true,
  mount: context => mountCanvas(context, (ctx, w, h, t, mouse, o) => {
    const [r, g, b] = hexRgb(o.ink);
    renderWaveBackground(ctx, w, h, t, mouse, { ditherStrength: o.ditherStrength, fontSize: o.fontSize, chars: o.chars, lightMode: o.lightMode, baseColor: `rgba(${r},${g},${b},{a})`, accentColor: o.accent });
  }),
};
