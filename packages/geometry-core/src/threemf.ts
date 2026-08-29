import type { MeshBuffer } from "./mesh";
import { buildZip } from "./zip";

/** One printable part in a multi-part 3MF export -- `name` is what shows up
 *  in the slicer's object list, so the user knows which part to assign
 *  which filament/AMS slot to. `colorHex` (e.g. "#RRGGBB"), if given, is
 *  embedded as that object's own base-material color via the 3MF core
 *  spec's <basematerials> resource -- a slicer opening the file (Bambu
 *  Studio, OrcaSlicer) shows/pre-assigns that color for the object
 *  directly, instead of every part defaulting to whatever the slicer
 *  itself picks and the user reassigning each one by hand. */
export interface ThreeMFPart {
  name: string;
  mesh: MeshBuffer;
  colorHex?: string;
}

function escapeXmlAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function meshToObjectXml(mesh: MeshBuffer, id: number, name: string, materialRef: string): string {
  const vertexLines: string[] = [];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    vertexLines.push(
      `<vertex x="${mesh.positions[i]}" y="${mesh.positions[i + 1]}" z="${mesh.positions[i + 2]}"/>`,
    );
  }
  const triangleLines: string[] = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    triangleLines.push(
      `<triangle v1="${mesh.indices[i]}" v2="${mesh.indices[i + 1]}" v3="${mesh.indices[i + 2]}"/>`,
    );
  }
  return (
    `<object id="${id}" type="model" name="${escapeXmlAttr(name)}"${materialRef}><mesh>` +
    `<vertices>${vertexLines.join("")}</vertices>` +
    `<triangles>${triangleLines.join("")}</triangles>` +
    `</mesh></object>`
  );
}

/** Normalizes a color to the 3MF core spec's `displaycolor` format: 6 or 8
 *  hex digits after '#' (RRGGBB or RRGGBBAA), uppercase, always with the
 *  leading '#'. Accepts "#rgb", "#rrggbb", bare (no '#') hex, with or
 *  without an alpha pair already present -- callers pass whatever a plain
 *  HTML `<input type="color">` or a hand-typed hex string gives. */
function normalizeDisplayColor(colorHex: string): string {
  let hex = colorHex.trim().replace(/^#/, "");
  if (hex.length === 3) {
    hex = hex.split("").map((c) => c + c).join("");
  }
  if (hex.length === 6) hex += "FF";
  return `#${hex.toUpperCase()}`;
}

/**
 * Builds a 3MF file (as raw bytes, ready to write/download) containing
 * multiple separate objects, all placed at the identity transform -- i.e.
 * occupying exactly the same coordinate space they were generated in, so
 * they line up correctly when opened together (this is what makes them
 * work as "the same physical part, different colors" rather than
 * independent objects the user has to manually reposition).
 *
 * This is deliberately a minimal, single-purpose 3MF writer covering just
 * the 3D Manufacturing Format core spec (vertices/triangles/objects/build
 * items, plus <basematerials> for per-object color when a part supplies
 * `colorHex`) -- enough for a slicer like Bambu Studio/OrcaSlicer to open
 * the file, show each part as a separately-colorable object, and
 * pre-assign the requested color/material for it, not a general 3MF
 * library (no textures, no metadata beyond the object name). Slicer-side
 * filament/AMS *slot* assignment still happens in the slicer's own UI --
 * that binding (which physical spool goes in which AMS bay) isn't part of
 * the 3MF spec at all -- but the color itself now travels with the file
 * instead of needing to be picked again by hand every time.
 */
export function exportMultiPart3MF(parts: ThreeMFPart[]): Uint8Array {
  if (parts.length === 0) {
    throw new Error("exportMultiPart3MF: at least one part is required");
  }

  // One shared <basematerials> group holding every colored part's color,
  // in part order -- each such part's <object> then references its own
  // color by index into this same group via pid/pindex. Parts with no
  // colorHex get no pid/pindex at all (the slicer's own default applies),
  // so the whole resource is omitted if nothing supplied a color.
  const coloredIndices = parts.map((p, i) => (p.colorHex ? i : -1)).filter((i) => i >= 0);
  const BASEMATERIALS_ID = 1000; // well above any object id (parts.length is always small)
  const pindexOf = new Map<number, number>(coloredIndices.map((partIndex, materialIndex) => [partIndex, materialIndex]));

  const basematerialsXml =
    coloredIndices.length > 0
      ? `<basematerials id="${BASEMATERIALS_ID}">` +
        coloredIndices
          .map((i) => `<base name="${escapeXmlAttr(parts[i].name)}" displaycolor="${normalizeDisplayColor(parts[i].colorHex!)}"/>`)
          .join("") +
        `</basematerials>`
      : "";

  const objectsXml = parts
    .map((part, i) => {
      const pindex = pindexOf.get(i);
      const materialRef = pindex !== undefined ? ` pid="${BASEMATERIALS_ID}" pindex="${pindex}"` : "";
      return meshToObjectXml(part.mesh, i + 1, part.name, materialRef);
    })
    .join("");
  const buildItemsXml = parts.map((_, i) => `<item objectid="${i + 1}"/>`).join("");

  const modelXml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">` +
    `<resources>${basematerialsXml}${objectsXml}</resources>` +
    `<build>${buildItemsXml}</build>` +
    `</model>`;

  const contentTypesXml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>` +
    `</Types>`;

  const relsXml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>` +
    `</Relationships>`;

  const encoder = new TextEncoder();
  return buildZip([
    { name: "[Content_Types].xml", data: encoder.encode(contentTypesXml) },
    { name: "_rels/.rels", data: encoder.encode(relsXml) },
    { name: "3D/3dmodel.model", data: encoder.encode(modelXml) },
  ]);
}
