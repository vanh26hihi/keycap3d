import {
  exportNodeAsSTL,
  importSTL,
  checkImportScaleSanity,
  computeBoundingBox,
  boundingBoxMaxDimension,
  composeExportMatrix,
  applyMatrixToMesh,
  exportMultiPart3MF,
  type ThreeMFPart,
} from "@keycap-web/geometry-core";
import { createKeycapMeshParts } from "@keycap-web/geometry-core/keycap";
import type { SceneNodeState } from "../state/types";

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
 * bubble background (if enabled), and legend (if emboss) as SEPARATE
 * objects in one file, so a slicer that opens it (Bambu Studio,
 * OrcaSlicer) shows each as its own colorable part instead of one fused
 * single-color solid. Regenerates the parts from `node.parametric.params`
 * (createKeycapMeshParts, the un-fused sibling of the single-mesh
 * createKeycapMesh the node's own `.mesh` was built from) rather than
 * trying to split `node.mesh` back apart after the fact -- that fusion is
 * a real boolean union, not reversible from the merged triangles alone.
 */
export async function exportKeycapMultiPart3MFBlob(node: SceneNodeState): Promise<Blob> {
  if (!node.parametric) {
    throw new Error("exportKeycapMultiPart3MFBlob: node has no parametric keycap params to rebuild parts from");
  }
  const { base, bubble, legend } = await createKeycapMeshParts(node.parametric.params);
  const matrix = composeExportMatrix(node.designTransform, node.printTransform ?? null);

  const parts: ThreeMFPart[] = [{ name: "Vo keycap", mesh: applyMatrixToMesh(base, matrix) }];
  if (bubble) parts.push({ name: "Nen bong bong chat", mesh: applyMatrixToMesh(bubble, matrix) });
  if (legend) parts.push({ name: "Chu - Icon", mesh: applyMatrixToMesh(legend, matrix) });

  const bytes = exportMultiPart3MF(parts);
  return new Blob([bytes as BlobPart], { type: "model/3mf" });
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
