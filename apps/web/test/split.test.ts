import { beforeEach, describe, expect, it } from "vitest";
import {
  createCubeMesh,
  computeBoundingBox,
  computeSignedVolume,
  applyTransformToMesh,
  exportSTLBinary,
  importSTL,
  validateMesh,
  type Transform,
} from "@keycap-web/geometry-core";
import { createBooleanEngine } from "@keycap-web/geometry-core/boolean";
import { useEditorStore, toComparableProjectState } from "../src/state/store.js";
import { emptyProjectState } from "../src/state/types.js";

function resetStore() {
  useEditorStore.setState({
    project: emptyProjectState(),
    selectedId: null,
    transformMode: "translate",
    past: [],
    future: [],
    draggingNodeId: null,
    splitPlaneDragging: false,
    isolatedNodeId: null,
    splitSession: null,
    splitStatus: "idle",
    splitError: null,
  });
}

beforeEach(() => {
  resetStore();
});

/**
 * These tests exercise the real store `applySplit` action end to end
 * (beginSplit -> set plane -> applySplit -> inspect resulting nodes),
 * NOT a reimplementation of the split logic. `splitByPlane` in
 * src/lib/splitEngine.ts falls back to computing directly on this thread
 * when `Worker` is undefined (true in Vitest's node environment), using the
 * exact same geometry-core Boolean Engine the real browser Worker uses --
 * so this is testing the actual production code path for everything except
 * which thread it runs on.
 */
describe("M3 Plane Split: cube 18x18x10, cut down the middle on X", () => {
  it("produces two parts each ~9x18x10mm, together spanning the original bbox", async () => {
    const store = useEditorStore.getState();
    const id = store.addMeshNode(createCubeMesh(18, 18, 10), "Cube");

    store.beginSplit(id);
    // default plane from beginSplit is already centered on the object with
    // identity rotation (normal = +Z) -- rotate it 90deg about Y so the
    // normal becomes +X, cutting down the middle on X as required.
    useEditorStore.getState().updateSplitPlaneDirect({ rotationDeg: [0, 90, 0] });

    await useEditorStore.getState().applySplit();

    const state = useEditorStore.getState();
    expect(state.splitStatus).toBe("success");
    expect(state.splitSession).toBeNull();
    expect(state.project.order.length).toBe(2);
    expect(state.project.nodes[id]).toBeUndefined();

    const [idA, idB] = state.project.order;
    const partA = state.project.nodes[idA];
    const partB = state.project.nodes[idB];
    expect(partA.origin).toEqual({ kind: "split", splitFrom: id, splitSibling: idB });
    expect(partB.origin).toEqual({ kind: "split", splitFrom: id, splitSibling: idA });

    const boxA = computeBoundingBox(partA.mesh);
    const boxB = computeBoundingBox(partB.mesh);

    // each part ~half of 18mm on X, full 18mm on Y, full 10mm on Z
    expect(boxA.size[0]).toBeCloseTo(9, 0);
    expect(boxA.size[1]).toBeCloseTo(18, 1);
    expect(boxA.size[2]).toBeCloseTo(10, 1);
    expect(boxB.size[0]).toBeCloseTo(9, 0);
    expect(boxB.size[1]).toBeCloseTo(18, 1);
    expect(boxB.size[2]).toBeCloseTo(10, 1);

    // parts keep the original design coordinate system -- designTransform
    // is identity because the mesh itself is already baked into world/design
    // space, and combining the two raw meshes reconstructs the original
    // footprint with NO extra per-part offset.
    expect(partA.designTransform.position).toEqual([0, 0, 0]);
    const combinedMin = [
      Math.min(boxA.min[0], boxB.min[0]),
      Math.min(boxA.min[1], boxB.min[1]),
      Math.min(boxA.min[2], boxB.min[2]),
    ];
    const combinedMax = [
      Math.max(boxA.max[0], boxB.max[0]),
      Math.max(boxA.max[1], boxB.max[1]),
      Math.max(boxA.max[2], boxB.max[2]),
    ];
    expect(combinedMin[0]).toBeCloseTo(-9, 1);
    expect(combinedMax[0]).toBeCloseTo(9, 1);
    expect(combinedMin[1]).toBeCloseTo(-9, 1);
    expect(combinedMax[1]).toBeCloseTo(9, 1);
    expect(combinedMin[2]).toBeCloseTo(-5, 1);
    expect(combinedMax[2]).toBeCloseTo(5, 1);
  });

  it("Export A, Export B, re-import, union -- matches the original volume and footprint", async () => {
    const store = useEditorStore.getState();
    const original = createCubeMesh(18, 18, 10);
    const originalBox = computeBoundingBox(original);
    const originalVolume = Math.abs(computeSignedVolume(original));

    const id = store.addMeshNode(original, "Cube");
    store.beginSplit(id);
    useEditorStore.getState().updateSplitPlaneDirect({ rotationDeg: [0, 90, 0] });
    await useEditorStore.getState().applySplit();

    const state = useEditorStore.getState();
    const [idA, idB] = state.project.order;
    const partA = state.project.nodes[idA];
    const partB = state.project.nodes[idB];

    // STL export/import round-trip per part (mirrors the real Export STL
    // button: bake design+print transform, write binary STL)
    const stlA = exportSTLBinary(applyTransformToMesh(partA.mesh, partA.designTransform), "part_a");
    const stlB = exportSTLBinary(applyTransformToMesh(partB.mesh, partB.designTransform), "part_b");
    const importedA = importSTL(stlA);
    const importedB = importSTL(stlB);

    expect(validateMesh(importedA).isWatertight).toBe(true);
    expect(validateMesh(importedB).isWatertight).toBe(true);

    // loaded together with no extra per-part offset, they must reconstruct
    // the original model's exact footprint
    const boxA = computeBoundingBox(importedA);
    const boxB = computeBoundingBox(importedB);
    const combinedMin = [0, 1, 2].map((i) => Math.min(boxA.min[i], boxB.min[i]));
    const combinedMax = [0, 1, 2].map((i) => Math.max(boxA.max[i], boxB.max[i]));
    for (let i = 0; i < 3; i++) {
      expect(combinedMin[i]).toBeCloseTo(originalBox.min[i], 1);
      expect(combinedMax[i]).toBeCloseTo(originalBox.max[i], 1);
    }

    const engine = await createBooleanEngine();
    const rejoined = engine.union(importedA, importedB);
    expect(Math.abs(computeSignedVolume(rejoined))).toBeCloseTo(originalVolume, 0);
  });
});

