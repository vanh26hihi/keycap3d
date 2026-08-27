import { create } from "zustand";
import type { MeshBuffer, Transform } from "@keycap-web/geometry-core";
import {
  IDENTITY_TRANSFORM,
  applyTransformToMesh,
  computeBoundingBox,
  computeSignedVolume,
  validateMesh,
} from "@keycap-web/geometry-core";
import {
  addNodeCommand,
  batchCommand,
  duplicateNodeCommand,
  removeNodeCommand,
  renameNodeCommand,
  setKeycapParamsCommand,
  setTransformCommand,
  setVisibleCommand,
  splitCommand,
  type Command,
} from "./commands";
import {
  cloneProjectState,
  emptyProjectState,
  type NodeOrigin,
  type ProjectState,
  type SceneNodeState,
} from "./types";
import { splitByPlane, planeNormalFromRotationDeg } from "../lib/splitEngine";
import { createKeycapMesh, resolveKeycapParams, DEFAULT_KEYCAP_PARAMS, type KeycapParams } from "@keycap-web/geometry-core/keycap";
import { loadSavedDefaultParams } from "../lib/keycapDefaults";

export type TransformMode = "translate" | "rotate" | "scale";
export type SplitGizmoMode = "translate" | "rotate";
export type SplitStatus = "idle" | "processing" | "success" | "error";

export interface SplitPlaneState {
  position: [number, number, number];
  rotationDeg: [number, number, number];
}

export interface SplitSession {
  targetNodeId: string;
  plane: SplitPlaneState;
  gizmoMode: SplitGizmoMode;
  /** Visual size (mm) of the semi-transparent plane mesh, sized to the
   *  target object at session start so it's always clearly bigger than the
   *  model regardless of orientation. */
  planeSizeMm: number;
}

const MAX_HISTORY = 200;

export interface EditorStore {
  project: ProjectState;
  /** The "primary" selection -- the last node clicked/toggled, whether it's
   *  the only one selected or one of several. Every pre-multi-select code
   *  path (panels that show one node's own detail) keys off this field
   *  unchanged; `selectedIds` is the ADDITIONAL full selection set for
   *  multi-select features (batch param edit, group move). */
  selectedId: string | null;
  /** Full multi-selection, in click order. Empty when nothing is selected;
   *  a single-element array in the common single-select case (kept in sync
   *  with `selectedId`, which always equals `selectedIds[selectedIds.length
   *  - 1]` when non-empty). Multi-select-aware UI (the group gizmo, batch
   *  keycap param editing) reads this; everything else can ignore it and
   *  keep using `selectedId` exactly as before. */
  selectedIds: string[];
  transformMode: TransformMode;
  past: Command[];
  future: Command[];
  /**
   * Id of the node currently being dragged by TransformControls, or null.
   * Purely transient UI state -- never touched by undo/redo. Exists so the
   * viewport can stop re-applying position/rotation/scale from the store
   * onto the Object3D while TransformControls is actively manipulating that
   * same object (see Viewport.tsx SceneNodeMesh): re-applying "the same"
   * values via declarative props during a drag still calls object3D's
   * position/rotation/scale .set() on every store update, which corrupts
   * TransformControls' internal drag-delta bookkeeping and was the root
   * cause of "dragging doesn't work correctly" (values fighting/resetting
   * mid-drag) rather than a TransformControls or coordinate-conversion bug.
   */
  draggingNodeId: string | null;
  /** Same idea as `draggingNodeId`, for the multi-select group gizmo: every
   *  node being moved together as a group needs to skip its own declarative
   *  position/rotation/scale re-apply while `updateNodeTransformDirect` is
   *  being called on it every drag frame -- a single id isn't enough once
   *  more than one node moves at once. */
  draggingGroupIds: string[];
  /** Same fighting-declarative-props problem as `draggingNodeId`, for the
   *  M3 split plane gizmo instead of a node gizmo. */
  splitPlaneDragging: boolean;

  /** Object Manager "Isolate": temporarily hides every other node without
   *  touching their persisted `visible` flag. Purely a viewport filter. */
  isolatedNodeId: string | null;

  /** M3 plane-split session. Non-null while the Split panel is open; the
   *  target node's own TransformControls gizmo is suppressed while a
   *  session is active so only the plane gizmo is interactive. */
  splitSession: SplitSession | null;
  splitStatus: SplitStatus;
  splitError: string | null;

