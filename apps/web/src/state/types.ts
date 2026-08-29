import type { MeshBuffer, PrintTransform, Transform } from "@keycap-web/geometry-core";
// `import type` is fully erased at compile time -- this does NOT pull the
// WASM-touching keycap generator (or its manifold-3d dependency) into any
// bundle; it's purely a type reference, same principle as the "/boolean"
// subpath already being excluded from the main barrel.
import type { KeycapParams } from "@keycap-web/geometry-core/keycap";

/**
 * Where a node's geometry came from. `role`/`assemblyId` below are the
 * minimal forward-compat hooks the M3 brief asked for so that M5's
 * multi-switch/assembly work (`V I E T A N H` -> 7 switch objects sharing
 * one assembly, or a clicker's Body + N switches + Bottom Cover) doesn't
 * force a data-model rewrite. None of this is exercised by any M3 UI --
 * `assemblyId`/`role` are always null today -- it only has to exist and be
 * additive.
 */
export type NodeOrigin =
  | { kind: "primitive" }
  | { kind: "import" }
  | { kind: "split"; splitFrom: string; splitSibling: string };

/**
 * M2 scope: every node wraps a raw MeshBuffer (imported STL, or a debug
 * primitive spawned from the toolbar). Parametric keycap/clicker generator
 * nodes are out of scope until M4/M5 per the blueprint — adding that
 * `geometry.source` variant is a additive, non-breaking change to this type
 * later, not a rework.
 */
export interface SceneNodeState {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  color: string;
  designTransform: Transform;
  printTransform: PrintTransform | null;
  mesh: MeshBuffer;
  /** Provenance -- lets the Object Manager show "split from X" lineage and
   *  will let a future Assembly view group a Body's split parts together. */
  origin: NodeOrigin;
  /**
   * Forward-compat for M5 assemblies (a clicker Body + one node per switch +
   * a Bottom Cover, all sharing one assemblyId). Not read or written by any
   * M3 code path -- exists purely so M5 can group existing nodes without
   * migrating the SceneNodeState shape.
   */
  assemblyId: string | null;
  /** Forward-compat for M5 multi-switch (e.g. "switch:V", "body", "cover").
   *  Not read or written by any M3 code path. */
  role: string | null;
  /**
   * Present iff this node's `mesh` was produced by a parametric generator
   * (M4: the keycap generator) rather than import/primitive/split -- lets
   * the Object Manager show an editable parameter panel instead of raw
   * mesh info, and lets editing a parameter regenerate `mesh` in place
   * rather than only ever being able to transform/split it. `mesh` is still
   * the source of truth for rendering/export; `parametric.params` is kept
   * in sync with whatever generated the current `mesh` (see
   * `setKeycapParamsCommand`) so the panel always reflects reality, never a
   * stale "what I asked for" separate from "what's actually there".
   *
   * `parts` is the SAME keycap decomposed into its separate objects (see
   * geometry-core's createKeycapMeshParts) -- computed alongside `mesh`
   * purely so the viewport can render each part in its own per-part color
   * (baseColorHex/bubbleColorHex/legendColorHex/stemColorHex) instead of
   * one flat node.color; `mesh` (the real, boolean-fused solid) stays the
   * one used for STL/single-mesh export and bounding-box math -- `parts`'
   * pieces are NOT boolean-unioned with each other (bubble/legend can sit
   * flush against/inside the base), so they're only valid to render, never
   * to export as one merged solid.
   */
  parametric: { generatorId: "keycapV1"; params: KeycapParams; parts: KeycapPartsForRender } | null;
}

/** See SceneNodeState.parametric's doc comment on `parts`. */
export interface KeycapPartsForRender {
  base: MeshBuffer;
  bubble: MeshBuffer | null;
  legend: MeshBuffer | null;
  stem: MeshBuffer | null;
}

export interface ProjectState {
  nodes: Record<string, SceneNodeState>;
  /** Flat scene-tree order. No parent/group nesting in M2/M3 — the
   *  blueprint's SceneNode.parentId is deliberately deferred until grouping
   *  is an actual requirement; split lineage is tracked via `origin` above
   *  instead of a tree, which is enough for the Object Manager to show
   *  "Part A / Part B (split from Cube)" without forcing a tree UI. */
  order: string[];
}

export function emptyProjectState(): ProjectState {
  return { nodes: {}, order: [] };
}

export function cloneProjectState(state: ProjectState): ProjectState {
  return {
    nodes: { ...state.nodes },
    order: [...state.order],
  };
}
