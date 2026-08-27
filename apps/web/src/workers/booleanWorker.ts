/**
 * Runs the actual manifold-3d boolean split off the main thread. This is
 * the one place in apps/web allowed to import
 * "@keycap-web/geometry-core/boolean" (the WASM-touching subpath deliberately
 * excluded from the main barrel export -- see geometry-core/src/index.ts) --
 * everything else reaches split functionality through
 * src/lib/splitEngine.ts, which talks to this worker over postMessage.
 */
import { createBooleanEngine } from "@keycap-web/geometry-core/boolean";
import type { MeshBuffer } from "@keycap-web/geometry-core";

const enginePromise = createBooleanEngine();

interface SplitRequest {
  id: number;
  type: "splitByPlane";
  positions: Float32Array;
  indices: Uint32Array;
  normal: [number, number, number];
  offsetMm: number;
}

self.onmessage = async (event: MessageEvent<SplitRequest>) => {
  const { id, type } = event.data;
  if (type !== "splitByPlane") return;

  try {
    const engine = await enginePromise;
    const mesh: MeshBuffer = { positions: event.data.positions, indices: event.data.indices };
    const [partA, partB] = engine.splitByPlane(mesh, event.data.normal, event.data.offsetMm);
    (self as unknown as Worker).postMessage({ id, type: "result", partA, partB }, [
      partA.positions.buffer,
      partA.indices.buffer,
      partB.positions.buffer,
      partB.indices.buffer,
    ]);
  } catch (err) {
    (self as unknown as Worker).postMessage({
      id,
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
