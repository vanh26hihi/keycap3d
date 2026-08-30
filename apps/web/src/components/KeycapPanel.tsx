"use client";

import { useEffect, useState } from "react";
import { DEFAULT_KEYCAP_PARAMS, maxFlushSocketDepthMm, type KeycapParams } from "@keycap-web/geometry-core/keycap";
import { ICON_OPTIONS } from "@keycap-web/geometry-core/icons";
import { getPixelIconGrid } from "@keycap-web/geometry-core/pixelIcons";
import { useEditorStore } from "../state/store";
import { loadSavedDefaultParams, saveDefaultParams } from "../lib/keycapDefaults";

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
  title,
  value,
  onCommit,
  rows = 2,
}: {
  fieldKey: string;
  label: string;
  title?: string;
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
    <label className="number-field" style={{ flex: 1 }} title={title}>
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

/** A native color swatch + hex readout for one keycap part's export color
 *  (see KeycapParams.baseColorHex etc.) -- purely 3MF-export metadata, no
 *  live viewport effect (the 3D preview always renders the single fused
 *  mesh in one material, same as before this field existed), so this is
 *  deliberately compact rather than styled to look like a "real" part of
 *  the object's own appearance. */
function ColorField({ fieldKey, label, value, onCommit }: { fieldKey: string; label: string; value: string; onCommit: (v: string) => void }) {
  return (
    <label className="number-field" style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
      <input
        type="color"
        value={value}
        data-testid={`keycap-color-${fieldKey}`}
        onChange={(e) => onCommit(e.target.value)}
        style={{ width: 28, height: 22, padding: 0, border: "1px solid #3a3f47", borderRadius: 2, background: "none" }}
      />
      <span style={{ fontSize: 12 }}>{label}</span>
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
  smiley: "Mặt cười",
  neutralFace: "Mặt bình thường",
  haha: "Haha",
  sparkle: "Lấp lánh",
  heart: "Trái tim (viền)",
  heartFilled: "Trái tim",
  brokenHeart: "Trái tim vỡ",
  starFilled: "Ngôi sao",
  bulb: "Bóng đèn / ý tưởng",
  sparkleCluster: "Chùm lấp lánh",
  music: "Nốt nhạc",
  dollar: "Đô la",
  clover: "Cỏ 4 lá",
  arrowDown: "Mũi tên xuống",
  sleepZ: "Ngủ (Z)",
  question: "Dấu hỏi",
  exclamation: "Dấu chấm than",
  splash: "Pháo hoa",
  infinity: "Vô cực",
  cross: "Dấu X",
  circleO: "Vòng tròn",
  sparklingHeart: "Trái tim lấp lánh",
  legacyCheck: "Dấu tích",
  legacyCross: "Dấu X",
  legacyStar: "Ngôi sao",
  legacyHeart: "Trái tim",
  legacyQuestion: "Dấu hỏi",
  legacyMusic: "Nốt nhạc",
  legacyDollar: "Đô la",
  legacyGhost: "Ma",
  legacyFire: "Lửa",
  legacyBolt: "Tia sét",
  legacyController: "Tay cầm game",
  legacyDice: "Xúc xắc",
  legacyDog: "Chó",
  legacyMoon: "Mặt trăng",
  legacySmiley: "Mặt cười",
  legacySun: "Mặt trời",
  legacyGem: "Đá quý",
  legacyKey: "Chìa khóa",
  legacyLock: "Ổ khóa",
  legacyGear: "Bánh răng",
  legacyAnchor: "Mỏ neo",
  legacySnowflake: "Bông tuyết",
  legacyFrown: "Mặt buồn",
  legacyBrokenHeart: "Trái tim vỡ",
  legacySparkles: "Lấp lánh",
  legacyExclamation: "Dấu chấm than",
  legacyDoubleExclamation: "Hai dấu chấm than",
  legacyArrowDown: "Mũi tên xuống",
  legacyInfinity: "Vô cực",
  legacyCircle: "Vòng tròn",
  legacyClub: "Chủ bài (♣)",
  legacySparklingHeart: "Trái tim lấp lánh",
  legacyChatBubble: "Bong bóng chat",
  legacyCollision: "Va chạm / tức giận",
};

/** Renders one icon's preview: a pixel icon (see geometry-core's
 *  pixelIcons.ts) draws its own boolean grid as a small SVG of filled
 *  squares -- the exact bitmap the generator extrudes into print geometry
 *  -- while a legacy emoji-font icon has no such grid (`char` is a literal
 *  Unicode character for those), so it just renders that character via the
 *  browser's own system emoji font, same as before this app had pixel
 *  icons at all. */
function IconPreview({ iconId }: { iconId: string }) {
  const grid = getPixelIconGrid(iconId);
  if (!grid) return <span style={{ fontSize: 16, lineHeight: 1 }}>{iconId}</span>;
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const cell = 100 / Math.max(rows, cols);
  return (
    <svg viewBox="0 0 100 100" width={22} height={22} style={{ display: "block" }}>
      {grid.flatMap((row, r) =>
        row.map((on, c) =>
          on ? <rect key={`${r}-${c}`} x={c * cell} y={r * cell} width={cell + 0.5} height={cell + 0.5} fill="currentColor" /> : null,
        ),
      )}
    </svg>
  );
}

/** Lets the user type an icon's id (e.g. "heart", "haha", "legacyGhost")
 *  directly instead of hunting through the button grid -- looked up
 *  case-insensitively against ICON_OPTIONS' own `id`s, the same names
 *  shown as each button's tooltip. Same local-state + commit-on-blur/Enter
 *  pattern as every other field here (TextAreaField, NumberField): typing
 *  doesn't touch the store until the field loses focus, and an unrecognized
 *  id just reverts the display back to the current selection rather than
 *  clearing it -- there's no "blank" icon state to fall into.
 *
 *  Also accepts pasting/typing the icon's own literal character directly
 *  (e.g. an emoji like "💢" for one of the legacy emoji-font icons) -- an
 *  exact, case-sensitive match against `char`, checked alongside the
 *  case-insensitive `id` match, since a legacy icon's `char` IS a real
 *  Unicode character a user might reasonably paste in expecting it to
 *  "just work" rather than needing to know its internal id name. A pixel
 *  icon's own `char` is just its id string again, so this never conflicts
 *  with the id-name lookup for that set. */
function findIconMatch(text: string) {
  const trimmed = text.trim();
  return ICON_OPTIONS.find((o) => o.id.toLowerCase() === trimmed.toLowerCase() || o.char === trimmed);
}

function IconIdField({ value, onSelect }: { value: string; onSelect: (char: string) => void }) {
  const currentId = ICON_OPTIONS.find((o) => o.char === value)?.id ?? "";
  const [text, setText] = useState(currentId);
  const [focused, setFocused] = useState(false);
  const [invalid, setInvalid] = useState(false);

  // Only re-syncs `text` from the external `value` prop while the field
  // isn't focused (e.g. the user clicked a grid button instead) -- doesn't
  // touch `invalid` here, so a failed commit's red border stays visible
  // until the user actually edits again, instead of a same-render effect
  // silently clearing it right after commit() just set it.
  useEffect(() => {
    if (!focused) setText(currentId);
  }, [currentId, focused]);

  const commit = () => {
    setFocused(false);
    const match = findIconMatch(text);
    if (match) {
      setInvalid(false);
      if (match.char !== value) onSelect(match.char);
    } else {
      setInvalid(true);
      setText(currentId);
    }
  };

  // Live preview as the user types -- matched from the live `text` state,
  // not just on commit/blur, so they see the icon shape immediately
  // instead of having to blur first or go hunting through the grid below.
  const liveMatch = findIconMatch(text);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
      <input
        type="text"
        value={text}
        data-testid="keycap-icon-id-field"
        placeholder="Gõ tên icon (vd: heart) hoặc dán icon 😀 -- chỉ nhận icon có trong danh sách bên dưới"
        title="Gõ đúng tên icon HOẶC dán thẳng ký tự icon (xem chú thích khi rê chuột vào từng ô bên dưới) rồi Enter/bấm ra ngoài -- chỉ nhận icon có trong danh sách, không phải icon bất kỳ"
        onFocus={() => setFocused(true)}
        onChange={(e) => {
          setText(e.target.value);
          setInvalid(false);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        style={{
          background: "#14171a",
          border: `1px solid ${invalid ? "#c9564f" : "#3a3f47"}`,
          color: "#e6e6e6",
          borderRadius: 2,
          padding: 4,
          fontFamily: "inherit",
          fontSize: 12,
          flex: 1,
        }}
      />
      <div
        data-testid="keycap-icon-id-preview"
        title={liveMatch ? (ICON_LABELS_VI[liveMatch.id] ?? liveMatch.label) : undefined}
        style={{
          width: 26,
          height: 26,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#14171a",
          border: "1px solid #3a3f47",
          borderRadius: 2,
          color: "#e6e6e6",
        }}
      >
        {liveMatch && <IconPreview iconId={liveMatch.char} />}
      </div>
    </div>
  );
}

/** Grid of the curated icon options (see geometry-core's icons.ts -- this
 *  is the exact same list the generator can actually extrude; there's no
 *  separate "UI icon set" to keep in sync). Combines the pixel-art icon
 *  set with the original emoji-font set. */
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
          style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "4px 0" }}
        >
          <IconPreview iconId={icon.char} />
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
export function KeycapPanel({
  nodeId,
  params,
  batchNodeIds,
}: {
  nodeId: string;
  params: KeycapParams;
  /** When set (multi-select, 2+ keycaps all selected), every field commit
   *  applies to ALL of these node ids at once (as one undo step) instead of
   *  just `nodeId` -- `nodeId`'s own current params (the `params` prop) are
   *  what the fields DISPLAY, but committing a change merges it into each
   *  listed node's own individual params, not overwriting them wholesale
   *  with the primary node's values. */
  batchNodeIds?: string[];
}) {
  const updateKeycapParams = useEditorStore((s) => s.updateKeycapParams);
  const updateKeycapParamsBatch = useEditorStore((s) => s.updateKeycapParamsBatch);
  const status = useEditorStore((s) => s.keycapStatus);
  const error = useEditorStore((s) => s.keycapError);
  const isBatch = !!batchNodeIds && batchNodeIds.length > 1;
  const commit = (partial: Partial<KeycapParams>) =>
    void (isBatch ? updateKeycapParamsBatch(batchNodeIds!, partial) : updateKeycapParams(nodeId, partial));

  // Plain, simple text commit -- this field just edits THIS keycap's (or
  // every batch-selected keycap's) own legend text. Creating a whole SET of
  // new keycaps from a phrase is a deliberate, separate action now (the
  // "+ Tạo hàng loạt từ chữ" dialog, confirmed explicitly before anything
  // is created) rather than an implicit side effect of typing a space into
  // this field -- typing "ESC CTRL ALT" here used to silently spawn 2 EXTRA
  // keycaps, which fought with "just edit this keycap's label" as the
  // field's other, more common use.
  const commitLegendText = (value: string) => commit({ legendText: value });

  return (
    <div className="transform-group" data-testid="keycap-panel">
      <div className="transform-row" style={{ marginBottom: 6, justifyContent: "space-between", alignItems: "center" }}>
        <div className="transform-group-label" style={{ marginBottom: 0 }}>
          Thông số keycap (mm)
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            type="button"
            className="toolbar-btn"
            data-testid="keycap-save-default-btn"
            title="Lưu toàn bộ thông số hiện tại làm mặc định cho lần sau -- áp dụng khi bấm + Keycap hoặc mở lại trang, không cần chỉnh lại từ đầu"
            onClick={() => saveDefaultParams(params)}
          >
            Lưu làm mặc định
          </button>
          <button
            type="button"
            className="toolbar-btn"
            data-testid="keycap-reset-btn"
            title="Đặt lại về thông số mặc định đã lưu (hoặc mặc định gốc nếu chưa lưu gì)"
            onClick={() => commit(loadSavedDefaultParams() ?? DEFAULT_KEYCAP_PARAMS)}
          >
            Đặt lại mặc định
          </button>
        </div>
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
            <label className="number-field" style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <input
                type="checkbox"
                checked={params.stemSeparate}
                data-testid="keycap-field-stemSeparate"
                onChange={(e) => commit({ stemSeparate: e.target.checked })}
              />
              <span>Tách rời chốt (in riêng, dán lại)</span>
            </label>
          </div>

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

          {!params.stemSeparate && (
            <div className="transform-row" style={{ marginBottom: 6 }}>
              <NumberField
                fieldKey="ribHeight"
                label="Chiều cao rib"
                title="Chiều cao 4 rib gia cường quanh chốt -- không thể cao hơn chính chốt. Ẩn khi 'Tách rời chốt' bật vì chốt rời không có rib để hàn vào vỏ."
                value={params.ribHeightMm}
                min={1}
                max={Math.min(params.socketDepthMm + 0.75, params.heightMm)}
                step={0.1}
                onCommit={(v) => commit({ ribHeightMm: v })}
              />
            </div>
          )}

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

          {params.stemSeparate && (
            <div className="transform-row" style={{ marginBottom: 6, alignItems: "flex-end", flexWrap: "wrap" }}>
              <NumberField
                fieldKey="stemPlateWidth"
                label="Rộng đế chốt"
                title="Kích thước đế phẳng của chốt rời -- mặc định tự vừa khít lỗ hõm đáy keycap (không phải bằng mặt ngoài keycap, vì đế to bằng mặt ngoài sẽ không lọt qua lỗ hõm để dán vào trần được)"
                value={params.stemPlateWidthMm}
                step={0.1}
                min={2}
                onCommit={(v) => commit({ stemPlateWidthMm: v, stemPlateAuto: false })}
              />
              <NumberField
                fieldKey="stemPlateLength"
                label="Dài đế chốt"
                value={params.stemPlateLengthMm}
                step={0.1}
                min={2}
                onCommit={(v) => commit({ stemPlateLengthMm: v, stemPlateAuto: false })}
              />
              <label className="number-field" style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <input
                  type="checkbox"
                  checked={params.stemPlateAuto}
                  data-testid="keycap-field-stemPlateAuto"
                  onChange={(e) => commit({ stemPlateAuto: e.target.checked })}
                />
                <span>Tự động (vừa khít lỗ hõm)</span>
              </label>
            </div>
          )}
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
          <TextAreaField
            fieldKey="legendText"
            label="Chữ"
            title="Chữ/icon hiện trên keycap này. Enter (xuống dòng) = nhiều dòng trên cùng 1 keycap. Muốn tạo nhiều keycap cùng lúc từ 1 câu, dùng nút '+ Tạo hàng loạt từ chữ' ở thanh công cụ."
            value={params.legendText}
            onCommit={commitLegendText}
          />
        </div>
      ) : (
        <div className="transform-row" style={{ marginBottom: 6 }}>
          <label className="number-field" style={{ flex: 1 }}>
            <span>Icon</span>
            <IconIdField value={params.legendText} onSelect={(char) => commit({ legendText: char })} />
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

      <div className="transform-group-label" style={{ marginTop: 4, marginBottom: 4 }}>
        Màu từng lớp (xuất 3MF đa màu)
      </div>
      <div className="transform-row" style={{ marginBottom: 6, flexWrap: "wrap" }} title="Chỉ dùng khi xuất 'Xuất 3MF đa màu' -- không đổi màu trên khung xem 3D">
        <ColorField fieldKey="base" label="Vỏ" value={params.baseColorHex} onCommit={(v) => commit({ baseColorHex: v })} />
        <ColorField fieldKey="bubble" label="Nền bong bóng" value={params.bubbleColorHex} onCommit={(v) => commit({ bubbleColorHex: v })} />
        <ColorField fieldKey="legend" label="Chữ/Icon" value={params.legendColorHex} onCommit={(v) => commit({ legendColorHex: v })} />
        {params.stemSeparate && (
          <ColorField fieldKey="stem" label="Chốt rời" value={params.stemColorHex} onCommit={(v) => commit({ stemColorHex: v })} />
        )}
      </div>

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
