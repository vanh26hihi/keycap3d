import type { MeshBuffer } from "./mesh";
import { computeSignedVolume, triangleCount } from "./mesh";

export interface MeshValidationReport {
  triangleCount: number;
  /** Undirected edges touched by exactly 1 triangle — the mesh has a hole/boundary, not closed. */
  openEdgeCount: number;
  /** Undirected edges touched by 3+ triangles — genuinely non-manifold topology. */
  nonManifoldEdgeCount: number;
  /** Undirected edges touched by exactly 2 triangles, but both traverse the edge in the same
   * direction instead of opposite directions — the two faces disagree on winding/outward normal. */
  inconsistentWindingEdgeCount: number;
  /** Triangles with (near-)zero area. */
  degenerateTriangleCount: number;
  /** Triangles that reference the same 3 vertices as another triangle (regardless of winding). */
  duplicateTriangleCount: number;
  /** Closed (no open/non-manifold edges) and free of degenerate triangles. */
  isManifold: boolean;
  /** isManifold AND consistent winding everywhere — the bar for "safe to boolean/print". */
  isWatertight: boolean;
  signedVolumeMm3: number;
}

const DEGENERATE_AREA_EPSILON_MM2 = 1e-9;

export function validateMesh(mesh: MeshBuffer): MeshValidationReport {
  const idx = mesh.indices;
  const pos = mesh.positions;
  const triCount = triangleCount(mesh);

  const undirectedCount = new Map<string, number>();
  const directedCount = new Map<string, number>();
  const triangleKeySeen = new Map<string, number>();

  let degenerateTriangleCount = 0;
  let duplicateTriangleCount = 0;

  const addEdge = (a: number, b: number) => {
    const uKey = a < b ? `${a},${b}` : `${b},${a}`;
    undirectedCount.set(uKey, (undirectedCount.get(uKey) ?? 0) + 1);
    const dKey = `${a},${b}`;
    directedCount.set(dKey, (directedCount.get(dKey) ?? 0) + 1);
  };

  for (let t = 0; t < triCount; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];

    const triKey = [a, b, c].slice().sort((x, y) => x - y).join(",");
    triangleKeySeen.set(triKey, (triangleKeySeen.get(triKey) ?? 0) + 1);

    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
    const cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const crossX = uy * vz - uz * vy;
    const crossY = uz * vx - ux * vz;
    const crossZ = ux * vy - uy * vx;
    const area = 0.5 * Math.sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ);
    if (area < DEGENERATE_AREA_EPSILON_MM2) degenerateTriangleCount++;

    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }

  for (const count of triangleKeySeen.values()) {
    if (count > 1) duplicateTriangleCount += count - 1;
  }

  let openEdgeCount = 0;
  let nonManifoldEdgeCount = 0;
  let inconsistentWindingEdgeCount = 0;

  for (const [uKey, count] of undirectedCount) {
    if (count === 1) {
      openEdgeCount++;
    } else if (count > 2) {
      nonManifoldEdgeCount++;
    } else {
      // count === 2: for consistent winding, one direction must appear exactly once
      // and the reverse direction exactly once (opposite traversal on shared edge).
      const [a, b] = uKey.split(",");
      const forward = directedCount.get(`${a},${b}`) ?? 0;
      const backward = directedCount.get(`${b},${a}`) ?? 0;
      if (!(forward === 1 && backward === 1)) {
        inconsistentWindingEdgeCount++;
      }
    }
  }

  const isManifold = openEdgeCount === 0 && nonManifoldEdgeCount === 0 && degenerateTriangleCount === 0;
  const isWatertight = isManifold && inconsistentWindingEdgeCount === 0;

  return {
    triangleCount: triCount,
    openEdgeCount,
    nonManifoldEdgeCount,
    inconsistentWindingEdgeCount,
    degenerateTriangleCount,
    duplicateTriangleCount,
    isManifold,
    isWatertight,
    signedVolumeMm3: computeSignedVolume(mesh),
  };
}
