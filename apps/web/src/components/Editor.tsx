"use client";

import { useEffect } from "react";
import { Toolbar } from "./Toolbar";
import { SceneTreePanel } from "./SceneTreePanel";
import { TransformPanel } from "./TransformPanel";
import { SplitPanel } from "./SplitPanel";
import { Viewport } from "./Viewport";
import { BatchCreateDialog } from "./BatchCreateDialog";
import { useEditorStore } from "../state/store";

export function Editor() {
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const setTransformMode = useEditorStore((s) => s.setTransformMode);
  const duplicateNode = useEditorStore((s) => s.duplicateNode);
  const removeNode = useEditorStore((s) => s.removeNode);
  const selectedId = useEditorStore((s) => s.selectedId);
  const splitActive = useEditorStore((s) => s.splitSession !== null);
  const cancelSplit = useEditorStore((s) => s.cancelSplit);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // don't hijack typing in a text field (rename input, number field)
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

      if (e.key === "Escape" && splitActive) {
        e.preventDefault();
        cancelSplit();
        return;
      }
      // While a split session is open, only the plane gizmo should respond
      // to keyboard shortcuts -- editing/deleting the object mid-split (or
      // silently changing its own transform-mode) would be confusing.
      if (splitActive) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (selectedId) duplicateNode(selectedId);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedId) {
          e.preventDefault();
          removeNode(selectedId);
        }
        return;
      }
      if (e.key === "1") setTransformMode("translate");
      if (e.key === "2") setTransformMode("rotate");
      if (e.key === "3") setTransformMode("scale");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo, setTransformMode, duplicateNode, removeNode, selectedId, splitActive, cancelSplit]);

  return (
    <div className="editor-shell">
      <Toolbar />
      <div className="editor-body">
        <SceneTreePanel />
        <div className="viewport-container">
          <Viewport />
        </div>
        {splitActive ? <SplitPanel /> : <TransformPanel />}
      </div>
      <BatchCreateDialog />
    </div>
  );
}
