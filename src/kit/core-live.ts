import { mountGlyphField, type FieldSource, type GlyphField, type GlyphFieldOptions } from '../field';

/** The page-wide look `setGlobalLook` lays over every glyph field. */
export interface GlobalLook {
  /** Characters for every glyph field that keeps none of letters of its own. Empty keeps each field's own. */
  charset?: string;
}

/** The kit options the shared core reads. */
export interface LiveOptions {
  lazy?: boolean;
  poster?: string;
  globalLook?: boolean;
  reducedMotion?: boolean;
}

/** What the engine draws when a look names no charset, so clearing the global look puts it back. */
const ENGINE_CHARSET = ' .,:-=+*#%@';
const LETTER = /\p{L}/u;

/* ---------------- Global look ---------------- */

let look: GlobalLook | null = null;
const lookListeners = new Set<(look: GlobalLook | null) => void>();
const fields = new Set<{ relook(): void }>();

/** Re-skins every glyph field on the page at once; `null` gives each field its own characters back. */
export function setGlobalLook(next: GlobalLook | null) {
  look = next ? { ...next } : null;
  for (const field of fields) field.relook();
  for (const listener of [...lookListeners]) listener(look);
}
export const getGlobalLook = () => look;
/** Calls `listener` after each `setGlobalLook`. Returns the unsubscribe. */
export function subscribeGlobalLook(listener: (look: GlobalLook | null) => void) {
  lookListeners.add(listener);
  return () => { lookListeners.delete(listener); };
}

/* ---------------- Context budget and lazy mounting ---------------- */

interface Slot {
  host: HTMLElement;
  doc: Document;
  /** `lazy: false`: wanted wherever it is, and mounted at once. */
  eager: boolean;
  wanted: boolean;
  live: boolean;
  mount(): void;
  release(): void;
}

// A field mounts within half a viewport of the screen and is released beyond one, so scrolling back and forth never thrashes.
const MOUNT = 0.5, RELEASE = 1, DEFAULT_BUDGET = 12;
// Mounting costs a few milliseconds (a context, an atlas, shader compiles). Past this much in one frame, the rest wait for the next.
const FRAME_MS = 4;

let budget = DEFAULT_BUDGET;
const slots = new Set<Slot>();
let watch: { ctor: unknown; list: IntersectionObserver[] } | null = null;
let doc: Document | null = null, frame = 0, windowAt = -1e9, spent = 0, pumping = false, again = false;

/**
 * At most `n` kit fields hold a WebGL context at once (default 12; browsers drop the oldest past about 16).
 * Past it the live field farthest off screen is released first, and shows its poster until it is the nearer one again.
 */
export function setFieldBudget(n: number) {
  budget = Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_BUDGET;
  pump();
}
export const getFieldBudget = () => budget;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const viewport = () => (typeof innerHeight === 'number' ? innerHeight : 0);
/** CSS px between the element and the viewport, vertically; 0 when on screen, Infinity when detached. */
function offscreen(host: HTMLElement, box: { top: number; bottom: number } = host.getBoundingClientRect()) {
  if (host.isConnected === false) return Infinity;
  // `display: none` (a hidden tab, a collapsed breakpoint) reports a zero box at the origin, which would read as on screen.
  if (typeof host.getClientRects === 'function' && host.getClientRects().length === 0) return Infinity;
  const d = box.bottom < 0 ? -box.bottom : box.top - viewport();
  return d > 0 ? d : 0;
}
function judge(slot: Slot, box?: { top: number; bottom: number }) {
  if (slot.eager) { slot.wanted = true; return; }
  const vh = viewport(), d = offscreen(slot.host, box);
  if (!vh || d <= vh * MOUNT) slot.wanted = true;
  else if (d > vh * RELEASE) slot.wanted = false;
}

function onEntries(entries: IntersectionObserverEntry[]) {
  let seen = false;
  for (const entry of entries) {
    if (!entry?.target) continue;
    for (const slot of slots) if (slot.host === entry.target) { judge(slot, entry.boundingClientRect ?? undefined); seen = true; }
  }
  if (seen) pump();
}
/** Three shared observers for every kit field: the mount margin, the release margin, and the screen itself, which brings a waiting field back. */
function observers() {
  const IO = typeof IntersectionObserver === 'function' ? IntersectionObserver : null;
  if (!IO) return null;
  if (watch?.ctor !== IO) {
    watch?.list.forEach(o => o.disconnect());
    watch = { ctor: IO, list: ['50% 0px', '100% 0px', '0px'].map(rootMargin => new IO(onEntries, { rootMargin })) };
    for (const slot of slots) watch.list.forEach(o => o.observe(slot.host));
  }
  return watch.list;
}

