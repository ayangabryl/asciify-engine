/**
 * ASCII Background — public entry point for the backgrounds sub-system.
 *
 * Exports:
 *  - All 10 render functions
 *  - All 10 option interfaces
 *  - `AsciiBackgroundOptions` — combined union type + mount options
 *  - `asciiBackground()` — the drop-in mount helper
 *  - `mountWaveBackground` / `MountWaveOptions` — deprecated aliases
 */

export type { WaveBackgroundOptions }  from './wave';
export { renderWaveBackground }        from './wave';

export type { RainBackgroundOptions }  from './rain';
export { renderRainBackground }        from './rain';

export type { StarsBackgroundOptions } from './stars';
export { renderStarsBackground }       from './stars';

export type { PulseBackgroundOptions } from './pulse';
export { renderPulseBackground }       from './pulse';

export type { NoiseBackgroundOptions } from './noise';
export { renderNoiseBackground }       from './noise';

export type { GridBackgroundOptions }  from './grid';
export { renderGridBackground }        from './grid';

export type { AuroraBackgroundOptions } from './aurora';
export { renderAuroraBackground }       from './aurora';

export type { SilkBackgroundOptions }  from './silk';
export { renderSilkBackground }        from './silk';

export type { VoidBackgroundOptions }  from './void';
export { renderVoidBackground }        from './void';

export type { MorphBackgroundOptions } from './morph';
export { renderMorphBackground }       from './morph';

export type { FireBackgroundOptions }    from './fire';
export { renderFireBackground }          from './fire';

export type { DnaBackgroundOptions }     from './dna';
export { renderDnaBackground }           from './dna';

export type { TerrainBackgroundOptions } from './terrain';
export { renderTerrainBackground }       from './terrain';

export type { CircuitBackgroundOptions } from './circuit';
export { renderCircuitBackground }       from './circuit';

import { renderWaveBackground  } from './wave';
import type { WaveBackgroundOptions  } from './wave';
import { renderRainBackground  } from './rain';
import type { RainBackgroundOptions  } from './rain';
import { renderStarsBackground } from './stars';
import type { StarsBackgroundOptions } from './stars';
import { renderPulseBackground } from './pulse';
import type { PulseBackgroundOptions } from './pulse';
import { renderNoiseBackground } from './noise';
import type { NoiseBackgroundOptions } from './noise';
import { renderGridBackground  } from './grid';
import type { GridBackgroundOptions  } from './grid';
import { renderAuroraBackground } from './aurora';
import type { AuroraBackgroundOptions } from './aurora';
import { renderSilkBackground  } from './silk';
import type { SilkBackgroundOptions  } from './silk';
import { renderVoidBackground  } from './void';
import type { VoidBackgroundOptions  } from './void';
import { renderMorphBackground } from './morph';
import type { MorphBackgroundOptions } from './morph';
import { renderFireBackground } from './fire';
import type { FireBackgroundOptions } from './fire';
import { renderDnaBackground } from './dna';
import type { DnaBackgroundOptions } from './dna';
import { renderTerrainBackground } from './terrain';
import type { TerrainBackgroundOptions } from './terrain';
import { renderCircuitBackground } from './circuit';
import type { CircuitBackgroundOptions } from './circuit';

// Inline _parseColor for the inject helper (avoids circular dep through _shared re-export)
function _parseColor(c: string): { r: number; g: number; b: number } | null {
  const hex = c.match(/^#([0-9a-f]{3,8})$/i)?.[1];
  if (hex) {
    const h = hex.length <= 4
      ? hex.split('').map(x => parseInt(x + x, 16))
      : [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)];
    return { r: h[0], g: h[1], b: h[2] };
  }
  const rgb = c.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3] };
  return null;
}

/**
 * Combined options for `asciiBackground()`. Extends all 10 background option
 * interfaces so every background's options can be passed through one object.
 */
