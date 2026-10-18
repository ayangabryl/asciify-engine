import { samplePixel } from './sample-pixel';
import { createColorLookups, applyColorLookups } from './tone';
import { SourceDenoiser } from './denoise';
import { SourceWarpProcessor } from './warps';
import { isStudioPrintStyle } from './print-model';
import { createPrintPainter } from './print-renderer';
import { hasAmbientMotion, hasPatternMotion } from './activity';
import { sampleAmbient, scaleMotion, motionSource, isLightMotion } from '../surface/ambient-motion';
import { buildPhotoCues, PHOTO_CUE_STRIDE, type PhotoCues } from '../surface/photo-cues';
import {
  normalizeStudioSettings,
  studioCrop,
  studioGrid,
  type StudioSettings,
} from "./model";
import { ditherPixels, noise, rgb } from "./dither";
import { createStudioFinish } from "./finish";
import { WaterSurface, hoverTone, marksGround } from "../surface/water-surface";
import { buildHoverGuide, scopeWeight, type HoverGuide } from "../surface/hover-guide";
export type StudioSource =
  HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | ImageBitmap;
export function studioSourceSize(s: StudioSource): [number, number] {
  return "videoWidth" in s
    ? [s.videoWidth, s.videoHeight]
    : "naturalWidth" in s
      ? [s.naturalWidth, s.naturalHeight]
      : [s.width, s.height];
}
const surface = (readFrequently = false) => {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d", { willReadFrequently: readFrequently });
  if (!ctx) throw new Error("Canvas 2D is unavailable.");
  return { canvas: c, ctx };
};
const resize = (c: HTMLCanvasElement, w: number, h: number) => {
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
};
const ramps: Record<string, string> = {
  blocks: " ░▒▓█",
  braille: " ⠁⠃⠇⡇⣇⣧⣷⣿",
  lines: " -═╪╬",
  cross: " ·+xX#",
  diagonal: " /╱╳",
  diamond: " ·◇◈◆",
  mixed: " .:+/◇#@",
};
/** Ignore the darkest and brightest 1% so a few specular or black pixels do not decide the range. */
const LEVEL_LOW = 0.01, LEVEL_HIGH = 0.99;
/** Never stretch a flat source more than about 3x, which would only amplify noise. */
const LEVEL_MIN_SPAN = 0.32;
/** Stretched tones below this stay on the emptiest glyph. */
const BLANK_TONE = 0.07;
/** Mid-tone lift bounds: always a little, never more than lifting a dark subject's mean to about half ink. */
const INK_GAMMA_MIN = 0.6, INK_GAMMA_MAX = 0.9;
/** 1st and 99th luminance percentiles of the opaque sampled cells. */
export function studioLevels(pixels: Uint8ClampedArray): [number, number] {
  const bins = new Uint32Array(256);
  let total = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 8) continue;
    bins[Math.min(255, (pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114) | 0)]++;
    total++;
  }
  if (!total) return [0, 1];
  const at = (q: number) => {
    let seen = 0;
    const target = q * total;
    for (let v = 0; v < 256; v++) if ((seen += bins[v]) >= target) return v / 255;
    return 1;
  };
  let low = at(LEVEL_LOW), high = at(LEVEL_HIGH);
  if (high - low < LEVEL_MIN_SPAN) {
    low = Math.max(0, Math.min(1 - LEVEL_MIN_SPAN, (low + high) / 2 - LEVEL_MIN_SPAN / 2));
    high = low + LEVEL_MIN_SPAN;
  }
  return [low, high];
}
/**
 * Ink-aware gamma for the stretched tones: lifts the subject's mean tone (cells above the near-black ground)
 * toward half ink, within gentle bounds, so mid-tones land on glyphs with visible coverage. Bright sources keep
 * the mild minimum lift; it never darkens.
 */
export function studioToneGamma(pixels: Uint8ClampedArray, low: number, high: number): number {
  const span = Math.max(1e-3, high - low);
  let sum = 0, count = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 8) continue;
    const t = ((pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114) / 255 - low) / span;
    if (t <= 0.06) continue;
    sum += Math.min(1, t);
    count++;
  }
  if (!count) return INK_GAMMA_MAX;
  const mean = Math.min(0.99, Math.max(0.01, sum / count));
  return Math.min(INK_GAMMA_MAX, Math.max(INK_GAMMA_MIN, Math.log(0.5) / Math.log(mean)));
}
/**
 * Tone (0–255) to glyph index by measured ink: each glyph's coverage is normalised across the ramp and every tone
 * takes the glyph whose ink is nearest, after the mid-tone lift. Returns null when the coverage cannot be read.
 */
