import { describe, expect, it } from "vitest";
import {
  createCubeMesh,
  computeSignedVolume,
  IDENTITY_TRANSFORM,
  parseSTL,
  triangleCount,
  type Transform,
} from "@keycap-web/geometry-core";
import { createKeycapMesh, createKeycapMeshParts, resolveKeycapParams, type KeycapParams } from "@keycap-web/geometry-core/keycap";
import {
  exportAllMultiPart3MFBlob,
  exportAllToSTLBlob,
  exportKeycapsOnlyToSTLBlob,
  exportStemsOnlyToSTLBlob,
} from "../src/lib/importExport.js";
import { emptyProjectState } from "../src/state/types.js";
import type { SceneNodeState } from "../src/state/types.js";

function makeNode(id: string, mesh: ReturnType<typeof createCubeMesh>, position: [number, number, number], visible = true): SceneNodeState {
  const transform: Transform = { ...IDENTITY_TRANSFORM, position };
  return {
    id,
    name: id,
    visible,
    locked: false,
    color: "#8fa6c4",
    designTransform: transform,
    printTransform: null,
    mesh,
    origin: { kind: "primitive" },
    assemblyId: null,
    role: null,
    parametric: null,
  };
}

async function makeKeycapNode(id: string, paramsInput: Partial<KeycapParams>, position: [number, number, number]): Promise<SceneNodeState> {
  const params = resolveKeycapParams(paramsInput);
  const mesh = await createKeycapMesh(params);
  return {
    id,
    name: id,
    visible: true,
    locked: false,
    color: "#8fa6c4",
    designTransform: { ...IDENTITY_TRANSFORM, position },
    printTransform: null,
    mesh,
    origin: { kind: "primitive" },
    assemblyId: null,
    role: null,
    parametric: { generatorId: "keycapV1", params, parts: { base: mesh, bubble: null, legend: null, stem: null } },
  };
}

describe("exportAllToSTLBlob", () => {
  it("merges every visible node's triangles into one STL, with each node's own position baked in", async () => {
    const cubeA = createCubeMesh(10, 10, 10);
    const cubeB = createCubeMesh(10, 10, 10);
    const project = {
      ...emptyProjectState(),
      order: ["a", "b"],
      nodes: {
        a: makeNode("a", cubeA, [0, 0, 0]),
        b: makeNode("b", cubeB, [50, 0, 0]),
      },
    };

    const blob = await exportAllToSTLBlob(project);
    const buffer = await blob.arrayBuffer();
    const merged = parseSTL(buffer);

    expect(triangleCount(merged)).toBe(triangleCount(cubeA) + triangleCount(cubeB));

    // b's triangles should be shifted +50 in X relative to a's -- spot check
    // the merged mesh's overall X extent reflects both positions, not just one.
    let minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < merged.positions.length; i += 3) {
      minX = Math.min(minX, merged.positions[i]);
      maxX = Math.max(maxX, merged.positions[i]);
    }
    expect(minX).toBeCloseTo(-5, 4); // cube A's left edge
    expect(maxX).toBeCloseTo(55, 4); // cube B's right edge (50 + 10/2)
  });

  it("excludes hidden nodes", async () => {
    const cubeA = createCubeMesh(10, 10, 10);
    const cubeB = createCubeMesh(10, 10, 10);
    const project = {
      ...emptyProjectState(),
      order: ["a", "b"],
      nodes: {
        a: makeNode("a", cubeA, [0, 0, 0], true),
        b: makeNode("b", cubeB, [50, 0, 0], false), // hidden
      },
    };

    const blob = await exportAllToSTLBlob(project);
    const merged = parseSTL(await blob.arrayBuffer());
    expect(triangleCount(merged)).toBe(triangleCount(cubeA));
  });

  it("an empty project exports a valid (empty) STL without throwing", async () => {
    const blob = await exportAllToSTLBlob(emptyProjectState());
    const merged = parseSTL(await blob.arrayBuffer());
    expect(triangleCount(merged)).toBe(0);
  });
});

// A realistic dense keycap grid: 19mm pitch (matching a real keyboard's own
// spacing), which is what a batch-created row of keycaps actually uses --
// the two shells themselves are already non-overlapping (just barely: 0.5mm
// clear between their 18.5mm-wide edges), but this pitch is FAR closer than
// stemPlacementOffsetMm's own fixed per-keycap offset would clear, which is
// exactly the bug report this describe block guards against.
const DENSE_PITCH_MM = 19;