function claim(slot: Slot) {
  // A field from another document (a test, a replaced iframe) no longer shares this page's contexts.
  if (doc !== slot.doc) { doc = slot.doc; slots.clear(); frame = spent = 0; }
  slots.add(slot);
  const list = observers();
  list?.forEach(o => o.observe(slot.host));
  if (!list) slot.wanted = true; else judge(slot);
  pump();
}
function unclaim(slot: Slot) {
  if (!slots.delete(slot)) return;
  if (![...slots].some(other => other.host === slot.host)) watch?.list.forEach(o => o.unobserve(slot.host));
  if (!slots.size && watch) { watch.list.forEach(o => o.disconnect()); watch = null; }
  pump();
}

/** Releases what is no longer wanted, then mounts the nearest waiting fields within the context budget and the frame's time. */
function pump(fromFrame = false) {
  if (pumping) { again = true; return; }
  pumping = true;
  try {
    do {
      again = false;
      const t = now();
      if (fromFrame || t - windowAt > 16 || t < windowAt) { windowAt = t; spent = 0; }
      for (const slot of slots) if (slot.live && !slot.wanted) slot.release();
      const live = [...slots].filter(s => s.live);
      const far = () => live.filter(s => s.live).map(s => [s, offscreen(s.host) + (s.eager ? 0 : 1e9)] as const).sort((a, b) => b[1] - a[1]);
      // A lower budget releases the farthest at once.
      for (let over = live.length - budget, order = over > 0 ? far() : []; over > 0; over--) order.shift()?.[0].release();
      const waiting = [...slots].filter(s => s.wanted && !s.live).map(s => [s, s.eager ? -1 : offscreen(s.host)] as const).sort((a, b) => a[1] - b[1]);
      let mounted = 0;
      for (const [slot, d] of waiting) {
        if (!slots.has(slot) || slot.live) continue;
        if (!slot.eager && spent >= FRAME_MS && !(fromFrame && !mounted)) { frame ||= requestAnimationFrame(() => { frame = 0; pump(true); }); break; }
        if (live.filter(s => s.live).length >= budget) {
          const victim = far()[0]?.[0];
          // The rest are farther still, so they wait too. Only another `lazy: false` field displaces one.
          if (!victim || (!slot.eager && (victim.eager || offscreen(victim.host) <= d))) break;
          victim.release();
        }
        const start = now();
        slot.mount();
        spent += now() - start;
        mounted++;
        if (slot.live) live.push(slot);
      }
    } while (again);
  } finally {
    pumping = false;
  }
}

/* ---------------- One field that can be released and mounted again ---------------- */

export interface LiveConfig {
  host: HTMLElement;
  /** The first canvas, styled and placed. A remount puts a copy of it in its place. */
  canvas: HTMLCanvasElement;
  kit?: { current: LiveOptions };
  /** The full options a mount starts from, without `source` and `onError`. */
  options: () => GlyphFieldOptions;
  source?: FieldSource | null;
  /** CSS placing the poster exactly where the canvas lies. */
  place: string;
  /** The component draws a poster of its own. */
  ownPoster?: boolean;
  onMount?: (field: GlyphField, canvas: HTMLCanvasElement) => void;
  onRelease?: () => void;
  /** The field failed: the live field has already removed its canvas. Not called when the first mount fails inside `start()`. */
  onFail: () => void;
}

export interface Live {
  /** The same object across release and remount: calls while released are kept (`update`, `setSource`, `play`, `pause`) or dropped. */
  readonly field: GlyphField;
  readonly canvas: HTMLCanvasElement;
  readonly live: boolean;
  readonly failed: boolean;
  /** Joins the budget; mounts now when near and the frame has time. */
  start(): void;
  destroy(): void;
}

const leftovers = new WeakMap<object, () => void>();
const posters = new WeakMap<object, HTMLImageElement>();
/** Points a kit's poster at a new still, such as the other theme's, without remounting. */
export function setPosterSource(kit: object, src: string) { const img = posters.get(kit); if (img && img.getAttribute('src') !== src) img.src = src; }
/** Removes what outlived a failed or unsupported field (its poster), once the handle is destroyed. */
export function disposeKit(kit: object) { leftovers.get(kit)?.(); leftovers.delete(kit); }

