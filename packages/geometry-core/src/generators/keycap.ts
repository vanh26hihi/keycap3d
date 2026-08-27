import type { MeshBuffer } from "../mesh";
import { applyTransformToMesh } from "../transform";
import { mergeMeshes } from "../mesh";
import { roundedRectProfile } from "../primitives/roundedRect";
import { createCubeMesh } from "../primitives/cube";
import { createCylinderMesh } from "../primitives/cylinder";
import { loftProfiles } from "./loft";
import { layoutLegendIslands, type LegendAlign } from "./legendLayout";
import { getLegendFont } from "./legendFont";
import { getPixelIconGrid } from "./pixelIcons";
import { pixelIconIslands } from "./pixelTrace";
import { getIconFont } from "./iconFont";
import { extrudeGlyphIsland } from "./glyphExtrude";
import { createBooleanEngine, type BooleanEngine } from "../boolean";

/** Identifies which physical switch a keycap's socket is cut to fit. Each id
 *  maps to an entry in STEM_PROFILES below -- adding support for a new
 *  switch family (e.g. Kailh Choc's low-profile stem, which is NOT
 *  MX-compatible and needs its own cutter shape) means adding one entry
 *  there, not touching the geometry pipeline in createKeycapMesh. */
export type SwitchType = "cherry-mx" | "round" | "none";

export interface KeycapParams {
  /** Base footprint, mm. */
  widthMm: number;
  lengthMm: number;
  /** Base-to-top height, mm. */
  heightMm: number;
  /** How much smaller the top footprint is than the base, per side, mm --
   *  controls the classic keycap taper/slope. 0 = straight (untapered) walls. */
  topInsetMm: number;
  /** Corner radius of the base footprint, mm. The top footprint's corner
   *  radius is `max(cornerRadiusMm - topInsetMm, 0)` so the taper reads as a
   *  consistent bevel, not a radius that suddenly changes. */
  cornerRadiusMm: number;
  /** Shell wall thickness, mm. The keycap is hollow (open at the bottom, like
   *  a real keycap) with this thickness on the side walls and the top.
   *  0 disables the cavity (and therefore the socket, which is cut into a
   *  boss that only exists inside the cavity) entirely: a solid keycap. */
  wallThicknessMm: number;
  /**
   * Switch/stem profile. "cherry-mx" fits Cherry MX and the many
   * MX-compatible switches (Gateron, Kailh, Outemu, etc. -- anything using
   * the standard 4-arm cross stem); "round" is a generic cylindrical socket
   * for anything else; "none" omits the socket and boss entirely.
   */
  switchType: SwitchType;
  /** Round socket diameter, mm (used when switchType === "round"). */
  socketDiameterMm: number;
  /** Socket depth, mm (blind hole -- never reaches the boss's own top, which
   *  is what guarantees it can't puncture the keycap's outer top surface). */
  socketDepthMm: number;
  /** Diameter of the solid boss the socket is drilled into, mm. Ignored
   *  (auto-computed from the active profile's characteristic width, see
   *  resolveKeycapParams) unless `bossDiameterAuto` is false. Either way,
   *  createKeycapMesh independently clamps it up to the minimum safe size
   *  for the active profile -- this field can never actually produce a wall
   *  thinner than MIN_STEM_WALL_MM, even if set directly without going
   *  through resolveKeycapParams. */
  bossDiameterMm: number;
  /** When true (the default), bossDiameterMm is ignored and recomputed as
   *  the smallest size that keeps a safe wall around the active profile's
   *  socket/cross -- not a fixed number, since "how big does the boss need
   *  to be" depends on which switch profile and its dimensions. Set false
   *  and edit bossDiameterMm directly to override (still clamped, see
   *  above). */
  bossDiameterAuto: boolean;
  /** Cherry MX cross dimensions, mm (used when switchType === "cherry-mx").
   *  The nominal Cherry MX/MX-compatible plunger cross is commonly cited as
   *  ~4.0mm span x ~1.3mm arm width; the defaults here are that nominal size
   *  PLUS +0.3mm added to each dimension as FDM fit tolerance (a 0.4mm-nozzle
   *  printed cavity comes out undersized relative to its nominal CAD
   *  dimension -- oozing/first-layer squish narrows small holes -- so a
   *  cavity cut at the exact nominal switch size prints too tight to seat a
   *  real switch). This was tuned against a real Bambu Lab P2S + 0.4mm
   *  nozzle print/fit test, not just carried over from a spec sheet -- see
   *  the M4 verification report for what the previous (too-tight) values
   *  were. If your printer's holes come out a different amount undersized,
   *  adjust these two fields directly; the +0.3mm here is this codebase's
   *  tuned default, not a universal constant. */
  stemCrossWidthMm: number;
  stemArmWidthMm: number;
  /** Socket position offset from the keycap's horizontal center, mm. */
  stemOffsetXMm: number;
  stemOffsetYMm: number;
  /** Legend/label text rendered on the top face, using a real vector font
   *  (see generators/legendFont.ts, legendLayout.ts) extruded into manifold
   *  geometry via generators/glyphExtrude.ts -- not a pixel/dot-matrix font.
   *  Empty = no legend. When legendKind is "icon", this holds the single
   *  emoji character to render (see generators/icons.ts for the curated
   *  list this app's picker offers), rendered via the icon font instead of
   *  the text font -- same extrusion pipeline either way. */
  legendText: string;
  /** "text": legendText is rendered with the text font, with multi-line
   *  auto-wrap/alignment. "icon": legendText is a single emoji character
   *  (see generators/icons.ts), rendered with the icon font -- no
   *  wrapping/alignment applies to a single glyph. */
  legendKind: "text" | "icon";
  /** Target cap-height (ink height of a single capital letter), mm, before
   *  auto-shrink-to-fit against the actual top footprint (see
   *  layoutLegendIslands). Sized by default so one character covers roughly
   *  55-65% of the available top face on an 18x18mm keycap; longer strings
   *  (e.g. "ESC", "SHIFT") shrink automatically to stay inside the top face. */
  legendFontSizeMm: number;
  /** "emboss": legend stands proud of the top surface by legendReliefMm.
   *  "engrave": legend is recessed into the top surface by legendReliefMm
   *  (never deep enough to puncture through to the cavity below -- see
   *  MIN_ENGRAVE_FLOOR_MM).
   *  "none": no legend, regardless of legendText. */
  legendMode: "none" | "emboss" | "engrave";
  /** Emboss protrusion height / engrave recess depth, mm. */
  legendReliefMm: number;
  /** How multi-line legend text (auto-wrapped, or manually split with '\n')
   *  aligns within its own block width. No visible effect on single-line
   *  text, which is already centered as a block regardless of this setting. */
  legendAlign: "left" | "center" | "right";
  /** When true, embosses a speech-bubble-shaped plaque (rounded rect + a
   *  small pointed tail, per a reference mockup) onto the top face BEHIND
   *  the legend -- the legend itself still embosses/engraves exactly as
   *  before, just relative to the plaque's raised surface instead of the
   *  bare keycap top. Has no effect when legendMode is "none" (no legend to
   *  put a background behind). */
  legendBubble: boolean;
  /** How tall the 4 boss reinforcement ribs are, mm -- directly settable
   *  (not auto-derived from socketDepthMm) since real print tests showed
   *  the right height depends on the specific switch, not just the socket
   *  depth. Clamped at generation time to [MIN_RIB_HEIGHT_MM, bossHeightMm]
   *  regardless of what's requested here, so it always stays a real,
   *  ceiling-anchored rib no taller than the boss itself. */
  ribHeightMm: number;
}

