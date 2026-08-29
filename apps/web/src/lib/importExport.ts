import {
  exportNodeAsSTL,
  exportSTLBinary,
  importSTL,
  checkImportScaleSanity,
  computeBoundingBox,
  boundingBoxMaxDimension,
  composeExportMatrix,
  applyMatrixToMesh,
  applyTransformToMesh,
  mergeMeshes,
  exportMultiPart3MF,
  type MeshBuffer,
  type ThreeMFPart,
} from "@keycap-web/geometry-core";
import {
  createKeycapMesh,
  createKeycapMeshParts,
  resolveKeycapParams,
  stemPlacementOffsetMm,
  type KeycapParams,
} from "@keycap-web/geometry-core/keycap";
import type { ProjectState, SceneNodeState } from "../state/types";
import { findFreePosition, occupiedRectsForProject, type OccupiedRect } from "./placement";

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
 * Re-lays a set of already-generated stem pieces (each still centered on
 * its own keycap's local origin, per stemPlacementOffsetMm) into their own
 * non-overlapping grid, seeded by `occupied` -- shared by every "export
 * several keycaps' worth of stems" path below, so they never overlap the
 * keycaps' own footprints (when `occupied` starts pre-seeded with those)
 * or each other (each placed stem's own rect is folded back into
 * `occupied` before placing the next one, same accumulation pattern
 * BatchCreateDialog already uses to avoid stacking new keycaps on each
 * other). Fixes a real bug: baking each stem at a fixed offset relative to
 * its OWN keycap (see stemPlacementOffsetMm) only clears empty space when
 * that keycap is viewed in isolation -- a dense grid of many keycaps packs
 * them closer together than that offset clears, so naively keeping each
 * stem at its baked-in position makes them overlap their neighbors' shells
 * or stems.
 */
function layoutStemsFreely(
  stems: Array<{ mesh: MeshBuffer; widthMm: number; lengthMm: number }>,
  occupied: OccupiedRect[],
): MeshBuffer[] {
  return stems.map((stem) => {
    const [x, y] = findFreePosition(occupied, stem.widthMm, stem.lengthMm);
    occupied.push({ cx: x, cy: y, w: stem.widthMm, l: stem.lengthMm });
    return applyTransformToMesh(stem.mesh, { position: [x, y, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] });
  });
}

/** Undoes the fixed local offset createKeycapMeshParts' own `stem` bakes
 *  in (see stemPlacementOffsetMm), recentering it on its keycap's own
 *  local origin -- the first half of "pick this stem back up and place it
 *  somewhere that actually has room" (see layoutStemsFreely). */
function recenterStemMesh(stemMesh: MeshBuffer, params: KeycapParams): MeshBuffer {
  const offset = stemPlacementOffsetMm(params);
  return applyTransformToMesh(stemMesh, { position: [-offset.xMm, -offset.yMm, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] });
}

type ExportScope = "shells" | "stems" | "both";

/**
 * Collects every visible node's mesh(es) for a combined STL export, per
 * `scope`: "shells" (keycap bodies only -- for a node with stemSeparate on,
 * regenerated via switchType:"none" so the boss/stem drop out entirely,
 * rather than trying to strip them back out of the already-fused
 * `node.mesh`), "stems" (just the separated stem pieces, freshly laid out
 * in their own grid), or "both" (shells at their own designTransform
 * position, stems laid out in whatever space is left over -- fixing the
 * overlap bug for the combined case too, not just the dedicated
 * stems-only export).
 */
async function collectExportMeshes(project: ProjectState, scope: ExportScope): Promise<MeshBuffer[]> {
  const shells: MeshBuffer[] = [];
  const rawStems: Array<{ mesh: MeshBuffer; widthMm: number; lengthMm: number }> = [];

  for (const id of project.order) {
    const node = project.nodes[id];
    if (!node || !node.visible) continue;
    const matrix = composeExportMatrix(node.designTransform, node.printTransform ?? null);

    if (node.parametric) {
      const params = node.parametric.params;
      if (scope !== "stems") {
        // A keycap without stemSeparate already has its boss fused into
        // node.mesh correctly -- only regenerate (dropping the boss/stem
        // entirely) when stemSeparate actually pulled it out separately.
        const shellMesh = params.stemSeparate ? await createKeycapMesh({ ...params, switchType: "none" }) : node.mesh;
        shells.push(applyMatrixToMesh(shellMesh, matrix));
      }
      if (scope !== "shells" && params.stemSeparate && params.switchType !== "none") {
        const parts = await createKeycapMeshParts(params);
        if (parts.stem) {
          const resolved = resolveKeycapParams(params);
          rawStems.push({ mesh: recenterStemMesh(parts.stem, params), widthMm: resolved.stemPlateWidthMm, lengthMm: resolved.stemPlateLengthMm });
        }
      }
    } else if (scope !== "stems") {
      shells.push(applyMatrixToMesh(node.mesh, matrix));
    }
  }

  const occupied: OccupiedRect[] = scope === "both" ? occupiedRectsForProject(project) : [];
  return [...shells, ...layoutStemsFreely(rawStems, occupied)];
}

/**
 * Exports every VISIBLE node in the scene as ONE combined STL -- "print
 * the whole bed at once" rather than the per-object Export STL button,
 * which only ever exports whichever single node is currently selected.
 * Each node's own designTransform/printTransform is baked into its mesh
 * (same as the single-node export) before merging, so the file's raw
 * triangle coordinates already reflect each object's real position on the
 * bed -- a slicer opening it sees everything laid out exactly as it is in
 * this app's own viewport (except any separated stems, which get freshly
 * laid out in free space -- see collectExportMeshes -- rather than kept at
 * their baked-in, neighbor-overlapping position).
 */
export async function exportAllToSTLBlob(project: ProjectState): Promise<Blob> {
  const merged = mergeMeshes(await collectExportMeshes(project, "both"));
  const buffer = exportSTLBinary(merged, "keycap-bed");
  return new Blob([buffer], { type: "model/stl" });
}

/** Every visible keycap's own body/shell only -- no separated stems at
 *  all, even for keycaps that have one (see KeycapParams.stemSeparate) --
 *  for printing a whole batch of shells on their own, e.g. in a different
 *  material/color pass than the stems. */
export async function exportKeycapsOnlyToSTLBlob(project: ProjectState): Promise<Blob> {
  const merged = mergeMeshes(await collectExportMeshes(project, "shells"));
  const buffer = exportSTLBinary(merged, "keycap-shells");
  return new Blob([buffer], { type: "model/stl" });
}

/** Every visible keycap's separated stem piece (see
 *  KeycapParams.stemSeparate) only -- no shells -- freshly laid out in
 *  their own non-overlapping grid, for printing a whole batch of stems on
 *  their own. */
export async function exportStemsOnlyToSTLBlob(project: ProjectState): Promise<Blob> {
  const merged = mergeMeshes(await collectExportMeshes(project, "stems"));
  const buffer = exportSTLBinary(merged, "keycap-stems");
  return new Blob([buffer], { type: "model/stl" });
}

/**
 * Exports EVERY visible node as one multi-color 3MF -- the "export all"
 * counterpart to exportKeycapMultiPart3MFBlob (which only ever handles the
 * single selected keycap): each keycap's own base/bubble/legend/stem
 * become their own named, colored objects (same per-part coloring), a
 * non-keycap node becomes one plain object, and every stem gets freshly
 * laid out in free space (see collectExportMeshes's identical rationale)
 * so a dense grid of many keycaps doesn't produce overlapping stems.
 */
export async function exportAllMultiPart3MFBlob(project: ProjectState): Promise<Blob> {
  const parts: ThreeMFPart[] = [];
  const rawStems: Array<{ mesh: MeshBuffer; widthMm: number; lengthMm: number; colorHex: string; label: string }> = [];
  let counter = 0;

  for (const id of project.order) {
    const node = project.nodes[id];
    if (!node || !node.visible) continue;
    counter++;
    const matrix = composeExportMatrix(node.designTransform, node.printTransform ?? null);
    const label = node.name || `Object ${counter}`;

    if (node.parametric) {
      const params = node.parametric.params;
      const { base, bubble, legend, stem } = await createKeycapMeshParts(params);
      parts.push({ name: `${label} - Vo`, mesh: applyMatrixToMesh(base, matrix), colorHex: params.baseColorHex });
      if (bubble) parts.push({ name: `${label} - Bong bong`, mesh: applyMatrixToMesh(bubble, matrix), colorHex: params.bubbleColorHex });
      if (legend) parts.push({ name: `${label} - Chu`, mesh: applyMatrixToMesh(legend, matrix), colorHex: params.legendColorHex });
      if (stem) {
        const resolved = resolveKeycapParams(params);
        rawStems.push({
          mesh: recenterStemMesh(stem, params),
          widthMm: resolved.stemPlateWidthMm,
          lengthMm: resolved.stemPlateLengthMm,
          colorHex: params.stemColorHex,
          label: `${label} - Chot`,
        });
      }
    } else {
      parts.push({ name: label, mesh: applyMatrixToMesh(node.mesh, matrix) });
    }
  }

  if (parts.length === 0 && rawStems.length === 0) {
    throw new Error("exportAllMultiPart3MFBlob: no visible objects to export");
  }

  const occupied = occupiedRectsForProject(project);
  const placedStems = layoutStemsFreely(rawStems, occupied);
  rawStems.forEach((stem, i) => parts.push({ name: stem.label, mesh: placedStems[i], colorHex: stem.colorHex }));

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
