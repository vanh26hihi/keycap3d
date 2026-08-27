import { beforeEach, describe, expect, it } from "vitest";
import { computeBoundingBox } from "@keycap-web/geometry-core";
import { useEditorStore, toComparableProjectState } from "../src/state/store.js";
import { emptyProjectState } from "../src/state/types.js";
import { saveDefaultParams, clearSavedDefaultParams } from "../src/lib/keycapDefaults.js";
import { DEFAULT_KEYCAP_PARAMS } from "@keycap-web/geometry-core/keycap";

/** Same minimal in-memory localStorage stand-in as keycapDefaults.test.ts
 *  -- Node's test environment has no real one. */
function installFakeLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

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
    keycapStatus: "idle",
    keycapError: null,
  });
}

beforeEach(() => {
  resetStore();
  installFakeLocalStorage();
  clearSavedDefaultParams();
});

describe("M4 addKeycapNode", () => {
  it("creates a keycap node with the default dimensions, selected, tagged parametric", async () => {
    const id = await useEditorStore.getState().addKeycapNode();
    const state = useEditorStore.getState();
    expect(state.selectedId).toBe(id);
    expect(state.keycapStatus).toBe("idle");
    const node = state.project.nodes[id];
    expect(node.parametric?.generatorId).toBe("keycapV1");
    const box = computeBoundingBox(node.mesh);
    expect(box.size[0]).toBeCloseTo(18.5, 2);
    expect(box.size[1]).toBeCloseTo(18.5, 2);
    expect(box.size[2]).toBeCloseTo(10, 2);
  });

  it("accepts a params override", async () => {
    const id = await useEditorStore.getState().addKeycapNode({ widthMm: 22, lengthMm: 20, heightMm: 12 });
    const node = useEditorStore.getState().project.nodes[id];
    const box = computeBoundingBox(node.mesh);
    expect(box.size[0]).toBeCloseTo(22, 2);
    expect(box.size[1]).toBeCloseTo(20, 2);
    expect(box.size[2]).toBeCloseTo(12, 2);
  });

  it("accepts a position override -- used by the Legend field's batch-create-per-word flow to lay siblings out side by side", async () => {
    const id = await useEditorStore.getState().addKeycapNode({}, [20.5, 0, 0]);
    const node = useEditorStore.getState().project.nodes[id];
    expect(node.designTransform.position).toEqual([20.5, 0, 0]);
  });

  it("defaults to the identity position when no override is given (no regression for the plain call path)", async () => {
    const id = await useEditorStore.getState().addKeycapNode();
    const node = useEditorStore.getState().project.nodes[id];
    expect(node.designTransform.position).toEqual([0, 0, 0]);
  });

  it("with no paramsOverride, uses the user's saved default params instead of the hardcoded ones", async () => {
    saveDefaultParams({ ...DEFAULT_KEYCAP_PARAMS, socketDepthMm: 8.25, ribHeightMm: 6 });
    const id = await useEditorStore.getState().addKeycapNode();
    const node = useEditorStore.getState().project.nodes[id];
    expect(node.parametric?.params.socketDepthMm).toBeCloseTo(8.25, 6);
    expect(node.parametric?.params.ribHeightMm).toBeCloseTo(6, 6);
  });

  it("an explicit paramsOverride takes precedence over the saved default (e.g. batch-create cloning a specific keycap's params)", async () => {
    saveDefaultParams({ ...DEFAULT_KEYCAP_PARAMS, socketDepthMm: 8.25 });
    const id = await useEditorStore.getState().addKeycapNode({ socketDepthMm: 5 });
    const node = useEditorStore.getState().project.nodes[id];
    expect(node.parametric?.params.socketDepthMm).toBeCloseTo(5, 6);
  });

  it("falls back to the hardcoded default when nothing has been saved", async () => {
    const id = await useEditorStore.getState().addKeycapNode();
    const node = useEditorStore.getState().project.nodes[id];
    expect(node.parametric?.params.socketDepthMm).toBeCloseTo(DEFAULT_KEYCAP_PARAMS.socketDepthMm, 6);
  });

  it("Add Keycap is one undo step", async () => {
    const before = useEditorStore.getState().past.length;
    await useEditorStore.getState().addKeycapNode();
    expect(useEditorStore.getState().past.length).toBe(before + 1);
  });
});

describe("M4 updateKeycapParams", () => {
  it("regenerates the mesh and updates stored params; exactly one undo step", async () => {
    const id = await useEditorStore.getState().addKeycapNode();
    const beforeEdit = useEditorStore.getState().past.length;

    await useEditorStore.getState().updateKeycapParams(id, { widthMm: 20 });

    const state = useEditorStore.getState();
    expect(state.past.length).toBe(beforeEdit + 1);
    expect(state.keycapStatus).toBe("idle");
    const node = state.project.nodes[id];
    expect(node.parametric?.params.widthMm).toBe(20);
    const box = computeBoundingBox(node.mesh);
    expect(box.size[0]).toBeCloseTo(20, 2);
  });

  it("undo restores both the previous params AND the previous mesh (not just params)", async () => {
    const id = await useEditorStore.getState().addKeycapNode();
    const beforeEdit = toComparableProjectState(useEditorStore.getState().project);

    await useEditorStore.getState().updateKeycapParams(id, { widthMm: 25 });
    const afterEdit = toComparableProjectState(useEditorStore.getState().project);
    expect(afterEdit).not.toEqual(beforeEdit);

    useEditorStore.getState().undo();
    expect(toComparableProjectState(useEditorStore.getState().project)).toEqual(beforeEdit);

    useEditorStore.getState().redo();
    expect(toComparableProjectState(useEditorStore.getState().project)).toEqual(afterEdit);
  });

  it("a no-op edit (same params) does not push a history entry", async () => {
    const id = await useEditorStore.getState().addKeycapNode({ widthMm: 18 });
    const before = useEditorStore.getState().past.length;
    await useEditorStore.getState().updateKeycapParams(id, { widthMm: 18 });
    expect(useEditorStore.getState().past.length).toBe(before);
  });

  it("editing a non-keycap node's params is a no-op (no crash, no history entry)", async () => {
    const { createCubeMesh } = await import("@keycap-web/geometry-core");
    const id = useEditorStore.getState().addMeshNode(createCubeMesh(18, 18, 10), "Cube");
    const before = useEditorStore.getState().past.length;
    await useEditorStore.getState().updateKeycapParams(id, { widthMm: 30 });
    expect(useEditorStore.getState().past.length).toBe(before);
  });

  it("changing wallThickness only affects the hollow cavity, not the outer bounding box", async () => {
    const id = await useEditorStore.getState().addKeycapNode();
    const before = computeBoundingBox(useEditorStore.getState().project.nodes[id].mesh);
    await useEditorStore.getState().updateKeycapParams(id, { wallThicknessMm: 3 });
    const after = computeBoundingBox(useEditorStore.getState().project.nodes[id].mesh);
    expect(after.size[0]).toBeCloseTo(before.size[0], 2);
    expect(after.size[1]).toBeCloseTo(before.size[1], 2);
    expect(after.size[2]).toBeCloseTo(before.size[2], 2);
  });
});