  /** Replaces the ENTIRE selection with just this one node (or clears it,
   *  for `null`) -- a plain click, matching every existing single-select
   *  call site's expectation unchanged. */
  select(id: string | null): void;
  /** Ctrl/Cmd-click: adds `id` to the selection if it isn't already
   *  selected, or removes it if it is. The new/remaining last-toggled-in
   *  node becomes the new `selectedId` (primary); removing the primary
   *  falls back to whatever's left in `selectedIds`, or null if none. */
  toggleSelect(id: string): void;
  /** Ctrl/Cmd+A: selects every node currently in the scene. */
  selectAll(): void;
  /** Marquee/box-select: replaces the whole selection with exactly this
   *  set of ids (order preserved from `ids`, last one becomes the new
   *  primary `selectedId`) -- used by the viewport's drag-rectangle select
   *  instead of toggling one at a time. */
  selectMany(ids: string[]): void;
  setTransformMode(mode: TransformMode): void;
  setDraggingNode(id: string | null): void;
  setDraggingGroup(ids: string[]): void;
  setIsolated(id: string | null): void;

  /** Whether the "+ Tạo hàng loạt từ chữ" dialog is open -- purely
   *  transient UI state (never touched by undo/redo), same as
   *  `isolatedNodeId`. Kept in the store (not local component state) since
   *  the toolbar button that opens it and the dialog itself that closes it
   *  are siblings, not parent/child. */
  batchCreateOpen: boolean;
  setBatchCreateOpen(open: boolean): void;

  execute(command: Command): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  /** Raw, non-undoable state write used for live gizmo-drag preview (per-frame). */
  updateNodeTransformDirect(id: string, transform: Transform): void;
  /** Pushes a single undo step comparing `prev` to the node's current transform. */
  commitTransform(id: string, prev: Transform): void;
  /** Same idea as `commitTransform`, for the multi-select group gizmo: one
   *  undo step covering every node the group drag actually moved (nodes
   *  whose transform didn't change relative to their own `prev` are
   *  skipped, same no-op-suppression as the single-node path). */
  commitBatchTransform(updates: Array<{ id: string; prev: Transform }>): void;

  addMeshNode(mesh: MeshBuffer, name: string, transform?: Transform, origin?: NodeOrigin): string;
  removeNode(id: string): void;
  duplicateNode(id: string): string | null;
  renameNode(id: string, name: string): void;
  setVisible(id: string, visible: boolean): void;

  beginSplit(nodeId: string): void;
  updateSplitPlaneDirect(plane: Partial<SplitPlaneState>): void;
  setSplitPlaneDragging(dragging: boolean): void;
  setSplitGizmoMode(mode: SplitGizmoMode): void;
  centerSplitPlaneToObject(): void;
  resetSplitPlane(): void;
  cancelSplit(): void;
  applySplit(): Promise<void>;

  /** M4: adds a new parametric keycap node with default (or overridden)
   *  params, selects it, and returns its id once generation completes. */
  addKeycapNode(paramsOverride?: Partial<KeycapParams>, positionOverride?: [number, number, number]): Promise<string>;
  /** Merges `partial` into the node's current keycap params, regenerates the
   *  mesh, and pushes exactly one undo step. No-ops (no history entry) if
   *  the node isn't a keycap node or the merged params are unchanged. */
  updateKeycapParams(id: string, partial: Partial<KeycapParams>): Promise<void>;
  /** Multi-select batch edit: merges `partial` into EACH listed node's own
   *  current params individually (not a shared overwrite -- every node
   *  keeps its own other fields, only the edited one changes uniformly
   *  across all of them), regenerates every affected mesh, and commits all
   *  the changes as ONE undo step. Ids with no keycap params, or whose
   *  merged params come out unchanged, are silently skipped. */
  updateKeycapParamsBatch(ids: string[], partial: Partial<KeycapParams>): Promise<void>;
  keycapStatus: "idle" | "generating" | "error";
  keycapError: string | null;
}

function transformsEqual(a: Transform, b: Transform): boolean {
  return (
    a.position[0] === b.position[0] &&
    a.position[1] === b.position[1] &&
    a.position[2] === b.position[2] &&
    a.rotationDeg[0] === b.rotationDeg[0] &&
    a.rotationDeg[1] === b.rotationDeg[1] &&
    a.rotationDeg[2] === b.rotationDeg[2] &&
    a.scale[0] === b.scale[0] &&
    a.scale[1] === b.scale[1] &&
    a.scale[2] === b.scale[2]
  );
}

