import { beforeEach, describe, expect, it } from "vitest";
import { createCubeMesh } from "@keycap-web/geometry-core";
import { useEditorStore, toComparableProjectState } from "../src/state/store.js";
import { emptyProjectState } from "../src/state/types.js";

function resetStore() {
  useEditorStore.setState({
    project: emptyProjectState(),
    selectedId: null,
    selectedIds: [],
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

describe("undo/redo: 20 random transform operations then 20 undos returns to the original state", () => {
  it("round-trips exactly (deep JSON compare)", () => {
    const store = useEditorStore.getState();
    const id = store.addMeshNode(createCubeMesh(18, 18, 10), "TestCube");

    // snapshot AFTER the initial add (that's the "original state" this test is
    // about to perturb with 20 further operations, matching the acceptance
    // criteria's "20 thao tác transform ngẫu nhiên rồi Undo x20")
    const baseline = toComparableProjectState(useEditorStore.getState().project);

    let seed = 42;
    const rand = () => {
      // deterministic PRNG so a failing run is reproducible
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    for (let i = 0; i < 20; i++) {
      const prev = useEditorStore.getState().project.nodes[id].designTransform;
      const next = {
        position: [rand() * 100 - 50, rand() * 100 - 50, rand() * 100 - 50] as [number, number, number],
        rotationDeg: [rand() * 360, rand() * 360, rand() * 360] as [number, number, number],
        scale: [1 + rand(), 1 + rand(), 1 + rand()] as [number, number, number],
      };
      useEditorStore.getState().updateNodeTransformDirect(id, next);
      useEditorStore.getState().commitTransform(id, prev);
    }

    expect(useEditorStore.getState().past.length).toBe(1 + 20); // add + 20 transforms
    // sanity: state actually changed from baseline after 20 mutations
    expect(toComparableProjectState(useEditorStore.getState().project)).not.toEqual(baseline);

    for (let i = 0; i < 20; i++) {
      useEditorStore.getState().undo();
    }

    expect(toComparableProjectState(useEditorStore.getState().project)).toEqual(baseline);
    expect(useEditorStore.getState().past.length).toBe(1);
    expect(useEditorStore.getState().future.length).toBe(20);
  });

  it("redo replays undone operations back to the pre-undo state", () => {
    const store = useEditorStore.getState();
    const id = store.addMeshNode(createCubeMesh(10, 10, 10), "Cube");
    useEditorStore.getState().updateNodeTransformDirect(id, {
      position: [5, 5, 5],
      rotationDeg: [0, 45, 0],
      scale: [1, 1, 1],
    });
    useEditorStore
      .getState()
      .commitTransform(id, { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] });

    const afterMove = toComparableProjectState(useEditorStore.getState().project);
    useEditorStore.getState().undo();
    expect(toComparableProjectState(useEditorStore.getState().project)).not.toEqual(afterMove);
    useEditorStore.getState().redo();
    expect(toComparableProjectState(useEditorStore.getState().project)).toEqual(afterMove);
  });

  it("simulates a full gizmo drag: mouseDown, many per-frame updates, mouseUp -- exactly one undo step, correct before/after", () => {
    const store = useEditorStore.getState();
    const id = store.addMeshNode(createCubeMesh(18, 18, 10), "Cube");
    const before = useEditorStore.getState().project.nodes[id].designTransform;
    const historyBeforeDrag = useEditorStore.getState().past.length;

    // onMouseDown: capture before, mark node as dragging (non-undoable UI state)
    useEditorStore.getState().setDraggingNode(id);
    expect(useEditorStore.getState().draggingNodeId).toBe(id);

    // onObjectChange fires on every pointermove frame during a real drag --
    // simulate several, each writing progressively further along X only
    // (mirroring "kéo riêng trục X chỉ X thay đổi": only position[0] changes
    // frame to frame, Y/Z/rotation/scale stay put, exactly what a real X-axis
    // drag would produce).
    for (const x of [1, 4, 9, 15, 22]) {
      useEditorStore.getState().updateNodeTransformDirect(id, {
        position: [x, 0, 0],
        rotationDeg: [0, 0, 0],
        scale: [1, 1, 1],
      });
      // per-frame updates must never touch the undo stack
      expect(useEditorStore.getState().past.length).toBe(historyBeforeDrag);
    }

    // onMouseUp: commit once, clear dragging flag
    useEditorStore.getState().commitTransform(id, before);
    useEditorStore.getState().setDraggingNode(null);

    expect(useEditorStore.getState().draggingNodeId).toBeNull();
    expect(useEditorStore.getState().past.length).toBe(historyBeforeDrag + 1);

    const after = useEditorStore.getState().project.nodes[id].designTransform;
    expect(after.position).toEqual([22, 0, 0]);
    expect(after.rotationDeg).toEqual([0, 0, 0]);
    expect(after.scale).toEqual([1, 1, 1]);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().project.nodes[id].designTransform).toEqual(before);

    useEditorStore.getState().redo();
    expect(useEditorStore.getState().project.nodes[id].designTransform.position).toEqual([22, 0, 0]);
  });

  it("dragging one axis leaves the other two axes numerically untouched", () => {
    const store = useEditorStore.getState();
    const id = store.addMeshNode(createCubeMesh(10, 10, 10), "Cube", {
      position: [5, 7, 9],
      rotationDeg: [0, 0, 0],
      scale: [1, 1, 1],
    });
    const before = useEditorStore.getState().project.nodes[id].designTransform;

    // simulate dragging only Y: X and Z must be carried through unchanged
    useEditorStore.getState().updateNodeTransformDirect(id, {
      position: [before.position[0], 40, before.position[2]],
      rotationDeg: before.rotationDeg,
      scale: before.scale,
    });
    useEditorStore.getState().commitTransform(id, before);

    const after = useEditorStore.getState().project.nodes[id].designTransform;
    expect(after.position[0]).toBe(5);
    expect(after.position[1]).toBe(40);
    expect(after.position[2]).toBe(9);
  });

  it("a no-op transform commit (identical prev/next) does not push a history entry", () => {
    const store = useEditorStore.getState();
    const id = store.addMeshNode(createCubeMesh(10, 10, 10), "Cube");
    const before = useEditorStore.getState().past.length;
    const same = useEditorStore.getState().project.nodes[id].designTransform;
    useEditorStore.getState().commitTransform(id, same);
    expect(useEditorStore.getState().past.length).toBe(before);
  });
});

describe("duplicate", () => {
  it("creates a new node with a different id but identical geometry and transform", () => {
    const store = useEditorStore.getState();
    const transform = { position: [3, 4, 5] as [number, number, number], rotationDeg: [0, 20, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] };
    const id = store.addMeshNode(createCubeMesh(18, 18, 10), "Original", transform);

    const dupId = useEditorStore.getState().duplicateNode(id)!;
    expect(dupId).not.toBe(id);

    const original = useEditorStore.getState().project.nodes[id];
    const dup = useEditorStore.getState().project.nodes[dupId];

    expect(dup.designTransform).toEqual(original.designTransform);
    expect(Array.from(dup.mesh.positions)).toEqual(Array.from(original.mesh.positions));
    expect(Array.from(dup.mesh.indices)).toEqual(Array.from(original.mesh.indices));
    // mesh buffers must be independent copies, not aliased
    expect(dup.mesh.positions).not.toBe(original.mesh.positions);

    expect(useEditorStore.getState().selectedId).toBe(dupId);
  });

  it("undo removes the duplicate and leaves the original untouched", () => {
    const store = useEditorStore.getState();
    const id = store.addMeshNode(createCubeMesh(10, 10, 10), "Original");
    const beforeDup = toComparableProjectState(useEditorStore.getState().project);
    useEditorStore.getState().duplicateNode(id);
    expect(Object.keys(useEditorStore.getState().project.nodes).length).toBe(2);

    useEditorStore.getState().undo();
    expect(toComparableProjectState(useEditorStore.getState().project)).toEqual(beforeDup);
  });
});

describe("delete", () => {
  it("removes a node and undo restores it at the same scene-tree position", () => {
    const store = useEditorStore.getState();
    const a = store.addMeshNode(createCubeMesh(10, 10, 10), "A");
    const b = store.addMeshNode(createCubeMesh(10, 10, 10), "B");
    const c = store.addMeshNode(createCubeMesh(10, 10, 10), "C");
    expect(useEditorStore.getState().project.order).toEqual([a, b, c]);

    useEditorStore.getState().select(b);
    useEditorStore.getState().removeNode(b);
    expect(useEditorStore.getState().project.order).toEqual([a, c]);
    expect(useEditorStore.getState().selectedId).toBeNull();

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().project.order).toEqual([a, b, c]);
    expect(useEditorStore.getState().project.nodes[b].name).toBe("B");
  });
});

describe("multi-select: selectedIds / toggleSelect", () => {
  it("select(id) replaces the whole selection with just that node", () => {
    const store = useEditorStore.getState();
    const a = store.addMeshNode(createCubeMesh(10, 10, 10), "A");
    const b = store.addMeshNode(createCubeMesh(10, 10, 10), "B");
    useEditorStore.getState().select(null); // addMeshNode auto-selects each new node -- start from a clean slate
    useEditorStore.getState().toggleSelect(a);
    useEditorStore.getState().toggleSelect(b);
    expect(useEditorStore.getState().selectedIds).toEqual([a, b]);

    useEditorStore.getState().select(a);
    expect(useEditorStore.getState().selectedIds).toEqual([a]);
    expect(useEditorStore.getState().selectedId).toBe(a);
  });

  it("select(null) clears the whole selection", () => {
    const store = useEditorStore.getState();
    const a = store.addMeshNode(createCubeMesh(10, 10, 10), "A");
    useEditorStore.getState().select(null);
    expect(useEditorStore.getState().selectedIds).toEqual([]);
    expect(useEditorStore.getState().selectedId).toBeNull();
    void a;
  });

  it("toggleSelect adds nodes to the selection in click order, and selectedId tracks the last one toggled in", () => {
    const store = useEditorStore.getState();
    const a = store.addMeshNode(createCubeMesh(10, 10, 10), "A");
    const b = store.addMeshNode(createCubeMesh(10, 10, 10), "B");
    const c = store.addMeshNode(createCubeMesh(10, 10, 10), "C");
    useEditorStore.getState().select(null);

    useEditorStore.getState().toggleSelect(a);
    useEditorStore.getState().toggleSelect(c);
    useEditorStore.getState().toggleSelect(b);
    expect(useEditorStore.getState().selectedIds).toEqual([a, c, b]);
    expect(useEditorStore.getState().selectedId).toBe(b);
  });

  it("toggleSelect on an already-selected node removes it, and selectedId falls back to the new last one", () => {
    const store = useEditorStore.getState();
    const a = store.addMeshNode(createCubeMesh(10, 10, 10), "A");
    const b = store.addMeshNode(createCubeMesh(10, 10, 10), "B");
    useEditorStore.getState().select(null);
    useEditorStore.getState().toggleSelect(a);
    useEditorStore.getState().toggleSelect(b);

    useEditorStore.getState().toggleSelect(b);
    expect(useEditorStore.getState().selectedIds).toEqual([a]);
    expect(useEditorStore.getState().selectedId).toBe(a);

    useEditorStore.getState().toggleSelect(a);
    expect(useEditorStore.getState().selectedIds).toEqual([]);
    expect(useEditorStore.getState().selectedId).toBeNull();
  });

  it("removeNode drops the removed node out of selectedIds even when it wasn't the primary selectedId", () => {
    const store = useEditorStore.getState();
    const a = store.addMeshNode(createCubeMesh(10, 10, 10), "A");
    const b = store.addMeshNode(createCubeMesh(10, 10, 10), "B");
    useEditorStore.getState().select(null);
    useEditorStore.getState().toggleSelect(a);
    useEditorStore.getState().toggleSelect(b); // b is primary

    useEditorStore.getState().removeNode(a);
    expect(useEditorStore.getState().selectedIds).toEqual([b]);
    expect(useEditorStore.getState().selectedId).toBe(b); // unaffected, a wasn't primary
  });
});

describe("commitBatchTransform: multi-select group move", () => {
  it("moves several nodes as one undo step", () => {
    const store = useEditorStore.getState();
    const a = store.addMeshNode(createCubeMesh(10, 10, 10), "A", { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] });
    const b = store.addMeshNode(createCubeMesh(10, 10, 10), "B", { position: [20, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] });
    const historyBefore = useEditorStore.getState().past.length;

    const prevA = useEditorStore.getState().project.nodes[a].designTransform;
    const prevB = useEditorStore.getState().project.nodes[b].designTransform;
    useEditorStore.getState().updateNodeTransformDirect(a, { position: [5, 5, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] });
    useEditorStore.getState().updateNodeTransformDirect(b, { position: [25, 5, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] });
    // per-frame direct writes must not touch history, same as the single-node path
    expect(useEditorStore.getState().past.length).toBe(historyBefore);

    useEditorStore.getState().commitBatchTransform([
      { id: a, prev: prevA },
      { id: b, prev: prevB },
    ]);
    expect(useEditorStore.getState().past.length).toBe(historyBefore + 1); // ONE undo step for both

    expect(useEditorStore.getState().project.nodes[a].designTransform.position).toEqual([5, 5, 0]);
    expect(useEditorStore.getState().project.nodes[b].designTransform.position).toEqual([25, 5, 0]);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().project.nodes[a].designTransform.position).toEqual([0, 0, 0]);
    expect(useEditorStore.getState().project.nodes[b].designTransform.position).toEqual([20, 0, 0]);
  });

  it("skips a node in the batch that didn't actually move, without breaking the others", () => {
    const store = useEditorStore.getState();
    const a = store.addMeshNode(createCubeMesh(10, 10, 10), "A", { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] });
    const b = store.addMeshNode(createCubeMesh(10, 10, 10), "B", { position: [20, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] });
    const prevA = useEditorStore.getState().project.nodes[a].designTransform;
    const prevB = useEditorStore.getState().project.nodes[b].designTransform;
    // only move A; B stays exactly where it was
    useEditorStore.getState().updateNodeTransformDirect(a, { position: [9, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] });

    useEditorStore.getState().commitBatchTransform([
      { id: a, prev: prevA },
      { id: b, prev: prevB },
    ]);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().project.nodes[a].designTransform.position).toEqual([0, 0, 0]);
    expect(useEditorStore.getState().project.nodes[b].designTransform.position).toEqual([20, 0, 0]);
  });

  it("a batch where NOTHING actually moved pushes no history entry at all", () => {
    const store = useEditorStore.getState();
    const a = store.addMeshNode(createCubeMesh(10, 10, 10), "A");
    const b = store.addMeshNode(createCubeMesh(10, 10, 10), "B");
    const historyBefore = useEditorStore.getState().past.length;
    const prevA = useEditorStore.getState().project.nodes[a].designTransform;
    const prevB = useEditorStore.getState().project.nodes[b].designTransform;

    useEditorStore.getState().commitBatchTransform([
      { id: a, prev: prevA },
      { id: b, prev: prevB },
    ]);
    expect(useEditorStore.getState().past.length).toBe(historyBefore);
  });
});

describe("rename and visibility", () => {
  it("rename is undoable", () => {
    const store = useEditorStore.getState();
    const id = store.addMeshNode(createCubeMesh(10, 10, 10), "Original");
    useEditorStore.getState().renameNode(id, "Renamed");
    expect(useEditorStore.getState().project.nodes[id].name).toBe("Renamed");
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().project.nodes[id].name).toBe("Original");
  });

  it("visibility toggle is undoable", () => {
    const store = useEditorStore.getState();
    const id = store.addMeshNode(createCubeMesh(10, 10, 10), "Cube");
    expect(useEditorStore.getState().project.nodes[id].visible).toBe(true);
    useEditorStore.getState().setVisible(id, false);
    expect(useEditorStore.getState().project.nodes[id].visible).toBe(false);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().project.nodes[id].visible).toBe(true);
  });
});
