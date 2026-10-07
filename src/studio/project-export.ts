import { encodeStudioFrames } from './encode';
import type { StudioExportOptions } from './export';
import { normalizeStudioProject, visibleStudioLayers, type StudioProjectInput } from './project-model';
import { loadStudioProjectSources, type StudioProjectSources } from './project-media';
import { createStudioProjectRenderer } from './project-renderer';

export interface StudioProjectExportOptions extends Omit<StudioExportOptions,'motionTime'> {
  /** Phase snapshot from a mounted project, for a still after speed edits. */
  motionTimes?:Readonly<Record<string,number>>;
  /** Combined child-raster budget, distinct from the shared character budget. */
  maxRasterPixels?:number;
}
/** Loads independent assets and never seeks, pauses or destroys a live preview. */
export async function exportStudioProject(input:StudioProjectInput,sources:StudioProjectSources,options:StudioProjectExportOptions):Promise<Blob> {
  const project=normalizeStudioProject(input),phases={...options.motionTimes};
  if(Object.values(phases).some(value=>!Number.isFinite(value)||value<0))throw new Error('Layer motion times must be finite non-negative numbers.');
  const bindings=Object.fromEntries(Object.entries(sources).map(([id,source])=>[id,
    source&&typeof source==='object'&&'text' in source&&typeof source.text==='string'?{...source}:source]));
  let renderer:ReturnType<typeof createStudioProjectRenderer>|undefined;
  let media:Awaited<ReturnType<typeof loadStudioProjectSources>>|undefined;
  const controller=new AbortController();
  const cancel=()=>controller.abort();
  if(options.signal?.aborted)cancel();
  else options.signal?.addEventListener('abort',cancel,{once:true});
  const still=options.format==='png'||options.format==='jpeg';
  try {
    return await encodeStudioFrames(async(canvas,time,width,height,signal)=>{
      media??=await loadStudioProjectSources(project,bindings,signal);
      renderer??=createStudioProjectRenderer(canvas,project,{maxDimension:4096,maxCells:options.maxCells??24000,
        maxRasterPixels:options.maxRasterPixels,pixelRatio:width/(options.referenceWidth??Math.min(width,960))});
      const used=new Set(visibleStudioLayers({...project,width,height}).map(layer=>layer.source));
      const frames=new Map();
      await Promise.all([...used].map(async id=>{
        const asset=media!.get(id)!;await asset.seek(time,signal);frames.set(id,asset.frame(time));
        if(asset.animated)renderer!.invalidate(id);
      }));
      renderer.render(frames,time,width,height,still?phases:{});
    },{...options,signal:controller.signal});
  } finally {
    controller.abort();options.signal?.removeEventListener('abort',cancel);
    renderer?.destroy();if(media)for(const asset of new Set(media.values()))asset.destroy();
  }
}
