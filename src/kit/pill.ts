import type { GlyphFieldOptions } from '../field';
import { easeOut, handle, isDark, mountSurface, srOnly, styleKeeper, type Box, type KitHandle, type KitOptions, type Surface } from './core';

export type PillTone = 'green' | 'amber' | 'red' | 'neutral' | 'new';

export interface PillOptions extends KitOptions {
  /** The tone of a pill without `data-tone`. `new` is a solid pill led by a sparkle. Default `neutral`. */
  tone?: PillTone;
  /**
   * A live state: the indicator moves. Amber turns a half-filled dot like a spinner (syncing); any other tone breathes its dot.
   * `data-live` on a pill wins. Default false. Neutral shows an open ring, and a pill turning red blinks its dot open twice.
   */
  live?: boolean;
  /** A one-cell glyph before the label, drawn over the pill's `[data-dot]` element (one is added when missing): a status dot, or a `new` pill's sparkle. Default true. */
  indicator?: boolean;
  /** A `new` pill's sparkle twinkles when the pointer enters it. Default true. */
  sheen?: boolean;
  /** Glyph hues to paint, as `[r, g, b]` 0–255, for the light and dark ground. */
  tones?: Partial<Record<'light' | 'dark', Partial<Record<PillTone, [number, number, number]>>>>;
}

export interface PillHandle extends KitHandle<PillOptions> {
  /** Twinkles the sparkle on one pill, or on every `new` pill. */
  sheen(pill?: HTMLElement): void;
  /** Sets a count pill (`data-count`) to `value`; only the changed digits roll. Without `pill`, the first count pill. */
  count(value: number | string, pill?: HTMLElement): void;
  /** Re-reads each pill's `data-tone` and `data-live`; tone changes ease over 240ms. `update()` does this too. */
  refresh(): void;
}

const DEFAULTS = { tone: 'neutral' as PillTone, live: false, indicator: true, sheen: true };
/** Glyph hues painted into the source. The field normalises each hue and takes the glyph from its brightness. `new` is the neutral sparkle. */
export const PILL_TONES: Record<'light' | 'dark', Record<PillTone, [number, number, number]>> = {
  light: { green: [22, 150, 82], amber: [214, 138, 8], red: [214, 52, 52], neutral: [120, 120, 114], new: [255, 255, 255] },
  dark: { green: [120, 240, 170], amber: [255, 206, 110], red: [255, 156, 156], neutral: [200, 200, 192], new: [255, 255, 255] },
};
/*
 * The field picks a glyph by brightness, so the charset is a lookup table: each glyph owns a band of brightness and the kit
 * paints the middle of a band to choose it. The field colours a glyph by brightness too, so a light ground keeps the bands low
 * (deep, saturated glyphs) and a dark one high. A spinner's four quarters sit in four narrow bands of their own, above the dot
 * on a dark ground so they stay as bright as it. The sparkle on a `new` pill sits wherever it contrasts with the solid fill:
 * near white over ink on a light ground, near black on a dark one.
 */
const BANDS = {
  light: [[0.03, ' '], [0.08, '·'], [0.13, '•'], [0.18, '○'], [0.5, '●'], [0.56, '◐'], [0.62, '◓'], [0.68, '◑'], [0.74, '◒'], [0.8, '●'], [0.88, '✧'], [2, '✦']],
  dark: [[0.02, ' '], [0.06, '✦'], [0.1, '✧'], [0.2, '·'], [0.3, '•'], [0.38, '○'], [0.64, '●'], [0.68, '◐'], [0.72, '◓'], [0.76, '◑'], [0.8, '◒'], [2, '●']],
} as const;
const glyphAt = (theme: 'light' | 'dark', glyph: string, at = 0.5) => {
  const bands = BANDS[theme], i = bands.findIndex(([, g]) => g === glyph), lo = i > 0 ? bands[i - 1][0] : 0;
  return lo + (Math.min(bands[i][0], 1) - lo) * at;
};
const ramp = (bands: readonly (readonly [number, string])[]) =>
  Array.from({ length: 96 }, (_, i) => bands.find(([edge]) => i / 95 < edge)![1]).join('');