export const DEFAULT_KEYCAP_PARAMS: KeycapParams = {
  // Was 18x18mm; bumped +0.5mm/side to print fuller/less undersized-looking
  // at a 0.4mm nozzle, while keeping a real gap at the standard 19.05mm
  // keycap pitch (18.5mm leaves ~0.55mm total, ~0.275mm/side, between
  // adjacent 1u keycaps -- tight but clear, tuned against a real P2S print,
  // not just a spec-sheet number). Height deliberately left unchanged.
  widthMm: 18.5,
  lengthMm: 18.5,
  heightMm: 10,
  topInsetMm: 2.5,
  cornerRadiusMm: 1.5,
  wallThicknessMm: 1.5,
  // Cherry MX is the default switch profile -- a real, physically-measured
  // MX-compatible cross cavity (see stemCrossWidthMm's doc comment), not a
  // generic round hole. "round" is still available as an alternative profile
  // for anyone who genuinely wants a plain hole, but it is not the default.
  switchType: "cherry-mx",
  socketDiameterMm: 4.0,
  // Was 3.5mm, then 4.5mm, then 5.75mm -- each bump driven by a real
  // physical switch-fit test (not an estimate) still finding the boss/stem
  // too short.
  socketDepthMm: 6.75,
  bossDiameterMm: 5.5, // matches the auto-computed value for the defaults below (stemCrossWidthMm 4.0 + 2*MIN_STEM_WALL_MM); see resolveKeycapParams
  bossDiameterAuto: true,
  // Cross Span (4.0mm) confirmed by direct measurement against a real,
  // verified commercial MX-compatible artisan keycap's own mesh (a .3mf the
  // user provided -- vertices at the socket's entrance ring were parsed and
  // measured directly, not eyeballed: the cross arm tips sit at exactly
  // +/-2.00mm and the inner corners at +/-0.75mm along each axis, i.e. a
  // 4.00mm span / 1.50mm arm cross, at a 5.50mm boss entrance diameter).
  // Cross Width raised 1.30mm -> 1.50mm to match that measurement (was
  // narrower than this verified reference after the last physical-fit
  // tuning pass went a bit too far).
  stemCrossWidthMm: 4.0,
  stemArmWidthMm: 1.5,
  stemOffsetXMm: 0,
  stemOffsetYMm: 0,
  legendText: "",
  legendKind: "text",
  legendFontSizeMm: 6.5,
  legendMode: "none",
  legendReliefMm: 0.6, // was 0.4mm -- printed legend read as too shallow/low-contrast at a 0.4mm nozzle (3 layers at a common 0.2mm layer height instead of 2)
  legendAlign: "center",
  legendBubble: false,
  // Matches what the old auto-derived formula (bossHeightMm -
  // RIB_ENTRANCE_CLEARANCE_MM = 7.5 - 2.75) produced for every other
  // default above, so this default keeps prior behavior unchanged.
  ribHeightMm: 4.75,
};

// Corner-arc and circle tessellation, both bumped up from this generator's
// original values (6 / 32) after a real print showed visibly faceted
// rounded corners and boss/socket circles -- fixed here, at the mesh
// source, not by asking the slicer/printer to compensate (a slicer cannot
// add geometry detail that was never in the STL). Note this is a genuinely
// different lever from vertex normals/shading smoothing: STL carries no
// normals a slicer trusts (it derives facet normals from triangle winding
// and ignores anything else), so the only way to make a curve read as
// smoother in the physical print is more triangles approximating it more
// closely -- which is what these two constants control.
const PROFILE_SEGMENTS_PER_CORNER = 12;
const CYLINDER_SEGMENTS = 48;
/** Smallest corner radius treated as "rounded" rather than "sharp". */
const MIN_ROUNDED_CORNER_MM = 0.05;
/**
 * Minimum wall thickness this generator will ever produce around a
 * print-critical (but not mechanically-stressed) feature -- the boss's
 * clearance to the surrounding shell wall, and the remaining roof above an
 * engraved legend -- sized for a 0.4mm nozzle: ~3 line widths, comfortably
 * inside typical 2-4-perimeter slicer settings, not a razor's-edge minimum.
 */
const MIN_PRINT_WALL_MM = 1.2;
/**
 * Minimum wall thickness around the socket/cross cavity itself -- i.e. how
 * much the boss's outer surface exceeds the cross/socket's own footprint.
 *
 * History: started at 1.6mm (extra margin "for durability"), which a real
 * switch-fit test showed made the boss too large. Dropped to 1.2mm (matching
 * MIN_PRINT_WALL_MM). Then tried a tapered boss (frustum, thinner at the
 * tip) plus a circular entrance countersink to ease clearance while keeping
 * the wall thick through most of the boss's height -- a real fit test showed
 * this was still the wrong shape entirely: the reference design isn't a
 * fattened/countersunk cylinder, it's a genuinely SMALL, THIN-WALLED boss
 * (cross span + just enough wall to exist) whose strength comes from four
 * reinforcement ribs (see RIB_*) connecting it to the surrounding shell,
 * not from the boss's own bulk. This value is deliberately thinner than a
 * generic "print-safe wall" would be on its own -- it's sized on the
 * assumption the ribs are doing the structural work, per the explicit
 * priority order: switch fit > no housing interference > no cracking >
 * maximizing this number for its own sake. Landed at 0.75mm (down from
 * 0.8mm) to exactly match the wall thickness measured directly off a real,
 * verified MX-compatible artisan keycap's mesh (boss entrance radius
 * 2.75mm, cross arm-tip radius 2.00mm along each axis -> wall = 0.75mm) --
 * see stemArmWidthMm's doc comment for how that measurement was taken.
 */
