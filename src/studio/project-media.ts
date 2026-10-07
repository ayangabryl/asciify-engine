import { loadStudioMedia, type StudioMedia } from './media';
import { createStudioText } from './text';
import { MAX_STUDIO_LAYERS, type StudioProject } from './project-model';

export interface StudioProjectTextSource {text:string;font?:Parameters<typeof createStudioText>[1];ink?:string}
export type StudioProjectSource = File|string|StudioProjectTextSource;
export type StudioProjectSources = Readonly<Record<string,StudioProjectSource>>;
export type StudioProjectMedia = ReadonlyMap<string,StudioMedia>;
export function assertProjectSources(project:StudioProject,media:ReadonlyMap<string,unknown>) {
  for(const layer of project.layers)if(!media.has(layer.source))throw new Error(`Missing project source: ${layer.source}`);
}
/** Owns each resolved binding once, even when several layers reference its key. */
export async function loadStudioProjectSources(project:StudioProject,sources:StudioProjectSources,signal?:AbortSignal) {
  const entries=Object.entries(sources),media=new Map<string,StudioMedia>();
  if(entries.length>MAX_STUDIO_LAYERS)throw new Error(`A project supports up to ${MAX_STUDIO_LAYERS} media bindings.`);
  assertProjectSources(project,new Map(entries));
  try {
    for(const [id,input] of entries) {
      if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
      if(typeof input==='string'||typeof File!=='undefined'&&input instanceof File)media.set(id,await loadStudioMedia(input,signal));
      else if(input&&typeof input==='object'&&'text' in input&&typeof input.text==='string') {
        const text=input as StudioProjectTextSource;
        const {canvas}=await createStudioText(text.text,text.font,text.ink??'#ffffff',null);
        media.set(id,{source:canvas,width:canvas.width,height:canvas.height,duration:0,animated:false,
          frame:()=>canvas,seek:async()=>{},destroy:()=>{canvas.width=canvas.height=1;}});
      } else throw new Error(`Invalid project source: ${id}`);
    }
    if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
    return media;
  } catch(error) {for(const value of media.values())value.destroy();throw error;}
}
