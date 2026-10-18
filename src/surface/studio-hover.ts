import type { SurfaceFilter } from './surface-finish';
import { createTextMask } from './text-mask';
import { resolveMotion, type AmbientMotion, type LegacyAmbientMotion } from './ambient-motion';
import type { AsciiFrame, AsciiOptions } from '../types';
import { WaterSurface, type HeroHover } from './water-surface';
import { createSurfaceRenderer, type SurfaceScope } from './surface-renderer';
import type { DeprecatedSurfaceHover } from './hover-catalog';
import { buildHoverGuide, type HoverGuide, type HoverScope } from './hover-guide';

export type StudioHoverEffect = Exclude<HeroHover, 'light' | 'scan'> | DeprecatedSurfaceHover;

export interface StudioHoverOptions {
  effect?: StudioHoverEffect;
  /** 0..1 peripheral scanline/fringe treatment. Center stays sharp. */
  edgeEffect?: number;
  /** 0..1 Prism edge blur/fade. The center stays crisp; default 0. */
  edgeSoftness?: number;
  /** Stationary glyph finish. Defaults to Prism when edgeEffect is supplied. */
  filter?: SurfaceFilter;
  /** Plain horizontal HTML text to darken ASCII over; rebuilds on layout/font changes. */
  textMask?: HTMLElement | readonly HTMLElement[];
  colorMode?: 'fullcolor' | 'grayscale' | 'accent' | 'matrix';
  accentColor?: string;
  /** Supply the current object frame when available for exact glyph identities/colors. */
  getFrame?: () => AsciiFrame | undefined;
  motion?: AmbientMotion | LegacyAmbientMotion;
  motionSpeed?: number;
  fineDither?: boolean;
  ditherStrength?: number;
  strength?: number;
  radius?: number;
  /** Where the hover acts: everywhere, only on the subject, or only around it. Default 'all'.
   * The subject is read from the canvas: its transparency, or its distance from a plain ground. */
  scope?: HoverScope;
  /** 0..1 how long the effect lingers after the pointer moves on or leaves. Default .5. */
  decay?: number;
  /** Follow touch drags on phones. Scrolling still wins a vertical swipe. Default true. */
  touch?: boolean;
  /** Pin outer glyph rows and soften displacement near borders. Default false. */
  edgeSafe?: boolean;
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
  let options = { effect: 'trail' as StudioHoverEffect, scope: 'all' as HoverScope, decay: .5, touch: true, strength: .55, radius: !initial.effect || initial.effect === 'trail' ? .45 : .2, animated: false, fps: 30, fontSize: 7, charAspect: .58, charSpacing: 1, paused: false, charset: ' .:-=+*#%@', customText: '', renderMode: 'ascii' as const, dotSizeRatio: .72, ...initial };
  let field = new WaterSurface(source.clientWidth / Math.max(1, source.clientHeight)), disposed = false, visible = false, dirty = true;
  let raf = 0, last = 0, painted = -Infinity, elapsed = 0;
  let latestFrame: AsciiFrame | undefined;
  let textMask: ReturnType<typeof createTextMask> | undefined;
  let pointer: { x: number; y: number; time: number } | null = null, pointerDirty = false;
  let pointerSamples: { x: number; y: number; time: number }[] = [];
  let guide: HoverGuide | null = null, scope: SurfaceScope | undefined, guideDirty = true, guidedAt = -Infinity;
  // Two scope buffers in turn: the renderer re-uploads when the identity changes, and video rebuilds never allocate.
  const scopeBuffers: Uint8Array[] = [new Uint8Array(0), new Uint8Array(0)];
  let scopeBuffer = 0;
  const probe = document.createElement('canvas'), probeCtx = probe.getContext('2d', { willReadFrequently: true });
  // Subject coverage from the drawn artwork, at the field's resolution. Rebuilt when the still changes.
  const readGuide = () => {
    guideDirty = false;
    if (options.scope === 'all' && options.effect !== 'tilt') { scope = undefined; guide = null; field.setGuide(null); return; }
    if (!probeCtx || !source.width || !source.height) return;
    if (probe.width !== field.columns || probe.height !== field.rows) { probe.width = field.columns; probe.height = field.rows; }
    probeCtx.clearRect(0, 0, probe.width, probe.height); probeCtx.drawImage(source, 0, 0, probe.width, probe.height);
    try { guide = buildHoverGuide(probeCtx.getImageData(0, 0, probe.width, probe.height).data, probe.width, probe.height, null, guide); } catch { guide = null; }
    field.setGuide(guide);
    if (!guide || options.scope === 'all' || guide.key === 'none') { scope = undefined; return; }
    scopeBuffer ^= 1;
    if (scopeBuffers[scopeBuffer].length !== guide.width * guide.height * 4) scopeBuffers[scopeBuffer] = new Uint8Array(guide.width * guide.height * 4);
    const pixels = scopeBuffers[scopeBuffer];
    for (let i = 0; i < guide.subject.length; i++) pixels[i * 4 + 3] = guide.subject[i] * 255;
    scope = { pixels, width: guide.width, height: guide.height, mode: options.scope };
  };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const wake = () => { if (!disposed && visible && !document.hidden && !raf) raf = requestAnimationFrame(tick); };
  const compositor = createSurfaceRenderer(host, source, () => queueMicrotask(() => { dirty = true; wake(); }));
  if(options.textMask) textMask=createTextMask(host,options.textMask,()=>{dirty=true;wake();});
  function tick(now: number) {
    raf = 0; if (disposed || !visible || document.hidden) return;
    const width = source.clientWidth, height = source.clientHeight;
    if (!width || !height) return;
    const paused = reduced.matches || options.paused;
    field.configure(options.effect, options.strength, options.radius, options.edgeSafe, options.decay);
    if (guideDirty) { readGuide(); guidedAt=now; }
    const active = field.active;
    if (!paused) {
      elapsed += last ? Math.min(.1,(now-last)/1000) : 0;
      if (pointerDirty) {
        const rect = source.getBoundingClientRect();
        if(rect.width && rect.height) for(const point of pointerSamples) field.move((point.x-rect.left)/rect.width,(point.y-rect.top)/rect.height,point.time);
        pointerSamples=[];
        if(!pointer) field.leave();
        pointerDirty = false;
      }
      field.step(last ? (now-last)/1000 : 1/60);
    }
    const baseDue = dirty || options.animated && !paused && now-painted >= 1000/Math.max(1,Math.min(60,options.fps))-.5;
    if (baseDue || active || field.active || !paused && resolveMotion(options.motion) !== 'none') {
      if(baseDue) latestFrame=options.getFrame?.();
      // A moving source moves its subject: re-read it with new frames, a few times a second.
      if(baseDue && options.animated && guide && now-guidedAt>=160) { readGuide(); guidedAt=now; }
      compositor.render(baseDue,field.refraction,width,height,options.fontSize*options.charSpacing,options.fontSize/options.charAspect*options.charSpacing,latestFrame,{charset:options.charset,customText:options.customText,renderMode:options.renderMode,dotSizeRatio:options.dotSizeRatio,colorMode:options.colorMode??'fullcolor',accentColor:options.accentColor??'#888888',animationStyle:options.motion,animationSpeed:options.motionSpeed ?? 1,artStyle:'classic',fineDither:options.fineDither,ditherStrength:options.ditherStrength ?? 1} as AsciiOptions,elapsed,{filter:options.filter,edgeEffect:options.edgeEffect,edgeSoftness:options.edgeSoftness,textMask:textMask?.read(),scope});
      if(baseDue) painted=now; dirty=false;
    }
    last=now;
    if(!paused && (options.animated || field.active || resolveMotion(options.motion) !== 'none')) wake();
  }
  const reset = () => { field.clear(); pointer=null; pointerSamples=[]; pointerDirty=false; last=0; dirty=true; cancelAnimationFrame(raf); raf=0; wake(); };
  const move = (event: PointerEvent) => {
    if ((event.pointerType==='touch' && !options.touch) || options.paused || reduced.matches) return;
    if(event.target instanceof Element && event.target.closest('button,a,input,summary,select')) { leave(); return; }
    const rect=source.getBoundingClientRect();
    if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom) { leave(); return; }
    pointer={x:event.clientX,y:event.clientY,time:event.timeStamp};
    pointerSamples.push(pointer);if(pointerSamples.length>6)pointerSamples.shift();
    pointerDirty=true; wake();
  };
  const leave = () => { pointer=null; pointerDirty=true; wake(); };
  // A finger that lifts has left; a mouse button release has not.
  const lift = (event: PointerEvent) => { if (event.pointerType==='touch') leave(); };
  const intersection = new IntersectionObserver(([entry])=>{ visible=entry.isIntersecting; reset(); }); intersection.observe(host);
  const resize = new ResizeObserver(()=>{ field=new WaterSurface(source.clientWidth/Math.max(1,source.clientHeight)); guideDirty=true; reset(); }); resize.observe(source);
  host.addEventListener('pointerdown',move); host.addEventListener('pointerup',lift);
  host.addEventListener('pointermove',move); host.addEventListener('pointerleave',leave); host.addEventListener('pointercancel',leave);
  document.addEventListener('visibilitychange',reset); reduced.addEventListener('change',reset);
  return {
    /** Visible canvas; use this for CSS layering or snapshots. */
    get canvas() { return compositor.canvas; },
    invalidate() { textMask?.invalidate(); dirty=true; guideDirty=true; wake(); },
    update(next: StudioHoverOptions) {
      if('textMask' in next) {textMask?.destroy();textMask=next.textMask?createTextMask(host,next.textMask,()=>{dirty=true;wake();}):undefined;}
      options={...options,...next};guideDirty=true;reset();
    },
    destroy() {
      if (disposed) return;
      disposed=true; cancelAnimationFrame(raf); intersection.disconnect(); resize.disconnect(); compositor.destroy();textMask?.destroy();
      host.removeEventListener('pointerdown',move); host.removeEventListener('pointerup',lift);
      host.removeEventListener('pointermove',move); host.removeEventListener('pointerleave',leave); host.removeEventListener('pointercancel',leave);
      document.removeEventListener('visibilitychange',reset); reduced.removeEventListener('change',reset);
    },
  };
}