const MIN_STEM_WALL_MM = 0.75;

/**
 * The largest socketDepthMm that still keeps the boss's entrance at or
 * above the keycap's own bottom edge (see `bossHeightMm`'s computation in
 * createKeycapMesh) -- i.e. exactly the value that makes the boss flush
 * with the bottom, not past it. Exported so UI code can set an input's
 * max to this instead of guessing a safety margin that doesn't match the
 * generator's own exact cutoff.
 */
export function maxFlushSocketDepthMm(heightMm: number): number {
  const bossFloorMm = Math.max(MIN_STEM_WALL_MM, 0.1);
  return Math.max(heightMm - bossFloorMm, 0.5);
}

/**
 * A light chamfer at the very entrance of the socket cutter: for a short
 * height, the cutter is built at `characteristicWidth +
 * 2*ENTRANCE_CHAMFER_MM` (reusing the same per-profile buildCutters shape --
 * a slightly-longer cross for Cherry MX, a slightly-wider circle for round --
 * so the nominal cross/socket shape below this shallow zone is never
 * altered, only the very mouth flares out to help a switch stem start
 * entering). Not the circular countersink from an earlier revision, which
 * widened the mouth into a shape that no longer matched the cutter's own
 * profile.
 *
 * Was 0.1mm/0.25mm ("rất nhẹ", deliberately minimal) -- a real print showed
 * that was too little: the stem couldn't even start entering the mouth, cut
 * short by ordinary FDM hole-shrinkage (a horizontal hole this small prints
 * measurably narrower than modeled, from plastic ooze/sag before the walls
 * fully cool) plus this cutter's tiny nominal tolerance. Bumped to
 * 0.3mm/0.6mm -- still shallow enough to leave the cross's nominal
 * span/arm-width (and MIN_STEM_WALL_MM's boss wall) untouched below this
 * zone, just a taller and wider funnel at the very entrance.
 */
const ENTRANCE_CHAMFER_MM = 0.3;
/** How tall ENTRANCE_CHAMFER_MM's flare is before the cutter settles into
 *  its exact nominal dimensions. */
const ENTRANCE_CHAMFER_HEIGHT_MM = 0.6;
/** Reinforcement rib thickness, mm (~2 line widths at 0.4mm) -- thin fins
 *  connecting the boss to the surrounding shell wall along +X/-X/+Y/-Y, so
 *  a boss thin enough to look "small and light" (see MIN_STEM_WALL_MM) can
 *  still resist the lateral/torque load of inserting and prying out a
 *  physical switch, instead of relying on the boss's own wall bulk for that
 *  strength. */
const RIB_THICKNESS_MM = 0.8;
/** Floor on params.ribHeightMm: below this, a rib isn't meaningfully
 *  different from no rib at all, so it's clamped up to this rather than
 *  built as a functionally-useless sliver. Ribs used to always run the
 *  boss's FULL height, entrance to ceiling, but a real print showed those
 *  bottom rib tips sitting right at the socket mouth, in the same zone
 *  where the switch's own plastic housing needs to approach and seat --
 *  ribHeightMm is now a directly-settable param (see KeycapParams) for
 *  exactly this reason, rather than always reaching the boss's full
 *  height. Ribs still attach to the ceiling (where the lateral/torque load
 *  actually needs to transfer into the surrounding shell -- see
 *  RIB_THICKNESS_MM's doc comment above), just possibly shorter. */
const MIN_RIB_HEIGHT_MM = 1.0;
/** How far a rib's inner end is sunk INTO the boss before its nominal
 *  starting radius, mm -- purely so the boolean union has real overlap to
 *  weld against rather than a hairline coincident face. */
const RIB_BOSS_OVERLAP_MM = 0.3;
/** Same idea as RIB_BOSS_OVERLAP_MM, at the rib's outer end against the
 *  surrounding shell wall. */
const RIB_WALL_OVERLAP_MM = 0.4;
/** Minimum solid roof left above an engraved (recessed) legend -- shallower
 *  than MIN_STEM_WALL_MM because this is a decorative, non-load-bearing
 *  feature, but still comfortably more than one 0.4mm-nozzle line width so
 *  it never slices down to a paper-thin top layer. */
const MIN_ENGRAVE_FLOOR_MM = 0.6;
/** Margin kept clear between the legend text block and the top face's own
 *  edge, mm -- keeps embossed/engraved glyphs from landing on or past the
 *  taper's edge when a long legend is requested on a small keycap. */
const LEGEND_EDGE_MARGIN_MM = 1.0;
/** How much shorter than the legend's own emboss height the bubble plaque
 *  sits, mm -- the plaque is a background, so it's always a *bit* less
 *  proud of the surface than the legend on top of it, even at the legend's
 *  minimum relief setting (see the clamp in buildBubbleMesh's caller). */
const BUBBLE_RELIEF_MM = 0.35;
/** Margin kept clear between the bubble plaque and the top face's own edge,
 *  mm -- same purpose as LEGEND_EDGE_MARGIN_MM, kept separate since the
 *  plaque is deliberately roomier (fills most of the top) than the tighter
 *  margin a single glyph block needs. */
const BUBBLE_MARGIN_MM = 1.0;
/** Rounded-rect corner radius, as a fraction of the plaque's shorter side --
 *  matches the reference mockup's noticeably rounded (not sharp, not fully
 *  circular) speech-bubble body. */
const BUBBLE_CORNER_RADIUS_FRACTION = 0.28;
/** Tail (the small pointed "speaking from here" triangle) width, mm. */
const BUBBLE_TAIL_WIDTH_MM = 3.5;
/** How far the tail's tip extends below the plaque body's own bottom edge, mm. */
const BUBBLE_TAIL_HEIGHT_MM = 2.2;
/** How far the tail's base overlaps INTO the plaque body, mm -- same
 *  "real geometric overlap, not just a touching seam" pattern as
 *  RIB_BOSS_OVERLAP_MM/RIB_WALL_OVERLAP_MM: two prisms that only touch along
 *  a shared edge don't merge into one manifold solid through a boolean
 *  union, they need genuine interior overlap to weld against. */
const BUBBLE_TAIL_OVERLAP_MM = 0.4;