export interface AsciiBackgroundOptions extends
  WaveBackgroundOptions,
  RainBackgroundOptions,
  StarsBackgroundOptions,
  PulseBackgroundOptions,
  NoiseBackgroundOptions,
  GridBackgroundOptions,
  AuroraBackgroundOptions,
  SilkBackgroundOptions,
  VoidBackgroundOptions,
  MorphBackgroundOptions,
  FireBackgroundOptions,
  DnaBackgroundOptions,
  TerrainBackgroundOptions,
  CircuitBackgroundOptions
{
  /**
   * Which background to render (default: 'wave').
   * - 'wave'   — interactive ASCII field with vortex, sparkles, breathe
   * - 'rain'   — digital column rain (Matrix-style falling characters)
   * - 'stars'  — 3D star-warp / hyperspace chars fly toward the viewer
   * - 'pulse'  — concentric ASCII ripples radiating from the mouse
   * - 'noise'  — slow-drifting organic fractal noise field
   * - 'grid'   — CRT-style horizontal scan bands with cursor glitch zone
   * - 'aurora' — premium slow-drifting light bands
   * - 'silk'   — smooth directional flow-field ribbons
   * - 'void'   — gravitational singularity follows the cursor
   * - 'morph'  — per-cell multi-frequency shimmer
   * - 'fire'    — upward cellular-automata flame simulation
   * - 'dna'     — double-helix strand scrolling with base-pair chars
   * - 'terrain' — scrolling ASCII side-scroll heightmap landscape
   * - 'circuit' — procedural PCB traces with traveling signal pulses
   */
  type?: 'wave' | 'rain' | 'stars' | 'pulse' | 'noise' | 'grid' | 'aurora' | 'silk' | 'void' | 'morph' | 'fire' | 'dna' | 'terrain' | 'circuit';
  /** CSS opacity applied to the canvas element (default: 0.2) */
  opacity?: number;
  /** Extra CSS class names added to the injected canvas */
  className?: string;
  /** z-index of the canvas (default: 0) */
  zIndex?: number;
  /**
   * Colour scheme handling (default: 'auto').
   * - 'auto'  — follows system prefers-color-scheme and updates live
   * - 'dark'  — always render bright chars on dark background
   * - 'light' — always render dark chars on light background
   */
  colorScheme?: 'auto' | 'light' | 'dark';
  /**
   * Custom character colour. Accepts any CSS colour string: hex, rgb(), hsl().
   * Overrides the default white/black for ASCII chars.
   * @example '#6b8700'
   */
  color?: string;
}

/**
 * All supported background type identifiers — single source of truth for
 * counts, type-safe option values, and documentation.
 */
export const BACKGROUND_TYPES = [
  'wave', 'rain', 'stars', 'pulse', 'noise', 'grid',
  'aurora', 'silk', 'void', 'morph',
  'fire', 'dna', 'terrain', 'circuit',
] as const;

export type BackgroundType = typeof BACKGROUND_TYPES[number];

/**
 * Drop-in helper that mounts an interactive ASCII background onto any element.
 * Injects a canvas, wires DPR resize, mouse tracking, and the RAF loop.
 * Auto-detects light/dark mode and stays in sync if the system theme changes.
 *
 * Returns a `destroy()` function to clean everything up.
 *
 * @example
 * ```ts
 * // 1 line:
 * const { destroy } = asciiBackground('#hero', { opacity: 0.2 });
 *
 * // React — return destroy as cleanup:
 * useEffect(() => asciiBackground(ref.current).destroy, []);
 * ```
 */