const RAMP = { light: ramp(BANDS.light), dark: ramp(BANDS.dark) };
const SPIN = ['◐', '◓', '◑', '◒'], TWINKLE = ['✧', '·', '✧', '✦', '✧', '✦'];
/** Square cells sampled exactly, so a glyph never spills into the next cell. */
const CELL = 12, BREATH = 2200, SPIN_MS = 130, BLINK = 640, ROLL = 460, ROLL_STAGGER = 70, SHEEN_MS = 720, TONE = 240;

const mix = (a: number[], b: number[], k: number) => a.map((v, i) => v + (b[i] - v) * k);
/** `hue` at full saturation, scaled so its luminance (the field's tone) is `tone`. */
function toned(hue: number[], tone: number) {
  const top = Math.max(1, ...hue), n = hue.map(v => (v / top) * 255), lum = (0.2126 * n[0] + 0.7152 * n[1] + 0.0722 * n[2]) / 255;
  const k = Math.min(1, tone / Math.max(lum, 0.01));
  return `rgb(${n.map(v => Math.round(Math.max(0, Math.min(255, v * k)))).join(' ')})`;
}
const isTone = (value: unknown): value is PillTone => value === 'green' || value === 'amber' || value === 'red' || value === 'neutral' || value === 'new';

/** The tone a pill shows: its `data-tone`, else the option. */
export const pillTone = (pill: HTMLElement, fallback: PillTone): PillTone => (isTone(pill.dataset.tone) ? pill.dataset.tone : fallback);

export interface PillLane { x: number; y: number; w: number }
/**
 * Field cells tile the canvas from its top-left corner in whole device pixels. A pill's lane is the one cell row nearest its
 * centre, across the pill less 2px either side; the characters are drawn in whole cells inside it.
 */
export function pillLane(b: Box, cw: number, ch: number): PillLane {
  return { x: b.x + 2, y: Math.round((b.y + b.h / 2) / ch - 0.5) * ch, w: Math.max(0, b.w - 4) };
}
/** The field shows only through the lanes, each a stadium inside its pill, so a stray character can never reach a pill's edge. */
export function laneClip(lanes: PillLane[], ch: number) {
  const f = (n: number) => n.toFixed(2), r = ch / 2;
  const d = lanes.filter(l => l.w > 2 * r).map(({ x, y, w }) =>
    `M${f(x + r)} ${f(y)}H${f(x + w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w - r)} ${f(y + ch)}H${f(x + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(y)}Z`).join('');
  return d ? `path("${d}")` : 'inset(50%)';
}

/** The common ancestor of several elements. */
function container(elements: HTMLElement[]) {
  let root: HTMLElement | null = elements[0].parentElement;
  while (root && !elements.every(el => root!.contains(el))) root = root.parentElement;
  return root ?? document.body;
}

/**
 * Pills and badges whose characters stay inside them: a glyph dot in each status pill's tone that breathes while live, turns
 * while syncing and blinks on failure, a sparkle on `new` pills and rolling digits on count pills. One element gets a field under its text; a list shares one field over their common
 * container (one WebGL context for all), with each pill's labels lifted above it.
 */
