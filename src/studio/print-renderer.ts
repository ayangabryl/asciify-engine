import { normalizeStudioPrint, type StudioPrintStyle } from './print-model';

const TAU = Math.PI * 2;
const clamp = (x: number) => Math.max(0, Math.min(1, x));
// The carved edge is stationary texture, not motion. A bounded lookup avoids
// millions of trigonometric evaluations while hovering dense woodblock grids.
const sine = Float32Array.from({length:2048},(_,i)=>Math.sin(i / 2048 * TAU));
const textureWave = (phase: number) => sine[Math.floor(phase * (2048 / TAU)) & 2047];
// Spatial hash, never frame-time randomness. No arrays/objects allocated per mark.
function noise(x: number, y: number, seed: number) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Compile settings once per configuration, not once per frame or cell. */
export function createPrintPainter(input: unknown) {
  const settings = normalizeStudioPrint(input);
  const {density, weight, angle, roughness, invert, secondaryInk, registration, seed} = settings;
  const radians = angle * Math.PI / 180;
  const angles = [radians, radians + Math.PI / 2, radians + Math.PI / 4];
  const directions = angles.map(a => [Math.cos(a), Math.sin(a)] as const);
  const cuts = new Float32Array(6);

  /** Clip a world-anchored screen to a unit cell; adjacent cuts share endpoints.
   * At most three lines per direction. No Canvas save/rotate/clip per cell.
   */
  function screen(ctx: CanvasRenderingContext2D, x: number, y: number, px: number, py: number, cell: number, coverage: number, direction: number, carved = false) {
    if (coverage <= 0) return;
    const [dx, dy] = directions[direction], nx = -dy, ny = dx;
    const projection = nx * (x + .5) + ny * (y + .5);
    const reach = (Math.abs(nx) + Math.abs(ny)) * .5;
    const period = carved ? 1 : .5;
    const low = Math.ceil((projection - reach) / period), high = Math.floor((projection + reach) / period);
    const width = Math.min(period * .94, period * .72 * coverage * weight);
    ctx.lineWidth = cell * width;
    ctx.beginPath();
    for (let line = low; line <= high; line++) {
      const offset = line * period - projection;
      const cx = .5 + nx * offset, cy = .5 + ny * offset;
      let start = -2, end = 2;
      if (Math.abs(dx) > 1e-8) { const a = -cx / dx, b = (1 - cx) / dx; start = Math.max(start, Math.min(a, b)); end = Math.min(end, Math.max(a, b)); }
      else if (cx < 0 || cx > 1) continue;
      if (Math.abs(dy) > 1e-8) { const a = -cy / dy, b = (1 - cy) / dy; start = Math.max(start, Math.min(a, b)); end = Math.min(end, Math.max(a, b)); }
      else if (cy < 0 || cy > 1) continue;
      if (end <= start) continue;
      if (!carved) {
        // Roughness changes width, not screen placement, preserving line continuity.
        ctx.moveTo(px + (cx + dx * start) * cell, py + (cy + dy * start) * cell);
        ctx.lineTo(px + (cx + dx * end) * cell, py + (cy + dy * end) * cell);
      } else {
        // Six vertices per side, carved edge correlated in world coordinates.
        for(let step=0;step<6;step++){
          const t=start+(end-start)*step/5;
          const world=dx*(x+cx+dx*t)+dy*(y+cy+dy*t);
          cuts[step]=textureWave(world*5.3+line*1.9+seed)*.5+textureWave(world*13.1+line)*.25;
        }
        for (let side = 0; side < 2; side++) for (let step = 0; step < 6; step++) {
          const t = start + (end - start) * (side ? 5 - step : step) / 5;
          const cut = cuts[side ? 5-step : step];
          const edge = width * .5 * (1 + roughness * cut * .5) * (side ? -1 : 1);
          // Clamping keeps broad carved strokes inside their sampled cell.
          const vx = px + clamp(cx + dx * t + nx * edge) * cell;
          const vy = py + clamp(cy + dy * t + ny * edge) * cell;
          if (!side && !step) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
        }
        ctx.closePath();
      }
    }
    if (carved) ctx.fill(); else ctx.stroke();
  }

  return {
    settings,
    paint(ctx: CanvasRenderingContext2D, style: StudioPrintStyle, x: number, y: number, px: number, py: number, cell: number,
      luminance: number, ink: string, r: number, g: number, b: number, colorMode: 'accent' | 'source' | 'gray') {
      const tone = clamp((invert ? 1 - luminance : luminance) * density);
      if (tone <= 0 || ctx.globalAlpha <= 0) return;
      ctx.fillStyle = ink; ctx.strokeStyle = ink;
      const variation = noise(x, y, seed);
      if (style === 'engraving' || style === 'crosshatch' || style === 'woodblock') {
        const coverage = tone * (1 - roughness * variation * .3);
        if (style === 'woodblock') screen(ctx, x, y, px, py, cell, Math.ceil(coverage * 5) / 5, 0, true);
        else {
          // More crossings only appear in stronger tones; no opacity-only alias.
          screen(ctx, x, y, px, py, cell, coverage, 0);
          if (style === 'crosshatch') {
            screen(ctx, x, y, px, py, cell, Math.max(0, coverage * 1.5 - .3), 1);
            screen(ctx, x, y, px, py, cell, Math.max(0, coverage * 2 - 1.2), 2);
          }
        }
      } else if (style === 'risograph') {
        const separation = colorMode === 'source' ? clamp(.5 + (r - b) / 510) : .5;
        const offset = registration * .38 * cell;
        const radius = cell * Math.min(.48, .44 * Math.sqrt(tone) * weight);
        ctx.beginPath(); ctx.arc(px + cell * .5, py + cell * .5, radius * Math.sqrt(.35 + (1 - separation) * .65), 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = secondaryInk;
        const speckle = 1 - roughness * noise(x, y, seed + 13) * .3;
        ctx.beginPath(); ctx.arc(px + cell * .5 + offset * directions[0][0], py + cell * .5 + offset * directions[0][1], radius * Math.sqrt(.3 + separation * .7) * speckle, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      } else {
        if (style === 'stipple') ctx.beginPath();
        for (let mark = 0; mark < 4; mark++) {
          const jitter = noise(x * 2 + mark % 2, y * 2 + (mark >> 1), seed);
          const jitterY = noise(x, y, seed + mark * 11 + 1);
          const cx = px + ((mark % 2 + .5) / 2 + (jitter - .5) * roughness * .28) * cell;
          const cy = py + (((mark >> 1) + .5) / 2 + (jitterY - .5) * roughness * .28) * cell;
          const radius = Math.min(cx - px, px + cell - cx, cy - py, py + cell - cy,
            cell * Math.min(.245, .21 * weight * Math.sqrt(tone) * (1 - roughness * jitter * .35)));
          if (style === 'stipple') { ctx.moveTo(cx + radius, cy); ctx.arc(cx, cy, radius, 0, TAU); }
          else {
            // Pigments differ in hue for source color, only brightness for gray/accent.
            const shift = (jitter - .5) * roughness * 64;
            if (colorMode === 'source') ctx.fillStyle = `rgb(${Math.round(r + shift)},${Math.round(g - shift * .4)},${Math.round(b - shift)})`;
            else if (colorMode === 'gray') ctx.fillStyle = `rgb(${Math.round(r + shift)},${Math.round(r + shift)},${Math.round(r + shift)})`;
            else ctx.fillStyle = ink;
            ctx.beginPath(); ctx.ellipse(cx, cy, radius, radius * .64, jitter * Math.PI, 0, TAU); ctx.fill();
          }
        }
        if (style === 'stipple') ctx.fill();
      }
    },
  };
}
