"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { GizmoHelper, GizmoViewport, OrbitControls, TransformControls } from "@react-three/drei";
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Matrix4, PlaneGeometry, Vector3, type Group } from "three";
import {
  meshBufferToBufferGeometry,
  transformToMatrix4,
  matrix4ToTransform,
  computeBoundingBox,
  type Transform,
} from "@keycap-web/geometry-core";
import { useEditorStore } from "../state/store";
import { PRINT_BED_WIDTH_MM, PRINT_BED_DEPTH_MM } from "../lib/printBed";

function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}
function radToDeg(r: number): number {
  return (r * 180) / Math.PI;
}

/**
 * TransformControls lives directly inside the component that renders its
 * target `<group>`, as a SIBLING of that group (not a child of it -- nesting
 * it inside would parent the gizmo's own meshes under the object it
 * controls, and `Group.updateMatrixWorld()` recursing into a child that
 * calls `this.object.updateMatrixWorld()` on that same parent is a direct
 * update cycle: infinite recursion, "Maximum call stack size exceeded").
 *
 * The group ref is a `useState` callback ref, not `useRef`: passing a plain
 * `RefObject` to drei's `object` prop is unsafe, because drei attaches via
 * `controls.attach(object.current)` inside a `useLayoutEffect` with no
 * guarantee (in R3F's custom reconciler) that the ref has been populated by
 * then. If it runs early, `controls.attach(null)` sets three-stdlib's
 * internal `this.object = null` -- and its own `updateMatrixWorld` only
 * guards `this.object !== undefined`, not `!== null`, so it crashes every
 * frame afterward. A callback ref sidesteps this: React only ever calls it
 * with the real instance (or null on unmount), so `group` (state) is either
 * a real `Object3D` or null, and `<TransformControls>` is only rendered once
 * it's real.
 */
