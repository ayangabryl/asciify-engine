import { mountGlyphField, type FieldMark, type FieldSource, type GlyphField, type GlyphFieldOptions } from '../field';
import { currentFieldContext, isSharedFieldCanvas } from '../field/field-gl';
import { prewarmGlyphAtlas } from '../field/glyph-field';
import { CHARACTER_SETS, resolveCharset } from '../studio/characters';

/**
 * The Studio's 24 render styles as the glyph field draws them: the glyph-like styles are ramps, the halftone is the dot mark,
 * and the tile and print styles are field marks of the same name.
 */
export const KIT_STYLES = {
  ascii: { mark: 'glyph', charset: ' .:-=+*#%@' },
  blocks: { mark: 'glyph', charset: ' ░▒▓█' },
  braille: { mark: 'glyph', charset: ' ⠁⠃⠇⡇⣇⣧⣷⣿' },
  dots: { mark: 'dot' },
  lines: { mark: 'glyph', charset: ' -═╪╬' },
  cross: { mark: 'glyph', charset: ' ·+xX#' },
  diagonal: { mark: 'glyph', charset: ' /╱╳' },
  diamond: { mark: 'glyph', charset: ' ·◇◈◆' },
  mixed: { mark: 'glyph', charset: ' .:+/◇#@' },
  pixel: { mark: 'pixel' },
  mosaic: { mark: 'mosaic' },
  lego: { mark: 'lego' },
  voxel: { mark: 'voxel' },
  disco: { mark: 'disco' },
  dither: { mark: 'dither' },
  hex: { mark: 'hex' },
  led: { mark: 'led' },
  cmyk: { mark: 'cmyk' },
  stipple: { mark: 'stipple' },
  engraving: { mark: 'engraving' },
  crosshatch: { mark: 'crosshatch' },
  woodblock: { mark: 'woodblock' },
  risograph: { mark: 'risograph' },
  pointillism: { mark: 'pointillism' },
} as const satisfies Record<string, { mark: FieldMark; charset?: string }>;
export type KitStyle = keyof typeof KIT_STYLES;
const isKitStyle = (style: unknown): style is KitStyle => typeof style === 'string' && Object.prototype.hasOwnProperty.call(KIT_STYLES, style);

/** The page-wide look `setGlobalLook` lays over every glyph field. */
export interface GlobalLook {
  /** Characters for every glyph field that keeps none of letters of its own. Empty keeps each field's own. */
  charset?: string;
  /**
   * One of the Studio's render styles (`KIT_STYLES`): what every such field draws in each cell. A glyph-like style brings its
   * ramp, which `charset` overrides; a tile or print style changes the mark and keeps each field's own charset for its blanks.
   */
  style?: KitStyle;
}

/** The kit options the shared core reads. */
export interface LiveOptions {
  lazy?: boolean;
  poster?: string;
  globalLook?: boolean;
  reducedMotion?: boolean;
  charset?: string;
}

/** What the engine draws when a look names no charset, so clearing the global look puts it back. */
const ENGINE_CHARSET = ' .,:-=+*#%@';
const LETTER = /\p{L}/u;
// Ramps that hold letters but spell no word (fish, kanji, the ocean's own), so the global look may replace them.
const RAMPS = new Set<string>(Object.values(CHARACTER_SETS).map(set => set.chars));
/** @internal A component's own letter ramp that is a texture, not a word. */
export const registerRamp = (charset: string) => { RAMPS.add(charset); };
/** Marks that draw the charset's characters; every other mark draws its own shapes from the tone. */
const CHARACTER_MARKS: ReadonlySet<FieldMark> = new Set<FieldMark>(['glyph', 'inlay']);
export const drawsCharacters = (mark: FieldMark | undefined) => CHARACTER_MARKS.has(mark ?? 'glyph');
/** Cells for a field in another mark once it draws characters: tall cells, at least 7px, so glyphs read. */
export const glyphCells = (own: GlyphFieldOptions): GlyphFieldOptions => ({ cellSize: Math.max(7, own.cellSize ?? 8), cellAspect: 0.62, glyphScale: 0.9 });

