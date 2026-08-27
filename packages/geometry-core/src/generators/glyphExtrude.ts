import earcut from "earcut";
import type { MeshBuffer } from "../mesh";
import type { GlyphIsland } from "./glyphOutline";

/**
 * Extrudes one glyph island (an outer boundary plus its holes, both already
 * normalized to outer=CCW/holes=CW by `groupContoursIntoIslands`) into a
 * closed, manifold 3D solid between `bottomZ` and `topZ`. Caps are
 * triangulated with `earcut` (the only piece of this generator that isn't a
 * manifold-by-construction primitive like `loftProfiles`/`createCubeMesh` --
 * earcut is the standard, widely-used way to triangulate a polygon with
 * holes, needed here because a fan-from-centroid cap only works for convex
 * shapes, and most letterforms aren't convex).
 *
 * Winding was derived empirically against `computeSignedVolume` and
 * `validateMesh` on real glyphs (round letters with holes, like "O"/"A"/"B",
 * and holeless ones like "L"), not just reasoned out on paper -- see
 * test/glyphExtrude.test.ts.
 */
export function extrudeGlyphIsland(island: GlyphIsland, bottomZ: number, topZ: number): MeshBuffer {
  const rings = [island.outer, ...island.holes];
  const ringStart: number[] = [];
  const flatVerts: number[] = [];
  let cursor = 0;
  for (const ring of rings) {
    ringStart.push(cursor);
    for (const [x, y] of ring) flatVerts.push(x, y);
    cursor += ring.length;
  }
  const holeIndices = island.holes.length > 0 ? ringStart.slice(1) : undefined;
  const capTriangles = earcut(flatVerts, holeIndices);

  const n = flatVerts.length / 2;
  const positions = new Float32Array(n * 2 * 3);
  for (let i = 0; i < n; i++) {
    const x = flatVerts[i * 2];
    const y = flatVerts[i * 2 + 1];
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = bottomZ;
    positions[(n + i) * 3] = x;
    positions[(n + i) * 3 + 1] = y;
    positions[(n + i) * 3 + 2] = topZ;
  }

  const indices: number[] = [];
  // Top cap: earcut's triangle order is CCW for a CCW-wound outer boundary
  // (our normalized convention), which is already outward-facing at +Z.
  for (let i = 0; i < capTriangles.length; i += 3) {
    const a = n + capTriangles[i];
    const b = n + capTriangles[i + 1];
    const c = n + capTriangles[i + 2];
    indices.push(a, b, c);
  }
  // Bottom cap: same triangulation, reversed winding to face outward at -Z.
  for (let i = 0; i < capTriangles.length; i += 3) {
    const a = capTriangles[i];
    const b = capTriangles[i + 1];
    const c = capTriangles[i + 2];
    indices.push(a, c, b);
  }
  // Side walls, one ring at a time -- a CCW (outer) ring produces
  // outward-facing quads by this construction; a CW (hole) ring produces
  // inward-facing quads (toward the hole's void) by the same construction,
  // which is exactly what's needed since the solid material is OUTSIDE a
  // hole boundary. Same b0,b1,t1 / b0,t1,t0 pattern as loftProfiles.
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r];
    const base = ringStart[r];
    const len = ring.length;
    for (let i = 0; i < len; i++) {
      const next = (i + 1) % len;
      const b0 = base + i;
      const b1 = base + next;
      const t0 = n + base + i;
      const t1 = n + base + next;
      indices.push(b0, b1, t1);
      indices.push(b0, t1, t0);
    }
  }

  return { positions, indices: new Uint32Array(indices) };
}