function SceneNodeMesh({ id }: { id: string }) {
  // Subscribes directly to this one node, independent of the parent
  // Viewport's `order` subscription -- zustand notifies each subscribed
  // component on its own, so on the render right after a node is removed,
  // this component can still re-render (with `node` now undefined) *before*
  // its parent has re-rendered to stop including it in `order.map(...)`.
  // Must tolerate that single in-between render rather than assume `node`
  // is always defined; the component un-mounts cleanly on the very next
  // parent render regardless.
  const node = useEditorStore((s) => s.project.nodes[id]);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const select = useEditorStore((s) => s.select);
  const toggleSelect = useEditorStore((s) => s.toggleSelect);
  const transformMode = useEditorStore((s) => s.transformMode);
  const updateDirect = useEditorStore((s) => s.updateNodeTransformDirect);
  const commit = useEditorStore((s) => s.commitTransform);
  const setDraggingNode = useEditorStore((s) => s.setDraggingNode);
  const isolatedNodeId = useEditorStore((s) => s.isolatedNodeId);
  // Only the split plane gizmo should be interactive during a split session
  // -- suppress every node's own TransformControls while one is active,
  // regardless of which node is selected, to avoid two gizmos fighting for
  // the same pointer input.
  const splitActive = useEditorStore((s) => s.splitSession !== null);

  const [group, setGroup] = useState<Group | null>(null);
  const dragStartTransform = useRef<Transform | null>(null);

  const isSelected = selectedIds.includes(id);
  // While this node is being actively dragged, TransformControls owns its
  // Object3D's position/rotation/scale exclusively. If we keep passing them
  // as declarative props here, R3F re-applies (.set()s) them on every single
  // store update this same drag produces (onObjectChange fires every
  // pointermove), which fights TransformControls' internal drag-delta
  // bookkeeping. Passing `undefined` makes R3F skip setting that prop
  // entirely, leaving the object fully in TransformControls' hands until
  // the drag ends.
  const isDragging = useEditorStore((s) => s.draggingNodeId === id || s.draggingGroupIds.includes(id));

  const geometry = useMemo(() => (node ? meshBufferToBufferGeometry(node.mesh) : null), [node]);
  // Per-part geometries (see KeycapPartsForRender) -- only meaningful for a
  // keycap whose bubble/legend/stem actually exist as separate volumes
  // (an emboss legend, a bubble background, a separated stem); an engraved
  // legend has no material of its own to color (it's a hole cut into
  // `base`, not a volume), so it stays folded into `parts.base` same as
  // the single fused mesh, and simply isn't independently colorable here
  // either -- physically correct, not a gap in this rendering.
  const partGeometries = useMemo(() => {
    const parts = node?.parametric?.parts;
    if (!parts) return null;
    return {
      base: meshBufferToBufferGeometry(parts.base),
      bubble: parts.bubble ? meshBufferToBufferGeometry(parts.bubble) : null,
      legend: parts.legend ? meshBufferToBufferGeometry(parts.legend) : null,
      stem: parts.stem ? meshBufferToBufferGeometry(parts.stem) : null,
    };
  }, [node]);

  if (!node || !node.visible || !geometry) return null;
  if (isolatedNodeId && isolatedNodeId !== id) return null;

  const keycapParams = node.parametric?.params;
  const showParts = !!(partGeometries && keycapParams && (partGeometries.bubble || partGeometries.legend || partGeometries.stem));
  const emissive = isSelected ? "#3a5a8c" : "#000000";
  const emissiveIntensity = isSelected ? 0.35 : 0;

  return (
    <>
      <group
        ref={setGroup}
        name={id}
        position={isDragging ? undefined : node.designTransform.position}
        rotation={
          isDragging
            ? undefined
            : [
                degToRad(node.designTransform.rotationDeg[0]),
                degToRad(node.designTransform.rotationDeg[1]),
                degToRad(node.designTransform.rotationDeg[2]),
              ]
        }
        scale={isDragging ? undefined : node.designTransform.scale}
        onClick={(e) => {
          e.stopPropagation();
          if (e.ctrlKey || e.metaKey || e.shiftKey) toggleSelect(id);
          else select(id);
        }}
      >
        {/* flatShading throughout: this is CAD/mechanical geometry -- sharp
            edges everywhere (letter/icon relief, boss walls, keycap
            bevels), not an organic smooth-curved model. Without it,
            meshBufferToBufferGeometry's fallback computeVertexNormals()
            averages face normals across every SHARED vertex, including
            ones that sit on a genuine hard edge between two very
            differently-angled faces (e.g. a glyph's flat top meeting its
            vertical side wall) -- producing garbage blended normals that
            render as a jagged/crumpled mess under lighting, especially
            visible on small sharp-cornered features like embossed
            letters. flatShading derives each triangle's normal directly
            in the fragment shader instead, matching how any slicer (which
            only ever reads face-derived normals from an STL, never vertex
            normals) already renders the exact same mesh correctly. */}
        {showParts && keycapParams ? (
          <>
            <mesh geometry={partGeometries!.base}>
              <meshStandardMaterial color={keycapParams.baseColorHex} emissive={emissive} emissiveIntensity={emissiveIntensity} flatShading />
            </mesh>
            {partGeometries!.bubble && (
              <mesh geometry={partGeometries!.bubble}>
                <meshStandardMaterial color={keycapParams.bubbleColorHex} emissive={emissive} emissiveIntensity={emissiveIntensity} flatShading />
              </mesh>
            )}
            {partGeometries!.legend && (
              <mesh geometry={partGeometries!.legend}>
                <meshStandardMaterial color={keycapParams.legendColorHex} emissive={emissive} emissiveIntensity={emissiveIntensity} flatShading />
              </mesh>
            )}
            {partGeometries!.stem && (
              <mesh geometry={partGeometries!.stem}>
                <meshStandardMaterial color={keycapParams.stemColorHex} emissive={emissive} emissiveIntensity={emissiveIntensity} flatShading />
              </mesh>
            )}
          </>
        ) : (
          <mesh geometry={geometry}>
            <meshStandardMaterial color={node.color} emissive={emissive} emissiveIntensity={emissiveIntensity} flatShading />
          </mesh>
        )}
      </group>
      {isSelected && selectedIds.length === 1 && group && !splitActive && (
        <TransformControls
          object={group}
          mode={transformMode}
          onMouseDown={() => {
            dragStartTransform.current = node.designTransform;
            setDraggingNode(id);
          }}
          onObjectChange={() => {
            const t: Transform = {
              position: [group.position.x, group.position.y, group.position.z],
              rotationDeg: [radToDeg(group.rotation.x), radToDeg(group.rotation.y), radToDeg(group.rotation.z)],
              scale: [group.scale.x, group.scale.y, group.scale.z],
            };
            updateDirect(id, t);
          }}
          onMouseUp={() => {
            if (dragStartTransform.current) {
              commit(id, dragStartTransform.current);
              dragStartTransform.current = null;
            }
            setDraggingNode(null);
          }}
        />
      )}
    </>
  );
}

