import type { AsciiFrame, AsciiOptions } from '../types';
import { createFramePalette } from './frame-palette';
import { packGlyphFrame, prepareGlyphAtlas, type GlyphAtlasPlan, type PackedGlyphFrame } from './glyph-renderer';

/** Cached source metadata: no image reads or font work on pointer-only frames. */
export function createTrailGlyphs() {
  const atlas=document.createElement('canvas'), sampler=document.createElement('canvas');
  const ctx=atlas.getContext('2d')!, sampleCtx=sampler.getContext('2d',{willReadFrequently:true})!;
  const framePalette=createFramePalette();
  let plan: GlyphAtlasPlan|null=null, packed: PackedGlyphFrame|undefined;
  return {
    update(source: HTMLCanvasElement,width:number,height:number,cw:number,ch:number,ratio:number,frame?:AsciiFrame,options?:AsciiOptions) {
      const cols=frame?.[0]?.length ?? Math.max(1,Math.round(width/cw)),rows=frame?.length ?? Math.max(1,Math.round(height/ch));
      const settings=options ?? {charset:' .:-=+*#%@',customText:'',colorMode:'fullcolor'} as AsciiOptions;
      // Charset sequences may contain glyphs outside the current palette.
      const chars=framePalette(frame,settings.charset+(settings.charsetFrames?.join('') ?? ''),settings.customText);
      const next=prepareGlyphAtlas(plan,{...settings,charset:chars},width,height,ratio,cols,rows);
      if(next!==plan) {
        atlas.width=next.atlasWidth; atlas.height=next.atlasHeight;
        ctx.font=`${next.fontSize*ratio}px "JetBrains Mono", monospace`; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillStyle='#fff';
        next.glyphs.forEach((char,index)=>ctx.fillText(char,(index%next.atlasColumns)*next.tileWidth+next.padding+next.cellWidth*ratio*.5,Math.floor(index/next.atlasColumns)*next.tileHeight+next.padding+next.cellHeight*ratio*.5));
      }
      plan=next;
      if(frame) {
        packed=packGlyphFrame(frame,plan.indices,settings,packed,true);

      }
      else {
        // Canvas-only integrations (including camera) have no AsciiFrame to pass.
        // Sample once per source update, never during a cursor-only redraw.
        sampler.width=cols; sampler.height=rows; sampleCtx.drawImage(source,0,0,cols,rows);
        const data=sampleCtx.getImageData(0,0,cols,rows).data;
        packed={cols,rows,indices:new Uint8Array(cols*rows*4),colors:new Uint8ClampedArray(data)};
        for(let i=0;i<data.length;i+=4) {
          const light=Math.min(1,(data[i]*.299+data[i+1]*.587+data[i+2]*.114)/255*(data[i+3]/255)*3);
          packed.indices[i+2]=Math.round(light*255);
          packed.indices[i]=Math.min(plan.glyphs.length-1,Math.floor(light*plan.glyphs.length));
        }
      }
      return {plan,packed,atlas,dots:settings.renderMode==='dots',dotSize:settings.dotSizeRatio ?? .72};
    },
    reset() { plan=null; },
    destroy() { atlas.width=atlas.height=sampler.width=sampler.height=1; packed=undefined; plan=null; },
  };
}
