"use client";

import { useState } from "react";
import { DEFAULT_KEYCAP_PARAMS, type KeycapParams } from "@keycap-web/geometry-core/keycap";
import { useEditorStore } from "../state/store";
import { loadSavedDefaultParams } from "../lib/keycapDefaults";
import { findFreePosition, occupiedRectsForProject, type OccupiedRect } from "../lib/placement";
import { PRINT_BED_WIDTH_MM } from "../lib/printBed";

/**
 * Dedicated "create N keycaps from a phrase" flow -- a deliberate action
 * with its own text field and an explicit "Xác nhận" (confirm) button,
 * instead of the earlier design where typing a space into the Legend
 * field's textarea silently spawned extra keycaps as a side effect. That
 * mixed two different intents into one field (editing THIS keycap's own
 * label vs. creating a whole new SET of keycaps) and made the space key
 * itself feel unpredictable. This dialog is the one place that side effect
 * lives now, entered only on purpose.
 */
export function BatchCreateDialog() {
  const open = useEditorStore((s) => s.batchCreateOpen);
  const setOpen = useEditorStore((s) => s.setBatchCreateOpen);
  const addKeycapNode = useEditorStore((s) => s.addKeycapNode);
  const project = useEditorStore((s) => s.project);
  const selectedId = useEditorStore((s) => s.selectedId);
  const selectedNode = selectedId ? project.nodes[selectedId] : null;

  const [text, setText] = useState("");
  const [creating, setCreating] = useState(false);

  if (!open) return null;

  // Uses the currently-selected keycap's own params as the template for
  // every new keycap (same switch type, size, legend style, etc.) if one is
  // selected; otherwise falls back to the user's saved default, then the
  // hardcoded default -- the same fallback chain "+ Keycap" itself uses.
  const template: KeycapParams = selectedNode?.parametric?.params ?? loadSavedDefaultParams() ?? DEFAULT_KEYCAP_PARAMS;

  const handleConfirm = async () => {
    const words = text
      .trim()
      .split(/[ \t\n]+/)
      .map((w) => w.trim())
      .filter((w) => w.length > 0);
    if (words.length === 0) return;

    setCreating(true);
    try {
      // Each new keycap's position is found fresh against everything
      // already placed (including ones this same batch just created a
      // moment ago), so the batch never stacks a new keycap directly on
      // top of an existing one -- neither an old one already in the scene
      // nor an earlier keycap from this very batch.
      const occupied: OccupiedRect[] = occupiedRectsForProject(project);
      for (const word of words) {
        const [x, y] = findFreePosition(occupied, template.widthMm, template.lengthMm);
        occupied.push({ cx: x, cy: y, w: template.widthMm, l: template.lengthMm });
        await addKeycapNode({ ...template, legendText: word }, [x, y, 0]);
      }
      setText("");
      setOpen(false);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={() => !creating && setOpen(false)}
    >
      <div
        style={{
          background: "#202327",
          border: "1px solid #3a3f47",
          borderRadius: 4,
          padding: 16,
          width: 380,
          maxWidth: "90vw",
        }}
        onClick={(e) => e.stopPropagation()}
        data-testid="batch-create-dialog"
      >
        <div className="panel-title" style={{ marginBottom: 8 }}>
          Tạo hàng loạt từ chữ
        </div>
        <p style={{ fontSize: 12, color: "#9a988c", marginTop: 0, marginBottom: 8 }}>
          Mỗi từ (cách nhau bằng dấu cách hoặc xuống dòng) tạo ra 1 keycap riêng, xếp thành lưới trong bàn in{" "}
          {PRINT_BED_WIDTH_MM}mm, không đè lên các đối tượng đã có sẵn. Dùng chung thông số của keycap đang chọn (nếu
          có), hoặc mặc định.
        </p>
        <textarea
          autoFocus
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="VD: ESC CTRL ALT"
          data-testid="batch-create-textarea"
          style={{
            width: "100%",
            background: "#14171a",
            border: "1px solid #3a3f47",
            color: "#e6e6e6",
            borderRadius: 2,
            padding: 6,
            fontFamily: "inherit",
            fontSize: 13,
            resize: "vertical",
            boxSizing: "border-box",
            marginBottom: 12,
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="toolbar-btn" onClick={() => setOpen(false)} disabled={creating} data-testid="batch-create-cancel">
            Hủy
          </button>
          <button
            type="button"
            className="toolbar-btn primary"
            onClick={() => void handleConfirm()}
            disabled={creating || text.trim().length === 0}
            data-testid="batch-create-confirm"
          >
            {creating ? "Đang tạo…" : "Xác nhận"}
          </button>
        </div>
      </div>
    </div>
  );
}
