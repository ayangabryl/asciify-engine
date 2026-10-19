import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createWorkerStudioRenderer } from './worker-renderer';
vi.mock('./worker-source', () => ({ default: 'self.onmessage = null;' }));
import type { WorkerReply, WorkerRequest } from './worker-protocol';

class FakeWorker {
  static all: FakeWorker[] = [];
  received: WorkerRequest[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<WorkerReply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  constructor() { FakeWorker.all.push(this); }
  postMessage(message: WorkerRequest) { this.received.push(message); }
  terminate() { this.terminated = true; }
  reply(message: WorkerReply) { this.onmessage?.({ data: message } as MessageEvent<WorkerReply>); }
  renders() { return this.received.filter(m => m.type === 'render').map(m => (m as { seq: number }).seq); }
  advances() { return this.received.filter(m => m.type === 'advance').map(m => (m as { seq: number }).seq); }
}
const bitmap = (name: string) => ({ width: 40, height: 30, name, close: vi.fn() }) as unknown as ImageBitmap;
let shown: unknown[];
function fixture(width = 40, height = 30, maxDimension = 960) {
  shown = [];
  const context = { transferFromImageBitmap: (b: unknown) => shown.push(b) };
  const canvas = { width: 0, height: 0, dataset: {} as Record<string, string>, getContext: (type: string) => type === 'bitmaprenderer' ? context : null } as unknown as HTMLCanvasElement;
  const frames: [number, number][] = [];
  const on = { frame: (time: number, cost: number) => frames.push([time, cost]), ready: vi.fn(), unavailable: vi.fn(), error: vi.fn() };
  const renderer = createWorkerStudioRenderer(canvas, {}, { maxDimension, maxCells: 12000 }, on, { width, height });
  return { canvas, frames, on, renderer, source: { width: 400, height: 300 } as unknown as HTMLCanvasElement };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
beforeEach(() => {
  FakeWorker.all = [];
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
  vi.stubGlobal('HTMLImageElement', class {});
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({ clearRect() {}, save() {}, restore() {}, translate() {}, rotate() {}, drawImage() {} }) }) });
  vi.stubGlobal('createImageBitmap', async () => bitmap('scene'));
});
afterEach(() => vi.unstubAllGlobals());

it('has two workers take turns on a small frame, each moving through the frames the other draws', async () => {
  const { renderer, source } = fixture();
  expect(renderer.turns).toBe(2);
  await settle();
  const [a, b] = FakeWorker.all;
  for (let i = 0; i < 4; i++) { renderer.pointer(.5, .5, i); expect(renderer.render(source, i / 60, 40, 30, 0, { video: false, time: 0 })).toBe(true); await settle(); }
  expect(renderer.busy).toBe(true);
  expect(renderer.render(source, 1, 40, 30, 0, { video: false, time: 0 })).toBe(false);
  expect(a.renders()).toEqual([2, 4]);
  expect(a.advances()).toEqual([1, 3]);
  expect(b.renders()).toEqual([1, 3]);
  expect(b.advances()).toEqual([2, 4]);
  // Both received the same input, in the same order relative to the frames.
  const order = (w: FakeWorker) => w.received.filter(m => m.type !== 'source').map(m => m.type === 'pointer' ? 'p' : m.type === 'init' ? 'i' : 'f');
  expect(order(a)).toEqual(order(b));
  expect(a.received.filter(m => m.type === 'source')).toHaveLength(1);
  renderer.destroy();
  expect(FakeWorker.all.every(w => w.terminated)).toBe(true);
});

