/**
 * renderStarsBackground — 3-D star-warp / hyperspace ASCII effect.
 */
import { parseColor, hash2 } from './_shared';

export interface StarsBackgroundOptions {
  fontSize?: number;
  /** Characters used as stars */
  chars?: string;
  /** Accent/trail colour for fast near-edge stars (default: '#d4ff00') */
  accentColor?: string;
  /** Custom base colour */
  color?: string;
  /** Global speed multiplier (default: 1) */
  speed?: number;
  /** Number of star particles (default: 180) */
  count?: number;
  /** Light mode (default: false) */
  lightMode?: boolean;
}

export function renderStarsBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  mousePos: { x: number; y: number } = { x: 0.5, y: 0.5 },
  options: StarsBackgroundOptions = {},
): void {
  const {
    fontSize    = 14,
    chars       = ' . · * + ° ★',
    accentColor = undefined as string | undefined,
    color,
    speed       = 1,
    count       = 180,
    lightMode   = false,
  } = options;
  const resolvedAccent = accentColor ?? (lightMode ? '#6b8700' : '#d4ff00');

  ctx.clearRect(0, 0, width, height);
  ctx.textBaseline = 'middle';
  ctx.textAlign    = 'center';

  const cx = width  * (0.2 + mousePos.x * 0.6);
  const cy = height * (0.2 + mousePos.y * 0.6);
  const maxR = Math.sqrt(width * width + height * height) * 0.65;

  let br = 255, bg = 255, bb = 255;
  if (lightMode) { br = 55; bg = 55; bb = 55; }
  if (color) { const p = parseColor(color); if (p) { br = p.r; bg = p.g; bb = p.b; } }

  let acR = 212, acG = 255, acB = 0;
  const ap = parseColor(resolvedAccent);
  if (ap) { acR = ap.r; acG = ap.g; acB = ap.b; }

  const charArr = chars.replace(/ /g,'').split('');
  if (charArr.length === 0) return;

  for (let i = 0; i < count; i++) {
    const angle   = hash2(i * 17,  3) * Math.PI * 2;
    const baseSpd = 0.15 + hash2(i * 31, 7) * 0.85;
    const phase   = hash2(i * 13, 11);

    const r = ((time * baseSpd * speed * 0.22 + phase) % 1.0);

    const x = cx + Math.cos(angle) * r * maxR;
    const y = cy + Math.sin(angle) * r * maxR;

    if (x < -20 || x > width + 20 || y < -20 || y > height + 20) continue;

    const sz = Math.max(6, fontSize * (0.4 + r * 0.9));
    ctx.font = `${sz}px monospace`;

    const charIdx = Math.min(charArr.length - 1, Math.floor(r * charArr.length));
    const ch = charArr[charIdx];
    const isAccent = r > 0.72;
      const alpha = lightMode ? r * 0.85 : r * 0.20;

      ctx.fillStyle = isAccent
        ? `rgba(${acR},${acG},${acB},${Math.min(lightMode ? 0.92 : 0.32, alpha * 2.2)})`
      : `rgba(${br},${bg},${bb},${alpha})`;

    ctx.fillText(ch, x, y);
  }

  ctx.textAlign = 'left';
}
