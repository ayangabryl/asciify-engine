import type { GlyphFieldOptions } from '../field';
import { styleKeeper, type KitHandle, type KitOptions } from './core';
import { mountPageField, pageHandle, pulseAt, sleep, type PageField } from './page-field';

export interface ArtPanelOptions extends KitOptions {
  /** An image URL or element. Default the first `<img>` inside the panel, which is hidden while the field draws it. */
  image?: string | HTMLImageElement;
  /** A brand mark or caption over the art to keep clear, in a soft rectangle. */
  clear?: HTMLElement | false;
  /** Crop focus for the cover fit, 0–1 on each axis. Default `{ x: 0.5, y: 0.4 }`. */
  focus?: { x: number; y: number };
  /** The canvas's accessible name. Default the image's `alt`, else hidden as decoration. */
  label?: string;
}

export interface ArtPanelHandle extends KitHandle<ArtPanelOptions> {
  /** Sends a ring through the art from an element (the submit button), a viewport point or the centre. Default strength 1. */
  pulse(from?: Element | { x: number; y: number }, strength?: number): void;
  /** While on, a lit band crosses the art again and again, characters climbing the ramp as it passes: a request is running. */
  shimmer(on: boolean): void;
}

const LAP = 1100, FRAME = 48, LONGEST = 1400;

/** The sign-in page's art panel: an image drawn in characters, with a trail, pulses for form events and a shimmer while it waits. */
export function artPanel(element: HTMLElement, options: ArtPanelOptions = {}): ArtPanelHandle {
  const state = { current: { ...options } };
  const styles = styleKeeper();
  const inner = element.querySelector('img');
  const image = state.current.image ?? inner ?? null;
  const look = (): GlyphFieldOptions => {
    const o = state.current;
    return {
      mark: 'glyph', scene: 'none', charset: ' .:-=+*#%@', font: '"Geist", Arial, sans-serif', fontWeight: 500, cellSize: 6, cellAspect: 0.8, glyphScale: 0.8,
      color: 'ink', shade: 0, contrast: 1.3, levels: 'auto', fit: 'cover', focus: o.focus ?? { x: 0.5, y: 0.4 }, hover: 'trail', trail: { strength: 0.95, radius: 0.42 },
      clear: o.clear ? { element: o.clear, padding: 8, feather: 0.12, shape: 'rect' } : false,
      ...o.look,
    };
  };

  let page: PageField | null = null;
  page = !image ? null : mountPageField({
    host: element,
    look,
    ink: dark => state.current.ink ?? (dark ? '#d8d6cf' : '#1d1d1b'),
    source: image,
    label: state.current.label ?? (image instanceof HTMLImageElement ? image.alt || undefined : undefined),
    reducedMotion: () => state.current.reducedMotion,
    onFail: () => { page = null; styles.restore(); },
  });
  if (page && inner && image === inner) styles.set(inner, 'opacity', '0');

  let lit = 0, shining = false;
  const decoded = async () => {
    if (image instanceof HTMLImageElement) { if (!image.complete) await image.decode(); return image; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = image!;
    await img.decode();
    return img;
  };
  const shimmer = (on: boolean) => {
    const f = page?.field;
    if (!f || on === shining || (on && page!.still())) return;
    const id = ++lit;
    shining = on;
    if (!on) { void f.setSource(image); return; }
    void (async () => {
      let img: HTMLImageElement;
      try { img = await decoded(); } catch { return; }
      const k = Math.min(1, LONGEST / Math.max(img.naturalWidth, img.naturalHeight, 1));
      const work = Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(img.naturalWidth * k)), height: Math.max(1, Math.round(img.naturalHeight * k)) });
      const pen = work.getContext('2d')!, w = work.width, h = work.height, start = performance.now();
      while (id === lit && page?.field === f) {
        const t = performance.now(), p = ((t - start) / LAP) % 1, x = -0.4 * w + p * 1.8 * w;
        pen.globalCompositeOperation = 'source-over';
        pen.drawImage(img, 0, 0, w, h);
        const band = pen.createLinearGradient(x - w * 0.22, x * 0.3, x + w * 0.22, x * 0.3 + h * 0.3);
        band.addColorStop(0, 'rgb(0 0 0 / 0)'); band.addColorStop(0.5, 'rgb(255 255 255 / .42)'); band.addColorStop(1, 'rgb(0 0 0 / 0)');
        pen.globalCompositeOperation = 'lighter';
        pen.fillStyle = band; pen.fillRect(0, 0, w, h);
        await f.setSource(work);
        await sleep(Math.max(0, FRAME - (performance.now() - t)));
      }
    })();
  };
  const pulse = (from?: Element | { x: number; y: number }, strength = 1) => {
    if (page && !page.still()) pulseAt(page.field, from, strength);
  };

  return pageHandle(() => page, state, () => {}, { pulse, shimmer }, () => { lit++; styles.restore(); });
}
