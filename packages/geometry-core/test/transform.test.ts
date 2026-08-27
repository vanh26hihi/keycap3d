import { describe, expect, it } from "vitest";
import { createCubeMesh } from "../src/primitives/cube.js";
import { computeBoundingBox, computeCentroid } from "../src/mesh.js";
import {
  applyTransformToMesh,
  composeExportMatrix,
  applyMatrixToMesh,
  transformToMatrix4,
  matrix4ToTransform,
  type Transform,
  type PrintTransform,
} from "../src/transform.js";

describe("designTransform", () => {
  it("translation moves the bounding box by exactly the mm offset", () => {
    const mesh = createCubeMesh(18, 18, 10);
    const t: Transform = { position: [100, -50, 5], rotationDeg: [0, 0, 0], scale: [1, 1, 1] };
    const moved = applyTransformToMesh(mesh, t);
    const box = computeBoundingBox(moved);
    expect(box.min).toEqual([91, -59, 0]);
    expect(box.max).toEqual([109, -41, 10]);
    // size is unchanged by pure translation
    expect(box.size[0]).toBeCloseTo(18, 6);
    expect(box.size[1]).toBeCloseTo(18, 6);
    expect(box.size[2]).toBeCloseTo(10, 6);
  });

  it("90deg rotation about Z swaps X/Y footprint as expected", () => {
    const mesh = createCubeMesh(20, 10, 5); // 20 wide (X), 10 deep (Y)
    const t: Transform = { position: [0, 0, 0], rotationDeg: [0, 0, 90], scale: [1, 1, 1] };
    const rotated = applyTransformToMesh(mesh, t);
    const box = computeBoundingBox(rotated);
    expect(box.size[0]).toBeCloseTo(10, 4);
    expect(box.size[1]).toBeCloseTo(20, 4);
    expect(box.size[2]).toBeCloseTo(5, 4);
  });

  it("scale multiplies bounding box size by the scale factor (mm-for-mm)", () => {
    const mesh = createCubeMesh(18, 18, 10);
    const t: Transform = { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [2, 1, 1] };
    const scaled = applyTransformToMesh(mesh, t);
    const box = computeBoundingBox(scaled);
    expect(box.size[0]).toBeCloseTo(36, 6);
    expect(box.size[1]).toBeCloseTo(18, 6);
    expect(box.size[2]).toBeCloseTo(10, 6);
  });

  it("combined translate+rotate+scale matches a hand-computed centroid", () => {
    const mesh = createCubeMesh(10, 10, 10); // centroid at origin before transform
    const t: Transform = { position: [5, 5, 5], rotationDeg: [0, 0, 45], scale: [1, 1, 1] };
    const transformed = applyTransformToMesh(mesh, t);
    const centroid = computeCentroid(transformed);
    // rotation about origin doesn't move the (already-zero) centroid; translation does
    expect(centroid[0]).toBeCloseTo(5, 4);
    expect(centroid[1]).toBeCloseTo(5, 4);
    expect(centroid[2]).toBeCloseTo(5, 4);
  });
});

describe("designTransform vs printTransform composition", () => {
  it("printTransform is applied on top of designTransform, not in place of it", () => {
    const mesh = createCubeMesh(10, 10, 10);
    const design: Transform = { position: [50, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] };
    const print: PrintTransform = { position: [0, 0, 25], rotationDeg: [0, 0, 0] };
    const matrix = composeExportMatrix(design, print);
    const baked = applyMatrixToMesh(mesh, matrix);
    const centroid = computeCentroid(baked);
    // design places it at x=50, print then adds z=25 on top
    expect(centroid[0]).toBeCloseTo(50, 4);
    expect(centroid[1]).toBeCloseTo(0, 4);
    expect(centroid[2]).toBeCloseTo(25, 4);
  });

  it("omitting printTransform is equivalent to identity print transform", () => {
    const mesh = createCubeMesh(10, 10, 10);
    const design: Transform = { position: [3, 4, 5], rotationDeg: [10, 0, 0], scale: [1, 1, 1] };
    const withNull = applyMatrixToMesh(mesh, composeExportMatrix(design, null));
    const withoutArg = applyTransformToMesh(mesh, design);
    expect(Array.from(withNull.positions)).toEqual(Array.from(withoutArg.positions));
  });

  it("printTransform never scales — only position/rotation reach the export matrix", () => {
    const mesh = createCubeMesh(10, 10, 10);
    const design: Transform = { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [3, 3, 3] };
    const print: PrintTransform = { position: [0, 0, 0], rotationDeg: [0, 0, 0] };
    const matrix = composeExportMatrix(design, print);
    const baked = applyMatrixToMesh(mesh, matrix);
    const box = computeBoundingBox(baked);
    // design scale of 3x must still take effect; print has no scale field to interfere
    expect(box.size[0]).toBeCloseTo(30, 4);
  });
});

describe("matrix4ToTransform: the inverse of transformToMatrix4", () => {
  it("round-trips an arbitrary transform through matrix4ToTransform(transformToMatrix4(t))", () => {
    const t: Transform = { position: [12.5, -3, 40], rotationDeg: [15, -30, 60], scale: [1.5, 2, 0.75] };
    const roundTripped = matrix4ToTransform(transformToMatrix4(t));
    for (let i = 0; i < 3; i++) {
      expect(roundTripped.position[i]).toBeCloseTo(t.position[i], 6);
      expect(roundTripped.rotationDeg[i]).toBeCloseTo(t.rotationDeg[i], 4);
      expect(roundTripped.scale[i]).toBeCloseTo(t.scale[i], 6);
    }
  });

  it("round-trips the identity transform", () => {
    const t: Transform = { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] };
    const roundTripped = matrix4ToTransform(transformToMatrix4(t));
    expect(roundTripped.position).toEqual([0, 0, 0]);
    expect(roundTripped.rotationDeg[0]).toBeCloseTo(0, 6);
    expect(roundTripped.rotationDeg[1]).toBeCloseTo(0, 6);
    expect(roundTripped.rotationDeg[2]).toBeCloseTo(0, 6);
    expect(roundTripped.scale).toEqual([1, 1, 1]);
  });

  it("composing a delta matrix with a node's own matrix moves it by the delta -- the technique the group gizmo relies on", () => {
    // Simulates: pivot moves by [10, 5, 0], a node offset from the pivot
    // should end up shifted by the same delta, keeping its own rotation.
    const nodeTransform: Transform = { position: [3, 4, 0], rotationDeg: [0, 0, 45], scale: [1, 1, 1] };
    const deltaTransform: Transform = { position: [10, 5, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] };
    const nodeMatrix = transformToMatrix4(nodeTransform);
    const deltaMatrix = transformToMatrix4(deltaTransform);
    const result = matrix4ToTransform(deltaMatrix.clone().multiply(nodeMatrix));
    expect(result.position[0]).toBeCloseTo(13, 6);
    expect(result.position[1]).toBeCloseTo(9, 6);
    expect(result.position[2]).toBeCloseTo(0, 6);
    expect(result.rotationDeg[2]).toBeCloseTo(45, 4); // rotation preserved, delta had none
  });
});
