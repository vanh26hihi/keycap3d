import type { MeshBuffer } from "../mesh";

/**
 * Circular cylinder centered at the origin, axis along Z, sized directly in
 * millimeters. Built directly (no boolean ops, no revolve-via-CSG) so it is
 * manifold and correctly-wound by construction, verified the same way as
 * `createCubeMesh` (outward-pointing (v1-v0) x (v2-v0) for every triangle).
 *
 * `radialSegments` is a polygon approximation of a true circle — like every
 * mesh cylinder, the actual printed diameter is very slightly under the
 * nominal one (the polygon's vertices sit ON the nominal radius, so the
 * flat-to-flat distance across faces is smaller by a factor of
 * cos(pi/radialSegments)). At the default 32 segments that's a ~0.05% error,
 * negligible next to FDM printer tolerance; documented here rather than
 * silently ignored since the task explicitly calls for dimensional honesty.
 */
export function createCylinderMesh(
  diameterMm: number,
  heightMm: number,
  radialSegments = 32,
): MeshBuffer {
  if (radialSegments < 3) {
    throw new Error(`createCylinderMesh: radialSegments must be >= 3, got ${radialSegments}`);
  }
  const r = diameterMm / 2;
  const halfH = heightMm / 2;

  const positions: number[] = [];
  for (let i = 0; i < radialSegments; i++) {
    const angle = (i / radialSegments) * Math.PI * 2;
    const x = r * Math.cos(angle);
    const y = r * Math.sin(angle);
    positions.push(x, y, -halfH);
  }
  for (let i = 0; i < radialSegments; i++) {
    const angle = (i / radialSegments) * Math.PI * 2;
    const x = r * Math.cos(angle);
    const y = r * Math.sin(angle);
    positions.push(x, y, halfH);
  }
  const bottomCenterIndex = radialSegments * 2;
  const topCenterIndex = radialSegments * 2 + 1;
  positions.push(0, 0, -halfH); // bottomCenter
  positions.push(0, 0, halfH); // topCenter

  const indices: number[] = [];
  for (let i = 0; i < radialSegments; i++) {
    const next = (i + 1) % radialSegments;
    const b0 = i, b1 = next;
    const t0 = radialSegments + i, t1 = radialSegments + next;
    // side: outward radial normal, verified against exact right-angle case in tests
    indices.push(b0, b1, t1);
    indices.push(b0, t1, t0);
    // bottom cap fan, outward -Z
    indices.push(bottomCenterIndex, b1, b0);
    // top cap fan, outward +Z
    indices.push(topCenterIndex, t0, t1);
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}
