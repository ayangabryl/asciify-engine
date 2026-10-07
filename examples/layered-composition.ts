import { mountStudioProject, exportStudioProject, normalizeStudioProject, serializeStudioProject, parseStudioProject,
  type StudioLayerPatch, type StudioProjectSources } from 'asciify-engine/studio';

/** A live local component; accessible titles and controls stay in HTML. */
export async function createLayeredComposition(canvas:HTMLCanvasElement,photo:File|string,signal?:AbortSignal) {
  const sources:StudioProjectSources={photo,headline:{text:'ASCIIFY',font:'Small'}};
  const project=normalizeStudioProject({width:1280,height:720,background:'#0c1711',layers:[
    {id:'photo',source:'photo',name:'Photograph',settings:{ink:'#97b6a0',motion:{type:'parallax',amount:.3,speed:1},hover:{effect:'trail',radius:.45,strength:.55}}},
    {id:'title',source:'headline',name:'Title',placement:{width:.8,height:.25},settings:{ink:'#b3ed82',cellSize:3,hover:{effect:'elastic',radius:.4,strength:.5}}},
  ]});
  const player=await mountStudioProject(canvas,project,sources,{maxDimension:1280,maxCells:24000,maxRasterPixels:2097152,signal});
  return {player,
    updateLayer:(id:string,patch:StudioLayerPatch)=>player.updateLayer(id,patch),
    save:()=>serializeStudioProject(player.project),
    restore:(json:string)=>player.update(parseStudioProject(json)),
    exportPng:(signal?:AbortSignal)=>exportStudioProject(player.project,sources,{format:'png',width:1280,height:720,
      referenceWidth:canvas.width/player.pixelRatio,maxCells:player.maxCells,time:player.time,motionTimes:player.motionTimes,signal}),
    // One moving layer has a 12-second cycle. Media, other speeds and
    // temporal finishing can change the combined loop period.
    exportMp4:(signal?:AbortSignal)=>exportStudioProject(player.project,sources,{format:'mp4',width:1280,height:720,duration:12,fps:24,
      referenceWidth:canvas.width/player.pixelRatio,maxCells:player.maxCells,signal}),
    destroy:()=>player.destroy(),
  };
}
