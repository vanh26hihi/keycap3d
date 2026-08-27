import { getLegendFont } from "./legendFont";
import { flattenPathToContours, groupContoursIntoIslands, type GlyphIsland } from "./glyphOutline";

/** Cache of "how tall is a capital letter, as a fraction of unitsPerEm" --
 *  computed once per font from a reference glyph ('H' for the text font; see
 *  REFERENCE_GLYPH_OVERRIDE for fonts with no 'H', like the legacy emoji
 *  icon font) rather than trusting any specific font-metadata field
 *  (cap-height metadata is inconsistently populated across fonts), so it
 *  reflects the font's actual rendered ink extent. Keyed by font instance
 *  (WeakMap) since this module lays out text with either the legend text
 *  font or the legacy icon font (most icons are pixel bitmaps now -- see
 *  pixelIcons.ts/pixelTrace.ts -- but the original emoji-font icon set is
 *  kept alongside them, so this second font is still in play). */
const capHeightRatioCache = new WeakMap<ReturnType<typeof getLegendFont>, number>();

/** Fonts with no Latin 'H' (the legacy icon font) need a different
 *  reference glyph to measure cap-height against; keyed by font instance. */
const REFERENCE_GLYPH_OVERRIDE = new WeakMap<ReturnType<typeof getLegendFont>, string>();

export function setReferenceGlyph(font: ReturnType<typeof getLegendFont>, char: string): void {
  REFERENCE_GLYPH_OVERRIDE.set(font, char);
}

function capHeightRatio(font: ReturnType<typeof getLegendFont>): number {
  let ratio = capHeightRatioCache.get(font);
  if (ratio === undefined) {
    const refChar = REFERENCE_GLYPH_OVERRIDE.get(font) ?? "H";
    const path = font.charToGlyph(refChar).getPath(0, 0, font.unitsPerEm);
    const bbox = path.getBoundingBox();
    ratio = Math.abs(bbox.y2 - bbox.y1) / font.unitsPerEm;
    capHeightRatioCache.set(font, ratio);
  }
  return ratio;
}

/** Vertical distance between line baselines, as a multiple of cap-height --
 *  a bit looser than 1.0 so embossed/engraved lines don't visually touch. */
const LINE_SPACING_FACTOR = 1.35;
/** Longer text auto-wraps onto more than one line (see `chooseLineLayout`)
 *  when that produces a larger resulting size -- capped here so a long
 *  legend doesn't turn into a tall column of tiny lines on a small keycap. */
const MAX_AUTO_LINES = 3;

export type LegendAlign = "left" | "center" | "right";

export interface LegendLayoutResult {
  islands: GlyphIsland[];
  /** The actual rendered cap-height, mm -- equals the requested
   *  targetCapHeightMm unless the text had to be shrunk (or, for multi-word
   *  text, wrapped onto multiple lines) to fit maxWidthMm/maxHeightMm (see
   *  LEGEND_EDGE_MARGIN_MM in keycap.ts). */
  actualCapHeightMm: number;
  /** How many lines the text was laid out on (1 unless it wrapped or the
   *  caller passed explicit '\n' line breaks). */
  lineCount: number;
}

function measureLineRawWidth(line: string, font: ReturnType<typeof getLegendFont>): number {
  let width = 0;
  for (const char of line) {
    const glyph = font.charToGlyph(char);
    width += glyph.advanceWidth ?? font.unitsPerEm * 0.6;
  }
  return width;
}

interface RawLineLayout {
  islands: GlyphIsland[];
  minX: number;
  maxX: number;
}

/** Lays out one line's glyphs left-to-right starting at raw x=0. Unsupported
 *  characters (see font5x7-era doc note in glyphOutline.ts... this font has
 *  broad coverage, but the same `.notdef` skip applies) render blank but
 *  still advance the cursor. */
