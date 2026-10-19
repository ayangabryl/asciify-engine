import { drawStudioScene, studioFit, studioMaxDimension, studioSourceSize, type StudioSource } from "./renderer";
import { normalizeStudioSettings } from "./model";
import type { WorkerReply, WorkerRequest } from "./worker-protocol";

let script: Promise<string | null> | null = null;
/**
 * The worker's script, a separate chunk fetched on the first mount (in parallel with its media), as a Blob URL: hosts need
 * no worker file or bundler plugin, and pages that never mount a Studio never download it.
 */
export const loadStudioWorker = () => script ??= import("./worker-source")
  .then(({ default: source }) => source ? URL.createObjectURL(new Blob([source], { type: "text/javascript" })) : null, () => null);
let supported: boolean | null = null;
/** OffscreenCanvas 2D and ImageBitmap transfer: otherwise the Studio draws on the page. */
export function studioWorkerSupported() {
  if (supported !== null) return supported;
  try {
    supported = typeof Worker === "function" && typeof OffscreenCanvas === "function" &&
      typeof createImageBitmap === "function" && "transferToImageBitmap" in OffscreenCanvas.prototype &&
      !!new OffscreenCanvas(1, 1).getContext("2d");
  } catch { supported = false; }
  return supported;
}

interface Callbacks {
  /** A frame reached the canvas. */
  frame(time: number, cost: number): void;
  /** A finished frame is waiting: call show() on the next display frame. */
  ready(): void;
  /** The worker could not start or failed before its first frame: draw on the page instead. */
  unavailable(): void;
  error(error: Error): void;
}
/**
 * Workers take turns drawing a frame, as many as its first frames' cost needs for the display's rate, within a memory
 * bound: their frames together hold at most this many pixels (three for a /looks card, two for a dialog, one for the editor).
 */
const LANE_PIXELS = 6_000_000;
/** Drawing time a worker can spend on its turn, in ms: one 120 Hz frame, less the round trip. */
const TURN_BUDGET = 7;
const decodedImages = new WeakSet<HTMLImageElement>();
/** One worker. It starts once the script has loaded; what is sent before then waits, in order. */
interface Lane { worker: Worker | null; waiting: [WorkerRequest, Transferable[]][]; post(message: WorkerRequest, transfer?: Transferable[]): void }
interface Pending { seq: number; time: number; input: boolean; lane: Lane; reply?: Extract<WorkerReply, { type: "frame" }> | null }
/**
 * The Studio renderer's interface, drawn in workers. Input is posted as it happens. Workers take turns: every worker
 * applies every input and goes through every frame, so all hold the same hover state, and each draws one frame in two or
 * three. Frames return as ImageBitmaps, shown in order, one per display frame, on the page's canvas without a copy.
 */
