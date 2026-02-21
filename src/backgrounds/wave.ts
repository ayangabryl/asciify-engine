/**
 * renderWaveBackground — interactive ASCII wave field with vortex, sparkles,
 * breathe pulse, and cursor proximity spotlight.
 */
import { hash2, fbm } from './_shared';

export interface WaveBackgroundOptions {
  /** Font size in CSS pixels (default: 13) */
  fontSize?: number;
  /** Character aspect ratio width/height (default: 0.62) */
  charAspect?: number;
  /** Line height multiplier (default: 1.4) */
  lineHeightRatio?: number;
  /** Character set from dark→bright (default: ' .:-=+*#%@') */
  chars?: string;
  /** Base colour — use '{a}' as alpha placeholder */
  baseColor?: string;
  /** Accent colour applied near the cursor and on wave peaks (default: '#d4ff00') */
  accentColor?: string;
  /** Accent threshold: normalised intensity above which accent kicks in (default: 0.52) */
  accentThreshold?: number;
  /** How strongly the mouse influences local intensity (default: 0.55) */
  mouseInfluence?: number;
  /** Radial falloff for mouse influence (default: 2.8) */
  mouseFalloff?: number;
  /** Base wave animation speed (default: 1) */
  speed?: number;
  /** Enable vortex swirl effect around cursor (default: true) */
  vortex?: boolean;
  /** Enable sparkle / pop flicker (default: true) */
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
    lineHeightRatio = 1.4,
    chars           = ' .:-=+*#%@',
    baseColor       = null as string | null,
    accentColor     = undefined as string | undefined,
    accentThreshold = 0.52,
    mouseInfluence  = 0.55,
    mouseFalloff    = 2.8,
    speed           = 1,
    vortex          = true,
    sparkles        = true,
    breathe         = true,
    lightMode       = false,
  } = options;
  const resolvedAccent = accentColor ?? (lightMode ? '#6b8700' : '#d4ff00');

  const charW = fontSize * charAspect;
  const lineH = fontSize * lineHeightRatio;
  const cols  = Math.ceil(width  / charW);
  const rows  = Math.ceil(height / lineH);
  const mx = mousePos.x;
  const my = mousePos.y;

  let acR = 212, acG = 255, acB = 0;
  {
    const hex = resolvedAccent.replace('#', '');
    if (hex.length === 6) {
      acR = parseInt(hex.slice(0, 2), 16);
      acG = parseInt(hex.slice(2, 4), 16);
      acB = parseInt(hex.slice(4, 6), 16);
    }
  }

  ctx.clearRect(0, 0, width, height);
  ctx.font = `${fontSize}px "JetBrains Mono", monospace`;
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

      const charIdx = Math.floor(finalIntensity * (chars.length - 1));
      if (chars[charIdx] === ' ') continue;

      const alpha = 0.015 + finalIntensity * 0.07;
      const isAccent = finalIntensity > accentThreshold;

      if (isAccent) {
        const accentAlpha = Math.min(lightMode ? 0.90 : 0.28, alpha * (lightMode ? 14 : 2.8));
        ctx.fillStyle = `rgba(${acR},${acG},${acB},${accentAlpha})`;
      } else if (baseColor) {
        ctx.fillStyle = baseColor.replace('{a}', String(alpha));
      } else if (lightMode) {
        ctx.fillStyle = `rgba(55,55,55,${alpha * 7})`;
      } else {
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      }

      ctx.fillText(chars[charIdx], col * charW, row * lineH);
    }
  }
}
