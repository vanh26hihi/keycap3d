import type { Transform, MeshBuffer } from "@keycap-web/geometry-core";
import type { KeycapParams } from "@keycap-web/geometry-core/keycap";
import type { KeycapPartsForRender, ProjectState, SceneNodeState } from "./types";

/**
 * Command pattern per the blueprint: each command stores only the small
 * operation + before/after parameters it needs to reverse itself, not a
 * snapshot of the whole project (which would mean copying every node's
 * mesh on every undo step). The one necessary exception is
 * `removeNodeCommand`, which must keep the deleted node's own data to be
 * able to restore it — that's an unavoidable property of "delete", not a
 * design shortcut.
 */
export interface Command {
  readonly label: string;
  do(state: ProjectState): ProjectState;
  undo(state: ProjectState): ProjectState;
}

export function setTransformCommand(nodeId: string, prev: Transform, next: Transform): Command {
  return {
    label: `Transform ${nodeId}`,
    do(state) {
      const node = state.nodes[nodeId];
      if (!node) return state;
      return { ...state, nodes: { ...state.nodes, [nodeId]: { ...node, designTransform: next } } };
    },
    undo(state) {
      const node = state.nodes[nodeId];
      if (!node) return state;
      return { ...state, nodes: { ...state.nodes, [nodeId]: { ...node, designTransform: prev } } };
    },
  };
}

export function renameNodeCommand(nodeId: string, prev: string, next: string): Command {
  return {
    label: `Rename ${nodeId}`,
    do(state) {
      const node = state.nodes[nodeId];
      if (!node) return state;
      return { ...state, nodes: { ...state.nodes, [nodeId]: { ...node, name: next } } };
    },
    undo(state) {
      const node = state.nodes[nodeId];
      if (!node) return state;
      return { ...state, nodes: { ...state.nodes, [nodeId]: { ...node, name: prev } } };
    },
  };
}

export function setVisibleCommand(nodeId: string, prev: boolean, next: boolean): Command {
  return {
    label: `Visibility ${nodeId}`,
    do(state) {
      const node = state.nodes[nodeId];
      if (!node) return state;
      return { ...state, nodes: { ...state.nodes, [nodeId]: { ...node, visible: next } } };
    },
    undo(state) {
      const node = state.nodes[nodeId];
      if (!node) return state;
      return { ...state, nodes: { ...state.nodes, [nodeId]: { ...node, visible: prev } } };
    },
  };
}

export function setColorCommand(nodeId: string, prev: string, next: string): Command {
  return {
    label: `Color ${nodeId}`,
    do(state) {
      const node = state.nodes[nodeId];
      if (!node) return state;
      return { ...state, nodes: { ...state.nodes, [nodeId]: { ...node, color: next } } };
    },
    undo(state) {
      const node = state.nodes[nodeId];
      if (!node) return state;
      return { ...state, nodes: { ...state.nodes, [nodeId]: { ...node, color: prev } } };
    },
  };
}

export function addNodeCommand(node: SceneNodeState): Command {
  return {
    label: `Add ${node.name}`,
    do(state) {
      return {
        nodes: { ...state.nodes, [node.id]: node },
        order: [...state.order, node.id],
      };
    },
    undo(state) {
      const { [node.id]: _removed, ...rest } = state.nodes;
      return { nodes: rest, order: state.order.filter((id) => id !== node.id) };
    },
  };
}

/**
 * Captures the node's current data and list index at construction time
 * (i.e. call this with the state as it is *before* removal), so `undo` can
 * restore it to the same position in the scene tree it was removed from.
 */
export function removeNodeCommand(state: ProjectState, nodeId: string): Command {
  const node = state.nodes[nodeId];
  const index = state.order.indexOf(nodeId);
  return {
    label: `Remove ${node?.name ?? nodeId}`,
    do(s) {
      const { [nodeId]: _removed, ...rest } = s.nodes;
      return { nodes: rest, order: s.order.filter((id) => id !== nodeId) };
    },
    undo(s) {
      if (!node) return s;
      const order = [...s.order];
      const insertAt = index >= 0 && index <= order.length ? index : order.length;
      order.splice(insertAt, 0, nodeId);
      return { nodes: { ...s.nodes, [nodeId]: node }, order };
    },
  };
}

/**
 * Exact duplicate (same designTransform/printTransform/mesh, only a new id
 * and " copy" suffixed name) — matches the M2 acceptance criteria that a
 * duplicate must be geometrically identical to its source, not offset.
 */
