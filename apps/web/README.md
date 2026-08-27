# @keycap-web/web

Next.js + React Three Fiber editor. Current scope: M0-M3 (basic 3D editor +
plane-split mesh split MVP). No keycap/clicker generators, no auto-segment/
curve-cut, no backend/accounts, no UI polish beyond what usability requires
-- all explicitly out of scope per the M3 brief.

## Status: M3 complete

Run everything:

```bash
npm test -w apps/web              # 18 tests (store + split), all passing
npm run dev -w apps/web           # editor at http://localhost:3000
```

## Architecture

- `src/state/types.ts` -- `SceneNodeState`/`ProjectState`: a flat (no
  parent/group nesting) list of nodes, each wrapping a raw `MeshBuffer` from
  geometry-core plus a `designTransform`/`printTransform` pair. Each node
  also carries `origin` (`{kind:"primitive"|"import"|"split", ...}`,
  recording split lineage) and forward-compat `assemblyId`/`role` fields for
  M5's multi-switch/assembly work (`V I E T A N H` -> 7 switch nodes sharing
  one assembly) -- both always `null` today, unused by any M3 code path, but
  present so M5 doesn't have to migrate the SceneNodeState shape.
- `src/state/commands.ts` -- command-pattern `do`/`undo` pairs, including
  `splitCommand`: replaces one source node with two part nodes atomically
  (Apply Split = exactly one undo step; undo restores the source node at its
  original position in `order`, byte-for-byte; redo re-applies the exact
  same part objects rather than recomputing).
- `src/state/store.ts` -- zustand store. Beyond M2's transform/undo state:
  `splitSession` (target node id + cutting-plane position/rotation + gizmo
  mode), `splitStatus`/`splitError` (idle/processing/success/error),
  `isolatedNodeId` (Object Manager "Isolate"), and `applySplit()` -- the
  async action that bakes the target's designTransform into a working mesh,
  computes the cut plane's normal/offset from the plane's rotation, calls
  the Boolean Engine (`src/lib/splitEngine.ts`), validates the result, and
  either commits a `splitCommand` or reports an error leaving the original
  untouched.
- `src/lib/splitEngine.ts` -- the one place that knows how to reach the
  Boolean Engine. In a browser, spins up `src/workers/booleanWorker.ts` (a
  real Web Worker) and talks to it over `postMessage` with transferable
  ArrayBuffers, so the manifold-3d boolean never runs on the UI thread.
  Falls back to calling `@keycap-web/geometry-core/boolean` directly on the
  calling thread when `Worker` is undefined (Node/Vitest, or a Worker-less
  browser) -- both paths call the exact same geometry-core Boolean Engine,
  so store-level tests exercise real split logic without mocking a Worker.
- `src/workers/booleanWorker.ts` -- the only other place (besides
  splitEngine's fallback) allowed to import
  `@keycap-web/geometry-core/boolean`, the WASM-touching subpath
  deliberately excluded from geometry-core's main barrel so the M2 editor
  bundle never pulled in manifold-3d before it was needed.
- `src/components/Viewport.tsx` -- R3F canvas. `SceneNodeMesh` renders one
  node's mesh and, when selected, a `TransformControls` gizmo *co-located in
  the same component* (not looked up from a sibling by name -- see "Gizmo
  attachment" below for why that matters). `SplitPlaneGizmo` renders the
  semi-transparent cutting plane and its own `TransformControls` during a
  split session; the target node's own gizmo is suppressed while a session
  is active so only one gizmo is ever interactive at a time.
- `src/components/SplitPanel.tsx` -- replaces `TransformPanel` in the right
  column while a split session is open: plane Position/Rotation fields,
  Move/Rotate gizmo-mode toggle, Center to Object, Reset, live
  idle/processing/success/error status, Cancel, Apply Split.
- `src/components/SceneTreePanel.tsx` / `TransformPanel.tsx` / `Toolbar.tsx`
  -- Object Manager (select/rename/hide/isolate/duplicate/delete, a "split"
  badge on part nodes) and the numeric transform + mesh-info
  (triangles/watertight/volume) panel.

All components read/write exclusively through the store -- no component
holds its own copy of geometry, transform, or split-session state.

## Gizmo attachment: the two real bugs behind the current design

`TransformControls` is rendered **inside the same component that owns its
target `<group>`**, as a **sibling** of that group (not a child, not looked
up from a different component). This shape is load-bearing, not a style
choice -- it's the fix for two real, reproduced-in-browser bugs:

1. An earlier design looked up the target object via
   `scene.getObjectByName(selectedId)` from a separate sibling component.
   That lookup could run before the newly-selected node's own group had
   actually been added to the scene (a cross-component mount-order race,
   not guaranteed by React across independent siblings), and once it
   resolved to `null` the effect had no reason to ever run again -- the
   gizmo just never appeared. Fixed by rendering it in the same component,
   using a `useState` callback ref (not `useRef`) so `TransformControls`
   only ever receives a *real* `Object3D`, never a ref that might still be
   `null` when drei's own attach effect runs.
2. Nesting `<TransformControls>` as a **child** of the group it controls
   causes infinite recursion (`Group.updateMatrixWorld()` recurses into its
   children, one of which calls `this.object.updateMatrixWorld()` on that
   same parent) -- "Maximum call stack size exceeded" on every frame. Fixed
   by rendering it as a sibling instead.

Both were found and fixed via direct browser instrumentation (scene-graph
traversal, render counters, stack traces), not by reasoning alone -- see git
history / prior session notes for the full investigation.

## Known limitations

1. **No project persistence.** Reloading the page loses all scene state
   (that's M7). The `window.__editorStore` dev-only global
   (`NODE_ENV !== "production"`) exists purely for debugging/manual console
   testing, not as a persistence mechanism.
2. **Flat scene tree, no groups/assembly UI yet.** `origin`/`assemblyId`/
   `role` on `SceneNodeState` are forward-compat data only -- no M3 UI reads
   or writes `assemblyId`/`role`. Split lineage (`origin.kind === "split"`)
   is surfaced today only as a small badge + "split from" info line, not a
   tree.
3. **Vitest exercises the Node fallback path in `splitEngine.ts`, not the
   real browser Worker.** This is not a hypothetical gap: a real bug
   (`applySplit` computed the pre-split volume-conservation check *after*
   `splitByPlane` had already transferred/detached the working mesh's
   ArrayBuffers to the Worker, so the check always read a 0-length buffer
   and reported "volume not conserved" on every real split) passed all
   store tests cleanly and only surfaced during manual browser testing,
   because the Node fallback path never transfers buffers. Fixed by
   computing the pre-split volume before calling `splitByPlane`, with a
   comment explaining why the ordering matters. Flagging this explicitly:
   **the Worker transfer path is not covered by any automated test** and
   needs a human to re-verify after any future change to `applySplit` or
   `splitEngine.ts`, not just a green `npm test`.
4. **No true "preview the two halves" before Apply.** The brief allowed
   this ("có thể làm nổi bật 2 phía... nếu hợp lý về hiệu năng") --
   skipped for M3: only the cutting plane itself is shown pre-Apply, not a
   live-updated preview of the two resulting solids (that would mean
   running the boolean on every plane-drag frame, which defeats the point
   of doing it in a Worker to avoid janky per-frame cost).
5. **Cylinder polygon approximation** (documented since M0/M1) still
   applies to any node built from `createCylinderMesh` -- irrelevant to
   plane split correctness, just carried over.
