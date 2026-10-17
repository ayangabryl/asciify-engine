import type { GlyphFieldOptions } from '../field';
import { easeOut, handle, isDark, mountSurface, srOnly, styleKeeper, type Box, type KitHandle, type KitOptions, type Surface } from './core';

export type PillTone = 'green' | 'amber' | 'red' | 'neutral' | 'new';

export interface PillOptions extends KitOptions {
  /** The tone of a pill without `data-tone`. `new` is a solid pill that takes a sheen on hover. Default `neutral`. */
  tone?: PillTone;
  /** A live state such as Live or Syncing: the indicator breathes and a sweep crosses the pill every few seconds. `data-live` on a pill wins. Default false. */
  live?: boolean;
  /** A three-character indicator on status pills, drawn over the pill's `[data-dot]` element (one is added when missing). Default true. */
  indicator?: boolean;
  /** A gradient sheen of characters passes once across a `new` pill when the pointer enters it. Default true. */
  sheen?: boolean;
  /** Glyph hues to paint, as `[r, g, b]` 0–255, for the light and dark ground. */
  tones?: Partial<Record<'light' | 'dark', Partial<Record<PillTone, [number, number, number]>>>>;
}

export interface PillHandle extends KitHandle<PillOptions> {
  /** Runs the sheen once across one pill, or every `new` pill. */
  sheen(pill?: HTMLElement): void;
  /** Sets a count pill (`data-count`) to `value`; only the changed digits roll. Without `pill`, the first count pill. */
  count(value: number | string, pill?: HTMLElement): void;
  /** Re-reads each pill's `data-tone` and `data-live`; tone changes ease over 240ms. `update()` does this too. */
  refresh(): void;
}

const DEFAULTS = { tone: 'neutral' as PillTone, live: false, indicator: true, sheen: true };
/** Glyph hues painted into the source. The field normalises each hue and takes the glyph from its brightness. */
export const PILL_TONES: Record<'light' | 'dark', Record<PillTone, [number, number, number]>> = {
  light: { green: [22, 150, 82], amber: [200, 128, 10], red: [214, 52, 52], neutral: [120, 120, 114], new: [98, 72, 214] },
  dark: { green: [120, 240, 170], amber: [255, 206, 110], red: [255, 156, 156], neutral: [200, 200, 192], new: [180, 164, 255] },
};
/*
 * Paint levels run 0 (empty) to 1 (densest). Light grounds keep every tone under 0.32 and stretch the ramp over that range, so dense
 * characters stay dark enough to read on a pale tint. Leading spaces swallow the faint spill the field's sampling picks up from a neighbour.
 */
const RAMP = { light: { charset: '  .:+*' + '#'.repeat(15), top: 0.32 }, dark: { charset: '   .:+*' + '#'.repeat(4), top: 0.9 } };
const SHEEN = [[255, 130, 225], [205, 175, 255], [120, 215, 255]];
const CELL = 8, ASPECT = 0.6, BREATH = 1800, SWEEP_EVERY = 4200, SWEEP = 1100, ROLL = 460, ROLL_STAGGER = 70, SHEEN_MS = 900, TONE = 240;

const mix = (a: number[], b: number[], k: number) => a.map((v, i) => v + (b[i] - v) * k);
const gauss = (d: number, s: number) => Math.exp(-((d / s) ** 2));
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
 * Field cells tile the canvas from its top-left corner in whole device pixels. A pill's lane is the one cell row nearest its centre,
 * between the first and last whole columns that clear its rounded ends by 5px.
 */
export function pillLane(b: Box, cw: number, ch: number): PillLane {
  const y = Math.round((b.y + b.h / 2) / ch - 0.5) * ch, x = Math.ceil((b.x + 5) / cw) * cw, right = Math.floor((b.x + b.w - 5) / cw) * cw;
  return { x, y, w: Math.max(0, right - x) };
}
/** The field shows only through the lanes, so a stray character can never reach a pill's edge. */
export function laneClip(lanes: PillLane[], ch: number) {
  const f = (n: number) => n.toFixed(2), r = 2;
  const d = lanes.filter(l => l.w > 2 * r).map(({ x, y, w }) =>
    `M${f(x + r)} ${f(y)}H${f(x + w - r)}Q${f(x + w)} ${f(y)} ${f(x + w)} ${f(y + r)}V${f(y + ch - r)}Q${f(x + w)} ${f(y + ch)} ${f(x + w - r)} ${f(y + ch)}` +
    `H${f(x + r)}Q${f(x)} ${f(y + ch)} ${f(x)} ${f(y + ch - r)}V${f(y + r)}Q${f(x)} ${f(y)} ${f(x + r)} ${f(y)}Z`).join('');
  return d ? `path("${d}")` : 'inset(50%)';
}

/** The common ancestor of several elements. */
function container(elements: HTMLElement[]) {
  let root: HTMLElement | null = elements[0].parentElement;
  while (root && !elements.every(el => root!.contains(el))) root = root.parentElement;
  return root ?? document.body;
}

