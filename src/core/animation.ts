/**
 * Animation multiplier and hover effect computations.
 */

import type { AnimationStyle } from '../types';
import type { HoverEffect, HoverShape } from '../types';

export function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

export function getAnimationMultiplier(
  x: number,
  y: number,
  cols: number,
  rows: number,
  time: number,
  style: AnimationStyle,
  speed: number
): number {
  if (style === 'none') return 1;

  const t = time * speed;

  switch (style) {
    case 'wave': {
      const wave = Math.sin((x / cols) * Math.PI * 4 + t * 3) * 0.5 + 0.5;
      const wave2 = Math.sin((y / rows) * Math.PI * 3 + t * 2) * 0.5 + 0.5;
      return 0.3 + 0.7 * (wave * 0.6 + wave2 * 0.4);
    }
    case 'pulse': {
      const cx = cols / 2;
      const cy = rows / 2;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const maxDist = Math.sqrt(cx ** 2 + cy ** 2);
      const ring = Math.sin(dist / maxDist * Math.PI * 6 - t * 4) * 0.5 + 0.5;
      return 0.2 + 0.8 * ring;
    }
    case 'rain': {
      const drop = Math.sin(y / rows * Math.PI * 8 - t * 5 + x * 0.3) * 0.5 + 0.5;
      const fade = Math.sin(x / cols * Math.PI * 2 + t) * 0.3 + 0.7;
      return 0.1 + 0.9 * drop * fade;
    }
    case 'breathe': {
      const breathe = Math.sin(t * 2) * 0.3 + 0.7;
      const subtle = Math.sin((x + y) * 0.1 + t) * 0.1;
      return Math.max(0.1, Math.min(1, breathe + subtle));
    }
    case 'sparkle': {
      const hash = Math.sin(x * 127.1 + y * 311.7 + Math.floor(t * 8) * 43758.5453) * 43758.5453;
      const sparkle = (hash - Math.floor(hash));
      return sparkle > 0.7 ? 1 : 0.15 + sparkle * 0.4;
    }
    case 'glitch': {
      const band = Math.floor(y / (rows * 0.05));
      const glitchHash = Math.sin(band * 43.23 + Math.floor(t * 6) * 17.89) * 43758.5453;
      const glitchVal = glitchHash - Math.floor(glitchHash);
      if (glitchVal > 0.85) {
        const flicker = Math.sin(t * 30 + band) * 0.5 + 0.5;
        return flicker < 0.3 ? 0 : flicker;
      }
      return 1;
    }
    case 'spiral': {
      const cx = cols / 2;
      const cy = rows / 2;
      const dx = x - cx;
      const dy = y - cy;
      const angle = Math.atan2(dy, dx);
      const dist = Math.sqrt(dx * dx + dy * dy);
      const maxDist = Math.sqrt(cx * cx + cy * cy);
      const spiral = Math.sin(angle * 3 + dist / maxDist * Math.PI * 8 - t * 3) * 0.5 + 0.5;
      return 0.15 + 0.85 * spiral;
    }
    case 'typewriter': {
      const totalCells = cols * rows;
      const cellIndex = y * cols + x;
      const progress = ((t * 0.5) % 1);
      const revealPoint = progress * totalCells * 1.3;
      const dist = cellIndex - revealPoint;
      if (dist > 0) return 0;
      const fade = Math.max(0, 1 + dist / (totalCells * 0.15));
      return Math.min(1, fade);
    }
    case 'scatter': {
      const scx = cols / 2;
      const scy = rows / 2;
      const sdx = x - scx;
      const sdy = y - scy;
      const sdist = Math.sqrt(sdx * sdx + sdy * sdy) / Math.sqrt(scx * scx + scy * scy);
      const phase = Math.sin(t * 1.5) * 0.5 + 0.5;
      const threshold = phase;
      if (sdist > threshold) {
        return Math.max(0, 1 - (sdist - threshold) * 3);
      }
      return 0.7 + 0.3 * Math.sin(sdist * 10 - t * 2);
    }
    case 'waveField':
      // waveField is handled as a full short-circuit in renderFrameToCanvas
      return 1;
    case 'ripple': {
      // Ripples emanate from the center outward over time.
      const cx2 = cols / 2;
      const cy2 = rows / 2;
      const dx2 = x - cx2;
      const dy2 = y - cy2;
      const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
      const maxDist2 = Math.sqrt(cx2 * cx2 + cy2 * cy2);
      const ripple = Math.sin((dist2 / maxDist2) * Math.PI * 10 - t * 5) * 0.5 + 0.5;
      const fadeEdge = 1 - Math.min(1, dist2 / (maxDist2 * 1.1));
      return 0.1 + 0.9 * ripple * (0.4 + fadeEdge * 0.6);
    }
    case 'melt': {
      // Chars droop downward as if melting — lower rows lag behind.
      const lagPhase = (y / rows) * Math.PI;
      const drip = Math.sin(lagPhase - t * 1.8 + x * 0.15) * 0.5 + 0.5;
      const gravity = Math.max(0, (y / rows - 0.1)) / 0.9;
      return 0.05 + 0.95 * (drip * (1 - gravity * 0.6));
    }
    case 'orbit': {
      // Each cell rotates around the center at a speed proportional to radius.
      const ocx = cols / 2;
      const ocy = rows / 2;
      const odx = x - ocx;
      const ody = y - ocy;
      const oAngle = Math.atan2(ody, odx);
      const oDist  = Math.sqrt(odx * odx + ody * ody) / Math.sqrt(ocx * ocx + ocy * ocy);
      const orbit  = Math.sin(oAngle * 2 + oDist * 6 - t * 2.5) * 0.5 + 0.5;
      return 0.1 + 0.9 * orbit;
    }
    case 'cellular': {
      // Conway-ish: cell "lives" based on a hash of its neighbours at a quantised time.
      const tick = Math.floor(t * 4);
      const alive = (cx: number, cy: number): number => {
        const h = Math.sin(cx * 127.1 + cy * 311.7 + tick * 43758.5453) * 43758.5453;
        return h - Math.floor(h) > 0.38 ? 1 : 0;
      };
      const self = alive(x, y);
      const neighbours =
        alive(x - 1, y) + alive(x + 1, y) +
        alive(x, y - 1) + alive(x, y + 1) +
        alive(x - 1, y - 1) + alive(x + 1, y - 1) +
        alive(x - 1, y + 1) + alive(x + 1, y + 1);
      const nextAlive = self === 1
        ? (neighbours === 2 || neighbours === 3 ? 1 : 0)
        : (neighbours === 3 ? 1 : 0);
      return nextAlive === 1 ? 1 : 0.05;
    }
    default:
      return 1;
  }
}