/**
 * Multi-select group move/rotate/scale: renders one TransformControls
 * attached to an invisible pivot group (centroid of the selected nodes'
 * own positions) instead of any one node's own group -- moving/rotating
 * the pivot recomputes each selected node's own transform via a delta
 * matrix (composing the pivot's drag-start-to-current delta with each
 * node's OWN matrix at drag start), which is what actually keeps every
 * object's position relative to the others -- an approach that works
 * identically for translate/rotate/scale since it's just matrix
 * composition, not bespoke math per gizmo mode.
 *
 * Deliberately does NOT reparent objects in three's scene graph (the more
 * "obvious" way to get free composition from three.js itself): R3F owns
 * the declarative scene graph, and imperatively reattaching nodes mid-drag
 * while React also re-renders that same structure is a correctness
 * minefield this matrix approach sidesteps entirely.
 */
function MultiSelectGizmo() {
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const nodes = useEditorStore((s) => s.project.nodes);
  const transformMode = useEditorStore((s) => s.transformMode);
  const updateDirect = useEditorStore((s) => s.updateNodeTransformDirect);
  const commitBatch = useEditorStore((s) => s.commitBatchTransform);
  const setDraggingGroup = useEditorStore((s) => s.setDraggingGroup);
  const splitActive = useEditorStore((s) => s.splitSession !== null);

  const [pivotGroup, setPivotGroup] = useState<Group | null>(null);
  const dragStart = useRef<{
    pivotMatrixInverse: Matrix4;
    nodeMatrices: Map<string, Matrix4>;
    prevTransforms: Map<string, Transform>;
  } | null>(null);

  const selectedNodes = selectedIds.map((id) => nodes[id]).filter((n): n is NonNullable<typeof n> => !!n);

  if (selectedNodes.length < 2 || splitActive) return null;

  // Pivot = centroid of the selected nodes' own positions, computed fresh
  // every render -- EXCEPT while actively dragging, where the pivot
  // group's own live position/rotation/scale (as TransformControls is
  // setting it every frame) must be left alone, the same
  // don't-fight-the-gizmo reason SceneNodeMesh skips its declarative props
  // during a single-node drag.
  const isDragging = dragStart.current !== null;
  const pivotPosition: [number, number, number] = selectedNodes
    .reduce(
      (acc, n) => [acc[0] + n.designTransform.position[0], acc[1] + n.designTransform.position[1], acc[2] + n.designTransform.position[2]] as [
        number,
        number,
        number,
      ],
      [0, 0, 0] as [number, number, number],
    )
    .map((sum) => sum / selectedNodes.length) as [number, number, number];

  return (
    <>
      <group ref={setPivotGroup} position={isDragging ? undefined : pivotPosition} />
      {pivotGroup && (
        <TransformControls
          object={pivotGroup}
          mode={transformMode}
          onMouseDown={() => {
            const pivotMatrix = new Matrix4().compose(pivotGroup.position, pivotGroup.quaternion, pivotGroup.scale);
            const nodeMatrices = new Map<string, Matrix4>();
            const prevTransforms = new Map<string, Transform>();
            for (const n of selectedNodes) {
              nodeMatrices.set(n.id, transformToMatrix4(n.designTransform));
              prevTransforms.set(n.id, n.designTransform);
            }
            dragStart.current = { pivotMatrixInverse: pivotMatrix.clone().invert(), nodeMatrices, prevTransforms };
            setDraggingGroup(selectedNodes.map((n) => n.id));
          }}
          onObjectChange={() => {
            if (!dragStart.current) return;
            const currentPivotMatrix = new Matrix4().compose(pivotGroup.position, pivotGroup.quaternion, pivotGroup.scale);
            const deltaMatrix = currentPivotMatrix.clone().multiply(dragStart.current.pivotMatrixInverse);
            for (const [nodeId, nodeMatrixAtStart] of dragStart.current.nodeMatrices) {
              const newMatrix = deltaMatrix.clone().multiply(nodeMatrixAtStart);
              updateDirect(nodeId, matrix4ToTransform(newMatrix));
            }
          }}
          onMouseUp={() => {
            if (dragStart.current) {
              const updates = Array.from(dragStart.current.prevTransforms.entries()).map(([id, prev]) => ({ id, prev }));
              commitBatch(updates);
              dragStart.current = null;
            }
            setDraggingGroup([]);
          }}
        />
      )}
    </>
  );
}