const quiet = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** A still under the field: shown until the first frame, while released, and in place of the field without WebGL. */
export function poster(host: HTMLElement, src: string, place: string, kit: object, before?: Element | null) {
  const img = document.createElement('img');
  img.alt = '';
  img.decoding = 'async';
  img.setAttribute('aria-hidden', 'true');
  img.setAttribute('style', `${place};object-fit:cover${quiet() ? '' : ';transition:opacity 280ms cubic-bezier(.23, 1, .32, 1)'}`);
  img.style.opacity = '1';
  img.dataset.asciiPoster = '';
  img.src = src;
  const saved = host.style.getPropertyValue('position');
  const positioned = typeof getComputedStyle === 'function' && getComputedStyle(host).position === 'static';
  if (positioned) host.style.setProperty('position', 'relative');
  // A poster laid under the content (z-index -1) needs the host's own stacking context, as the field has, or the page's
  // backgrounds cover it; without WebGL nothing else gives it one.
  const savedIsolation = host.style.getPropertyValue('isolation');
  const isolated = /z-index:\s*-1/.test(place) && typeof getComputedStyle === 'function' && getComputedStyle(host).isolation === 'auto';
  if (isolated) host.style.setProperty('isolation', 'isolate');
  if (before?.parentElement === host) host.insertBefore(img, before); else host.appendChild(img);
  const remove = () => {
    img.remove();
    if (positioned) { if (saved) host.style.setProperty('position', saved); else host.style.removeProperty('position'); }
    if (isolated) { if (savedIsolation) host.style.setProperty('isolation', savedIsolation); else host.style.removeProperty('isolation'); }
  };
  leftovers.set(kit, remove);
  posters.set(kit, img);
  return { show(on: boolean) { img.style.opacity = on ? '1' : '0'; }, remove: () => disposeKit(kit) };
}

const SWEEP_EASE = 'cubic-bezier(.23,1,.32,1)';
/**
 * The global-look sweep: the frame before a charset change holds over the field and is wiped away left to right, led by a thin
 * scan line, as the new characters land under it (200ms after a 40ms beat). The line is `--ascii-sweep` (default amber).
 */
function sweep(canvas: HTMLCanvasElement, place: string) {
  if (!canvas.width || !canvas.height || typeof document === 'undefined') return null;
  const layer = document.createElement('canvas');
  layer.width = canvas.width;
  layer.height = canvas.height;
  const pen = layer.getContext('2d');
  if (!pen || typeof layer.animate !== 'function') return null;
  try { pen.drawImage(canvas, 0, 0); } catch { return null; }
  layer.setAttribute('aria-hidden', 'true');
  layer.dataset.asciiSweep = '';
  layer.setAttribute('style', place);
  const scan = document.createElement('span');
  scan.setAttribute('aria-hidden', 'true');
  scan.dataset.asciiSweep = '';
  scan.setAttribute('style', `${place};right:auto;width:2px;margin-left:-1px;opacity:0;background:var(--ascii-sweep, #f3ba32);box-shadow:0 0 10px 1px color-mix(in srgb, var(--ascii-sweep, #f3ba32) 40%, transparent)`);
  canvas.after(layer, scan);
  let wipe: Animation | undefined, line: Animation | undefined;
  const clear = () => { wipe?.cancel(); line?.cancel(); layer.remove(); scan.remove(); };
  return {
    clear,
    reveal() {
      if (!layer.isConnected) return;
      const timing = { duration: 200, delay: 40, easing: SWEEP_EASE, fill: 'both' as FillMode };
      wipe = layer.animate([{ clipPath: 'inset(0% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 100%)' }], timing);
      // The line rides the clip edge on the same clock and curve, fading over the last 60ms.
      const width = canvas.clientWidth || canvas.getBoundingClientRect().width;
      line = scan.animate([
        { transform: 'translateX(0px)', opacity: 0.35 },
        { opacity: 0.35, offset: 0.7 },
        { transform: `translateX(${width}px)`, opacity: 0 },
      ], timing);
      wipe.onfinish = clear;
    },
  };
}

