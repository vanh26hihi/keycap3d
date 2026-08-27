# @keycap-web/geometry-core

Pure TypeScript geometry pipeline for the keycap/clicker 3D tool. No React,
no DOM, no rendering — everything here is unit-testable under plain Node
(Vitest). This is the `geometry-core` package described in the project's
architecture blueprint (M0/M1 scope only; no UI, no keycap/clicker
generators, no auto-segment/curve-cut yet).

## Status: M0 + M1 complete

- **M0 — Geometry Foundation**: unit convention, internal `MeshBuffer`
  representation, Three.js/manifold-3d conversion, design/print transform
  split, dimension/bbox/transform tests.
- **M1 — STL Round-trip**: binary+ASCII STL import/export with baked
  transforms, round-trip tests for cube/cylinder/transformed objects, and a
  boolean-split proof of concept (split → export parts → reimport → verify
  they still line up and reassemble).

Run everything:

```bash
npm test -w packages/geometry-core        # 35 tests, all passing
npx tsx packages/geometry-core/scripts/generate-fixtures.ts   # writes real .stl files
```

## Unit convention

**1 world/scene unit = 1 millimeter, everywhere, always.** See `src/units.ts`.
No module in this package ever multiplies a value by an implicit scale
factor. STL import does not auto-scale either — STL has no unit metadata, and
the 3D-printing ecosystem's convention is to treat raw coordinates as mm, so
we follow that convention rather than guessing. `checkImportScaleSanity()`
only flags implausible bounding boxes (e.g. <1mm or >1000mm across) for the
caller to surface as a warning; it never silently corrects them.

## Internal mesh representation

```ts
interface MeshBuffer {
  positions: Float32Array; // flat [x,y,z, x,y,z, ...] in millimeters
  indices: Uint32Array;    // triangle indices, length % 3 === 0
  normals?: Float32Array;  // optional, same layout as positions
}
```

This shape was chosen because it's structurally close to both
`THREE.BufferGeometry` (`position`/`index`/`normal` attributes) and
manifold-3d's `Mesh` (`vertProperties`/`triVerts`), so the conversions in
`src/convert/` are close to a straight copy, not a re-derivation.

- `src/convert/three.ts` — `MeshBuffer <-> THREE.BufferGeometry`
- `src/convert/manifold.ts` — `MeshBuffer <-> manifold-3d Mesh`

Winding convention: outward-facing / right-hand rule, i.e. for a triangle
`(a,b,c)`, `(b-a) x (c-a)` points away from the solid's interior. A closed
mesh with correct winding has positive signed volume
(`computeSignedVolume`) — every primitive in `src/primitives/` was derived
and verified against this.

## Transforms: design vs. print

```ts
interface Transform {       // designTransform
  position: [number, number, number];   // mm
  rotationDeg: [number, number, number];
  scale: [number, number, number];
}
interface PrintTransform {  // no scale, deliberately
  position: [number, number, number];
  rotationDeg: [number, number, number];
}
```

`designTransform` is the source of truth for how a part relates to the rest
of the model — it's what makes split parts reassemble correctly.
`printTransform` is an optional reorientation applied **on top of**
`designTransform`, only at STL export time (`M = PrintMatrix * DesignMatrix`
in `composeExportMatrix`), so a user can lay a part flat on the print bed
without disturbing the assembly relationship recorded in `designTransform`.
Printing must never rescale a part, which is why `PrintTransform` has no
`scale` field at all — not zeroed out, structurally absent.

## STL I/O

`src/stl.ts` implements binary + ASCII STL reading/writing directly (no
`three/examples/jsm` STL loader/exporter) so we have exact control over unit
handling and transform baking:

- `exportSTLBinary(mesh)` — serializes a mesh already in the coordinate space
  you want on disk. Recomputes true per-facet normals from triangle winding
  (STL stores one normal per facet, not per vertex).
- `exportNodeAsSTL(mesh, design, print)` — composes
  design+print transforms into one matrix and bakes it into vertex positions
  before writing, so the file's raw coordinates are already correct without
  any external transform.
