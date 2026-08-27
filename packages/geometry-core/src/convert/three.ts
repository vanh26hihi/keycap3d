import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute } from "three";
import type { MeshBuffer } from "../mesh";

/**
 * geometry-core -> three.js. Used by the R3F viewport to render a MeshBuffer.
 * Copies data in (three owns its own typed arrays) rather than aliasing, so
 * mutating the source MeshBuffer later can't silently corrupt a live
 * BufferGeometry already uploaded to the GPU.
 */
export function meshBufferToBufferGeometry(mesh: MeshBuffer): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(mesh.positions.slice(), 3));
  geometry.setIndex(new Uint32BufferAttribute(mesh.indices.slice(), 1));
  if (mesh.normals) {
    geometry.setAttribute("normal", new Float32BufferAttribute(mesh.normals.slice(), 3));
  } else {
    geometry.computeVertexNormals();
  }
  return geometry;
}

/**
 * three.js -> geometry-core. Accepts both indexed and non-indexed geometries
 * (TransformControls-adjacent code and importers sometimes hand back
 * non-indexed geometry); non-indexed input gets a trivial sequential index,
 * which is correct but means downstream code (validate/weldVertices) still
 * has to weld before treating it as topologically indexed.
 */
export function bufferGeometryToMeshBuffer(geometry: BufferGeometry): MeshBuffer {
  const positionAttr = geometry.getAttribute("position");
  if (!positionAttr) {
    throw new Error("bufferGeometryToMeshBuffer: geometry has no 'position' attribute");
  }
  const positions = new Float32Array(positionAttr.array as ArrayLike<number>);

  let indices: Uint32Array;
  if (geometry.index) {
    indices = new Uint32Array(geometry.index.array as ArrayLike<number>);
  } else {
    const vertCount = positions.length / 3;
    indices = new Uint32Array(vertCount);
    for (let i = 0; i < vertCount; i++) indices[i] = i;
  }

  const normalAttr = geometry.getAttribute("normal");
  const normals = normalAttr ? new Float32Array(normalAttr.array as ArrayLike<number>) : undefined;

  return { positions, indices, normals };
}
