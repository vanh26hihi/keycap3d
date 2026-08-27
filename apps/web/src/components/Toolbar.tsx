"use client";

import { useRef } from "react";
import { createCubeMesh, createCylinderMesh } from "@keycap-web/geometry-core";
import { useEditorStore, type TransformMode } from "../state/store";
import { downloadBlob, exportNodeToSTLBlob, importSTLFile } from "../lib/importExport";

const MODES: { mode: TransformMode; label: string; key: string }[] = [
  { mode: "translate", label: "Di chuyển", key: "1" },
  { mode: "rotate", label: "Xoay", key: "2" },
  { mode: "scale", label: "Tỷ lệ", key: "3" },
];

export function Toolbar() {
  const transformMode = useEditorStore((s) => s.transformMode);
  const setTransformMode = useEditorStore((s) => s.setTransformMode);
  const selectedId = useEditorStore((s) => s.selectedId);
  const nodes = useEditorStore((s) => s.project.nodes);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const past = useEditorStore((s) => s.past);
  const future = useEditorStore((s) => s.future);
  const addMeshNode = useEditorStore((s) => s.addMeshNode);
  const duplicateNode = useEditorStore((s) => s.duplicateNode);
  const removeNode = useEditorStore((s) => s.removeNode);
  const beginSplit = useEditorStore((s) => s.beginSplit);
  const splitActive = useEditorStore((s) => s.splitSession !== null);
  const addKeycapNode = useEditorStore((s) => s.addKeycapNode);
  const keycapStatus = useEditorStore((s) => s.keycapStatus);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const buffer = await file.arrayBuffer();
    const { mesh, warning } = importSTLFile(buffer);
    addMeshNode(mesh, file.name.replace(/\.stl$/i, ""), undefined, { kind: "import" });
    if (warning) {
      window.alert(`Cảnh báo khi nhập file "${file.name}":\n\n${warning}`);
    }
  };

  const handleExport = () => {
    if (!selectedId) return;
    const node = nodes[selectedId];
    if (!node) return;
    const blob = exportNodeToSTLBlob(node);
    downloadBlob(blob, `${node.name || "part"}.stl`);
  };

  return (
    <div className="toolbar" data-testid="toolbar">
      <div className="toolbar-group">
        {MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            className={`toolbar-btn${transformMode === m.mode ? " active" : ""}`}
            onClick={() => setTransformMode(m.mode)}
            data-testid={`mode-${m.mode}`}
            title={`${m.label} (${m.key})`}
            disabled={splitActive}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="toolbar-group">
        <button
          type="button"
          className={`toolbar-btn${splitActive ? " active" : ""}`}
          disabled={!selectedId || splitActive}
          onClick={() => selectedId && beginSplit(selectedId)}
          data-testid="split-btn"
          title="Cắt bằng mặt phẳng"
        >
          Cắt
        </button>
      </div>

      <div className="toolbar-group">
        <button
          type="button"
          className="toolbar-btn"
          disabled={!selectedId || splitActive}
          onClick={() => selectedId && duplicateNode(selectedId)}
          data-testid="duplicate-btn"
        >
          Nhân bản
        </button>
        <button
          type="button"
          className="toolbar-btn"
          disabled={!selectedId || splitActive}
          onClick={() => selectedId && removeNode(selectedId)}
          data-testid="delete-btn"
        >
          Xóa
        </button>
      </div>

      <div className="toolbar-group">
        <button
          type="button"
          className="toolbar-btn"
          disabled={past.length === 0 || splitActive}
          onClick={undo}
          data-testid="undo-btn"
        >
          ↶ Hoàn tác
        </button>
        <button
          type="button"
          className="toolbar-btn"
          disabled={future.length === 0 || splitActive}
          onClick={redo}
          data-testid="redo-btn"
        >
          ↷ Làm lại
        </button>
      </div>

      <div className="toolbar-group">
        <button type="button" className="toolbar-btn" onClick={handleImportClick} data-testid="import-btn" disabled={splitActive}>
          Nhập STL
        </button>
        <input ref={fileInputRef} type="file" accept=".stl" hidden onChange={handleFileChange} data-testid="import-input" />
        <button
          type="button"
          className="toolbar-btn"
          disabled={!selectedId || splitActive}
          onClick={handleExport}
          data-testid="export-btn"
        >
          Xuất STL
        </button>
      </div>

      <div className="toolbar-group">
        <button
          type="button"
          className="toolbar-btn"
          disabled={splitActive}
          onClick={() => addMeshNode(createCubeMesh(18, 18, 10), `Cube ${Date.now() % 1000}`)}
          data-testid="add-cube-btn"
        >
          + Khối lập phương thử
        </button>
        <button
          type="button"
          className="toolbar-btn"
          disabled={splitActive}
          onClick={() => addMeshNode(createCylinderMesh(14, 20, 48), `Cylinder ${Date.now() % 1000}`)}
          data-testid="add-cylinder-btn"
        >
          + Hình trụ thử
        </button>
        <button
          type="button"
          className="toolbar-btn"
          disabled={splitActive || keycapStatus === "generating"}
          onClick={() => void addKeycapNode()}
          data-testid="add-keycap-btn"
          title="Thêm một keycap tham số (mặc định 18.5x18.5x10mm)"
        >
          {keycapStatus === "generating" ? "Đang tạo…" : "+ Keycap"}
        </button>
      </div>
    </div>
  );
}
