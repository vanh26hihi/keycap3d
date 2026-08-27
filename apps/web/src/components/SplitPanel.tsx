"use client";

import { useEffect, useState } from "react";
import { useEditorStore, type SplitGizmoMode } from "../state/store";

function NumberField({
  fieldKey,
  label,
  value,
  onCommit,
  step = 0.1,
}: {
  fieldKey: string;
  label: string;
  value: number;
  onCommit: (v: number) => void;
  step?: number;
}) {
  const [text, setText] = useState(value.toFixed(3));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(value.toFixed(3));
  }, [value, focused, fieldKey]);

  return (
    <label className="number-field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={text}
        data-testid={`split-field-${fieldKey}`}
        onFocus={() => setFocused(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setFocused(false);
          const parsed = parseFloat(text);
          if (!Number.isNaN(parsed) && parsed !== value) onCommit(parsed);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}

const AXIS_LABELS = ["X", "Y", "Z"] as const;

const SPLIT_STATUS_LABELS: Record<string, string> = {
  idle: "chưa xử lý",
  processing: "đang xử lý",
  success: "thành công",
  error: "lỗi",
};

export function SplitPanel() {
  const session = useEditorStore((s) => s.splitSession);
  const status = useEditorStore((s) => s.splitStatus);
  const error = useEditorStore((s) => s.splitError);
  const updatePlane = useEditorStore((s) => s.updateSplitPlaneDirect);
  const setGizmoMode = useEditorStore((s) => s.setSplitGizmoMode);
  const centerToObject = useEditorStore((s) => s.centerSplitPlaneToObject);
  const resetPlane = useEditorStore((s) => s.resetSplitPlane);
  const cancelSplit = useEditorStore((s) => s.cancelSplit);
  const applySplit = useEditorStore((s) => s.applySplit);

  if (!session) return null;

  const setMode = (mode: SplitGizmoMode) => setGizmoMode(mode);

  const commitAxis = (group: "position" | "rotationDeg", axis: 0 | 1 | 2, value: number) => {
    const next = [...session.plane[group]] as [number, number, number];
    next[axis] = value;
    updatePlane({ [group]: next });
  };

  const processing = status === "processing";

  return (
    <div className="panel split-panel" data-testid="split-panel">
      <div className="panel-title">Cắt bằng mặt phẳng</div>

      <div className="transform-group">
        <div className="transform-group-label">Gizmo</div>
        <div className="split-mode-row">
          <button
            type="button"
            className={`toolbar-btn${session.gizmoMode === "translate" ? " active" : ""}`}
            onClick={() => setMode("translate")}
            disabled={processing}
          >
            Di chuyển
          </button>
          <button
            type="button"
            className={`toolbar-btn${session.gizmoMode === "rotate" ? " active" : ""}`}
            onClick={() => setMode("rotate")}
            disabled={processing}
          >
            Xoay
          </button>
        </div>
      </div>

      <div className="transform-group">
        <div className="transform-group-label">Vị trí mặt phẳng (mm)</div>
        <div className="transform-row">
          {AXIS_LABELS.map((label, axis) => (
            <NumberField
              key={`pos-${axis}`}
              fieldKey={`position-${label.toLowerCase()}`}
              label={label}
              value={session.plane.position[axis]}
              onCommit={(v) => commitAxis("position", axis as 0 | 1 | 2, v)}
            />
          ))}
        </div>
      </div>

      <div className="transform-group">
        <div className="transform-group-label">Góc xoay mặt phẳng (độ)</div>
        <div className="transform-row">
          {AXIS_LABELS.map((label, axis) => (
            <NumberField
              key={`rot-${axis}`}
              fieldKey={`rotation-${label.toLowerCase()}`}
              label={label}
              value={session.plane.rotationDeg[axis]}
              step={1}
              onCommit={(v) => commitAxis("rotationDeg", axis as 0 | 1 | 2, v)}
            />
          ))}
        </div>
      </div>

      <div className="transform-group split-actions">
        <button type="button" className="toolbar-btn" onClick={centerToObject} disabled={processing}>
          Căn giữa vào đối tượng
        </button>
        <button type="button" className="toolbar-btn" onClick={resetPlane} disabled={processing}>
          Đặt lại
        </button>
      </div>

      <div className="transform-group split-status" data-testid="split-status">
        Trạng thái: <span className={`split-status-${status}`}>{SPLIT_STATUS_LABELS[status] ?? status}</span>
      </div>

      {status === "error" && error && (
        <div className="split-error" data-testid="split-error">
          {error}
        </div>
      )}

      <div className="transform-group split-apply-row">
        <button type="button" className="toolbar-btn" onClick={cancelSplit} disabled={processing}>
          Hủy
        </button>
        <button
          type="button"
          className="toolbar-btn primary"
          onClick={() => void applySplit()}
          disabled={processing}
          data-testid="apply-split-btn"
        >
          {processing ? "Đang cắt…" : "Thực hiện cắt"}
        </button>
      </div>
    </div>
  );
}
