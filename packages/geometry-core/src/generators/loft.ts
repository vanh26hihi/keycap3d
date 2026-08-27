import type { MeshBuffer } from "../mesh";
import { polygonCentroid2D } from "../primitives/roundedRect";

/**
 * Lofts a manifold solid between two closed 2D polygon profiles (same point
 * count, index-for-index correspondence -- point i of `bottomPoints` connects
 * to point i of `topPoints`) placed at two different Z heights. Both
 * profiles must be wound counter-clockwise as seen from +Z (see
 * `roundedRectProfile`) and must be star-shaped from their own centroid
 * (true for any convex profile, which is all this package currently
 * produces) so a simple centroid fan can cap each end.
 *
 * Built directly (no boolean ops) exactly like `createCubeMesh`/
 * `createCylinderMesh`: the side-wall and cap winding here is the same
 * outward-normal-by-construction pattern proven correct for
 * `createCylinderMesh` (side quad `(b0,b1,t1)`+`(b0,t1,t0)`, bottom fan
 * `(center,b1,b0)`, top fan `(center,t0,t1)`) -- that derivation generalizes
 * to any CCW-wound convex ring, not just a circle, since winding sense is
 * determined by the ring's rotational sense, not its specific shape.
 * Verified empirically in tests via `computeSignedVolume` > 0.
 */
export function loftProfiles(
  bottomPoints: Array<[number, number]>,
  topPoints: Array<[number, number]>,
  bottomZ: number,
  topZ: number,
): MeshBuffer {
  if (bottomPoints.length !== topPoints.length) {
    throw new Error(
      `loftProfiles: bottomPoints (${bottomPoints.length}) and topPoints (${topPoints.length}) must have the same point count for index-to-index correspondence.`,
    );
  }
  const n = bottomPoints.length;
  const positions: number[] = [];

  for (const [x, y] of bottomPoints) positions.push(x, y, bottomZ);
  for (const [x, y] of topPoints) positions.push(x, y, topZ);

  const bottomCenterIndex = 2 * n;
  const topCenterIndex = 2 * n + 1;
  const bc = polygonCentroid2D(bottomPoints);
  const tc = polygonCentroid2D(topPoints);
  positions.push(bc[0], bc[1], bottomZ);
  positions.push(tc[0], tc[1], topZ);

  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    const b0 = i;
    const b1 = next;
    const t0 = n + i;
    const t1 = n + next;

    indices.push(b0, b1, t1);
    indices.push(b0, t1, t0);
    indices.push(bottomCenterIndex, b1, b0);
    indices.push(topCenterIndex, t0, t1);
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}