const drawsOwnCharset = new WeakSet<object>();
/** @internal A component that resolves `charset` into its own look (backgrounds, with their `'dots'`), so the surface leaves it. */
export const ownsCharset = (kit: object) => { drawsOwnCharset.add(kit); };
/** The `charset` option a surface lays over the component's look. */
export const kitCharset = (kit: { current: LiveOptions } | undefined) => (kit && !drawsOwnCharset.has(kit) ? kit.current.charset : undefined);

/**
 * A component's `charset` option over its look: a named set (`CHARACTER_SETS`) or your own characters. A field that draws
 * characters keeps its mark and takes the new ramp, balanced to the house weight; a field in another mark (dots, dither, ticks,
 * engraving, pixels) switches to glyphs in cells sized for them.
 */
export function withCharset(own: GlyphFieldOptions, charset: string | undefined): GlyphFieldOptions {
  const chars = resolveCharset(charset);
  if (!chars) return own;
  if (drawsCharacters(own.mark)) return { ...own, charset: chars, ...balanceCharset(chars, own) };
  const cells = { ...own, ...glyphCells(own) };
  return { ...cells, mark: 'glyph', charset: chars, ...balanceCharset(chars, cells) };
}

/* ---------------- Global look ---------------- */

let look: GlobalLook | null = null;
const lookListeners = new Set<(look: GlobalLook | null) => void>();
const fields = new Set<{ relook(): void }>();

/** Re-skins every glyph field on the page at once; `null` gives each field its own characters back. */
export function setGlobalLook(next: GlobalLook | null) {
  const { charset, style } = next ?? {};
  look = next ? { ...(charset ? { charset } : {}), ...(isKitStyle(style) ? { style } : {}) } : null;
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
  /** Drawn through the page's shared context: it holds no context of its own, so the budget passes it by. */
  shared?: boolean;
  /** A poster stands in while it waits. */
  poster?: boolean;
  mount(): void;
  release(): void;
  /** Builds what the first mount would build (its glyph atlas) ahead of it. */
  prewarm?(): void;
}

// A field mounts within two viewports of the screen, so it is live before it scrolls in even on a fast scroll (two mounts a
// frame keep ahead of a wheel flinging a few thousand pixels a second), and is released beyond three, so scrolling back and
// forth never thrashes.
const MOUNT = 2, RELEASE = 3, DEFAULT_BUDGET = 12;
// Within a viewport of the screen a field is near: over the GPU memory budget, only fields beyond this give way.
const NEAR = 1;
// Programs and atlases are shared, so a mount is cheap, but a scroll must never drop a frame for one: at most this many a
// frame, and none past this much time in it. The rest wait for the next frame.
const FRAME_MS = 4, FRAME_MOUNTS = 2;

let budget = DEFAULT_BUDGET;
const slots = new Set<Slot>();
let watch: { ctor: unknown; list: IntersectionObserver[] } | null = null;
let doc: Document | null = null, frame = 0, windowAt = -1e9, spent = 0, count = 0, pumping = false, again = false;
// The current frame's timestamp: the same for every task until the next frame, unlike the clock.
const frameTime = () => { const at = (doc as { timeline?: { currentTime?: unknown } } | null)?.timeline?.currentTime; return typeof at === 'number' ? at : null; };

/**
 * At most `n` kit fields hold a WebGL context of their own at once (default 12; browsers drop the oldest past about 16).
 * Past it the live field farthest off screen is released first, and shows its poster until it is the nearer one again.
 * Fields drawn through the page's shared context hold none, so they don't count; only fields that fall back to a context
 * of their own (a canvas in another document, a browser without the shared path) do.
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
/**
 * The top-most open modal dialog, or null. Everything outside it is covered however near the screen it lies, so it ranks
 * behind every field the dialog shows. `:modal` lists dialogs in document order; the last is the top one for all but
 * modals opened out of order, which a page rarely stacks.
 */