export function asciiBackground(
  target: string | HTMLElement | null,
  options: AsciiBackgroundOptions = {},
): { destroy: () => void } {
  const {
    type        = 'wave',
    opacity     = 0.2,
    className,
    zIndex      = 0,
    colorScheme = 'auto',
    color,
    ...renderOpts
  } = options;

  const container = typeof target === 'string'
    ? (document.querySelector(target) as HTMLElement | null)
    : target;

  if (!container) {
    console.warn('[asciify] asciiBackground: target not found', target);
    return { destroy: () => {} };
  }

  const prevPosition = container.style.position;
  if (getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }

  const canvas = document.createElement('canvas');
  canvas.style.cssText = [
    'position:absolute', 'inset:0', 'width:100%', 'height:100%',
    `opacity:${opacity}`, 'pointer-events:none', `z-index:${zIndex}`,
  ].join(';');
  if (className) canvas.className = className;
  container.prepend(canvas);

  const ctx = canvas.getContext('2d')!;
  const dpr = window.devicePixelRatio || 1;
  const mouse       = { x: 0.5, y: 0.5 };
  const smoothMouse = { x: 0.5, y: 0.5 };

  // ── Color scheme ──
  // Probe the container's actual computed background colour, then fall
  // back to data-theme / .dark class / OS preference.
  const _detectLight = (): boolean => {
    // 1. Probe ancestor backgrounds of the container
    let current: Element | null = container;
    while (current && current !== document.documentElement.parentElement) {
      const bg = getComputedStyle(current).backgroundColor;
      if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
        const m = bg.match(/rgba?\(\s*(\d+)\s*[,\s]\s*(\d+)\s*[,\s]\s*(\d+)/);
        if (m) {
          const lum = (0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]) / 255;
          return lum >= 0.4; // light background
        }
      }
      current = current.parentElement;
    }
    // 2. Document-level theme attributes
    const html = document.documentElement;
    const dt = (html.getAttribute('data-theme') || '').toLowerCase();
    if (dt === 'dark') return false;
    if (dt === 'light') return true;
    if (html.classList.contains('dark')) return false;
    // 3. OS preference
    return window.matchMedia('(prefers-color-scheme: light)').matches;
  };
  const isLight = (): boolean => {
    if (colorScheme === 'light') return true;
    if (colorScheme === 'dark')  return false;
    return _detectLight();
  };

  const parsedColor = color ? _parseColor(color) : null;

  type AnyRenderOpts =
    | WaveBackgroundOptions | RainBackgroundOptions | StarsBackgroundOptions
    | PulseBackgroundOptions | NoiseBackgroundOptions | GridBackgroundOptions
    | AuroraBackgroundOptions | SilkBackgroundOptions | VoidBackgroundOptions
    | MorphBackgroundOptions | FireBackgroundOptions | DnaBackgroundOptions
    | TerrainBackgroundOptions | CircuitBackgroundOptions;

  const buildWaveOpts = (): WaveBackgroundOptions => ({
    ...renderOpts,
    lightMode: renderOpts.lightMode !== undefined ? renderOpts.lightMode : isLight(),
    baseColor: parsedColor
      ? `rgba(${parsedColor.r},${parsedColor.g},${parsedColor.b},{a})`
      : (renderOpts as WaveBackgroundOptions).baseColor,
  });
  const buildRainOpts  = (): RainBackgroundOptions => ({
    ...renderOpts,
    lightMode: renderOpts.lightMode !== undefined ? renderOpts.lightMode : isLight(),
    color: color ?? (renderOpts as RainBackgroundOptions).color,
  });
  const buildStarsOpts = (): StarsBackgroundOptions => ({
    ...renderOpts,
    lightMode: renderOpts.lightMode !== undefined ? renderOpts.lightMode : isLight(),
    color: color ?? (renderOpts as StarsBackgroundOptions).color,
  });
  const buildPulseOpts = (): PulseBackgroundOptions => ({
    ...renderOpts,
    lightMode: renderOpts.lightMode !== undefined ? renderOpts.lightMode : isLight(),
    color: color ?? (renderOpts as PulseBackgroundOptions).color,
  });
  const buildNoiseOpts = (): NoiseBackgroundOptions => ({
    ...renderOpts,
    lightMode: renderOpts.lightMode !== undefined ? renderOpts.lightMode : isLight(),
    color: color ?? (renderOpts as NoiseBackgroundOptions).color,
  });
  const buildGridOpts = (): GridBackgroundOptions => ({
    ...renderOpts,
    lightMode: renderOpts.lightMode !== undefined ? renderOpts.lightMode : isLight(),
    color: color ?? (renderOpts as GridBackgroundOptions).color,
  });
  const buildAuroraOpts = (): AuroraBackgroundOptions => ({
    ...renderOpts,
    lightMode: renderOpts.lightMode !== undefined ? renderOpts.lightMode : isLight(),
    color: color ?? (renderOpts as AuroraBackgroundOptions).color,
  });
  const buildSilkOpts = (): SilkBackgroundOptions => ({
    ...renderOpts,
    lightMode: renderOpts.lightMode !== undefined ? renderOpts.lightMode : isLight(),
    color: color ?? (renderOpts as SilkBackgroundOptions).color,
  });
  const buildVoidOpts = (): VoidBackgroundOptions => ({
    ...renderOpts,
    lightMode: renderOpts.lightMode !== undefined ? renderOpts.lightMode : isLight(),
    color: color ?? (renderOpts as VoidBackgroundOptions).color,
  });
  const buildMorphOpts = (): MorphBackgroundOptions => ({
    ...renderOpts,
    lightMode: renderOpts.lightMode !== undefined ? renderOpts.lightMode : isLight(),
    color: color ?? (renderOpts as MorphBackgroundOptions).color,
  });
  const buildFireOpts = (): FireBackgroundOptions => ({
    ...renderOpts,
    color: color ?? (renderOpts as FireBackgroundOptions).color,
  });
  const buildDnaOpts = (): DnaBackgroundOptions => ({
    ...renderOpts,
    color: color ?? (renderOpts as DnaBackgroundOptions).color,
  });
  const buildTerrainOpts = (): TerrainBackgroundOptions => ({
    ...renderOpts,
    color: color ?? (renderOpts as TerrainBackgroundOptions).color,
    lightMode: renderOpts.lightMode !== undefined ? renderOpts.lightMode : isLight(),
  });
  const buildCircuitOpts = (): CircuitBackgroundOptions => ({
    ...renderOpts,
    color: color ?? (renderOpts as CircuitBackgroundOptions).color,
    lightMode: renderOpts.lightMode !== undefined ? renderOpts.lightMode : isLight(),
  });

  const optsRef = { current: buildWaveOpts() as AnyRenderOpts };
  const rebuildOpts = () => {
    if      (type === 'rain')    optsRef.current = buildRainOpts();
    else if (type === 'stars')   optsRef.current = buildStarsOpts();
    else if (type === 'pulse')   optsRef.current = buildPulseOpts();
    else if (type === 'noise')   optsRef.current = buildNoiseOpts();
    else if (type === 'grid')    optsRef.current = buildGridOpts();
    else if (type === 'aurora')  optsRef.current = buildAuroraOpts();
    else if (type === 'silk')    optsRef.current = buildSilkOpts();
    else if (type === 'void')    optsRef.current = buildVoidOpts();
    else if (type === 'morph')   optsRef.current = buildMorphOpts();
    else if (type === 'fire')    optsRef.current = buildFireOpts();
    else if (type === 'dna')     optsRef.current = buildDnaOpts();
    else if (type === 'terrain') optsRef.current = buildTerrainOpts();
    else if (type === 'circuit') optsRef.current = buildCircuitOpts();
    else                         optsRef.current = buildWaveOpts();
  };
  rebuildOpts();

  // Listen for colour-scheme changes — OS media query + data-theme mutations
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  const onSchemeChange = () => { rebuildOpts(); };
  let themeObserver: MutationObserver | null = null;
  if (colorScheme === 'auto') {
    mq.addEventListener('change', onSchemeChange);
    // Also watch for data-theme / class changes on <html>
    themeObserver = new MutationObserver(onSchemeChange);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    });
  }

  const resize = () => {
    const r = container.getBoundingClientRect();
    canvas.width  = r.width  * dpr;
    canvas.height = r.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();

  const onMouseMove = (e: MouseEvent) => {
    const r = container.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) / r.width;
    mouse.y = (e.clientY - r.top)  / r.height;
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  window.addEventListener('mousemove', onMouseMove);

  let time = 0;
  let raf  = 0;
  const tick = () => {
    smoothMouse.x += (mouse.x - smoothMouse.x) * 0.07;
    smoothMouse.y += (mouse.y - smoothMouse.y) * 0.07;
    const r = container.getBoundingClientRect();

    if (type === 'rain') {
      renderRainBackground(ctx, r.width, r.height, time, optsRef.current as RainBackgroundOptions);
    } else if (type === 'stars') {
      renderStarsBackground(ctx, r.width, r.height, time, smoothMouse, optsRef.current as StarsBackgroundOptions);
    } else if (type === 'pulse') {
      renderPulseBackground(ctx, r.width, r.height, time, smoothMouse, optsRef.current as PulseBackgroundOptions);
    } else if (type === 'noise') {
      renderNoiseBackground(ctx, r.width, r.height, time, smoothMouse, optsRef.current as NoiseBackgroundOptions);
    } else if (type === 'grid') {
      renderGridBackground(ctx, r.width, r.height, time, smoothMouse, optsRef.current as GridBackgroundOptions);
    } else if (type === 'aurora') {
      renderAuroraBackground(ctx, r.width, r.height, time, smoothMouse, optsRef.current as AuroraBackgroundOptions);
    } else if (type === 'silk') {
      renderSilkBackground(ctx, r.width, r.height, time, optsRef.current as SilkBackgroundOptions);
    } else if (type === 'void') {
      renderVoidBackground(ctx, r.width, r.height, time, smoothMouse, optsRef.current as VoidBackgroundOptions);
    } else if (type === 'morph') {
      renderMorphBackground(ctx, r.width, r.height, time, optsRef.current as MorphBackgroundOptions);
    } else if (type === 'fire') {
      renderFireBackground(ctx, r.width, r.height, time, optsRef.current as FireBackgroundOptions);
    } else if (type === 'dna') {
      renderDnaBackground(ctx, r.width, r.height, time, optsRef.current as DnaBackgroundOptions);
    } else if (type === 'terrain') {
      renderTerrainBackground(ctx, r.width, r.height, time, optsRef.current as TerrainBackgroundOptions);
    } else if (type === 'circuit') {
      renderCircuitBackground(ctx, r.width, r.height, time, optsRef.current as CircuitBackgroundOptions);
    } else {
      renderWaveBackground(ctx, r.width, r.height, time, smoothMouse, optsRef.current as WaveBackgroundOptions);
    }

    time += 0.016;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return {
    destroy: () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (colorScheme === 'auto') {
        mq.removeEventListener('change', onSchemeChange);
        themeObserver?.disconnect();
      }
      window.removeEventListener('mousemove', onMouseMove);
      canvas.remove();
      container.style.position = prevPosition;
    },
  };
}

/** @deprecated Use `asciiBackground` instead. */
export const mountWaveBackground = asciiBackground;

/** @deprecated Use `AsciiBackgroundOptions` instead. */
export type MountWaveOptions = AsciiBackgroundOptions;