function layoutLineIslandsRaw(line: string, font: ReturnType<typeof getLegendFont>): RawLineLayout {
  const islands: GlyphIsland[] = [];
  let cursorX = 0;
  let minX = 0;
  let maxX = 0;
  let any = false;
  for (const char of line) {
    const glyphIndex = font.charToGlyphIndex(char);
    const glyph = font.charToGlyph(char);
    if (glyphIndex !== 0) {
      const path = glyph.getPath(cursorX, 0, font.unitsPerEm);
      const contours = flattenPathToContours(path);
      const charIslands = groupContoursIntoIslands(contours);
      islands.push(...charIslands);
      for (const isl of charIslands) {
        for (const [x] of isl.outer) {
          if (!any || x < minX) minX = x;
          if (!any || x > maxX) maxX = x;
          any = true;
        }
      }
    }
    cursorX += glyph.advanceWidth ?? font.unitsPerEm * 0.6;
  }
  return { islands, minX, maxX };
}

/** All ways to split `n` items into exactly `k` contiguous, non-empty
 *  groups, as arrays of group sizes (e.g. n=5,k=2 -> [1,4],[2,3],[3,2],[4,1]).
 *  n and k are always small here (a handful of words, up to MAX_AUTO_LINES),
 *  so brute-force enumeration is simpler and plenty fast. */
function* contiguousPartitions(n: number, k: number): Generator<number[]> {
  if (k === 1) {
    yield [n];
    return;
  }
  for (let first = 1; first <= n - (k - 1); first++) {
    for (const rest of contiguousPartitions(n - first, k - 1)) {
      yield [first, ...rest];
    }
  }
}

function groupsToLines(words: string[], groupSizes: number[]): string[] {
  const lines: string[] = [];
  let idx = 0;
  for (const size of groupSizes) {
    lines.push(words.slice(idx, idx + size).join(" "));
    idx += size;
  }
  return lines;
}

/** Picks how to split `text` into lines: explicit '\n' breaks are honored
 *  as-is (the caller's exact intent); otherwise, for multi-word text, tries
 *  every line count from 1 up to MAX_AUTO_LINES (and up to one line per
 *  word) and every contiguous word-partition for each, and returns whichever
 *  arrangement yields the LARGEST achievable cap height against
 *  maxWidthMm/maxHeightMm -- i.e. auto-wrapping only when it actually lets
 *  the text render bigger/more legibly, not merely because it CAN wrap. */
function chooseLineLayout(
  text: string,
  font: ReturnType<typeof getLegendFont>,
  targetCapHeightMm: number,
  maxWidthMm: number,
  maxHeightMm: number,
): string[] {
  if (text.includes("\n")) {
    return text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  }

  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length <= 1) return [text.trim()];

  const mmPerRawUnit = targetCapHeightMm / (capHeightRatio(font) * font.unitsPerEm);
  const lineHeightRawMm = capHeightRatio(font) * font.unitsPerEm * LINE_SPACING_FACTOR * mmPerRawUnit;

  let best: { lines: string[]; achievedCapHeightMm: number } | null = null;
  const maxLines = Math.min(MAX_AUTO_LINES, words.length);
  for (let k = 1; k <= maxLines; k++) {
    let bestForK: { lines: string[]; maxWidthRaw: number } | null = null;
    for (const groupSizes of contiguousPartitions(words.length, k)) {
      const lines = groupsToLines(words, groupSizes);
      const widths = lines.map((l) => measureLineRawWidth(l, font));
      const maxWidthRaw = Math.max(...widths);
      if (!bestForK || maxWidthRaw < bestForK.maxWidthRaw) {
        bestForK = { lines, maxWidthRaw };
      }
    }
    if (!bestForK) continue;
    const blockWidthMm = bestForK.maxWidthRaw * mmPerRawUnit;
    const blockHeightMm = k * lineHeightRawMm;
    const shrink = blockWidthMm > 0 && blockHeightMm > 0 ? Math.min(1, maxWidthMm / blockWidthMm, maxHeightMm / blockHeightMm) : 1;
    const achievedCapHeightMm = targetCapHeightMm * shrink;
    if (!best || achievedCapHeightMm > best.achievedCapHeightMm) {
      best = { lines: bestForK.lines, achievedCapHeightMm };
    }
  }
  return best ? best.lines : [text.trim()];
}

