import { BLEND_MODES, normalizeStudioSettings, updateStudioSettings, type StudioInput, type StudioSettings } from './model';

export const MAX_STUDIO_LAYERS = 8;
export interface StudioLayerPlacement {
  /** Normalized center and size in the project canvas. */
  x:number; y:number; width:number; height:number;
  rotation:number; flipX:boolean; flipY:boolean;
}
export interface StudioProjectLayer {
  id:string; name:string; source:string; visible:boolean; opacity:number;
  blend:typeof BLEND_MODES[number]; placement:StudioLayerPlacement; settings:StudioSettings;
}
export interface StudioProject {
  kind:'asciify-project'; version:1; width:number; height:number;
  background:string|null; pointerMode:'top'|'all'; layers:StudioProjectLayer[];
}
export type StudioLayerInput = Pick<StudioProjectLayer,'id'|'source'> &
  Partial<Omit<StudioProjectLayer,'id'|'source'|'placement'|'settings'>> &
  {placement?:Partial<StudioLayerPlacement>;settings?:StudioInput};
export type StudioLayerPatch = Partial<Omit<StudioLayerInput,'id'>>;
export type StudioProjectInput = Partial<Omit<StudioProject,'layers'>> & {layers?:StudioLayerInput[]};
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const number=(v:unknown,f:number,min:number,max:number)=>typeof v==='number'&&Number.isFinite(v)?Math.max(min,Math.min(max,v)):f;
const identifier=(value:unknown,label:string)=>{
  if(typeof value!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,63}$/.test(value))throw new Error(`${label} must be 1–64 letters, numbers, colons, dashes or underscores, starting with a letter or number.`);
  return value;
};
/** A project contains asset keys, never source files, URLs or executable code. */
export function normalizeStudioProject(input:unknown={}):StudioProject {
  const v=record(input);
  if(v.kind!==undefined&&v.kind!=='asciify-project'||v.version!==undefined&&v.version!==1)
    throw new Error('Unsupported Studio project. Update asciify-engine.');
  if(v.layers!==undefined&&!Array.isArray(v.layers))throw new Error('Project layers must be an array.');
  const layers=Array.isArray(v.layers)?v.layers:[];
  if(layers.length>MAX_STUDIO_LAYERS)throw new Error(`A project supports up to ${MAX_STUDIO_LAYERS} layers.`);
  const ids=new Set<string>();
  return {kind:'asciify-project',version:1,width:Math.round(number(v.width,1280,2,4096)),height:Math.round(number(v.height,720,2,4096)),
    background:v.background===null?null:typeof v.background==='string'&&/^#[a-f\d]{6}$/i.test(v.background)?v.background:'#0c1711',
    pointerMode:v.pointerMode==='all'?'all':'top',layers:layers.map((value,index)=>{
      const l=record(value),p=record(l.placement),s=record(l.settings),back=record(s.backdrop);
      const id=identifier(l.id,'Layer id'),source=identifier(l.source,'Source key');
      if(ids.has(id))throw new Error(`Duplicate layer id: ${id}`);ids.add(id);
      return {id,source,name:typeof l.name==='string'?l.name.slice(0,80):`Layer ${index+1}`,visible:l.visible!==false,
        opacity:number(l.opacity,1,0,1),blend:BLEND_MODES.includes(l.blend as never)?l.blend as StudioProjectLayer['blend']:'source-over',
        placement:{x:number(p.x,.5,-1,2),y:number(p.y,.5,-1,2),width:number(p.width,1,.01,2),height:number(p.height,1,.01,2),
          rotation:number(p.rotation,0,-180,180),flipX:p.flipX===true,flipY:p.flipY===true},
        settings:normalizeStudioSettings({...s,backdrop:{mode:'transparent',...back}})};
    })};
}
export function updateStudioProjectLayer(project:StudioProject,id:string,patch:StudioLayerPatch):StudioProject {
  if(!project.layers.some(layer=>layer.id===id))throw new Error(`Unknown layer: ${id}`);
  return normalizeStudioProject({...project,layers:project.layers.map(layer=>layer.id!==id?layer:{...layer,...patch,id,
    placement:{...layer.placement,...patch.placement},settings:updateStudioSettings(layer.settings,patch.settings??{})})});
}
export const serializeStudioProject=(project:StudioProject)=>JSON.stringify(normalizeStudioProject(project));
export function parseStudioProject(json:string):StudioProject {
  if(json.length>1_000_000)throw new Error('Project exceeds the 1 MB settings limit.');
  const value=JSON.parse(json);
  if(value?.kind!=='asciify-project'||value.version!==1||!Array.isArray(value.layers))throw new Error('This is not an Asciify layered project.');
  return normalizeStudioProject(value);
}
/** No pixel readback: pointer picking uses transformed rectangular layer bounds. */
export function studioLayerPoint(layer:StudioProjectLayer,x:number,y:number,width:number,height:number):[number,number] {
  const p=layer.placement,angle=p.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  const dx=(x-p.x)*width,dy=(y-p.y)*height;
  const u=(dx*c+dy*s)/(p.width*width),v=(-dx*s+dy*c)/(p.height*height);
  return [.5+u*(p.flipX?-1:1),.5+v*(p.flipY?-1:1)];
}
export function visibleStudioLayers(project:StudioProject):StudioProjectLayer[] {
  return project.layers.filter(l=>{
    if(!l.visible||l.opacity<=0)return false;
    const p=l.placement,a=p.rotation*Math.PI/180,c=Math.abs(Math.cos(a)),s=Math.abs(Math.sin(a));
    const rx=(c*p.width*project.width+s*p.height*project.height)/2;
    const ry=(s*p.width*project.width+c*p.height*project.height)/2;
    return p.x*project.width+rx>0&&p.x*project.width-rx<project.width&&p.y*project.height+ry>0&&p.y*project.height-ry<project.height;
  });
}

/** A shared budget prevents each extra layer from multiplying the work ceiling. */
export function studioProjectBudget(project:StudioProject,maxCells=24000,maxRasterPixels=4_194_304,width=project.width,height=project.height) {
  const layers=visibleStudioLayers(project),cells=Math.round(number(maxCells,24000,2048,1048576));
  const pixels=number(maxRasterPixels,4_194_304,65536,16_777_216);
  const weights=layers.map(l=>l.placement.width*l.placement.height),total=weights.reduce((a,b)=>a+b,0);
  const remaining=cells-layers.length*256;
  const raster=layers.map(l=>{
    const w=width*l.placement.width,h=height*l.placement.height,fit=Math.min(1,4096/Math.max(w,h));
    return {width:Math.max(2,w*fit),height:Math.max(2,h*fit)};
  });
  const area=raster.reduce((sum,r)=>sum+r.width*r.height,0);
  let assigned=0,assignedPixels=0;
  return layers.map((l,i)=>{
    const budget=i===layers.length-1?cells-assigned:256+Math.floor(remaining*weights[i]/total);assigned+=budget;
    const r=raster[i],allocation=i===layers.length-1?pixels-assignedPixels:4+Math.floor((pixels-layers.length*4)*r.width*r.height/Math.max(1,area));
    assignedPixels+=allocation;
    const scale=Math.min(1,Math.sqrt(allocation/(r.width*r.height)));
    let rw=Math.max(2,Math.floor(r.width*scale)),rh=Math.max(2,Math.floor(r.height*scale));
    if(rw*rh>allocation){if(rw>=rh)rw=Math.max(2,Math.floor(allocation/rh));else rh=Math.max(2,Math.floor(allocation/rw));}
    return {id:l.id,maxCells:budget,width:rw,height:rh};
  });
}
