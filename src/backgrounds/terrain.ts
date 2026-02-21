/**
 * renderTerrainBackground — scrolling ASCII side-scroll heightmap landscape
 * generated from layered Perlin-style noise.
 */
import { parseColor, fbm, hash2 } from './_shared';

export interface TerrainBackgroundOptions {
  /** Font size in CSS pixels (default: 13) */
  fontSize?: number;
  /** Characters for terrain density (default: ' .,:;+*#@') */
  chars?: string;
  /** Foreground ground colour (default: '#4caf50') */
  color?: string;
  /** Sky / star colour (default: '#1a237e') */
  skyColor?: string;
  /** Peak / snow-cap colour (default: '#e0e0e0') */
  peakColor?: string;
  /** Horizontal scroll speed (default: 1) */
  speed?: number;
  /** Terrain roughness 0.1–1 (default: 0.55) */
  roughness?: number;
  /** Mountain height fraction 0–1 (default: 0.55) */
  heightScale?: number;
  /** Show faint background stars (default: true) */
  stars?: boolean;
  /** Light mode (default: false) */
  lightMode?: boolean;
}

export function renderTerrainBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  options: TerrainBackgroundOptions = {},
): void {
  const {
    fontSize    = 13,
    chars       = ' .,:;+*#@',
    color       = '#4caf50',
    skyColor    = '#1a237e',
    peakColor   = '#e0e0e0',
    speed       = 1,
    roughness   = 0.55,
    heightScale = 0.55,
    stars       = true,
    lightMode   = false,
  } = options;

  const charW = fontSize * 0.62;
  const lineH = fontSize * 1.4;
  const cols  = Math.ceil(width  / charW);
  const rows  = Math.ceil(height / lineH);

  const cp   = parseColor(color)     ?? { r: 76,  g: 175, b: 80  };
  const sky  = parseColor(skyColor)  ?? { r: 26,  g: 35,  b: 126 };
  const peak = parseColor(peakColor) ?? { r: 224, g: 224, b: 224 };
  void lightMode;

  ctx.clearRect(0, 0, width, height);
  ctx.font = `${fontSize}px "JetBrains Mono", monospace`;
  ctx.textBaseline = 'top';

  const scroll = time * speed * 0.4;

  // Pre-compute terrain height per column.
  const terrainRow: number[] = new Array(cols);
  for (let c = 0; c < cols; c++) {
    const nx = (c / cols + scroll) * roughness * 3;
    const h = (fbm(nx, 0.5) * 0.5 + 0.5) * heightScale;
    terrainRow[c] = Math.floor(h * rows);
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const terrainStart = rows - 1 - terrainRow[c];
      const isGround = r >= terrainStart;
      const isNearPeak = r === terrainStart;

      if (!isGround) {
        // Sky region: occasional stars.
        if (stars) {
          const starSeed = hash2(c * 7 + Math.floor(scroll * 0.3), r * 13);
          if (starSeed > 0.97) {
            const twinkle = Math.sin(time * 2 + starSeed * 100) * 0.3 + 0.7;
            ctx.globalAlpha = twinkle * 0.5;
            ctx.fillStyle = `rgb(${sky.r + 60},${sky.g + 60},${sky.b + 80})`;
            ctx.fillText('·', c * charW, r * lineH);
          }
        }
        continue;
      }

      // Ground: depth based on distance from surface.
      const depth = (r - terrainStart) / Math.max(1, terrainRow[c]);
      const charIdx = Math.min(chars.length - 1, Math.floor(depth * chars.length));
      const ch = chars[charIdx];
      if (ch === ' ' && !isNearPeak) continue;

      const blendPeak = isNearPeak ? 1 : Math.max(0, 1 - depth * 4);
      const r2 = ((cp.r + (peak.r - cp.r) * blendPeak) | 0);
      const g2 = ((cp.g + (peak.g - cp.g) * blendPeak) | 0);
      const b2 = ((cp.b + (peak.b - cp.b) * blendPeak) | 0);

      ctx.globalAlpha = 0.5 + depth * 0.5;
      ctx.fillStyle = `rgb(${r2},${g2},${b2})`;
      ctx.fillText(isNearPeak ? chars[chars.length - 1] : ch, c * charW, r * lineH);
    }
  }

  ctx.globalAlpha = 1;
}