function freshCanvas(old: HTMLCanvasElement) {
  const next = document.createElement('canvas');
  for (const name of old.getAttributeNames?.() ?? []) if (name !== 'width' && name !== 'height') next.setAttribute(name, old.getAttribute(name)!);
  next.style.cssText = old.style.cssText;
  Object.assign(next.dataset, old.dataset);
  if (old.replaceWith) old.replaceWith(next);
  else if (old.parentElement) { old.parentElement.insertBefore(next, old); old.remove(); }
  return next;
}
// Browsers keep about 16 WebGL contexts; give this one back now rather than when the canvas is collected.
const loseContext = (canvas: HTMLCanvasElement) => {
  try { (canvas.getContext('webgl2') as WebGL2RenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* already gone */ }
};

export function liveField(config: LiveConfig): Live {
  const { host, kit } = config;
  let canvas = config.canvas, real: GlyphField | null = null, used = false, destroyed = false, failed = false, starting = false;
  let recorded: GlyphFieldOptions = {}, merged: GlyphFieldOptions = {}, source = config.source, paused = false, shown: string | undefined;
  let settings = {} as GlyphField['settings'];
  let resolveReady: (() => void) | null = null, nextReady: Promise<void> | null = null;
  let shownReady = false, wiping: ReturnType<typeof sweep> = null;
  const still = !config.ownPoster && kit?.current.poster ? poster(host, kit.current.poster, config.place, kit, canvas) : null;

  /** The global charset applies to glyph fields that opted in and whose own characters are not letters (a word or a brand). */
  const charsetPatch = (): GlyphFieldOptions | null => {
    const own = merged.charset;
    const want = kit?.current.globalLook !== false && (merged.mark ?? 'glyph') === 'glyph' && !LETTER.test(own ?? '') && look?.charset ? look.charset : undefined;
    if (want) { if (want === shown) return null; shown = want; return { charset: want }; }
    if (shown === undefined) return null;
    shown = undefined;
    return { charset: own ?? ENGINE_CHARSET };
  };

  const slot: Slot = {
    host, doc: document, eager: kit?.current.lazy === false, wanted: false, live: false,
    mount() {
      if (destroyed || real) return;
      if (used) canvas = freshCanvas(canvas);
      used = true;
      merged = { ...config.options(), ...recorded };
      shown = undefined;
      const patch = charsetPatch();
      let field: GlyphField;
      try {
        field = mountGlyphField(canvas, {
          ...merged, ...patch, ...(source === undefined ? {} : { source }),
          onError: () => { if (real === field) fail(); },
        });
      } catch {
        fail();
        return;
      }
      real = field;
      slot.live = true;
      if (paused) field.pause();
      void field.ready.then(() => {
        if (real !== field) return;
        shownReady = true;
        still?.show(false);
        resolveReady?.();
        resolveReady = nextReady = null;
      }, () => {});
      config.onMount?.(field, canvas);
    },
    release() {
      if (!real) return;
      const field = real;
      real = null;
      slot.live = false;
      shownReady = false;
      wiping?.clear();
      wiping = null;
      settings = field.settings;
      field.destroy();
      loseContext(canvas);
      still?.show(true);
      config.onRelease?.();
    },
  };

  function fail() {
    if (failed) return;
    failed = true;
    teardown();
    if (!starting) config.onFail();
  }
  function teardown() {
    if (destroyed) return;
    destroyed = true;
    slot.release();
    unclaim(slot);
    fields.delete(record);
    canvas.remove();
    // A poster outlives a failed field: it is the fallback until the handle goes.
    if (failed) still?.show(true); else still?.remove();
  }
  const record = {
    relook() {
      const patch = charsetPatch();
      if (!patch || !real) return;
      const field = real;
      // A field still on its poster, or under reduced motion, takes the new characters at once.
      const animate = shownReady && !(kit?.current.reducedMotion ?? quiet());
      wiping?.clear();
      wiping = null;
      if (animate) { field.redraw(); wiping = sweep(canvas, config.place); }
      field.update(patch);
      const owned = wiping;
      if (owned) requestAnimationFrame(() => requestAnimationFrame(() => { if (wiping === owned && real === field) owned.reveal(); else owned.clear(); }));
    },
  };

  const field: GlyphField = {
    get canvas() { return canvas; },
    get ready() {
      if (real) return real.ready;
      return (nextReady ??= new Promise<void>(resolve => { resolveReady = resolve; }));
    },
    get settings() { return real?.settings ?? settings; },
    update(options) {
      recorded = { ...recorded, ...options };
      merged = { ...merged, ...options };
      if (!real) return;
      const patch = charsetPatch();
      real.update(shown !== undefined ? { ...options, charset: shown } : patch ? { ...options, ...patch } : options);
    },
    setSource(next) { source = next; return real ? real.setSource(next) : Promise.resolve(); },
    pointer(x, y) { real?.pointer(x, y); },
    redraw() { real?.redraw(); },
    pulse(options) { real?.pulse(options); },
    play() { paused = false; real?.play(); },
    pause() { paused = true; real?.pause(); },
    resize() { real?.resize(); },
    destroy() { teardown(); },
  };

  return {
    field,
    get canvas() { return canvas; },
    get live() { return !!real; },
    get failed() { return failed; },
    start() {
      fields.add(record);
      starting = true;
      try { claim(slot); } finally { starting = false; }
    },
    destroy: teardown,
  };
}
