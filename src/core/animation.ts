import { resolveMotion, sampleAmbient } from '../surface/ambient-motion';
/**
 * Animation multiplier and hover effect computations.
 */

import type { AnimationStyle } from '../types';
import type { HoverEffect, HoverShape } from '../types';
import type { TrailPoint } from './hover';

export function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

// Reuse the surface motion field; old global pulses and flicker effects are retired.
export function getAnimationMultiplier(x: number, y: number, cols: number, rows: number,
  time: number, style: AnimationStyle, speed: number): number {
  const a = sampleAmbient(resolveMotion(style), x / cols, y / rows, time * speed, motionSample);
  return Math.max(0, Math.min(1, (1 + a[2]) * a[3]));
}
const motionSample = [0, 0, 0, 1];

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
  shape: HoverShape = 'circle',
  trail: readonly TrailPoint[] = [],
  aspect = 1,
): typeof _hoverResult {
  const dx = (nx - hoverX) * Math.max(1, aspect);
  const dy = (ny - hoverY) * Math.max(1, 1 / aspect);

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

  if (dist >= maxDist && (effect !== 'trail' || trail.length === 0)) {
    _hoverResult.scale = 1;
    _hoverResult.offsetX = 0;
    _hoverResult.offsetY = 0;
    _hoverResult.glow = 0;
    _hoverResult.colorBlend = 0;
    _hoverResult.proximity = 0;
    return _hoverResult;
  }

  const t = Math.max(0, 1 - dist / maxDist);
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
      scale = 1 + eased * strength * 0.85;
      glow = eased * strength * 0.15;
      break;
    case 'repel': {
      scale = 1;
      const angle2 = Math.atan2(dy, dx);
      const push = eased * eased * strength * 1.8;
      offsetX = Math.cos(angle2) * push * cellW;
      offsetY = Math.sin(angle2) * push * cellH;
      break;
    }
    case 'glow':
      glow = eased * strength * 0.8;
      colorBlend = eased * strength * 0.4;
      break;
    case 'colorShift':
      // Ink changes the tone without inflating or displacing the glyph.
      scale = 1;
      glow = eased * strength * 0.12;
      colorBlend = eased * strength;
      break;
    case 'attract': {
      // Inverse of repel — chars drift toward the cursor.
      const angle3 = Math.atan2(dy, dx);
      const pull = eased * eased * strength * 1.0;
      // Offset toward cursor (negative direction = toward)
      offsetX = (-Math.cos(angle3) * .45 - Math.sin(angle3) * 1.6) * pull * cellW;
      offsetY = (-Math.sin(angle3) * .45 + Math.cos(angle3) * 1.6) * pull * cellH;
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
      // A bounded cursor wake: velocity carries the field while a small curl
      // bends it. Older samples fade independently, rather than following the
      // current pointer as a rigid circle.
      let field = eased;
      let flowX = -dy * eased, flowY = dx * eased;
      for (const point of trail) {
        const tx = (nx - point.x) * Math.max(1, aspect);
        const ty = (ny - point.y) * Math.max(1, 1 / aspect);
        const distance = Math.hypot(tx, ty) / radius;
        if (distance >= 1) continue;
        const weight = smoothstep(1 - distance) * point.intensity;
        field = Math.max(field, weight);
        flowX += (point.vx * 0.35 - ty * 2) * weight * 0.35;
        flowY += (point.vy * 0.35 + tx * 2) * weight * 0.35;
      }
      offsetX = Math.tanh(flowX * 2) * strength * cellW * 3;
      offsetY = Math.tanh(flowY * 2) * strength * cellH * 3;
      colorBlend = field * strength * 0.65;
      glow = field * strength * 0.35;
      scale = 1 + field * strength * 0.08;
      _hoverResult.proximity = field;
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
  if (effect !== 'trail') _hoverResult.proximity = eased;
  return _hoverResult;
}
