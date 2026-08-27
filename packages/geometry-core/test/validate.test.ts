import { describe, expect, it } from "vitest";
import { createCubeMesh } from "../src/primitives/cube.js";
import { validateMesh } from "../src/validate.js";

describe("validateMesh", () => {
  it("reports a hand-built cube as fully manifold and watertight", () => {
    const report = validateMesh(createCubeMesh(18, 18, 10));
    expect(report.triangleCount).toBe(12);
    expect(report.openEdgeCount).toBe(0);
    expect(report.nonManifoldEdgeCount).toBe(0);
    expect(report.inconsistentWindingEdgeCount).toBe(0);
    expect(report.degenerateTriangleCount).toBe(0);
    expect(report.duplicateTriangleCount).toBe(0);
    expect(report.isManifold).toBe(true);
    expect(report.isWatertight).toBe(true);
    expect(report.signedVolumeMm3).toBeCloseTo(18 * 18 * 10, 2);
  });

  it("detects an open mesh (one face removed) as not watertight", () => {
    const cube = createCubeMesh(10, 10, 10);
    // drop the last face's 2 triangles (indices 30..35) to open the mesh up
    const openIndices = cube.indices.slice(0, cube.indices.length - 6);
    const report = validateMesh({ positions: cube.positions, indices: openIndices });
    expect(report.openEdgeCount).toBeGreaterThan(0);
    expect(report.isManifold).toBe(false);
    expect(report.isWatertight).toBe(false);
  });

  it("detects a non-manifold edge shared by 3+ triangles", () => {
    // a single triangle, plus two more triangles both also using its first edge (0,1)
    const positions = new Float32Array([
      0, 0, 0,  1, 0, 0,  0, 1, 0, // tri 0: verts 0,1,2
      0, 0, 1, // vert 3
      0, 0, -1, // vert 4
    ]);
    const indices = new Uint32Array([
      0, 1, 2,
      0, 1, 3, // reuses edge (0,1)
      1, 0, 4, // reuses edge (0,1) a third time
    ]);
    const report = validateMesh({ positions, indices });
    expect(report.nonManifoldEdgeCount).toBeGreaterThan(0);
    expect(report.isManifold).toBe(false);
  });

  it("detects a degenerate (zero-area) triangle", () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]); // collinear
    const indices = new Uint32Array([0, 1, 2]);
    const report = validateMesh({ positions, indices });
    expect(report.degenerateTriangleCount).toBe(1);
    expect(report.isManifold).toBe(false);
  });

  it("detects inconsistent winding between two triangles sharing an edge", () => {
    // two triangles sharing edge (0,1), both traversing it in the same direction (0->1)
    // instead of opposite directions -- simulates a flipped-normal face.
    const positions = new Float32Array([
      0, 0, 0,  1, 0, 0,  0, 1, 0,  0, 0, 1,
    ]);
    const indices = new Uint32Array([
      0, 1, 2, // edge 0->1
      0, 1, 3, // edge 0->1 again (should be 1->0 for consistent outward winding)
    ]);
    const report = validateMesh({ positions, indices });
    expect(report.inconsistentWindingEdgeCount).toBeGreaterThan(0);
    expect(report.isWatertight).toBe(false);
  });
});
