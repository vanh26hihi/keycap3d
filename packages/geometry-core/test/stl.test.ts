import { describe, expect, it } from "vitest";
import { createCubeMesh } from "../src/primitives/cube.js";
import { createCylinderMesh } from "../src/primitives/cylinder.js";
import {
  computeBoundingBox,
  computeCentroid,
  computeSignedVolume,
  triangleCount,
} from "../src/mesh.js";
import { exportNodeAsSTL, exportSTLBinary, importSTL, parseSTL } from "../src/stl.js";
import { validateMesh } from "../src/validate.js";
import type { Transform } from "../src/transform.js";

describe("STL round-trip: Generate -> Export -> Import -> Recalculate bbox -> Compare", () => {
  it("cube 18x18x10mm survives export/import with exact mm dimensions", () => {
    const original = createCubeMesh(18, 18, 10);
    const originalBox = computeBoundingBox(original);

    const stlBuffer = exportSTLBinary(original, "cube_18x18x10");
    const imported = importSTL(stlBuffer);
    const importedBox = computeBoundingBox(imported);

    expect(importedBox.size[0]).toBeCloseTo(originalBox.size[0], 5);
    expect(importedBox.size[1]).toBeCloseTo(originalBox.size[1], 5);
    expect(importedBox.size[2]).toBeCloseTo(originalBox.size[2], 5);
    expect(importedBox.size[0]).toBeCloseTo(18, 5);
    expect(importedBox.size[1]).toBeCloseTo(18, 5);
    expect(importedBox.size[2]).toBeCloseTo(10, 5);
    expect(importedBox.min).toEqual(originalBox.min);
    expect(importedBox.max).toEqual(originalBox.max);

    // topology survives: welding reconstructs the same watertight solid
    const report = validateMesh(imported);
    expect(report.isWatertight).toBe(true);
    expect(triangleCount(imported)).toBe(triangleCount(original));
  });

  it("cylinder d14mm survives export/import with exact mm dimensions", () => {
    const original = createCylinderMesh(14, 20, 48);
    const originalBox = computeBoundingBox(original);

    const stlBuffer = exportSTLBinary(original, "cylinder_d14");
    const imported = importSTL(stlBuffer);
    const importedBox = computeBoundingBox(imported);

    expect(importedBox.size[0]).toBeCloseTo(14, 5);
    expect(importedBox.size[1]).toBeCloseTo(14, 5);
    expect(importedBox.size[2]).toBeCloseTo(20, 5);
    expect(importedBox.min).toEqual(originalBox.min);
    expect(importedBox.max).toEqual(originalBox.max);

    const report = validateMesh(imported);
    expect(report.isWatertight).toBe(true);
  });

  it("an object with translate+rotate bakes its transform into the exported file, not just metadata", () => {
    const local = createCubeMesh(18, 18, 10);
    const design: Transform = { position: [37.5, -12, 8], rotationDeg: [0, 0, 30], scale: [1, 1, 1] };

    const stlBuffer = exportNodeAsSTL(local, design, null, "translated_rotated_cube");
    const imported = importSTL(stlBuffer);

    const centroid = computeCentroid(imported);
    expect(centroid[0]).toBeCloseTo(37.5, 4);
    expect(centroid[1]).toBeCloseTo(-12, 4);
    expect(centroid[2]).toBeCloseTo(8, 4);

    // a 30deg rotation about Z on a square footprint (18x18) widens the XY bounding box
    // to 18*(cos30+sin30) = 18*1.366 ~= 24.59mm -- confirms rotation was actually baked in,
    // not merely translated.
    const box = computeBoundingBox(imported);
    const expectedFootprint = 18 * (Math.cos(Math.PI / 6) + Math.sin(Math.PI / 6));
    expect(box.size[0]).toBeCloseTo(expectedFootprint, 2);
    expect(box.size[1]).toBeCloseTo(expectedFootprint, 2);
    expect(box.size[2]).toBeCloseTo(10, 4); // height untouched by a Z rotation

    expect(validateMesh(imported).isWatertight).toBe(true);
  });

  it("does not scale: a 1.0 unit value in geometry-core stays exactly 1.0mm after round-trip (no implicit unit conversion anywhere)", () => {
    const mesh = createCubeMesh(1, 1, 1);
    const imported = importSTL(exportSTLBinary(mesh));
    const box = computeBoundingBox(imported);
    expect(box.size[0]).toBeCloseTo(1, 5);
    expect(box.size[1]).toBeCloseTo(1, 5);
    expect(box.size[2]).toBeCloseTo(1, 5);
  });

  it("preserves volume through export/import (sanity check independent of bbox)", () => {
    const original = createCylinderMesh(14, 20, 48);
    const imported = importSTL(exportSTLBinary(original));
    expect(computeSignedVolume(imported)).toBeCloseTo(computeSignedVolume(original), 1);
  });
});

describe("STL facet normals", () => {
  it("exported facet normal matches the triangle's actual winding-derived normal (not a stale/vertex normal)", () => {
    const mesh = createCubeMesh(10, 10, 10);
    const buffer = exportSTLBinary(mesh);
    const reparsed = parseSTL(buffer); // unwelded: one normal triplet per vertex, duplicated per facet

    for (let t = 0; t < triangleCount(reparsed); t++) {
      const ia = reparsed.indices[t * 3] * 3;
      const ib = reparsed.indices[t * 3 + 1] * 3;
      const ic = reparsed.indices[t * 3 + 2] * 3;
      const ax = reparsed.positions[ia], ay = reparsed.positions[ia + 1], az = reparsed.positions[ia + 2];
      const bx = reparsed.positions[ib], by = reparsed.positions[ib + 1], bz = reparsed.positions[ib + 2];
      const cx = reparsed.positions[ic], cy = reparsed.positions[ic + 1], cz = reparsed.positions[ic + 2];
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;

      const fileNx = reparsed.normals![ia], fileNy = reparsed.normals![ia + 1], fileNz = reparsed.normals![ia + 2];
      expect(fileNx).toBeCloseTo(nx, 4);
      expect(fileNy).toBeCloseTo(ny, 4);
      expect(fileNz).toBeCloseTo(nz, 4);
    }
  });
});

describe("STL binary/ASCII sniffing", () => {
  it("treats a binary file whose 80-byte header text happens to start with 'solid' as binary, not ASCII", () => {
    const mesh = createCubeMesh(5, 5, 5);
    // deliberately name it starting with "solid " to try to fool a naive text-based sniffer
    const buffer = exportSTLBinary(mesh, "solid this-is-actually-binary");
    const imported = importSTL(buffer);
    expect(computeBoundingBox(imported).size[0]).toBeCloseTo(5, 5);
  });

  it("parses a hand-written ASCII STL correctly", () => {
    const ascii = `solid manual
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 0 1 0
  endloop
endfacet
endsolid manual
`;
    const buffer = new TextEncoder().encode(ascii).buffer;
    const mesh = parseSTL(buffer);
    expect(triangleCount(mesh)).toBe(1);
    expect(Array.from(mesh.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });
});