export function pill(target: HTMLElement | Iterable<HTMLElement>, options: PillOptions = {}): PillHandle {
  const state = { current: { ...DEFAULTS, ...options } };
  const pills = target instanceof HTMLElement ? [target] : [...target];
  const single = pills.length === 1;
  const host = single ? pills[0] : pills.length ? container(pills) : null;
  const styles = styleKeeper();
  const tones = new Map<HTMLElement, { from: PillTone; to: PillTone; at: number }>();
  const sheens = new Map<HTMLElement, number>();
  const rolls = new Map<HTMLElement, { at: number; changed: boolean[] }>();
  const counts = new Map<HTMLElement, { text: string; live: HTMLElement; digits: HTMLElement }>();
  const undo: (() => void)[] = [];
  const kind = (el: HTMLElement) => (el.dataset.count !== undefined ? 'count' : pillTone(el, state.current.tone) === 'new' ? 'new' : 'status');
  const isLive = (el: HTMLElement) => (el.dataset.live !== undefined ? el.dataset.live !== 'false' : state.current.live);
  const read = (now = -1e6) => {
    for (const el of pills) {
      const next = pillTone(el, state.current.tone), seen = tones.get(el);
      if (!seen) tones.set(el, { from: next, to: next, at: -1e6 });
      else if (seen.to !== next) tones.set(el, { from: seen.to, to: next, at: now });
    }
  };
  read();
  const theme = () => (surface?.dark() ?? (host ? isDark(host) : true) ? 'dark' : 'light');
  const look = (): GlyphFieldOptions => ({
    mark: 'glyph', charset: RAMP[theme()], font: '"Geist Mono", ui-monospace, monospace', fontWeight: 500,
    cellSize: CELL, cellAspect: 1, glyphScale: 1, color: 'source', saturation: 1, shade: 0, ...state.current.look,
  });
  const cellOf = () => {
    const { cellSize = CELL, cellAspect = 1 } = look(), ratio = Math.min(2, globalThis.devicePixelRatio || 1), device = Math.max(2, Math.round(cellSize * ratio));
    return { ch: device / ratio, cw: Math.max(2, Math.round(device * cellAspect)) / ratio };
  };
  /*
   * The field's grid is moved under the first status dot (or the first pill), so in the usual layout, pills in a column, nothing
   * else moves. Any other pill off the grid is nudged by under half a cell, so its row and dot sit exactly on cells.
   */
  let grid: [number, number] = [0, 0];
  const nudges = new Map<HTMLElement, [number, number]>();
  /** `b` and `dot` as laid out, before any nudge. */
  const nudge = (el: HTMLElement, b: Box, dot: Box | null, cw: number, ch: number) => {
    const [ox, oy] = nudges.get(el) ?? [0, 0], snap = (v: number, c: number) => Math.round((v - c / 2) / c) * c + c / 2 - v;
    const dx = dot ? snap(dot.x + dot.w / 2, cw) : 0, dy = snap(b.y + b.h / 2, ch);
    if (Math.abs(dx - ox) > 0.01 || Math.abs(dy - oy) > 0.01) {
      nudges.set(el, [dx, dy]);
      styles.set(el, 'translate', `${dx.toFixed(2)}px ${dy.toFixed(2)}px`);
    }
    return { b: { ...b, x: b.x + dx, y: b.y + dy }, dot: dot && { ...dot, x: dot.x + dx, y: dot.y + dy } };
  };

  let surface: Surface | null = null, mask = '';
  surface = !host ? null : mountSurface({
    host,
    layer: single ? 'under' : 'over',
    look,
    ink: () => state.current.ink,
    kit: state,
    reducedMotion: () => state.current.reducedMotion,
    // Two source pixels per cell (the canvas is sized to whole cells in paint), so a glyph never leaves a ghost in its neighbours.
    resolution: (w, h) => { const { cw, ch } = cellOf(); return [Math.max(2, Math.round((w * 2) / cw)), Math.max(2, Math.round((h * 2) / ch))]; },
    onFail: () => { surface = null; restore(); },
    onTheme: () => surface?.field.update({ charset: RAMP[theme()] }),
    paint: ({ pen, now, still, dark, box, width, w }) => {
      const o = state.current, t = dark ? 'dark' : 'light', palette = { ...PILL_TONES[t], ...o.tones?.[t] }, at = (g: string, k?: number) => glyphAt(t, g, k);
      const { cw, ch } = cellOf(), scale = width / w;
      const put = (col: number, row: number, color: number[], level: number) => {
        if (level <= 0) return;
        pen.fillStyle = toned(color, level);
        pen.fillRect(Math.round((col + 0.5) * cw * scale) - 1, Math.round((row + 0.5) * ch * scale) - 1, 2, 2);
      };
      let busy = false;
      const dots = pills.map(el => (kind(el) !== 'count' && o.indicator ? el.querySelector<HTMLElement>('[data-dot]') : null));
      // Boxes in the host's frame, then the grid's offset: negative, so the canvas never spills past the host's right or bottom.
      const raw = pills.map((el, i) => {
        const b = box(el), d = dots[i] ? box(dots[i]!) : null, [ox, oy] = nudges.get(el) ?? [0, 0];
        const lift = (r: Box) => ({ ...r, x: r.x + grid[0] - ox, y: r.y + grid[1] - oy });
        return { b: lift(b), dot: d && lift(d) };
      });
      const anchor = raw.find((r, i) => r.dot && kind(pills[i]) === 'status') ?? raw.find(r => r.dot) ?? raw[0];
      if (anchor) {
        const off = (v: number, c: number) => { const m = (((v - c / 2) % c) + c) % c; return m > 1e-3 ? m - c : 0; };
        const next: [number, number] = [anchor.dot ? off(anchor.dot.x + anchor.dot.w / 2, cw) : 0, off(anchor.b.y + anchor.b.h / 2, ch)];
        if (Math.abs(next[0] - grid[0]) > 0.01 || Math.abs(next[1] - grid[1]) > 0.01) {
          grid = next;
          surface!.canvas.style.translate = `${grid[0].toFixed(2)}px ${grid[1].toFixed(2)}px`;
        }
      }
      // A canvas of whole cells, so each cell is exactly two source pixels and its glyph is sampled from its own pixels only.
      const css = surface!.canvas.style, fit = (size: number, g: number, c: number) => `${Math.max(1, Math.floor((size - g) / c)) * c}px`;
      const cols = fit(host!.clientWidth, grid[0], cw), rows = fit(host!.clientHeight, grid[1], ch);
      if (css.width !== cols || css.height !== rows) { css.width = cols; css.height = rows; surface!.field.resize(); busy = true; }
      const placed = raw.map((r, i) => {
        const shift = (x: Box) => ({ ...x, x: x.x - grid[0], y: x.y - grid[1] });
        return nudge(pills[i], shift(r.b), r.dot && shift(r.dot), cw, ch);
      });
      const boxes = placed.map(p => p.b);
      const lanes = boxes.map(b => pillLane(b, cw, ch)), clip = laneClip(lanes, ch);
      if (clip !== mask) { mask = clip; surface!.canvas.style.clipPath = clip; }
      pills.forEach((el, i) => {
        const lane = lanes[i], what = kind(el), row = Math.round(lane.y / ch), first = Math.ceil(lane.x / cw), last = Math.floor((lane.x + lane.w) / cw) - 1;
        if (last < first) return;
        if (what === 'status') {
          const dot = placed[i].dot;
          if (!dot) return;
          const tone = tones.get(el)!, since = now - tone.at, mixed = still ? 1 : easeOut(since / TONE);
          if (mixed < 1) busy = true;
          const color = mix(palette[tone.from], palette[tone.to], mixed), live = !still && isLive(el);
          const col = Math.floor((dot.x + dot.w / 2) / cw);
          const rest = t === 'light' ? 0.55 : 0.7, swing = t === 'light' ? 0.35 : 0.25;
          let level = tone.to === 'neutral' ? at('○') : tone.to === 'amber' && isLive(el) ? at('◐') : at('●', rest);
          if (tone.to === 'red' && !still && since < BLINK) {
            // A failure blinks the dot open twice as it lands.
            busy = true;
            if (Math.floor(since / (BLINK / 4)) % 2 === 0) level = at('○');
          } else if (live && tone.to === 'amber') {
            // Syncing: a half-filled dot turns clockwise.
            busy = true;
            level = at(SPIN[Math.floor((now + i * 90) / SPIN_MS) % 4]);
          } else if (live) {
            // Live: the dot breathes, deepening and brightening within its own glyph.
            busy = true;
            level = at('●', rest - swing * Math.cos(((now + i * 500) / BREATH) * Math.PI * 2));
          }
          if (col >= first && col <= last) put(col, row, color, level);
        } else if (what === 'new') {
          // A sparkle leads the label and twinkles when the pointer arrives.
          const dot = placed[i].dot;
          if (!dot) return;
          const p = Math.max(0, (now - (sheens.get(el) ?? -1e6)) / SHEEN_MS), col = Math.floor((dot.x + dot.w / 2) / cw);
          if (p < 1 && !still) busy = true;
          if (col >= first && col <= last) put(col, row, palette.new, at(p < 1 && !still ? TWINKLE[Math.floor(p * TWINKLE.length)] : '✦'));
        } else {
          const roll = rolls.get(el), digits = counts.get(el)?.digits.children;
          if (!digits) return;
          const k = roll ? (now - roll.at) / (ROLL + ROLL_STAGGER * 2) : 1;
          if (k >= 1 || still) { for (const d of digits) { (d as HTMLElement).style.opacity = ''; (d as HTMLElement).style.translate = ''; } return; }
          busy = true;
          [...digits].forEach((node, j) => {
            if (!roll!.changed[j]) return;
            const digit = node as HTMLElement, g = box(digit), p = (now - roll!.at - j * ROLL_STAGGER) / ROLL;
            // The real digit steps aside while its cell turns through the dots, then settles back in.
            const back = easeOut((p - 0.72) / 0.28);
            digit.style.opacity = String(back); digit.style.translate = `0 ${(back - 1) * 3}px`;
            if (p <= 0 || p >= 0.78) return;
            const c = Math.min(last, Math.max(first, Math.floor((g.x + g.w / 2) / cw)));
            put(c, row, palette.neutral, at(['·', '•', '○', '●'][Math.floor(p * 9) % 4]));
          });
        }
      });
      return busy;
    },
  });

  function restore() {
    while (undo.length) undo.pop()!();
    styles.restore();
  }
  const digitSpans = (text: string) => [...text].map(c => Object.assign(document.createElement('span'), { textContent: c === ' ' ? '' : c }));

  if (surface) {
    if (!single) surface.canvas.style.zIndex = '1';
    for (const el of pills) {
      const what = kind(el);
      if (what === 'count') {
        const text = (el.textContent ?? '').trim(), saved = [...el.childNodes];
        const live = srOnly(text), digits = document.createElement('span');
        digits.setAttribute('aria-hidden', 'true');
        styles.set(digits, 'display', 'inline-flex');
        digits.replaceChildren(...digitSpans(text));
        el.replaceChildren(live, digits);
        counts.set(el, { text, live, digits });
        undo.push(() => { const now = counts.get(el)?.text ?? text; if (now === text) el.replaceChildren(...saved); else el.textContent = now; });
      } else if (state.current.indicator && !el.querySelector('[data-dot]')) {
        const dot = document.createElement('span');
        dot.dataset.dot = '';
        dot.setAttribute('aria-hidden', 'true');
        dot.setAttribute('style', `display:inline-block;flex:none;width:${CELL}px;height:${CELL}px;margin-inline-end:4px;vertical-align:middle`);
        el.prepend(dot);
        undo.push(() => dot.remove());
      }
      // A shared field lies over the container, so each label rises above it; bare text is wrapped to be lifted.
      if (!single) {
        for (const node of [...el.childNodes]) {
          if (node.nodeType === 3 && node.textContent?.trim()) {
            const wrap = document.createElement('span');
            node.parentElement!.insertBefore(wrap, node);
            wrap.appendChild(node);
            undo.push(() => { wrap.parentElement?.insertBefore(node, wrap); wrap.remove(); });
            lift(wrap);
          } else if (node instanceof HTMLElement && node.dataset.dot === undefined) lift(node);
        }
      }
    }
    if (counts.size) void document.fonts?.ready.then(() => surface?.kick());
    host!.addEventListener('pointermove', over);
    host!.addEventListener('pointerleave', out);
  }
  function lift(el: HTMLElement) {
    if (getComputedStyle(el).position === 'static') styles.set(el, 'position', 'relative');
    styles.set(el, 'z-index', '2');
  }

  function sheen(el?: HTMLElement) {
    const now = performance.now();
    for (const p of el ? [el] : pills.filter(p => kind(p) === 'new')) sheens.set(p, now);
    surface?.kick();
  }
  // The pill under the pointer, from moves on the host, so a pointer already inside or a scripted one that only sends moves still twinkles the sparkle.
  let under: HTMLElement | null = null;
  function over(event: Event) {
    const target = event.target as Node | null, now = pills.find(p => target && p.contains(target)) ?? null;
    if (now === under) return;
    under = now;
    if (now && kind(now) === 'new' && state.current.sheen) sheen(now);
  }
  function out() { under = null; }
  const count = (value: number | string, el?: HTMLElement) => {
    const target = el ?? pills.find(p => kind(p) === 'count');
    if (!target) return;
    const next = String(value), entry = counts.get(target);
    if (!entry) { target.textContent = next; return; }
    if (next === entry.text) return;
    const n = Math.max(next.length, entry.text.length), a = entry.text.padStart(n, ' '), b = next.padStart(n, ' ');
    const still = surface?.still() ?? true;
    entry.text = next;
    entry.live.textContent = next;
    entry.digits.replaceChildren(...digitSpans(b));
    rolls.set(target, { at: still ? -1e6 : performance.now(), changed: [...b].map((c, i) => c !== a[i]) });
    surface?.kick();
  };
  const refresh = () => { read(performance.now()); surface?.kick(); };

  return handle(() => surface, state, () => { read(performance.now()); surface?.refresh(); }, { sheen, count, refresh }, () => {
    host?.removeEventListener('pointermove', over);
    host?.removeEventListener('pointerleave', out);
    restore();
  });
}

export const PILL_DEFAULTS = DEFAULTS;