function topModal(): Element | null {
  try { const open = doc?.querySelectorAll?.('dialog:modal'); return open?.length ? open[open.length - 1] : null; } catch { return null; }
}
// Covered fields rank this far beyond any real distance, behind every uncovered one but ahead of a detached one.
const COVERED = 1e8;
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
    watch = { ctor: IO, list: [`${MOUNT * 100}% 0px`, `${RELEASE * 100}% 0px`, '0px'].map(rootMargin => new IO(onEntries, { rootMargin })) };
    for (const slot of slots) watch.list.forEach(o => o.observe(slot.host));
  }
  return watch.list;
}

// Closing a modal uncovers the page behind it: what it displaced comes back, even when the dialog drew no field.
const onClose = () => pump();
// Fields mount while the page scrolls, within the frame budget; those ahead in the scroll's direction go first.
let heading = 0, scrolledTo = 0;
const onScroll = () => {
  const y = typeof scrollY === 'number' ? scrollY : 0;
  if (y !== scrolledTo) heading = y > scrolledTo ? 1 : -1;
  scrolledTo = y;
};
/** Distance off screen, doubled for a field behind the scroll's direction, so the ones it is heading to mount first. */
function ahead(host: HTMLElement, d: number) {
  if (!d || !heading) return d;
  const below = host.getBoundingClientRect().top > 0;
  return below === (heading > 0) ? d : d * 2;
}
let closeOn: Document | null = null;
const watchClose = (next: Document | null) => {
  if (closeOn === next) return;
  closeOn?.removeEventListener?.('close', onClose, true);
  closeOn?.removeEventListener?.('scroll', onScroll, true);
  next?.addEventListener?.('close', onClose, true);
  next?.addEventListener?.('scroll', onScroll, { capture: true, passive: true } as AddEventListenerOptions);
  closeOn = next;
};

/*
 * After load, at idle, the fields still waiting build their glyph atlases in the shared context, so the first scroll to them
 * pays no atlas painting. Nearest first; each idle slice builds what fits.
 */
const prewarmed = new WeakSet<Slot>();
let warming = 0;
function prewarmLater() {
  if (warming || typeof requestIdleCallback !== 'function') return;
  warming = requestIdleCallback(prewarmIdle, { timeout: 2000 });
}
function prewarmIdle(deadline: IdleDeadline) {
  warming = 0;
  const todo = [...slots].filter(s => !s.live && s.prewarm && !prewarmed.has(s)).sort((a, b) => offscreen(a.host) - offscreen(b.host));
  for (const slot of todo) {
    if (deadline.timeRemaining() < 2 && !deadline.didTimeout) { prewarmLater(); return; }
    prewarmed.add(slot);
    try { slot.prewarm!(); } catch { /* a mount builds it then */ }
  }
}
const prewarmAgain = (slot: Slot) => { prewarmed.delete(slot); if (slots.has(slot)) prewarmLater(); };

function claim(slot: Slot) {
  // A field from another document (a test, a replaced iframe) no longer shares this page's contexts.
  if (doc !== slot.doc) { doc = slot.doc; slots.clear(); frame = spent = count = heading = 0; windowAt = -1e9; scrolledTo = typeof scrollY === 'number' ? scrollY : 0; }
  watchClose(doc);
  slots.add(slot);
  const list = observers();
  list?.forEach(o => o.observe(slot.host));
  if (!list) slot.wanted = true; else judge(slot);
  pump();
  if (!slot.live) prewarmLater();
}
function unclaim(slot: Slot) {
  if (!slots.delete(slot)) return;
  if (![...slots].some(other => other.host === slot.host)) watch?.list.forEach(o => o.unobserve(slot.host));
  if (!slots.size && watch) { watch.list.forEach(o => o.disconnect()); watch = null; }
  if (!slots.size) { watchClose(null); if (warming && typeof cancelIdleCallback === 'function') cancelIdleCallback(warming); warming = 0; }
  pump();
}

