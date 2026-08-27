/**
 * M4 manual verification fixture (revision 13: multi-line legend auto-wrap
 * + left/center/right alignment, plus a Legend panel UI redesign in
 * apps/web matching the user's reference mockup): writes real .stl files
 * for a slicer check. Run:
 *
 *   npx tsx scripts/generate-m4-keycap-fixture.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createKeycapMesh, resolveKeycapParams, maxFlushSocketDepthMm, type KeycapParams } from "../src/generators/keycap.js";
import { exportSTLBinary } from "../src/stl.js";
import { computeBoundingBox, triangleCount } from "../src/mesh.js";
import { validateMesh } from "../src/validate.js";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "m4-keycap");
mkdirSync(outDir, { recursive: true });

const p = resolveKeycapParams({});

async function build(name: string, params: Partial<KeycapParams>) {
  const mesh = await createKeycapMesh(params);
  const box = computeBoundingBox(mesh);
  const report = validateMesh(mesh);
  writeFileSync(join(outDir, `${name}.stl`), Buffer.from(exportSTLBinary(mesh, name)));
  return { box, report, triangles: triangleCount(mesh) };
}

const defaultResult = await build("keycap_default", {});
const wrapResult = await build("keycap_legend_wrap_center", { legendText: "VIET ANH", legendMode: "emboss" });
const wrapLeftResult = await build("keycap_legend_wrap_left", { legendText: "VIET ANH", legendMode: "emboss", legendAlign: "left" });
const manualBreakResult = await build("keycap_legend_manual_break", { legendText: "GAME\nOVER", legendMode: "engrave" });
const iconStarResult = await build("keycap_icon_star_emboss", { legendText: "⭐", legendKind: "icon", legendMode: "emboss" });
const iconHeartResult = await build("keycap_icon_heart_engrave", { legendText: "❤", legendKind: "icon", legendMode: "engrave" });
const iconBrokenHeartResult = await build("keycap_icon_brokenheart_emboss", { legendText: "\u{1F494}", legendKind: "icon", legendMode: "emboss" });
const iconSparklesResult = await build("keycap_icon_sparkles_emboss", { legendText: "✨", legendKind: "icon", legendMode: "emboss" });
const iconChatResult = await build("keycap_icon_chatbubble_emboss", { legendText: "\u{1F4AC}", legendKind: "icon", legendMode: "emboss" });
const bubbleTextResult = await build("keycap_bubble_text_A_emboss", { legendText: "A", legendMode: "emboss", legendBubble: true });
const bubbleIconResult = await build("keycap_bubble_icon_star_emboss", { legendText: "⭐", legendKind: "icon", legendMode: "emboss", legendBubble: true });
const bubbleEngraveResult = await build("keycap_bubble_icon_heart_engrave", { legendText: "❤", legendKind: "icon", legendMode: "engrave", legendBubble: true });
const flushDepth = maxFlushSocketDepthMm(p.heightMm);
const flushBossResult = await build("keycap_flush_boss_max", { socketDepthMm: flushDepth });
const tallRibResult = await build("keycap_rib_height_tall", { switchType: "round", ribHeightMm: 7 });
const shortRibResult = await build("keycap_rib_height_short", { switchType: "round", ribHeightMm: 1.5 });

const notes = `# M4 Keycap Generator -- manual Bambu Studio verification (revision 22)

## Revision 22 (latest): rib height is now a directly-settable field
From a slicer preview screenshot, you asked for control over the height of
the 4 reinforcement ribs circled in red. New \`ribHeightMm\` param + "Chiều
cao rib" field in the Loại switch section -- previously this was only an
auto-derived value (boss height minus a fixed clearance), not something you
could adjust directly.
- Clamped at generation time to [1mm, boss's own height] regardless of what's
  typed -- a rib can't be taller than the boss it attaches to, and a sliver
  under 1mm isn't meaningfully different from no rib.
- Default (4.75mm) matches exactly what the old auto-derived formula
  produced for a default keycap, so existing keycaps look unchanged unless
  you touch this field.
- \`keycap_rib_height_tall.stl\` (ribHeightMm=7, close to the full boss
  height) and \`keycap_rib_height_short.stl\` (ribHeightMm=1.5, close to the
  minimum) below show the range -- compare them in Bambu Studio's slice
  preview the same way your screenshot showed the ribs.

## Revision 21: the "flush with bottom" max still wasn't actually flush -- fixed for real this time
You correctly caught that revision 20's max still stopped short of the
keycap's true bottom. Root cause: the field's UI max was a guessed margin
(heightMm - 1mm), AND the generator had a second, independent cap
(\`cavityTopZ + CUT_EXTENSION_MM\`, the cavity's own total span) that -- at
the default 1.5mm wall thickness -- stopped the boss about 1mm short of
z=0 regardless of what socketDepthMm was set to. That second cap wasn't
needed for correctness (the cavity is open at the bottom by construction;
nothing stops the boss filling it all the way down) -- removed it, so now
only the exact z>=0 constraint remains.

New exported helper \`maxFlushSocketDepthMm(heightMm)\` in keycap.ts computes
the EXACT socketDepthMm that lands the boss precisely flush -- the "Độ dài
chốt" field's max is now this exact value instead of a guessed margin, so
"type the max, hit Enter" genuinely reaches flush now. A new test probes a
diagonal point inside the boss's own footprint (clear of the cross cutter's
reach, which only extends along the X/Y axes) at z~0 and confirms real boss
material is actually there -- not just relying on the whole mesh's
bounding box, which is always ~0 regardless of the boss's own depth (the
shell's own skirt sits at z=0 no matter what).

\`keycap_flush_boss_max.stl\` below is built with socketDepthMm set to exactly
this new max -- please re-check the boss now genuinely reaches the bottom
in Bambu Studio (previous revision's file was still ~1mm short).

## Revision 20: boss depth field switched from a slider back to a number input, plus a reset button
Two more fixes from your feedback:

1. **Switched the depth control from a slider back to a plain number
   input** ("Độ dài chốt") -- you found the slider too imprecise/fiddly to
   drag to an exact value; typing a number is easier to fine-tune.
2. **"Đặt lại mặc định" (reset) button**, top-right of the keycap parameter
   panel -- resets every keycap param on the selected keycap back to
   DEFAULT_KEYCAP_PARAMS in one click (still one undo step, like every other
   edit).

## Revision 19: speech-bubble plaque background behind the legend
New "Nền bong bóng chat" (bubble background) checkbox in the Legend panel
(shown once Kiểu != Không). When on, a rounded-rect-plus-tail plaque -- the
white bubble shape from your reference mockup -- is embossed onto the top
face BEHIND the legend, always raised regardless of whether the legend
itself is set to emboss or engrave:
- **Emboss legend + bubble**: the legend sits on TOP of the raised plaque,
  like a badge -- its absolute peak is higher than a bubble-less emboss by
  exactly the plaque's own relief (~0.35mm, always kept a bit shorter than
  the legend's own relief so it reads as a background, not competing
  height).
- **Engrave legend + bubble**: the plaque is still raised (a background
  needs to exist to engrave INTO), and the legend recesses into the
  plaque's own raised face.
- Works with both legendKind: text and icon.
- The plaque body is sized to most of the top face (leaving the same kind
  of edge margin the legend itself respects) with a small pointed tail at
  the bottom, built as two overlapping prisms unioned into one solid --
  same "real geometric overlap, not just a touching seam" technique this
  generator already uses for the boss's reinforcement ribs.

New files: \`keycap_bubble_text_A_emboss.stl\`, \`keycap_bubble_icon_star_emboss.stl\`,
\`keycap_bubble_icon_heart_engrave.stl\`. 5 new tests in keycap.test.ts's own
describe block confirm: no effect when there's no legend, stays watertight
for text/icon and emboss/engrave, and the plaque genuinely raises the
legend's peak height in emboss mode.

## Revision 18: added the chat/speech-bubble icon (💬)
You asked for "the white chat icon" from that same reference image. That
image's white speech-bubble shapes are a UI/background element sitting
BEHIND every icon in that product's picker (a styling choice for their own
keycap renders), not something this app draws around icons -- so rather
than guess at reproducing that background styling, this adds the actual
speech-bubble emoji (💬) itself as one more selectable icon, the same way
every other icon in the picker works. If you actually want a bubble-shaped
background plate embossed behind every icon (not just this one new icon
option), that is a bigger, separate geometry feature -- let me know and
we can scope it properly.
\`keycap_icon_chatbubble_emboss.stl\` below is this new icon.

## Revision 17: icon picker expanded to 32 icons
Based on a reference image of a pastel keycap set (smiley/frown faces,
hearts, sparkles, arrows, symbols), added 10 more icons after test-extruding
each candidate individually -- same standard as the original 22, every icon
offered has actually been verified to produce a clean, watertight solid, not
just assumed to work because it exists in the font:
frown (☹), broken heart (💔), sparkles (✨), exclamation (❗), double
exclamation (‼), arrow down (⬇), infinity (♾), circle (⭕), club (♣),
sparkling heart (💖).

Tried and rejected from that same reference image (self-intersecting
outline geometry, same failure mode as revision 14's rejects): two-hearts /
revolving-hearts, sleeping face, a "cyclone" spiral, laughing face, crying
face. "HA HA" and other multi-character text bubbles in the reference
aren't single icons at all -- those are just regular text, already
supported by Kind: Text.

\`keycap_icon_brokenheart_emboss.stl\` and \`keycap_icon_sparkles_emboss.stl\`
below are 2 of the new icons, so you can check legibility at print size.

## Revision 16: ribs shortened, no longer reach the socket entrance
You marked (in a render screenshot) that the 4 reinforcement ribs looked too
tall/protruded too far. Ribs used to run the boss's FULL height, entrance to
ceiling -- same class of problem as revision 15's chamfer fix: something
right at the socket mouth interfering with the switch. Ribs still attach to
the ceiling (where the lateral/torque load actually needs to transfer into
the shell), but now stop 2.75mm short of the entrance instead of reaching
all the way down to it, leaving that zone clear for the switch's own
plastic housing to approach.
- New constant \`RIB_ENTRANCE_CLEARANCE_MM = 2.75\` (how much clearance to
  leave at the bottom).
- New constant \`MIN_RIB_HEIGHT_MM = 1.0\` (floor so a very shallow socket
  doesn't compute a negative/degenerate rib height -- ribs shrink toward
  this floor rather than disappearing entirely).
- A new test (\`keycap.test.ts\`, rib describe block) locks this in: probes
  right at the entrance, outside the boss's own radius (where a full-height
  rib used to sit), and asserts it's now empty.

\`keycap_default.stl\` below is this revision's build -- please check the
ribs visually (should now clearly stop short of the bottom opening, not
reach it) and test-fit a real switch again.

## Revision 15: wider entrance chamfer -- real print showed the switch stem couldn't start entering the socket mouth at all
You reported the stem was blocked right at the entrance, not partway down --
a mouth-sizing problem, not a depth problem. The entrance chamfer (a short
flare at just the very mouth of the cross/socket cutter, leaving the
nominal cross span/arm width and boss wall untouched everywhere deeper) was
too small to survive ordinary FDM hole-shrinkage on top of this cutter's
already tiny nominal tolerance:
- \`ENTRANCE_CHAMFER_MM\` (how much wider the mouth is per side): 0.1mm -> 0.3mm
- \`ENTRANCE_CHAMFER_HEIGHT_MM\` (how tall that flared zone is): 0.25mm -> 0.6mm

Everything below the entrance zone -- the cross's own 4.00mm span / 1.50mm
arm width, the 5.50mm boss diameter, the 6.75mm socket depth -- is
unchanged; only the very lead-in got wider and taller to give the stem more
room to start engaging before it has to fit the nominal (tight) cross shape.
\`keycap_default.stl\` below is this revision's build -- please test-fit a
real switch into this file specifically before anything else in this
folder.

New in revision 14 (carried over unchanged in this build): **an icon/emoji legend picker** (the "Icon/Color/Motion/
Sound" panel from your second mockup image -- this covers the icon-picking
part; color/motion/sound don't apply to a physical 3D print). Also carried
over from revision 13 in these same files: multi-line legend auto-wrap and
left/center/right alignment, and the Legend panel UI redesign (Font
dropdown, Size/Relief sliders, Align 3-button group).

## 0. Icon/emoji legend (new)
The Legend panel now has a **Kind: Text / Icon** toggle. Text mode is
everything from before (typed text, wrapping, alignment). Icon mode swaps
the text field for a grid of 22 curated icons; picking one embosses/engraves
that icon the same way a typed letter would, through the exact same
extrusion pipeline -- an icon isn't a special case internally, it's a
different embedded font (a subset of Google's Noto Emoji, the monochrome/
outline member of that family, licensed SIL OFL -- see
assets/fonts/NOTICE.md) feeding the same code path.

**Why only 22 icons, not "any emoji":** every candidate was actually test-
extruded, not just assumed to work. A handful of Noto Emoji's more elaborate
glyphs -- skull, trophy, cat face, crown, rocket, light bulb, and a few
others -- draw themselves with self-intersecting compound strokes that
don't triangulate into a single clean solid (verified: they come out with
dozens to thousands of open edges, i.e. actual holes in the mesh, not a
cosmetic issue). Those were dropped from the picker rather than shipped
broken. The 22 that remain -- check, cross, star, heart, question mark,
music note, dollar sign, ghost, fire, lightning bolt, game controller,
dice, dog, moon, smiley, sun, gem, key, lock, gear, anchor, snowflake --
all verified to extrude and boolean cleanly.

One caveat worth knowing: "heart" in particular has a sharp cusp point at
its bottom tip, and the boolean union/subtract step with the keycap shell
occasionally leaves 1-3 zero-area sliver triangles at that touch point (see
keycap.test.ts's icon describe block for the full explanation). This is
confirmed to be a manifold-3d boolean-engine numerical artifact, not a hole
in the mesh -- there are zero open edges and zero non-manifold edges, so a
slicer silently discards the sliver. keycap_icon_heart_engrave.stl below is
exactly this case, included so you can see for yourself in Bambu Studio
that it slices clean.

## 1. Multi-line auto-wrap
Multi-word legend text now auto-wraps onto multiple lines when that lets it
render BIGGER/more legible than cramming everything onto one line -- e.g.
"VIET ANH" on an 18.5mm keycap wraps to 2 lines ("VIET" / "ANH") rather than
shrinking to fit one line. The algorithm tries every line count up to 3 and
every way to split the words across those lines, and picks whichever
arrangement yields the largest resulting cap height -- confirmed by a
dedicated test that 2-line wrapping beats a forced single line for this
exact case.

## 1. Multi-line auto-wrap
Multi-word legend text now auto-wraps onto multiple lines when that lets it
render BIGGER/more legible than cramming everything onto one line -- e.g.
"VIET ANH" on an 18.5mm keycap wraps to 2 lines ("VIET" / "ANH") rather than
shrinking to fit one line. The algorithm tries every line count up to 3 and
every way to split the words across those lines, and picks whichever
arrangement yields the largest resulting cap height -- confirmed by a
dedicated test that 2-line wrapping beats a forced single line for this
exact case.

Explicit '\\n' in the text (typeable in the app's Text field, now a
multi-line textarea) is honored as a manual line break instead of the
auto-wrap search -- see keycap_legend_manual_break.stl ("GAME" / "OVER").

## 2. Alignment (left / center / right)
New \`legendAlign\` param controls how shorter lines sit within the overall
text block's width -- a no-op for single-line text (already centered as a
block regardless). The overall multi-line block itself always stays
centered on the keycap's top face, independent of this setting -- confirmed
by a dedicated test.

## 3. Legend panel UI (apps/web) -- redesigned to match your mockup
- **Text** is now a multi-line textarea (Enter inserts a real line break).
- **Font** dropdown added (currently one entry, "Nunito ExtraBold" -- the
  only font this codebase has embedded; the control is there and honestly
  single-option rather than pretending to offer choices that don't exist).
- **Size** and **Relief** are now slider + live numeric readout, matching
  the mockup's slider style (still commit-on-release, not on every drag
  tick, to avoid regenerating the mesh dozens of times per drag).
- **Align** is a new 3-button group (left/center/right) with a small icon
  per option.

## Files
### keycap_default.stl (Cherry MX, no legend)
Bounding box: ${defaultResult.box.size[0].toFixed(3)} x ${defaultResult.box.size[1].toFixed(3)} x ${defaultResult.box.size[2].toFixed(3)} mm.
Triangles: ${defaultResult.triangles}. Watertight: ${defaultResult.report.isWatertight}.

### keycap_legend_wrap_center.stl ("VIET ANH", emboss, align=center -- the default)
Auto-wraps to 2 lines ("VIET" / "ANH"), each centered.
Bounding box: ${wrapResult.box.size[0].toFixed(3)} x ${wrapResult.box.size[1].toFixed(3)} x ${wrapResult.box.size[2].toFixed(3)} mm.
Triangles: ${wrapResult.triangles}. Watertight: ${wrapResult.report.isWatertight}.

### keycap_legend_wrap_left.stl ("VIET ANH", emboss, align=left)
Same 2-line wrap, but each line's left edge aligns instead of centering.
Bounding box: ${wrapLeftResult.box.size[0].toFixed(3)} x ${wrapLeftResult.box.size[1].toFixed(3)} x ${wrapLeftResult.box.size[2].toFixed(3)} mm.
Triangles: ${wrapLeftResult.triangles}. Watertight: ${wrapLeftResult.report.isWatertight}.

### keycap_legend_manual_break.stl ("GAME\\nOVER", engrave, explicit line break)
Bounding box: ${manualBreakResult.box.size[0].toFixed(3)} x ${manualBreakResult.box.size[1].toFixed(3)} x ${manualBreakResult.box.size[2].toFixed(3)} mm.
Triangles: ${manualBreakResult.triangles}. Watertight: ${manualBreakResult.report.isWatertight}.

### keycap_icon_star_emboss.stl (icon legend, star, emboss)
Bounding box: ${iconStarResult.box.size[0].toFixed(3)} x ${iconStarResult.box.size[1].toFixed(3)} x ${iconStarResult.box.size[2].toFixed(3)} mm.
Triangles: ${iconStarResult.triangles}. Watertight: ${iconStarResult.report.isWatertight}.

### keycap_icon_heart_engrave.stl (icon legend, heart, engrave -- see the heart caveat above)
Bounding box: ${iconHeartResult.box.size[0].toFixed(3)} x ${iconHeartResult.box.size[1].toFixed(3)} x ${iconHeartResult.box.size[2].toFixed(3)} mm.
Triangles: ${iconHeartResult.triangles}. Watertight: ${iconHeartResult.report.isWatertight} (see note above: has 1-3 harmless zero-area slivers, no open edges).

### keycap_icon_brokenheart_emboss.stl (new in revision 17, emboss)
Bounding box: ${iconBrokenHeartResult.box.size[0].toFixed(3)} x ${iconBrokenHeartResult.box.size[1].toFixed(3)} x ${iconBrokenHeartResult.box.size[2].toFixed(3)} mm.
Triangles: ${iconBrokenHeartResult.triangles}. Watertight: ${iconBrokenHeartResult.report.isWatertight}.

### keycap_icon_sparkles_emboss.stl (new in revision 17, emboss)
Bounding box: ${iconSparklesResult.box.size[0].toFixed(3)} x ${iconSparklesResult.box.size[1].toFixed(3)} x ${iconSparklesResult.box.size[2].toFixed(3)} mm.
Triangles: ${iconSparklesResult.triangles}. Watertight: ${iconSparklesResult.report.isWatertight}.

### keycap_icon_chatbubble_emboss.stl (new in revision 18, emboss)
Bounding box: ${iconChatResult.box.size[0].toFixed(3)} x ${iconChatResult.box.size[1].toFixed(3)} x ${iconChatResult.box.size[2].toFixed(3)} mm.
Triangles: ${iconChatResult.triangles}. Watertight: ${iconChatResult.report.isWatertight}.

### keycap_bubble_text_A_emboss.stl (new in revision 19: text "A" + bubble background, emboss)
Bounding box: ${bubbleTextResult.box.size[0].toFixed(3)} x ${bubbleTextResult.box.size[1].toFixed(3)} x ${bubbleTextResult.box.size[2].toFixed(3)} mm.
Triangles: ${bubbleTextResult.triangles}. Watertight: ${bubbleTextResult.report.isWatertight}.

### keycap_bubble_icon_star_emboss.stl (new in revision 19: icon star + bubble background, emboss)
Bounding box: ${bubbleIconResult.box.size[0].toFixed(3)} x ${bubbleIconResult.box.size[1].toFixed(3)} x ${bubbleIconResult.box.size[2].toFixed(3)} mm.
Triangles: ${bubbleIconResult.triangles}. Watertight: ${bubbleIconResult.report.isWatertight}.

### keycap_bubble_icon_heart_engrave.stl (new in revision 19: icon heart + bubble background, engrave)
Bounding box: ${bubbleEngraveResult.box.size[0].toFixed(3)} x ${bubbleEngraveResult.box.size[1].toFixed(3)} x ${bubbleEngraveResult.box.size[2].toFixed(3)} mm.
Triangles: ${bubbleEngraveResult.triangles}. Watertight: ${bubbleEngraveResult.report.isWatertight}.

### keycap_flush_boss_max.stl (revision 21: socketDepthMm = maxFlushSocketDepthMm(heightMm), boss genuinely flush with bottom)
Bounding box: ${flushBossResult.box.size[0].toFixed(3)} x ${flushBossResult.box.size[1].toFixed(3)} x ${flushBossResult.box.size[2].toFixed(3)} mm.
Triangles: ${flushBossResult.triangles}. Watertight: ${flushBossResult.report.isWatertight}.

### keycap_rib_height_tall.stl (revision 22: ribHeightMm=7, round socket)
Bounding box: ${tallRibResult.box.size[0].toFixed(3)} x ${tallRibResult.box.size[1].toFixed(3)} x ${tallRibResult.box.size[2].toFixed(3)} mm.
Triangles: ${tallRibResult.triangles}. Watertight: ${tallRibResult.report.isWatertight}.

### keycap_rib_height_short.stl (revision 22: ribHeightMm=1.5, round socket)
Bounding box: ${shortRibResult.box.size[0].toFixed(3)} x ${shortRibResult.box.size[1].toFixed(3)} x ${shortRibResult.box.size[2].toFixed(3)} mm.
Triangles: ${shortRibResult.triangles}. Watertight: ${shortRibResult.report.isWatertight}.

## What to check
1. **2-line legends read clearly**, each line legible, not overlapping.
2. **Left vs center alignment visibly differs** between the two "VIET ANH"
   files -- left-aligned lines should share a left edge; centered lines
   should each be individually centered.
3. **Manual '\\n' break** produces exactly the requested 2 lines, not an
   auto-wrap decision.
4. **Icon legends look right and print clean** -- check the star (emboss)
   and heart (engrave) files render as a real recognizable star/heart at a
   size that will actually resolve at a 0.4mm nozzle, and that the heart
   file slices with no repair warnings despite the internal sliver-triangle
   note above.
5. **App UI**: adding a keycap shows the new Legend panel layout (Kind
   toggle, textarea or icon grid depending on Kind, Font dropdown,
   Size/Relief sliders, Align buttons); dragging a slider only commits/
   regenerates once on release, not continuously; switching Kind to Icon
   with no icon picked yet defaults to the first icon rather than showing
   nothing.
6. **Watertight / slices without repair warnings** on all six files (see
   the heart caveat for what "watertight" means there specifically).
7. **Undo/Redo** for legendKind, legendAlign, and the slider-driven fields
   -- confirmed already via direct store inspection in this session,
   re-check via the actual UI controls too if convenient.

## Known limitations (stated explicitly)
- Only one text font (Nunito ExtraBold) is embedded -- the Font dropdown
  has exactly one entry, not a placeholder for more that don't exist yet.
- Auto-wrap search is capped at 3 lines and tries every word-partition
  combination -- fine for short legends (a handful of words), not
  benchmarked for very long paragraphs (not a realistic keycap use case).
- The icon picker offers 22 curated icons, not the full mockup's grid --
  see the "why only 22" note above for exactly which glyphs were tried and
  rejected, and why.
- Color/Motion/Sound tabs from your second mockup image don't apply to a
  physical 3D print and were not built.
`;

writeFileSync(join(outDir, "README.md"), notes);
console.log(`Wrote fixtures to ${outDir}`);
console.log(`default: bbox=${JSON.stringify(defaultResult.box.size)} watertight=${defaultResult.report.isWatertight} triangles=${defaultResult.triangles}`);
console.log(`wrap center: bbox=${JSON.stringify(wrapResult.box.size)} watertight=${wrapResult.report.isWatertight} triangles=${wrapResult.triangles}`);
console.log(`wrap left: bbox=${JSON.stringify(wrapLeftResult.box.size)} watertight=${wrapLeftResult.report.isWatertight} triangles=${wrapLeftResult.triangles}`);
console.log(`manual break: bbox=${JSON.stringify(manualBreakResult.box.size)} watertight=${manualBreakResult.report.isWatertight} triangles=${manualBreakResult.triangles}`);