/**
 * One entry per supported switch/stem type. `characteristicWidthMm` is the
 * dimension `bossDiameterAuto` sizes the boss around (the cross span for
 * Cherry MX/MX-compatible, the hole diameter for a generic round socket).
 * `buildCutters` returns one or more solids to subtract from the boss
 * sequentially (kept as separate cutters, not merged into one mesh first,
 * because a Cherry MX cross's two arms overlap each other at the center --
 * a single merged mesh with self-overlapping geometry is not a valid
 * Boolean Engine input, unlike the legend's non-overlapping pixel-style
 * cutters elsewhere in this codebase's history).
 *
 * To add a switch profile that ISN'T MX-compatible (a different physical
 * stem shape, e.g. Kailh Choc's low-profile blade), add an entry here with
 * its own characteristicWidthMm and buildCutters -- nothing else in
 * createKeycapMesh needs to change.
 */
interface StemProfile {
  characteristicWidthMm(params: KeycapParams): number;
  buildCutters(params: KeycapParams, clampedWidthMm: number, cutterHeightMm: number, offset: [number, number, number]): MeshBuffer[];
}

const STEM_PROFILES: Record<Exclude<SwitchType, "none">, StemProfile> = {
  round: {
    characteristicWidthMm: (params) => params.socketDiameterMm,
    buildCutters: (_params, socketDiameterMm, cutterHeightMm, offset) => [
      applyTransformToMesh(createCylinderMesh(socketDiameterMm, cutterHeightMm, CYLINDER_SEGMENTS), {
        position: offset,
        rotationDeg: [0, 0, 0],
        scale: [1, 1, 1],
      }),
    ],
  },
  "cherry-mx": {
    characteristicWidthMm: (params) => params.stemCrossWidthMm,
    buildCutters: (params, crossWidthMm, cutterHeightMm, offset) => {
      const armWidthMm = Math.max(Math.min(params.stemArmWidthMm, crossWidthMm * 0.4), 0.4);
      return [
        applyTransformToMesh(createCubeMesh(crossWidthMm, armWidthMm, cutterHeightMm), {
          position: offset,
          rotationDeg: [0, 0, 0],
          scale: [1, 1, 1],
        }),
        applyTransformToMesh(createCubeMesh(armWidthMm, crossWidthMm, cutterHeightMm), {
          position: offset,
          rotationDeg: [0, 0, 0],
          scale: [1, 1, 1],
        }),
      ];
    },
  },
};

/** The footprint of the cavity opening at its narrowest point (the top,
 *  since the shell tapers inward going up) -- the ceiling the boss has to
 *  fit through, minus a print-safety margin to the surrounding shell wall.
 *  Shared by resolveKeycapParams (to preview the real auto boss size) and
 *  createKeycapMesh (to actually build it), so the two can never disagree. */
function computeCavityClearanceMm(params: KeycapParams): number {
  const topWidth = Math.max(params.widthMm - 2 * params.topInsetMm, 1);
  const topLength = Math.max(params.lengthMm - 2 * params.topInsetMm, 1);
  const innerTopWidth = Math.max(topWidth - 2 * params.wallThicknessMm, 0.5);
  const innerTopLength = Math.max(topLength - 2 * params.wallThicknessMm, 0.5);
  return Math.max(Math.min(innerTopWidth, innerTopLength) - 2 * MIN_PRINT_WALL_MM, 2 * MIN_PRINT_WALL_MM);
}

/**
 * Normalizes `bossDiameterMm` against the active switch profile and current
 * geometry: when `bossDiameterAuto` is true, replaces it with the smallest
 * boss that keeps MIN_STEM_WALL_MM around the profile's characteristic
 * width; when false, keeps the user's value but still floors it at that same
 * safe minimum (never lets a manual override produce a wall that's too thin
 * to survive repeated switch insertion/removal). Pure and synchronous --
 * doesn't touch the Boolean Engine -- so callers (the app's store, in
 * particular) can call this BEFORE generation to keep the params object they
 * display/persist in sync with what createKeycapMesh will actually build,
 * without needing to know anything about the auto/manual distinction
 * themselves.
 */
export function resolveKeycapParams(paramsInput: Partial<KeycapParams>): KeycapParams {
  const params: KeycapParams = { ...DEFAULT_KEYCAP_PARAMS, ...paramsInput };
  if (params.switchType === "none") return params;
  const profile = STEM_PROFILES[params.switchType];
  const characteristicWidthMm = profile.characteristicWidthMm(params);
  const minSafeBossMm = characteristicWidthMm + 2 * MIN_STEM_WALL_MM;
  const requestedBossMm = params.bossDiameterAuto ? minSafeBossMm : Math.max(params.bossDiameterMm, minSafeBossMm);
  const bossDiameterMm = Math.max(Math.min(requestedBossMm, computeCavityClearanceMm(params)), 2 * MIN_PRINT_WALL_MM);
  return { ...params, bossDiameterMm };
}

/**
 * `roundedRectProfile` emits a different point COUNT for an exactly-sharp
 * (r=0) corner (4 points total) than for any rounded corner (4*(segments+1)
 * points) -- necessary so a genuinely sharp corner doesn't get bogus
 * zero-length duplicate points, but it means `loftProfiles`'s bottom/top
 * point-count-must-match requirement breaks the moment one profile's corner
 * radius rounds to exactly 0 while its paired profile's doesn't (e.g. a
 * taper big enough to fully consume the top footprint's corner radius,
 * while the base still has one) -- this was a real bug caught by the test
 * suite, not found by inspection. Fixed by keeping both profiles of a given
 * loft pair on the same side of the "sharp vs rounded" line: if the base is
 * genuinely sharp, force the paired profile sharp too; otherwise floor the
 * paired profile's radius at `MIN_ROUNDED_CORNER_MM` instead of letting it
 * hit exactly 0 (visually indistinguishable at that scale, and keeps every
 * cap-fan triangle's area comfortably above the degenerate-triangle epsilon).
 */
function matchCornerSharpness(baseRadiusMm: number, pairedRadiusMm: number): [number, number] {
  if (baseRadiusMm < 1e-6) return [0, 0];
  return [Math.max(baseRadiusMm, MIN_ROUNDED_CORNER_MM), Math.max(pairedRadiusMm, MIN_ROUNDED_CORNER_MM)];
}

/** How far below/past a cut surface a boolean cutter extends, so the
 *  subtraction/union produces a clean coincidence-free result instead of a
 *  numerically unstable coplanar cut. */
const CUT_EXTENSION_MM = 0.5;
/** How far an embossed legend is embedded below the top surface before
 *  unioning, so the weld is solid material rather than a hairline coincident
 *  face (same rationale as CUT_EXTENSION_MM, just for addition not removal). */
const EMBOSS_EMBED_MM = 0.3;

