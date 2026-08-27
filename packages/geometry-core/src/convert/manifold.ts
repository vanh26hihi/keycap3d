import type { Mesh as ManifoldMesh, ManifoldToplevel } from "manifold-3d";
import type { MeshBuffer } from "../mesh";

/**
 * geometry-core -> manifold-3d input `Mesh`. We always hand manifold-3d
 * `numProp: 3` (position-only, no interpolated normals/UVs as vertex
 * properties) — this package's boolean use case is pure solid CSG, not
 * multi-material rendering, so there is nothing else to carry through the
 * WASM boundary. `Mesh`'s own constructor requires >=3 numProp position
 * channels first regardless, so this matches manifold-3d's own convention.
 */
export function meshBufferToManifoldMesh(
  wasm: Pick<ManifoldToplevel, "Mesh">,
  mesh: MeshBuffer,
): ManifoldMesh {
  return new wasm.Mesh({
    numProp: 3,
    vertProperties: mesh.positions,
    triVerts: mesh.indices,
  });
}

/**
 * manifold-3d output `Mesh` -> geometry-core. `Manifold.getMesh()` always
 * returns per-vertex position at property channels [0,1,2] regardless of
 * numProp (see manifold-3d docs), so we only ever read the first 3 of each
 * vertex's property block and drop the rest — correct for our position-only
 * pipeline, and future-proof if a later feature starts requesting extra
 * property channels (e.g. baked normals) from manifold.
 */
export function manifoldMeshToMeshBuffer(mesh: ManifoldMesh): MeshBuffer {
  const numProp = mesh.numProp;
  const indices = new Uint32Array(mesh.triVerts);
  if (numProp === 3) {
    return { positions: new Float32Array(mesh.vertProperties), indices };
  }
  const vertCount = mesh.vertProperties.length / numProp;
  const positions = new Float32Array(vertCount * 3);
  for (let i = 0; i < vertCount; i++) {
    positions[i * 3] = mesh.vertProperties[i * numProp];
    positions[i * 3 + 1] = mesh.vertProperties[i * numProp + 1];
    positions[i * 3 + 2] = mesh.vertProperties[i * numProp + 2];
  }
  return { positions, indices };
}
