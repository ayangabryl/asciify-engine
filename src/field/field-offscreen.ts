/**
 * A glyph field drawn in a worker (`mountGlyphField(canvas, { worker: true })`): the canvas hands its drawing to an
 * OffscreenCanvas in a worker running the same engine (field-worker.ts), so uploading frames, matching characters, the
 * hover and every draw happen off the main thread. The page keeps only what a worker cannot see, and tells it: the canvas's
 * layout and visibility, the pointer, media preferences, the frames of a moving source (a video's as VideoFrames, a live
 * canvas's as bitmaps) and glyph atlases painted with the page's fonts.
 *
 * What a worker cannot do falls back to the page, decided at mount: custom effects, a clear zone that follows an element or
 * reads rects from a function, and an interaction target other than the window. Without OffscreenCanvas WebGL2, or if the
 * worker cannot start, the field mounts on the page as usual.
 */
import { normalizeFieldSettings, type GlyphFieldInput, type GlyphFieldSettings } from './field-model';
import { observeSize, observeView, watchMotionPreference, watchTheme, watchVisibility } from './field-gl';
import { measureGlyphShapes, mountGlyphField as mountHere, paintGlyphAtlas, type FieldSource, type GlyphField, type GlyphFieldOptions } from './glyph-field';

const VIDEO = /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i;
let script: Promise<string | null> | null = null;
const loadScript = () => script ??= import('./field-worker-source').then(({ default: source }) => source || null, () => null);

let supported: boolean | undefined;
/** Whether this page can draw a field in a worker: a canvas that hands its drawing over, and WebGL2 on an OffscreenCanvas. */
export function fieldWorkerSupported() {
  if (supported !== undefined) return supported;
  try {
    const probe = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1).getContext('webgl2') : null;
    supported = typeof Worker === 'function' && typeof HTMLCanvasElement === 'function' && 'transferControlToOffscreen' in HTMLCanvasElement.prototype
      && typeof createImageBitmap === 'function' && typeof URL.createObjectURL === 'function' && !!probe;
    (probe?.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
  } catch { supported = false; }
  return supported;
}

/** Options a worker can take: plain data, nothing that reads the page or calls back into it. */
export function fieldWorkerFits(options: GlyphFieldOptions) {
  const clear = options.clear as unknown;
  const element = typeof HTMLElement === 'function' && (clear instanceof HTMLElement || (!!clear && typeof clear === 'object' && (clear as { element?: unknown }).element instanceof HTMLElement));
  const rectsCall = !!clear && typeof clear === 'object' && typeof (clear as { rects?: unknown }).rects === 'function';
  const target = options.interactionTarget;
  return !options.effects?.length && !element && !rectsCall && (target == null || target === window);
}

/** The options the worker is sent: the plain settings, without the source, callbacks or page objects. */
const forWorker = (options: GlyphFieldOptions) => {
  const { source: _source, onError: _error, effects: _effects, interactionTarget: _target, worker: _worker, label: _label, ...rest } = options as GlyphFieldOptions & { worker?: boolean };
  return rest;
};

type Pending = { type: string; [key: string]: unknown };


