import { Euler, Matrix3, Matrix4, Quaternion, Vector3, MathUtils } from "three";
import type { MeshBuffer } from "./mesh";

/**
 * A transform in millimeters/degrees. Rotation is Euler XYZ, applied in the
 * conventional intrinsic order used by three.js (`Euler` default 'XYZ').
 */
export interface Transform {
  position: [number, number, number];
  rotationDeg: [number, number, number];
  scale: [number, number, number];
}

/**
 * A print-only reorientation (lay flat on the bed, etc). No scale: printing
 * must never rescale a part, only reposition/reorient it.
 */
export interface PrintTransform {
  position: [number, number, number];
  rotationDeg: [number, number, number];
}

export const IDENTITY_TRANSFORM: Transform = {
  position: [0, 0, 0],
  rotationDeg: [0, 0, 0],
  scale: [1, 1, 1],
};

export function cloneTransform(t: Transform): Transform {
  return {
    position: [...t.position],
    rotationDeg: [...t.rotationDeg],
    scale: [...t.scale],
  };
}

export function transformToMatrix4(t: Transform): Matrix4 {
  const euler = new Euler(
    MathUtils.degToRad(t.rotationDeg[0]),
    MathUtils.degToRad(t.rotationDeg[1]),
    MathUtils.degToRad(t.rotationDeg[2]),
    "XYZ",
  );
  const quaternion = new Quaternion().setFromEuler(euler);
  const matrix = new Matrix4();
  matrix.compose(
    new Vector3(...t.position),
    quaternion,
    new Vector3(...t.scale),
  );
  return matrix;
}

/**
 * The inverse of `transformToMatrix4` -- decomposes a matrix back into a
 * position/rotationDeg/scale Transform. Used by the multi-select group
 * gizmo (Viewport.tsx): each selected node's new world matrix is computed
 * by composing a drag-delta matrix with that node's own matrix at drag
 * start, and the result needs to go back into the store's Transform shape.
 */
export function matrix4ToTransform(matrix: Matrix4): Transform {
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  matrix.decompose(position, quaternion, scale);
  const euler = new Euler().setFromQuaternion(quaternion, "XYZ");
  return {
    position: [position.x, position.y, position.z],
    rotationDeg: [MathUtils.radToDeg(euler.x), MathUtils.radToDeg(euler.y), MathUtils.radToDeg(euler.z)],
    scale: [scale.x, scale.y, scale.z],
  };
}

export function printTransformToMatrix4(t: PrintTransform): Matrix4 {
  return transformToMatrix4({ position: t.position, rotationDeg: t.rotationDeg, scale: [1, 1, 1] });
}

/**
 * The matrix baked into an STL export: the print transform (if any) is
 * applied on top of the design transform — `M = PrintMatrix * DesignMatrix`.
 * `designTransform` alone is the source of truth for how parts relate to
 * each other (assembly fit); `printTransform` only exists to let a user
 * reorient an individual part for the printer bed without disturbing that
 * relationship. See geometry-core README / SceneNode data model.
 */
export function composeExportMatrix(design: Transform, print?: PrintTransform | null): Matrix4 {
  const designMatrix = transformToMatrix4(design);
  if (!print) return designMatrix;
  const printMatrix = printTransformToMatrix4(print);
  return printMatrix.multiply(designMatrix);
}

/**
 * Bakes a matrix into mesh positions (and normals, via the inverse-transpose
 * normal matrix) and returns a new MeshBuffer. Used at STL export time so the
 * file's raw triangle coordinates already carry the object's world transform
 * — a slicer reading the file needs no external transform to see correct mm.
 *
 * Limitation: does not detect or correct a negative-determinant (mirroring)
 * matrix, which would flip triangle winding and invert normals relative to
 * the mesh's outward-facing convention. None of the transforms produced by
 * this package's UI-facing Transform type (position/rotation/positive scale)
 * can produce a negative determinant, so this is not reachable from M0/M1
 * scope; flag it if arbitrary/negative scale is exposed later.
 */
export function applyMatrixToMesh(mesh: MeshBuffer, matrix: Matrix4): MeshBuffer {
  const positions = new Float32Array(mesh.positions.length);
  const v = new Vector3();
  for (let i = 0; i < mesh.positions.length; i += 3) {
    v.set(mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]);
    v.applyMatrix4(matrix);
    positions[i] = v.x;
    positions[i + 1] = v.y;
    positions[i + 2] = v.z;
  }

  let normals: Float32Array | undefined;
  if (mesh.normals) {
    const normalMatrix = new Matrix3().getNormalMatrix(matrix);
    normals = new Float32Array(mesh.normals.length);
    const nv = new Vector3();
    for (let i = 0; i < mesh.normals.length; i += 3) {
      nv.set(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]);
      nv.applyMatrix3(normalMatrix).normalize();
      normals[i] = nv.x;
      normals[i + 1] = nv.y;
      normals[i + 2] = nv.z;
    }
  }

  return { positions, indices: mesh.indices.slice(), normals };
}

export function applyTransformToMesh(mesh: MeshBuffer, transform: Transform): MeshBuffer {
  return applyMatrixToMesh(mesh, transformToMatrix4(transform));
}
