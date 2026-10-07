import { createStudioRenderer, type StudioSource } from './renderer';
import { hasAnimatedEffects } from './activity';
import { normalizeStudioProject, studioLayerPoint, studioProjectBudget, visibleStudioLayers } from './project-model';

export interface StudioProjectLimits {maxDimension?:number;maxCells?:number;maxRasterPixels?:number;pixelRatio?:number}
export type StudioProjectFrames = ReadonlyMap<string,StudioSource>;
type Child={renderer:ReturnType<typeof createStudioRenderer>;signature:string;dirty:boolean;source?:StudioSource;stamp?:number;geometry:string};
/** Reusable composition renderer. No RAF, event listeners, loading or media ownership. */
export function createStudioProjectRenderer(canvas:HTMLCanvasElement,input:unknown={},limits:StudioProjectLimits={}) {
  const context=canvas.getContext('2d');
  if(!context)throw new Error('Project canvas is already owned by another renderer.');
  let project=normalizeStudioProject(input),changed=true,disposed=false;
  let signatures=new Map(project.layers.map(l=>[l.id,JSON.stringify(l.settings)]));
  const maxDimension=Math.max(64,Math.min(4096,Number.isFinite(limits.maxDimension)?limits.maxDimension!:960));
  const maximumCells=Math.max(2048,Math.min(1048576,Number.isFinite(limits.maxCells)?limits.maxCells!:24000));
  let cells=maximumCells,ratio=Math.max(.1,Math.min(8,Number.isFinite(limits.pixelRatio)?limits.pixelRatio!:1));
  let quality:ReturnType<typeof studioProjectBudget>=[];
  const children=new Map<string,Child>();
  const assertLive=()=>{if(disposed)throw new Error('Project renderer has been destroyed.');};
  const prune=()=>{
    const visible=new Set(visibleStudioLayers(project).map(l=>l.id));
    for(const [id,child] of children)if(!visible.has(id)){child.renderer.destroy();children.delete(id);}
  };
  return {
    canvas,
    render(frames:StudioProjectFrames,time=0,width=project.width,height=project.height,motionTimes:Readonly<Record<string,number>>={}) {
      assertLive();
      if(!Number.isFinite(width)||!Number.isFinite(height)||width<2||height<2)throw new Error('Project dimensions must be positive finite numbers.');
      const fit=Math.min(1,maxDimension/Math.max(width,height)),w=Math.max(2,Math.round(width*fit)),h=Math.max(2,Math.round(height*fit));
      if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;changed=true;}
      const layout={...project,width:w,height:h},visible=visibleStudioLayers(layout);
      for(const layer of visible)if(!frames.has(layer.source))throw new Error(`Missing project source: ${layer.source}`);
      const visibleIds=new Set(visible.map(l=>l.id));
      for(const [id,child] of children)if(!visibleIds.has(id)){child.renderer.destroy();children.delete(id);changed=true;}
      quality=studioProjectBudget(layout,cells,limits.maxRasterPixels,w,h);
      for(let i=0;i<visible.length;i++) {
        const layer=visible[i],budget=quality[i],source=frames.get(layer.source);
        if(!source)throw new Error(`Missing project source: ${layer.source}`);
        let child=children.get(layer.id);
        const signature=signatures.get(layer.id)!;
        if(!child) {
          child={renderer:createStudioRenderer(document.createElement('canvas'),layer.settings,{maxDimension:4096,maxCells:maximumCells}),signature,dirty:true,geometry:''};
          children.set(layer.id,child);
        } else if(child.signature!==signature){child.renderer.configure(layer.settings);child.signature=signature;child.dirty=true;}
        // Preserve logical cell size when the output cap or child raster budget
        // downsamples the requested canvas. The ratio refers to requested pixels.
        const rasterRatio=ratio*budget.width/(width*layer.placement.width),geometry=`${budget.width}:${budget.height}:${budget.maxCells}:${rasterRatio}`;
        if(child.geometry!==geometry){child.renderer.setBudget(budget.maxCells);child.renderer.setPixelRatio(rasterRatio);child.geometry=geometry;child.dirty=true;}
        const stamp='currentTime' in source?(source.getVideoPlaybackQuality?.().totalVideoFrames??source.currentTime):0;
        if(child.dirty||child.source!==source||child.stamp!==stamp||child.renderer.active||hasAnimatedEffects(layer.settings)) {
          const phase=Object.prototype.hasOwnProperty.call(motionTimes,layer.id)?motionTimes[layer.id]:undefined;
          child.renderer.render(source,time,budget.width,budget.height,phase);
          child.dirty=false;child.source=source;child.stamp=stamp;changed=true;
        }
      }
      if(!changed)return false;
      context.clearRect(0,0,w,h);context.globalCompositeOperation='source-over';context.globalAlpha=1;
      if(project.background!==null){context.fillStyle=project.background;context.fillRect(0,0,w,h);}
      let finish='none';
      for(const layer of visible) {
        const child=children.get(layer.id)!,p=layer.placement;
        context.save();context.globalAlpha=layer.opacity;context.globalCompositeOperation=layer.blend;
        try {
          context.translate(p.x*w,p.y*h);context.rotate(p.rotation*Math.PI/180);context.scale(p.flipX?-1:1,p.flipY?-1:1);
          context.drawImage(child.renderer.canvas,-p.width*w/2,-p.height*h/2,p.width*w,p.height*h);
        } finally {context.restore();}
        if(child.renderer.canvas.dataset.studioFinish==='unavailable')finish='unavailable';
        else if(finish!=='unavailable'&&child.renderer.canvas.dataset.studioFinish==='gpu')finish='gpu';
      }
      context.globalAlpha=1;context.globalCompositeOperation='source-over';canvas.dataset.studioFinish=finish;
      changed=false;return true;
    },
    configure(next:unknown){assertLive();project=normalizeStudioProject(next);signatures=new Map(project.layers.map(l=>[l.id,JSON.stringify(l.settings)]));prune();changed=true;},
    pointer(x:number,y:number,time:number) {
      if(disposed||!Number.isFinite(x)||!Number.isFinite(y))return;
      if(x<0||x>1||y<0||y>1){for(const child of children.values())child.renderer.leave();return;}
      let taken=false;
      for(const layer of visibleStudioLayers({...project,width:canvas.width,height:canvas.height}).reverse()) {
        const child=children.get(layer.id);if(!child)continue;
        const [u,v]=studioLayerPoint(layer,x,y,canvas.width,canvas.height);
        if((!taken||project.pointerMode==='all')&&u>=0&&u<=1&&v>=0&&v<=1&&layer.settings.hover.effect!=='none'&&layer.settings.hover.strength>0) {
          child.renderer.pointer(u,v,time);taken=true;
        } else child.renderer.leave();
      }
    },
    leave(){for(const child of children.values())child.renderer.leave();},
    invalidate(source?:string){assertLive();for(const layer of project.layers)if(source===undefined||source===layer.source){const child=children.get(layer.id);if(child){child.renderer.invalidate();child.dirty=true;}}changed=true;},
    setBudget(value:number){assertLive();cells=Math.max(2048,Math.min(maximumCells,Number.isFinite(value)?Math.round(value):maximumCells));changed=true;},
    setPixelRatio(value:number){assertLive();ratio=Math.max(.1,Math.min(8,Number.isFinite(value)?value:1));changed=true;},
    get maxCells(){return cells;},get pixelRatio(){return ratio;},
    get quality(){return quality.map(layer=>({...layer}));},
    get active(){return [...children.values()].some(c=>c.renderer.active);},
    destroy(){if(disposed)return;disposed=true;for(const child of children.values())child.renderer.destroy();children.clear();canvas.width=canvas.height=1;},
  };
}
