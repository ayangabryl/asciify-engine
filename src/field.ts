/** GPU character fields with a fluid cursor wake.
 * Importing the engine root, /core or /studio never imports this module.
 */
export { mountGlyphField, isGlyphFieldSupported, glyphFieldTier } from './field/glyph-field';
export type { GlyphField, GlyphFieldOptions, FieldSource, FieldClearElement } from './field/glyph-field';
export {
  DEFAULT_FIELD_SETTINGS, DEFAULT_FIELD_FLUID, DEFAULT_FIELD_LANTERN, DEFAULT_FIELD_TRAIL, FIELD_HOVERS, FIELD_MARKS, FIELD_SCENES, activeFieldHover, normalizeFieldSettings, fieldClearFromRects, fieldGlyphs, fieldSourceRect, fieldCellLayout, fieldLevels,
} from './field/field-model';
export type { HoverScope as FieldHoverScope } from './surface/hover-guide';
export type { GlyphFieldSettings, GlyphFieldInput, FieldFluidOptions, FieldLanternOptions, FieldTrailOptions, FieldHover, FieldColor, FieldFit, FieldScene, FieldMark, FieldClearZone } from './field/field-model';
/**
 * @internal For asciify-engine/kit, which imports this build: the page's one shared field context and frame loop, and
 * atlas prewarming. Not part of the public API.
 */
export {
  ambientFactor, cancelFieldFrame, currentFieldContext, isSharedFieldCanvas, requestFieldFrame, watchMotionPreference, watchPointer, watchTheme, watchVisibility,
} from './field/field-gl';
export { prewarmGlyphAtlas } from './field/glyph-field';