- `parseSTL(buffer)` — sniffs binary vs. ASCII by checking whether the file's
  byte length matches the binary header's declared triangle count
  (`80 + 4 + n*50`), which is robust against binary files whose 80-byte
  header text happens to start with `"solid"` (a known footgun with the
  naive "starts with solid = ASCII" heuristic).
- `importSTL(buffer)` — `parseSTL` + `weldVertices` (default epsilon
  `1e-5mm`), turning STL's inherently unindexed format (each triangle
  repeats its own vertex copies) into an indexed mesh with real shared
  topology, which manifold validation and boolean ops depend on.

## Mesh validation

`src/validate.ts` checks, purely from mesh topology (no manifold-3d
dependency, so it also works on meshes you don't intend to boolean):

- open edges (boundary, mesh not closed)
- non-manifold edges (shared by 3+ triangles)
- inconsistent winding (an edge shared by exactly 2 triangles that both
  traverse it in the same direction, instead of opposite directions)
- degenerate (zero-area) triangles
- duplicate triangles
- signed volume

`isWatertight` is the bar used for "safe to boolean / safe to print".

## Boolean engine

`src/boolean.ts` wraps [manifold-3d](https://github.com/elalish/manifold)
(WASM), chosen over OpenCascade.js (heavier BRep kernel, unnecessary for
triangle-mesh CSG) and older three.js CSG libraries (BSP-based, prone to
producing non-manifold output). Every operand is validated
(`Manifold.status()`) before use — a non-`NoError` status throws
`ManifoldStatusError` with an explanation, never a silent fallback.

`splitByPlane` is the M3 proof-of-concept path exercised in
`test/split.test.ts`: split a world-positioned model by a plane, export both
halves independently (no recentering), reimport them, and confirm they (a)
are each independently watertight, (b) reconstruct the original bounding box
when loaded together with no extra offset, and (c) re-union back to the
original volume.

## Known limitations (read before relying on this in M2+)

1. **STL is lossy by the format's own design.** manifold-3d's own docs
   explicitly warn against using STL for exactly this reason: it carries no
   topology, only a flat triangle soup, so "manifoldness" after import is
   reconstructed by our `weldVertices` epsilon-merge, not guaranteed by the
   file format itself. This package's round-trip tests confirm our own
   export→import path preserves manifoldness for the shapes we generate; a
   third-party STL authored by other software may need a larger weld
   epsilon or exhibit missed welds. If a future milestone needs guaranteed
   lossless topology (e.g. multi-material, precise re-import of previously
   split parts for further editing), reconsider 3MF as the internal project
   file format and keep STL as an export-only target — this was explicitly
   flagged by the library authors, not discovered by us.
2. **`weldVertices` uses grid-cell spatial hashing, not true nearest-neighbor
   search.** Two points within epsilon of each other but on opposite sides
   of a grid cell boundary will not be merged. Acceptable for STL
   export/import round-trips (coincident or float-noise-level differences
   only) but not a general-purpose mesh-repair weld.
3. **`applyMatrixToMesh` does not detect mirroring (negative-determinant)
   transforms.** No path in this package's `Transform` type (position +
   rotation + positive scale) can currently produce one, so it's unreachable
   today — flag this again before exposing arbitrary/negative scale in the
   UI, since a mirrored transform flips winding and would silently produce
   inward-facing normals.
4. **Cylinder is a polygon approximation.** `createCylinderMesh`'s vertices
   sit exactly on the nominal radius, so the bounding box is exact, but the
   enclosed volume is very slightly less than a true cylinder
   (`cos(pi/radialSegments)` factor — ~0.05% at the default 32 segments).
   Documented in the source; irrelevant next to FDM printer tolerance but
   would matter for a precision (SLA/CNC) use case.
5. **No STL-in-a-real-slicer automation.** Everything above is verified by
   this package's own export→import round-trip, which proves internal
   consistency but can't prove Bambu Studio/OrcaSlicer/PrusaSlicer agrees.
   `scripts/generate-fixtures.ts` writes real `.stl` files to
   `fixtures/manual-verification/` for a one-time manual check — see that
   folder's README for exactly what to look for. This has **not yet been
   manually verified against a real slicer** as of this writing; treat M1 as
   code-complete and self-consistent, not yet slicer-confirmed.
