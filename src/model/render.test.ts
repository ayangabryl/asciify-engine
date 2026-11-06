import { describe, expect, it } from 'vitest';
import { modelToGrid, modelToGrids } from './ascii';
import { modelFrames, renderModel } from './render';
import { MODEL_SHAPES, shapeModel } from './shapes';
import type { AsciiModel } from './types';

const at = (px: { data: Uint8Array; width: number }, x: number, y: number) => {
  const i = (y * px.width + x) * 4;
  return [px.data[i], px.data[i + 1], px.data[i + 2], px.data[i + 3]];
};
const luma = (rgba: number[]) => 0.2126 * rgba[0] + 0.7152 * rgba[1] + 0.0722 * rgba[2];

// Two squares facing the viewer, the second smaller and in front of the first.
function layered(): AsciiModel {
  const positions = new Float32Array([
    -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0,
    -0.4, -0.4, 0.6, 0.4, -0.4, 0.6, 0.4, 0.4, 0.6, -0.4, 0.4, 0.6,
  ]);
  const normals = new Float32Array(Array.from({ length: 8 }, () => [0, 0, 1]).flat());
  return {
    positions, normals, colors: null, uvs: null, indices: new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]),
    groups: [{ start: 0, count: 12, material: 0 }], materials: [{ name: 'm', color: [0.8, 0.8, 0.8, 1], emissive: [0, 0, 0], texture: null, doubleSided: true }],
    bounds: new Float32Array([-1, -1, 0, 1, 1, 0.6]), up: 'y', format: 'shape',
  };
}

describe('built-in shapes', () => {
  it('are closed meshes with unit normals and bounds', () => {
    for (const name of MODEL_SHAPES) {
      const model = shapeModel(name);
      expect(model.indices.length % 3).toBe(0);
      expect(model.indices.length).toBeGreaterThan(0);
      expect(Math.max(...model.indices)).toBeLessThan(model.positions.length / 3);
      for (let i = 0; i < model.normals!.length; i += 3) expect(Math.hypot(model.normals![i], model.normals![i + 1], model.normals![i + 2])).toBeCloseTo(1, 3);
      expect(model.bounds[3]).toBeGreaterThan(model.bounds[0]);
    }
    expect(shapeModel('cube').indices.length).toBe(36);
  });
});

