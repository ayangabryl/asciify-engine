/**
 * renderFireBackground — upward-drifting fire simulation using a cellular
 * automata heat-propagation approach rendered as ASCII chars.
 */
import { parseColor } from './_shared';

export interface FireBackgroundOptions {
  /** Font size in CSS pixels (default: 13) */
  fontSize?: number;
  /** Characters mapped from cool→hot (default: ' .,:;i+xX#&@') */
  chars?: string;
  /** Base flame colour (default: '#ff4500') */
  color?: string;
  /** Secondary hot-tip colour (default: '#ffe066') */
  hotColor?: string;
  /** Flame intensity 0–1 (default: 0.85) */
  intensity?: number;
  /** Horizontal wind force -1..1 (default: 0) */
  wind?: number;
  /** Global speed multiplier (default: 1) */
  speed?: number;
  /** Light mode: invert text colours (default: false) */
  lightMode?: boolean;
}

export function renderFireBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  options: FireBackgroundOptions = {},
): void {
  const {
    fontSize  = 13,
    chars     = ' .,:;i+xX#&@',
    color     = '#ff4500',
    hotColor  = '#ffe066',
    intensity = 0.85,
    wind      = 0,
    speed     = 1,
    lightMode = false,
  } = options;

  const charW  = fontSize * 0.62;
  const lineH  = fontSize * 1.4;
  const cols   = Math.ceil(width  / charW);
  const rows   = Math.ceil(height / lineH);
  const len    = cols * rows;

  // Persistent heat buffer stored on the canvas element to survive redraws.
  const key = '__fire_heat__';
  const canvasAny = ctx.canvas as unknown as Record<string, Float32Array>;
  let heat: Float32Array = canvasAny[key] as Float32Array;
  if (!heat || heat.length !== len) {
    heat = new Float32Array(len);
    canvasAny[key] = heat;
  }

  const dt = 0.016 * speed;
  const coolingRate = 0.18 * dt;
  const windShift   = wind * speed * 0.8;

  // Seed the bottom 2 rows with hot cells every frame.
  const baseRow = rows - 1;
  const t = time * speed;
  for (let c = 0; c < cols; c++) {
    const flicker = Math.sin(c * 0.31 + t * 4.1) * 0.5 + 0.5;
    const flicker2 = Math.sin(c * 0.73 - t * 2.7) * 0.5 + 0.5;
    const seed = (flicker * 0.6 + flicker2 * 0.4) * intensity;
    heat[baseRow * cols + c] = Math.min(1, seed + Math.random() * 0.15 * intensity);
    if (baseRow > 0) heat[(baseRow - 1) * cols + c] = Math.min(1, seed * 0.85 + Math.random() * 0.1 * intensity);
  }

  // Propagate heat upward.
  const newHeat = new Float32Array(len);
  for (let r = 0; r < rows - 2; r++) {
    for (let c = 0; c < cols; c++) {
      const below    = heat[(r + 1) * cols + c];
      const below2   = heat[(r + 2) * cols + Math.max(0, Math.min(cols - 1, c + Math.round(windShift)))];
      const left     = heat[(r + 1) * cols + Math.max(0, c - 1)];
      const right    = heat[(r + 1) * cols + Math.min(cols - 1, c + 1)];
      const avg      = (below * 0.4 + below2 * 0.25 + left * 0.175 + right * 0.175);
      newHeat[r * cols + c] = Math.max(0, avg - coolingRate - Math.random() * 0.02 * speed);
    }
  }
  // Copy bottom seeded rows unchanged.
  for (let c = 0; c < cols; c++) {
    newHeat[(rows - 1) * cols + c] = heat[(rows - 1) * cols + c];
    if (rows > 1) newHeat[(rows - 2) * cols + c] = heat[(rows - 2) * cols + c];
  }
  canvasAny[key] = newHeat;

  // Parse colours.
  const cp  = parseColor(color)    ?? { r: 255, g: 69, b: 0 };
  const hp  = parseColor(hotColor) ?? { r: 255, g: 224, b: 102 };

  ctx.clearRect(0, 0, width, height);
  ctx.font = `${fontSize}px "JetBrains Mono", monospace`;
  ctx.textBaseline = 'top';

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = newHeat[r * cols + c];
      if (v < 0.03) continue;

      const charIdx = Math.min(chars.length - 1, Math.floor(v * chars.length));
      const ch = chars[charIdx];
      if (ch === ' ') continue;

      // Interpolate colour from base to hot tip.
      const blend = Math.min(1, v * 1.2);
      const r2 = (cp.r + (hp.r - cp.r) * blend) | 0;
      const g2 = (cp.g + (hp.g - cp.g) * blend) | 0;
      const b2 = (cp.b + (hp.b - cp.b) * blend) | 0;

      const alpha = lightMode ? (1 - v * 0.3) : Math.min(1, v + 0.15);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = `rgb(${r2},${g2},${b2})`;
      ctx.fillText(ch, c * charW, r * lineH);
    }
  }
  ctx.globalAlpha = 1;
}
