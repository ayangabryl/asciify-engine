/** GPU character fields with a fluid cursor wake.
 * Importing the engine root, /core or /studio never imports this module.
 */
export { mountGlyphField, isGlyphFieldSupported, glyphFieldTier } from './field/glyph-field';
export type { GlyphField, GlyphFieldOptions, FieldSource } from './field/glyph-field';
export {
  DEFAULT_FIELD_SETTINGS, DEFAULT_FIELD_FLUID, DEFAULT_FIELD_LANTERN, DEFAULT_FIELD_TRAIL, FIELD_HOVERS, activeFieldHover, normalizeFieldSettings, fieldGlyphs, fieldSourceRect, fieldCellLayout, fieldLevels,
} from './field/field-model';
export type { GlyphFieldSettings, GlyphFieldInput, FieldFluidOptions, FieldLanternOptions, FieldTrailOptions, FieldHover, FieldColor, FieldFit, FieldScene } from './field/field-model';