/**
 * Builds the legend as one merged solid (one extruded island per glyph
 * contour-group -- see generators/glyphOutline.ts/glyphExtrude.ts -- laid
 * out and centered by generators/legendLayout.ts), auto-shrinking the
 * requested cap height so the whole text block fits within the keycap's
 * actual top footprint minus LEGEND_EDGE_MARGIN_MM. Returns null if there's
 * nothing to draw (empty text, or every character unsupported by the
 * embedded font) so the caller can skip the boolean step entirely.
 */
function buildLegendMesh(
  text: string,
  targetCapHeightMm: number,
  topWidthMm: number,
  topLengthMm: number,
  bottomZ: number,
  topZ: number,
  align: LegendAlign,
  kind: KeycapParams["legendKind"],
): MeshBuffer | null {
  const availableWidthMm = Math.max(topWidthMm - 2 * LEGEND_EDGE_MARGIN_MM, 1);
  const availableLengthMm = Math.max(topLengthMm - 2 * LEGEND_EDGE_MARGIN_MM, 1);
  if (kind === "icon") {
    // Three icon sources share the one `legendText` field, tried in order:
    // 1. Pixel-art icons (see icons.ts) looked up by their own short id.
    // 2. A handful of icons ("?", "!", "Z", "$") that are just a single
    //    ordinary character, rendered from the same clean legend text font
    //    a "text" legend uses -- the reference mockup draws these as
    //    smooth typography, not blocky pixel art, so reusing the real font
    //    glyph looks right where a hand-drawn low-res bitmap didn't.
    // 3. The legacy emoji-font icon set, storing a literal Unicode
    //    character. None of these three ever collide as lookup keys (a
    //    pixel id, a single ASCII char, and a multi-byte emoji are always
    //    distinguishable), so trying them in order is enough.
    const grid = getPixelIconGrid(text);
    if (grid) {
      const { islands } = pixelIconIslands(grid, targetCapHeightMm, availableWidthMm, availableLengthMm);
      if (islands.length === 0) return null;
      return mergeMeshes(islands.map((island) => extrudeGlyphIsland(island, bottomZ, topZ)));
    }
    const textFont = getLegendFont();
    const font = [...text].length === 1 && textFont.charToGlyphIndex(text) !== 0 ? textFont : getIconFont();
    const { islands } = layoutLegendIslands(text, targetCapHeightMm, availableWidthMm, availableLengthMm, align, font);
    if (islands.length === 0) return null;
    return mergeMeshes(islands.map((island) => extrudeGlyphIsland(island, bottomZ, topZ)));
  }
  const { islands } = layoutLegendIslands(text, targetCapHeightMm, availableWidthMm, availableLengthMm, align);
  if (islands.length === 0) return null;
  return mergeMeshes(islands.map((island) => extrudeGlyphIsland(island, bottomZ, topZ)));
}

/**
 * Builds a speech-bubble-shaped plaque (a rounded-rect body plus a small
 * pointed tail, per a reference mockup) as one merged solid: a straight
 * prism for the body, a straight triangular prism for the tail, unioned
 * together (not just concatenated -- see BUBBLE_TAIL_OVERLAP_MM's doc
 * comment for why a real boolean union is required here, not merge+trust).
 * The tail points toward -Y (screen-down in this generator's top-view
 * convention) from the body's bottom edge.
 */
function buildBubbleMesh(engine: BooleanEngine, topWidthMm: number, topLengthMm: number, bottomZ: number, topZ: number): MeshBuffer {
  const bodyWidthMm = Math.max(topWidthMm - 2 * BUBBLE_MARGIN_MM, 2);
  const bodyLengthMm = Math.max(topLengthMm - 2 * BUBBLE_MARGIN_MM - BUBBLE_TAIL_HEIGHT_MM, 2);
  const cornerRadiusMm = Math.min(bodyWidthMm, bodyLengthMm) * BUBBLE_CORNER_RADIUS_FRACTION;
  // Shift the body up by half the tail's height so the whole assembly
  // (body + tail) stays centered within the original topWidth/topLengthMm
  // footprint, matching where the legend itself is centered.
  const bodyCenterYMm = BUBBLE_TAIL_HEIGHT_MM / 2;
  const bodyProfile = roundedRectProfile(bodyWidthMm, bodyLengthMm, cornerRadiusMm, PROFILE_SEGMENTS_PER_CORNER).map(
    ([x, y]): [number, number] => [x, y + bodyCenterYMm],
  );
  const body = loftProfiles(bodyProfile, bodyProfile, bottomZ, topZ);

  const tailHalfWidthMm = BUBBLE_TAIL_WIDTH_MM / 2;
  const tailBaseYMm = bodyCenterYMm - bodyLengthMm / 2 + BUBBLE_TAIL_OVERLAP_MM;
  const tailTipYMm = bodyCenterYMm - bodyLengthMm / 2 - BUBBLE_TAIL_HEIGHT_MM;
  const tailProfile: Array<[number, number]> = [
    [-tailHalfWidthMm, tailBaseYMm],
    [0, tailTipYMm],
    [tailHalfWidthMm, tailBaseYMm],
  ];
  const tail = loftProfiles(tailProfile, tailProfile, bottomZ, topZ);

  return engine.union(body, tail);
}

interface LegendParts {
  /** The bubble plaque, if legendBubble is on -- always additive material,
   *  independent of legendMode (a background is always raised even when
   *  the legend on top of it is engraved). */
  bubbleMesh: MeshBuffer | null;
  /** Null if there's nothing to draw (blank text, or every character
   *  unsupported by the embedded font) -- see buildLegendMesh. */
  legendMesh: MeshBuffer | null;
  legendMode: "emboss" | "engrave" | "none";
}

/**
 * Computes the bubble/legend meshes WITHOUT applying them to any base mesh
 * -- shared by `applyLegend` (single-mesh path: unions/subtracts these
 * into the keycap directly) and `createKeycapMeshParts` (multi-part path:
 * keeps them as separate objects). Keeping this pure (no boolean ops
 * against a base mesh) is what lets the multi-part path decide per-part
 * whether to fold something into `base` (engrave always does, since a
 * cut can't be its own separate object) or keep it standalone (emboss).
 */
