"use client";

import { useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { GizmoHelper, GizmoViewport, OrbitControls, TransformControls } from "@react-three/drei";
import { DoubleSide, PlaneGeometry, type Group } from "three";
import { meshBufferToBufferGeometry, type Transform } from "@keycap-web/geometry-core";
import { useEditorStore } from "../state/store";

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
  const selectedId = useEditorStore((s) => s.selectedId);
  const select = useEditorStore((s) => s.select);
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

  const isSelected = selectedId === id;
  // While this node is being actively dragged, TransformControls owns its
  // Object3D's position/rotation/scale exclusively. If we keep passing them
  // as declarative props here, R3F re-applies (.set()s) them on every single
  // store update this same drag produces (onObjectChange fires every
  // pointermove), which fights TransformControls' internal drag-delta
  // bookkeeping. Passing `undefined` makes R3F skip setting that prop
  // entirely, leaving the object fully in TransformControls' hands until
  // the drag ends.
  const isDragging = useEditorStore((s) => s.draggingNodeId === id);

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
          select(id);
        }}
      >
        <mesh geometry={geometry}>
          <meshStandardMaterial
            color={node.color}
            emissive={isSelected ? "#3a5a8c" : "#000000"}
            emissiveIntensity={isSelected ? 0.35 : 0}
          />
        </mesh>
      </group>
      {isSelected && group && !splitActive && (
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

      {/* 10mm grid cells, 200mm span -- a visual mm ruler for the print-bed-sized
          scene. THREE.GridHelper lies in the XZ plane by default (matching
          three's Y-up convention); rotated 90deg about X so it lies in the XY
          plane instead, matching this app's Z-up convention (the grid
          represents the print bed, which is the XY plane). */}
      <gridHelper args={[200, 20, "#4a4f57", "#2c2f35"]} rotation={[Math.PI / 2, 0, 0]} />
      <axesHelper args={[40]} />

      {order.map((id) => (
        <SceneNodeMesh key={id} id={id} />
      ))}

      <SplitPlaneGizmo />

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
