import type { GlyphFieldOptions } from '../field';
import { clamp, entryProgress, handle, hash, house, mountSurface, prefersReduced, styleKeeper, type KitHandle, type KitOptions, type Surface } from './core';

export interface DecodeOptions extends KitOptions {
  /** Text to draw instead of the element's own, centred and as large as fits; `\n` breaks lines. By default the element's text is drawn exactly where the browser lays it out. */
  text?: string;
  /** Total length in ms: the first 30% is drift alone, then the words resolve left to right. Default 800. */
  duration?: number;
  /**
   * `visible` decodes when the element scrolls into view; `manual` waits for `replay()`; `scroll` ties the decode to scroll
   * position, resolving as the element rises into view and undoing as it leaves (and idling while the page is still). Default `visible`.
   */
  trigger?: 'visible' | 'manual' | 'scroll';
  /**
   * Scramble the element's own HTML text instead of drawing a field: a front sweeps left to right turning each letter into flickering
   * letters of another alphabet, and a second front a few letters behind it sets the real letters down, in the element's own font
   * and size. `true` uses the built-in alphabets (kana, Hangul, Han, accented Latin, Cyrillic, Greek, signs), a new one each run, or
   * the alphabet of the word it is heading to; or give your own list, one string of letters per alphabet. No WebGL is needed.
   * The default `duration` becomes 900.
   */
  scramble?: boolean | string[];
  /**
   * With `scramble`: words to cycle the element's first text through, as a headline that greets in several languages
   * ("Connect", "つながる", "Conectar"). Each change sweeps from the old word to the new one, then holds for `hold` ms.
   */
  cycle?: string[];
  /** Ms each word of `cycle` holds. Default 2600. */
  hold?: number;
  /** Decode again when the pointer enters. Default true. */
  replayOnHover?: boolean;
  /** `glyphs` keeps the headline in characters; `text` hands back to the crisp HTML text at the end. Default `glyphs`. */
  settle?: 'glyphs' | 'text';
}

export interface DecodeHandle extends KitHandle<DecodeOptions> {
  /** Plays the decode again from the drift. */
  replay(): void;
}

const DEFAULTS = { duration: 800, trigger: 'visible' as 'visible' | 'manual' | 'scroll', replayOnHover: true, settle: 'glyphs' as 'glyphs' | 'text' };
/** The built-in alphabets `scramble: true` flips through. */
export const SCRAMBLE_SCRIPTS = [
  'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん',
  '가나다라마바사아자차카타파하연결함께성장미래교류접',
  '连接通建联合共创未来网络云端世界开放协作数据',
  'ÁÀÂÄÃÅÆÇÉÈÊËÍÌÎÏÑÓÒÔÖØŒÚÙÛÜÝŸßÐÞ',
  'БГДЖЗИЙЛПФЦЧШЩЪЫЬЭЮЯ',
  'ΑΒΓΔΘΛΞΠΣΦΨΩαβγδεζηθλμξπσφψω',
  '0123456789#%&*+=<>/\\[]{}@$',
];
/** One letter of the headline: where the browser (or the given layout) put it, and the font it is drawn in. */
export interface DecodeLetter { char: string; x: number; y: number; w: number; font: string }
/** The letter shown at position `i` on flip `flip`: the real one once locked, else one from the flip's alphabet. Exported for tests. */
export function scrambleLetter(letter: string, i: number, flip: number, locked: number, scripts: string[]) {
  if (i < locked || !letter.trim()) return letter;
  const script = [...scripts[Math.floor(flip / 4) % scripts.length] ?? letter];
  return script[Math.floor(hash(i * 3.1 + flip, flip * 0.7 + i) * script.length)] ?? letter;
}
const RESOLUTION = 2;

/** The alphabet a word flickers through on its way in: the built-in one holding its letters, else accented Latin. Exported for tests. */
export function scriptFor(word: string, scripts: string[], fallback: number) {
  for (const script of scripts) if ([...word].some(char => char.trim() && script.includes(char))) return script;
  if ([...word].some(char => char.charCodeAt(0) > 0x2e80)) return scripts.find(s => /[\u4e00-\u9fff]/.test(s)) ?? scripts[fallback % scripts.length];
  return scripts.find(s => s.includes('É')) ?? scripts[fallback % scripts.length];
}

/**
 * One frame of the sweep from `from` to `to`, `t` seconds in, `step` seconds a letter: past the trailing front the new letters,
 * between the fronts letters of `script` (fresh every `flicker`), ahead of them the old ones. Exported for tests.
 */
