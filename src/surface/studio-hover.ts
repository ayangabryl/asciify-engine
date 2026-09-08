import { resolveMotion, type AmbientMotion } from './ambient-motion';
import type { AsciiFrame, AsciiOptions } from '../types';
import { WaterSurface, type HeroHover } from './water-surface';
import { createSurfaceRenderer } from './surface-renderer';

export type StudioHoverEffect = Exclude<HeroHover, 'light' | 'scan'>;

export interface StudioHoverOptions {
  effect?: StudioHoverEffect;
  /** Supply the current object frame when available for exact glyph identities/colors. */
  getFrame?: () => AsciiFrame | undefined;
  motion?: AmbientMotion;
  motionSpeed?: number;
  fineDither?: boolean;
  ditherStrength?: number;
  strength?: number;
  radius?: number;
  /** Enable when the backing canvas is drawn by a video/animation renderer. */
  animated?: boolean;
  fps?: number;
  fontSize?: number;
  charAspect?: number;
  /** Match the backing engine character spacing. Default: 1. */
  charSpacing?: number;
  paused?: boolean;
  charset?: string;
  customText?: string;
  renderMode?: 'ascii' | 'dots';
  dotSizeRatio?: number;
}

/** Optional studio surface layer. Keep engine hoverStrength: 0 to avoid two effects.
 * Host must be a positioned wrapper fitted to the source canvas, e.g. width:fit-content.
 * Call invalidate() after drawing a new still; destroy() before removing the host.
 */
export function mountStudioHover(host: HTMLElement, source: HTMLCanvasElement, initial: StudioHoverOptions = {}) {
  let options = { effect: 'trail' as HeroHover, strength: .55, radius: .2, animated: false, fps: 30, fontSize: 7, charAspect: .58, charSpacing: 1, paused: false, charset: ' .:-=+*#%@', customText: '', renderMode: 'ascii' as const, dotSizeRatio: .72, ...initial };
  let field = new WaterSurface(source.clientWidth / Math.max(1, source.clientHeight)), disposed = false, visible = false, dirty = true;
  let raf = 0, last = 0, painted = -Infinity, elapsed = 0;
  let pointer: { x: number; y: number } | null = null, pointerDirty = false;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const wake = () => { if (!disposed && visible && !document.hidden && !raf) raf = requestAnimationFrame(tick); };
  const compositor = createSurfaceRenderer(host, source, () => queueMicrotask(() => { dirty = true; wake(); }));
  function tick(now: number) {
    raf = 0; if (disposed || !visible || document.hidden) return;
    const width = source.clientWidth, height = source.clientHeight;
    if (!width || !height) return;
    const paused = reduced.matches || options.paused;
    field.configure(options.effect, options.strength, options.radius);
    const active = field.active;
    if (!paused) {
      elapsed += last ? Math.min(.1,(now-last)/1000) : 0;
      if (pointerDirty) {
        const rect = source.getBoundingClientRect();
        if (pointer && rect.width && rect.height) field.move((pointer.x-rect.left)/rect.width,(pointer.y-rect.top)/rect.height); else field.leave();
        pointerDirty = false;
      }
      field.step(last ? (now-last)/1000 : 1/60);
    }
    const baseDue = dirty || options.animated && !paused && now-painted >= 1000/Math.max(1,Math.min(60,options.fps))-.5;
    if (baseDue || active || field.active || !paused && resolveMotion(options.motion) !== 'none') {
      compositor.render(baseDue,field.refraction,width,height,options.fontSize*options.charSpacing,options.fontSize/options.charAspect*options.charSpacing,baseDue ? options.getFrame?.() : undefined,{charset:options.charset,customText:options.customText,renderMode:options.renderMode,dotSizeRatio:options.dotSizeRatio,colorMode:'fullcolor',animationStyle:options.motion,animationSpeed:options.motionSpeed ?? 1,artStyle:options.fineDither?'terminal':'classic',ditherStrength:options.ditherStrength ?? 1} as AsciiOptions,elapsed);
      if(baseDue) painted=now; dirty=false;
    }
    last=now;
    if(!paused && (options.animated || field.active || resolveMotion(options.motion) !== 'none')) wake();
  }
  const reset = () => { field.clear(); pointer=null; pointerDirty=false; last=0; dirty=true; cancelAnimationFrame(raf); raf=0; wake(); };
  const move = (event: PointerEvent) => {
    if (event.pointerType==='touch' || options.paused || reduced.matches) return;
    if(event.target instanceof Element && event.target.closest('button,a,input,summary,select')) { leave(); return; }
    const rect=source.getBoundingClientRect();
    if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom) { leave(); return; }
    pointer={x:event.clientX,y:event.clientY}; pointerDirty=true; wake();
  };
  const leave = () => { pointer=null; pointerDirty=true; wake(); };
  const intersection = new IntersectionObserver(([entry])=>{ visible=entry.isIntersecting; reset(); }); intersection.observe(host);
  const resize = new ResizeObserver(()=>{ field=new WaterSurface(source.clientWidth/Math.max(1,source.clientHeight)); reset(); }); resize.observe(source);
  host.addEventListener('pointermove',move); host.addEventListener('pointerleave',leave); host.addEventListener('pointercancel',leave);
  document.addEventListener('visibilitychange',reset); reduced.addEventListener('change',reset);
  return {
    /** Visible canvas; use this for CSS layering or snapshots. */
    get canvas() { return compositor.canvas; },
    invalidate() { dirty=true; wake(); },
    update(next: StudioHoverOptions) { options={...options,...next}; reset(); },
    destroy() {
      if (disposed) return;
      disposed=true; cancelAnimationFrame(raf); intersection.disconnect(); resize.disconnect(); compositor.destroy();
      host.removeEventListener('pointermove',move); host.removeEventListener('pointerleave',leave); host.removeEventListener('pointercancel',leave);
      document.removeEventListener('visibilitychange',reset); reduced.removeEventListener('change',reset);
    },
  };
}
