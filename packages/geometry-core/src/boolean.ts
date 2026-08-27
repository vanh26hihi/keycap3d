import ManifoldModule from "manifold-3d";
import type { Manifold as ManifoldInstance, ManifoldToplevel } from "manifold-3d";
import type { MeshBuffer } from "./mesh";
import { meshBufferToManifoldMesh, manifoldMeshToMeshBuffer } from "./convert/manifold";

let wasmPromise: Promise<ManifoldToplevel> | null = null;

/**
 * Lazily loads and initializes the manifold-3d WASM module (idempotent —
 * safe to call from multiple call sites, the underlying module is loaded
 * once and cached). This is the single entry point the rest of the app
 * should use to reach the Boolean Engine; nothing else should import
 * "manifold-3d" directly.
 */
export function loadBooleanEngine(): Promise<ManifoldToplevel> {
  if (!wasmPromise) {
    wasmPromise = ManifoldModule().then((wasm) => {
      wasm.setup();
      return wasm;
    });
  }
  return wasmPromise;
}

export class ManifoldStatusError extends Error {
  constructor(public readonly status: string, context: string) {
    super(`manifold-3d reported status "${status}" while ${context}. The input mesh is not a valid solid (commonly: not closed/watertight, self-intersecting, or has degenerate triangles) — fix the source mesh rather than suppressing this, since a boolean result built on an invalid operand cannot be trusted for printing.`);
    this.name = "ManifoldStatusError";
  }
}

function toManifold(wasm: ManifoldToplevel, mesh: MeshBuffer, context: string): ManifoldInstance {
  const manifoldMesh = meshBufferToManifoldMesh(wasm, mesh);
  const manifold = new wasm.Manifold(manifoldMesh);
  const status = manifold.status();
  if (status !== "NoError") {
    manifold.delete();
    throw new ManifoldStatusError(status, context);
  }
  return manifold;
}

export interface BooleanEngine {
  union(a: MeshBuffer, b: MeshBuffer): MeshBuffer;
  subtract(a: MeshBuffer, b: MeshBuffer): MeshBuffer;
  intersect(a: MeshBuffer, b: MeshBuffer): MeshBuffer;
  /**
   * Splits `mesh` by an infinite plane (`normal . x = originOffsetMm`).
   * Returns `[aboveOrOn, below]` matching manifold-3d's `splitByPlane`
   * convention (positive side first). Both parts are independently manifold
   * and share exactly the cut cross-section as a new capped face — this is
   * the M3 proof-of-concept "Model -> Boolean Split -> Part A + Part B" path.
   */
  splitByPlane(mesh: MeshBuffer, normal: [number, number, number], originOffsetMm: number): [MeshBuffer, MeshBuffer];
  volumeMm3(mesh: MeshBuffer): number;
}

/**
 * Synchronous-looking engine built on an already-loaded wasm module. Get one
 * via `createBooleanEngine()` (async, loads the module once).
 */
function buildEngine(wasm: ManifoldToplevel): BooleanEngine {
  return {
    union(a, b) {
      const ma = toManifold(wasm, a, "computing union (operand A)");
      const mb = toManifold(wasm, b, "computing union (operand B)");
      const result = wasm.Manifold.union(ma, mb);
      const out = manifoldMeshToMeshBuffer(result.getMesh());
      ma.delete();
      mb.delete();
      result.delete();
      return out;
    },
    subtract(a, b) {
      const ma = toManifold(wasm, a, "computing subtract (operand A)");
      const mb = toManifold(wasm, b, "computing subtract (operand B)");
      const result = wasm.Manifold.difference(ma, mb);
      const out = manifoldMeshToMeshBuffer(result.getMesh());
      ma.delete();
      mb.delete();
      result.delete();
      return out;
    },
    intersect(a, b) {
      const ma = toManifold(wasm, a, "computing intersect (operand A)");
      const mb = toManifold(wasm, b, "computing intersect (operand B)");
      const result = wasm.Manifold.intersection(ma, mb);
      const out = manifoldMeshToMeshBuffer(result.getMesh());
      ma.delete();
      mb.delete();
      result.delete();
      return out;
    },
    splitByPlane(mesh, normal, originOffsetMm) {
      const m = toManifold(wasm, mesh, "splitting by plane");
      const [aboveOrOn, below] = m.splitByPlane(normal, originOffsetMm);
      const outA = manifoldMeshToMeshBuffer(aboveOrOn.getMesh());
      const outB = manifoldMeshToMeshBuffer(below.getMesh());
      m.delete();
      aboveOrOn.delete();
      below.delete();
      return [outA, outB];
    },
    volumeMm3(mesh) {
      const m = toManifold(wasm, mesh, "computing volume");
      const v = m.volume();
      m.delete();
      return v;
    },
  };
}

let enginePromise: Promise<BooleanEngine> | null = null;

export function createBooleanEngine(): Promise<BooleanEngine> {
  if (!enginePromise) {
    enginePromise = loadBooleanEngine().then(buildEngine);
  }
  return enginePromise;
}
