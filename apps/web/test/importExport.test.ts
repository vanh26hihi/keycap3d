import { describe, expect, it } from "vitest";
import { createCubeMesh, IDENTITY_TRANSFORM, parseSTL, triangleCount, type Transform } from "@keycap-web/geometry-core";
import { exportAllToSTLBlob } from "../src/lib/importExport.js";
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

    const blob = exportAllToSTLBlob(project);
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

    const blob = exportAllToSTLBlob(project);
    const merged = parseSTL(await blob.arrayBuffer());
    expect(triangleCount(merged)).toBe(triangleCount(cubeA));
  });

  it("an empty project exports a valid (empty) STL without throwing", async () => {
    const blob = exportAllToSTLBlob(emptyProjectState());
    const merged = parseSTL(await blob.arrayBuffer());
    expect(triangleCount(merged)).toBe(0);
  });
});
