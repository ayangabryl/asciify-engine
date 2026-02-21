/**
 * renderPulseBackground — concentric ASCII ring pulses emanating from the cursor.
 */
import { parseColor } from './_shared';

export interface PulseBackgroundOptions {
  fontSize?: number;
  /** Characters to tile (default: '. · ○ ◎ ●') */
  chars?: string;
  /** Ring peak colour (default: '#00ffcc') */
  accentColor?: string;
  /** Custom base colour */
  color?: string;
  /** Number of simultaneous rings (default: 5) */
  rings?: number;
  /** Animation speed (default: 1) */
  speed?: number;
  /** Ring edge sharpness 1–10 (default: 4) */
  sharpness?: number;
  /** Light mode (default: false) */
  lightMode?: boolean;
}

export function renderPulseBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  mousePos: { x: number; y: number } = { x: 0.5, y: 0.5 },
  options: PulseBackgroundOptions = {},
): void {
  const {
    fontSize   = 14,
    chars      = '. · ○ ◎ ●',
    accentColor = undefined as string | undefined,
    color,
    rings      = 5,
    speed      = 1,
    sharpness  = 4,
    lightMode  = false,
  } = options;
  const resolvedAccent = accentColor ?? (lightMode ? '#007a5e' : '#00ffcc');

  ctx.clearRect(0, 0, width, height);
  ctx.textBaseline = 'middle';
  ctx.textAlign    = 'center';

  const cx = width  * mousePos.x;
  const cy = height * mousePos.y;
  const maxDist = Math.sqrt(cx * cx + cy * cy) * 1.6 + Math.sqrt(width * width + height * height) * 0.2;

  let br = 255, bg = 255, bb = 255;
  if (lightMode) { br = 55; bg = 55; bb = 55; }
  if (color) { const p = parseColor(color); if (p) { br = p.r; bg = p.g; bb = p.b; } }

  let acR = 0, acG = 255, acB = 204;
  const ap = parseColor(resolvedAccent);
  if (ap) { acR = ap.r; acG = ap.g; acB = ap.b; }

  const charArr = chars.replace(/ /g,'').split('');
  if (charArr.length === 0) return;

  const cols = Math.ceil(width  / fontSize);
  const rows = Math.ceil(height / fontSize);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const px = col * fontSize + fontSize * 0.5;
      const py = row * fontSize + fontSize * 0.5;
      const dx = px - cx;
      const dy = py - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const norm = dist / maxDist; // 0..1+

      let totalIntensity = 0;
      for (let r = 0; r < rings; r++) {
        const phase = r / rings;
        const t = ((time * speed * 0.38 + phase) % 1.0);
        const ringDist = Math.abs(norm - t);
        const ringNorm = Math.max(0, 1 - ringDist * maxDist / (fontSize * (12 - sharpness)));
        totalIntensity += Math.cos(ringNorm * Math.PI * 0.5) * ringNorm;
      }
      totalIntensity = Math.min(1, totalIntensity);

      if (totalIntensity < 0.02) continue;

      const isAccent = totalIntensity > 0.6;
      ctx.font = `${fontSize}px monospace`;
      const charIdx = Math.floor(totalIntensity * (charArr.length - 1));
      const ch = charArr[Math.min(charIdx, charArr.length - 1)];
      const alpha = lightMode ? totalIntensity * 0.88 : totalIntensity * 0.22;

      ctx.fillStyle = isAccent
        ? `rgba(${acR},${acG},${acB},${Math.min(lightMode ? 0.95 : 0.4, totalIntensity * 0.55)})`
        : `rgba(${br},${bg},${bb},${alpha})`;

      ctx.fillText(ch, px, py);
    }
  }

  ctx.textAlign = 'left';
}
