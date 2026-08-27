"use client";

import { useEffect, useState } from "react";
import { DEFAULT_KEYCAP_PARAMS, maxFlushSocketDepthMm, type KeycapParams } from "@keycap-web/geometry-core/keycap";
import { ICON_OPTIONS } from "@keycap-web/geometry-core/icons";
import { useEditorStore } from "../state/store";

function NumberField({
  fieldKey,
  label,
  title,
  value,
  onCommit,
  step = 0.1,
  min,
  max,
}: {
  fieldKey: string;
  label: string;
  title?: string;
  value: number;
  onCommit: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  const [text, setText] = useState(value.toFixed(2));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(value.toFixed(2));
  }, [value, focused, fieldKey]);

  return (
    <label className="number-field" title={title}>
      <span>{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={text}
        data-testid={`keycap-field-${fieldKey}`}
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

/** Multi-line text field -- Enter inserts a newline instead of
 *  committing, since an explicit '\n' is a real, honored manual line break
 *  for the legend (see legendLayout.ts's chooseLineLayout), not just a
 *  cosmetic line wrap. Commits on blur, same pattern as every other field. */
function TextAreaField({
  fieldKey,
  label,
  value,
  onCommit,
  rows = 2,
}: {
  fieldKey: string;
  label: string;
  value: string;
  onCommit: (v: string) => void;
  rows?: number;
}) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(value);
  }, [value, focused, fieldKey]);

  return (
    <label className="number-field" style={{ flex: 1 }}>
      <span>{label}</span>
      <textarea
        rows={rows}
        value={text}
        data-testid={`keycap-field-${fieldKey}`}
        onFocus={() => setFocused(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setFocused(false);
          if (text !== value) onCommit(text);
        }}
        style={{
          background: "#14171a",
          border: "1px solid #3a3f47",
          color: "#e6e6e6",
          borderRadius: 2,
          padding: 4,
          fontFamily: "inherit",
          fontSize: 12,
          resize: "vertical",
        }}
      />
    </label>
  );
}

/** Label + range slider + live numeric readout. The slider's own drag
 *  (`onInput`) only updates the displayed number locally -- the mesh only
 *  regenerates on release (`onChange`, which for a range input fires once
 *  the drag ends), same "commit on blur, not on every keystroke" pattern as
 *  every other field: regenerating on every intermediate drag tick would
 *  mean firing the (async, boolean-engine-backed) mesh rebuild dozens of
 *  times per drag for no benefit. */
function SliderField({
  fieldKey,
  label,
  title,
  value,
  onCommit,
  min,
  max,
  step = 0.1,
  unit = "mm",
}: {
  fieldKey: string;
  label: string;
  title?: string;
  value: number;
  onCommit: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);

  return (
    <label className="number-field" style={{ flex: 1 }} title={title}>
      <span>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={local}
          data-testid={`keycap-slider-${fieldKey}`}
          onInput={(e) => setLocal(parseFloat((e.target as HTMLInputElement).value))}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            setLocal(v);
            onCommit(v);
          }}
          style={{ flex: 1 }}
        />
        <span
          data-testid={`keycap-field-${fieldKey}`}
          style={{ minWidth: 48, textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 12 }}
        >
          {local.toFixed(1)} {unit}
        </span>
      </div>
    </label>
  );
}

const ALIGN_OPTIONS: Array<{ value: KeycapParams["legendAlign"]; title: string }> = [
  { value: "left", title: "Căn trái" },
  { value: "center", title: "Căn giữa" },
  { value: "right", title: "Căn phải" },
];

/** Three horizontal bars mimicking a left/center/right text-alignment icon
 *  (no emoji, since none render this precisely) -- widths/offsets shift per
 *  variant so the icon itself communicates the alignment, not just the label. */
function AlignIcon({ align }: { align: KeycapParams["legendAlign"] }) {
  const barWidths = [16, 11, 14];
  return (
    <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true">
      {barWidths.map((w, i) => {
        const x = align === "left" ? 0 : align === "right" ? 18 - w : (18 - w) / 2;
        return <rect key={i} x={x} y={i * 5} width={w} height="2.5" rx="1" fill="currentColor" />;
      })}
    </svg>
  );
}

const LEGEND_KIND_OPTIONS: Array<{ value: KeycapParams["legendKind"]; label: string }> = [
  { value: "text", label: "Chữ" },
  { value: "icon", label: "Icon" },
];

/** Vietnamese display names for geometry-core's ICON_OPTIONS -- kept
 *  separate from icons.ts's own `label` field (English), since that field
 *  is a shared library-level identifier (also used in fixture docs/tests),
 *  while this map is purely a UI display concern for this app. */
