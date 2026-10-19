/** Messages between a mounted Studio and its render worker. */
export type WorkerRequest =
  | { type: "init"; settings: unknown; limits: { maxDimension?: number; maxCells?: number }; pixelRatio?: number; budget?: number }
  /** The cropped source at the frame's size, and the source's own size. */
  | { type: "source"; scene: ImageBitmap; width: number; height: number; video: boolean; time: number; key: number }
  | { type: "pointer"; x: number; y: number; time: number }
  | { type: "leave" }
  | { type: "configure"; settings: unknown }
  | { type: "budget"; cells: number }
  | { type: "ratio"; ratio: number }
  | { type: "invalidate" }
  /** Draw frame `seq`; or, with "advance", go through it without drawing (another worker draws it). */
  | { type: "render" | "advance"; seq: number; time: number; width: number; height: number; motionTime: number };
export type WorkerReply =
  | { type: "ready" }
  | { type: "frame"; seq: number; bitmap: ImageBitmap; cost: number; active: boolean; finish: "gpu" | "unavailable" | "none" }
  | { type: "skip"; seq: number }
  | { type: "error"; seq: number; message: string };
