// A glyph field drawn in a worker: built as a script string (field-worker-source.ts, tsup.config.ts) and started by
// field-offscreen.ts. The field is the page's own engine, unchanged; the shims stand in for the page around it. Frames of a
// moving source arrive as bitmaps or video frames and are drawn onto a stage canvas the field reads as a live source.
import { asFieldCanvas, fonts, replayPointer, setBox, setHidden, setMedia, setVisible } from './field-worker-shims';
import { fieldAtlasKey, fieldGlyphPainter, mountGlyphField, type GlyphField, type GlyphFieldOptions } from './glyph-field';
import type { GlyphFieldSettings } from './field-model';

type Frame = ImageBitmap | VideoFrame;
type Message =
  | { type: 'init'; canvas: OffscreenCanvas; options: GlyphFieldOptions; ratio: number; box: [number, number, number, number]; hidden: boolean; reducedMotion: boolean; darkScheme: boolean; visible: boolean; streaming: boolean; url?: string }
  | { type: 'box'; box: [number, number, number, number] } | { type: 'visible'; value: boolean } | { type: 'hidden'; value: boolean }
  | { type: 'media'; reducedMotion: boolean; darkScheme: boolean } | { type: 'ratio'; value: number }
  | { type: 'pointer'; event: string; clientX: number; clientY: number; pointerType?: string; buttons?: number }
  | { type: 'frame'; frame: Frame; streaming: boolean } | { type: 'url'; url: string | null }
  | { type: 'update'; options: GlyphFieldOptions } | { type: 'call'; method: 'pulse' | 'play' | 'pause' | 'redraw' | 'resize' | 'pointer'; args: unknown[] }
  | { type: 'atlas'; key: string; image: ImageBitmap } | { type: 'shapes'; key: string; data: Uint8Array } | { type: 'destroy' };

const post = (message: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(message, transfer);
let field: GlyphField | null = null;
let stage: OffscreenCanvas | null = null, pen: OffscreenCanvasRenderingContext2D | null = null, live = false;

// Atlases and glyph shapes come from the page, painted with its fonts. Until one arrives the field paints its own with
// the fonts a worker has, marked not final, and the arrival is announced as a font face so it asks again.
const atlases = new Map<string, ImageBitmap>(), shapes = new Map<string, Uint8Array>(), asked = new Set<string>();
const shapesKey = (settings: GlyphFieldSettings) => `${settings.charset}\u0000${settings.fontWeight} ${settings.font}\u0000${settings.glyphScale}`;
const ownAtlas = fieldGlyphPainter.atlas, ownShapes = fieldGlyphPainter.shapes;
fieldGlyphPainter.atlas = (settings, layout, shared) => {
  const key = fieldAtlasKey(settings, layout), image = atlases.get(key);
  if (image) return { image, final: true };
  if (!asked.has(key)) { asked.add(key); post({ type: 'atlas', key, settings, layout }); }
  return { ...ownAtlas(settings, layout, shared), final: false };
};
fieldGlyphPainter.shapes = settings => {
  const key = shapesKey(settings), known = shapes.get(key);
  if (known) return known;
  if (!asked.has(`shapes:${key}`)) { asked.add(`shapes:${key}`); post({ type: 'shapes', key, settings }); }
  return ownShapes(settings);
};

// The field asks for its atlas again when a face of its first family is announced.
const announce = () => { const family = field?.settings.font.split(',')[0]?.trim().replace(/^["']|["']$/g, ''); if (family) fonts.announce(family); };

const show = (frame: Frame) => {
  const width = 'displayWidth' in frame ? frame.displayWidth : frame.width, height = 'displayHeight' in frame ? frame.displayHeight : frame.height;
  stage ??= new OffscreenCanvas(width, height);
  if (stage.width !== width || stage.height !== height) { stage.width = width; stage.height = height; }
  pen ??= stage.getContext('2d');
  pen?.drawImage(frame as CanvasImageSource, 0, 0);
  frame.close();
};

self.onmessage = ({ data }: MessageEvent<Message>) => {
  try {
    switch (data.type) {
      case 'init': {
        (self as unknown as { devicePixelRatio: number }).devicePixelRatio = data.ratio;
        setBox(...data.box);
        setHidden(data.hidden);
        setMedia(data.reducedMotion, data.darkScheme);
        setVisible(data.visible);
        live = data.streaming;
        const canvas = asFieldCanvas(data.canvas);
        field = mountGlyphField(canvas, {
          ...data.options, context: 'own', live, source: data.url ?? null,
          onError: error => post({ type: 'error', message: error.message }),
        });
        void field.ready.then(() => post({ type: 'ready' }), error => post({ type: 'error', message: String(error?.message ?? error) }));
        break;
      }
      case 'box': setBox(...data.box); break;
      case 'visible': setVisible(data.value); break;
      case 'hidden': setHidden(data.value); break;
      case 'media': setMedia(data.reducedMotion, data.darkScheme); break;
      case 'ratio': (self as unknown as { devicePixelRatio: number }).devicePixelRatio = data.value; field?.resize(); break;
      case 'pointer': replayPointer(data.event, { clientX: data.clientX, clientY: data.clientY, pointerType: data.pointerType, buttons: data.buttons }); break;
      case 'frame': {
        show(data.frame);
        // Taken: said once this worker's next frame has drawn it, so the page sends no faster than frames are drawn here.
        if (!acking) { acking = true; requestAnimationFrame(() => requestAnimationFrame(() => { acking = false; post({ type: 'took' }); })); }
        if (!field) break;
        if (data.streaming !== live) { live = data.streaming; field.update({ live }); }
        // The stage is the field's source: set once, then a moving one is uploaded every frame it draws, and a still one is
        // taken again when it changes.
        if (!live || !fieldHasStage) { void field.setSource(stage as unknown as HTMLCanvasElement); fieldHasStage = true; }
        break;
      }
      case 'url': fieldHasStage = false; void field?.setSource(data.url); break;
      case 'update': field?.update(data.options); break;
      case 'call': {
        const method = field?.[data.method] as ((...args: unknown[]) => void) | undefined;
        method?.apply(field, data.args);
        break;
      }
      case 'atlas': atlases.set(data.key, data.image); announce(); break;
      case 'shapes': shapes.set(data.key, data.data); announce(); break;
      case 'destroy':
        field?.destroy(); field = null;
        for (const image of atlases.values()) image.close();
        atlases.clear();
        self.close();
        break;
    }
  } catch (error) {
    post({ type: 'error', message: String((error as Error)?.message ?? error) });
  }
};
let fieldHasStage = false, acking = false;
post({ type: 'loaded' });
