import type { FieldClearZone, FieldScene, GlyphFieldOptions } from '../../field';
import type { BackgroundContext, BackgroundMark, BackgroundPreset, BackgroundRun, BackgroundSettings } from '../background';
import { mountPageField, type PageField } from '../page-field';

export type FieldHover = 'trail' | 'fluid' | 'lantern' | 'none';

/** The pointer response for a GPU preset: off, the preset's own, or the one you name. */
export const hoverOf = (s: BackgroundSettings, own: FieldHover): FieldHover => (s.cursor === false ? 'none' : typeof s.cursor === 'string' ? s.cursor : own);

/**
 * Runs a GPU field preset under the host's content; `look` is the site's look for the ground, and `graphite` its default ink.
 * `glyphs` lets a halftone preset take the global look: the cells it draws characters in once a look asks for them.
 */
export function mountField(context: BackgroundContext, look: (s: BackgroundSettings, dark: boolean) => GlyphFieldOptions, graphite: { light: string; dark: string }, glyphs?: (s: BackgroundSettings) => GlyphFieldOptions): BackgroundRun | null {
  let page: PageField | null = null;
  page = mountPageField({
    host: context.host,
    kit: context.kit,
    layer: 'under',
    glyphs: glyphs && (() => glyphs(context.settings())),
    look: dark => { const s = context.settings(); return { ...look(s, dark), ...s.look }; },
    ink: dark => context.ink(dark) ?? (dark ? graphite.dark : graphite.light),
    reducedMotion: context.reducedMotion,
    onFail: () => { page = null; context.onFail(); },
  });
  if (!page) return null;
  const last = page.canvas;
  return {
    get field() { return page?.field ?? null; },
    get canvas() { return page?.canvas ?? last; },
    refresh() { page?.refresh(); },
    play() { page?.field.play(); },
    pause() { page?.field.pause(); },
    destroy() { page?.destroy(); page = null; },
  };
}

/** Narrow screens are tall, so finer shapes keep the drift from emptying out above the copy. */
export const narrow = () => typeof innerWidth === 'number' && innerWidth < 760;

/** The scene presets draw thin lines and sparse marks, so they take a firmer graphite than the dense grounds. */
export const SCENE_GRAPHITE = { light: '#86847e', dark: '#7c7a74' };

/** Lighter graphite for the GPU grounds, which draw every glyph at full ink (the site's FIELD_INK). */
export const FIELD_GRAPHITE = { light: '#8f8d86', dark: '#64625d' };

/** Characters unless dots are asked for, or are the preset's own and no characters were given. */
export const markOf = (s: BackgroundSettings, own: BackgroundMark): BackgroundMark => s.mark ?? (s.charset || s.look?.charset ? 'glyph' : own);

/** The cells the glyph presets draw characters in: the site's mono at its drift proportions. */
export const glyphCells = (s: BackgroundSettings): GlyphFieldOptions => ({
  font: '"Geist Mono", ui-monospace, monospace', fontWeight: 400, cellSize: s.cellSize, cellAspect: 0.62, glyphScale: 0.86,
});
/** Square cells for the halftone. */
export const dotCells = (s: BackgroundSettings): GlyphFieldOptions => ({ cellSize: s.cellSize, cellAspect: 1, dotScale: 0.68 });

/** A soft oval in the middle, kept quiet for a headline when no `clear` element is given. */
export const MIDDLE: FieldClearZone = { x: 0.18, y: 0.2, width: 0.64, height: 0.6, feather: 0.3, shape: 'ellipse' };

export interface ScenePreset {
  id: string; name: string; description: string; cellSize: number; speed?: number; cursor?: boolean; opacity?: number;
  scene: FieldScene;
  /** Its own ramp, empty to dense. */
  charset: string;
  /** What it draws by default. Default `glyph`. */
  mark?: BackgroundMark;
  hover: FieldHover;
  /** The quiet zone without a `clear` element; `false` for scenes that keep their own. */
  middle?: FieldClearZone | false;
  /** How far round a `clear` element the field fades. Default 0.3 of the shorter side. */
  feather?: number;
  graphite?: { light: string; dark: string };
  /** The scene's own tone and pointer settings. */
  tune?: (s: BackgroundSettings, dark: boolean) => GlyphFieldOptions;
  /** Runs beside the field (the pointer drops of `ripple`); returns its cleanup. */
  extra?: (context: BackgroundContext, run: BackgroundRun) => () => void;
}

/** A GPU scene background: characters or dots, the global look, the pointer response off with `cursor: false`, and a quiet zone. */
export function scenePreset(spec: ScenePreset): BackgroundPreset {
  const { scene, charset, hover, middle = MIDDLE, feather = 0.3, graphite = SCENE_GRAPHITE } = spec, own = spec.mark ?? 'glyph';
  return {
    id: spec.id, name: spec.name, description: spec.description, cellSize: spec.cellSize, speed: spec.speed ?? 1, cursor: spec.cursor ?? true, opacity: spec.opacity,
    mount(context) {
      const run = mountField(context, (s, dark) => {
        const mark = markOf(s, own);
        return {
          scene, color: 'ink', shade: 0, background: 'transparent', vignette: 0, speed: s.speed, maxPixelRatio: 2, levels: 'none', blend: 'on',
          ...(mark === 'dot' ? { mark: 'dot', ...dotCells(s) } : { mark: 'glyph', charset: s.charset ?? charset, ...glyphCells(s) }),
          hover: hoverOf(s, hover), lantern: { radius: 0.14, strength: 0.45, trail: 0.8, follow: 9 }, trail: { strength: 0.8, radius: 0.35 },
          fluid: { radius: 0.09, refraction: 0.03, glow: 0.6 },
          clear: s.clear ? { element: s.clear, padding: 0, feather, shape: 'ellipse' } : middle,
          ...spec.tune?.(s, dark),
        };
      }, graphite, own === 'dot' ? s => ({ ...glyphCells(s), charset }) : undefined);
      if (!run || !spec.extra) return run;
      const stop = spec.extra(context, run);
      const destroy = run.destroy.bind(run);
      return Object.assign(run, { destroy() { stop(); destroy(); } });
    },
  };
}