/** Releases what is no longer wanted, then mounts the nearest waiting fields within the context budget and the frame's time. */
function pump(fromFrame = false) {
  if (pumping) { again = true; return; }
  pumping = true;
  try {
    do {
      again = false;
      // The budget renews with a frame, never within one task: a host that mounts many components in one commit (a
      // route change, a long list) gets one field mounted then, and the rest one per frame after it.
      const t = now(), at = frameTime();
      if (fromFrame || (at === null ? t - windowAt > 16 || t < windowAt : at !== windowAt)) { windowAt = at ?? t; spent = count = 0; }
      // A host taken out of the document (a route left, a list row recycled) before its handle is destroyed waits.
      for (const slot of slots) if (slot.host.isConnected === false) slot.wanted = false;
      for (const slot of slots) if (slot.live && !slot.wanted) slot.release();
      const live = [...slots].filter(s => s.live && !s.shared);
      const modal = topModal();
      const covered = (s: Slot) => !!modal && !modal.contains(s.host);
      const rank = (s: Slot) => offscreen(s.host) + (covered(s) ? COVERED : 0);
      // A covered `lazy: false` field keeps no claim over one the open dialog shows.
      const held = (s: Slot) => s.eager && !covered(s);
      const far = () => live.filter(s => s.live && !s.shared).map(s => [s, rank(s) + (held(s) ? 0 : 1e9)] as const).sort((a, b) => b[1] - a[1]);
      // A lower budget releases the farthest at once.
      for (let over = live.length - budget, order = over > 0 ? far() : []; over > 0; over--) order.shift()?.[0].release();
      // Past the page's GPU memory budget, shared fields far off screen give way to their posters, farthest first; `lazy: false`
      // fields too, since the budget is a guarantee to the host page. A field on or near the screen is never released for it:
      // nearer fields wait on their posters instead.
      const gpu = currentFieldContext();
      const beyond = viewport() * NEAR;
      const spill = () => [...slots].filter(s => s.live && s.shared && rank(s) > beyond).sort((a, b) => rank(b) - rank(a));
      if (gpu?.overBudget) for (const victim of spill()) { if (!gpu.overBudget) break; victim.release(); }
      const waiting = [...slots].filter(s => s.wanted && !s.live).map(s => [s, s.eager ? -1 : rank(s)] as const)
        .map(([s, d]) => [s, d, d > 0 ? ahead(s.host, d) : d] as const).sort((a, b) => a[2] - b[2]);
      let mounted = 0;
      for (const [slot, d] of waiting) {
        if (!slots.has(slot) || slot.live) continue;
        if (gpu && !gpu.roomy) {
          // Room is made only by a farther field; otherwise this one keeps its poster until memory frees up.
          const victim = spill()[0];
          if (!victim || rank(victim) <= rank(slot)) break;
          victim.release();
          if (!gpu.roomy) break;
        }
        if (!slot.eager && (spent >= FRAME_MS || count >= FRAME_MOUNTS) && !(fromFrame && !mounted)) { frame ||= requestAnimationFrame(() => { frame = 0; pump(true); }); break; }
        if (live.filter(s => s.live && !s.shared).length >= budget) {
          const victim = far()[0]?.[0];
          // The rest are farther still, so they wait too. Only another `lazy: false` field displaces one on view, and only a
          // nearer one displaces another `lazy: false` field: two of them never take the context from each other in turn.
          if (!victim || (held(victim) ? !slot.eager || rank(victim) <= rank(slot) : !slot.eager && rank(victim) <= d)) break;
          victim.release();
        }
        const start = now();
        slot.mount();
        spent += now() - start;
        mounted++;
        if (!slot.eager) count++;
        if (slot.live && !slot.shared) live.push(slot);
      }
    } while (again);
  } finally {
    pumping = false;
  }
}

/* ---------------- Balancing a swapped charset ---------------- */

