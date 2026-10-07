import { encodeStudioFrames } from "./encode";
import { normalizeStudioSettings, type StudioSettings } from "./model";
import { createStudioRenderer, type StudioSource } from "./renderer";
export type StudioExportFormat = "png" | "jpeg" | "mp4" | "webm" | "gif";
export interface StudioExportOptions {
  format: StudioExportFormat;
  width: number;
  height: number;
  duration?: number;
  /** Timeline position for a still image. Animations start at zero. */
  time?: number;
  /** For still exports, use the mounted preview's motionTime after speed edits. */
  motionTime?: number;
  fps?: number;
  quality?: number;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
  maxCells?: number;
  /** Preview canvas width, for identical cell density when upscaling. */
  referenceWidth?: number;
}
export interface StudioExportSource {
  frame(
    time: number,
    signal?: AbortSignal,
  ): StudioSource | Promise<StudioSource>;
}
/** A separate renderer preserves preview state. Video sources must also be independent. */
export async function exportStudio(source:StudioExportSource,settings:StudioSettings,options:StudioExportOptions):Promise<Blob> {
  let renderer:ReturnType<typeof createStudioRenderer>|undefined;
  const snapshot=normalizeStudioSettings(settings),animated=options.format!=="png"&&options.format!=="jpeg";
  try {
    return await encodeStudioFrames(async(canvas,time,width,height,signal,motionTime)=>{
      renderer??=createStudioRenderer(canvas,snapshot,{maxDimension:4096,maxCells:options.maxCells??12000,
        pixelRatio:width/(options.referenceWidth??Math.min(width,960))});
      if(animated)renderer.invalidate();
      renderer.render(await source.frame(time,signal),time,width,height,motionTime);
    },options);
  } finally {renderer?.destroy();}
}
