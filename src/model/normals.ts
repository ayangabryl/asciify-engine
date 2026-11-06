/**
 * Normals for a model that has none. Positions are welded first, so faces meeting at a point share it whatever their uvs or
 * colours; each face counts by its angle at the corner, and faces meeting at more than the crease angle keep apart, so a cube
 * stays sharp and a sphere smooth. A vertex is split once for each normal its corners end up with. Point clouds have no faces
 * to work from and are left as they are.
 */
import type { AsciiModel } from './types';
import { weldPoints } from './parse-util';

/** Points with more corners than this (a cone's tip, a fan's centre) are smoothed by clusters of faces, not face by face. */
const EXACT = 32;
/** Corners whose normals differ by less than this (about 0.3°) share a vertex. */
const SAME = 0.99999;

/**
 * Fills in normals where the model has none: positions welded, face normals weighted by angle, split where faces meet at
 * more than `creaseAngle` degrees (default 40), so a cube stays sharp and a sphere smooth. Returns a new model; vertex
 * colours, uvs and groups are carried over. A model that has normals, or no triangles, comes back as it is (pass
 * `{ ...model, normals: null }` to work them out again).
 */
export function withNormals(model: AsciiModel, creaseAngle = 40): AsciiModel {
  if (model.normals || !model.indices.length) return { ...model };
  const { positions, indices } = model, corners = indices.length, triangles = corners / 3;
  const crease = Math.cos((Math.min(180, Math.max(0, creaseAngle === creaseAngle ? creaseAngle : 40)) * Math.PI) / 180);
  const { ids: weld, count: points } = weldPoints(positions, positions.length / 3, null);

  // Each face's unit normal, and its angle at each corner.
  const face = new Float32Array(triangles * 3), angle = new Float32Array(corners);
  for (let t = 0; t < triangles; t++) {
    const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3;
    const abx = positions[b] - positions[a], aby = positions[b + 1] - positions[a + 1], abz = positions[b + 2] - positions[a + 2];
    const acx = positions[c] - positions[a], acy = positions[c + 1] - positions[a + 1], acz = positions[c + 2] - positions[a + 2];
    const bcx = acx - abx, bcy = acy - aby, bcz = acz - abz;
    const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx, len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (!(len > 0)) continue; // no area, no direction: its corners take their neighbours' normal
    face[t * 3] = nx / len; face[t * 3 + 1] = ny / len; face[t * 3 + 2] = nz / len;
    angle[t * 3] = between(abx, aby, abz, acx, acy, acz);
    angle[t * 3 + 1] = between(-abx, -aby, -abz, bcx, bcy, bcz);
    angle[t * 3 + 2] = Math.max(0, Math.PI - angle[t * 3] - angle[t * 3 + 1]);
  }

  // The corners at each welded point, gathered (counted, then placed).
  const start = new Uint32Array(points + 1);
  for (let k = 0; k < corners; k++) start[weld[indices[k]] + 1]++;
  for (let p = 0; p < points; p++) start[p + 1] += start[p];
  const at = start.slice(0, points), order = new Uint32Array(corners);
  for (let k = 0; k < corners; k++) order[at[weld[indices[k]]]++] = k;

  // One output vertex per original vertex and normal; outputs of the same original vertex are chained for reuse.
  const source = new Uint32Array(corners), normal = new Float32Array(corners * 3), remap = new Uint32Array(corners);
  const head = new Int32Array(positions.length / 3).fill(-1), chain = new Int32Array(corners);
  const sums = new Float64Array(EXACT * 3), seeds = new Float32Array(EXACT * 3), cluster = new Int32Array(corners);
  let made = 0;
  const place = (corner: number, x: number, y: number, z: number) => {
    const vertex = indices[corner];
    for (let o = head[vertex]; o >= 0; o = chain[o]) {
      if (normal[o * 3] * x + normal[o * 3 + 1] * y + normal[o * 3 + 2] * z >= SAME) { remap[corner] = o; return; }
    }
    const o = made++;
    source[o] = vertex;
    normal[o * 3] = x; normal[o * 3 + 1] = y; normal[o * 3 + 2] = z;
    chain[o] = head[vertex];
    head[vertex] = o;
    remap[corner] = o;
  };

  for (let p = 0; p < points; p++) {
    const first = start[p], last = start[p + 1], k = last - first;
    // What every face at this point adds up to: the normal for corners of faces with no area.
    let ax = 0, ay = 0, az = 0;
    for (let i = first; i < last; i++) {
      const c = order[i], t = (c / 3) | 0, w = angle[c];
      ax += face[t * 3] * w; ay += face[t * 3 + 1] * w; az += face[t * 3 + 2] * w;
    }
    const alen = Math.sqrt(ax * ax + ay * ay + az * az);
    if (alen > 0) { ax /= alen; ay /= alen; az /= alen; } else { ax = 0; ay = 0; az = 1; }

    if (k <= EXACT) {
      // Each corner: the faces here within the crease angle of its own face.
      for (let i = first; i < last; i++) {
        const c = order[i], t = (c / 3) | 0, fx = face[t * 3], fy = face[t * 3 + 1], fz = face[t * 3 + 2];
        if (fx === 0 && fy === 0 && fz === 0) { place(c, ax, ay, az); continue; }
        let x = 0, y = 0, z = 0;
        for (let j = first; j < last; j++) {
          const d = order[j], u = (d / 3) | 0, gx = face[u * 3], gy = face[u * 3 + 1], gz = face[u * 3 + 2];
          if (u !== t && fx * gx + fy * gy + fz * gz < crease) continue;
          const w = angle[d];
          x += gx * w; y += gy * w; z += gz * w;
        }
        const len = Math.sqrt(x * x + y * y + z * z);
        if (len > 0) place(c, x / len, y / len, z / len); else place(c, fx, fy, fz);
      }
      continue;
    }

    // Many corners: faces join the first cluster whose first face is within the crease angle (at most EXACT clusters).
    let clusters = 0;
    for (let i = first; i < last; i++) {
      const c = order[i], t = (c / 3) | 0, fx = face[t * 3], fy = face[t * 3 + 1], fz = face[t * 3 + 2];
      if (fx === 0 && fy === 0 && fz === 0) { cluster[c] = -1; continue; }
      let best = -1, bestDot = -2;
      for (let q = 0; q < clusters; q++) {
        const dot = fx * seeds[q * 3] + fy * seeds[q * 3 + 1] + fz * seeds[q * 3 + 2];
        if (dot >= crease) { best = q; break; }
        if (dot > bestDot) { bestDot = dot; best = q; }
      }
      if (best < 0 || (clusters < EXACT && fx * seeds[best * 3] + fy * seeds[best * 3 + 1] + fz * seeds[best * 3 + 2] < crease)) {
        best = clusters++;
        seeds[best * 3] = fx; seeds[best * 3 + 1] = fy; seeds[best * 3 + 2] = fz;
        sums[best * 3] = sums[best * 3 + 1] = sums[best * 3 + 2] = 0;
      }
      const w = angle[c];
      sums[best * 3] += fx * w; sums[best * 3 + 1] += fy * w; sums[best * 3 + 2] += fz * w;
      cluster[c] = best;
    }
    for (let i = first; i < last; i++) {
      const c = order[i], q = cluster[c];
      if (q < 0) { place(c, ax, ay, az); continue; }
      const x = sums[q * 3], y = sums[q * 3 + 1], z = sums[q * 3 + 2], len = Math.sqrt(x * x + y * y + z * z);
      if (len > 0) place(c, x / len, y / len, z / len); else place(c, seeds[q * 3], seeds[q * 3 + 1], seeds[q * 3 + 2]);
    }
  }

  const outPositions = new Float32Array(made * 3), outNormals = normal.slice(0, made * 3);
  const outColors = model.colors ? new Float32Array(made * 3) : null, outUvs = model.uvs ? new Float32Array(made * 2) : null;
  const bounds = new Float32Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
  for (let o = 0; o < made; o++) {
    const v = source[o];
    for (let c = 0; c < 3; c++) {
      const value = positions[v * 3 + c];
      outPositions[o * 3 + c] = value;
      if (value < bounds[c]) bounds[c] = value;
      if (value > bounds[c + 3]) bounds[c + 3] = value;
      if (outColors) outColors[o * 3 + c] = model.colors![v * 3 + c];
    }
    if (outUvs) { outUvs[o * 2] = model.uvs![v * 2]; outUvs[o * 2 + 1] = model.uvs![v * 2 + 1]; }
  }
  return {
    ...model, positions: outPositions, normals: outNormals, colors: outColors, uvs: outUvs, indices: remap,
    groups: model.groups.map(group => ({ ...group })), bounds,
  };
}

/** The angle between two vectors, in radians (0 if either is zero). */
function between(ux: number, uy: number, uz: number, vx: number, vy: number, vz: number): number {
  const l = Math.sqrt((ux * ux + uy * uy + uz * uz) * (vx * vx + vy * vy + vz * vz));
  if (!(l > 0)) return 0;
  const c = (ux * vx + uy * vy + uz * vz) / l;
  return Math.acos(c > 1 ? 1 : c < -1 ? -1 : c);
}
