import { FluidField, paintLiquidSource } from '../../surface/fluid-field';
import type { BackgroundContext, BackgroundPreset, BackgroundRun } from '../background';
import { mountSurface } from '../core';

/** The original Asciify hero ramp. */
const RAMP = ' .:+-=xICA$FY#@';
const CHAR_ASPECT = 0.58;
/** The hero's renderer: contrast 0.1 in asciify-engine's luminance curve. */
const CONTRAST = (259 * (0.1 * 255 + 255)) / (255 * (259 - 0.1 * 255));
const INTERACTIVE = 'button, a, input, select, summary, textarea';

/** The hero's character size: at least `size`, larger on very big screens so the glyph count stays bounded. */
const fontFor = (size: number, w: number, h: number) => Math.max(size, Math.sqrt((w * h * CHAR_ASPECT) / 26000));

function mountFluid(context: BackgroundContext): BackgroundRun | null {
  const { host } = context;
  let flow = new FluidField(1), flowAspect = 1, time = 12, last = 0, left = false;
  let pixels: ImageData | null = null;
  const samples: { x: number; y: number }[] = [];
  const size = (w: number, h: number) => fontFor(context.settings().cellSize, w, h);
  const surface = mountSurface({
    host,
    kit: context.kit,
    layer: 'under',
    look: () => {
      const s = context.settings();
      return {
        mark: 'glyph', charset: s.charset ?? RAMP, font: '"JetBrains Mono", monospace', fontWeight: 400,
        cellSize: size(host.clientWidth || 1, host.clientHeight || 1) / CHAR_ASPECT, cellAspect: CHAR_ASPECT, glyphScale: 0.9,
        // The hero's grid: a whole number of 7 x 12.07 px cells stretched to fill the stage, drawn at up to 1.5 device pixels per px.
        cellFit: 'fill', maxPixelRatio: 1.5,
        // asciify-engine's contrast 0.1, then its floor onto the ramp, which the field's rounding meets half a step lower.
        color: 'ink', shade: 0, levels: 'none', fit: 'cover', gamma: 1, contrast: CONTRAST, brightness: (0.5 - 128 / 255) * (CONTRAST - 1) - 0.5 / Math.max(1, Array.from(s.charset ?? RAMP).length - 1), ...s.look,
      };
    },
    ink: dark => context.ink(dark) ?? '#8f8d86',
    // The hero's source detail: 192 to 384 samples on the long side, which the field averages over each cell as the hero does.
    resolution: (w, h) => {
      const detail = Math.max(192, Math.min(384, Math.ceil(Math.max(w, h * CHAR_ASPECT) / size(w, h)))), aspect = w / h;
      return aspect >= 1 ? [detail, Math.max(1, Math.round(detail / aspect))] : [Math.max(1, Math.round(detail * aspect)), detail];
    },
    reducedMotion: context.reducedMotion,
    onFail: () => context.onFail(),
    paint: ({ pen, width, height, w, h, now, still }) => {
      const s = context.settings();
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      if (!still) time += dt * s.speed;
      const aspect = w / h;
      if (Math.abs(aspect - flowAspect) > 0.01) { flow = new FluidField(aspect); flowAspect = aspect; }
      if (still || !s.cursor) { flow.clear(); samples.length = 0; }
      else {
        const box = host.getBoundingClientRect();
        if (box.width && box.height) for (const point of samples) flow.move((point.x - box.left) / box.width, (point.y - box.top) / box.height);
        samples.length = 0;
        if (left) { flow.leave(); left = false; }
        flow.step(dt);
      }
      if (!pixels || pixels.width !== width || pixels.height !== height) pixels = pen.createImageData(width, height);
      const data = pixels.data;
      paintLiquidSource(data, width, height, aspect, time, flow);
      // The hero tints the source amber and reads its luminance; the field then applies the hero's contrast curve (see look).
      for (let i = 0; i < data.length; i += 4) {
        const v = data[i] < 10 ? 0 : Math.min(255, data[i] * 1.45);
        data[i] = data[i + 1] = data[i + 2] = 0.299 * v + 0.587 * (v * (185 / 232));
        data[i + 3] = 255;
      }
      pen.putImageData(pixels, 0, 0);
      return true;
    },
  });
  if (!surface) return null;

  const move = (event: PointerEvent) => {
    if (event.target instanceof Element && event.target.closest(INTERACTIVE)) { left = true; surface.kick(); return; }
    samples.push({ x: event.clientX, y: event.clientY });
    if (samples.length > 6) samples.shift();
    surface.kick();
  };
  const leave = () => { left = true; surface.kick(); };
  host.addEventListener('pointermove', move);
  host.addEventListener('pointerdown', move);
  host.addEventListener('pointerleave', leave);
  host.addEventListener('pointercancel', leave);

  return {
    get field() { return surface.field; },
    get canvas() { return surface.canvas; },
    refresh: () => surface.refresh(),
    play: () => { last = 0; surface.play(); },
    pause: () => surface.pause(),
    destroy() {
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerdown', move);
      host.removeEventListener('pointerleave', leave);
      host.removeEventListener('pointercancel', leave);
      surface.destroy();
    },
  };
}

/** Flowing folds with a soft wake behind the cursor: the original Asciify hero, driven through the GPU field. */
export const fluid: BackgroundPreset = {
  id: 'fluid', name: 'Fluid', description: 'Flowing folds with a soft wake behind the cursor. The original Asciify hero.', cellSize: 7, speed: 1, cursor: true, opacity: 0.7,
  mount: mountFluid,
};
