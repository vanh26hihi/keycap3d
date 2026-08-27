import { describe, expect, it } from "vitest";
import { createCubeMesh } from "../src/primitives/cube.js";
import { computeBoundingBox, computeSignedVolume, triangleCount, vertexCount } from "../src/mesh.js";
import { bufferGeometryToMeshBuffer, meshBufferToBufferGeometry } from "../src/convert/three.js";
import { meshBufferToManifoldMesh, manifoldMeshToMeshBuffer } from "../src/convert/manifold.js";
import { loadBooleanEngine } from "../src/boolean.js";

describe("MeshBuffer <-> THREE.BufferGeometry", () => {
  it("round-trips positions/indices exactly and preserves mm dimensions", () => {
    const mesh = createCubeMesh(18, 18, 10);
    const geometry = meshBufferToBufferGeometry(mesh);
    const back = bufferGeometryToMeshBuffer(geometry);

    expect(vertexCount(back)).toBe(vertexCount(mesh));
    expect(triangleCount(back)).toBe(triangleCount(mesh));
    expect(Array.from(back.positions)).toEqual(Array.from(mesh.positions));
    expect(Array.from(back.indices)).toEqual(Array.from(mesh.indices));

    const box = computeBoundingBox(back);
    expect(box.size[0]).toBeCloseTo(18, 6);
    expect(box.size[1]).toBeCloseTo(18, 6);
    expect(box.size[2]).toBeCloseTo(10, 6);
  });

  it("supplies computed vertex normals when the MeshBuffer has none", () => {
    const mesh = createCubeMesh(10, 10, 10);
    const geometry = meshBufferToBufferGeometry(mesh);
    expect(geometry.getAttribute("normal")).toBeDefined();
  });
});

describe("MeshBuffer <-> manifold-3d Mesh", () => {
  it("round-trips through the real WASM module and preserves volume/mm dimensions", async () => {
    const wasm = await loadBooleanEngine();
    const mesh = createCubeMesh(18, 18, 10);

    const manifoldMesh = meshBufferToManifoldMesh(wasm, mesh);
    const manifold = new wasm.Manifold(manifoldMesh);
    expect(manifold.status()).toBe("NoError");

    const back = manifoldMeshToMeshBuffer(manifold.getMesh());
    manifold.delete();

    const box = computeBoundingBox(back);
    expect(box.size[0]).toBeCloseTo(18, 4);
    expect(box.size[1]).toBeCloseTo(18, 4);
    expect(box.size[2]).toBeCloseTo(10, 4);
    expect(computeSignedVolume(back)).toBeCloseTo(18 * 18 * 10, 0);
  });
});