function nextId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `node_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function worldBoundingBoxCenter(node: SceneNodeState): [number, number, number] {
  const box = computeBoundingBox(applyTransformToMesh(node.mesh, node.designTransform));
  return [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
}

function planeSizeForNode(node: SceneNodeState): number {
  const box = computeBoundingBox(applyTransformToMesh(node.mesh, node.designTransform));
  const maxDim = Math.max(box.size[0], box.size[1], box.size[2]);
  return Math.max(maxDim * 2.5, 40);
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  project: emptyProjectState(),
  selectedId: null,
  selectedIds: [],
  transformMode: "translate",
  past: [],
  future: [],
  draggingNodeId: null,
  draggingGroupIds: [],
  splitPlaneDragging: false,
  isolatedNodeId: null,
  batchCreateOpen: false,
  splitSession: null,
  splitStatus: "idle",
  splitError: null,
  keycapStatus: "idle",
  keycapError: null,

  select(id) {
    set({ selectedId: id, selectedIds: id ? [id] : [] });
  },

  toggleSelect(id) {
    set((s) => {
      const already = s.selectedIds.includes(id);
      const selectedIds = already ? s.selectedIds.filter((existing) => existing !== id) : [...s.selectedIds, id];
      const selectedId = selectedIds.length > 0 ? selectedIds[selectedIds.length - 1] : null;
      return { selectedIds, selectedId };
    });
  },

  selectAll() {
    set((s) => {
      const selectedIds = [...s.project.order];
      const selectedId = selectedIds.length > 0 ? selectedIds[selectedIds.length - 1] : null;
      return { selectedIds, selectedId };
    });
  },

  selectMany(ids) {
    set({ selectedIds: [...ids], selectedId: ids.length > 0 ? ids[ids.length - 1] : null });
  },

  setTransformMode(mode) {
    set({ transformMode: mode });
  },

  setDraggingNode(id) {
    set({ draggingNodeId: id });
  },

  setDraggingGroup(ids) {
    set({ draggingGroupIds: ids });
  },

  setIsolated(id) {
    set({ isolatedNodeId: id });
  },

  setBatchCreateOpen(open) {
    set({ batchCreateOpen: open });
  },

  execute(command) {
    set((s) => {
      const project = command.do(s.project);
      const past = [...s.past, command];
      if (past.length > MAX_HISTORY) past.shift();
      return { project, past, future: [] };
    });
  },

  undo() {
    set((s) => {
      if (s.past.length === 0) return s;
      const command = s.past[s.past.length - 1];
      const project = command.undo(s.project);
      return { project, past: s.past.slice(0, -1), future: [...s.future, command] };
    });
  },

  redo() {
    set((s) => {
      if (s.future.length === 0) return s;
      const command = s.future[s.future.length - 1];
      const project = command.do(s.project);
      return { project, past: [...s.past, command], future: s.future.slice(0, -1) };
    });
  },

  canUndo() {
    return get().past.length > 0;
  },
  canRedo() {
    return get().future.length > 0;
  },

  updateNodeTransformDirect(id, transform) {
    set((s) => {
      const node = s.project.nodes[id];
      if (!node) return s;
      return {
        project: {
          ...s.project,
          nodes: { ...s.project.nodes, [id]: { ...node, designTransform: transform } },
        },
      };
    });
  },

  commitTransform(id, prev) {
    const node = get().project.nodes[id];
    if (!node) return;
    const next = node.designTransform;
    if (transformsEqual(prev, next)) return; // no-op drag/edit, don't pollute history
    get().execute(setTransformCommand(id, prev, next));
  },

  commitBatchTransform(updates) {
    const commands: Command[] = [];
    for (const { id, prev } of updates) {
      const node = get().project.nodes[id];
      if (!node) continue;
      const next = node.designTransform;
      if (transformsEqual(prev, next)) continue; // this node didn't actually move -- skip it
      commands.push(setTransformCommand(id, prev, next));
    }
    if (commands.length === 0) return; // nothing in the whole group actually moved
    get().execute(batchCommand(commands, `Move ${commands.length} objects`));
  },

  addMeshNode(mesh, name, transform, origin) {
    const id = nextId();
    const node: SceneNodeState = {
      id,
      name,
      visible: true,
      locked: false,
      color: "#8fa6c4",
      designTransform: transform ? { ...transform } : { ...IDENTITY_TRANSFORM },
      printTransform: null,
      mesh,
      origin: origin ?? { kind: "primitive" },
      assemblyId: null,
      role: null,
      parametric: null,
    };
    get().execute(addNodeCommand(node));
    set({ selectedId: id, selectedIds: [id] });
    return id;
  },

  removeNode(id) {
    // TransformControls now lives inside the same SceneNodeMesh subtree as
    // its target object (see Viewport.tsx) -- both unmount together in the
    // same React commit when this node is removed, so no imperative
    // pre-detach is needed here (unlike the earlier scene.getObjectByName
    // architecture, where TransformControls could outlive its target by a
    // commit or more).
    const command = removeNodeCommand(get().project, id);
    get().execute(command);
    set((s) => {
      const selectedIds = s.selectedIds.filter((existing) => existing !== id);
      const selectedId = s.selectedId === id ? (selectedIds.length > 0 ? selectedIds[selectedIds.length - 1] : null) : s.selectedId;
      return { selectedIds, selectedId };
    });
    if (get().isolatedNodeId === id) set({ isolatedNodeId: null });
    if (get().splitSession?.targetNodeId === id) set({ splitSession: null, splitStatus: "idle", splitError: null });
  },

  duplicateNode(id) {
    const newId = nextId();
    const command = duplicateNodeCommand(get().project, id, newId);
    if (!command) return null;
    get().execute(command);
    set({ selectedId: newId, selectedIds: [newId] });
    return newId;
  },

  renameNode(id, name) {
    const node = get().project.nodes[id];
    if (!node || node.name === name) return;
    get().execute(renameNodeCommand(id, node.name, name));
  },

  setVisible(id, visible) {
    const node = get().project.nodes[id];
    if (!node || node.visible === visible) return;
    get().execute(setVisibleCommand(id, node.visible, visible));
  },

  beginSplit(nodeId) {
    const node = get().project.nodes[nodeId];
    if (!node) return;
    set({
      selectedId: nodeId,
      selectedIds: [nodeId],
      splitSession: {
        targetNodeId: nodeId,
        plane: { position: worldBoundingBoxCenter(node), rotationDeg: [0, 0, 0] },
        gizmoMode: "translate",
        planeSizeMm: planeSizeForNode(node),
      },
      splitStatus: "idle",
      splitError: null,
    });
  },

  updateSplitPlaneDirect(plane) {
    set((s) => (s.splitSession ? { splitSession: { ...s.splitSession, plane: { ...s.splitSession.plane, ...plane } } } : s));
  },

  setSplitPlaneDragging(dragging) {
    set({ splitPlaneDragging: dragging });
  },

  setSplitGizmoMode(mode) {
    set((s) => (s.splitSession ? { splitSession: { ...s.splitSession, gizmoMode: mode } } : s));
  },

  centerSplitPlaneToObject() {
    set((s) => {
      if (!s.splitSession) return s;
      const node = s.project.nodes[s.splitSession.targetNodeId];
      if (!node) return s;
      return {
        splitSession: {
          ...s.splitSession,
          plane: { ...s.splitSession.plane, position: worldBoundingBoxCenter(node) },
        },
      };
    });
  },

  resetSplitPlane() {
    set((s) => {
      if (!s.splitSession) return s;
      const node = s.project.nodes[s.splitSession.targetNodeId];
      if (!node) return s;
      return {
        splitSession: {
          ...s.splitSession,
          plane: { position: worldBoundingBoxCenter(node), rotationDeg: [0, 0, 0] },
        },
      };
    });
  },

  cancelSplit() {
    set({ splitSession: null, splitStatus: "idle", splitError: null });
  },

  async applySplit() {
    const session = get().splitSession;
    if (!session) return;
    const node = get().project.nodes[session.targetNodeId];
    if (!node) {
      set({ splitStatus: "error", splitError: "The object being split no longer exists." });
      return;
    }

    set({ splitStatus: "processing", splitError: null });

    try {
      // Bake designTransform into a working mesh so both the cut and the
      // resulting parts live directly in design/world space -- the new
      // part nodes then get an IDENTITY designTransform (their mesh *is*
      // already positioned correctly), which is what makes "Part A + Part B
      // loaded together with no extra offset reconstruct the original" hold.
      const worldMesh = applyTransformToMesh(node.mesh, node.designTransform);
      // Must read this BEFORE calling splitByPlane: the worker path
      // transfers (detaches) worldMesh's underlying ArrayBuffers to zero-copy
      // it into the Worker, so worldMesh.positions/.indices are empty by the
      // time splitByPlane resolves. Computing "volOriginal" afterward instead
      // silently read a detached (0-length) buffer and always saw 0mm^3 --
      // a real bug caught by manual browser testing (the volume-conservation
      // check firing on every split, always claiming exactly the full part
      // volume as "lost"), not something the geometry-core unit tests could
      // have caught since those never exercise the Worker transfer path.
      const volOriginal = Math.abs(computeSignedVolume(worldMesh));
      const normal = planeNormalFromRotationDeg(session.plane.rotationDeg);
      const offsetMm =
        normal[0] * session.plane.position[0] +
        normal[1] * session.plane.position[1] +
        normal[2] * session.plane.position[2];

      const { partA, partB } = await splitByPlane(worldMesh, normal, offsetMm);

      if (partA.indices.length === 0 || partB.indices.length === 0) {
        throw new Error(
          "The cutting plane does not intersect the model (or only touches its boundary) -- one side would be empty. Move or rotate the plane so it actually passes through the model, then try again.",
        );
      }

      const reportA = validateMesh(partA);
      const reportB = validateMesh(partB);
      if (!reportA.isWatertight || !reportB.isWatertight) {
        throw new Error(
          `Split produced a non-watertight part (Part A open edges=${reportA.openEdgeCount} non-manifold=${reportA.nonManifoldEdgeCount}; Part B open edges=${reportB.openEdgeCount} non-manifold=${reportB.nonManifoldEdgeCount}). Refusing to apply an unsafe split -- adjust the plane and try again.`,
        );
      }

      const volA = Math.abs(computeSignedVolume(partA));
      const volB = Math.abs(computeSignedVolume(partB));
      const volDiff = Math.abs(volA + volB - volOriginal);
      const tolerance = Math.max(volOriginal * 0.01, 1); // 1% or 1mm^3, whichever is larger
      if (volDiff > tolerance) {
        throw new Error(
          `Volume not conserved by the split: original=${volOriginal.toFixed(2)}mm^3, Part A+B=${(volA + volB).toFixed(2)}mm^3 (diff ${volDiff.toFixed(2)}mm^3, tolerance ${tolerance.toFixed(2)}mm^3). This indicates a boolean error -- refusing to apply.`,
        );
      }

      const partAId = nextId();
      const partBId = nextId();
      const partANode: SceneNodeState = {
        id: partAId,
        name: `${node.name} - Part A`,
        visible: true,
        locked: false,
        color: node.color,
        designTransform: { ...IDENTITY_TRANSFORM },
        printTransform: null,
        mesh: partA,
        origin: { kind: "split", splitFrom: node.id, splitSibling: partBId },
        assemblyId: node.assemblyId,
        role: null,
        parametric: null,
      };
      const partBNode: SceneNodeState = {
        id: partBId,
        name: `${node.name} - Part B`,
        visible: true,
        locked: false,
        color: node.color,
        designTransform: { ...IDENTITY_TRANSFORM },
        printTransform: null,
        mesh: partB,
        origin: { kind: "split", splitFrom: node.id, splitSibling: partAId },
        assemblyId: node.assemblyId,
        role: null,
        parametric: null,
      };

      get().execute(splitCommand(get().project, session.targetNodeId, partANode, partBNode));
      set({ splitStatus: "success", splitSession: null, selectedId: partAId, selectedIds: [partAId] });
      if (get().isolatedNodeId === session.targetNodeId) set({ isolatedNodeId: null });
    } catch (err) {
      set({ splitStatus: "error", splitError: err instanceof Error ? err.message : String(err) });
      // No command was executed -- the original node is untouched, no part
      // nodes were created. Session stays open so the user can adjust the
      // plane and retry without starting over.
    }
  },

  async addKeycapNode(paramsOverride, positionOverride) {
    // Only the "no override given" call (the toolbar's plain + Keycap
    // button) falls back to the user's saved default -- a caller that
    // passes an explicit override (e.g. the Legend field's batch-create,
    // which clones the CURRENT keycap's exact params for each new sibling)
    // means it precisely, not "start from my usual default".
    const params: KeycapParams = resolveKeycapParams(paramsOverride ?? loadSavedDefaultParams() ?? {});
    set({ keycapStatus: "generating", keycapError: null });
    try {
      const mesh = await createKeycapMesh(params);
      const id = nextId();
      const node: SceneNodeState = {
        id,
        name: `Keycap ${Date.now() % 1000}`,
        visible: true,
        locked: false,
        color: "#8fa6c4",
        designTransform: positionOverride
          ? { ...IDENTITY_TRANSFORM, position: positionOverride }
          : { ...IDENTITY_TRANSFORM },
        printTransform: null,
        mesh,
        origin: { kind: "primitive" },
        assemblyId: null,
        role: null,
        parametric: { generatorId: "keycapV1", params },
      };
      get().execute(addNodeCommand(node));
      set({ selectedId: id, selectedIds: [id], keycapStatus: "idle" });
      return id;
    } catch (err) {
      set({ keycapStatus: "error", keycapError: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  },

  async updateKeycapParams(id, partial) {
    const node = get().project.nodes[id];
    if (!node || !node.parametric) return;
    const prevParams = node.parametric.params;
    const nextParams: KeycapParams = resolveKeycapParams({ ...prevParams, ...partial });
    if (JSON.stringify(prevParams) === JSON.stringify(nextParams)) return; // no-op edit, don't pollute history

    set({ keycapStatus: "generating", keycapError: null });
    try {
      const nextMesh = await createKeycapMesh(nextParams);
      // Re-read the node: it might have been deleted/changed while the
      // (async) generator was running.
      const current = get().project.nodes[id];
      if (!current || !current.parametric) {
        set({ keycapStatus: "idle" });
        return;
      }
      get().execute(setKeycapParamsCommand(id, prevParams, current.mesh, nextParams, nextMesh));
      set({ keycapStatus: "idle" });
    } catch (err) {
      set({ keycapStatus: "error", keycapError: err instanceof Error ? err.message : String(err) });
    }
  },

  async updateKeycapParamsBatch(ids, partial) {
    // Each node merges `partial` into ITS OWN current params -- not a
    // shared overwrite -- so every other field a node already had stays
    // exactly as it was; only the edited field moves in lockstep across
    // the whole selection.
    const targets = ids
      .map((id) => {
        const node = get().project.nodes[id];
        if (!node || !node.parametric) return null;
        const prevParams = node.parametric.params;
        const nextParams: KeycapParams = resolveKeycapParams({ ...prevParams, ...partial });
        if (JSON.stringify(prevParams) === JSON.stringify(nextParams)) return null; // no-op for this node
        return { id, prevParams, prevMesh: node.mesh, nextParams };
      })
      .filter((t): t is { id: string; prevParams: KeycapParams; prevMesh: MeshBuffer; nextParams: KeycapParams } => t !== null);

    if (targets.length === 0) return;

    set({ keycapStatus: "generating", keycapError: null });
    try {
      const nextMeshes = await Promise.all(targets.map((t) => createKeycapMesh(t.nextParams)));
      const commands: Command[] = [];
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        // Re-read: a node might have been deleted/changed while these (async,
        // parallel) generators were running.
        const current = get().project.nodes[t.id];
        if (!current || !current.parametric) continue;
        commands.push(setKeycapParamsCommand(t.id, t.prevParams, current.mesh, t.nextParams, nextMeshes[i]));
      }
      if (commands.length > 0) {
        get().execute(batchCommand(commands, `Edit ${commands.length} keycaps`));
      }
      set({ keycapStatus: "idle" });
    } catch (err) {
      set({ keycapStatus: "error", keycapError: err instanceof Error ? err.message : String(err) });
    }
  },
}));

if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as any).__editorStore = useEditorStore;
}

/** Test/debug helper: deep-clones project state to a plain JSON-safe structure for equality checks. */
export function toComparableProjectState(state: ProjectState) {
  return {
    order: [...state.order],
    nodes: Object.fromEntries(
      Object.entries(state.nodes).map(([id, n]) => [
        id,
        {
          id: n.id,
          name: n.name,
          visible: n.visible,
          locked: n.locked,
          color: n.color,
          designTransform: {
            position: [...n.designTransform.position],
            rotationDeg: [...n.designTransform.rotationDeg],
            scale: [...n.designTransform.scale],
          },
          printTransform: n.printTransform ? { ...n.printTransform } : null,
          positions: Array.from(n.mesh.positions),
          indices: Array.from(n.mesh.indices),
          origin: n.origin,
          parametric: n.parametric ? { generatorId: n.parametric.generatorId, params: { ...n.parametric.params } } : null,
        },
      ]),
    ),
  };
}

export { cloneProjectState };
