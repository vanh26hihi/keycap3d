"use client";

import { useRef, useState } from "react";
import { createCubeMesh, createCylinderMesh } from "@keycap-web/geometry-core";
import { DEFAULT_KEYCAP_PARAMS } from "@keycap-web/geometry-core/keycap";
import { useEditorStore, type TransformMode } from "../state/store";
import {
  downloadBlob,
  exportAllMultiPart3MFBlob,
  exportAllToSTLBlob,
  exportKeycapMultiPart3MFBlob,
  exportKeycapsOnlyToSTLBlob,
  exportNodeToSTLBlob,
  exportStemsOnlyToSTLBlob,
  importSTLFile,
} from "../lib/importExport";
import { loadSavedDefaultParams } from "../lib/keycapDefaults";
import { findFreePosition, occupiedRectsForProject } from "../lib/placement";

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
  const setBatchCreateOpen = useEditorStore((s) => s.setBatchCreateOpen);
  const keycapStatus = useEditorStore((s) => s.keycapStatus);
  const project = useEditorStore((s) => s.project);

  const handleAddKeycap = () => {
    const template = loadSavedDefaultParams() ?? DEFAULT_KEYCAP_PARAMS;
    const position = findFreePosition(occupiedRectsForProject(project), template.widthMm, template.lengthMm);
    void addKeycapNode(undefined, [position[0], position[1], 0]);
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [exporting3mf, setExporting3mf] = useState(false);
  // Which "export all ..." variant is currently running, if any -- these
  // all regenerate meshes through the (async) Boolean Engine per keycap
  // now (see collectExportMeshes in lib/importExport.ts), so a project
  // with many keycaps takes a moment, same reason handleExport3mf already
  // tracks its own busy flag.
  const [exportingAll, setExportingAll] = useState<null | "all" | "keycaps" | "stems" | "3mf">(null);

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

  const runExportAll = async (
    kind: "all" | "keycaps" | "stems" | "3mf",
    build: () => Promise<Blob>,
    filename: string,
    failureLabel: string,
  ) => {
    setExportingAll(kind);
    try {
      const blob = await build();
      downloadBlob(blob, filename);
    } catch (err) {
      window.alert(`${failureLabel} thất bại: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExportingAll(null);
    }
  };

  const handleExportAll = () => void runExportAll("all", () => exportAllToSTLBlob(project), "keycap-ban-in.stl", "Xuất tất cả (STL)");
  const handleExportKeycapsOnly = () =>
    void runExportAll("keycaps", () => exportKeycapsOnlyToSTLBlob(project), "keycap-vo.stl", "Xuất chỉ vỏ (STL)");
  const handleExportStemsOnly = () =>
    void runExportAll("stems", () => exportStemsOnlyToSTLBlob(project), "keycap-chot.stl", "Xuất chỉ chốt (STL)");
  const handleExportAllMultiPart3mf = () =>
    void runExportAll("3mf", () => exportAllMultiPart3MFBlob(project), "keycap-ban-in.3mf", "Xuất 3MF tất cả");

  const selectedNode = selectedId ? nodes[selectedId] : null;
  const canExport3mf = !!selectedNode?.parametric;
  const exportAllDisabled = splitActive || project.order.length === 0 || exportingAll !== null;

  const handleExport3mf = async () => {
    if (!selectedNode?.parametric) return;
    setExporting3mf(true);
    try {
      const blob = await exportKeycapMultiPart3MFBlob(selectedNode);
      downloadBlob(blob, `${selectedNode.name || "keycap"}.3mf`);
    } catch (err) {
      window.alert(`Xuất 3MF thất bại: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting3mf(false);
    }
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
        <button
          type="button"
          className="toolbar-btn"
          disabled={exportAllDisabled}
          onClick={handleExportAll}
          data-testid="export-all-btn"
          title="Xuất TẤT CẢ đối tượng đang hiện trong 1 file STL, đúng vị trí như trên bàn in -- chốt rời (nếu có) được xếp lại ở chỗ trống, không đè lên vỏ keycap"
        >
          {exportingAll === "all" ? "Đang xuất…" : "Xuất tất cả (STL)"}
        </button>
        <button
          type="button"
          className="toolbar-btn"
          disabled={exportAllDisabled}
          onClick={handleExportKeycapsOnly}
          data-testid="export-keycaps-only-btn"
          title="Chỉ xuất vỏ keycap (bỏ qua chốt rời, nếu có) -- để in riêng 1 mẻ toàn vỏ"
        >
          {exportingAll === "keycaps" ? "Đang xuất…" : "Xuất chỉ vỏ (STL)"}
        </button>
        <button
          type="button"
          className="toolbar-btn"
          disabled={exportAllDisabled}
          onClick={handleExportStemsOnly}
          data-testid="export-stems-only-btn"
          title="Chỉ xuất chốt rời của tất cả keycap có bật 'Tách rời chốt', xếp thành lưới riêng không chồng nhau -- để in riêng 1 mẻ toàn chốt"
        >
          {exportingAll === "stems" ? "Đang xuất…" : "Xuất chỉ chốt (STL)"}
        </button>
        <button
          type="button"
          className="toolbar-btn"
          disabled={!canExport3mf || splitActive || exporting3mf}
          onClick={() => void handleExport3mf()}
          data-testid="export-3mf-btn"
          title="Xuất 3MF nhiều object (vỏ / nền bong bóng chat / chữ-icon) để gán màu khác nhau trong Bambu Studio -- chỉ áp dụng cho keycap ĐANG CHỌN"
        >
          {exporting3mf ? "Đang xuất…" : "Xuất 3MF đa màu"}
        </button>
        <button
          type="button"
          className="toolbar-btn"
          disabled={exportAllDisabled}
          onClick={handleExportAllMultiPart3mf}
          data-testid="export-all-3mf-btn"
          title="Xuất 3MF đa màu cho TẤT CẢ đối tượng đang hiện -- mỗi vỏ/nền bong bóng/chữ/chốt của mỗi keycap là 1 object màu riêng"
        >
          {exportingAll === "3mf" ? "Đang xuất…" : "Xuất 3MF tất cả"}
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
          onClick={handleAddKeycap}
          data-testid="add-keycap-btn"
          title="Thêm một keycap tham số (mặc định 18.5x18.5x10mm)"
        >
          {keycapStatus === "generating" ? "Đang tạo…" : "+ Keycap"}
        </button>
        <button
          type="button"
          className="toolbar-btn"
          disabled={splitActive}
          onClick={() => setBatchCreateOpen(true)}
          data-testid="open-batch-create-btn"
          title="Nhập một câu, mỗi từ tạo ra 1 keycap riêng -- xác nhận trước khi tạo"
        >
          + Tạo hàng loạt từ chữ
        </button>
      </div>
    </div>
  );
}