export function inkIndexLookup(coverage: number[], gamma = INK_GAMMA_MAX): Uint8Array | null {
  const min = Math.min(...coverage), max = Math.max(...coverage);
  if (!(max - min > 1e-4)) return null;
  const normal = coverage.map((value) => (value - min) / (max - min));
  const lookup = new Uint8Array(256);
  for (let t = 0; t < 256; t++) {
    // The ground stays empty: the lift applies to the subject, not to near-black, or dark grounds fill with dots.
    if (t / 255 < BLANK_TONE) { lookup[t] = normal.indexOf(0); continue; }
    const target = Math.pow(t / 255, gamma);
    let best = 0;
    for (let i = 1; i < normal.length; i++)
      if (Math.abs(normal[i] - target) < Math.abs(normal[best] - target)) best = i;
    lookup[t] = best;
  }
  return lookup;
}
/** Draws mask shapes in white at w×h. */
function paintMask(mc: CanvasRenderingContext2D, w: number, h: number, shapes: StudioSettings["mask"]["shapes"]) {
  mc.clearRect(0, 0, w, h);
  mc.fillStyle = "#fff";
  mc.strokeStyle = "#fff";
  mc.lineCap = "round";
  mc.lineJoin = "round";
  for (const s of shapes) {
    mc.beginPath();
    if (s.kind === "ellipse")
      mc.ellipse(
        (s.x + s.width / 2) * w,
        (s.y + s.height / 2) * h,
        (s.width * w) / 2,
        (s.height * h) / 2,
        0,
        0,
        Math.PI * 2,
      );
    else if (s.kind === "rectangle")
      mc.rect(s.x * w, s.y * h, s.width * w, s.height * h);
    else {
      mc.lineWidth = (s.size ?? 0.05) * w;
      if (s.points?.length === 1) {
        mc.arc(
          s.points[0][0] * w,
          s.points[0][1] * h,
          mc.lineWidth / 2,
          0,
          Math.PI * 2,
        );
        mc.fill();
        continue;
      }
      s.points?.forEach(([x, y], i) =>
        i ? mc.lineTo(x * w, y * h) : mc.moveTo(x * w, y * h),
      );
      mc.stroke();
      continue;
    }
    mc.fill();
  }
}
/** Reusable bounded renderer. Call configure only when settings change; render owns no RAF. */
export function createStudioRenderer(
  canvas: HTMLCanvasElement,
  settings: unknown = {},
  limits: {
    maxDimension?: number;
    maxCells?: number;
    pixelRatio?: number;
  } = {},
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is already owned by another renderer.");
  const scene = surface(),
    sample = surface(true),
    art = surface(),
    composite = surface(),
    mask = surface(),
    tiny = surface(),
    atlas = surface(),
    inkMask = surface(),
    glow = surface(),
    stud = surface();
  let studSize = 0;
  // Auto levels: the current source's tonal range, eased over time for video so it never flickers.
  let levelLow = 0, levelHigh = 1, levelGamma = INK_GAMMA_MAX, levelSource: unknown = null;
  let inkCoverage: number[] | null = null, inkLookup: Uint8Array | null = null, inkKey = "";
  let finish: ReturnType<typeof createStudioFinish> | undefined;
  let state = normalizeStudioSettings(settings),
    revision = 0,
    prepared = "",
    ditherCacheKey = "",
    compositionCacheKey = "",
    pixels: Uint8ClampedArray = new Uint8ClampedArray(0),
    photo: Uint8ClampedArray = new Uint8ClampedArray(0),
    motionPixels: Uint8ClampedArray = new Uint8ClampedArray(0),
    cues: PhotoCues | null = null,
    cuesKey = "",
    cols = 0,
    rows = 0,
    last = 0;
  let sourceIdentity: StudioSource | null = null,
    atlasKey = "";
  let flow = new WaterSurface();
  // Subject coverage for scoped hovers and depth for Tilt, at the cell grid. Built only when a hover needs it.
  let guide: HoverGuide | null = null, guideCells = new Float32Array(0);
  const maskSample = surface(true), scopeLayer = surface(), revealLayer = surface();
  let aspect = 0;
  const field = [0, 0, 0];
  const ambient = [0, 0, 0, 1], moved = [0, 0];
  const sampled = [0, 0, 0, 0];
  let toneLookup = createColorLookups(state.color);
  let printPainter = createPrintPainter(state.print);
  const denoiser = new SourceDenoiser(state.color.denoise);
  const warper = new SourceWarpProcessor(state.warps,state.warpEdge);
  const maxDimension = Math.max(
      64,
      Math.min(
        4096,
        Number.isFinite(limits.maxDimension) ? limits.maxDimension! : 960,
      ),
    ),
    maxCells = Math.max(
      256,
      Math.min(
        1048576,
        Number.isFinite(limits.maxCells) ? limits.maxCells! : 12000,
      ),
    );
  let budgetCells = maxCells;
  let pixelRatio = Math.max(0.1, Math.min(8, limits.pixelRatio ?? 1));
  const pointer = (x: number, y: number, time: number) => {
    flow.configure(
      state.hover.effect,
      state.hover.strength,
      state.hover.radius,
      state.hover.edgeSafe,
      state.hover.decay,
    );
    flow.move(x, y, time);
  };
  function render(
    source: StudioSource,
    time = 0,
    requestedWidth = 960,
    requestedHeight = 540,
    motionTime = time * state.motion.speed,
  ) {
    if (!Number.isFinite(time)) time = 0;
    if (
      !Number.isFinite(requestedWidth) ||
      !Number.isFinite(requestedHeight) ||
      requestedWidth < 1 ||
      requestedHeight < 1
    )
      throw new Error("Render dimensions must be positive finite numbers.");
    const [sw, sh] = studioSourceSize(source);
    if (!sw || !sh) return;
    const fit = Math.min(
      1,
      maxDimension / Math.max(requestedWidth, requestedHeight),
    );
    const w = Math.max(2, Math.round(requestedWidth * fit)),
      h = Math.max(2, Math.round(requestedHeight * fit));
    resize(canvas, w, h);
    resize(scene.canvas, w, h);
    resize(art.canvas, w, h);
    resize(composite.canvas, w, h);
    resize(mask.canvas, w, h);
    if (aspect !== w / h) {
      aspect = w / h;
      flow = new WaterSurface(aspect);
      flow.setGuide(guide);
    }
    flow.configure(
      state.hover.effect,
      state.hover.strength,
      state.hover.radius,
      state.hover.edgeSafe,
      state.hover.decay,
    );
    flow.step(Math.max(0, Math.min(0.05, time - last)));
    last = time;
    const mediaTime =
      "currentTime" in source
        ? (source.getVideoPlaybackQuality?.().totalVideoFrames ??
          source.currentTime)
        : 0;
    const key = [revision, w, h, mediaTime].join(":");
    const isDither = state.style === "dither";
    const grid = studioGrid(w, h, state, budgetCells, pixelRatio);
    const cell = grid.cell, ch = grid.rowHeight;
    const nextCols = grid.columns, nextRows = grid.rows;
    if (
      prepared !== key ||
      sourceIdentity !== source ||
      cols !== nextCols ||
      rows !== nextRows
    ) {
      sourceIdentity = source;
      prepared = key;
      // A new grid (an adaptive budget change keeps the key) needs its own photo cues.
      cuesKey = "";
      ditherCacheKey = "";
      compositionCacheKey = "";
      cols = nextCols;
      rows = nextRows;
      scene.ctx.clearRect(0, 0, w, h);
      scene.ctx.save();
      const c = studioCrop(sw, sh, w, h, state.crop);
      scene.ctx.translate(c.x + c.width / 2, c.y + c.height / 2);
      scene.ctx.rotate((state.crop.rotation * Math.PI) / 180);
      scene.ctx.drawImage(
        source,
        (-sw * c.scale) / 2,
        (-sh * c.scale) / 2,
        sw * c.scale,
        sh * c.scale,
      );
      scene.ctx.restore();
      resize(sample.canvas, cols, rows);
      sample.ctx.clearRect(0, 0, cols, rows);
      sample.ctx.drawImage(scene.canvas, 0, 0, cols, rows);
      pixels = sample.ctx.getImageData(0, 0, cols, rows).data;
      denoiser.apply(pixels, cols, rows);
      // Motion reads the photograph before grading: contrast can clip a waterfall or a sky to flat white.
      if (photo.length !== pixels.length) photo = new Uint8ClampedArray(pixels.length);
      photo.set(pixels);
      const g = state.color;
      for (let i = 0; i < pixels.length; i += 4) {
        const lum =
          pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
        for (let j = 0; j < 3; j++) {
          const saturated = lum + (pixels[i + j] - lum) * g.saturation;
          pixels[i + j] =
            ((saturated * (1 - g.grayscale) + lum * g.grayscale) / 255 - 0.5) *
              g.contrast *
              255 +
            127.5 +
            g.brightness * 255;
        }
      }
      if (toneLookup) applyColorLookups(pixels, toneLookup);
      pixels = warper.apply(pixels,cols,rows,w/h);
      if (state.color.levels !== "none") {
        const [low, high] = studioLevels(pixels);
        const gamma = studioToneGamma(pixels, low, high);
        // A new still snaps to its own range; a playing video eases toward each frame's range.
        const ease = levelSource === source && "currentTime" in source ? 0.15 : 1;
        levelSource = source;
        levelLow += (low - levelLow) * ease;
        levelHigh += (high - levelHigh) * ease;
        levelGamma += (gamma - levelGamma) * ease;
      }
      const hv = state.hover, scope = hv.scope ?? "all";
      if (hv.effect !== "none" && (scope !== "all" || hv.effect === "tilt")) {
        let cover: Float32Array | null = null;
        if (state.mask.enabled && state.mask.shapes.length) {
          resize(maskSample.canvas, cols, rows);
          maskSample.ctx.clearRect(0, 0, cols, rows);
          paintMask(maskSample.ctx, cols, rows, state.mask.shapes);
          const m = maskSample.ctx.getImageData(0, 0, cols, rows).data;
          cover = new Float32Array(cols * rows);
          for (let i = 0; i < cover.length; i++) cover[i] = state.mask.invert ? 1 - m[i * 4 + 3] / 255 : m[i * 4 + 3] / 255;
        }
        guide = buildHoverGuide(pixels, cols, rows, cover, guide);
        if (guideCells.length !== cols * rows) guideCells = new Float32Array(cols * rows);
        for (let i = 0; i < guideCells.length; i++) guideCells[i] = scopeWeight(scope, guide.subject[i], guide.key);
        if (hv.effect === "reveal") {
          resize(scopeLayer.canvas, cols, rows);
          const layer = new ImageData(cols, rows);
          for (let i = 0; i < guideCells.length; i++) layer.data[i * 4 + 3] = guideCells[i] * 255;
          scopeLayer.ctx.putImageData(layer, 0, 0);
        }
      } else guide = null;
      flow.setGuide(guide);
    }
    // Post-processing changes time, not the underlying still composition. Reuse
    // that layer until media, layout, settings or a live field changes it.
    const stillMotion = hasAmbientMotion(state);
    const patternMotion = hasPatternMotion(state);
    const stableComposition = !flow.active && !stillMotion && !patternMotion;
    // A resting cursor hover (a loupe held still) stays drawn, so its pose is part of the cached composition.
    const compositionKey = [key, cols, rows, cell, ch, pixelRatio, flow.signature].join(":");
    const live = flow.engaged, effect = flow.effect;
    if (!stableComposition || compositionCacheKey !== compositionKey) {
      art.ctx.clearRect(0, 0, w, h);
      art.ctx.globalAlpha = 1;
      art.ctx.globalCompositeOperation = "source-over";
      const phase = motionTime;
      const motion = stillMotion ? state.motion.type : "none";
      const motionAmount = state.motion.amount ?? 1;
      const lightMotion = isLightMotion(motion);
      // Motion reads the photo's own light and depth: built once per source frame, not per tick.
      if (motion !== "none" && cuesKey !== prepared) { cues = buildPhotoCues(photo, cols, rows, cues); cuesKey = prepared; }
      if (isDither) {
        const stableDither = stableComposition;
        if (!stableDither || ditherCacheKey !== key) {
          if (motionPixels.length !== pixels.length) motionPixels = new Uint8ClampedArray(pixels.length);
          const data = motionPixels;
          data.set(pixels);
          if (live || motion !== "none") {
            for (let y = 0; y < rows; y++)
              for (let x = 0; x < cols; x++) {
                const u = x / cols,
                  v = y / rows;
                let sx = x,
                  sy = y,
                  energy = 0,
                  shift = 0,
                  alpha = 1;
                if (live) {
                  flow.sample(u, v, field);
                  const weight = guide ? guideCells[y * cols + x] : 1;
                  sx -= field[0] * weight * cols;
                  sy -= field[1] * weight * rows;
                  if (effect === "reveal") alpha = 1 - .72 * Math.min(1, field[2] * weight);
                  else if (effect === "repel") alpha = 1 + Math.max(-1, field[2]) * weight;
                  else energy = field[2] / 3 * weight;
                }
                const toneIndex = (y * cols + x) * 4;
                sampleAmbient(motion, u, v, phase, ambient, (pixels[toneIndex]*.299+pixels[toneIndex+1]*.587+pixels[toneIndex+2]*.114)/255, cues ?? undefined, (y * cols + x) * PHOTO_CUE_STRIDE);
                scaleMotion(ambient, motionAmount);
                if (ambient[0] || ambient[1]) { motionSource(ambient, sx, sy, cols, rows, moved); sx = moved[0]; sy = moved[1]; }
                shift = ambient[2];
                alpha *= ambient[3];
                // Sub-cell advection must interpolate; rounding creates visible stepping.
                const i = (y * cols + x) * 4;
                samplePixel(pixels,cols,rows,sx,sy,sampled);
                for (let c = 0; c < 3; c++) {
                  const tone = sampled[c] / 255;
                  let value = hoverTone(effect, tone, energy) + shift;
                  data[i + c] = value * 255;
                }
                data[i + 3] = sampled[3] * alpha;
              }
          }
          ditherPixels(data, cols, rows, state.dither, time);
          sample.ctx.putImageData(new ImageData(data, cols, rows), 0, 0);
          ditherCacheKey = stableDither ? key : "";
        }
        art.ctx.imageSmoothingEnabled = false;
        art.ctx.drawImage(sample.canvas, 0, 0, w, h);
      } else {
        const chars = Array.from(ramps[state.style] ?? state.charset),
          ac = art.ctx;
        const accent = rgb(state.ink);
        const rings = effect === "ripple" || effect === "etch";
        const ringInk = rings && accent[0] * .299 + accent[1] * .587 + accent[2] * .114 < 90 ? [214, 214, 214] : accent;
        const glyphMode = state.style === "ascii" || !!ramps[state.style];
        const printStyle = isStudioPrintStyle(state.style) ? state.style : null;
        const font = Math.max(3, Math.round(ch * 0.92)),
          aw = Math.ceil(cell + 4),
          ah = Math.ceil(ch + 4);
        const akey = [
          chars.join(""),
          font,
          aw,
          ah,
          state.ink,
          state.colorMode,
        ].join(":");
        if (glyphMode && akey !== atlasKey) {
          atlasKey = akey;
          resize(atlas.canvas, aw * chars.length, ah);
          atlas.ctx.clearRect(0, 0, atlas.canvas.width, ah);
          atlas.ctx.font = `${font}px monospace`;
          atlas.ctx.textBaseline = "middle";
          atlas.ctx.textAlign = "center";
          atlas.ctx.fillStyle =
            state.colorMode === "accent" ? state.ink : "#ffffff";
          chars.forEach((char, i) =>
            atlas.ctx.fillText(char, i * aw + aw / 2, ah / 2),
          );
          // Measure each glyph's ink once per atlas, for tone-to-glyph matching.
          inkCoverage = null;
          inkKey = "";
          try {
            const ink = atlas.ctx.getImageData(0, 0, atlas.canvas.width, atlas.canvas.height).data;
            inkCoverage = chars.map((_, g) => {
              let sum = 0;
              for (let yy = 0; yy < atlas.canvas.height; yy++)
                for (let xx = g * aw; xx < (g + 1) * aw && xx < atlas.canvas.width; xx++)
                  sum += ink[(yy * atlas.canvas.width + xx) * 4 + 3];
              return sum;
            });
          } catch { inkCoverage = null; }
        }
        const autoTone = glyphMode && state.color.levels !== "none";
        if (autoTone && inkCoverage) {
          const key = atlasKey + ":" + levelGamma.toFixed(2);
          if (key !== inkKey) { inkKey = key; inkLookup = inkIndexLookup(inkCoverage, levelGamma); }
        }
        const levelSpan = Math.max(1e-3, levelHigh - levelLow);
        if (state.style === 'lego' && studSize !== cell) {
          studSize = cell;
          resize(stud.canvas, Math.ceil(cell), Math.ceil(ch));
          const sc = stud.ctx;
          sc.clearRect(0,0,stud.canvas.width,stud.canvas.height);
          sc.fillStyle = 'rgba(255,255,255,.2)';
          sc.strokeStyle = 'rgba(0,0,0,.25)';
          sc.lineWidth = Math.max(.5, pixelRatio * .6);
          sc.beginPath(); sc.arc(cell/2,ch/2,cell*.28,0,Math.PI*2); sc.fill(); sc.stroke();
        }
        ac.font = `${font}px monospace`;
        ac.textBaseline = "middle";
        ac.textAlign = "center";
        for (let y = 0; y < rows; y++)
          for (let x = 0; x < cols; x++) {
            let sx = x,
              sy = y,
              energy = 0,
              fade = 0;
            if (live) {
              flow.sample(x / cols, y / rows, field);
              const weight = guide ? guideCells[y * cols + x] : 1;
              sx = Math.max(0, Math.min(cols - 1, x - field[0] * weight * cols));
              sy = Math.max(0, Math.min(rows - 1, y - field[1] * weight * rows));
              if (effect === "reveal") fade = Math.min(1, field[2] * weight) * .72;
              else if (effect === "repel") fade = -Math.max(-1, field[2]) * weight;
              else energy = field[2] / 3 * weight;
            }
            if (motion !== "none") {
              // Displacing motions move the image through a fixed grid, so every character stays aligned and readable.
              const ti = (y * cols + x) * 4;
              sampleAmbient(motion, x / cols, y / rows, phase, ambient, (pixels[ti] * .299 + pixels[ti + 1] * .587 + pixels[ti + 2] * .114) / 255, cues ?? undefined, (y * cols + x) * PHOTO_CUE_STRIDE);
              scaleMotion(ambient, motionAmount);
              if (ambient[0] || ambient[1]) {
                motionSource(ambient, sx, sy, cols, rows, moved); sx = moved[0]; sy = moved[1];
              }
            }
            samplePixel(pixels, cols, rows, sx, sy, sampled);
            // Rings drawn on an empty or near-black ground, where a tone lift alone would barely show.
            let ring = 0;
            if (rings && energy > .012 && (sampled[3] ? sampled[3] > 250 && sampled[0] * .299 + sampled[1] * .587 + sampled[2] * .114 < 30 : state.hover.scope === "outside")) {
              const t = Math.min(1, (energy - .012) / .12); ring = t * t * (3 - 2 * t);
            }
            if (!sampled[3]) {
              // Scoped "Around": tone hovers draw their own marks on a transparent ground, in the ink colour.
              if (!((ring || energy > .03) && state.hover.scope === "outside" && marksGround(effect))) continue;
              sampled[0] = ringInk[0]; sampled[1] = ringInk[1]; sampled[2] = ringInk[2];
              sampled[3] = ring ? 255 : Math.min(255, energy * 640);
            }
            const r = sampled[0], g = sampled[1], b = sampled[2];
            const sourceLum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
            let lum = autoTone ? Math.max(0, Math.min(1, (sourceLum - levelLow) / levelSpan)) : sourceLum;
            lum = hoverTone(effect, lum, energy, !!printStyle && printPainter.settings.invert);
            const px = x * cell,
              py = y * ch;
            let alpha = 1;
            // Tone shifts are in source units; auto levels stretch them with the image's own range.
            let glyphLum = lum;
            if (motion !== "none") {
              const shift = ambient[2] / (autoTone ? Math.max(.5, levelSpan) : 1);
              lum = Math.max(0, Math.min(1, lum + shift));
              // Light mostly brightens the ink; characters change density only for part of it, so light glows rather than flickers.
              glyphLum = Math.max(0, Math.min(1, glyphLum + shift * (lightMotion ? .45 : 1)));
            } else glyphLum = lum;
            if (ring) { lum = glyphLum = Math.max(lum, .1 + ring * .45); }
            alpha = (motion !== "none" ? ambient[3] : 1) * sampled[3] / 255 * (1 - fade) * (ring ? .3 + ring * .45 : 1);
            if (!glyphMode && !printStyle && state.colorMode === "accent" && state.style !== "cmyk") alpha *= lum;
            // With one ink, density alone carries tone and a lit subject flattens into a uniform wash. Auto levels
            // let brightness carry it too: quiet glyphs in the shadows, full ink on the lights.
            else if (autoTone && state.colorMode === "accent") alpha *= 0.32 + 0.68 * Math.pow(lum, levelGamma);
            ac.globalAlpha = alpha;
            const toneDelta = (lum - sourceLum) * 255;
            const ink =
              state.colorMode === "source"
                ? `rgb(${r + toneDelta},${g + toneDelta},${b + toneDelta})`
                : state.colorMode === "gray"
                  ? `rgb(${Math.round(lum * 255)},${Math.round(lum * 255)},${Math.round(lum * 255)})`
                  : state.ink;
            ac.fillStyle = ink;
            if (printStyle) {
              printPainter.paint(ac, printStyle, x, y, px, py, cell, lum, ink,
                state.colorMode === 'gray' ? lum * 255 : r + toneDelta,
                state.colorMode === 'gray' ? lum * 255 : g + toneDelta,
                state.colorMode === 'gray' ? lum * 255 : b + toneDelta, state.colorMode);
            } else if (glyphMode) {
              const index = autoTone && inkLookup
                ? inkLookup[Math.round(glyphLum * 255)]
                : Math.max(0, Math.min(chars.length - 1, Math.round(glyphLum * (chars.length - 1))));
              if (state.colorMode === "accent")
                ac.drawImage(
                  atlas.canvas,
                  index * aw,
                  0,
                  aw,
                  ah,
                  Math.round(px + (cell - aw) / 2),
                  Math.round(py + (ch - ah) / 2),
                  aw,
                  ah,
                );
              else ac.fillText(chars[index], px + cell / 2, py + ch / 2);
            } else if (state.style === "dots") {
              ac.beginPath();
              ac.arc(
                px + cell / 2,
                py + ch / 2,
                cell * 0.48 * Math.sqrt(lum),
                0,
                Math.PI * 2,
              );
              ac.fill();
            } else if (state.style === "led") {
              // Individual circular emitters, separated by an unlit matrix.
              ac.beginPath(); ac.arc(px + cell/2, py + ch/2, cell*.39, 0, Math.PI*2); ac.fill();
              ac.globalAlpha = alpha*.35;
              ac.fillStyle = "#ffffff";
              ac.beginPath(); ac.arc(px + cell*.43, py + ch*.4, cell*.11, 0, Math.PI*2); ac.fill();
            } else if (state.style === "hex") {
              const cx = px + cell/2, cy = py + ch/2;
              ac.beginPath();
              for (let side=0; side<6; side++) {
                const angle = Math.PI/3*side;
                const hx = cx + Math.cos(angle)*cell*.49, hy = cy + Math.sin(angle)*ch*.49;
                if (side===0) ac.moveTo(hx,hy); else ac.lineTo(hx,hy);
              }
              ac.closePath(); ac.fill();
            } else if (state.style === "cmyk") {
              // Four offset subtractive ink screens on a paper cell.
              ac.fillStyle = "#ffffff"; ac.fillRect(px, py, cell, ch);
              // The ink screens must use the same graded, animated tone as other
              // renderers, rather than bypassing hover and motion with source RGB.
              const inkChannel = (value: number, accentValue: number) => Math.max(0, Math.min(255,
                state.colorMode === "source" ? value + toneDelta : state.colorMode === "gray" ? lum * 255 : accentValue * lum));
              const cr = inkChannel(r, accent[0]), cg = inkChannel(g, accent[1]), cb = inkChannel(b, accent[2]);
              const black = 1 - Math.max(cr,cg,cb)/255;
              const denominator = Math.max(.001,1-black);
              const inks = [
                ["#00ffff", (1-cr/255-black)/denominator, .36, .36],
                ["#ff00ff", (1-cg/255-black)/denominator, .64, .36],
                ["#ffff00", (1-cb/255-black)/denominator, .5, .66],
                ["#000000", black, .5, .5],
              ] as const;
              ac.globalCompositeOperation = "multiply";
              for (const [color, density, ox, oy] of inks) {
                ac.fillStyle = color; ac.beginPath();
                ac.arc(px+cell*ox, py+ch*oy, cell*.48*Math.sqrt(Math.max(0,density)),0,Math.PI*2); ac.fill();
              }
              ac.globalCompositeOperation = "source-over";
            } else if (state.style === "voxel") {
              const vx = px + cell / 2,
                vy = py + ch / 2;
              ac.beginPath();
              ac.moveTo(vx, py);
              ac.lineTo(px + cell, py + ch * 0.25);
              ac.lineTo(vx, vy);
              ac.lineTo(px, py + ch * 0.25);
              ac.closePath();
              ac.fill();
              ac.globalAlpha = alpha * 0.72;
              ac.beginPath();
              ac.moveTo(px, py + ch * 0.25);
              ac.lineTo(vx, vy);
              ac.lineTo(vx, py + ch);
              ac.lineTo(px, py + ch * 0.75);
              ac.closePath();
              ac.fill();
              ac.globalAlpha = alpha * 0.42;
              ac.beginPath();
              ac.moveTo(vx, vy);
              ac.lineTo(px + cell, py + ch * 0.25);
              ac.lineTo(px + cell, py + ch * 0.75);
              ac.lineTo(vx, py + ch);
              ac.closePath();
              ac.fill();
            } else {
              const gap =
                state.style === "pixel" ? 0 : Math.max(0.5, cell * 0.06);
              ac.fillRect(px, py, cell - gap, ch - gap);
              if (state.style === "lego") {
                ac.drawImage(stud.canvas, px, py);
              }
              if (state.style === "disco") {
                ac.fillStyle = `rgba(255,255,255,${0.1 + noise(x, y) * 0.25})`;
                ac.fillRect(px, py, cell - gap, ch * 0.35);
                ac.fillStyle = "rgba(0,0,0,.25)";
                ac.fillRect(px, py + ch * 0.65, cell - gap, ch * 0.35 - gap);
              }
            }
          }
      }
      art.ctx.globalAlpha = 1;
      if (state.color.amount || state.lights.length) {
        resize(inkMask.canvas, w, h);
        inkMask.ctx.clearRect(0, 0, w, h);
        inkMask.ctx.drawImage(art.canvas, 0, 0);
      }
      if (state.color.amount) {
        art.ctx.save();
        art.ctx.globalCompositeOperation = state.color.blend;
        art.ctx.globalAlpha = state.color.amount;
        art.ctx.fillStyle = state.color.tint;
        art.ctx.fillRect(0, 0, w, h);
        art.ctx.restore();
      }
      for (const l of state.lights) {
        const r = l.radius * Math.max(w, h),
          gradient = art.ctx.createRadialGradient(
            l.x * w,
            l.y * h,
            0,
            l.x * w,
            l.y * h,
            r,
          );
        gradient.addColorStop(0, l.color);
        gradient.addColorStop(1, "transparent");
        art.ctx.save();
        art.ctx.globalCompositeOperation = "screen";
        art.ctx.globalAlpha = l.intensity;
        art.ctx.fillStyle = gradient;
        art.ctx.fillRect(0, 0, w, h);
        art.ctx.restore();
      }
      if (state.color.amount || state.lights.length) {
        art.ctx.globalCompositeOperation = "destination-in";
        art.ctx.drawImage(inkMask.canvas, 0, 0);
        art.ctx.globalCompositeOperation = "source-over";
      }
      if (state.mask.enabled && state.mask.shapes.length) {
        paintMask(mask.ctx, w, h, state.mask.shapes);
        art.ctx.globalCompositeOperation = state.mask.invert
          ? "destination-out"
          : "destination-in";
        art.ctx.drawImage(mask.canvas, 0, 0);
        art.ctx.globalCompositeOperation = "source-over";
      }
      const out = composite.ctx;
      out.clearRect(0, 0, w, h);
      out.globalAlpha = state.backdrop.opacity;
      const back = state.backdrop;
      if (back.mode === "solid") {
        out.fillStyle = back.color;
        out.fillRect(0, 0, w, h);
      }
      if (back.mode === "gradient") {
        const g = out.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, back.color);
        g.addColorStop(1, back.color2);
        out.fillStyle = g;
        out.fillRect(0, 0, w, h);
      }
      if (back.mode === "source") out.drawImage(scene.canvas, 0, 0);
      if (back.mode === "blurred") {
        const factor = Math.max(1, back.blur);
        resize(
          tiny.canvas,
          Math.max(2, Math.round(w / factor)),
          Math.max(2, Math.round(h / factor)),
        );
        tiny.ctx.drawImage(
          scene.canvas,
          0,
          0,
          tiny.canvas.width,
          tiny.canvas.height,
        );
        out.imageSmoothingEnabled = true;
        out.drawImage(tiny.canvas, 0, 0, w, h);
      }
      out.globalAlpha = 1;
      if (state.effects.characterBloom > 0) {
        resize(
          glow.canvas,
          Math.max(2, Math.round(w / 3)),
          Math.max(2, Math.round(h / 3)),
        );
        glow.ctx.clearRect(0, 0, glow.canvas.width, glow.canvas.height);
        glow.ctx.drawImage(
          art.canvas,
          0,
          0,
          glow.canvas.width,
          glow.canvas.height,
        );
        out.save();
        out.globalAlpha = state.effects.characterBloom * 0.8;
        out.globalCompositeOperation = "screen";
        out.filter = `blur(${1 + state.effects.characterBloom * 4}px)`;
        out.drawImage(glow.canvas, 0, 0, w, h);
        out.restore();
      }
      const spot = flow.spotlight;
      if (spot && spot[2] > .002) {
        // Reveal: the photograph under the characters, through a soft spotlight and the hover's scope.
        resize(revealLayer.canvas, w, h);
        const rc = revealLayer.ctx, r = spot[3] * Math.min(w, h) * 1.6;
        rc.globalCompositeOperation = "source-over";
        rc.clearRect(0, 0, w, h);
        rc.drawImage(scene.canvas, 0, 0);
        rc.globalCompositeOperation = "destination-in";
        const g = rc.createRadialGradient(spot[0] * w, spot[1] * h, 0, spot[0] * w, spot[1] * h, r);
        const a = Math.min(1, spot[2] * state.hover.strength / .55);
        for (const q of [0, .2, .4, .6, .8, 1]) g.addColorStop(q, `rgba(0,0,0,${a * Math.exp(-2.4 * (q * 1.6) ** 2) * (1 - q)})`);
        rc.fillStyle = g;
        rc.fillRect(0, 0, w, h);
        if (guide && (state.hover.scope ?? "all") !== "all") { rc.imageSmoothingEnabled = true; rc.drawImage(scopeLayer.canvas, 0, 0, w, h); }
        rc.globalCompositeOperation = "source-over";
        out.drawImage(revealLayer.canvas, 0, 0);
      }
      out.drawImage(art.canvas, 0, 0);
      compositionCacheKey = stableComposition ? compositionKey : "";
    }
    const hasFinish = Object.entries(state.effects).some(
      ([k, v]) =>
        !["angle", "focus", "blurType", "characterBloom"].includes(k) &&
        typeof v === "number" &&
        v > 0,
    );
    ctx!.clearRect(0, 0, w, h);
    if (hasFinish) {
      if (finish === undefined) finish = createStudioFinish();
      if (finish)
        ctx!.drawImage(
          finish.render(composite.canvas, state.effects, time, pixelRatio),
          0,
          0,
        );
      else ctx!.drawImage(composite.canvas, 0, 0);
      canvas.dataset.studioFinish = finish ? "gpu" : "unavailable";
    } else {
      ctx!.drawImage(composite.canvas, 0, 0);
      canvas.dataset.studioFinish = "none";
    }
  }
  return {
    canvas,
    render,
    /** Change raster scale without adding logical cells or remounting media. */
    setPixelRatio(ratio: number) {
      pixelRatio = Math.max(0.1, Math.min(8, Number.isFinite(ratio) ? ratio : 1));
    },
    get pixelRatio() { return pixelRatio; },
    setBudget(cells: number) {
      budgetCells = Math.max(256, Math.min(maxCells, Number.isFinite(cells) ? Math.round(cells) : maxCells));
    },
    get maxCells() {
      return budgetCells;
    },
    configure(input: unknown) {
      state = normalizeStudioSettings(input);
      toneLookup = createColorLookups(state.color);
      printPainter = createPrintPainter(state.print);
      denoiser.configure(state.color.denoise);
      warper.configure(state.warps,state.warpEdge);
      revision++;
    },
    pointer,
    leave() {
      flow.leave();
    },
    get active() {
      return flow.active;
    },
    get settings() {
      return normalizeStudioSettings(state);
    },
    get capabilities() {
      return { gpuFinish: finish !== null };
    },
    invalidate() {
      prepared = "";
    },
    destroy() {
      finish?.destroy();
      warper.clear();
      denoiser.configure(0);
      for (const s of [
        scene,
        sample,
        art,
        composite,
        mask,
        tiny,
        atlas,
        inkMask,
        glow,
        stud,
        maskSample,
        scopeLayer,
        revealLayer,
      ])
        s.canvas.width = s.canvas.height = 1;
      sourceIdentity = null;
      pixels = new Uint8ClampedArray(0);
      motionPixels = new Uint8ClampedArray(0);
      cues = null;
      cuesKey = "";
    },
  };
}