const ICON_LABELS_VI: Record<string, string> = {
  check: "Dấu tích",
  cross: "Dấu X",
  star: "Ngôi sao",
  heart: "Trái tim",
  question: "Dấu hỏi",
  music: "Nốt nhạc",
  dollar: "Đô la",
  ghost: "Ma",
  fire: "Lửa",
  bolt: "Tia sét",
  controller: "Tay cầm game",
  dice: "Xúc xắc",
  dog: "Chó",
  moon: "Mặt trăng",
  smiley: "Mặt cười",
  sun: "Mặt trời",
  gem: "Đá quý",
  key: "Chìa khóa",
  lock: "Ổ khóa",
  gear: "Bánh răng",
  anchor: "Mỏ neo",
  snowflake: "Bông tuyết",
  frown: "Mặt buồn",
  brokenHeart: "Trái tim vỡ",
  sparkles: "Lấp lánh",
  exclamation: "Dấu chấm than",
  doubleExclamation: "Hai dấu chấm than",
  arrowDown: "Mũi tên xuống",
  infinity: "Vô cực",
  circle: "Vòng tròn",
  club: "Chủ bài (♣)",
  sparklingHeart: "Trái tim lấp lánh",
  chatBubble: "Bong bóng chat",
};

/** Grid of the curated icon/emoji options (see geometry-core's icons.ts --
 *  this is the exact same list the generator can actually extrude; there's
 *  no separate "UI icon set" to keep in sync). Emoji render fine directly
 *  in the browser via its own system emoji font -- this grid is a picker
 *  UI, not the 3D geometry itself, so it doesn't need the embedded Noto
 *  Emoji subset that the generator uses for the actual print geometry. */
function IconGrid({ value, onSelect }: { value: string; onSelect: (char: string) => void }) {
  return (
    <div
      role="group"
      aria-label="Icon"
      style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 4 }}
    >
      {ICON_OPTIONS.map((icon) => (
        <button
          key={icon.id}
          type="button"
          title={ICON_LABELS_VI[icon.id] ?? icon.label}
          data-testid={`keycap-icon-${icon.id}`}
          onClick={() => onSelect(icon.char)}
          className={`toolbar-btn${value === icon.char ? " active" : ""}`}
          style={{ fontSize: 16, padding: "4px 0", lineHeight: 1.4 }}
        >
          {icon.char}
        </button>
      ))}
    </div>
  );
}

const SELECT_STYLE = {
  background: "#14171a",
  border: "1px solid #3a3f47",
  color: "#e6e6e6",
  borderRadius: 2,
  padding: 4,
  fontFamily: "inherit",
  fontSize: 12,
} as const;

/**
 * Shown instead of the raw mesh-info block in TransformPanel when the
 * selected node is a parametric keycap (`node.parametric` is set). Editing
 * any field calls `updateKeycapParams`, which regenerates the mesh (async,
 * through the Boolean Engine for the cavity/stem) and pushes exactly one
 * undo step -- same "commit on blur/Enter" pattern as every other numeric
 * field in the app, not a live-drag preview, so there's no need for a
 * debounce mechanism here.
 */
