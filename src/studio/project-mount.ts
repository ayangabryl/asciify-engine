import { hasAnimatedEffects } from './activity';
import { AmbientTimeline } from '../surface/ambient-motion';
import { createStudioProjectRenderer, type StudioProjectLimits } from './project-renderer';
import { assertProjectSources, loadStudioProjectSources, type StudioProjectMedia, type StudioProjectSources } from './project-media';
import { MAX_STUDIO_LAYERS, normalizeStudioProject, updateStudioProjectLayer, visibleStudioLayers, type StudioLayerPatch, type StudioProjectInput } from './project-model';

export interface MountStudioProjectOptions extends StudioProjectLimits {
  fps?:number; adaptive?:boolean; signal?:AbortSignal;
  onFrame?:(time:number,costMs:number)=>void;onError?:(error:Error)=>void;onQualityChange?:(maxCells:number)=>void;
}
export async function mountStudioProject(canvas:HTMLCanvasElement,input:StudioProjectInput,sources:StudioProjectSources,options:MountStudioProjectOptions={}) {
  const project=normalizeStudioProject(input),media=await loadStudioProjectSources(project,sources,options.signal);
  try{return mountStudioProjectMedia(canvas,project,media,options);}
  catch(error){for(const value of new Set(media.values()))value.destroy();throw error;}
}
/** Takes ownership of the supplied media. One shared RAF drives all layers. */
export function mountStudioProjectMedia(canvas:HTMLCanvasElement,input:StudioProjectInput,media:StudioProjectMedia,options:MountStudioProjectOptions={}) {
  media=new Map(media);
  if(media.size>MAX_STUDIO_LAYERS)throw new Error(`A project supports up to ${MAX_STUDIO_LAYERS} media bindings.`);
  let project=normalizeStudioProject(input);assertProjectSources(project,media);
  if(options.signal?.aborted)throw new DOMException('Cancelled','AbortError');
  const renderer=createStudioProjectRenderer(canvas,project,options),reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const owned=[...new Set(media.values())],videos=owned.filter(m=>m.source instanceof HTMLVideoElement).map(m=>m.source as HTMLVideoElement);
  const clocks=new Map<string,AmbientTimeline>();
  let phases:Record<string,number>={},time=0,last=0,painted=0,raf=0,dirty=true,paused=false,visible=true,disposed=false;
  let adaptive=options.adaptive!==false,samples=0,average=0,over=0,width=project.width,height=project.height,seekGeneration=0,seeking=false;
  let seekController:AbortController|undefined;
  const videoRequests=new WeakSet<HTMLVideoElement>();
  const fps=Math.max(1,Math.min(60,Number.isFinite(options.fps)?options.fps!:60));
  const shouldPlay=()=>!disposed&&!paused&&!seeking&&!reduced.matches&&visible&&!document.hidden;
  const wake=()=>{if(!disposed&&!raf&&visible&&!document.hidden)raf=requestAnimationFrame(tick);};
  const playable=()=>new Set(visibleStudioLayers({...project,width,height}).map(l=>media.get(l.source)!.source));
  const syncPlayback=()=>{
    const active=playable();
    for(const video of videos) {
      video.loop=true;
      if(shouldPlay()&&active.has(video)) {
        if(video.paused&&!videoRequests.has(video)) {
          videoRequests.add(video);
          void video.play().then(()=>{videoRequests.delete(video);if(!shouldPlay()||!playable().has(video))video.pause();}).catch(error=>{
            videoRequests.delete(video);if(disposed)return;paused=true;syncPlayback();options.onError?.(error instanceof Error?error:new Error(String(error)));dirty=true;wake();
          });
        }
      } else video.pause();
    }
  };
  const motion=()=>{last=0;dirty=true;syncPlayback();wake();};
  function tick(now:number) {
    raf=0;if(disposed||!visible||document.hidden)return;
    const moving=shouldPlay();
    if(moving)time+=last?Math.min(.1,(now-last)/1000):0;
    last=now;
    const layers=visibleStudioLayers({...project,width,height}),animated=layers.some(l=>media.get(l.source)!.animated||hasAnimatedEffects(l.settings));
    if(dirty||moving&&renderer.active||moving&&animated&&now-painted>=1000/fps-.5) {
      const start=performance.now();
      try {
        const frames=new Map(),used=new Set(layers.map(l=>l.source));
        for(const id of used) {
          const asset=media.get(id)!;
          if(asset.animated&&!(asset.source instanceof HTMLVideoElement)&&moving)renderer.invalidate(id);
          frames.set(id,asset.frame(time));
        }
        phases={};
        for(const layer of layers) {
          let clock=clocks.get(layer.id);if(!clock){clock=new AmbientTimeline();clocks.set(layer.id,clock);}
          phases[layer.id]=clock.update(time,layer.settings.motion.type,layer.settings.motion.speed);
        }
        renderer.render(frames,time,width,height,phases);
        const cost=performance.now()-start;options.onFrame?.(time,cost);
        average=average?average*.9+cost*.1:cost;
        if(++samples>20&&adaptive&&moving&&(animated||renderer.active)) {
          over=average>13?over+1:0;
          if(over>=12&&renderer.maxCells>2048){renderer.setBudget(Math.max(2048,renderer.maxCells*.8));options.onQualityChange?.(renderer.maxCells);average=over=0;dirty=true;}
        }
      } catch(error){paused=true;syncPlayback();options.onError?.(error instanceof Error?error:new Error(String(error)));}
      dirty=false;painted=now;
    }
    if(moving&&(animated||renderer.active))wake();
  }
  const move=(e:PointerEvent)=>{if(!shouldPlay())return;const r=canvas.getBoundingClientRect();if(!r.width||!r.height)return;renderer.pointer((e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height,e.timeStamp);wake();};
  const leave=()=>{renderer.leave();wake();};
  const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;motion();});
  observer.observe(canvas);
  canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerleave',leave);canvas.addEventListener('pointercancel',leave);
  document.addEventListener('visibilitychange',motion);reduced.addEventListener('change',motion);
  const destroy=()=>{
    if(disposed)return;disposed=true;seekGeneration++;seekController?.abort();cancelAnimationFrame(raf);raf=0;observer.disconnect();
    canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerleave',leave);canvas.removeEventListener('pointercancel',leave);
    document.removeEventListener('visibilitychange',motion);reduced.removeEventListener('change',motion);options.signal?.removeEventListener('abort',destroy);
    renderer.destroy();for(const asset of owned)asset.destroy();clocks.clear();
  };
  options.signal?.addEventListener('abort',destroy,{once:true});
  const assertLive=()=>{if(disposed)throw new Error('Project player has been destroyed.');};
  const update=(next:StudioProjectInput)=>{
    assertLive();const normalized=normalizeStudioProject(next);assertProjectSources(normalized,media);
    if(width===project.width&&height===project.height){width=normalized.width;height=normalized.height;}
    project=normalized;renderer.configure(project);
    for(const id of clocks.keys())if(!project.layers.some(l=>l.id===id))clocks.delete(id);
    motion();
  };
  motion();
  return {canvas,
    get project(){return normalizeStudioProject(project);},get time(){return time;},get motionTimes(){return {...phases};},
    get paused(){return paused||reduced.matches;},get maxCells(){return renderer.maxCells;},get pixelRatio(){return renderer.pixelRatio;},get quality(){return renderer.quality;},
    update,updateLayer:(id:string,patch:StudioLayerPatch)=>update(updateStudioProjectLayer(project,id,patch)),
    resize(w:number,h:number,pixelRatio?:number){assertLive();if(!Number.isFinite(w)||!Number.isFinite(h)||w<2||h<2)throw new Error('Project dimensions must be positive finite numbers.');width=w;height=h;if(pixelRatio!==undefined)renderer.setPixelRatio(pixelRatio);motion();},
    pause(value=true){assertLive();paused=value;motion();},
    async seek(seconds:number){
      assertLive();if(!Number.isFinite(seconds)||seconds<0)throw new Error('Project time must be finite and non-negative.');
      const generation=++seekGeneration;seekController?.abort();seekController=new AbortController();
      const signal=seekController.signal;seeking=true;syncPlayback();
      try {
        await Promise.all(owned.map(asset=>asset.seek(seconds,signal)));
        if(disposed||generation!==seekGeneration)return;
        time=seconds;clocks.clear();renderer.invalidate();
      } finally {if(!disposed&&generation===seekGeneration){seeking=false;motion();}}
    },
    redraw(){assertLive();renderer.invalidate();dirty=true;wake();},
    setBudget(value:number){assertLive();renderer.setBudget(value);options.onQualityChange?.(renderer.maxCells);dirty=true;wake();},
    setAdaptive(value:boolean){adaptive=value;samples=over=average=0;},destroy,
  };
}