export interface MarqueeRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Drag-select (marquee): Shift+left-drag on empty canvas space draws a
 * screen-space rectangle; every visible node whose world-space bounding box
 * overlaps that rectangle (once projected to screen space via the current
 * camera) gets selected on release. Runs as a component INSIDE <Canvas> so
 * it can read the live camera/renderer-size via useThree(), but the visible
 * rectangle overlay itself is plain DOM (R3F only renders three.js objects
 * inside the canvas) -- so this component only tracks pointer state and
 * hands the current rect up to the parent Viewport via `onRectChange`,
 * which owns the actual overlay <div>.
 *
 * Listens on `gl.domElement` (the real <canvas> DOM node) directly with
 * native addEventListener rather than React's onPointerDown/etc props,
 * because OrbitControls attaches its own native listeners to that same
 * element -- disabling `controlsRef.current.enabled` for the duration of
 * the drag (rather than e.g. stopPropagation) is what actually prevents
 * OrbitControls from also rotating the camera on the same drag.
 */
function MarqueeSelect({
  controlsRef,
  onRectChange,
}: {
  controlsRef: React.RefObject<{ enabled: boolean } | null>;
  onRectChange: (rect: MarqueeRect | null) => void;
}) {
  const { camera, gl, size } = useThree();
  const nodes = useEditorStore((s) => s.project.nodes);
  const order = useEditorStore((s) => s.project.order);
  const selectMany = useEditorStore((s) => s.selectMany);
  const dragging = useRef<MarqueeRect | null>(null);

  useEffect(() => {
    const dom = gl.domElement;

    const toLocal = (e: PointerEvent) => {
      const r = dom.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const p = toLocal(e);
      const rect: MarqueeRect = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      dragging.current = rect;
      if (controlsRef.current) controlsRef.current.enabled = false;
      onRectChange(rect);
      dom.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      e.preventDefault();
      e.stopPropagation();
      const p = toLocal(e);
      const rect = { ...dragging.current, x1: p.x, y1: p.y };
      dragging.current = rect;
      onRectChange(rect);
    };

    const onPointerUp = (e: PointerEvent) => {
      const rect = dragging.current;
      if (!rect) return;
      e.preventDefault();
      e.stopPropagation();
      dragging.current = null;
      if (controlsRef.current) controlsRef.current.enabled = true;
      onRectChange(null);

      const minX = Math.min(rect.x0, rect.x1);
      const maxX = Math.max(rect.x0, rect.x1);
      const minY = Math.min(rect.y0, rect.y1);
      const maxY = Math.max(rect.y0, rect.y1);
      // Ignore an effectively-stationary click (Shift+click with no real
      // drag) -- treating a 0x0 rect as a valid marquee would clear the
      // selection on every plain shift-click of empty space.
      if (maxX - minX < 3 && maxY - minY < 3) return;

      const hitIds: string[] = [];
      for (const id of order) {
        const node = nodes[id];
        if (!node || !node.visible) continue;
        const box = computeBoundingBox(node.mesh);
        const matrix = transformToMatrix4(node.designTransform);
        const corners = [
          [box.min[0], box.min[1], box.min[2]],
          [box.max[0], box.min[1], box.min[2]],
          [box.min[0], box.max[1], box.min[2]],
          [box.max[0], box.max[1], box.min[2]],
          [box.min[0], box.min[1], box.max[2]],
          [box.max[0], box.min[1], box.max[2]],
          [box.min[0], box.max[1], box.max[2]],
          [box.max[0], box.max[1], box.max[2]],
        ] as const;

        let objMinX = Infinity;
        let objMaxX = -Infinity;
        let objMinY = Infinity;
        let objMaxY = -Infinity;
        for (const [cx, cy, cz] of corners) {
          const v = new Vector3(cx, cy, cz).applyMatrix4(matrix).project(camera);
          const sx = (v.x * 0.5 + 0.5) * size.width;
          const sy = (1 - (v.y * 0.5 + 0.5)) * size.height;
          objMinX = Math.min(objMinX, sx);
          objMaxX = Math.max(objMaxX, sx);
          objMinY = Math.min(objMinY, sy);
          objMaxY = Math.max(objMaxY, sy);
        }

        const overlaps = objMinX <= maxX && objMaxX >= minX && objMinY <= maxY && objMaxY >= minY;
        if (overlaps) hitIds.push(id);
      }
      selectMany(hitIds);
    };

    // capture: true -- both OrbitControls and R3F's own synthetic pointer
    // system attach their listeners on this same <canvas> element in the
    // bubble phase. Registering ours on the capture phase guarantees we see
    // (and can stopPropagation on) the event first, so a Shift+drag never
    // also rotates the camera or fires a node's onClick underneath it.
    dom.addEventListener("pointerdown", onPointerDown, { capture: true });
    dom.addEventListener("pointermove", onPointerMove, { capture: true });
    dom.addEventListener("pointerup", onPointerUp, { capture: true });
    return () => {
      dom.removeEventListener("pointerdown", onPointerDown, { capture: true });
      dom.removeEventListener("pointermove", onPointerMove, { capture: true });
      dom.removeEventListener("pointerup", onPointerUp, { capture: true });
    };
  }, [gl, camera, size, nodes, order, selectMany, controlsRef, onRectChange]);

  return null;
}