export function createWorkerStudioRenderer(
  canvas: HTMLCanvasElement,
  settings: unknown,
  limits: { maxDimension?: number; maxCells?: number; pixelRatio?: number },
  on: Callbacks,
  expected: { width: number; height: number } = { width: 960, height: 540 },
) {
  let url: string | null = null;
  const maxDimension = studioMaxDimension(limits.maxDimension);
  const [fitWidth, fitHeight] = studioFit(maxDimension, Math.max(2, expected.width), Math.max(2, expected.height));
  const cores = navigator.hardwareConcurrency ?? 2;
  const fits = (pixels: number) => Math.max(1, Math.min(cores >= 8 ? 3 : cores >= 4 ? 2 : 1, Math.floor(LANE_PIXELS / pixels)));
  const most = fits(fitWidth * fitHeight);
  let pixels = fitWidth * fitHeight;
  const lanes: Lane[] = [];
  // Until the first frames show how long one takes (the first alone also prepares the source), everything sent is kept,
  // so a worker added then can catch up.
  const costs: number[] = [];
  let log: { message: WorkerRequest; spares?: ImageBitmap[] }[] | null = most > Math.min(2, most) ? [] : null;
  const limit = Math.max(256, Math.min(1048576, Number.isFinite(limits.maxCells) ? limits.maxCells! : 12000));
  let budget = limit, pixelRatio = Math.max(0.1, Math.min(8, limits.pixelRatio ?? 1));
  // Two frames in flight per worker: each starts its next as soon as one is drawn, instead of waiting a round trip.
  const depth = () => 2 * lanes.length;
  let disposed = false, presented = false, seq = 0, preparing: Promise<unknown> | null = null;
  let reported = false, input = false, finish: "gpu" | "unavailable" | "none" = "none";
  let crop = JSON.stringify(normalizeStudioSettings(settings).crop);
  // The scene is drawn here, where the source was decoded: a worker's own decode converts colour differently.
  let scene: HTMLCanvasElement | null = null, sceneContext: CanvasRenderingContext2D | null = null, sceneKey = "";
  let stale = true, keys = new WeakMap<object, number>(), nextKey = 0;
  let pending: Pending[] = [];
  let bitmapContext: ImageBitmapRenderingContext | null | undefined, context: CanvasRenderingContext2D | null = null;
  const post = (message: WorkerRequest) => {
    if (disposed) return;
    for (const lane of lanes) lane.post(message);
    log?.push({ message });
    // A mount that draws no frames for a long while keeps its workers as they are.
    if (log && log.length > 4096) { for (const { spares } of log) spares?.forEach(spare => spare.close()); log = null; }
  };
  const present = (bitmap: ImageBitmap) => {
    if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
    if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
    if (bitmapContext === undefined) {
      bitmapContext = canvas.getContext("bitmaprenderer");
      if (!bitmapContext) context = canvas.getContext("2d");
    }
    if (bitmapContext) bitmapContext.transferFromImageBitmap(bitmap);
    else {
      // A canvas that already carries a 2D context (an earlier page-drawn mount) shows the frame by copy.
      context?.clearRect(0, 0, canvas.width, canvas.height);
      context?.drawImage(bitmap, 0, 0);
      bitmap.close();
    }
    canvas.dataset.studioFinish = finish;
  };
  const fail = (message: string) => {
    if (!presented) { destroy(); on.unavailable(); }
    else on.error(new Error(message));
  };
  // Finished frames, in order, waiting for a display frame. Shown one per display frame, they reach the screen evenly
  // although workers finish them unevenly; more than two waiting are dropped, oldest first, to bound the delay.
  let ready: Pending[] = [];
  const flush = () => {
    let added = false;
    while (pending.length && pending[0].reply !== undefined) {
      const done = pending.shift()!;
      if (!done.reply) continue;
      ready.push(done);
      added = true;
    }
    while (ready.length > 2) ready.shift()!.reply!.bitmap.close();
    if (added) on.ready();
  };
  /** Shows the next finished frame, if any. Call once per display frame. */
  const show = () => {
    const next = ready.shift();
    if (!next?.reply) return false;
    reported = next.reply.active || ready.some(r => r.reply!.active);
    finish = next.reply.finish;
    present(next.reply.bitmap);
    presented = true;
    on.frame(next.time, next.reply.cost);
    return true;
  };
  const start = (lane: Lane) => {
    const worker = lane.worker = new Worker(url!);
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const m = event.data;
      if (disposed) { if (m.type === "frame") m.bitmap.close(); return; }
      if (m.type === "ready") return;
      if (m.type === "error") fail(m.message);
      const entry = pending.find(p => p.seq === m.seq);
      if (!entry) { if (m.type === "frame") m.bitmap.close(); return; }
      entry.reply = m.type === "frame" ? m : null;
      if (m.type === "frame" && log && costs.push(m.cost) >= 3) grow(costs.sort((x, y) => x - y)[1]);
      flush();
    };
    worker.onerror = (event) => { event.preventDefault?.(); fail(event.message || "The Studio worker failed."); };
    for (const [message, transfer] of lane.waiting) worker.postMessage(message, transfer);
    lane.waiting = [];
  };
  const addLane = () => {
    const lane: Lane = {
      worker: null, waiting: [],
      post(message, transfer = []) { if (lane.worker) lane.worker.postMessage(message, transfer); else lane.waiting.push([message, transfer]); },
    };
    lanes.push(lane);
    if (url) start(lane);
    return lane;
  };
  const init: WorkerRequest = { type: "init", settings, limits: { maxDimension: limits.maxDimension, maxCells: limits.maxCells }, pixelRatio, budget };
  for (let i = Math.min(2, most); i > 0; i--) addLane().post(init);
  void loadStudioWorker().then((loaded) => {
    if (disposed) return;
    if (!loaded) { fail("The Studio worker could not load."); return; }
    url = loaded;
    lanes.forEach(start);
  });
  /** After three frames: add the workers their cost needs, each replaying everything so far so it holds the same state. */
  function grow(cost: number) {
    const entries = log!;
    log = null;
    const want = Math.min(most, fits(pixels), Math.max(lanes.length, Math.ceil(cost / TURN_BUDGET)));
    const extra = want - lanes.length;
    for (let i = 0; i < extra; i++) {
      const lane = addLane();
      lane.post(init);
      for (const { message, spares } of entries) {
        if (message.type === "source") {
          const scene = spares![i];
          lane.post({ ...message, scene }, [scene]);
        } else lane.post(message.type === "render" ? { ...message, type: "advance" } : message);
      }
    }
    for (const { spares } of entries) spares?.slice(Math.max(0, extra)).forEach(spare => spare.close());
  }
  const keyOf = (value: StudioSource) => { let key = keys.get(value); if (key === undefined) keys.set(value, key = ++nextKey); return key; };
  function destroy() {
    if (disposed) return;
    disposed = true;
    for (const lane of lanes) lane.worker?.terminate();
    for (const { spares } of log ?? []) spares?.forEach(spare => spare.close());
    for (const lane of lanes) for (const [, transfer] of lane.waiting) for (const item of transfer) (item as ImageBitmap).close?.();
    log = null;
    for (const p of [...pending, ...ready]) p.reply?.bitmap.close();
    pending = [];
    ready = [];
    if (scene) scene.width = scene.height = 1;
    scene = sceneContext = null;
    keys = new WeakMap();
  }
  return {
    /** Workers drawing in turn. */
    get turns() { return lanes.length; },
    get busy() { return pending.length >= depth(); },
    get drawing() { return pending.length > 0 || ready.length > 0; },
    show,
    /** Requests a frame; false while the workers already have enough to draw. */
    render(source: StudioSource, time: number, width: number, height: number, motionTime: number, media: { video: boolean; time: number }) {
      if (disposed || pending.length >= depth()) return false;
      const [sw, sh] = studioSourceSize(source);
      if (!sw || !sh) return false;
      const [w, h] = studioFit(maxDimension, width, height);
      // A frame that grew (a resize) keeps the workers' frames within the memory bound: the extra workers stop.
      pixels = w * h;
      while (lanes.length > fits(pixels)) {
        const lane = lanes.pop()!;
        lane.worker?.terminate();
        for (const [, transfer] of lane.waiting) for (const item of transfer) (item as ImageBitmap).close?.();
        for (const entry of pending) if (entry.lane === lane && entry.reply === undefined) entry.reply = null;
        flush();
      }
      const frame = ++seq, drawer = lanes[frame % lanes.length];
      pending.push({ seq: frame, time, input, lane: drawer });
      input = false;
      const key = keyOf(source);
      // The drawing worker renders; the other moves through the same frame, so its hover state stays identical.
      const send = () => {
        if (disposed) return;
        for (const lane of lanes) lane.post({ type: lane === drawer ? "render" : "advance", seq: frame, time, width, height, motionTime });
        log?.push({ message: { type: "advance", seq: frame, time, width, height, motionTime } });
      };
      // A scene still on its way goes first.
      const request = () => { if (preparing) void preparing.then(send); else send(); };
      const next = [key, media.video ? media.time : 0, w, h, crop].join(":");
      if (!stale && next === sceneKey) { request(); return true; }
      stale = false;
      sceneKey = next;
      const draw = () => {
        if (disposed) throw new DOMException("Cancelled", "AbortError");
        if (!scene) { scene = document.createElement("canvas"); sceneContext = scene.getContext("2d"); }
        if (scene.width !== w) scene.width = w;
        if (scene.height !== h) scene.height = h;
        drawStudioScene(sceneContext!, source, w, h, JSON.parse(crop));
        // One scene per worker, and spares for workers that may join after the first frame.
        return Promise.all(Array.from({ length: lanes.length + (log ? most - lanes.length : 0) }, () => createImageBitmap(scene!)));
      };
      // A still is decoded off the main thread before its first draw; drawing it undecoded would decode it here.
      const decoded = source instanceof HTMLImageElement && !decodedImages.has(source)
        ? source.decode().catch(() => {}).then(() => { decodedImages.add(source); }) : null;
      const prepared = (preparing ?? Promise.resolve()).then(() => decoded ? decoded.then(draw) : draw()).then((bitmaps) => {
        if (disposed) { for (const bitmap of bitmaps) bitmap.close(); return; }
        const message = { type: "source", scene: bitmaps[0], width: sw, height: sh, video: media.video, time: media.time, key } satisfies WorkerRequest;
        lanes.forEach((lane, i) => lane.post({ ...message, scene: bitmaps[i] }, [bitmaps[i]]));
        if (log) log.push({ message, spares: bitmaps.slice(lanes.length) });
        else bitmaps.slice(lanes.length).forEach(spare => spare.close());
        send();
      }, (error) => {
        const entry = pending.find(p => p.seq === frame);
        if (entry) { entry.reply = null; flush(); }
        stale = true;
        if (!disposed) fail(error instanceof Error ? error.message : String(error));
      });
      preparing = prepared;
      void prepared.then(() => { if (preparing === prepared) preparing = null; });
      return true;
    },
    pointer(x: number, y: number, time: number) { input = true; post({ type: "pointer", x, y, time }); },
    leave() { input = true; post({ type: "leave" }); },
    configure(next: unknown) {
      crop = JSON.stringify(normalizeStudioSettings(next).crop);
      post({ type: "configure", settings: next });
    },
    setBudget(cells: number) {
      budget = Math.max(256, Math.min(limit, Number.isFinite(cells) ? Math.round(cells) : limit));
      post({ type: "budget", cells });
    },
    get maxCells() { return budget; },
    setPixelRatio(ratio: number) {
      pixelRatio = Math.max(0.1, Math.min(8, Number.isFinite(ratio) ? ratio : 1));
      post({ type: "ratio", ratio });
    },
    get pixelRatio() { return pixelRatio; },
    /** The hover field is moving, as of the last frame shown plus any input since. */
    get active() { return reported || input || pending.some(p => p.input) || ready.some(r => r.input || r.reply!.active); },
    get capabilities() { return { gpuFinish: finish !== "unavailable" }; },
    /** The source changed in place (an animated GIF's canvas): send it again with the next frame. */
    invalidate() { stale = true; post({ type: "invalidate" }); },
    destroy,
  };
}
export type WorkerStudioRenderer = ReturnType<typeof createWorkerStudioRenderer>;
