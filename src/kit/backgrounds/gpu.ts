import type { GlyphFieldOptions } from '../../field';
import type { BackgroundContext, BackgroundRun, BackgroundSettings } from '../background';
import { mountPageField, type PageField } from '../page-field';

export type FieldHover = 'trail' | 'fluid' | 'lantern' | 'none';

/** The pointer response for a GPU preset: off, the preset's own, or the one you name. */
export const hoverOf = (s: BackgroundSettings, own: FieldHover): FieldHover => (s.cursor === false ? 'none' : typeof s.cursor === 'string' ? s.cursor : own);

/** Runs a GPU field preset under the host's content; `look` is the site's look for the ground, and `graphite` its default ink. */
export function mountField(context: BackgroundContext, look: (s: BackgroundSettings, dark: boolean) => GlyphFieldOptions, graphite: { light: string; dark: string }): BackgroundRun | null {
  let page: PageField | null = null;
  page = mountPageField({
    host: context.host,
    kit: context.kit,
    layer: 'under',
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

/** The drift ground shared by `drift` and `halftone`, as the /backgrounds stage draws it. */
export const driftGround = (s: BackgroundSettings, hover: FieldHover): GlyphFieldOptions => ({
  scene: 'drift', levels: 'auto', color: 'ink', shade: 0, background: 'transparent', vignette: 0, speed: s.speed, maxPixelRatio: 2,
  hover, lantern: { radius: 0.16, strength: 0.35, trail: 0.6, follow: 9 }, fluid: { radius: 0.09, refraction: 0.03, glow: 0.6 },
  clear: s.clear ? { element: s.clear, padding: 32, feather: 0.2, shape: 'rect' } : false,
});

/** Lighter graphite for the GPU grounds, which draw every glyph at full ink (the site's FIELD_INK). */
export const FIELD_GRAPHITE = { light: '#8f8d86', dark: '#64625d' };