/**
 * Lays out `text` in the embedded vector font as a list of glyph islands in
 * millimeter space, centered as a whole block at local (0,0), sized so a
 * single capital letter's ink height equals `targetCapHeightMm` -- then,
 * only if the resulting block would exceed `maxWidthMm`/`maxHeightMm`,
 * uniformly shrunk (never grown) to fit.
 *
 * Multi-word text auto-wraps onto multiple lines when that yields a larger
 * resulting size than cramming everything onto one line (see
 * `chooseLineLayout`); explicit '\n' characters in `text` are honored as
 * manual line breaks instead. `align` controls how shorter lines sit
 * relative to the block's own width ("left"/"center"/"right") -- a no-op
 * for single-line text, which is already centered as a block regardless.
 *
 * Characters with no glyph in the embedded font (`charToGlyphIndex` returns
 * 0, the ".notdef" sentinel) are skipped -- no island is emitted -- but the
 * cursor still advances using that glyph's own advance width, so later
 * characters don't collapse into the gap.
 */
export function layoutLegendIslands(
  text: string,
  targetCapHeightMm: number,
  maxWidthMm: number,
  maxHeightMm: number,
  align: LegendAlign = "center",
  font: ReturnType<typeof getLegendFont> = getLegendFont(),
): LegendLayoutResult {
  const lines = chooseLineLayout(text, font, targetCapHeightMm, maxWidthMm, maxHeightMm);
  const lineHeightRaw = capHeightRatio(font) * font.unitsPerEm * LINE_SPACING_FACTOR;

  const rawLines = lines.map((line) => layoutLineIslandsRaw(line, font));
  const blockRawWidth = Math.max(0, ...rawLines.map((l) => l.maxX - l.minX));

  const rawIslands: GlyphIsland[] = [];
  rawLines.forEach((line, i) => {
    const lineWidth = line.maxX - line.minX;
    let xShift: number;
    if (align === "left") xShift = -line.minX;
    else if (align === "right") xShift = blockRawWidth - lineWidth - line.minX;
    else xShift = (blockRawWidth - lineWidth) / 2 - line.minX;
    // Lines stack downward (index 0 on top), matching reading order; Y-up
    // convention means later lines get a more negative Y offset.
    const yShift = -i * lineHeightRaw;
    for (const island of line.islands) {
      const shift = (ring: Array<[number, number]>): Array<[number, number]> => ring.map(([x, y]) => [x + xShift, y + yShift]);
      rawIslands.push({ outer: shift(island.outer), holes: island.holes.map(shift) });
    }
  });

  if (rawIslands.length === 0) {
    return { islands: [], actualCapHeightMm: 0, lineCount: lines.length };
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const island of rawIslands) {
    for (const [x, y] of island.outer) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const rawWidth = maxX - minX;
  const rawHeight = maxY - minY;

  const mmPerRawUnit = targetCapHeightMm / (capHeightRatio(font) * font.unitsPerEm);
  const blockWidthMm = rawWidth * mmPerRawUnit;
  const blockHeightMm = rawHeight * mmPerRawUnit;
  const shrink =
    blockWidthMm > 0 && blockHeightMm > 0
      ? Math.min(1, maxWidthMm / blockWidthMm, maxHeightMm / blockHeightMm)
      : 1;
  const finalScale = mmPerRawUnit * shrink;

  const transform = (ring: Array<[number, number]>): Array<[number, number]> =>
    ring.map(([x, y]) => [(x - centerX) * finalScale, (y - centerY) * finalScale]);

  const islands: GlyphIsland[] = rawIslands.map((island) => ({
    outer: transform(island.outer),
    holes: island.holes.map(transform),
  }));

  return { islands, actualCapHeightMm: targetCapHeightMm * shrink, lineCount: lines.length };
}

/** Convenience for callers (e.g. the UI) that just need to know how a given
 *  text/size/space combination would be laid out without extruding it --
 *  e.g. to preview line count. Mirrors `layoutLegendIslands` exactly except
 *  it skips glyph extrusion. */
export function measureLegendLayout(
  text: string,
  targetCapHeightMm: number,
  maxWidthMm: number,
  maxHeightMm: number,
  font: ReturnType<typeof getLegendFont> = getLegendFont(),
): { lineCount: number; actualCapHeightMm: number } {
  const result = layoutLegendIslands(text, targetCapHeightMm, maxWidthMm, maxHeightMm, "center", font);
  return { lineCount: result.lineCount, actualCapHeightMm: result.actualCapHeightMm };
}