const FIELD_FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const inkCache = new Map<string, InkWeight>();
const CLASSIC = '.:-=+*#%@';
/** A charset's weight next to classic ASCII in the field's font: its densest glyph against `@`, and its ramp's average. */
export interface InkWeight { max: number; mean: number }
/** Measures a charset's ink: about 1 and 1 for ASCII ramps, over 2 for block sets, under 0.6 for braille. 1 where it cannot be measured. */
export function inkWeight(charset: string, font = FIELD_FONT): InkWeight {
  const key = `${font}\u0000${charset}`;
  const known = inkCache.get(key);
  if (known) return known;
  let weight: InkWeight = { max: 1, mean: 1 };
  try {
    const pen = typeof document === 'undefined' ? null : Object.assign(document.createElement('canvas'), { width: 48, height: 48 }).getContext('2d', { willReadFrequently: true });
    if (pen && typeof pen.getImageData === 'function') {
      pen.font = `500 36px ${font}`; pen.textAlign = 'center'; pen.textBaseline = 'middle';
      const cover = (glyph: string) => {
        pen.clearRect(0, 0, 48, 48); pen.fillStyle = '#000'; pen.fillText(glyph, 24, 25);
        const data = pen.getImageData(0, 0, 48, 48).data;
        let sum = 0;
        for (let i = 3; i < data.length; i += 4) sum += data[i];
        return sum / 255;
      };
      const ramp = (set: string) => [...set].filter(g => g.trim()).map(cover);
      const average = (list: number[]) => list.reduce((a, b) => a + b, 0) / Math.max(1, list.length);
      const own = ramp(charset), house = ramp(CLASSIC), at = cover('@');
      if (own.length && at > 0 && average(house) > 0) weight = { max: Math.max(...own) / at, mean: average(own) / average(house) };
    }
  } catch { /* no 2D canvas: leave the charset as it is */ }
  inkCache.set(key, weight);
  return weight;
}

/**
 * Evens out a charset's weight so any set reads like the house ASCII. Block and solid sets draw smaller glyphs and keep
 * their detail instead of turning to slabs; sets with no light glyphs (binary) ease off; faint sets (minimal, braille,
 * code) draw larger, bolder glyphs. Tones are left alone, so images keep their detail in every set.
 */
