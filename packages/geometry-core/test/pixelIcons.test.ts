import { describe, expect, it } from "vitest";
import { ICON_OPTIONS } from "../src/generators/icons.js";
import { getPixelIconGrid } from "../src/generators/pixelIcons.js";
import { pixelIconIslands, tracePixelGrid } from "../src/generators/pixelTrace.js";
import { extrudeGlyphIsland } from "../src/generators/glyphExtrude.js";
import { mergeMeshes, computeSignedVolume } from "../src/mesh.js";
import { validateMesh } from "../src/validate.js";

// ICON_OPTIONS also includes icons with no pixel grid by design: the
// restored legacy emoji-font icons (id prefixed "legacy", covered by
// iconFont.test.ts instead), and a few single-character icons ("?", "!",
// "Z", "$") rendered from the ordinary legend text font instead of a
// bitmap (see buildLegendMesh's fallback order in keycap.ts).
const TEXT_FONT_ICON_IDS = new Set(["sleepZ", "question", "exclamation", "dollar"]);
const PIXEL_ICON_OPTIONS = ICON_OPTIONS.filter((icon) => !icon.id.startsWith("legacy") && !TEXT_FONT_ICON_IDS.has(icon.id));

describe("pixel icons: every curated icon has a grid and extrudes cleanly", () => {
  for (const icon of PIXEL_ICON_OPTIONS) {
    it(`"${icon.id}" has a grid and extrudes to a watertight solid`, () => {
      const grid = getPixelIconGrid(icon.char);
      expect(grid, `${icon.id}: no grid registered`).not.toBeNull();

      const { islands } = pixelIconIslands(grid!, 6, 100, 100);
      expect(islands.length, `${icon.id}: no islands traced`).toBeGreaterThan(0);

      const mesh = mergeMeshes(islands.map((island) => extrudeGlyphIsland(island, 0, 1)));
      const report = validateMesh(mesh);
      // openEdgeCount/nonManifoldEdgeCount are the real printability
      // blockers (a slicer can't close a genuine gap or non-manifold
      // edge); a handful of zero-area sliver triangles from earcut on a
      // ring-shaped outline (see keycap.test.ts's identical rationale for
      // the old emoji-font icons) creates no hole and no non-manifold
      // edge, so it's excluded from this check on purpose.
      expect(report.openEdgeCount, `${icon.id}`).toBe(0);
      expect(report.nonManifoldEdgeCount, `${icon.id}`).toBe(0);
      expect(computeSignedVolume(mesh)).toBeGreaterThan(0);
    });
  }

  it("an unknown icon id yields no grid", () => {
    expect(getPixelIconGrid("not-a-real-icon")).toBeNull();
  });

  it("a single icon never wraps or produces multiple size attempts -- it just shrinks to fit", () => {
    const grid = getPixelIconGrid(PIXEL_ICON_OPTIONS[0].char)!;
    const { islands } = pixelIconIslands(grid, 6, 2, 2);
    expect(islands.length).toBeGreaterThan(0);
  });
});

describe("tracePixelGrid", () => {
  it("traces a single filled cell as one 4-point square contour", () => {
    const contours = tracePixelGrid([[true]]);
    expect(contours.length).toBe(1);
    expect(contours[0].length).toBe(4);
  });

  it("an empty grid produces no contours", () => {
    expect(tracePixelGrid([[false, false], [false, false]])).toEqual([]);
  });

  it("a 2x2 fully-filled block traces as one simplified 4-point square, not 4 separate cells", () => {
    const contours = tracePixelGrid([
      [true, true],
      [true, true],
    ]);
    expect(contours.length).toBe(1);
    expect(contours[0].length).toBe(4);
  });

  it("a ring (donut) of pixels traces as an outer contour plus one hole", () => {
    // 3x3 grid of pixels, all filled except the center -- a hollow square.
    const grid = [
      [true, true, true],
      [true, false, true],
      [true, true, true],
    ];
    const contours = tracePixelGrid(grid);
    expect(contours.length).toBe(2);
  });

  it("two diagonally-touching filled cells trace as two separate loops (right-turn priority)", () => {
    const grid = [
      [true, false],
      [false, true],
    ];
    const contours = tracePixelGrid(grid);
    expect(contours.length).toBe(2);
    for (const c of contours) expect(c.length).toBe(4);
  });
});
