/**
 * 3D models to ASCII, in any runtime: read glTF/GLB, OBJ, STL and PLY files, draw them on the CPU (Node, workers, edge) or
 * the GPU (a live canvas for a glyph field), and turn them into characters. Importing does nothing.
 */
export { parseModel, loadModel, modelFormat, withNormals, decodeModelTextures } from './model/parse';
export type { ParseModelOptions, LoadModelOptions } from './model/parse';
export { renderModel, modelFrames } from './model/render';
export type { ModelView, ModelLook, ModelRenderOptions, RenderedModel } from './model/render';
export { modelToGrid, modelToGrids, modelPixelSize, MODEL_GAMMA } from './model/ascii';
export type { ModelGridOptions } from './model/ascii';
export { shapeModel, MODEL_SHAPES } from './model/shapes';
export type { ModelShape } from './model/shapes';
export { modelSource } from './model/gl';
export type { ModelSource, ModelSourceOptions } from './model/gl';
export type { AsciiModel, ModelGroup, ModelMaterial, ModelTexture, ModelFormat } from './model/types';