export function balanceCharset(charset: string, own: GlyphFieldOptions): GlyphFieldOptions {
  const { max, mean } = inkWeight(charset, own.font ?? FIELD_FONT);
  const scale = own.glyphScale ?? 0.8, gamma = own.gamma ?? 1, weight = own.fontWeight ?? 500;
  if (max > 1.15) return { glyphScale: Math.max(0.3, scale * Math.max(0.62, max ** -0.36)), gamma, fontWeight: weight };
  if (mean > 1.5) return { glyphScale: Math.max(0.3, scale * mean ** -0.25), gamma, fontWeight: weight };
  if (max < 0.85) {
    return {
      glyphScale: Math.min(1.6, scale * Math.min(1.3, max ** -0.3)),
      gamma,
      fontWeight: max < 0.6 ? Math.max(weight, 700) : weight,
    };
  }
  return { glyphScale: scale, gamma, fontWeight: weight };
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
  /** A field drawn in another mark (a halftone) that still takes the global look: what it draws with once a look gives it characters. */
  glyphs?: () => GlyphFieldOptions;
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

/** Every poster a kit still has in the page: a component that swaps fields (`background().setPreset`) mounts one per field. */
const leftovers = new WeakMap<object, Map<HTMLImageElement, () => void>>();
/** Points a kit's posters at a new still, such as the other theme's, without remounting. */
export function setPosterSource(kit: object, src: string) { for (const img of leftovers.get(kit)?.keys() ?? []) if (img.getAttribute('src') !== src) img.src = src; }
/** Removes what outlived a failed or unsupported field (its posters), once the handle is destroyed. */
export function disposeKit(kit: object) { const list = leftovers.get(kit); leftovers.delete(kit); list?.forEach(remove => remove()); }

const quiet = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/**
 * A still under the field: shown until the first frame, while released, and in place of the field without WebGL. It swaps
 * with the canvas in one frame, with no fade: the field's first frame is drawn in the frame the poster goes, so the host
 * never shows both, or neither.
 */
export function poster(host: HTMLElement, src: string, place: string, kit: object, before?: Element | null) {
  const img = document.createElement('img');
  img.alt = '';
  img.decoding = 'async';
  img.setAttribute('aria-hidden', 'true');
  img.setAttribute('style', `${place};object-fit:cover`);
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
  let gone = false;
  const remove = () => {
    if (gone) return;
    gone = true;
    img.remove();
    leftovers.get(kit)?.delete(img);
    if (positioned) { if (saved) host.style.setProperty('position', saved); else host.style.removeProperty('position'); }
    if (isolated) { if (savedIsolation) host.style.setProperty('isolation', savedIsolation); else host.style.removeProperty('isolation'); }
  };
  const own = leftovers.get(kit) ?? new Map<HTMLImageElement, () => void>();
  own.set(img, remove);
  leftovers.set(kit, own);
  // Only this field's poster: an outgoing field must not take the incoming one's, nor leave its own over it.
  return { show(on: boolean) { img.style.opacity = on ? '1' : '0'; }, remove };
}

const SWEEP_EASE = 'cubic-bezier(.23,1,.32,1)';
/**
 * The global-look sweep: the frame before a look change holds over the field and is wiped away left to right, led by a thin
 * scan line, as the new look lands under it (200ms after a 40ms beat). The line is `--ascii-sweep` (default amber).
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

// How long a field waits for the browser to restore a lost context before it remounts on a fresh one.
const LOST_MS = 1000;
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
  try {
    const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
    if (gl && !gl.isContextLost?.()) gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { /* already gone */ }
};