/**
 * Pills and badges with a strip of characters in their tone: a breathing live indicator, a sweep across live states, a sheen on
 * `new` pills and rolling digits on count pills. One element gets a field under its text; a list shares one field over their common
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
    mark: 'glyph', charset: RAMP[theme()].charset, font: '"Geist Mono", ui-monospace, monospace', fontWeight: 500,
    cellSize: CELL, cellAspect: ASPECT, glyphScale: 0.92, color: 'source', saturation: 1, shade: 0, ...state.current.look,
  });

  let surface: Surface | null = null, mask = '';
  surface = !host ? null : mountSurface({
    host,
    layer: single ? 'under' : 'over',
    look,
    ink: () => state.current.ink,
    kit: state,
    reducedMotion: () => state.current.reducedMotion,
    onFail: () => { surface = null; restore(); },
    onTheme: () => surface?.field.update({ charset: RAMP[theme()].charset }),
    paint: ({ pen, now, still, dark, box }) => {
      const o = state.current, t = dark ? 'dark' : 'light', palette = { ...PILL_TONES[t], ...o.tones?.[t] }, top = RAMP[t].top;
      const ratio = Math.min(2, globalThis.devicePixelRatio || 1), ch = Math.round(CELL * ratio) / ratio, cw = Math.round(CELL * ratio * ASPECT) / ratio;
      const colAt = (x: number) => Math.round(x / cw - 0.5) * cw;
      const fill = (c: number[], u: number) => toned(c, u * top);
      const lanes = pills.map(el => pillLane(box(el), cw, ch)), clip = laneClip(lanes, ch);
      if (clip !== mask) { mask = clip; surface!.canvas.style.clipPath = clip; }
      let busy = false;
      pills.forEach((el, i) => {
        const { x: x0, y: y0, w } = lanes[i], what = kind(el);
        if (w <= 0) return;
        pen.save();
        pen.beginPath(); pen.rect(x0, y0, w, ch); pen.clip();
        if (what === 'status') {
          const tone = tones.get(el)!, k = still ? 1 : easeOut((now - tone.at) / TONE);
          if (k < 1) busy = true;
          const color = mix(palette[tone.from], palette[tone.to], k), live = !still && isLive(el);
          // A fine halftone sweep crosses a live pill once every few seconds.
          if (live) {
            busy = true;
            const p = ((now + i * 1300) % SWEEP_EVERY) / SWEEP;
            if (p < 1) {
              const crest = x0 - 12 + easeOut(p) * (w + 24);
              for (let x = x0; x < x0 + w; x += 2) {
                const u = 0.42 * gauss(x - crest, 9);
                if (u > 0.05) { pen.fillStyle = fill(color, u); pen.fillRect(x, y0, 2, ch); }
              }
            }
          }
          // The indicator: three characters that breathe while the state is live, '.#.' out to '*#*'.
          const dot = el.querySelector<HTMLElement>('[data-dot]');
          if (dot && o.indicator) {
            const d = box(dot), c0 = colAt(d.x + d.w / 2);
            const breath = live ? 0.5 - 0.5 * Math.cos((now / BREATH) * Math.PI * 2) : 0.6;
            const core = tone.to === 'neutral' ? 0.7 : 1, side = core * (0.4 + 0.4 * breath);
            pen.fillStyle = fill(color, side); pen.fillRect(c0 - cw, y0, cw * 3, ch);
            pen.fillStyle = fill(color, core); pen.fillRect(c0, y0, cw, ch);
          }
        } else if (what === 'new') {
          // A gradient sheen of characters passes once across the solid pill; only bright tones, so each character is a clean pastel.
          const p = (now - (sheens.get(el) ?? -1e6)) / SHEEN_MS;
          if (p < 1 && !still) {
            busy = true;
            const crest = x0 - 20 + easeOut(p) * (w + 40), fade = Math.sin(Math.PI * Math.min(1, p * 1.15));
            for (let x = x0; x < x0 + w; x += 2) {
              const u = (x - x0) / w, hue = u < 0.5 ? mix(SHEEN[0], SHEEN[1], u * 2) : mix(SHEEN[1], SHEEN[2], u * 2 - 1);
              const level = fade * gauss(x - crest, 11);
              if (level > 0.2) { pen.fillStyle = toned(hue, 0.55 + 0.4 * level); pen.fillRect(x, y0, 2, ch); }
            }
          }
        } else {
          const roll = rolls.get(el), digits = counts.get(el)?.digits.children;
          const k = roll ? (now - roll.at) / (ROLL + ROLL_STAGGER * 2) : 1;
          if (digits) {
            if (k >= 1 || still) for (const d of digits) { (d as HTMLElement).style.opacity = ''; (d as HTMLElement).style.translate = ''; }
            else {
              busy = true;
              [...digits].forEach((node, j) => {
                if (!roll!.changed[j]) return;
                const digit = node as HTMLElement, g = box(digit), p = (now - roll!.at - j * ROLL_STAGGER) / ROLL;
                // The real digit steps aside while its slot rolls up the glyph ramp, then settles back in.
                const back = easeOut((p - 0.72) / 0.28);
                digit.style.opacity = String(back); digit.style.translate = `0 ${(back - 1) * 3}px`;
                if (p <= 0 || p >= 1) return;
                pen.fillStyle = fill(palette.neutral, (0.3 + 0.7 * ((p * 2.6) % 1)) * Math.min(1, (1 - p) / 0.3));
                pen.fillRect(g.x, y0, g.w, ch);
              });
            }
          }
        }
        pen.restore();
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
      } else if (what === 'status' && state.current.indicator && !el.querySelector('[data-dot]')) {
        const dot = document.createElement('span');
        dot.dataset.dot = '';
        dot.setAttribute('aria-hidden', 'true');
        dot.setAttribute('style', 'display:inline-block;flex:none;width:15px;height:8px;margin-inline-end:4px;vertical-align:middle');
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
  // The pill under the pointer, from moves on the host, so a pointer already inside or a scripted one that only sends moves still runs the sheen.
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
