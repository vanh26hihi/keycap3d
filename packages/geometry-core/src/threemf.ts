import type { MeshBuffer } from "./mesh";
import { buildZip } from "./zip";

/** One printable part in a multi-part 3MF export -- `name` is what shows up
 *  in the slicer's object list, so the user knows which part to assign
 *  which filament/AMS slot to. */
export interface ThreeMFPart {
  name: string;
  mesh: MeshBuffer;
}

function escapeXmlAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function meshToObjectXml(mesh: MeshBuffer, id: number, name: string): string {
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
    `<object id="${id}" type="model" name="${escapeXmlAttr(name)}"><mesh>` +
    `<vertices>${vertexLines.join("")}</vertices>` +
    `<triangles>${triangleLines.join("")}</triangles>` +
    `</mesh></object>`
  );
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
 * items) -- enough for a slicer like Bambu Studio/OrcaSlicer to open the
 * file and show each part as a separately-colorable object, not a general
 * 3MF library (no color/material extensions, no metadata, no textures).
 * Filament/AMS color assignment itself still happens in the slicer's own
 * UI per object -- a 3MF's core spec doesn't carry that binding, and each
 * slicer's own color/AMS extension schema is a moving target not worth
 * chasing for this.
 */
export function exportMultiPart3MF(parts: ThreeMFPart[]): Uint8Array {
  if (parts.length === 0) {
    throw new Error("exportMultiPart3MF: at least one part is required");
  }

  const objectsXml = parts.map((part, i) => meshToObjectXml(part.mesh, i + 1, part.name)).join("");
  const buildItemsXml = parts.map((_, i) => `<item objectid="${i + 1}"/>`).join("");

  const modelXml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">` +
    `<resources>${objectsXml}</resources>` +
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