/** Mounts the field in a worker, or returns null where it cannot (the caller mounts it on the page). */
export function mountFieldInWorker(canvas: HTMLCanvasElement, input: GlyphFieldOptions): GlyphField | null {
  if (!fieldWorkerSupported() || !fieldWorkerFits(input)) return null;
  let options: GlyphFieldOptions = { ...input };
  let settings: GlyphFieldSettings = normalizeFieldSettings(forWorker(options) as GlyphFieldInput);
  let worker: Worker | null = null, url = '', destroyed = false, started = false, fallback: GlyphField | null = null;
  const queue: { message: Pending; transfer: Transferable[] }[] = [];
  const send = (message: Pending, transfer: Transferable[] = []) => {
    if (fallback || destroyed) { for (const item of transfer) (item as { close?: () => void }).close?.(); return; }
    if (worker && started) worker.postMessage(message, transfer); else queue.push({ message, transfer });
  };
  let resolveReady!: () => void, rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  ready.catch(() => {});
  const report = (error: Error) => { if (options.onError) options.onError(error); else if (typeof console !== 'undefined') console.error(error); };

  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', options.label ?? 'ASCII artwork');
  canvas.dataset.renderer = 'glyph-field';

  // The canvas's place and size, its visibility, the page's and the pointer's state, all told to the worker.
  const box = (): [number, number, number, number] => { const rect = canvas.getBoundingClientRect(); return [canvas.clientWidth || rect.width, canvas.clientHeight || rect.height, rect.left, rect.top]; };
  let visible = true;
  const media = () => ({
    reducedMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    darkScheme: typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches,
  });
  let boxQueued = false;
  const sendBox = () => { if (boxQueued) return; boxQueued = true; requestAnimationFrame(() => { boxQueued = false; send({ type: 'box', box: box() }); }); };
  const unwatch: (() => void)[] = [
    observeSize(canvas, sendBox),
    observeView(canvas, '25% 0px', entry => { visible = entry.isIntersecting; send({ type: 'visible', value: visible }); }),
    watchVisibility(() => send({ type: 'hidden', value: document.hidden })),
    watchMotionPreference(() => send({ type: 'media', ...media() })),
    watchTheme(() => send({ type: 'media', ...media() })),
  ];
  const onScroll = () => sendBox();
  const onPointer = (event: PointerEvent) => send({ type: 'pointer', event: event.type, clientX: event.clientX, clientY: event.clientY, pointerType: event.pointerType, buttons: event.buttons });
  const onLeave = () => send({ type: 'pointer', event: 'pointerleave', clientX: 0, clientY: 0 });
  addEventListener('scroll', onScroll, { passive: true, capture: true });
  addEventListener('resize', onScroll, { passive: true });
  addEventListener('pointermove', onPointer, { passive: true, capture: true });
  addEventListener('pointerdown', onPointer, { passive: true, capture: true });
  document.addEventListener('pointerleave', onLeave);
  unwatch.push(() => {
    removeEventListener('scroll', onScroll, { capture: true });
    removeEventListener('resize', onScroll);
    removeEventListener('pointermove', onPointer, { capture: true });
    removeEventListener('pointerdown', onPointer, { capture: true });
    document.removeEventListener('pointerleave', onLeave);
  });

  // The source. A URL of an image the worker fetches itself; anything else the page holds is sent as frames: once for a
  // still, every frame for a video or a live canvas.
  let stream: (() => void) | null = null, sourceToken = 0, sentUrl: string | undefined;
  // One frame on its way at a time: the next is taken once the worker says it has drawn the last (or after half a second).
  let capturing = false, awaiting = false, awaitingSince = 0;
  const sendFrame = async (frame: ImageBitmap | VideoFrame | Promise<ImageBitmap>, streaming: boolean, token: number) => {
    const taken = await frame;
    if (token !== sourceToken || destroyed) { taken.close(); return; }
    if (streaming && started && !fallback) { awaiting = true; awaitingSince = performance.now(); }
    send({ type: 'frame', frame: taken, streaming }, [taken as Transferable]);
  };
  // A live canvas or a video, a frame at a time, never more than one on its way.
  const capture = (element: HTMLCanvasElement | HTMLVideoElement, token: number) => {
    if (capturing || token !== sourceToken) return;
    if (awaiting && performance.now() - awaitingSince < 500) return;
    if (element instanceof HTMLVideoElement && element.readyState < 2) return;
    capturing = true;
    let frame: ImageBitmap | VideoFrame | Promise<ImageBitmap>;
    try {
      frame = element instanceof HTMLVideoElement && typeof VideoFrame === 'function' ? new VideoFrame(element) : createImageBitmap(element);
    } catch { capturing = false; return; }
    void sendFrame(frame, true, token).finally(() => { capturing = false; });
  };
  const stopStream = () => { stream?.(); stream = null; };
  const streamCanvas = (element: HTMLCanvasElement, token: number) => {
    let raf = 0;
    const tick = () => { raf = requestAnimationFrame(tick); if (visible && !document.hidden) capture(element, token); };
    raf = requestAnimationFrame(tick);
    stream = () => cancelAnimationFrame(raf);
  };
  const streamVideo = (video: HTMLVideoElement, token: number) => {
    let id = 0, stopped = false;
    const each = () => { if (stopped) return; capture(video, token); schedule(); };
    const schedule = () => {
      if ('requestVideoFrameCallback' in video) id = (video as HTMLVideoElement & { requestVideoFrameCallback(fn: () => void): number }).requestVideoFrameCallback(each);
      else id = requestAnimationFrame(each);
    };
    schedule();
    stream = () => {
      stopped = true;
      if ('cancelVideoFrameCallback' in video) (video as HTMLVideoElement & { cancelVideoFrameCallback(id: number): void }).cancelVideoFrameCallback(id);
      else cancelAnimationFrame(id);
    };
  };
  let ownedVideo: HTMLVideoElement | null = null;
  const dropOwnedVideo = () => { if (ownedVideo) { ownedVideo.pause(); ownedVideo.removeAttribute('src'); ownedVideo.load(); ownedVideo = null; } };
  let liveCanvas: HTMLCanvasElement | null = null;
  const setSource = async (source: FieldSource | null): Promise<void> => {
    if (fallback) return fallback.setSource(source);
    const token = ++sourceToken;
    stopStream(); dropOwnedVideo(); liveCanvas = null;
    if (!source) { sentUrl = undefined; send({ type: 'url', url: null }); return; }
    if (typeof source === 'string' && !VIDEO.test(source)) {
      sentUrl = new URL(source, document.baseURI).href;
      send({ type: 'url', url: sentUrl });
      return;
    }
    sentUrl = undefined;
    if (typeof source === 'string') {
      const video = document.createElement('video');
      Object.assign(video, { crossOrigin: 'anonymous', muted: true, loop: true, playsInline: true, preload: 'auto' });
      await new Promise<void>((resolve, reject) => {
        video.addEventListener('loadeddata', () => resolve(), { once: true });
        video.addEventListener('error', () => reject(new Error('The glyph field could not load this video.')), { once: true });
        video.src = source;
      }).catch(error => { report(error); });
      if (token !== sourceToken) { video.removeAttribute('src'); video.load(); return; }
      ownedVideo = video;
      void video.play().catch(() => {});
      streamVideo(video, token);
      return;
    }
    if (source instanceof HTMLVideoElement) { streamVideo(source, token); return; }
    if (source instanceof HTMLCanvasElement) {
      if (options.live) { liveCanvas = source; streamCanvas(source, token); }
      else await sendFrame(createImageBitmap(source), false, token);
      return;
    }
    if (source instanceof HTMLImageElement) {
      try { await source.decode(); } catch { /* drawn as it is */ }
      await sendFrame(createImageBitmap(source), false, token);
      return;
    }
    await sendFrame(createImageBitmap(source as ImageBitmap), false, token);
  };

  // Atlases and glyph shapes the worker asks for, painted here with the page's fonts once they have loaded.
  const paintFor = async (message: { type: string; key: string; settings: GlyphFieldSettings; layout?: Parameters<typeof paintGlyphAtlas>[1] }) => {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    const s = message.settings;
    try { await fonts?.load(`${s.fontWeight} 16px ${s.font}`, s.charset); } catch { /* painted with what there is */ }
    if (destroyed || fallback) return;
    if (message.type === 'atlas' && message.layout) {
      const { image } = paintGlyphAtlas(s, message.layout, false);
      const bitmap = await createImageBitmap(image as HTMLCanvasElement);
      (image as HTMLCanvasElement).width = (image as HTMLCanvasElement).height = 1;
      send({ type: 'atlas', key: message.key, image: bitmap }, [bitmap]);
    } else {
      const data = measureGlyphShapes(s);
      send({ type: 'shapes', key: message.key, data }, [data.buffer]);
    }
  };

  const fallBack = () => {
    if (destroyed || fallback) return;
    for (const { transfer } of queue) for (const item of transfer) (item as { close?: () => void }).close?.();
    queue.length = 0;
    try {
      fallback = mountHere(canvas, { ...options, worker: false } as GlyphFieldOptions);
      fallback.ready.then(resolveReady, rejectReady);
    } catch (error) { rejectReady(error as Error); report(error as Error); }
  };

  void loadScript().then(source => {
    if (destroyed) return;
    if (!source) { fallBack(); return; }
    try { url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' })); worker = new Worker(url); } catch { fallBack(); return; }
    const own = worker;
    const timer = setTimeout(() => { if (!started) { own.terminate(); worker = null; fallBack(); } }, 10000);
    own.onerror = event => { event.preventDefault(); if (!started) { clearTimeout(timer); own.terminate(); worker = null; fallBack(); } else report(new Error('The glyph field worker stopped.')); };
    own.onmessage = ({ data }: MessageEvent<Pending>) => {
      if (data.type === 'loaded') {
        clearTimeout(timer);
        if (destroyed) return;
        // The canvas is handed over only now, with the worker running: until then the field could still mount here.
        let offscreen: OffscreenCanvas;
        try { offscreen = canvas.transferControlToOffscreen(); } catch { own.terminate(); worker = null; fallBack(); return; }
        started = true;
        own.postMessage({
          type: 'init', canvas: offscreen, options: forWorker(options), ratio: globalThis.devicePixelRatio || 1, box: box(),
          hidden: document.hidden, visible, ...media(), streaming: !!liveCanvas || !!stream, url: sentUrl,
        }, [offscreen]);
        for (const { message, transfer } of queue.splice(0)) own.postMessage(message, transfer);
      } else if (data.type === 'took') awaiting = false;
      else if (data.type === 'ready') resolveReady();
      else if (data.type === 'error') report(new Error(String(data.message)));
      else if (data.type === 'atlas' || data.type === 'shapes') void paintFor(data as never);
    };
  });

  if (options.source != null) void setSource(options.source);

  const call = (method: string, ...args: unknown[]) => {
    if (fallback) { (fallback as unknown as Record<string, (...a: unknown[]) => void>)[method](...args); return; }
    send({ type: 'call', method, args });
  };
  return {
    canvas,
    ready,
    get settings() { return fallback ? fallback.settings : settings; },
    update(next) {
      if (fallback) { fallback.update(next); return; }
      if (!fieldWorkerFits({ ...options, ...next })) report(new Error('This change needs the page (effects, an element clear zone or another interaction target); the field in a worker leaves it out.'));
      options = { ...options, ...next };
      settings = normalizeFieldSettings(forWorker(options) as GlyphFieldInput);
      const rest = forWorker(next);
      send({ type: 'update', options: rest });
      if ('source' in next) void setSource(next.source ?? null);
      else if ('live' in next && liveCanvas === null && options.live) void setSource(options.source ?? null);
    },
    setSource(source) { options = { ...options, source }; return setSource(source); },
    pointer(x, y) { call('pointer', x, y); },
    redraw() {
      // A live canvas is taken now, in the task that drew it (a WebGL canvas is readable only then).
      if (liveCanvas) { capturing = false; awaiting = false; capture(liveCanvas, sourceToken); }
      call('redraw');
    },
    pulse(options = {}) {
      const { element, ...rest } = options;
      if (element) {
        const box = element.getBoundingClientRect(), own = canvas.getBoundingClientRect();
        call('pulse', { ...rest, x: box.left + box.width / 2 - own.left, y: box.top + box.height / 2 - own.top });
      } else call('pulse', rest);
    },
    play() { call('play'); },
    pause() { call('pause'); },
    resize() { if (fallback) fallback.resize(); else send({ type: 'box', box: box() }); },
    destroy() {
      if (destroyed) return;
      if (fallback) fallback.destroy();
      send({ type: 'destroy' });
      destroyed = true;
      sourceToken++;
      stopStream(); dropOwnedVideo();
      unwatch.forEach(stop => stop());
      const own = worker;
      if (own) setTimeout(() => own.terminate(), 1000);
      if (url) URL.revokeObjectURL(url);
    },
  };
}