function buildLegendParts(engine: BooleanEngine, params: KeycapParams, topWidthMm: number, topLengthMm: number): LegendParts {
  const text = params.legendText.trim();
  if (!text || params.legendMode === "none") {
    return { bubbleMesh: null, legendMesh: null, legendMode: "none" };
  }

  // The bubble plaque, when enabled, raises the "surface" the legend itself
  // renders relative to -- everything below (emboss embed depth, engrave
  // roof budget) shifts up by exactly the plaque's own relief so the legend
  // sits on/into the plaque's raised face, not the bare keycap top.
  let legendSurfaceZ = params.heightMm;
  let bubbleMesh: MeshBuffer | null = null;
  if (params.legendBubble) {
    // Always at least a little shallower than the legend's own relief (a
    // background reads as a background), but never so tall it starts
    // approaching the legend's minimum relief setting.
    const bubbleReliefMm = Math.min(BUBBLE_RELIEF_MM, Math.max(params.legendReliefMm - 0.05, 0.1));
    bubbleMesh = buildBubbleMesh(engine, topWidthMm, topLengthMm, params.heightMm - EMBOSS_EMBED_MM, params.heightMm + bubbleReliefMm);
    legendSurfaceZ = params.heightMm + bubbleReliefMm;
  }

  if (params.legendMode === "emboss") {
    const legendMesh = buildLegendMesh(
      text,
      params.legendFontSizeMm,
      topWidthMm,
      topLengthMm,
      legendSurfaceZ - EMBOSS_EMBED_MM,
      legendSurfaceZ + params.legendReliefMm,
      params.legendAlign,
      params.legendKind,
    );
    return { bubbleMesh, legendMesh, legendMode: "emboss" };
  }

  // engrave -- the extra budget from the plaque's own thickness (if any)
  // means a shallow engrave never even reaches the base shell's own roof.
  const roofBudgetMm = (params.wallThicknessMm > 0 ? params.wallThicknessMm : params.heightMm) + (legendSurfaceZ - params.heightMm);
  const effectiveReliefMm = Math.min(params.legendReliefMm, Math.max(roofBudgetMm - MIN_ENGRAVE_FLOOR_MM, 0.05));
  const legendMesh = buildLegendMesh(
    text,
    params.legendFontSizeMm,
    topWidthMm,
    topLengthMm,
    legendSurfaceZ - effectiveReliefMm,
    legendSurfaceZ + CUT_EXTENSION_MM,
    params.legendAlign,
    params.legendKind,
  );
  return { bubbleMesh, legendMesh, legendMode: "engrave" };
}

function applyLegend(engine: BooleanEngine, mesh: MeshBuffer, params: KeycapParams, topWidthMm: number, topLengthMm: number): MeshBuffer {
  const { bubbleMesh, legendMesh, legendMode } = buildLegendParts(engine, params, topWidthMm, topLengthMm);
  if (bubbleMesh) mesh = engine.union(mesh, bubbleMesh);
  if (!legendMesh) return mesh;
  return legendMode === "emboss" ? engine.union(mesh, legendMesh) : engine.subtract(mesh, legendMesh);
}

/**
 * Builds a parametric keycap mesh: a tapered rounded-rectangle shell (loft
 * of two rounded-rect profiles, base to top -- the top cap is a single flat
 * polygon at z=heightMm, so the top surface is planar by construction, never
 * domed/curved) hollowed out via boolean subtraction to leave
 * `wallThicknessMm` of material on the sides and top, open at the bottom.
 *
 * If `switchType !== "none"`, a socket is added as two boolean steps, not
 * one: first a solid cylindrical BOSS is unioned on, hanging down from the
 * underside of the top face into the cavity; then the active profile's
 * cutter(s) (see STEM_PROFILES) are subtracted INTO that boss. This two-step
 * "boss then hole" approach exists because a hole subtracted directly into
 * the general cavity does effectively nothing with typical proportions --
 * the cavity is already wider than the socket, so the cut has no material to
 * remove and produces an invisible, non-functional "socket". The boss
 * guarantees there is always real, deliberately-sized material surrounding
 * the socket (>= MIN_STEM_WALL_MM) and above its blind end
 * (>= MIN_STEM_WALL_MM) -- sized not just to print cleanly but to survive
 * repeated switch insertion/removal, which is why this margin is stricter
 * than the generic MIN_PRINT_WALL_MM used elsewhere in this generator. The
 * boss diameter itself is DERIVED (see resolveKeycapParams), not a fixed
 * constant -- the smallest size that keeps that margin around whichever
 * profile is active, rather than one number sized for the widest case.
 *
 * KNOWN LIMITATION: this generator does not model a specific switch's
 * housing geometry (the raised rim around a switch's stem post), so it
 * cannot verify the boss clears that housing when the keycap bottoms out.
 * Keeping the boss at its computed minimum (rather than a generously
 * oversized fixed number) reduces that risk but doesn't eliminate it --
 * if a specific switch's housing rim is unusually wide, increase
 * MIN_STEM_WALL_MM's effect via a larger manual `bossDiameterMm` only if
 * you've confirmed clearance against that switch's actual housing
 * dimensions; this codebase has no such reference data to check against.
 *
 * If `legendMode !== "none"` and `legendText` is non-blank, a legend
 * rendered in a real vector font (generators/legendFont.ts) is embossed onto
 * or engraved into the top face, centered on it -- since the top footprint
 * itself is always centered at local (0,0), the legend stays centered
 * through any widthMm/lengthMm edit with no extra bookkeeping.
 *
 * Async because the cavity/boss/socket/legend steps go through the Boolean
 * Engine (manifold-3d/WASM) -- see boolean.ts. The outer shell itself is
 * manifold-by-construction (no boolean needed) via `loftProfiles`, so a
 * `wallThicknessMm <= 0` call with no legend requested returns instantly
 * without ever touching the Boolean Engine (still async, for a uniform call
 * signature, but resolves synchronously-fast).
 */
interface KeycapBase {
  mesh: MeshBuffer;
  /** Non-null exactly when legendRequested is true (see the fast-path
   *  early-return below) -- callers that need to build a bubble/legend on
   *  top of this base can rely on that invariant instead of null-checking
   *  defensively at every use. */
  engine: BooleanEngine | null;
  topWidth: number;
  topLength: number;
  legendRequested: boolean;
}

/**
 * Builds the shell + cavity + boss/socket/ribs -- everything about a
 * keycap EXCEPT the legend and its optional bubble background. Shared by
 * `createKeycapMesh` (which unions/subtracts the legend directly into this
 * base for a single printable solid) and `createKeycapMeshParts` (which
 * keeps the legend/bubble as separate objects for multi-color export) so
 * the two never drift out of sync on the actual shell geometry.
 */