describe("M3 Plane Split: edge cases", () => {
  it("plane that does not intersect the model fails with a clear error and leaves the original untouched", async () => {
    const store = useEditorStore.getState();
    const id = store.addMeshNode(createCubeMesh(18, 18, 10), "Cube");
    store.beginSplit(id);
    // plane far outside the 18x18x10 cube (which spans -9..9 on X)
    useEditorStore.getState().updateSplitPlaneDirect({ position: [500, 0, 0], rotationDeg: [0, 90, 0] });

    await useEditorStore.getState().applySplit();

    const state = useEditorStore.getState();
    expect(state.splitStatus).toBe("error");
    expect(state.splitError).toBeTruthy();
    // original untouched: still exists, no new part nodes, no command pushed
    expect(state.project.nodes[id]).toBeDefined();
    expect(state.project.order).toEqual([id]);
    expect(state.past.length).toBe(1); // only the initial "Add" command
  });

  it("plane exactly at the model's boundary never corrupts state, regardless of which way it resolves", async () => {
    // Investigated directly: at exactly X=9 (the cube's own face), the
    // Euler->normal conversion's floating-point noise (three.js's
    // `applyEuler` returns ~2.22e-16 in the axis that should be exactly 0)
    // means whether manifold-3d treats this as "empty side" or "a
    // vanishingly thin but real sliver" is not deterministic at this
    // precision -- verified by direct experiment, not assumed. A human
    // dragging a gizmo will never land exactly on a boundary to 1e-16mm
    // precision, so what actually matters for real use is the invariant:
    // this must never crash, silently corrupt data, or lose volume -- not
    // which of the two legitimate outcomes it picks.
    const store = useEditorStore.getState();
    const originalVolume = Math.abs(computeSignedVolume(createCubeMesh(18, 18, 10)));
    const id = store.addMeshNode(createCubeMesh(18, 18, 10), "Cube");
    store.beginSplit(id);
    // cube spans X in [-9, 9]; plane exactly at the boundary
    useEditorStore.getState().updateSplitPlaneDirect({ position: [9, 0, 0], rotationDeg: [0, 90, 0] });

    await expect(useEditorStore.getState().applySplit()).resolves.not.toThrow();

    const state = useEditorStore.getState();
    if (state.splitStatus === "error") {
      // acceptable outcome: refused cleanly, original untouched
      expect(state.project.nodes[id]).toBeDefined();
      expect(state.project.order).toEqual([id]);
    } else {
      // also acceptable: a valid (if degenerate) split -- but it MUST be
      // a real, volume-conserving, watertight result, not silent corruption
      expect(state.splitStatus).toBe("success");
      const [idA, idB] = state.project.order;
      const volA = Math.abs(computeSignedVolume(state.project.nodes[idA].mesh));
      const volB = Math.abs(computeSignedVolume(state.project.nodes[idB].mesh));
      expect(volA + volB).toBeCloseTo(originalVolume, 0);
      expect(validateMesh(state.project.nodes[idA].mesh).isWatertight).toBe(true);
      expect(validateMesh(state.project.nodes[idB].mesh).isWatertight).toBe(true);
    }
  });

  it("rotated (non-axis-aligned) plane still conserves volume", async () => {
    const store = useEditorStore.getState();
    const original = createCubeMesh(18, 18, 10);
    const originalVolume = Math.abs(computeSignedVolume(original));
    const id = store.addMeshNode(original, "Cube");

    store.beginSplit(id);
    useEditorStore.getState().updateSplitPlaneDirect({ rotationDeg: [0, 45, 0] });
    await useEditorStore.getState().applySplit();

    const state = useEditorStore.getState();
    expect(state.splitStatus).toBe("success");
    const [idA, idB] = state.project.order;
    const volA = Math.abs(computeSignedVolume(state.project.nodes[idA].mesh));
    const volB = Math.abs(computeSignedVolume(state.project.nodes[idB].mesh));
    expect(volA + volB).toBeCloseTo(originalVolume, 0);
  });

  it("a node with a pre-existing non-identity designTransform still splits into parts covering the same world footprint", async () => {
    const store = useEditorStore.getState();
    const design: Transform = { position: [37.5, -12, 8], rotationDeg: [0, 0, 30], scale: [1, 1, 1] };
    const localMesh = createCubeMesh(18, 18, 10);
    const originalWorldBox = computeBoundingBox(applyTransformToMesh(localMesh, design));

    const id = store.addMeshNode(localMesh, "Cube", design);
    store.beginSplit(id);
    // beginSplit already centers the plane on the object's WORLD bbox center
    // (not local origin) -- confirm that, then cut along the object's world
    // "vertical" (rotate the plane 90deg about Y so normal points along the
    // node's world X-ish direction; exact axis doesn't matter for this check).
    const session = useEditorStore.getState().splitSession!;
    expect(session.plane.position[0]).toBeCloseTo(37.5, 4);
    expect(session.plane.position[1]).toBeCloseTo(-12, 4);
    expect(session.plane.position[2]).toBeCloseTo(8, 4);
    useEditorStore.getState().updateSplitPlaneDirect({ rotationDeg: [0, 90, 0] });

    await useEditorStore.getState().applySplit();

    const state = useEditorStore.getState();
    expect(state.splitStatus).toBe("success");
    const [idA, idB] = state.project.order;
    const boxA = computeBoundingBox(state.project.nodes[idA].mesh);
    const boxB = computeBoundingBox(state.project.nodes[idB].mesh);
    const combinedMin = [0, 1, 2].map((i) => Math.min(boxA.min[i], boxB.min[i]));
    const combinedMax = [0, 1, 2].map((i) => Math.max(boxA.max[i], boxB.max[i]));
    for (let i = 0; i < 3; i++) {
      expect(combinedMin[i]).toBeCloseTo(originalWorldBox.min[i], 0);
      expect(combinedMax[i]).toBeCloseTo(originalWorldBox.max[i], 0);
    }
  });
});

