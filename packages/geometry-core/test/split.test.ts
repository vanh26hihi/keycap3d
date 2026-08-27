import { describe, expect, it } from "vitest";
import { createCubeMesh } from "../src/primitives/cube.js";
import { computeBoundingBox, computeSignedVolume, type MeshBuffer } from "../src/mesh.js";
import { applyTransformToMesh, type Transform } from "../src/transform.js";
import { exportSTLBinary, importSTL } from "../src/stl.js";
import { validateMesh } from "../src/validate.js";
import { createBooleanEngine } from "../src/boolean.js";

/**
 * Proof-of-concept for the M3 Mesh Split direction: a model positioned in
 * design/world space is split by a plane into two parts. Both parts are left
 * expressed in that same world coordinate system (no recentering to a local
 * origin) -- this is what "designTransform" in the SceneNode data model is
 * for: split parts must be re-assemblable without needing any additional
 * per-part offset bookkeeping.
 */
function combinedBoundingBox(a: MeshBuffer, b: MeshBuffer) {
  const boxA = computeBoundingBox(a);
  const boxB = computeBoundingBox(b);
  return {
    min: [
      Math.min(boxA.min[0], boxB.min[0]),
      Math.min(boxA.min[1], boxB.min[1]),
      Math.min(boxA.min[2], boxB.min[2]),
    ] as [number, number, number],
    max: [
      Math.max(boxA.max[0], boxB.max[0]),
      Math.max(boxA.max[1], boxB.max[1]),
      Math.max(boxA.max[2], boxB.max[2]),
    ] as [number, number, number],
  };
}

describe("Boolean split proof-of-concept: Model -> Split -> Part A + Part B -> Export -> Import", () => {
  it("splits a world-positioned model into two manifold parts that keep the design coordinate system", async () => {
    const engine = await createBooleanEngine();

    // model lives at a non-trivial position in design/world space, the way it
    // would sit in a multi-object scene (not centered at the local origin)
    const localMesh = createCubeMesh(20, 20, 40);
    const design: Transform = { position: [10, 5, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] };
    const worldMesh = applyTransformToMesh(localMesh, design);
    const originalBox = computeBoundingBox(worldMesh);
    const originalVolume = computeSignedVolume(worldMesh);

    // split with a plane at world Z=0 (mesh spans Z -20..20 pre-split... actually
    // spans z: -20..20 around design.position.z=0), so this cuts it in half
    const [partA, partB] = engine.splitByPlane(worldMesh, [0, 0, 1], 0);

    // both halves must themselves be valid, closed solids (manifold-3d caps the cut face)
    const reportA = validateMesh(partA);
    const reportB = validateMesh(partB);
    expect(reportA.isWatertight).toBe(true);
    expect(reportB.isWatertight).toBe(true);
    expect(reportA.openEdgeCount).toBe(0);
    expect(reportB.openEdgeCount).toBe(0);
    expect(reportA.nonManifoldEdgeCount).toBe(0);
    expect(reportB.nonManifoldEdgeCount).toBe(0);

    // export each part independently -- no extra transform, they are already
    // expressed in world/design space
    const stlA = exportSTLBinary(partA, "part_a");
    const stlB = exportSTLBinary(partB, "part_b");

    // import both back, as if loading two separate STL files into the same scene
    const importedA = importSTL(stlA);
    const importedB = importSTL(stlB);

    expect(validateMesh(importedA).isWatertight).toBe(true);
    expect(validateMesh(importedB).isWatertight).toBe(true);

    // loaded together with no per-part offset, they must reconstruct the
    // original model's exact footprint -- this is the "khớp lại đúng vị trí
    // khi import cùng lúc" requirement.
    const recombinedBox = combinedBoundingBox(importedA, importedB);
    expect(recombinedBox.min).toEqual(originalBox.min);
    expect(recombinedBox.max).toEqual(originalBox.max);

    // and a real boolean union of the two re-imported parts must equal the
    // original solid's volume -- independent confirmation beyond bounding box
    const rejoined = engine.union(importedA, importedB);
    expect(computeSignedVolume(rejoined)).toBeCloseTo(originalVolume, 0);
    expect(validateMesh(rejoined).isWatertight).toBe(true);
  });

  it("an off-center cutting plane still yields two parts whose volumes sum to the original", async () => {
    const engine = await createBooleanEngine();
    const mesh = createCubeMesh(18, 18, 10);
    const originalVolume = computeSignedVolume(mesh);

    const [partA, partB] = engine.splitByPlane(mesh, [1, 0, 0], 3); // offset plane, not through center

    const volA = Math.abs(computeSignedVolume(partA));
    const volB = Math.abs(computeSignedVolume(partB));
    expect(volA + volB).toBeCloseTo(Math.abs(originalVolume), 0);
    expect(volA).toBeGreaterThan(0);
    expect(volB).toBeGreaterThan(0);
  });
});
