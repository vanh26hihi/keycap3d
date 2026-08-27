"use client";

import { useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { GizmoHelper, GizmoViewport, OrbitControls, TransformControls } from "@react-three/drei";
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Matrix4, PlaneGeometry, type Group } from "three";
import { meshBufferToBufferGeometry, transformToMatrix4, matrix4ToTransform, type Transform } from "@keycap-web/geometry-core";
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

  if (!node || !node.visible || !geometry) return null;
  if (isolatedNodeId && isolatedNodeId !== id) return null;

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
        <mesh geometry={geometry}>
          {/* flatShading: this is CAD/mechanical geometry -- sharp edges
              everywhere (letter/icon relief, boss walls, keycap bevels),
              not an organic smooth-curved model. Without it,
              meshBufferToBufferGeometry's fallback computeVertexNormals()
              averages face normals across every SHARED vertex, including
              ones that sit on a genuine hard edge between two very
              differently-angled faces (e.g. a glyph's flat top meeting its
              vertical side wall) -- producing garbage blended normals that
              render as a jagged/crumpled mess under lighting, especially
              visible on small sharp-cornered features like embossed
              letters. flatShading derives each triangle's normal directly
              in the fragment shader instead, matching how any slicer
              (which only ever reads face-derived normals from an STL,
              never vertex normals) already renders the exact same mesh
              correctly. */}
          <meshStandardMaterial
            color={node.color}
            emissive={isSelected ? "#3a5a8c" : "#000000"}
            emissiveIntensity={isSelected ? 0.35 : 0}
            flatShading
          />
        </mesh>
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

  return (
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

      {/*
        makeDefault registers this as `state.controls` -- drei's
        TransformControls automatically disables it while dragging via a
        `dragging-changed` listener on the underlying three-stdlib controls
        instance (see node_modules/@react-three/drei/core/TransformControls.js),
        so no manual orbit-disable wiring is needed here.
      */}
      <OrbitControls makeDefault />
      <GizmoHelper alignment="bottom-right" margin={[70, 70]}>
        <GizmoViewport axisColors={["#e0776a", "#7fb8ab", "#5b8dee"]} labelColor="#1b1e22" />
      </GizmoHelper>
    </Canvas>
  );
}