/**
 * The M3 plane-split cutting plane: a semi-transparent double-sided
 * rectangle the user can move/rotate to choose where the model gets cut,
 * shown live in the viewport before Apply Split ever runs a real boolean
 * (so nothing is mutated just from moving the plane). Same
 * useState-callback-ref + "don't reapply declarative transform while
 * dragging" pattern as SceneNodeMesh's node gizmo, for the same reasons.
 */
function SplitPlaneGizmo() {
  const session = useEditorStore((s) => s.splitSession);
  const isDragging = useEditorStore((s) => s.splitPlaneDragging);
  const setDragging = useEditorStore((s) => s.setSplitPlaneDragging);
  const updatePlane = useEditorStore((s) => s.updateSplitPlaneDirect);

  const [group, setGroup] = useState<Group | null>(null);
  const edgesSource = useMemo(
    () => (session ? new PlaneGeometry(session.planeSizeMm, session.planeSizeMm) : null),
    [session?.planeSizeMm],
  );

  if (!session) return null;

  return (
    <>
      <group
        ref={setGroup}
        position={isDragging ? undefined : session.plane.position}
        rotation={
          isDragging
            ? undefined
            : [
                degToRad(session.plane.rotationDeg[0]),
                degToRad(session.plane.rotationDeg[1]),
                degToRad(session.plane.rotationDeg[2]),
              ]
        }
      >
        <mesh>
          <planeGeometry args={[session.planeSizeMm, session.planeSizeMm]} />
          <meshBasicMaterial color="#e0954f" transparent opacity={0.28} side={DoubleSide} depthWrite={false} />
        </mesh>
        {edgesSource && (
          <lineSegments>
            <edgesGeometry args={[edgesSource]} />
            <lineBasicMaterial color="#e0954f" />
          </lineSegments>
        )}
      </group>
      {group && (
        <TransformControls
          object={group}
          mode={session.gizmoMode}
          onMouseDown={() => setDragging(true)}
          onObjectChange={() => {
            updatePlane({
              position: [group.position.x, group.position.y, group.position.z],
              rotationDeg: [radToDeg(group.rotation.x), radToDeg(group.rotation.y), radToDeg(group.rotation.z)],
            });
          }}
          onMouseUp={() => setDragging(false)}
        />
      )}
    </>
  );
}

/**
 * The user's actual printer bed (256 x 256mm, Bambu Lab P2S -- see
 * lib/printBed.ts), rendered as a subtle plate plus a bright outline so
 * it's visually obvious when an arrangement (e.g. the Legend field's
 * batch-create-per-word grid) exceeds the real usable area -- the
 * GridHelper below this is a generic, unbounded ruler with no marked edge,
 * which is exactly what made "did this spill off the bed?" impossible to
 * answer just by looking at the viewport.
 */