it('shows finished frames in order, one per display frame, and drops the oldest when more than two wait', async () => {
  const { renderer, source, frames, on } = fixture();
  await settle();
  const [a, b] = FakeWorker.all;
  for (let i = 0; i < 4; i++) { renderer.render(source, i, 40, 30, 0, { video: false, time: 0 }); await settle(); }
  const one = bitmap('1'), two = bitmap('2'), three = bitmap('3'), four = bitmap('4');
  a.reply({ type: 'frame', seq: 2, bitmap: two, cost: 4, active: true, finish: 'none' });
  // Frame 2 waits for frame 1.
  expect(on.ready).not.toHaveBeenCalled();
  expect(renderer.show()).toBe(false);
  b.reply({ type: 'frame', seq: 1, bitmap: one, cost: 5, active: true, finish: 'none' });
  expect(on.ready).toHaveBeenCalledTimes(1);
  expect(renderer.show()).toBe(true);
  expect(shown).toEqual([one]);
  b.reply({ type: 'frame', seq: 3, bitmap: three, cost: 6, active: true, finish: 'none' });
  a.reply({ type: 'frame', seq: 4, bitmap: four, cost: 6, active: false, finish: 'gpu' });
  // Frames 2, 3 and 4 wait: 2 is dropped, then 3 and 4 show on the next two display frames.
  expect((two as unknown as { close: () => void }).close).toHaveBeenCalled();
  expect(renderer.active).toBe(true);
  renderer.show(); renderer.show();
  expect(shown).toEqual([one, three, four]);
  expect(frames).toEqual([[0, 5], [2, 6], [3, 6]]);
  expect(renderer.active).toBe(false);
  expect(renderer.capabilities.gpuFinish).toBe(true);
  renderer.destroy();
});

it('uses one worker for a big frame, and reports a worker that fails before its first frame', async () => {
  const { renderer, on } = fixture(2560, 1600, 2560);
  expect(renderer.turns).toBe(1);
  await settle();
  FakeWorker.all[0].onerror?.({ message: 'blocked', preventDefault() {} } as ErrorEvent);
  expect(on.unavailable).toHaveBeenCalledTimes(1);
  expect(FakeWorker.all[0].terminated).toBe(true);
});

it('adds a third worker when the first frame is slow, replaying everything so far as frames it does not draw', async () => {
  const { renderer, source } = fixture();
  await settle();
  const [a, b] = FakeWorker.all;
  renderer.pointer(.2, .3, 1);
  renderer.render(source, 0, 40, 30, 0, { video: false, time: 0 }); await settle();
  renderer.leave();
  renderer.render(source, .1, 40, 30, 0, { video: false, time: 0 }); await settle();
  b.reply({ type: 'frame', seq: 1, bitmap: bitmap('1'), cost: 30, active: true, finish: 'none' });
  a.reply({ type: 'frame', seq: 2, bitmap: bitmap('2'), cost: 18, active: true, finish: 'none' });
  expect(renderer.turns).toBe(2);
  renderer.render(source, .15, 40, 30, 0, { video: false, time: 0 }); await settle();
  b.reply({ type: 'frame', seq: 3, bitmap: bitmap('3'), cost: 17, active: true, finish: 'none' });
  // The median of the first three frames needs three workers.
  expect(renderer.turns).toBe(3);
  const c = FakeWorker.all[2];
  expect(c.received.map(m => m.type)).toEqual(['init', 'pointer', 'source', 'advance', 'leave', 'advance', 'advance']);
  expect(c.renders()).toEqual([]);
  renderer.render(source, .2, 40, 30, 0, { video: false, time: 0 }); await settle();
  renderer.render(source, .25, 40, 30, 0, { video: false, time: 0 }); await settle();
  expect(c.renders()).toEqual([5]);
  // From now on frame n is drawn by worker n mod 3; the others go through it.
  expect(a.renders()).toEqual([2]);
  expect(b.renders()).toEqual([1, 3, 4]);
  expect(c.advances()).toEqual([1, 2, 3, 4]);
  renderer.destroy();
  expect(FakeWorker.all.every(w => w.terminated)).toBe(true);
});

it('stops extra workers when the frame grows past the memory bound', async () => {
  const { renderer, source } = fixture(400, 300, 2560);
  await settle();
  expect(renderer.turns).toBe(2);
  renderer.render(source, 0, 2560, 1600, 0, { video: false, time: 0 }); await settle();
  expect(renderer.turns).toBe(1);
  expect(FakeWorker.all[1].terminated).toBe(true);
  expect(FakeWorker.all[0].renders()).toEqual([1]);
  renderer.destroy();
});