describe("M3 Plane Split: undo/redo and repeated splits", () => {
  it("Split -> Undo restores the original node; Redo re-applies the exact same parts", async () => {
    const store = useEditorStore.getState();
    const id = store.addMeshNode(createCubeMesh(18, 18, 10), "Cube");
    const beforeSplit = toComparableProjectState(useEditorStore.getState().project);

    store.beginSplit(id);
    useEditorStore.getState().updateSplitPlaneDirect({ rotationDeg: [0, 90, 0] });
    await useEditorStore.getState().applySplit();

    expect(useEditorStore.getState().past.length).toBe(2); // Add + Split, exactly one undo step for the split
    const afterSplit = toComparableProjectState(useEditorStore.getState().project);
    expect(afterSplit).not.toEqual(beforeSplit);

    useEditorStore.getState().undo();
    expect(toComparableProjectState(useEditorStore.getState().project)).toEqual(beforeSplit);
    expect(useEditorStore.getState().project.nodes[id]).toBeDefined();

    useEditorStore.getState().redo();
    expect(toComparableProjectState(useEditorStore.getState().project)).toEqual(afterSplit);
  });

  it("splitting a part again (split -> split A into A1/A2) works and both splits undo independently", async () => {
    const store = useEditorStore.getState();
    const id = store.addMeshNode(createCubeMesh(18, 18, 10), "Cube");

    store.beginSplit(id);
    useEditorStore.getState().updateSplitPlaneDirect({ rotationDeg: [0, 90, 0] }); // cut on X
    await useEditorStore.getState().applySplit();

    let state = useEditorStore.getState();
    expect(state.project.order.length).toBe(2);
    const [idA] = state.project.order;

    // split part A again, this time on Y
    useEditorStore.getState().beginSplit(idA);
    useEditorStore.getState().updateSplitPlaneDirect({ rotationDeg: [90, 0, 0] }); // normal -> +Y-ish
    await useEditorStore.getState().applySplit();

    state = useEditorStore.getState();
    expect(state.splitStatus).toBe("success");
    expect(state.project.order.length).toBe(3); // partB (untouched) + A1 + A2
    expect(state.past.length).toBe(3); // Add, Split 1, Split 2

    // undo the second split -> back to 2 parts (original A restored)
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().project.order.length).toBe(2);
    expect(useEditorStore.getState().project.nodes[idA]).toBeDefined();

    // undo the first split -> back to the single original cube
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().project.order).toEqual([id]);
  });
});