export function sweepText(from: string, to: string, t: number, step: number, script: string, lag = 3, flicker = 0.05) {
  const a = [...from], b = [...to], n = Math.max(a.length, b.length), letters = [...script];
  const lead = Math.floor(t / step), set = lead - lag, tick = Math.floor(t / flicker);
  let out = '';
  for (let i = 0; i < n; i++) {
    if (i < set) { out += b[i] ?? ''; continue; }
    if (i >= lead) { out += a[i] ?? ''; continue; }
    const real = b[i] ?? a[i] ?? '';
    out += !real.trim() ? real : letters[Math.floor(hash(i * 7.3 + tick, tick * 0.37 + i) * letters.length)] ?? real;
  }
  return { text: out, done: set >= n };
}

/** A soft value-noise cloud that drifts with `t`, feathered toward the edges. */
export function driftNoise(noise: HTMLCanvasElement, t: number, feather = 0.82) {
  const ctx = noise.getContext('2d');
  if (!ctx) return;
  const w = noise.width, h = noise.height, img = ctx.createImageData(w, h);
  const smooth = (x: number) => x * x * (3 - 2 * x);
  const value = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = smooth(x - xi), yf = smooth(y - yi);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const n = value(x / 6 + t * 2.4, y / 3.5 - t * 0.8) * 0.6 + value(x / 2.5 - t * 3, y / 2) * 0.4;
    const edge = Math.min(1, (1 - Math.hypot((x / w - 0.5) * 2, (y / h - 0.5) * 2) * feather) * 2.4);
    const v = Math.max(0, n - 0.42) * 0.72 * Math.max(0, edge) * 255, i = (y * w + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/** Paints the element's text white on black where the browser laid each word out. */
function paintOwnText(pen: CanvasRenderingContext2D, element: HTMLElement, origin: DOMRect, scale: number, letters?: DecodeLetter[]) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  pen.fillStyle = '#fff';
  pen.textAlign = 'left';
  pen.textBaseline = 'alphabetic';
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const parent = node.parentElement;
    if (!parent) continue;
    const style = getComputedStyle(parent);
    pen.font = `${style.fontStyle} ${style.fontWeight} ${parseFloat(style.fontSize) * scale}px ${style.fontFamily}`;
    if ('letterSpacing' in pen) (pen as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${(parseFloat(style.letterSpacing) || 0) * scale}px`;
    const metric = pen.measureText('Hg'), ascent = metric.fontBoundingBoxAscent || parseFloat(style.fontSize) * scale * 0.8, descent = metric.fontBoundingBoxDescent || parseFloat(style.fontSize) * scale * 0.2;
    const transform = style.textTransform === 'uppercase' ? (s: string) => s.toUpperCase() : style.textTransform === 'lowercase' ? (s: string) => s.toLowerCase() : (s: string) => s;
    for (const word of node.data.matchAll(/\S+/g)) {
      range.setStart(node, word.index!);
      range.setEnd(node, word.index! + word[0].length);
      const rect = range.getClientRects()[0];
      if (!rect) continue;
      const top = (rect.top - origin.top) * scale, height = rect.height * scale, baseline = top + (height - ascent - descent) / 2 + ascent;
      pen.fillText(transform(word[0]), (rect.left - origin.left) * scale, baseline);
      if (!letters) continue;
      // Each letter's own box, for the scramble: one range a letter, measured once per layout.
      let at = word.index!;
      for (const char of word[0]) {
        range.setStart(node, at);
        range.setEnd(node, at + char.length);
        const box = range.getClientRects()[0];
        if (box) letters.push({ char: transform(char), x: (box.left - origin.left) * scale, y: baseline, w: box.width * scale, font: pen.font });
        at += char.length;
      }
    }
  }
  range.detach?.();
}

/** Lines of `text` centred and as large as fits, in the element's font. */
function paintGivenText(pen: CanvasRenderingContext2D, element: HTMLElement, text: string, w: number, h: number, letters?: DecodeLetter[]) {
  const style = getComputedStyle(element), lines = text.split('\n');
  pen.fillStyle = '#fff'; pen.textAlign = 'center'; pen.textBaseline = 'middle';
  // Letter spacing is kept as a share of the font size, so a tight headline stays tight at whatever size fits.
  const em = (parseFloat(style.letterSpacing) || 0) / (parseFloat(style.fontSize) || 16);
  const spacing = (px: number) => { if ('letterSpacing' in pen) (pen as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${em * px}px`; };
  // Measured untracked, then tracked: a tight headline sits a little inside the 94% it is sized to.
  pen.font = `${style.fontWeight} 100px ${style.fontFamily}`;
  spacing(0);
  const widest = Math.max(1, ...lines.map(line => pen.measureText(line).width));
  const size = Math.min(((w * 0.94) / widest) * 100, (h * 0.9) / lines.length);
  pen.font = `${style.fontWeight} ${size}px ${style.fontFamily}`;
  spacing(size);
  lines.forEach((line, i) => {
    const y = h / 2 + (i - (lines.length - 1) / 2) * size * 1.04;
    pen.fillText(line, w / 2, y);
    if (!letters) return;
    const gap = em * size;
    let x = w / 2 - (pen.measureText(line).width) / 2;
    for (const char of line) {
      const cw = pen.measureText(char).width;
      letters.push({ char, x, y: y + size * 0.36, w: cw, font: pen.font });
      x += cw + gap;
    }
  });
}

/** A headline that condenses out of a drifting field of characters, left to right through a flickering band. */
export function decode(element: HTMLElement, options: DecodeOptions = {}): DecodeHandle {
  if (options.scramble) return scrambleText(element, options);
  const state = { current: { ...DEFAULTS, ...options } };
  const styles = styleKeeper();
  const art = document.createElement('canvas'), noise = document.createElement('canvas');
  let start = -1, artKey = '', showing = false, ran = false, surface: Surface | null = null, scrolled = 0;
  const look = (): GlyphFieldOptions => ({
    mark: 'glyph', charset: ' .:-=+*#%@', font: '"Geist Mono", ui-monospace, monospace', fontWeight: 500,
    cellSize: 4.5, cellAspect: 0.62, glyphScale: 0.92, contrast: 1.35, hover: 'trail', trail: { strength: 0.6, radius: 0.2 },
    ...state.current.look,
  });

  const buildArt = (w: number, h: number) => {
    const key = `${w}x${h}:${state.current.text ?? ''}:${element.textContent}`;
    if (key === artKey) return;
    artKey = key;
    art.width = w; art.height = h;
    const pen = art.getContext('2d')!;
    pen.fillStyle = '#000'; pen.fillRect(0, 0, w, h);
    if (state.current.text !== undefined) paintGivenText(pen, element, state.current.text, w, h);
    else paintOwnText(pen, element, element.getBoundingClientRect(), (w / (element.getBoundingClientRect().width || 1)));
  };

  surface = mountSurface({
    host: element,
    look,
    // Text fill is hidden while the field draws, but `color` still holds the theme's text colour.
    ink: () => state.current.ink ?? getComputedStyle(element).color,
    kit: state,
    reducedMotion: () => state.current.reducedMotion,
    resolution: RESOLUTION,
    onFail: () => { surface = null; styles.restore(); },
    paint: ({ pen, width: w, height: h, now, still }) => {
      buildArt(w, h);
      const o = state.current, textEnd = o.settle === 'text';
      if (o.trigger === 'scroll') {
        // Scroll position is the clock: nothing animates while the page is still.
        const p = still ? 1 : scrolled;
        if (p >= 1) { if (!textEnd) pen.drawImage(art, 0, 0); return false; }
        if (p <= 0) return false;
        const edge = p * w;
        pen.drawImage(art, 0, 0, Math.max(1, edge), h, 0, 0, Math.max(1, edge), h);
        return false;
      }
      if (start < 0 || still) {
        // Waiting to scroll into view: an empty field, so the first decode starts from nothing.
        if (!ran && o.trigger === 'visible' && !still) return false;
        if (!(textEnd && start >= 0)) pen.drawImage(art, 0, 0);
        if (start >= 0) finish();
        return false;
      }
      const t = now - start, drift = o.duration * 0.3, sweep = o.duration * 0.7;
      const nw = Math.max(2, Math.ceil(w / 20)), nh = Math.max(2, Math.ceil(h / 20));
      if (noise.width !== nw || noise.height !== nh) { noise.width = nw; noise.height = nh; }
      driftNoise(noise, t / 1000);
      pen.imageSmoothingEnabled = true;
      if (t < drift) {
        pen.drawImage(noise, 0, 0, w, h);
        if (showing) { pen.globalAlpha = 1 - house(t / drift); pen.drawImage(art, 0, 0); pen.globalAlpha = 1; }
        return true;
      }
      const p = Math.min(1, (t - drift) / sweep), edge = (p * 1.18 - 0.02) * w, band = w * 0.14;
      const cw = 4.5 * 0.62 * RESOLUTION, ch = 4.5 * RESOLUTION, step = Math.floor(now / 16);
      if (p >= 1) {
        if (!textEnd) pen.drawImage(art, 0, 0);
        finish();
        return false;
      }
      pen.drawImage(noise, 0, 0, w, h);
      if (edge > 0) pen.drawImage(art, 0, 0, edge, h, 0, 0, edge, h);
      for (let x = Math.max(0, Math.floor(edge / cw) * cw); x < edge + band; x += cw) {
        const depth = (x - edge) / band;
        for (let y = 0; y < h; y += ch) {
          if (hash(x + step * 13, y) < depth) continue;
          pen.globalAlpha = 0.35 + 0.65 * hash(y + step * 7, x);
          pen.fillStyle = '#000'; pen.fillRect(x, y, cw, ch);
          pen.drawImage(art, x, y, cw, ch, x, y, cw, ch);
        }
      }
      pen.globalAlpha = 1;
      return true;
    },
  });

  const finish = () => {
    start = -1;
    showing = state.current.settle !== 'text';
    if (!showing) styles.restore();
  };
  const run = () => {
    if (!surface) return;
    styles.set(element, '-webkit-text-fill-color', 'transparent');
    ran = true;
    start = performance.now();
    surface.kick();
  };

  const onScroll = () => {
    if (!surface) return;
    const p = entryProgress(element);
    if (Math.abs(p - scrolled) < 0.002) return;
    scrolled = p;
    if (state.current.settle === 'text') {
      if (p >= 1) styles.restore(); else styles.set(element, '-webkit-text-fill-color', 'transparent');
    }
    surface.kick();
  };
  const scrolling = !!surface && state.current.trigger === 'scroll' && typeof window !== 'undefined';
  if (scrolling) { window.addEventListener('scroll', onScroll, { passive: true }); scrolled = -1; onScroll(); }

  let seen = false;
  const view = surface && state.current.trigger === 'visible' && typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(([entry]) => { if (entry.isIntersecting && !seen) run(); seen = entry.isIntersecting; }, { threshold: 0.5 })
    : null;
  if (surface) {
    if (state.current.settle !== 'text') styles.set(element, '-webkit-text-fill-color', 'transparent');
    showing = state.current.settle !== 'text' && state.current.trigger === 'manual';
    if (view) view.observe(element);
    else if (state.current.trigger === 'visible') run();
  }
  // Entry is read from pointer moves too, so a scripted cursor that only sends pointermove replays it like a real one.
  let inside = false;
  const onEnter = () => { if (inside) return; inside = true; if (state.current.replayOnHover && start < 0 && state.current.trigger !== 'scroll') run(); };
  const onLeave = () => { inside = false; };
  const onAway = (event: Event) => { if (inside && !(event.target instanceof Node && element.contains(event.target))) inside = false; };
  if (surface) {
    element.addEventListener('pointerenter', onEnter);
    element.addEventListener('pointermove', onEnter);
    element.addEventListener('pointerleave', onLeave);
    document.addEventListener('pointermove', onAway, true);
  }
  if (surface) void document.fonts?.ready.then(() => { artKey = ''; surface?.kick(); });

  return handle(() => surface, state, () => { artKey = ''; surface?.refresh(); }, {
    replay: run,
  }, () => {
    view?.disconnect();
    if (scrolling) window.removeEventListener('scroll', onScroll);
    element.removeEventListener('pointerenter', onEnter);
    element.removeEventListener('pointermove', onEnter);
    element.removeEventListener('pointerleave', onLeave);
    document.removeEventListener('pointermove', onAway, true);
    styles.restore();
  });
}

export const DECODE_DEFAULTS = DEFAULTS;

/** `decode` with `scramble`: the element's own text sweeps through another alphabet and lands, in HTML, with no field. */
function scrambleText(element: HTMLElement, options: DecodeOptions): DecodeHandle {
  const state = { current: { ...DEFAULTS, duration: 900, hold: 2600, ...options } };
  const o = () => state.current;
  const scripts = () => (Array.isArray(o().scramble) && (o().scramble as string[]).length ? o().scramble as string[] : SCRAMBLE_SCRIPTS);
  const reduced = () => !!(o().reducedMotion ?? prefersReduced());
  // The text nodes, read once: their own words are what a plain scramble lands back on.
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) if (node.data.trim()) nodes.push(node);
  const own = nodes.map(node => node.data);
  const label = element.getAttribute('aria-label');
  let raf = 0, timer: ReturnType<typeof setTimeout> | undefined, runs = 0, word = 0, destroyed = false, scrolled = 0;
  let job: { from: string[]; to: string[]; script: string; start: number } | null = null;
  const write = (texts: string[]) => texts.forEach((text, i) => { if (nodes[i] && nodes[i].data !== text) nodes[i].data = text; });
  const current = () => nodes.map(node => node.data);
  const settle = () => {
    if (label === null) element.removeAttribute('aria-label'); else element.setAttribute('aria-label', label);
  };
  const frame = (now: number) => {
    raf = 0;
    if (!job || destroyed) return;
    const t = Math.max(0, now - job.start) / 1000;
    const letters = Math.max(...job.to.map(x => [...x].length), ...job.from.map(x => [...x].length), 1);
    const step = (o().duration / 1000) / (letters + 3);
    let done = true, offset = 0;
    write(job.to.map((to, i) => {
      // Text nodes sweep as one line: each starts where the one before it ended.
      const r = sweepText(job!.from[i] ?? '', to, t - offset * step, step, job!.script);
      offset += Math.max([...to].length, [...(job!.from[i] ?? '')].length);
      if (!r.done) done = false;
      return r.text;
    }));
    if (done) { write(job.to); job = null; settle(); next(); return; }
    raf = requestAnimationFrame(frame);
  };
  const go = (to: string[]) => {
    if (destroyed || !nodes.length) return;
    if (reduced()) { write(to); next(); return; }
    cancelAnimationFrame(raf);
    const target = to.join(' ');
    element.setAttribute('aria-label', o().cycle ? target : own.join(' '));
    job = { from: current(), to, script: o().scramble === true ? scriptFor(target, scripts(), runs) : scripts()[runs % scripts().length], start: performance.now() };
    runs++;
    raf = requestAnimationFrame(frame);
  };
  const next = () => {
    const words = o().cycle;
    if (!words?.length || destroyed) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (typeof document !== 'undefined' && document.hidden) { next(); return; }
      word = (word + 1) % words.length;
      go([words[word], ...own.slice(1)]);
    }, o().hold);
  };
  const run = () => {
    const words = o().cycle;
    go(words?.length ? [words[word], ...own.slice(1)] : own);
  };
  // The same triggers as a field decode: in view, on hover, by hand, or with scroll position.
  const onScroll = () => {
    const p = entryProgress(element);
    if (Math.abs(p - scrolled) < 0.002 || reduced()) return;
    scrolled = p;
    const letters = Math.max(1, ...own.map(x => [...x].length)), step = 1 / (letters + 3);
    let offset = 0;
    write(own.map(text => { const r = sweepText(text, text, p - offset * step, step, scripts()[0]); offset += [...text].length; return p >= 1 ? text : r.text; }));
  };
  const scrolling = o().trigger === 'scroll' && typeof window !== 'undefined';
  if (scrolling) { window.addEventListener('scroll', onScroll, { passive: true }); scrolled = -1; onScroll(); }
  let seen = false;
  const view = o().trigger === 'visible' && typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(([entry]) => { if (entry.isIntersecting && !seen) run(); seen = entry.isIntersecting; }, { threshold: 0.5 })
    : null;
  if (view) view.observe(element);
  else if (o().trigger === 'visible') run();
  let inside = false;
  const onEnter = () => { if (inside) return; inside = true; if (o().replayOnHover && !job && o().trigger !== 'scroll' && !o().cycle) run(); };
  const onLeave = () => { inside = false; };
  element.addEventListener('pointerenter', onEnter);
  element.addEventListener('pointermove', onEnter);
  element.addEventListener('pointerleave', onLeave);
  if (o().cycle?.length && o().trigger === 'manual') next();

  const h = handle(() => null, state, () => {}, { replay: run }, () => {
    destroyed = true;
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    view?.disconnect();
    if (scrolling) window.removeEventListener('scroll', onScroll);
    element.removeEventListener('pointerenter', onEnter);
    element.removeEventListener('pointermove', onEnter);
    element.removeEventListener('pointerleave', onLeave);
    if (!o().cycle) write(own);
    settle();
  });
  // No field to fail: the scramble works wherever the DOM does.
  return Object.defineProperty(h, 'supported', { get: () => !destroyed });
}
