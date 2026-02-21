/**
 * renderDnaBackground — animated double-helix DNA strands scrolling vertically
 * with base-pair characters between them.
 */
import { parseColor, hash2 } from './_shared';

export interface DnaBackgroundOptions {
  /** Font size in CSS pixels (default: 13) */
  fontSize?: number;
  /** Characters for strand nodes (default: 'ATCG') */
  baseChars?: string;
  /** Characters for the connectors between strands (default: '-=≡') */
  bridgeChars?: string;
  /** Primary strand colour (default: '#00e5ff') */
  color?: string;
  /** Secondary strand colour (default: '#ff4081') */
  color2?: string;
  /** Bridge / connector colour (default: '#88ffcc') */
  bridgeColor?: string;
  /** Speed multiplier (default: 1) */
  speed?: number;
  /** Number of helix columns (default: auto, ~1 per 80px) */
  helixCount?: number;
  /** Light mode (default: false) */
  lightMode?: boolean;
}

export function renderDnaBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  options: DnaBackgroundOptions = {},
): void {
  const {
    fontSize    = 13,
    baseChars   = 'ATCG',
    bridgeChars = '-=≡',
    color       = '#00e5ff',
    color2      = '#ff4081',
    bridgeColor = '#88ffcc',
    speed       = 1,
    helixCount,
    lightMode   = false,
  } = options;

  const charW  = fontSize * 0.62;
  const lineH  = fontSize * 1.4;
  const cols   = Math.ceil(width  / charW);
  const rows   = Math.ceil(height / lineH);

  const numHelix = helixCount ?? Math.max(1, Math.floor(width / 80));
  const sectionW = cols / numHelix;

  const cp  = parseColor(color)       ?? { r: 0,   g: 229, b: 255 };
  const cp2 = parseColor(color2)      ?? { r: 255, g: 64,  b: 129 };
  const bp  = parseColor(bridgeColor) ?? { r: 136, g: 255, b: 204 };

  const defaultColor = lightMode ? 'rgb(55,55,55)' : 'rgb(255,255,255)';
  void defaultColor; // used below

  ctx.clearRect(0, 0, width, height);
  ctx.font = `${fontSize}px "JetBrains Mono", monospace`;
  ctx.textBaseline = 'top';

  const t = time * speed;
  const amplitude = (sectionW * 0.35);

  for (let h = 0; h < numHelix; h++) {
    const centerCol = sectionW * (h + 0.5);

    for (let r = 0; r < rows; r++) {
      const phase = (r / rows) * Math.PI * 6 - t * 1.8;
      const strand1ColF = centerCol + Math.sin(phase)              * amplitude;
      const strand2ColF = centerCol + Math.sin(phase + Math.PI)    * amplitude;
      const strand1Col  = Math.round(strand1ColF);
      const strand2Col  = Math.round(strand2ColF);

      if (strand1Col < 0 || strand1Col >= cols) continue;
      const baseSeed1 = hash2(h * 31 + r * 7, 3);
      const ch1 = baseChars[Math.floor(baseSeed1 * baseChars.length)];

      // Depth cue: alpha based on sine value (-1..1)
      const depth1 = (Math.sin(phase) + 1) * 0.5;
      const depth2 = (Math.sin(phase + Math.PI) + 1) * 0.5;

      ctx.globalAlpha = 0.35 + depth1 * 0.65;
      ctx.fillStyle = `rgb(${cp.r},${cp.g},${cp.b})`;
      ctx.fillText(ch1, strand1Col * charW, r * lineH);

      if (strand2Col >= 0 && strand2Col < cols) {
        const baseSeed2 = hash2(h * 53 + r * 11, 7);
        const ch2 = baseChars[Math.floor(baseSeed2 * baseChars.length)];
        ctx.globalAlpha = 0.35 + depth2 * 0.65;
        ctx.fillStyle = `rgb(${cp2.r},${cp2.g},${cp2.b})`;
        ctx.fillText(ch2, strand2Col * charW, r * lineH);
      }

      // Draw bridge every ~3 rows when strands are roughly horizontal.
      const bridgeInterval = 3;
      if (r % bridgeInterval === 0) {
        const minC = Math.min(strand1Col, strand2Col);
        const maxC = Math.max(strand1Col, strand2Col);
        const bridgeLen = maxC - minC;
        if (bridgeLen > 1) {
          const bSeed = hash2(r * 17 + h * 43, 5);
          const bCh   = bridgeChars[Math.floor(bSeed * bridgeChars.length)];
          const midBridgeAlpha = (depth1 + depth2) * 0.25 + 0.2;
          ctx.globalAlpha = midBridgeAlpha;
          ctx.fillStyle = `rgb(${bp.r},${bp.g},${bp.b})`;
          for (let bc = minC + 1; bc < maxC; bc++) {
            ctx.fillText(bCh, bc * charW, r * lineH);
          }
        }
      }
    }
  }

  ctx.globalAlpha = 1;
}