export function duplicateNodeCommand(state: ProjectState, sourceId: string, newId: string): Command | null {
  const source = state.nodes[sourceId];
  if (!source) return null;
  const cloned: SceneNodeState = {
    ...source,
    id: newId,
    name: `${source.name} copy`,
    mesh: cloneMeshBuffer(source.mesh),
    designTransform: { ...source.designTransform },
    printTransform: source.printTransform ? { ...source.printTransform } : null,
  };
  return addNodeCommand(cloned);
}

/**
 * Replaces one source node with two new part nodes in a single atomic
 * command -- Apply Split = exactly one undo step. Captures the source
 * node's full data and its index in `order` at construction time (call this
 * with the state as it is *before* the split), the same pattern as
 * `removeNodeCommand`, so undo can restore it byte-for-byte at the same
 * scene-tree position; redo re-applies the exact same partA/partB objects
 * (not a recomputation), so redo can never disagree with what the user saw
 * after the original Apply Split.
 */
export function splitCommand(
  state: ProjectState,
  sourceId: string,
  partA: SceneNodeState,
  partB: SceneNodeState,
): Command {
  const source = state.nodes[sourceId];
  const index = state.order.indexOf(sourceId);
  return {
    label: `Split ${source?.name ?? sourceId}`,
    do(s) {
      const { [sourceId]: _removed, ...rest } = s.nodes;
      const order = s.order.filter((id) => id !== sourceId);
      const insertAt = index >= 0 && index <= order.length ? index : order.length;
      order.splice(insertAt, 0, partA.id, partB.id);
      return { nodes: { ...rest, [partA.id]: partA, [partB.id]: partB }, order };
    },
    undo(s) {
      if (!source) return s;
      const order = s.order.filter((id) => id !== partA.id && id !== partB.id);
      const insertAt = index >= 0 && index <= order.length ? index : order.length;
      order.splice(insertAt, 0, sourceId);
      const { [partA.id]: _a, [partB.id]: _b, ...rest } = s.nodes;
      return { nodes: { ...rest, [sourceId]: source }, order };
    },
  };
}

/**
 * M4 keycap parameter edit: swaps both `parametric.params` and `mesh`
 * together as one undo step. `nextMesh` must already be the real regenerated
 * mesh (computed by the caller via `createKeycapMesh(nextParams)` before
 * building this command) -- redo replays that captured mesh directly rather
 * than calling the (async, boolean-engine-backed) generator again, so redo
 * can never produce a result that disagrees with what Apply/commit actually
 * showed the user, and undo/redo both stay synchronous.
 */
export function setKeycapParamsCommand(
  nodeId: string,
  prevParams: KeycapParams,
  prevMesh: MeshBuffer,
  prevParts: KeycapPartsForRender,
  nextParams: KeycapParams,
  nextMesh: MeshBuffer,
  nextParts: KeycapPartsForRender,
): Command {
  return {
    label: `Edit keycap ${nodeId}`,
    do(state) {
      const node = state.nodes[nodeId];
      if (!node) return state;
      return {
        ...state,
        nodes: {
          ...state.nodes,
          [nodeId]: { ...node, mesh: nextMesh, parametric: { generatorId: "keycapV1", params: nextParams, parts: nextParts } },
        },
      };
    },
    undo(state) {
      const node = state.nodes[nodeId];
      if (!node) return state;
      return {
        ...state,
        nodes: {
          ...state.nodes,
          [nodeId]: { ...node, mesh: prevMesh, parametric: { generatorId: "keycapV1", params: prevParams, parts: prevParts } },
        },
      };
    },
  };
}

/**
 * Combines several already-constructed commands into one atomic undo step
 * -- for multi-select batch edits (move N objects together, or apply the
 * same keycap param to N selected keycaps) so "Undo" reverses the whole
 * batch in one press instead of N presses. Reuses each individual
 * command's own do/undo rather than re-deriving batch logic, so a batch of
 * (say) setTransformCommand instances behaves identically to applying them
 * one at a time -- just atomically. Undoes in reverse order, the generally
 * correct convention for undoing a sequence of operations (though here
 * each command targets a distinct, independent node, so order doesn't
 * actually matter for correctness).
 */
export function batchCommand(commands: Command[], label = "Batch edit"): Command {
  return {
    label,
    do(state) {
      return commands.reduce((s, cmd) => cmd.do(s), state);
    },
    undo(state) {
      return [...commands].reverse().reduce((s, cmd) => cmd.undo(s), state);
    },
  };
}

function cloneMeshBuffer(mesh: MeshBuffer): MeshBuffer {
  return {
    positions: mesh.positions.slice(),
    indices: mesh.indices.slice(),
    normals: mesh.normals ? mesh.normals.slice() : undefined,
  };
}