async function buildKeycapBase(params: KeycapParams): Promise<KeycapBase> {

  const topWidth = Math.max(params.widthMm - 2 * params.topInsetMm, 1);
  const topLength = Math.max(params.lengthMm - 2 * params.topInsetMm, 1);
  const [bottomCornerRadius, topCornerRadius] = matchCornerSharpness(
    params.cornerRadiusMm,
    Math.max(params.cornerRadiusMm - params.topInsetMm, 0),
  );
  const outerBottom = roundedRectProfile(params.widthMm, params.lengthMm, bottomCornerRadius, PROFILE_SEGMENTS_PER_CORNER);
  const outerTop = roundedRectProfile(topWidth, topLength, topCornerRadius, PROFILE_SEGMENTS_PER_CORNER);

  // The top cap emitted by loftProfiles is a flat fan triangulation of
  // `outerTop` at a single Z (heightMm) -- by construction there is no
  // curvature/dishing anywhere in this mesh; see loftProfiles' own doc
  // comment. Verified by a dedicated flat-top test, not just asserted here.
  const outerShell = loftProfiles(outerBottom, outerTop, 0, params.heightMm);

  const legendRequested = params.legendMode !== "none" && params.legendText.trim().length > 0;

  if (params.wallThicknessMm <= 0 && !legendRequested) {
    return { mesh: outerShell, engine: null, topWidth, topLength, legendRequested };
  }

  const engine = await createBooleanEngine();
  let mesh = outerShell;

  if (params.wallThicknessMm > 0) {
    const [innerBottomRadius, innerTopRadius] = matchCornerSharpness(
      Math.max(bottomCornerRadius - params.wallThicknessMm, 0),
      Math.max(topCornerRadius - params.wallThicknessMm, 0),
    );
    const innerBottomWidth = Math.max(params.widthMm - 2 * params.wallThicknessMm, 0.5);
    const innerBottomLength = Math.max(params.lengthMm - 2 * params.wallThicknessMm, 0.5);
    const innerTopWidth = Math.max(topWidth - 2 * params.wallThicknessMm, 0.5);
    const innerTopLength = Math.max(topLength - 2 * params.wallThicknessMm, 0.5);
    const innerBottom = roundedRectProfile(innerBottomWidth, innerBottomLength, innerBottomRadius, PROFILE_SEGMENTS_PER_CORNER);
    const innerTop = roundedRectProfile(innerTopWidth, innerTopLength, innerTopRadius, PROFILE_SEGMENTS_PER_CORNER);
    const cavityTopZ = Math.max(params.heightMm - params.wallThicknessMm, CUT_EXTENSION_MM + 0.1);
    const cavity = loftProfiles(innerBottom, innerTop, -CUT_EXTENSION_MM, cavityTopZ);

    mesh = engine.subtract(outerShell, cavity);

    if (params.switchType !== "none") {
      const profile = STEM_PROFILES[params.switchType];
      // bossDiameterMm is already fully resolved (auto-computed or
      // manually-clamped) by resolveKeycapParams above; re-clamp against
      // THIS call's actual cavity geometry as a safety net in case a caller
      // constructed `params` some other way (e.g. a test) without going
      // through resolveKeycapParams first.
      const bossDiameterMm = Math.max(Math.min(params.bossDiameterMm, computeCavityClearanceMm(params)), 2 * MIN_PRINT_WALL_MM);
      const clampedCharWidthMm = Math.min(profile.characteristicWidthMm(params), bossDiameterMm - 2 * MIN_STEM_WALL_MM);

      // Boss spans from partway down the cavity up to (and merging with) the
      // solid top -- attaching it to the ceiling is what makes it a
      // supported, printable feature rather than a disconnected floating
      // island. Its height is exactly the socket depth plus a stem-safe
      // floor, so the socket's blind end always keeps >= MIN_STEM_WALL_MM of
      // material between it and the boss's own top face (which itself sits
      // flush against/inside the existing wallThicknessMm-thick top -- never
      // closer to the outer top surface than wallThicknessMm, so the socket
      // can never puncture the outer top regardless of socketDepthMm).
      const bossFloorMm = Math.max(MIN_STEM_WALL_MM, 0.1);
      // Capped at exactly flush with the keycap's own bottom edge
      // (bossBottomZ = heightMm - bossHeightMm >= 0) -- without this, a
      // large socketDepthMm could push the boss's entrance past the
      // keycap's own skirt, poking out into open air below a physically
      // real bottom edge. (An earlier version of this cap used
      // `cavityTopZ + CUT_EXTENSION_MM` instead -- the cavity's own total
      // span -- but that's a tighter bound than necessary: at a typical
      // wallThicknessMm it stopped the boss ~1mm short of the actual
      // bottom edge, so "set socketDepthMm to its UI max" never actually
      // reached flush. The cavity is open at the bottom by construction --
      // nothing stops the boss from filling it all the way down to z=0.)
      const bossHeightMm = Math.min(params.socketDepthMm + bossFloorMm, params.heightMm);
      const socketDepthMm = Math.max(bossHeightMm - bossFloorMm, 0.5);
      const bossBottomZ = params.heightMm - bossHeightMm;
      const bossTopZ = bossBottomZ + bossHeightMm;

      // Boss is a plain, uniform-diameter cylinder -- small and thin, per
      // reference: its own wall doesn't try to be the thing that survives
      // switch insertion/removal by itself, the ribs below do (see
      // MIN_STEM_WALL_MM's doc comment for why this replaced revision 6's
      // tapered/countersunk design).
      const boss = applyTransformToMesh(createCylinderMesh(bossDiameterMm, bossHeightMm, CYLINDER_SEGMENTS), {
        position: [params.stemOffsetXMm, params.stemOffsetYMm, (bossBottomZ + bossTopZ) / 2],
        rotationDeg: [0, 0, 0],
        scale: [1, 1, 1],
      });
      mesh = engine.union(mesh, boss);

      const cutterHeightMm = socketDepthMm + CUT_EXTENSION_MM;
      const cutterCenterZ = bossBottomZ - CUT_EXTENSION_MM + cutterHeightMm / 2;
      const cutterOffset: [number, number, number] = [params.stemOffsetXMm, params.stemOffsetYMm, cutterCenterZ];

      for (const cutter of profile.buildCutters(params, clampedCharWidthMm, cutterHeightMm, cutterOffset)) {
        mesh = engine.subtract(mesh, cutter);
      }

      // Entrance chamfer: a very light flare at just the cutter's mouth,
      // built by reusing the SAME per-profile buildCutters shape at a
      // slightly wider characteristic width for a short height -- a longer
      // cross for Cherry MX, a wider circle for round -- so the cross's
      // nominal span/arm width are completely unchanged above this short
      // zone (unlike revision 6's circular countersink, which widened the
      // mouth into a shape that no longer matched the cutter's own profile).
      const chamferCutterHeightMm = ENTRANCE_CHAMFER_HEIGHT_MM + CUT_EXTENSION_MM;
      const chamferCenterZ = bossBottomZ - CUT_EXTENSION_MM + chamferCutterHeightMm / 2;
      const chamferOffset: [number, number, number] = [params.stemOffsetXMm, params.stemOffsetYMm, chamferCenterZ];
      const chamferedWidthMm = clampedCharWidthMm + 2 * ENTRANCE_CHAMFER_MM;
      for (const cutter of profile.buildCutters(params, chamferedWidthMm, chamferCutterHeightMm, chamferOffset)) {
        mesh = engine.subtract(mesh, cutter);
      }

      // Reinforcement ribs: four thin fins connecting the boss to the
      // surrounding shell wall along +X/-X/+Y/-Y, so a boss this thin can
      // still resist the lateral/torque load of inserting and prying out a
      // physical switch. Each rib starts OUTSIDE the boss's own radius (at
      // the boss's surface, not the center), so it never touches the
      // socket/cross cavity regardless of depth -- the cavity is entirely
      // within the boss's radius, ribs are entirely outside it. Sized
      // against the cavity's actual (tapered) half-width/half-length
      // interpolated at the rib's own Z-center, then extended by
      // RIB_WALL_OVERLAP_MM so it welds into real wall material even though
      // that interpolation is only a single representative sample across
      // the rib's own height, not exact at every Z.
      //
      // Ribs attach to the ceiling (bossTopZ), same as the boss itself --
      // that's where the load actually needs to transfer into the
      // surrounding shell -- but a real print showed full-height ribs
      // sitting right at the socket mouth, in the same zone where the
      // switch's own plastic housing needs to approach and seat, so
      // ribHeightMm is directly settable (params.ribHeightMm) rather than
      // always reaching the full boss height. Clamped to a sane range
      // regardless of what's requested: never taller than the boss itself
      // (nothing to attach to beyond that), never shorter than
      // MIN_RIB_HEIGHT_MM (a sliver rib isn't meaningfully different from
      // no rib at all).
      const ribHeightMm = Math.min(Math.max(params.ribHeightMm, MIN_RIB_HEIGHT_MM), bossHeightMm);
      const ribCenterZ = bossTopZ - ribHeightMm / 2;
      const cavityHeightFraction = Math.max(0, Math.min(1, ribCenterZ / cavityTopZ));
      const cavityHalfWidthAtRib = innerBottomWidth / 2 + cavityHeightFraction * (innerTopWidth / 2 - innerBottomWidth / 2);
      const cavityHalfLengthAtRib = innerBottomLength / 2 + cavityHeightFraction * (innerTopLength / 2 - innerBottomLength / 2);
      const ribInnerRadiusMm = bossDiameterMm / 2 - RIB_BOSS_OVERLAP_MM;
      const ribOuterXMm = cavityHalfWidthAtRib + RIB_WALL_OVERLAP_MM;
      const ribOuterYMm = cavityHalfLengthAtRib + RIB_WALL_OVERLAP_MM;
      const ribLengthXMm = ribOuterXMm - ribInnerRadiusMm;
      const ribLengthYMm = ribOuterYMm - ribInnerRadiusMm;

      if (ribLengthXMm > 0.2) {
        const ribCenterXMm = (ribInnerRadiusMm + ribOuterXMm) / 2;
        for (const sign of [1, -1]) {
          const rib = applyTransformToMesh(createCubeMesh(ribLengthXMm, RIB_THICKNESS_MM, ribHeightMm), {
            position: [params.stemOffsetXMm + sign * ribCenterXMm, params.stemOffsetYMm, ribCenterZ],
            rotationDeg: [0, 0, 0],
            scale: [1, 1, 1],
          });
          mesh = engine.union(mesh, rib);
        }
      }
      if (ribLengthYMm > 0.2) {
        const ribCenterYMm = (ribInnerRadiusMm + ribOuterYMm) / 2;
        for (const sign of [1, -1]) {
          const rib = applyTransformToMesh(createCubeMesh(RIB_THICKNESS_MM, ribLengthYMm, ribHeightMm), {
            position: [params.stemOffsetXMm, params.stemOffsetYMm + sign * ribCenterYMm, ribCenterZ],
            rotationDeg: [0, 0, 0],
            scale: [1, 1, 1],
          });
          mesh = engine.union(mesh, rib);
        }
      }
    }
  }

  return { mesh, engine, topWidth, topLength, legendRequested };
}

