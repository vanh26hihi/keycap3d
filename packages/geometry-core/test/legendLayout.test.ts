import { describe, expect, it } from "vitest";
import { layoutLegendIslands, measureLegendLayout } from "../src/generators/legendLayout.js";
import { extrudeGlyphIsland } from "../src/generators/glyphExtrude.js";
import { mergeMeshes, computeSignedVolume } from "../src/mesh.js";
import { validateMesh } from "../src/validate.js";

describe("layoutLegendIslands: multi-line auto-wrap", () => {
  it("single-word text always stays on one line, regardless of available space", () => {
    const result = measureLegendLayout("ESCAPE", 6, 100, 100);
    expect(result.lineCount).toBe(1);
  });

  it("a two-word phrase on a small keycap top wraps onto 2 lines when that yields a bigger, more legible size than 1 line", () => {
    // ~11mm available matches an 18.5mm keycap's default top footprint.
    // "VIETANH" (no space) can't wrap -- a reasonable proxy baseline for
    // "roughly this many glyphs, forced onto one line" -- to compare against.
    const forcedOneLine = measureLegendLayout("VIETANH", 6.5, 11, 11);
    const wrapped = measureLegendLayout("VIET ANH", 6.5, 11, 11);
    expect(wrapped.lineCount).toBe(2);
    expect(forcedOneLine.lineCount).toBe(1);
    // wrapping should let the text render bigger than cramming it onto one line
    expect(wrapped.actualCapHeightMm).toBeGreaterThan(forcedOneLine.actualCapHeightMm);
  });

  it("explicit '\\n' line breaks are honored exactly, without re-optimizing the split", () => {
    const result = measureLegendLayout("A\nB\nC", 6, 100, 100);
    expect(result.lineCount).toBe(3);
  });

  it("wrapping is capped at a maximum line count even for many words", () => {
    const result = measureLegendLayout("ONE TWO THREE FOUR FIVE SIX", 6, 30, 30);
    expect(result.lineCount).toBeLessThanOrEqual(3);
  });

  it("never wraps into more lines than there are words", () => {
    const result = measureLegendLayout("HI", 6, 5, 100); // absurdly narrow width, would want more lines if it could
    expect(result.lineCount).toBeLessThanOrEqual(2);
  });

  it("blank text produces zero lines/islands without throwing", () => {
    const result = layoutLegendIslands("", 6, 100, 100);
    expect(result.islands).toHaveLength(0);
  });
});

describe("layoutLegendIslands: alignment", () => {
  it("multi-line text with align='left': every line's own left edge sits at the same X", () => {
    const { islands } = layoutLegendIslands("I\nWWWWW", 6, 100, 100, "left");
    const ys = islands.flatMap((isl) => isl.outer.map(([, y]) => y));
    const midY = (Math.min(...ys) + Math.max(...ys)) / 2;
    const topLine = islands.filter((isl) => isl.outer.some(([, y]) => y > midY));
    const bottomLine = islands.filter((isl) => isl.outer.some(([, y]) => y <= midY));
    const minX = (group: typeof islands) => Math.min(...group.flatMap((isl) => isl.outer.map(([x]) => x)));
    expect(minX(topLine)).toBeCloseTo(minX(bottomLine), 1);
  });

  it("multi-line text with align='right': every line's own right edge sits at the same X", () => {
    const { islands } = layoutLegendIslands("I\nWWWWW", 6, 100, 100, "right");
    const ys = islands.flatMap((isl) => isl.outer.map(([, y]) => y));
    const midY = (Math.min(...ys) + Math.max(...ys)) / 2;
    const topLine = islands.filter((isl) => isl.outer.some(([, y]) => y > midY));
    const bottomLine = islands.filter((isl) => isl.outer.some(([, y]) => y <= midY));
    const maxX = (group: typeof islands) => Math.max(...group.flatMap((isl) => isl.outer.map(([x]) => x)));
    expect(maxX(topLine)).toBeCloseTo(maxX(bottomLine), 1);
  });

  it("single-line text is unaffected by alignment (still centered as one block)", () => {
    const left = layoutLegendIslands("HELLO", 6, 100, 100, "left");
    const center = layoutLegendIslands("HELLO", 6, 100, 100, "center");
    const right = layoutLegendIslands("HELLO", 6, 100, 100, "right");
    const bboxCenterX = (islands: typeof left.islands) => {
      const xs = islands.flatMap((isl) => isl.outer.map(([x]) => x));
      return (Math.min(...xs) + Math.max(...xs)) / 2;
    };
    expect(bboxCenterX(left.islands)).toBeCloseTo(bboxCenterX(center.islands), 1);
    expect(bboxCenterX(center.islands)).toBeCloseTo(bboxCenterX(right.islands), 1);
  });

  it("regardless of alignment, the overall multi-line block stays centered at local (0,0)", () => {
    for (const align of ["left", "center", "right"] as const) {
      const { islands } = layoutLegendIslands("I\nWWWWW", 6, 100, 100, align);
      const xs = islands.flatMap((isl) => isl.outer.map(([x]) => x));
      expect((Math.min(...xs) + Math.max(...xs)) / 2, align).toBeCloseTo(0, 1);
    }
  });
});

describe("multi-line legend end-to-end: extrusion stays watertight", () => {
  it("a 2-line wrapped legend extrudes to a watertight merged solid", () => {
    const { islands } = layoutLegendIslands("VIET ANH", 6.5, 11, 11);
    const mesh = mergeMeshes(islands.map((isl) => extrudeGlyphIsland(isl, 0, 1)));
    const report = validateMesh(mesh);
    expect(report.isWatertight).toBe(true);
    expect(report.degenerateTriangleCount).toBe(0);
    expect(computeSignedVolume(mesh)).toBeGreaterThan(0);
  });

  it("explicit-newline 3-line legend extrudes to a watertight merged solid", () => {
    const { islands } = layoutLegendIslands("ONE\nTWO\nTHREE", 6, 100, 100);
    const mesh = mergeMeshes(islands.map((isl) => extrudeGlyphIsland(isl, 0, 1)));
    expect(validateMesh(mesh).isWatertight).toBe(true);
  });
});
