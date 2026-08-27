import type { MeshBuffer } from "../mesh";

/**
 * Axis-aligned box centered at the origin, sized directly in millimeters
 * (widthMm along X, depthMm along Y, heightMm along Z). Built directly
 * (no boolean ops) so it is manifold and correctly-wound by construction —
 * every triangle below was derived and hand-verified so that
 * (v1-v0) x (v2-v0) points outward, which is what gives a closed mesh a
 * positive signed volume (see mesh.ts computeSignedVolume).
 *
 * Not welded to shared per-face vertices for smooth-shading purposes — each
 * of the 8 corners is a single shared vertex used by 3 faces. This means a
 * renderer that calls `computeVertexNormals()` on this mesh will show
 * smoothed (not hard-edged) shading at the corners; purely cosmetic and does
 * not affect STL export (which recomputes true per-facet normals from
 * winding) or mesh validity.
 */
export function createCubeMesh(widthMm: number, depthMm: number, heightMm: number): MeshBuffer {
  const hx = widthMm / 2;
  const hy = depthMm / 2;
  const hz = heightMm / 2;

  // prettier-ignore
  const positions = new Float32Array([
    -hx, -hy, -hz, // 0
     hx, -hy, -hz, // 1
     hx,  hy, -hz, // 2
    -hx,  hy, -hz, // 3
    -hx, -hy,  hz, // 4
     hx, -hy,  hz, // 5
     hx,  hy,  hz, // 6
    -hx,  hy,  hz, // 7
  ]);

  // prettier-ignore
  const indices = new Uint32Array([
    0, 3, 2,  0, 2, 1, // bottom, outward -Z
    4, 5, 6,  4, 6, 7, // top, outward +Z
    0, 1, 5,  0, 5, 4, // front, outward -Y
    2, 3, 7,  2, 7, 6, // back, outward +Y
    1, 2, 6,  1, 6, 5, // right, outward +X
    0, 4, 7,  0, 7, 3, // left, outward -X
  ]);

  return { positions, indices };
}