const _hoverResult = { scale: 1, offsetX: 0, offsetY: 0, glow: 0, colorBlend: 0, proximity: 0 };

export function computeHoverEffect(
  nx: number,
  ny: number,
  hoverX: number,
  hoverY: number,
  hoverIntensity: number,
  strength: number,
  cellW: number,
  cellH: number,
  effect: HoverEffect = 'spotlight',
  radiusFactor: number = 0.5,
  shape: HoverShape = 'circle'
): typeof _hoverResult {
  const dx = nx - hoverX;
  const dy = ny - hoverY;

  const radius = (0.08 + radiusFactor * 0.35) + strength * 0.04;

  // Compute distance based on shape
  let dist: number;
  let maxDist: number;
  if (shape === 'box') {
    // Chebyshev distance — creates a rectangular zone
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    dist = Math.max(absDx, absDy);
    maxDist = radius;
  } else {
    // Euclidean distance — circular zone (default)
    dist = Math.sqrt(dx * dx + dy * dy);
    maxDist = radius;
  }

  if (dist >= maxDist) {
    _hoverResult.scale = 1;
    _hoverResult.offsetX = 0;
    _hoverResult.offsetY = 0;
    _hoverResult.glow = 0;
    _hoverResult.colorBlend = 0;
    _hoverResult.proximity = 0;
    return _hoverResult;
  }

  const t = 1 - dist / maxDist;
  const eased = smoothstep(t) * hoverIntensity;

  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let glow = 0;
  let colorBlend = 0;

  switch (effect) {
    case 'spotlight': {
      scale = 1 + eased * strength * 1.8;
      const angle = Math.atan2(dy, dx);
      const pushForce = eased * eased * strength * 0.6;
      offsetX = Math.cos(angle) * pushForce * cellW;
      offsetY = Math.sin(angle) * pushForce * cellH;
      glow = eased * strength * 0.4;
      colorBlend = eased * eased * strength * 0.25;
      break;
    }
    case 'magnify':
      scale = 1 + eased * strength * 2.5;
      glow = eased * strength * 0.15;
      break;
    case 'repel': {
      scale = 1 + eased * strength * 0.3;
      const angle2 = Math.atan2(dy, dx);
      const push = eased * eased * strength * 1.2;
      offsetX = Math.cos(angle2) * push * cellW;
      offsetY = Math.sin(angle2) * push * cellH;
      break;
    }
    case 'glow':
      glow = eased * strength * 0.8;
      colorBlend = eased * strength * 0.4;
      break;
    case 'colorShift':
      scale = 1 + eased * strength * 0.4;
      glow = eased * strength * 0.2;
      colorBlend = eased * strength * 0.7;
      break;
    case 'attract': {
      // Inverse of repel — chars drift toward the cursor.
      const angle3 = Math.atan2(dy, dx);
      const pull = eased * eased * strength * 1.0;
      // Offset toward cursor (negative direction = toward)
      offsetX = -Math.cos(angle3) * pull * cellW;
      offsetY = -Math.sin(angle3) * pull * cellH;
      glow = eased * strength * 0.3;
      break;
    }
    case 'shatter': {
      // Chars scatter radially outward with jitter, then reform.
      const angle4 = Math.atan2(dy, dx);
      const jitter = Math.sin(dx * 43.7 + dy * 29.3) * 0.5;
      const scatter = eased * strength * 1.4 * (0.7 + jitter * 0.3);
      offsetX = Math.cos(angle4 + jitter) * scatter * cellW;
      offsetY = Math.sin(angle4 + jitter) * scatter * cellH;
      scale = Math.max(0.1, 1 - eased * strength * 0.6);
      glow = eased * strength * 0.25;
      break;
    }
    case 'trail': {
      // Leaves a fading colour ghost: increase colorBlend and glow strongly within radius.
      colorBlend = eased * strength * 0.9;
      glow = eased * strength * 0.6;
      scale = 1 + eased * strength * 0.15;
      break;
    }
    case 'glitchText': {
      // Clean text reveal — minimal displacement, just glow + color tint.
      // The heavy lifting (char replacement) is in renderer.ts.
      scale = 1;
      glow = eased * strength * 0.5;
      colorBlend = eased * strength * 0.6;
      break;
    }
  }

  _hoverResult.scale = scale;
  _hoverResult.offsetX = offsetX;
  _hoverResult.offsetY = offsetY;
  _hoverResult.glow = glow;
  _hoverResult.colorBlend = colorBlend;
  _hoverResult.proximity = eased;
  return _hoverResult;
}