describe('renderModel', () => {
  const sphere = shapeModel('sphere');
  it('draws the model lit from the upper left on a transparent ground', () => {
    const px = renderModel(sphere, { width: 100, height: 100, yaw: 0, pitch: 0 });
    expect(px.data).toHaveLength(100 * 100 * 4);
    expect(at(px, 1, 1)[3]).toBe(0);
    expect(at(px, 50, 50)[3]).toBe(255);
    // The key light is up and to the left: that side is lighter than the lower right.
    expect(luma(at(px, 35, 35))).toBeGreaterThan(luma(at(px, 65, 65)) + 40);
  });
  it('fills the background when given one, and averages samples into soft edges', () => {
    const px = renderModel(sphere, { width: 60, height: 60, background: '#ff0000' });
    expect(at(px, 0, 0)).toEqual([255, 0, 0, 255]);
    const soft = renderModel(sphere, { width: 60, height: 60, samples: 3 });
    const alphas = new Set<number>();
    for (let i = 3; i < soft.data.length; i += 4) alphas.add(soft.data[i]);
    expect([...alphas].some(a => a > 0 && a < 255)).toBe(true);
  });
  it('outlines a surface in front of another', () => {
    const plain = renderModel(layered(), { width: 120, height: 120, yaw: 0, pitch: 0, outline: 0 });
    const lined = renderModel(layered(), { width: 120, height: 120, yaw: 0, pitch: 0, outline: 1 });
    // Just outside the front square's left edge, on the square behind.
    let darkened = 0;
    for (let x = 0; x < 120; x++) if (luma(at(lined, x, 60)) < luma(at(plain, x, 60)) - 30) darkened++;
    expect(darkened).toBeGreaterThan(0);
    expect(darkened).toBeLessThan(8);
    expect(luma(at(lined, 60, 60))).toBeCloseTo(luma(at(plain, 60, 60)), 0);
  });
  it('paints, and shades by normals and by depth', () => {
    const red = renderModel(sphere, { width: 40, height: 40, paint: '#ff0000', yaw: 0, pitch: 0, rim: 0, specular: 0 });
    const c = at(red, 16, 16);
    expect(c[0]).toBeGreaterThan(c[1] + 60);
    const normals = renderModel(sphere, { width: 40, height: 40, shading: 'normals', yaw: 0, pitch: 0 });
    expect(at(normals, 36, 20)[0]).toBeGreaterThan(at(normals, 4, 20)[0]);
    const depth = renderModel(layered(), { width: 80, height: 80, shading: 'depth', yaw: 0, pitch: 0, outline: 0 });
    expect(luma(at(depth, 40, 40))).toBeGreaterThan(luma(at(depth, 8, 40)));
  });
  it('stands z-up files upright', () => {
    // A thin needle along +z: drawn tall with up 'z', wide with up 'y' seen from the side.
    const needle: AsciiModel = { ...shapeModel('cube'), up: 'z' };
    needle.positions = needle.positions.map((v, i) => (i % 3 === 2 ? v * 5 : v));
    needle.bounds = new Float32Array([-1, -1, -5, 1, 1, 5]);
    const extent = (px: ReturnType<typeof renderModel>) => {
      let minX = px.width, maxX = 0, minY = px.height, maxY = 0;
      for (let y = 0; y < px.height; y++) for (let x = 0; x < px.width; x++) if (at(px, x, y)[3]) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      return [maxX - minX, maxY - minY];
    };
    const [w, h] = extent(renderModel(needle, { width: 100, height: 100, yaw: 0, pitch: 0 }));
    expect(h).toBeGreaterThan(w * 3);
  });
  it('samples textures at the uvs', () => {
    // A square facing the viewer, textured red on the left half and blue on the right (uv v down, as glTF has it).
    const quad: AsciiModel = {
      ...layered(), positions: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
      uvs: new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), indices: new Uint32Array([0, 1, 2, 0, 2, 3]), groups: [{ start: 0, count: 6, material: 0 }],
      bounds: new Float32Array([-1, -1, 0, 1, 1, 0]),
    };
    quad.materials = [{ ...quad.materials[0], color: [1, 1, 1, 1], texture: { bytes: null, mimeType: null, uri: null, wrap: 'clamp', image: { width: 2, height: 1, data: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]) } } }];
    const px = renderModel(quad, { width: 80, height: 80, yaw: 0, pitch: 0, outline: 0, rim: 0, specular: 0 });
    const left = at(px, 25, 40), right = at(px, 55, 40);
    expect(left[0]).toBeGreaterThan(left[2] + 40);
    expect(right[2]).toBeGreaterThan(right[0] + 40);
  });
  it('works out smooth normals for a model that has none', () => {
    const sphere = shapeModel('sphere'), bare: AsciiModel = { ...sphere, normals: null };
    const a = renderModel(sphere, { width: 60, height: 60 }), b = renderModel(bare, { width: 60, height: 60 });
    let diff = 0, n = 0;
    for (let i = 0; i < a.data.length; i += 4) if (a.data[i + 3] && b.data[i + 3]) { diff += Math.abs(luma([...a.data.subarray(i, i + 4)]) - luma([...b.data.subarray(i, i + 4)])); n++; }
    expect(diff / n).toBeLessThan(4);
  });
  it('draws point clouds as discs', () => {
    const cloud: AsciiModel = { ...shapeModel('sphere'), indices: new Uint32Array(0), groups: [] };
    const px = renderModel(cloud, { width: 80, height: 80 });
    let covered = 0;
    for (let i = 3; i < px.data.length; i += 4) if (px.data[i]) covered++;
    expect(covered).toBeGreaterThan(80 * 80 * 0.3);
  });
  it('turns for frames', () => {
    const frames = modelFrames(shapeModel('knot'), { width: 40, height: 40, frames: 4 });
    expect(frames).toHaveLength(4);
    expect(Buffer.from(frames[0].data).equals(Buffer.from(frames[1].data))).toBe(false);
  });
});

describe('modelToGrid', () => {
  it('draws a model as characters at the size asked', () => {
    const grid = modelToGrid(shapeModel('torus'), { columns: 48 });
    expect(grid.columns).toBe(48);
    expect(grid.rows).toBe(24);
    const text = grid.lines.join('\n');
    expect(text.trim().length).toBeGreaterThan(200);
    // The ground around the model stays empty.
    expect(grid.lines[0].trim()).toBe('');
    const braille = modelToGrid(shapeModel('torus'), { columns: 40, mode: 'braille' });
    expect([...braille.lines[10]].every(ch => ch.charCodeAt(0) >= 0x2800 && ch.charCodeAt(0) <= 0x28ff)).toBe(true);
  });
  it('keeps a turn steady from frame to frame', () => {
    const grids = modelToGrids(shapeModel('torus'), { columns: 40, frames: 6, turn: 30 });
    expect(grids).toHaveLength(6);
    let changed = 0, cells = 0;
    for (let i = 1; i < grids.length; i++) for (let r = 0; r < grids[i].rows; r++) for (let c = 0; c < grids[i].columns; c++) { cells++; if (grids[i].lines[r][c] !== grids[i - 1].lines[r][c]) changed++; }
    expect(changed / cells).toBeLessThan(0.25);
  });
});