describe("exportAllToSTLBlob / exportKeycapsOnlyToSTLBlob / exportStemsOnlyToSTLBlob: stemSeparate overlap fix", () => {
  it("a dense row of stemSeparate keycaps exports with no stem overlapping any keycap's own footprint", async () => {
    const paramsA = { switchType: "round" as const, stemSeparate: true };
    const nodeA = await makeKeycapNode("a", paramsA, [0, 0, 0]);
    const nodeB = await makeKeycapNode("b", paramsA, [DENSE_PITCH_MM, 0, 0]);
    const project = { ...emptyProjectState(), order: ["a", "b"], nodes: { a: nodeA, b: nodeB } };

    const blob = await exportAllToSTLBlob(project);
    const merged = parseSTL(await blob.arrayBuffer());
    const resolved = resolveKeycapParams(paramsA);

    // Count vertices strictly inside keycap B's own rectangular XY
    // footprint (a plain bounding check, not a boolean op -- the merged
    // export is several disjoint shells concatenated, not one manifold
    // solid, which manifold-3d's own boolean ops reject as input). Under
    // the old bug, keycap A's stem (baked at a fixed local offset) would
    // land inside this footprint too, on top of keycap B's own shell,
    // adding EXTRA vertices beyond what a standalone shell alone has.
    const halfW = resolved.widthMm / 2 - 0.01;
    const halfL = resolved.lengthMm / 2 - 0.01;
    let countInB = 0;
    for (let i = 0; i < merged.positions.length; i += 3) {
      const x = merged.positions[i] - DENSE_PITCH_MM;
      const y = merged.positions[i + 1];
      if (Math.abs(x) < halfW && Math.abs(y) < halfL) countInB++;
    }

    const shellOnly = await createKeycapMesh({ ...paramsA, switchType: "none" });
    // STL has no shared-vertex indexing -- every triangle gets its own 3
    // corner vertices duplicated in the file, so parseSTL's vertex count is
    // always indices.length, never positions.length/3 (that's the ORIGINAL
    // mesh's welded vertex count, a different, smaller unit). Compare like
    // for like against the exploded count, or every check below false-fails
    // by roughly the mesh's own vert-sharing ratio.
    const shellOnlyVertexCount = shellOnly.indices.length;
    // Some slack for corner/edge vertices sitting right at the boundary
    // (counted or not depending on floating-point rounding), but nowhere
    // near double, which is what a fully-overlapping foreign stem would add.
    expect(countInB).toBeGreaterThan(shellOnlyVertexCount * 0.9);
    expect(countInB).toBeLessThan(shellOnlyVertexCount * 1.3);
  });

  it("exportKeycapsOnlyToSTLBlob drops every stem, keeping only the shells (at their own, already non-overlapping positions)", async () => {
    const paramsA = { switchType: "round" as const, stemSeparate: true };
    const nodeA = await makeKeycapNode("a", paramsA, [0, 0, 0]);
    const nodeB = await makeKeycapNode("b", paramsA, [DENSE_PITCH_MM, 0, 0]);
    const project = { ...emptyProjectState(), order: ["a", "b"], nodes: { a: nodeA, b: nodeB } };

    const blob = await exportKeycapsOnlyToSTLBlob(project);
    const merged = parseSTL(await blob.arrayBuffer());
    const shellOnly = await createKeycapMesh({ ...paramsA, switchType: "none" });
    expect(computeSignedVolume(merged)).toBeCloseTo(2 * computeSignedVolume(shellOnly), 1);
  });

  it("exportStemsOnlyToSTLBlob keeps only the stems, laid out without overlapping each other", async () => {
    const paramsA = { switchType: "round" as const, stemSeparate: true };
    // Three keycaps at the SAME position (0,0,0) -- an extreme case where,
    // without any re-layout at all, every stem would land at IDENTICAL
    // coordinates (all baked at the same fixed offset from the same local
    // origin). If layoutStemsFreely works, the export still produces 3
    // non-overlapping stems despite this adversarial input.
    const nodeA = await makeKeycapNode("a", paramsA, [0, 0, 0]);
    const nodeB = await makeKeycapNode("b", paramsA, [0, 0, 0]);
    const nodeC = await makeKeycapNode("c", paramsA, [0, 0, 0]);
    const project = { ...emptyProjectState(), order: ["a", "b", "c"], nodes: { a: nodeA, b: nodeB, c: nodeC } };

    const blob = await exportStemsOnlyToSTLBlob(project);
    const merged = parseSTL(await blob.arrayBuffer());

    // Count vertices inside the very first grid cell's own footprint (the
    // spiral search in findFreePosition always tries the origin first).
    // Under the old (pre-relayout) behavior all 3 identical stems would
    // land EXACTLY on top of each other there; with the fix, only ONE
    // stem's worth of vertices should be found at that cell -- the other
    // two get placed at DIFFERENT grid cells instead.
    const resolved = resolveKeycapParams(paramsA);
    const halfW = resolved.stemPlateWidthMm / 2 - 0.01;
    const halfL = resolved.stemPlateLengthMm / 2 - 0.01;
    let countAtOrigin = 0;
    for (let i = 0; i < merged.positions.length; i += 3) {
      if (Math.abs(merged.positions[i]) < halfW && Math.abs(merged.positions[i + 1]) < halfL) countAtOrigin++;
    }

    // Same exploded-vs-welded unit mismatch as the shell check above --
    // compare against indices.length, not positions.length/3.
    const singleStemVertexCount = (await createKeycapMeshParts(paramsA)).stem!.indices.length;
    expect(countAtOrigin).toBeGreaterThan(singleStemVertexCount * 0.9);
    // The key assertion: nowhere near double/triple, which stacked
    // overlapping stems would produce.
    expect(countAtOrigin).toBeLessThan(singleStemVertexCount * 1.5);

    // ...and the export as a whole really does contain all 3 stems' worth
    // of material overall (nothing silently dropped), just spread across
    // more than one grid cell instead of all piled at the origin.
    const totalVertexCount = merged.positions.length / 3;
    expect(totalVertexCount).toBeGreaterThan(singleStemVertexCount * 2.5);
  });
});

describe("exportAllMultiPart3MFBlob", () => {
  it("produces one object per part per keycap, plus a freshly-laid-out stem, without throwing", async () => {
    const paramsA = { switchType: "round" as const, stemSeparate: true, legendText: "A", legendMode: "emboss" as const };
    const nodeA = await makeKeycapNode("a", paramsA, [0, 0, 0]);
    const project = { ...emptyProjectState(), order: ["a"], nodes: { a: nodeA } };

    const blob = await exportAllMultiPart3MFBlob(project);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe("model/3mf");
  });

  it("throws for a project with no visible objects", async () => {
    await expect(exportAllMultiPart3MFBlob(emptyProjectState())).rejects.toThrow();
  });
});
