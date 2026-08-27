import { Euler, Vector3 } from "three";
import type { MeshBuffer } from "@keycap-web/geometry-core";

export interface PlaneSplitResult {
  partA: MeshBuffer;
  partB: MeshBuffer;
}

/** The cutting plane's local +Z axis, rotated -- matches how the plane mesh
 *  is oriented in the viewport (a PlaneGeometry's face normal is +Z). */
export function planeNormalFromRotationDeg(rotationDeg: [number, number, number]): [number, number, number] {
  const euler = new Euler(
    (rotationDeg[0] * Math.PI) / 180,
    (rotationDeg[1] * Math.PI) / 180,
    (rotationDeg[2] * Math.PI) / 180,
    "XYZ",
  );
  const v = new Vector3(0, 0, 1).applyEuler(euler);
  return [v.x, v.y, v.z];
}

type PendingEntry = { resolve: (r: PlaneSplitResult) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let nextRequestId = 0;
const pending = new Map<number, PendingEntry>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("../workers/booleanWorker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent) => {
    const { id, type } = event.data as { id: number; type: string };
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (type === "result") {
      const { partA, partB } = event.data as { partA: MeshBuffer; partB: MeshBuffer };
      entry.resolve({ partA, partB });
    } else {
      entry.reject(new Error((event.data as { message: string }).message));
    }
  };
  worker.onerror = (event: ErrorEvent) => {
    // A worker-level error (e.g. failed to load/instantiate) can't be
    // correlated to one request id -- reject everything still pending
    // rather than leaving callers hanging forever.
    const err = new Error(`Boolean worker error: ${event.message}`);
    for (const entry of pending.values()) entry.reject(err);
    pending.clear();
  };
  return worker;
}

/**
 * Splits `mesh` by the plane `normal . x = offsetMm`, running the actual
 * manifold-3d boolean off the main thread in a Web Worker so the UI never
 * freezes during Apply Split. Falls back to computing directly on this
 * thread when `Worker` isn't available (Node/Vitest, or a browser without
 * Worker support) -- both paths call the exact same geometry-core Boolean
 * Engine underneath, so correctness is identical between them; only
 * concurrency differs. This fallback is also what makes store-level tests
 * exercise real split logic without needing to mock a browser Worker.
 */
export async function splitByPlane(
  mesh: MeshBuffer,
  normal: [number, number, number],
  offsetMm: number,
): Promise<PlaneSplitResult> {
  if (typeof Worker === "undefined") {
    const { createBooleanEngine } = await import("@keycap-web/geometry-core/boolean");
    const engine = await createBooleanEngine();
    const [partA, partB] = engine.splitByPlane(mesh, normal, offsetMm);
    return { partA, partB };
  }

  return new Promise<PlaneSplitResult>((resolve, reject) => {
    const id = ++nextRequestId;
    pending.set(id, { resolve, reject });
    const w = getWorker();
    w.postMessage(
      { id, type: "splitByPlane", positions: mesh.positions, indices: mesh.indices, normal, offsetMm },
      [mesh.positions.buffer, mesh.indices.buffer],
    );
  });
}