export function liveField(config: LiveConfig): Live {
  const { host, kit } = config;
  let canvas = config.canvas, real: GlyphField | null = null, used = false, destroyed = false, failed = false, starting = false;
  let recorded: GlyphFieldOptions = {}, merged: GlyphFieldOptions = {}, source = config.source, paused = false, shown: string | undefined;
  let settings = {} as GlyphField['settings'];
  let resolveReady: (() => void) | null = null, nextReady: Promise<void> | null = null;
  let shownReady = false, wiping: ReturnType<typeof sweep> = null, unwatch = () => {};
  const still = !config.ownPoster && kit?.current.poster ? poster(host, kit.current.poster, config.place, kit, canvas) : null;

  /**
   * The global look applies to glyph fields that opted in and whose own characters are not letters (a word or a brand). Letters
   * scattered as a texture (`glyphOrder: 'scatter'`) are no word, so those fields take the look too.
   */
  const wanted = (): { mark: FieldMark; charset?: string } | undefined => {
    // A `charset` the component was given is its own choice, kept over the page's look.
    if (!look || kit?.current.globalLook === false || kit?.current.charset) return undefined;
    if ((!drawsCharacters(merged.mark) && !config.glyphs) || (merged.glyphOrder !== 'scatter' && !RAMPS.has(merged.charset ?? '') && LETTER.test(merged.charset ?? ''))) return undefined;
    const style = look.style ? KIT_STYLES[look.style] : undefined;
    // A charset alone keeps a character mark (an inlay stays tiled); a style brings its own mark.
    const mark: FieldMark = style?.mark ?? (drawsCharacters(merged.mark) ? merged.mark ?? 'glyph' : 'glyph');
    const charset = drawsCharacters(mark) ? look.charset || (style && 'charset' in style ? style.charset : undefined) : undefined;
    return style || charset ? { mark, charset } : undefined;
  };
  const own = (): GlyphFieldOptions => ({
    ...(config.glyphs ? Object.fromEntries(Object.keys(config.glyphs()).map(key => [key, merged[key as keyof GlyphFieldOptions]]).filter(([, value]) => value !== undefined)) : {}),
    mark: merged.mark ?? 'glyph', charset: merged.charset ?? ENGINE_CHARSET,
    glyphScale: merged.glyphScale ?? 0.8, gamma: merged.gamma ?? 1, fontWeight: merged.fontWeight ?? 500,
  });
  const lookOptions = (want: { mark: FieldMark; charset?: string }): GlyphFieldOptions => {
    if (!want.charset) return { ...own(), mark: want.mark };
    // A halftone given characters lays them out as the glyph fields do: its own cells are square and spaced for dots.
    const cells = config.glyphs && !drawsCharacters(merged.mark) ? config.glyphs() : {};
    return { ...cells, mark: want.mark, charset: want.charset, ...balanceCharset(want.charset, { ...merged, ...cells }) };
  };
  /** What changes since the look last applied: the look's options, the field's own back, or null for nothing. */
  const lookPatch = (): GlyphFieldOptions | null => {
    const want = wanted(), key = want && `${want.mark}\u0000${want.charset ?? ''}`;
    if (key === shown) return null;
    shown = key;
    return want ? lookOptions(want) : own();
  };

  const slot: Slot = {
    host, doc: document, eager: kit?.current.lazy === false, wanted: false, live: false, poster: !!still || !!config.ownPoster,
    mount() {
      if (destroyed || real) return;
      if (used) canvas = config.canvas = freshCanvas(canvas);
      used = true;
      merged = { ...config.options(), ...recorded };
      shown = undefined;
      const patch = lookPatch();
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
      slot.shared = isSharedFieldCanvas(canvas);
      // A context the browser takes back (Safari past its 16, a GPU reset) and does not restore leaves a blank canvas:
      // the field is released to its poster and mounts again on a fresh canvas when the budget allows. The shared
      // context replaces itself instead.
      const drawn = canvas;
      if (slot.shared) unwatch = () => {};
      else {
        let gone = 0;
        // A lost context blanks its canvas at once: the poster covers it until the context comes back or the field remounts.
        const onLost = () => {
          if (real !== field) return;
          still?.show(true);
          clearTimeout(gone);
          gone = setTimeout(() => { if (real === field && canvas === drawn) { slot.release(); pump(); } }, LOST_MS) as unknown as number;
        };
        const onRestored = () => {
          clearTimeout(gone);
          // The restored field draws in its next frame; the poster goes after it.
          requestAnimationFrame(() => requestAnimationFrame(() => { if (real === field) still?.show(false); }));
        };
        drawn.addEventListener?.('webglcontextlost', onLost);
        drawn.addEventListener?.('webglcontextrestored', onRestored);
        unwatch = () => { clearTimeout(gone); drawn.removeEventListener?.('webglcontextlost', onLost); drawn.removeEventListener?.('webglcontextrestored', onRestored); };
      }
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
      unwatch();
      wiping?.clear();
      wiping = null;
      settings = field.settings;
      field.destroy();
      if (slot.shared) {
        // A shared field's canvas holds no context: it is cleared for the poster and drawn into again on the next mount.
        if (!destroyed) { canvas.width = canvas.width; used = false; }
      } else {
        loseContext(canvas);
        // Safari counts a lost context against its 16 for as long as its canvas lives, and past them loses the oldest
        // live one: a released field gives its canvas up at once (a blank one waits in its place), so it can be collected.
        if (!destroyed) { canvas = config.canvas = freshCanvas(canvas); used = false; }
      }
      still?.show(true);
      config.onRelease?.();
    },
    prewarm() {
      if (destroyed || real) return;
      merged = { ...config.options(), ...recorded };
      const want = wanted();
      prewarmGlyphAtlas(canvas, { ...merged, ...(want ? lookOptions(want) : {}) });
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
      if (!real) prewarmAgain(slot);
      const patch = lookPatch();
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
      const patch = lookPatch(), want = wanted();
      real.update(want ? { ...options, ...lookOptions(want) } : patch ? { ...options, ...patch } : options);
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
