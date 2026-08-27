/**
 * The single internal mesh representation shared by every module in this
 * package (generators, boolean engine, STL I/O, validation). Positions are
 * always in millimeters (see units.ts). This type intentionally mirrors the
 * flat-array shape that both `THREE.BufferGeometry` and manifold-3d's `Mesh`
 * use, so the conversion functions in `convert/` are close to zero-cost.
 */
export interface MeshBuffer {
  /** Flat [x0,y0,z0, x1,y1,z1, ...] vertex positions in millimeters. */
  positions: Float32Array;
  /** Flat triangle indices into `positions`, length always a multiple of 3. */
  indices: Uint32Array;
  /** Optional flat per-vertex normals, same layout as `positions`. */
  normals?: Float32Array;
}

export function vertexCount(mesh: MeshBuffer): number {
  return mesh.positions.length / 3;
}

export function triangleCount(mesh: MeshBuffer): number {
  return mesh.indices.length / 3;
}

/**
 * Concatenates multiple mesh buffers into one, offsetting each mesh's
 * indices by the running vertex count so far. Produces a single buffer with
 * as many disjoint components as input meshes -- valid input to the Boolean
 * Engine as long as no two components touch/overlap (manifold-3d accepts a
 * mesh made of several independently-closed solids; each component must
 * individually satisfy the manifold/watertight/consistent-winding rules,
 * same as any single mesh passed to `toManifold`). Does not weld any
 * vertices between components.
 */
export function mergeMeshes(meshes: MeshBuffer[]): MeshBuffer {
  let totalVerts = 0;
  let totalIndices = 0;
  for (const m of meshes) {
    totalVerts += vertexCount(m);
    totalIndices += m.indices.length;
  }
  const positions = new Float32Array(totalVerts * 3);
  const indices = new Uint32Array(totalIndices);
  let vertOffset = 0;
  let posCursor = 0;
  let idxCursor = 0;
  for (const m of meshes) {
    positions.set(m.positions, posCursor);
    posCursor += m.positions.length;
    for (let i = 0; i < m.indices.length; i++) {
      indices[idxCursor++] = m.indices[i] + vertOffset;
    }
    vertOffset += vertexCount(m);
  }
  return { positions, indices };
}

export function cloneMesh(mesh: MeshBuffer): MeshBuffer {
  return {
    positions: mesh.positions.slice(),
    indices: mesh.indices.slice(),
    normals: mesh.normals ? mesh.normals.slice() : undefined,
  };
}

export interface BoundingBox {
  min: [number, number, number];
  max: [number, number, number];
  /** max - min per axis, i.e. the printable footprint in millimeters. */
  size: [number, number, number];
}

export function computeBoundingBox(mesh: MeshBuffer): BoundingBox {
  const p = mesh.positions;
  if (p.length === 0) {
    return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] };
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    size: [maxX - minX, maxY - minY, maxZ - minZ],
  };
}

export function boundingBoxMaxDimension(box: BoundingBox): number {
  return Math.max(box.size[0], box.size[1], box.size[2]);
}

export function computeCentroid(mesh: MeshBuffer): [number, number, number] {
  const n = vertexCount(mesh);
  if (n === 0) return [0, 0, 0];
  let sx = 0, sy = 0, sz = 0;
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    sx += p[i];
    sy += p[i + 1];
    sz += p[i + 2];
  }
  return [sx / n, sy / n, sz / n];
}

/**
 * Signed volume in mm^3 via the divergence theorem: sum of the signed
 * tetrahedron volumes formed by each triangle and the origin. Positive for a
 * closed mesh with outward-facing (right-hand / CCW as seen from outside)
 * winding; negative indicates inverted winding (mesh is "inside out").
 * Meaningless (but still computed) for a non-closed mesh.
 */
export function computeSignedVolume(mesh: MeshBuffer): number {
  const p = mesh.positions;
  const idx = mesh.indices;
  let vol = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const ia = idx[i] * 3, ib = idx[i + 1] * 3, ic = idx[i + 2] * 3;
    const ax = p[ia], ay = p[ia + 1], az = p[ia + 2];
    const bx = p[ib], by = p[ib + 1], bz = p[ib + 2];
    const cx = p[ic], cy = p[ic + 1], cz = p[ic + 2];
    // (1/6) * a . (b x c)
    vol += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
  }
  return vol;
}

/**
 * Welds vertices that are within `epsilonMm` of each other into a single
 * shared vertex and rewrites indices accordingly. STL is an unindexed format
 * (every triangle repeats its own copy of each vertex), so this is the step
 * that reconstructs shared topology after import — required before manifold
 * validation or any boolean operation, both of which depend on edges being
 * recognized as shared between exactly two triangles.
 *
 * Uses spatial hashing on a grid of `epsilonMm` cells: O(n) expected, exact
 * for coincident points, and correct-enough for near-coincident points from
 * float32 STL round-tripping. It is not a general nearest-neighbor weld
 * (points on either side of a cell boundary that are within epsilon but in
 * different cells are not merged) — acceptable here because STL export/import
 * round-trips produce either exactly-coincident or floating-point-noise-level
 * differences, never a spread of independently-perturbed points near a cell
 * edge. Documented as a known limitation, not a silent gap.
 */
export function weldVertices(mesh: MeshBuffer, epsilonMm = 1e-5): MeshBuffer {
  const p = mesh.positions;
  const n = vertexCount(mesh);
  const cellSize = Math.max(epsilonMm, 1e-9);
  const grid = new Map<string, number[]>();
  const newPositions: number[] = [];
  const remap = new Int32Array(n);

  const keyFor = (x: number, y: number, z: number) =>
    `${Math.round(x / cellSize)},${Math.round(y / cellSize)},${Math.round(z / cellSize)}`;

  for (let vi = 0; vi < n; vi++) {
    const x = p[vi * 3], y = p[vi * 3 + 1], z = p[vi * 3 + 2];
    const key = keyFor(x, y, z);
    let bucket = grid.get(key);
    let found = -1;
    if (bucket) {
      for (const candidate of bucket) {
        const cx = newPositions[candidate * 3];
        const cy = newPositions[candidate * 3 + 1];
        const cz = newPositions[candidate * 3 + 2];
        const dx = cx - x, dy = cy - y, dz = cz - z;
        if (dx * dx + dy * dy + dz * dz <= epsilonMm * epsilonMm) {
          found = candidate;
          break;
        }
      }
    } else {
      bucket = [];
      grid.set(key, bucket);
    }
    if (found >= 0) {
      remap[vi] = found;
    } else {
      const newIndex = newPositions.length / 3;
      newPositions.push(x, y, z);
      bucket.push(newIndex);
      remap[vi] = newIndex;
    }
  }

  const newIndices = new Uint32Array(mesh.indices.length);
  for (let i = 0; i < mesh.indices.length; i++) {
    newIndices[i] = remap[mesh.indices[i]];
  }

  return {
    positions: new Float32Array(newPositions),
    indices: newIndices,
  };
}
