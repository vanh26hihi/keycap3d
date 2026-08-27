import { describe, expect, it } from "vitest";
import { createCubeMesh } from "../src/primitives/cube.js";
import { createCylinderMesh } from "../src/primitives/cylinder.js";
import {
  boundingBoxMaxDimension,
  computeBoundingBox,
  computeCentroid,
  computeSignedVolume,
  triangleCount,
  vertexCount,
  weldVertices,
} from "../src/mesh.js";

describe("primitives are correctly sized in millimeters (1 unit = 1mm)", () => {
  it("cube bounding box matches requested mm dimensions exactly", () => {
    const mesh = createCubeMesh(18, 18, 10);
    const box = computeBoundingBox(mesh);
    expect(box.size[0]).toBeCloseTo(18, 6);
    expect(box.size[1]).toBeCloseTo(18, 6);
    expect(box.size[2]).toBeCloseTo(10, 6);
    // centered at origin
    expect(box.min).toEqual([-9, -9, -5]);
    expect(box.max).toEqual([9, 9, 5]);
  });

  it("cube is centered on its centroid", () => {
    const mesh = createCubeMesh(18, 18, 10);
    const c = computeCentroid(mesh);
    expect(c[0]).toBeCloseTo(0, 6);
    expect(c[1]).toBeCloseTo(0, 6);
    expect(c[2]).toBeCloseTo(0, 6);
  });

  it("cube has outward winding -> positive signed volume equal to w*d*h", () => {
    const mesh = createCubeMesh(18, 18, 10);
    const vol = computeSignedVolume(mesh);
    expect(vol).toBeCloseTo(18 * 18 * 10, 2);
  });

  it("cylinder bounding box diameter and height match mm exactly (vertices lie on nominal radius)", () => {
    const mesh = createCylinderMesh(14, 20, 64);
    const box = computeBoundingBox(mesh);
    // with enough segments, the polygon's extreme vertices land essentially on the nominal diameter
    expect(box.size[0]).toBeCloseTo(14, 3);
    expect(box.size[1]).toBeCloseTo(14, 3);
    expect(box.size[2]).toBeCloseTo(20, 6);
  });

  it("cylinder polygon approximation under-shoots true circle area by cos(pi/n) as documented", () => {
    const segments = 32;
    const mesh = createCylinderMesh(14, 20, segments);
    const box = computeBoundingBox(mesh);
    // bounding box is still the true nominal diameter (vertices sit ON the circle),
    // but volume is slightly less than a true cylinder of that diameter.
    const trueVolume = Math.PI * (14 / 2) ** 2 * 20;
    const vol = computeSignedVolume(mesh);
    expect(vol).toBeLessThan(trueVolume);
    expect(vol).toBeGreaterThan(trueVolume * 0.99);
    expect(box.size[2]).toBeCloseTo(20, 6);
  });

  it("cylinder has outward winding -> positive signed volume", () => {
    const mesh = createCylinderMesh(14, 20, 32);
    expect(computeSignedVolume(mesh)).toBeGreaterThan(0);
  });

  it("boundingBoxMaxDimension picks the largest axis", () => {
    const mesh = createCubeMesh(18, 18, 10);
    expect(boundingBoxMaxDimension(computeBoundingBox(mesh))).toBeCloseTo(18, 6);
  });
});

describe("mesh topology utilities", () => {
  it("vertexCount/triangleCount report the right counts for a cube", () => {
    const mesh = createCubeMesh(10, 10, 10);
    expect(vertexCount(mesh)).toBe(8);
    expect(triangleCount(mesh)).toBe(12);
  });

  it("weldVertices merges exact duplicates and preserves geometry", () => {
    // two disconnected triangles sharing 2 coincident corners, simulating
    // unindexed STL-style vertex duplication
    const positions = new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0, // triangle A
      1, 0, 0, 1, 1, 0, 0, 1, 0, // triangle B, shares 2 verts with A
    ]);
    const indices = new Uint32Array([0, 1, 2, 3, 4, 5]);
    const welded = weldVertices({ positions, indices }, 1e-5);
    expect(vertexCount(welded)).toBe(4); // (0,0,0) (1,0,0) (0,1,0) (1,1,0)
    expect(triangleCount(welded)).toBe(2);
  });

  it("weldVertices merges near-duplicates within epsilon but not beyond it", () => {
    const epsilon = 1e-5;
    const positions = new Float32Array([
      0, 0, 0,
      0 + epsilon * 0.1, 0, 0, // within epsilon of vertex 0
      0 + epsilon * 100, 0, 0, // well outside epsilon
    ]);
    const indices = new Uint32Array([0, 1, 2]);
    const welded = weldVertices({ positions, indices }, epsilon);
    expect(vertexCount(welded)).toBe(2);
  });
});
