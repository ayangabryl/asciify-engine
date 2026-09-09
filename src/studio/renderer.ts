import { sampleAmbient } from '../surface/ambient-motion';
import {
  normalizeStudioSettings,
  studioCrop,
  studioGrid,
  type StudioSettings,
} from "./model";
import { ditherPixels, noise } from "./dither";
import { createStudioFinish } from "./finish";
import { WaterSurface } from "../surface/water-surface";
import { invertTrailTone } from "../surface/ink-trail";
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
    glow = surface();
  let finish: ReturnType<typeof createStudioFinish> | undefined;
  let state = normalizeStudioSettings(settings),
    revision = 0,
    prepared = "",
    pixels: Uint8ClampedArray = new Uint8ClampedArray(0),
    motionPixels: Uint8ClampedArray = new Uint8ClampedArray(0),
    cols = 0,
    rows = 0,
    last = 0;
  let sourceIdentity: StudioSource | null = null,
    atlasKey = "";
  let flow = new WaterSurface();
  let aspect = 0;
  const field = [0, 0, 0];
  const ambient = [0, 0, 0, 1];
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
        160000,
        Number.isFinite(limits.maxCells) ? limits.maxCells! : 12000,
      ),
    );
  let budgetCells = maxCells;
  const pixelRatio = Math.max(0.1, Math.min(8, limits.pixelRatio ?? 1));
  const pointer = (x: number, y: number, time: number) => {
    flow.configure(
      state.hover.effect,
      state.hover.strength,
      state.hover.radius,
      state.hover.edgeSafe,
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
    }
    flow.configure(
      state.hover.effect,
      state.hover.strength,
      state.hover.radius,
      state.hover.edgeSafe,
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
    }
    art.ctx.clearRect(0, 0, w, h);
    art.ctx.globalAlpha = 1;
    art.ctx.globalCompositeOperation = "source-over";
    const phase = motionTime;
    if (isDither) {
      if (motionPixels.length !== pixels.length) motionPixels = new Uint8ClampedArray(pixels.length);
      const data = motionPixels;
      data.set(pixels);
      const motion = state.motion.type;
      if (flow.active || motion !== "none") {
        for (let y = 0; y < rows; y++)
          for (let x = 0; x < cols; x++) {
            const u = x / cols,
              v = y / rows;
            let sx = x,
              sy = y,
              energy = 0,
              gain = 1,
              alpha = 1;
            if (flow.active) {
              flow.sample(u, v, field);
              sx -= field[0] * cols;
              sy -= field[1] * rows;
              energy = field[2] / 3;
            }
            sampleAmbient(motion, u, v, phase, ambient);
            sx -= ambient[0] / 960 * cols;
            sy -= ambient[1] / 960 * rows;
            gain = 1 + ambient[2];
            alpha = ambient[3];
            // Sub-cell advection must interpolate; rounding creates visible stepping.
            sx = Math.max(0, Math.min(cols - 1, sx));
            sy = Math.max(0, Math.min(rows - 1, sy));
            const x0 = Math.floor(sx), y0 = Math.floor(sy);
            const fx = sx - x0, fy = sy - y0;
            const i = (y * cols + x) * 4;
            const j = (y0 * cols + x0) * 4;
            const right = (y0 * cols + Math.min(cols - 1, x0 + 1)) * 4;
            const below = (Math.min(rows - 1, y0 + 1) * cols + x0) * 4;
            const corner = (Math.min(rows - 1, y0 + 1) * cols + Math.min(cols - 1, x0 + 1)) * 4;
            for (let c = 0; c < 3; c++) {
              const tone = ((pixels[j + c] * (1 - fx) + pixels[right + c] * fx) * (1 - fy) +
                (pixels[below + c] * (1 - fx) + pixels[corner + c] * fx) * fy) / 255;
              let value =
                (["trail", "contour"].includes(state.hover.effect)
                  ? invertTrailTone(tone, energy)
                  : state.hover.effect === "dissolve"
                    ? tone * Math.max(0, 1 + energy)
                    : tone) * gain;
              data[i + c] = value * 255;
            }
            data[i + 3] = pixels[j + 3] * alpha;
          }
      }
      ditherPixels(data, cols, rows, state.dither, time);
      sample.ctx.putImageData(new ImageData(data, cols, rows), 0, 0);
      art.ctx.imageSmoothingEnabled = false;
      art.ctx.drawImage(sample.canvas, 0, 0, w, h);
    } else {
      const chars = Array.from(ramps[state.style] ?? state.charset),
        ac = art.ctx;
      const glyphMode = state.style === "ascii" || !!ramps[state.style];
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
      }
      ac.font = `${font}px monospace`;
      ac.textBaseline = "middle";
      ac.textAlign = "center";
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) {
          let sx = x,
            sy = y,
            energy = 0;
          if (flow.active) {
            flow.sample(x / cols, y / rows, field);
            sx = Math.max(0, Math.min(cols - 1, x - field[0] * cols));
            sy = Math.max(0, Math.min(rows - 1, y - field[1] * rows));
            energy = field[2] / 3;
          }
          const i = (Math.floor(sy) * cols + Math.floor(sx)) * 4;
          if (!pixels[i + 3]) continue;
          const r = pixels[i],
            g = pixels[i + 1],
            b = pixels[i + 2];
          const sourceLum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
          let lum = sourceLum;
          if (["trail", "contour"].includes(state.hover.effect) && energy)
            lum = invertTrailTone(lum, energy);
          else if (state.hover.effect === "dissolve")
            lum *= Math.max(0, 1 + energy);
          const motion = state.motion.type;
          let px = x * cell,
            py = y * ch,
            alpha = 1;
          sampleAmbient(motion, x / cols, y / rows, phase, ambient);
          px += ambient[0] * w / 960;
          py += ambient[1] * h / 960;
          lum = Math.max(0, Math.min(1, lum + ambient[2]));
          alpha = ambient[3];
          if (!glyphMode && state.colorMode === "accent") alpha *= lum;
          ac.globalAlpha = alpha;
          const toneDelta = (lum - sourceLum) * 255;
          let ink =
            state.colorMode === "source"
              ? `rgb(${r + toneDelta},${g + toneDelta},${b + toneDelta})`
              : state.colorMode === "gray"
                ? `rgb(${Math.round(lum * 255)},${Math.round(lum * 255)},${Math.round(lum * 255)})`
                : state.ink;
          ac.fillStyle = ink;
          if (glyphMode) {
            const index = Math.max(
              0,
              Math.min(chars.length - 1, Math.floor(lum * (chars.length - 1))),
            );
            if (state.colorMode === "accent")
              ac.drawImage(
                atlas.canvas,
                index * aw,
                0,
                aw,
                ah,
                px + (cell - aw) / 2,
                py + (ch - ah) / 2,
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
              ac.fillStyle = "rgba(255,255,255,.2)";
              ac.beginPath();
              ac.arc(px + cell / 2, py + ch / 2, cell * 0.28, 0, Math.PI * 2);
              ac.fill();
              ac.strokeStyle = "rgba(0,0,0,.25)";
              ac.stroke();
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
      const mc = mask.ctx;
      mc.clearRect(0, 0, w, h);
      mc.fillStyle = "#fff";
      mc.strokeStyle = "#fff";
      mc.lineCap = "round";
      mc.lineJoin = "round";
      for (const s of state.mask.shapes) {
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
    out.drawImage(art.canvas, 0, 0);
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
    setBudget(cells: number) {
      budgetCells = Math.max(1500, Math.min(maxCells, Math.round(cells)));
    },
    get maxCells() {
      return budgetCells;
    },
    configure(input: unknown) {
      state = normalizeStudioSettings(input);
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
      ])
        s.canvas.width = s.canvas.height = 1;
      sourceIdentity = null;
      pixels = new Uint8ClampedArray(0);
    },
  };
}
