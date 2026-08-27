"use client";

import { useEffect, useMemo, useState } from "react";
import { applyTransformToMesh, computeBoundingBox, triangleCount, validateMesh, type Transform } from "@keycap-web/geometry-core";
import { useEditorStore } from "../state/store";
import { KeycapPanel } from "./KeycapPanel";

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
        data-testid={`field-${fieldKey}`}
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

export function TransformPanel() {
  const selectedId = useEditorStore((s) => s.selectedId);
  const node = useEditorStore((s) => (s.selectedId ? s.project.nodes[s.selectedId] : null));
  const updateDirect = useEditorStore((s) => s.updateNodeTransformDirect);
  const commit = useEditorStore((s) => s.commitTransform);

  const worldBox = useMemo(() => {
    if (!node) return null;
    return computeBoundingBox(applyTransformToMesh(node.mesh, node.designTransform));
  }, [node]);

  // Keyed on `node.mesh` (not `node`) -- topology doesn't change when only
  // designTransform changes (e.g. every frame of a drag), so this must not
  // re-run validateMesh's O(triangles) edge-adjacency pass on every drag
  // frame for a possibly-large imported STL.
  const mesh = node?.mesh;
  const meshInfo = useMemo(() => {
    if (!mesh) return null;
    const report = validateMesh(mesh);
    return {
      triangles: triangleCount(mesh),
      watertight: report.isWatertight,
      volumeMm3: report.isWatertight ? Math.abs(report.signedVolumeMm3) : null,
    };
  }, [mesh]);

  if (!selectedId || !node) {
    return (
      <div className="panel transform-panel" data-testid="transform-panel">
        <div className="panel-title">Biến đổi</div>
        <p className="empty-hint">Chọn một đối tượng để chỉnh vị trí/xoay/tỷ lệ.</p>
      </div>
    );
  }

  const commitAxis = (group: "position" | "rotationDeg" | "scale", axis: 0 | 1 | 2, value: number) => {
    const prev = node.designTransform;
    const next: Transform = {
      position: [...prev.position] as [number, number, number],
      rotationDeg: [...prev.rotationDeg] as [number, number, number],
      scale: [...prev.scale] as [number, number, number],
    };
    next[group][axis] = value;
    updateDirect(selectedId, next);
    commit(selectedId, prev);
  };

  return (
    <div className="panel transform-panel" data-testid="transform-panel">
      <div className="panel-title">{node.name}</div>

      {node.parametric && <KeycapPanel nodeId={selectedId} params={node.parametric.params} />}

      <div className="transform-group">
        <div className="transform-group-label">Vị trí (mm)</div>
        <div className="transform-row">
          {AXIS_LABELS.map((label, axis) => (
            <NumberField
              key={`${selectedId}-position-${axis}`}
              fieldKey={`position-${label.toLowerCase()}`}
              label={label}
              value={node.designTransform.position[axis]}
              onCommit={(v) => commitAxis("position", axis as 0 | 1 | 2, v)}
            />
          ))}
        </div>
      </div>

      <div className="transform-group">
        <div className="transform-group-label">Góc xoay (độ)</div>
        <div className="transform-row">
          {AXIS_LABELS.map((label, axis) => (
            <NumberField
              key={`${selectedId}-rotation-${axis}`}
              fieldKey={`rotation-${label.toLowerCase()}`}
              label={label}
              value={node.designTransform.rotationDeg[axis]}
              step={1}
              onCommit={(v) => commitAxis("rotationDeg", axis as 0 | 1 | 2, v)}
            />
          ))}
        </div>
      </div>

      <div className="transform-group">
        <div className="transform-group-label">Tỷ lệ</div>
        <div className="transform-row">
          {AXIS_LABELS.map((label, axis) => (
            <NumberField
              key={`${selectedId}-scale-${axis}`}
              fieldKey={`scale-${label.toLowerCase()}`}
              label={label}
              value={node.designTransform.scale[axis]}
              step={0.05}
              onCommit={(v) => commitAxis("scale", axis as 0 | 1 | 2, v)}
            />
          ))}
        </div>
      </div>

      {worldBox && (
        <div className="transform-group">
          <div className="transform-group-label">Kích thước X/Y/Z (không gian thiết kế, mm)</div>
          <div className="bbox-readout" data-testid="bbox-readout">
            {worldBox.size[0].toFixed(3)} x {worldBox.size[1].toFixed(3)} x {worldBox.size[2].toFixed(3)}
          </div>
        </div>
      )}

      {meshInfo && (
        <div className="transform-group">
          <div className="transform-group-label">Mesh</div>
          <div className="info-readout" data-testid="mesh-info">
            <div>Số tam giác: {meshInfo.triangles.toLocaleString()}</div>
            <div>
              Kín khối:{" "}
              {meshInfo.watertight ? (
                <span style={{ color: "#7fb8ab" }}>có</span>
              ) : (
                <span style={{ color: "#e0b56a" }}>không (hở/không thống nhất)</span>
              )}
            </div>
            <div>
              Thể tích:{" "}
              {meshInfo.volumeMm3 !== null ? `${meshInfo.volumeMm3.toFixed(2)} mm³` : "không có (chưa kín khối)"}
            </div>
          </div>
        </div>
      )}

      {node.origin.kind === "split" && (
        <div className="transform-group">
          <div className="transform-group-label">Nguồn gốc</div>
          <div className="info-readout" data-testid="origin-info">
            Phần được cắt (phần còn lại: {node.origin.splitSibling.slice(0, 8)}…)
          </div>
        </div>
      )}
    </div>
  );
}
