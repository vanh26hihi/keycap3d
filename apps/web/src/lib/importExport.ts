import {
  exportNodeAsSTL,
  exportSTLBinary,
  importSTL,
  checkImportScaleSanity,
  computeBoundingBox,
  boundingBoxMaxDimension,
  composeExportMatrix,
  applyMatrixToMesh,
  mergeMeshes,
  exportMultiPart3MF,
  type ThreeMFPart,
} from "@keycap-web/geometry-core";
import { createKeycapMeshParts } from "@keycap-web/geometry-core/keycap";
import type { ProjectState, SceneNodeState } from "../state/types";

export interface ImportResult {
  mesh: ReturnType<typeof importSTL>;
  warning: string | null;
}

export function importSTLFile(buffer: ArrayBuffer): ImportResult {
  const mesh = importSTL(buffer);
  const box = computeBoundingBox(mesh);
  const sanity = checkImportScaleSanity(boundingBoxMaxDimension(box));
  return { mesh, warning: sanity.suspicious ? sanity.reason : null };
}

export function exportNodeToSTLBlob(node: SceneNodeState): Blob {
  const buffer = exportNodeAsSTL(node.mesh, node.designTransform, node.printTransform, node.name);
  return new Blob([buffer], { type: "model/stl" });
}

/**
 * Exports a parametric keycap node as a multi-object 3MF -- base shell,
 * bubble background (if enabled), legend (if emboss), and the separated
 * stem/socket piece (if stemSeparate is on) as SEPARATE objects in one
 * file, so a slicer that opens it (Bambu Studio, OrcaSlicer) shows each as
 * its own colorable part instead of one fused single-color solid.
 * Regenerates the parts from `node.parametric.params` (createKeycapMeshParts,
 * the un-fused sibling of the single-mesh createKeycapMesh the node's own
 * `.mesh` was built from) rather than trying to split `node.mesh` back
 * apart after the fact -- that fusion is a real boolean union, not
 * reversible from the merged triangles alone.
 */
export async function exportKeycapMultiPart3MFBlob(node: SceneNodeState): Promise<Blob> {
  if (!node.parametric) {
    throw new Error("exportKeycapMultiPart3MFBlob: node has no parametric keycap params to rebuild parts from");
  }
  const { base, bubble, legend, stem } = await createKeycapMeshParts(node.parametric.params);
  const matrix = composeExportMatrix(node.designTransform, node.printTransform ?? null);
  const colors = node.parametric.params;

  const parts: ThreeMFPart[] = [{ name: "Vo keycap", mesh: applyMatrixToMesh(base, matrix), colorHex: colors.baseColorHex }];
  if (bubble) parts.push({ name: "Nen bong bong chat", mesh: applyMatrixToMesh(bubble, matrix), colorHex: colors.bubbleColorHex });
  if (legend) parts.push({ name: "Chu - Icon", mesh: applyMatrixToMesh(legend, matrix), colorHex: colors.legendColorHex });
  if (stem) parts.push({ name: "Chot roi", mesh: applyMatrixToMesh(stem, matrix), colorHex: colors.stemColorHex });

  const bytes = exportMultiPart3MF(parts);
  return new Blob([bytes as BlobPart], { type: "model/3mf" });
}

/**
 * Exports every VISIBLE node in the scene as ONE combined STL -- "print
 * the whole bed at once" rather than the per-object Export STL button,
 * which only ever exports whichever single node is currently selected.
 * Each node's own designTransform/printTransform is baked into its mesh
 * (same as the single-node export) before merging, so the file's raw
 * triangle coordinates already reflect each object's real position on the
 * bed -- a slicer opening it sees everything laid out exactly as it is in
 * this app's own viewport, no manual repositioning needed.
 */
export function exportAllToSTLBlob(project: ProjectState): Blob {
  const bakedMeshes = project.order
    .map((id) => project.nodes[id])
    .filter((node): node is SceneNodeState => !!node && node.visible)
    .map((node) => {
      const matrix = composeExportMatrix(node.designTransform, node.printTransform ?? null);
      return applyMatrixToMesh(node.mesh, matrix);
    });
  const merged = mergeMeshes(bakedMeshes);
  const buffer = exportSTLBinary(merged, "keycap-bed");
  return new Blob([buffer], { type: "model/stl" });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