/**
 * Builds a full parametric keycap as ONE printable solid: the shell,
 * boss/socket/ribs, and (if requested) the legend's bubble background and
 * the legend itself, all unioned/subtracted into a single mesh.
 */
export async function createKeycapMesh(paramsInput: Partial<KeycapParams> = {}): Promise<MeshBuffer> {
  const params: KeycapParams = resolveKeycapParams(paramsInput);
  const base = await buildKeycapBase(params);
  if (!base.legendRequested) return base.mesh;
  // engine is guaranteed non-null here: the fast path above only skips it
  // when !legendRequested.
  return applyLegend(base.engine!, base.mesh, params, base.topWidth, base.topLength);
}

/**
 * Builds the SAME keycap as `createKeycapMesh`, but keeps the legend's
 * bubble background and the legend itself as separate objects instead of
 * unioning them into one solid -- for exporting a multi-color 3MF where
 * each part gets its own filament/AMS slot in the slicer. Only meaningful
 * for an EMBOSS legend: an engraved legend is a hole cut into whatever
 * surface it sits on, not a separate volume of material, so FDM multi-color
 * printing can't target it independently. When legendMode is "engrave",
 * BOTH the legend cut and its bubble background (if any) fold into `base`
 * as one object, exactly as in the single-mesh path -- a cut can't be its
 * own printable object, and leaving the bubble as a separate part with an
 * unrelated hole in it (while `base` underneath stays untouched) wouldn't
 * correspond to anything printable either.
 */
export async function createKeycapMeshParts(
  paramsInput: Partial<KeycapParams> = {},
): Promise<{ base: MeshBuffer; bubble: MeshBuffer | null; legend: MeshBuffer | null }> {
  const params: KeycapParams = resolveKeycapParams(paramsInput);
  const built = await buildKeycapBase(params);
  if (!built.legendRequested) {
    return { base: built.mesh, bubble: null, legend: null };
  }
  const engine = built.engine!;
  const { bubbleMesh, legendMesh, legendMode } = buildLegendParts(engine, params, built.topWidth, built.topLength);

  let base = built.mesh;
  let bubble: MeshBuffer | null = null;
  let legend: MeshBuffer | null = null;

  if (legendMode === "engrave") {
    if (bubbleMesh) base = engine.union(base, bubbleMesh);
    if (legendMesh) base = engine.subtract(base, legendMesh);
  } else {
    bubble = bubbleMesh;
    legend = legendMesh;
  }

  return { base, bubble, legend };
}
