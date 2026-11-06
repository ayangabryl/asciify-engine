import { toAsciiGrid, type AsciiGrid, type AsciiGridOptions } from '../headless/grid';
import { toBlockGrid, type BlockMode } from '../headless/blocks';
import { renderModel, type ModelRenderOptions } from './render';
import type { AsciiModel } from './types';

/*
 * A 3D model straight to characters: drawn at the size the grid needs, then converted. The light is mapped onto the
 * character ramp evenly (a lit render is mostly bright, which would fill the model with its densest character).
 */

export interface ModelGridOptions extends Omit<ModelRenderOptions, 'width' | 'height' | 'background'>, Omit<AsciiGridOptions, 'mode' | 'cellAspect'> {
  /** Characters across. Default 80. */
  columns?: number;
  /** Rows. Default: a square view (`columns / cellAspect`). */
  rows?: number;
  /** Height over width of a character cell where it is shown. Default 2 (a terminal's cells). */
  cellAspect?: number;
  /** 'shape' (default) and 'tone' as `toAsciiGrid`; 'braille', 'half', 'quad' and 'sextant' as `toBlockGrid`. */
  mode?: 'shape' | 'tone' | BlockMode;
}

/** How light maps onto the ramp for models: about linear in light, as classic 3D ASCII renderers do. */
export const MODEL_GAMMA = 0.55;

const LAYOUT: Record<BlockMode, [number, number]> = { braille: [2, 4], half: [1, 2], quad: [2, 2], sextant: [2, 3] };

/**
 * The size in pixels a model is drawn at for a grid, and the pixels' height over width: two pixels each way for every part
 * the converter reads of a cell (3 × 5 parts in shape mode, one in tone mode, the dots or blocks of the sub-cell modes).
 */
export function modelPixelSize(columns: number, rows: number, cellAspect: number, mode: ModelGridOptions['mode'] = 'shape'): [width: number, height: number, pixelAspect: number] {
  const [sx, sy] = mode === 'braille' || mode === 'half' || mode === 'quad' || mode === 'sextant' ? LAYOUT[mode] : mode === 'tone' ? [1, 1] : [3, 5];
  return [columns * sx * 2, rows * sy * 2, (cellAspect * sx) / sy];
}

/** Draws the model and converts it to a grid. Pass the last frame's grid as `previous` to keep a spin steady. */
export function modelToGrid(model: AsciiModel, options: ModelGridOptions = {}): AsciiGrid {
  const columns = Math.max(1, Math.round(options.columns ?? 80)), cellAspect = options.cellAspect && options.cellAspect > 0 ? options.cellAspect : 2;
  const rows = Math.max(1, Math.round(options.rows ?? columns / cellAspect));
  const mode = options.mode ?? 'shape';
  const [width, height, pixelAspect] = modelPixelSize(columns, rows, cellAspect, mode);
  const pixels = renderModel(model, { ...options, width, height, pixelAspect, background: null });
  if (mode === 'braille' || mode === 'half' || mode === 'quad' || mode === 'sextant') {
    return toBlockGrid(pixels, { columns, rows, mode, cellAspect, color: !!options.color, background: options.background, dither: options.dither === true ? 'diffuse' : options.dither });
  }
  return toAsciiGrid(pixels, { ...options, columns, rows, cellAspect, mode, gamma: options.gamma ?? MODEL_GAMMA });
}

/** A full turn (or `turn` degrees) of the model as `frames` grids, each steadied by the one before. */
export function modelToGrids(model: AsciiModel, options: ModelGridOptions & { frames?: number; turn?: number } = {}): AsciiGrid[] {
  const frames = Math.max(1, Math.round(options.frames ?? 36)), turn = options.turn ?? 360, yaw = options.yaw ?? 30;
  const out: AsciiGrid[] = [];
  for (let i = 0; i < frames; i++) out.push(modelToGrid(model, { dither: 'ordered', ...options, yaw: yaw + (turn * i) / frames, previous: out[i - 1] ?? null }));
  return out;
}
