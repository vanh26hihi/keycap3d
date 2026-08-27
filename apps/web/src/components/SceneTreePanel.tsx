"use client";

import { useState } from "react";
import { useEditorStore } from "../state/store";

export function SceneTreePanel() {
  const order = useEditorStore((s) => s.project.order);
  const nodes = useEditorStore((s) => s.project.nodes);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const select = useEditorStore((s) => s.select);
  const toggleSelect = useEditorStore((s) => s.toggleSelect);
  const setVisible = useEditorStore((s) => s.setVisible);
  const renameNode = useEditorStore((s) => s.renameNode);
  const isolatedNodeId = useEditorStore((s) => s.isolatedNodeId);
  const setIsolated = useEditorStore((s) => s.setIsolated);
  const splitActive = useEditorStore((s) => s.splitSession !== null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  return (
    <div className="panel scene-tree" data-testid="scene-tree-panel">
      <div className="panel-title">
        Đối tượng ({order.length}){selectedIds.length > 1 && <span> — đã chọn {selectedIds.length}</span>}
      </div>
      <ul className="scene-tree-list">
        {order.map((id) => {
          const node = nodes[id];
          if (!node) return null;
          const isSelected = selectedIds.includes(id);
          const isEditing = editingId === id;
          const isIsolated = isolatedNodeId === id;
          return (
            <li
              key={id}
              className={`scene-tree-row${isSelected ? " selected" : ""}`}
              data-testid="scene-tree-row"
              data-node-id={id}
              title="Ctrl/Cmd-click để chọn nhiều đối tượng cùng lúc"
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey) toggleSelect(id);
                else select(id);
              }}
            >
              <button
                type="button"
                className="visibility-toggle"
                title={node.visible ? "Ẩn" : "Hiện"}
                disabled={splitActive}
                onClick={(e) => {
                  e.stopPropagation();
                  setVisible(id, !node.visible);
                }}
                data-testid="visibility-toggle"
              >
                {node.visible ? "◉" : "○"}
              </button>
              {isEditing ? (
                <input
                  autoFocus
                  className="rename-input"
                  value={draftName}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={() => {
                    renameNode(id, draftName.trim() || node.name);
                    setEditingId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                />
              ) : (
                <span
                  className="node-name"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (splitActive) return;
                    setEditingId(id);
                    setDraftName(node.name);
                  }}
                  data-testid="node-name"
                  title={node.origin.kind === "split" ? `Cắt ra từ ${node.origin.splitFrom.slice(0, 8)}…` : undefined}
                >
                  {node.name}
                  {node.origin.kind === "split" && <span className="origin-badge">đã cắt</span>}
                </span>
              )}
              <button
                type="button"
                className={`isolate-btn${isIsolated ? " active" : ""}`}
                title={isIsolated ? "Hiện tất cả" : "Chỉ hiện cái này"}
                disabled={splitActive}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsolated(isIsolated ? null : id);
                }}
                data-testid="isolate-toggle"
              >
                {isIsolated ? "◫" : "◨"}
              </button>
            </li>
          );
        })}
        {order.length === 0 && <li className="empty-hint">Chưa có đối tượng nào -- Nhập STL hoặc thêm khối lập phương thử.</li>}
      </ul>
    </div>
  );
}
