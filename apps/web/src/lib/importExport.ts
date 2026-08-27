import { exportNodeAsSTL, importSTL, checkImportScaleSanity, computeBoundingBox, boundingBoxMaxDimension } from "@keycap-web/geometry-core";
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
