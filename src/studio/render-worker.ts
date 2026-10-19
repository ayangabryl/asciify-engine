// The Studio renderer in a dedicated worker: the page posts input and frame requests, the worker draws on OffscreenCanvas
// and returns each frame as an ImageBitmap. Built as a script string in its own chunk (see worker-source.ts, tsup.config.ts).
import { advanceStudioRenderer, createStudioRendererCore, type StudioRendererHost } from "./renderer";
import { createDotMarks } from "./dot-marks";
import type { WorkerRequest, WorkerReply } from "./worker-protocol";

const scope = self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void; onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null };
// Pixel parity with the page's renderer: a canvas asked for willReadFrequently is drawn in software here and resamples
// differently from the page's GPU canvases. Every scratch canvas starts at the HTML canvas default size and stays on the
// GPU; its few reads back per source frame cost less than drawing in software.
const canvas = () => new OffscreenCanvas(300, 150);
const surface = () => {
  const c = canvas();
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is unavailable.");
  return { canvas: c, ctx } as unknown as ReturnType<StudioRendererHost["surface"]>;
};
let renderer: ReturnType<typeof createStudioRendererCore> | null = null;
let output: OffscreenCanvas | null = null;
// The page draws the cropped source (its decoder's colour conversion is not the worker's) and sends that scene.
let scene: ImageBitmap | null = null;
let source: { width: number; height: number } | null = null;
let media = { video: false, time: 0, key: 0 as unknown };
let finish: "gpu" | "unavailable" | "none" = "none";
const post = (message: WorkerReply, transfer: Transferable[] = []) => scope.postMessage(message, transfer);
const host: StudioRendererHost = {
  surface,
  media: () => media,
  scene(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    if (scene) ctx.drawImage(scene as unknown as CanvasImageSource, 0, 0);
  },
  finishCanvas: () => canvas() as unknown as HTMLCanvasElement,
  marks: createDotMarks,
  finished(status) { finish = status; },
};

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const m = event.data;
  try {
    switch (m.type) {
      case "init":
        output = canvas();
        renderer = createStudioRendererCore(output as unknown as HTMLCanvasElement, m.settings, m.limits, host);
        if (m.pixelRatio !== undefined) renderer.setPixelRatio(m.pixelRatio);
        if (m.budget !== undefined) renderer.setBudget(m.budget);
        break;
      case "source":
        scene?.close();
        scene = m.scene;
        source = { width: m.width, height: m.height };
        media = { video: m.video, time: m.time, key: m.key };
        break;
      case "pointer": renderer?.pointer(m.x, m.y, m.time); break;
      case "leave": renderer?.leave(); break;
      case "configure": renderer?.configure(m.settings); break;
      case "budget": renderer?.setBudget(m.cells); break;
      case "ratio": renderer?.setPixelRatio(m.ratio); break;
      case "invalidate": renderer?.invalidate(); break;
      case "advance":
        if (renderer && source) advanceStudioRenderer(renderer, source as never, m.time, m.width, m.height, m.motionTime);
        break;
      case "render": {
        if (!renderer || !output || !source) { post({ type: "skip", seq: m.seq }); break; }
        const start = performance.now();
        renderer.render(source as never, m.time, m.width, m.height, m.motionTime);
        const cost = performance.now() - start;
        const bitmap = output.transferToImageBitmap();
        post({ type: "frame", seq: m.seq, bitmap, cost, active: renderer.active, finish }, [bitmap]);
        break;
      }
    }
  } catch (error) {
    post({ type: "error", seq: m.type === "render" || m.type === "advance" ? m.seq : -1, message: error instanceof Error ? error.message : String(error) });
  }
};
post({ type: "ready" });