export function KeycapPanel({ nodeId, params }: { nodeId: string; params: KeycapParams }) {
  const updateKeycapParams = useEditorStore((s) => s.updateKeycapParams);
  const status = useEditorStore((s) => s.keycapStatus);
  const error = useEditorStore((s) => s.keycapError);

  const commit = (partial: Partial<KeycapParams>) => void updateKeycapParams(nodeId, partial);

  return (
    <div className="transform-group" data-testid="keycap-panel">
      <div className="transform-row" style={{ marginBottom: 6, justifyContent: "space-between", alignItems: "center" }}>
        <div className="transform-group-label" style={{ marginBottom: 0 }}>
          Thông số keycap (mm)
        </div>
        <button
          type="button"
          className="toolbar-btn"
          data-testid="keycap-reset-btn"
          title="Đặt lại toàn bộ thông số keycap này về mặc định"
          onClick={() => commit(DEFAULT_KEYCAP_PARAMS)}
        >
          Đặt lại mặc định
        </button>
      </div>

      <div className="transform-row" style={{ marginBottom: 6 }}>
        <NumberField fieldKey="width" label="Rộng" value={params.widthMm} min={4} onCommit={(v) => commit({ widthMm: v })} />
        <NumberField fieldKey="length" label="Dài" value={params.lengthMm} min={4} onCommit={(v) => commit({ lengthMm: v })} />
        <NumberField fieldKey="height" label="Cao" value={params.heightMm} min={2} onCommit={(v) => commit({ heightMm: v })} />
      </div>

      <div className="transform-row" style={{ marginBottom: 6 }}>
        <NumberField
          fieldKey="topInset"
          label="Thu mặt trên"
          value={params.topInsetMm}
          min={0}
          onCommit={(v) => commit({ topInsetMm: v })}
        />
        <NumberField
          fieldKey="cornerRadius"
          label="Bo góc"
          value={params.cornerRadiusMm}
          min={0}
          onCommit={(v) => commit({ cornerRadiusMm: v })}
        />
        <NumberField
          fieldKey="wallThickness"
          label="Độ dày vỏ"
          value={params.wallThicknessMm}
          min={0}
          onCommit={(v) => commit({ wallThicknessMm: v })}
        />
      </div>

      <label className="number-field" style={{ marginBottom: 8 }}>
        <span>Loại switch</span>
        <select
          value={params.switchType}
          data-testid="keycap-field-switchType"
          onChange={(e) => commit({ switchType: e.target.value as KeycapParams["switchType"] })}
          style={SELECT_STYLE}
        >
          <option value="cherry-mx">Cherry MX / tương thích MX</option>
          <option value="round">Lỗ tròn / tùy chỉnh</option>
          <option value="none">Không</option>
        </select>
      </label>

      {params.switchType !== "none" && (
        <>
          <div className="transform-row" style={{ marginBottom: 6 }}>
            {params.switchType === "round" ? (
              <NumberField
                fieldKey="socketDiameter"
                label="⌀ Lỗ"
                value={params.socketDiameterMm}
                step={0.1}
                min={0.5}
                onCommit={(v) => commit({ socketDiameterMm: v })}
              />
            ) : (
              <>
                <NumberField
                  fieldKey="stemCrossWidth"
                  label="Sải chữ thập"
                  value={params.stemCrossWidthMm}
                  step={0.05}
                  onCommit={(v) => commit({ stemCrossWidthMm: v })}
                />
                <NumberField
                  fieldKey="stemArmWidth"
                  label="Bề rộng chân"
                  value={params.stemArmWidthMm}
                  step={0.05}
                  onCommit={(v) => commit({ stemArmWidthMm: v })}
                />
              </>
            )}
          </div>

          <div className="transform-row" style={{ marginBottom: 6 }}>
            <NumberField
              fieldKey="socketDepth"
              // Max is derived from heightMm, not a fixed number: the
              // generator itself clamps the boss so it never pokes out past
              // the keycap's own bottom edge (see keycap.ts's bossHeightMm
              // computation) -- typing exactly this max value lands the
              // boss's entrance exactly flush with the keycap's bottom,
              // matching the requested "bằng mặt bàn" option without
              // needing a separate toggle.
              label="Độ dài chốt"
              title="Độ sâu socket -- giá trị tối đa: chốt dài bằng mặt đáy keycap"
              value={params.socketDepthMm}
              min={3}
              max={maxFlushSocketDepthMm(params.heightMm)}
              step={0.05}
              onCommit={(v) => commit({ socketDepthMm: v })}
            />
          </div>

          <div className="transform-row" style={{ marginBottom: 6 }}>
            <NumberField
              fieldKey="ribHeight"
              label="Chiều cao rib"
              title="Chiều cao 4 rib gia cường quanh chốt -- không thể cao hơn chính chốt"
              value={params.ribHeightMm}
              min={1}
              max={Math.min(params.socketDepthMm + 0.75, params.heightMm)}
              step={0.1}
              onCommit={(v) => commit({ ribHeightMm: v })}
            />
          </div>

          <div className="transform-row" style={{ marginBottom: 6, alignItems: "flex-end" }}>
            <NumberField
              fieldKey="bossDiameter"
              label="⌀ Boss"
              value={params.bossDiameterMm}
              step={0.1}
              min={1}
              onCommit={(v) => commit({ bossDiameterMm: v, bossDiameterAuto: false })}
            />
            <label className="number-field" style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <input
                type="checkbox"
                checked={params.bossDiameterAuto}
                data-testid="keycap-field-bossDiameterAuto"
                onChange={(e) => commit({ bossDiameterAuto: e.target.checked })}
              />
              <span>Tự động (kích thước an toàn tối thiểu)</span>
            </label>
          </div>
        </>
      )}

      <div className="transform-group-label" style={{ marginTop: 4 }}>
        Legend (chữ/icon trên phím)
      </div>

      <div className="transform-row" style={{ marginBottom: 6 }}>
        <label className="number-field" style={{ flex: 1 }}>
          <span>Loại</span>
          <div className="toolbar-group" style={{ gap: 2 }}>
            {LEGEND_KIND_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`toolbar-btn${params.legendKind === opt.value ? " active" : ""}`}
                data-testid={`keycap-legendKind-${opt.value}`}
                onClick={() => {
                  // Switching to Icon with text that isn't a real icon
                  // (e.g. leftover typed text, or blank) would silently
                  // render nothing -- default to the first icon so the
                  // tab always shows something selected/renderable.
                  if (opt.value === "icon" && !ICON_OPTIONS.some((i) => i.char === params.legendText)) {
                    commit({ legendKind: opt.value, legendText: ICON_OPTIONS[0].char });
                  } else {
                    commit({ legendKind: opt.value });
                  }
                }}
                style={{ padding: "4px 10px" }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </label>
      </div>

      {params.legendKind === "text" ? (
        <div className="transform-row" style={{ marginBottom: 6 }}>
          <TextAreaField fieldKey="legendText" label="Chữ" value={params.legendText} onCommit={(v) => commit({ legendText: v })} />
        </div>
      ) : (
        <div className="transform-row" style={{ marginBottom: 6 }}>
          <label className="number-field" style={{ flex: 1 }}>
            <span>Icon</span>
            <IconGrid value={params.legendText} onSelect={(char) => commit({ legendText: char })} />
          </label>
        </div>
      )}

      <div className="transform-row" style={{ marginBottom: 6 }}>
        <label className="number-field" style={{ flex: 1 }}>
          <span>Kiểu</span>
          <select
            value={params.legendMode}
            data-testid="keycap-field-legendMode"
            onChange={(e) => commit({ legendMode: e.target.value as KeycapParams["legendMode"] })}
            style={SELECT_STYLE}
          >
            <option value="none">Không</option>
            <option value="emboss">Nổi</option>
            <option value="engrave">Chìm</option>
          </select>
        </label>
        {params.legendKind === "text" && (
          <label className="number-field" style={{ flex: 1 }}>
            <span>Font</span>
            <select defaultValue="nunito-extrabold" data-testid="keycap-field-legendFont" style={SELECT_STYLE}>
              <option value="nunito-extrabold">Nunito ExtraBold</option>
            </select>
          </label>
        )}
      </div>

      {params.legendMode !== "none" && (
        <>
          <div className="transform-row" style={{ marginBottom: 6 }}>
            <label className="number-field" style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <input
                type="checkbox"
                checked={params.legendBubble}
                data-testid="keycap-field-legendBubble"
                onChange={(e) => commit({ legendBubble: e.target.checked })}
              />
              <span>Nền bong bóng chat</span>
            </label>
          </div>
          <div className="transform-row" style={{ marginBottom: 6 }}>
            <SliderField
              fieldKey="legendFontSize"
              label="Cỡ chữ"
              value={params.legendFontSizeMm}
              min={1}
              max={12}
              step={0.1}
              onCommit={(v) => commit({ legendFontSizeMm: v })}
            />
          </div>
          <div className="transform-row" style={{ marginBottom: 6 }}>
            <SliderField
              fieldKey="legendRelief"
              label="Độ nổi/chìm"
              value={params.legendReliefMm}
              min={0.1}
              max={1.5}
              step={0.05}
              onCommit={(v) => commit({ legendReliefMm: v })}
            />
          </div>
          {params.legendKind === "text" && (
            <div className="transform-row" style={{ marginBottom: 8 }}>
              <label className="number-field" style={{ flex: 1 }}>
                <span>Căn lề</span>
                <div className="toolbar-group" style={{ gap: 2 }}>
                  {ALIGN_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`toolbar-btn${params.legendAlign === opt.value ? " active" : ""}`}
                      title={opt.title}
                      data-testid={`keycap-align-${opt.value}`}
                      onClick={() => commit({ legendAlign: opt.value })}
                      style={{ padding: "4px 10px" }}
                    >
                      <AlignIcon align={opt.value} />
                    </button>
                  ))}
                </div>
              </label>
            </div>
          )}
        </>
      )}

      <div className="split-status" data-testid="keycap-status">
        Trạng thái:{" "}
        <span className={`split-status-${status === "generating" ? "processing" : status}`}>
          {status === "generating" ? "đang tạo" : status === "error" ? "lỗi" : "sẵn sàng"}
        </span>
      </div>
      {status === "error" && error && (
        <div className="split-error" data-testid="keycap-error">
          {error}
        </div>
      )}
    </div>
  );
}
