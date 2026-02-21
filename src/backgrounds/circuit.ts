/**
 * renderCircuitBackground — procedural PCB trace growth with signal pulses
 * traveling along horizontal and vertical edges.
 */
import { parseColor, hash2 } from './_shared';

export interface CircuitBackgroundOptions {
  /** Font size in CSS pixels (default: 13) */
  fontSize?: number;
  /** Trace characters (default: '─│┌┐└┘├┤┬┴┼') */
  chars?: string;
  /** Trace colour (default: '#00ff88') */
  color?: string;
  /** Signal pulse colour (default: '#ffffff') */
  pulseColor?: string;
  /** Fraction of cells that have a trace (default: 0.38) */
  density?: number;
  /** Signal pulse speed (default: 1) */
  speed?: number;
  /** Light mode (default: false) */
  lightMode?: boolean;
}

// Direction flags (bit-field per cell)
const EAST  = 1;
const WEST  = 2;
const NORTH = 4;
const SOUTH = 8;

const DIR_CHARS: Record<number, string> = {
  [EAST | WEST]:              '─',
  [NORTH | SOUTH]:            '│',
  [EAST | SOUTH]:             '┌',
  [WEST | SOUTH]:             '┐',
  [EAST | NORTH]:             '└',
  [WEST | NORTH]:             '┘',
  [EAST | WEST | SOUTH]:      '┬',
  [EAST | WEST | NORTH]:      '┴',
  [NORTH | SOUTH | EAST]:     '├',
  [NORTH | SOUTH | WEST]:     '┤',
  [EAST | WEST | NORTH | SOUTH]: '┼',
  [EAST]:  '╶',
  [WEST]:  '╴',
  [NORTH]: '╵',
  [SOUTH]: '╷',
};

export function renderCircuitBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  options: CircuitBackgroundOptions = {},
): void {
  const {
    fontSize   = 13,
    pulseColor = '#ffffff',
    color      = '#00ff88',
    density    = 0.38,
    speed      = 1,
    lightMode  = false,
  } = options;

  const charW = fontSize * 0.62;
  const lineH = fontSize * 1.4;
  const cols  = Math.ceil(width  / charW);
  const rows  = Math.ceil(height / lineH);

  const cp = parseColor(color)      ?? { r: 0,   g: 255, b: 136 };
  const pp = parseColor(pulseColor) ?? { r: 255, g: 255, b: 255 };
  void lightMode;

  // Build a stable grid from hash functions (no per-frame allocation).
  // Each cell stores a bitmask of connections.
  const getConnections = (c: number, r: number): number => {
    if (hash2(c * 17 + 1, r * 7 + 2) > density) return 0;
    let mask = 0;
    if (c + 1 < cols && hash2(c * 17 + 1, r * 7 + 2) > 0.15) mask |= EAST;
    if (c - 1 >= 0   && hash2((c-1)*17+1, r*7+2) > 0.15)      mask |= WEST;
    if (r + 1 < rows && hash2(c * 17 + 1, (r+1)*7+2) > 0.15)  mask |= SOUTH;
    if (r - 1 >= 0   && hash2(c*17+1,(r-1)*7+2) > 0.15)       mask |= NORTH;
    return mask;
  };

  ctx.clearRect(0, 0, width, height);
  ctx.font = `${fontSize}px "JetBrains Mono", monospace`;
  ctx.textBaseline = 'top';

  const t = time * speed;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const mask = getConnections(c, r);
      if (mask === 0) continue;

      const ch = DIR_CHARS[mask] ?? '·';

      // Pulse wave along horizontal traces.
      const pulsePosH = ((t * 8 + hash2(c, r * 23) * 40) % cols);
      const pulsePosV = ((t * 6 + hash2(r * 17, c * 11) * 40) % rows);
      const nearH = (mask & EAST || mask & WEST) && Math.abs(c - pulsePosH) < 1.5;
      const nearV = (mask & NORTH || mask & SOUTH) && Math.abs(r - pulsePosV) < 1.5;
      const isPulse = nearH || nearV;

      const baseAlpha = 0.25 + hash2(c * 3, r * 5) * 0.35;

      if (isPulse) {
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = `rgb(${pp.r},${pp.g},${pp.b})`;
      } else {
        ctx.globalAlpha = baseAlpha;
        ctx.fillStyle = `rgb(${cp.r},${cp.g},${cp.b})`;
      }

      ctx.fillText(ch, c * charW, r * lineH);
    }
  }

  ctx.globalAlpha = 1;
}