function BedPlate() {
  const outlineGeometry = useMemo(() => {
    const hw = PRINT_BED_WIDTH_MM / 2;
    const hd = PRINT_BED_DEPTH_MM / 2;
    // 4 independent segments (not a shared-vertex loop) to match the same
    // <lineSegments> + plain position-attribute pattern already used for
    // the split-plane gizmo's edge outline elsewhere in this file.
    const points = new Float32Array([
      -hw, -hd, 0, hw, -hd, 0,
      hw, -hd, 0, hw, hd, 0,
      hw, hd, 0, -hw, hd, 0,
      -hw, hd, 0, -hw, -hd, 0,
    ]);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(points, 3));
    return geometry;
  }, []);

  return (
    <group>
      <mesh position={[0, 0, -0.05]}>
        <planeGeometry args={[PRINT_BED_WIDTH_MM, PRINT_BED_DEPTH_MM]} />
        <meshBasicMaterial color="#2a2e33" transparent opacity={0.35} side={DoubleSide} depthWrite={false} />
      </mesh>
      <lineSegments geometry={outlineGeometry}>
        <lineBasicMaterial color="#e0954f" />
      </lineSegments>
    </group>
  );
}

export function Viewport() {
  const order = useEditorStore((s) => s.project.order);
  const select = useEditorStore((s) => s.select);
  const controlsRef = useRef<{ enabled: boolean } | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
    <Canvas
      // up: [0,0,1] -- the whole app's geometry convention is Z-up (STL/3D-printing
      // standard: Z is height, XY is the print bed plane), but three.js's own
      // default camera/OrbitControls convention is Y-up. Without this, the
      // camera renders world-Y as "vertical" while every other part of the
      // pipeline (geometry-core, designTransform, the STL files themselves)
      // treats world-Z as vertical -- a model whose tall axis is Z (i.e. any
      // normal model) then visually renders lying on its side. Found via a
      // real user report after M3 (dimensions were correct, but an imported
      // model appeared to be lying flat), not caught earlier because the M0-M3
      // test cube (18x18x10) is nearly as wide as it is tall, so the mismatch
      // wasn't visually obvious.
      camera={{ position: [120, 120, 120], up: [0, 0, 1], fov: 45, near: 0.1, far: 5000 }}
      onPointerMissed={() => select(null)}
      style={{ background: "#1b1e22" }}
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[100, 150, 100]} intensity={1.2} />
      <directionalLight position={[-100, 60, -80]} intensity={0.4} />

      {/* 16mm grid cells spanning the real 256mm P2S bed -- a visual mm
          ruler sized to match BedPlate's own outline below, not an
          arbitrary round number. THREE.GridHelper lies in the XZ plane by
          default (matching three's Y-up convention); rotated 90deg about X
          so it lies in the XY plane instead, matching this app's Z-up
          convention (the grid represents the print bed, which is the XY
          plane). */}
      <gridHelper args={[PRINT_BED_WIDTH_MM, PRINT_BED_WIDTH_MM / 16, "#4a4f57", "#2c2f35"]} rotation={[Math.PI / 2, 0, 0]} />
      <BedPlate />
      <axesHelper args={[40]} />

      {order.map((id) => (
        <SceneNodeMesh key={id} id={id} />
      ))}

      <SplitPlaneGizmo />
      <MultiSelectGizmo />
      <MarqueeSelect controlsRef={controlsRef} onRectChange={setMarqueeRect} />

      {/*
        makeDefault registers this as `state.controls` -- drei's
        TransformControls automatically disables it while dragging via a
        `dragging-changed` listener on the underlying three-stdlib controls
        instance (see node_modules/@react-three/drei/core/TransformControls.js),
        so no manual orbit-disable wiring is needed here. Also disabled while
        MarqueeSelect is drag-selecting, via the same `controlsRef`.
      */}
      <OrbitControls ref={(instance) => { controlsRef.current = instance; }} makeDefault />
      <GizmoHelper alignment="bottom-right" margin={[70, 70]}>
        <GizmoViewport axisColors={["#e0776a", "#7fb8ab", "#5b8dee"]} labelColor="#1b1e22" />
      </GizmoHelper>
    </Canvas>
    {marqueeRect && (
      <div
        data-testid="marquee-rect"
        style={{
          position: "absolute",
          left: Math.min(marqueeRect.x0, marqueeRect.x1),
          top: Math.min(marqueeRect.y0, marqueeRect.y1),
          width: Math.abs(marqueeRect.x1 - marqueeRect.x0),
          height: Math.abs(marqueeRect.y1 - marqueeRect.y0),
          border: "1px solid #5b8dee",
          background: "rgba(91, 141, 238, 0.15)",
          pointerEvents: "none",
        }}
      />
    )}
    </div>
  );
}
