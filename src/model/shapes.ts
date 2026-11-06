import type { AsciiModel, ModelMaterial } from './types';

/*
 * Built-in shapes, made in code: a torus (the classic spinning ASCII donut), a torus knot, a sphere, a cube and an
 * icosahedron. For demos, tests and placeholders, with no file to load.
 */

export type ModelShape = 'torus' | 'knot' | 'sphere' | 'cube' | 'icosahedron';
export const MODEL_SHAPES: readonly ModelShape[] = ['torus', 'knot', 'sphere', 'cube', 'icosahedron'];

const material = (): ModelMaterial => ({ name: 'default', color: [0.8, 0.8, 0.8, 1], emissive: [0, 0, 0], texture: null, doubleSided: false });

function finish(positions: number[], normals: number[], uvs: number[] | null, indices: number[]): AsciiModel {
  const p = new Float32Array(positions), bounds = new Float32Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { bounds[k] = Math.min(bounds[k], p[i + k]); bounds[k + 3] = Math.max(bounds[k + 3], p[i + k]); }
  return {
    positions: p, normals: new Float32Array(normals), colors: null, uvs: uvs ? new Float32Array(uvs) : null,
    indices: new Uint32Array(indices), groups: [{ start: 0, count: indices.length, material: 0 }], materials: [material()],
    bounds, up: 'y', format: 'shape',
  };
}

// A grid of vertices over (u, v) in [0, 1]², joined into triangles; `at` gives a position and normal for each.
function sweep(columns: number, rows: number, at: (u: number, v: number) => [number, number, number, number, number, number]) {
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= columns; i++) {
    const [x, y, z, nx, ny, nz] = at(i / columns, j / rows);
    positions.push(x, y, z); normals.push(nx, ny, nz); uvs.push(i / columns, j / rows);
  }
  const stride = columns + 1;
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
    const a = j * stride + i, b = a + 1, c = a + stride, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  return finish(positions, normals, uvs, indices);
}

/** A built-in shape as a model. `detail` scales its tessellation (default 1). */
export function shapeModel(shape: ModelShape, options: { detail?: number } = {}): AsciiModel {
  const detail = Math.max(0.25, Math.min(4, options.detail ?? 1));
  const n = (count: number) => Math.max(3, Math.round(count * detail));
  switch (shape) {
    case 'torus': {
      const R = 1, r = 0.45;
      return sweep(n(96), n(48), (u, v) => {
        const a = u * Math.PI * 2, b = v * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
        return [(R + r * cb) * ca, r * sb, (R + r * cb) * sa, cb * ca, sb, cb * sa];
      });
    }
    case 'knot': {
      // A (2, 3) torus knot: a tube swept along the curve, its frame from the curve's direction and its second derivative.
      const p = 2, q = 3, tube = 0.3;
      const curve = (t: number): [number, number, number] => {
        const qt = q * t, pt = p * t, s = 2 + Math.cos(qt);
        return [s * Math.cos(pt) * 0.5, Math.sin(qt) * 0.5, s * Math.sin(pt) * 0.5];
      };
      return sweep(n(256), n(32), (u, v) => {
        const t = u * Math.PI * 2, e = 1e-3;
        const c = curve(t), next = curve(t + e), prev = curve(t - e);
        const T = norm([next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]]);
        const A = [next[0] + prev[0] - 2 * c[0], next[1] + prev[1] - 2 * c[1], next[2] + prev[2] - 2 * c[2]];
        const B = norm(cross(T, A as [number, number, number])), N = cross(B, T);
        const b = v * Math.PI * 2, cx = Math.cos(b), sx = Math.sin(b);
        const nx = N[0] * cx + B[0] * sx, ny = N[1] * cx + B[1] * sx, nz = N[2] * cx + B[2] * sx;
        return [c[0] + tube * nx, c[1] + tube * ny, c[2] + tube * nz, nx, ny, nz];
      });
    }
    case 'sphere':
      return sweep(n(64), n(32), (u, v) => {
        const a = u * Math.PI * 2, b = v * Math.PI, sb = Math.sin(b);
        const x = -Math.cos(a) * sb, y = Math.cos(b), z = Math.sin(a) * sb;
        return [x, y, z, x, y, z];
      });
    case 'cube': {
      const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
      const faces: [number[], number[], number[]][] = [
        [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
        [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
      ];
      for (const [normal, u, v] of faces) {
        const base = positions.length / 3;
        for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          positions.push(normal[0] + u[0] * su + v[0] * sv, normal[1] + u[1] * su + v[1] * sv, normal[2] + u[2] * su + v[2] * sv);
          normals.push(normal[0], normal[1], normal[2]); uvs.push((su + 1) / 2, (1 - sv) / 2);
        }
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      return finish(positions, normals, uvs, indices);
    }
    case 'icosahedron': {
      const t = (1 + Math.sqrt(5)) / 2;
      const corners = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
      const triangles = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
      const positions: number[] = [], normals: number[] = [], indices: number[] = [];
      // Faceted: each face its own three vertices, with the face's normal.
      for (const tri of triangles) {
        const [a, b, c] = tri.map(i => corners[i]);
        const normal = norm(cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]));
        for (const corner of [a, b, c]) { positions.push(...corner); normals.push(...normal); }
        indices.push(indices.length, indices.length + 1, indices.length + 2);
      }
      return finish(positions, normals, null, indices);
    }
  }
}

function cross(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(v: readonly number[]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
