import { describe, expect, it } from "vitest";
import { flattenPathToContours, groupContoursIntoIslands, signedArea2D, type OpentypePathLike } from "../src/generators/glyphOutline.js";
import { getLegendFont } from "../src/generators/legendFont.js";

describe("signedArea2D", () => {
  it("is positive for a CCW square and negative for the same square reversed (CW)", () => {
    const ccw: Array<[number, number]> = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    expect(signedArea2D(ccw)).toBeGreaterThan(0);
    expect(signedArea2D([...ccw].reverse())).toBeLessThan(0);
    expect(Math.abs(signedArea2D(ccw))).toBeCloseTo(1, 6);
  });
});

describe("flattenPathToContours", () => {
  it("closes a contour even when the font path has no explicit 'Z' (a trailing 'L' back to the start point instead)", () => {
    // Reproduces a real bug found via the embedded font's own glyphs: this
    // font's paths end each subpath with an ordinary L whose destination
    // equals the M's start, with no Z command at all. A naive "dedupe only
    // on Z" implementation left a literal zero-length wrap-around edge,
    // which validateMesh's own open-edge counter then correctly caught as a
    // real defect -- fixed by deduping at every contour BOUNDARY (a new M or
    // end-of-path), not just at Z.
    const path: OpentypePathLike = {
      commands: [
        { type: "M", x: 0, y: 0 },
        { type: "L", x: 10, y: 0 },
        { type: "L", x: 10, y: 10 },
        { type: "L", x: 0, y: 10 },
        { type: "L", x: 0, y: 0 }, // closes back to start, no Z follows
      ],
    };
    const contours = flattenPathToContours(path);
    expect(contours).toHaveLength(1);
    expect(contours[0]).toHaveLength(4); // not 5 -- the duplicate closing point must be dropped
  });

  it("also closes correctly when the font DOES use an explicit 'Z'", () => {
    const path: OpentypePathLike = {
      commands: [
        { type: "M", x: 0, y: 0 },
        { type: "L", x: 10, y: 0 },
        { type: "L", x: 10, y: 10 },
        { type: "L", x: 0, y: 10 },
        { type: "Z" },
      ],
    };
    const contours = flattenPathToContours(path);
    expect(contours).toHaveLength(1);
    expect(contours[0]).toHaveLength(4);
  });

  it("negates Y (opentype.js paths are Y-down; this package is Y-up everywhere else)", () => {
    const path: OpentypePathLike = {
      commands: [
        { type: "M", x: 5, y: 3 },
        { type: "L", x: 5, y: -3 },
        { type: "L", x: 9, y: -3 },
        { type: "Z" },
      ],
    };
    const contours = flattenPathToContours(path);
    expect(contours[0][0]).toEqual([5, -3]);
    expect(contours[0][1]).toEqual([5, 3]);
    expect(contours[0][2]).toEqual([9, 3]);
  });

  it("splits multiple M...Z subpaths into separate contours", () => {
    const path: OpentypePathLike = {
      commands: [
        { type: "M", x: 0, y: 0 },
        { type: "L", x: 1, y: 0 },
        { type: "L", x: 1, y: 1 },
        { type: "Z" },
        { type: "M", x: 5, y: 5 },
        { type: "L", x: 6, y: 5 },
        { type: "L", x: 6, y: 6 },
        { type: "Z" },
      ],
    };
    expect(flattenPathToContours(path)).toHaveLength(2);
  });

  it("flattens a quadratic curve into more than 2 points (real curvature, not a straight line)", () => {
    const path: OpentypePathLike = {
      commands: [
        { type: "M", x: 0, y: 0 },
        { type: "Q", x1: 5, y1: 10, x: 10, y: 0 },
        { type: "L", x: 0, y: 0 },
      ],
    };
    const contour = flattenPathToContours(path)[0];
    expect(contour.length).toBeGreaterThan(3);
  });
});

describe("groupContoursIntoIslands", () => {
  it("a single closed contour with no nesting is its own island with no holes", () => {
    const square: Array<[number, number]> = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const islands = groupContoursIntoIslands([square]);
    expect(islands).toHaveLength(1);
    expect(islands[0].holes).toHaveLength(0);
  });

  it("a contour nested inside another becomes its hole, normalized outer=CCW/hole=CW", () => {
    const outer: Array<[number, number]> = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const innerCCW: Array<[number, number]> = [
      [3, 3],
      [7, 3],
      [7, 7],
      [3, 7],
    ];
    const islands = groupContoursIntoIslands([outer, innerCCW]);
    expect(islands).toHaveLength(1);
    expect(islands[0].holes).toHaveLength(1);
    expect(signedArea2D(islands[0].outer)).toBeGreaterThan(0);
    expect(signedArea2D(islands[0].holes[0])).toBeLessThan(0);
  });

  it("two disjoint (non-nested) contours become two separate islands (like the dot and stem of 'i')", () => {
    const stem: Array<[number, number]> = [
      [0, 0],
      [1, 0],
      [1, 5],
      [0, 5],
    ];
    const dot: Array<[number, number]> = [
      [0, 7],
      [1, 7],
      [1, 8],
      [0, 8],
    ];
    const islands = groupContoursIntoIslands([stem, dot]);
    expect(islands).toHaveLength(2);
    expect(islands[0].holes).toHaveLength(0);
    expect(islands[1].holes).toHaveLength(0);
  });
});

describe("the embedded legend font loads and produces usable glyph data", () => {
  it("loads without throwing and reports a plausible unitsPerEm", () => {
    const font = getLegendFont();
    expect(font.unitsPerEm).toBeGreaterThan(0);
  });

  it("common legend characters (A-Z, 0-9) all resolve to a real glyph, not .notdef", () => {
    const font = getLegendFont();
    for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") {
      expect(font.charToGlyphIndex(ch), `char "${ch}"`).toBeGreaterThan(0);
    }
  });

  it("'O' produces one island with exactly one hole (its counter)", () => {
    const font = getLegendFont();
    const path = font.charToGlyph("O").getPath(0, 0, font.unitsPerEm);
    const islands = groupContoursIntoIslands(flattenPathToContours(path));
    expect(islands).toHaveLength(1);
    expect(islands[0].holes).toHaveLength(1);
  });

  it("'L' produces one island with no holes", () => {
    const font = getLegendFont();
    const path = font.charToGlyph("L").getPath(0, 0, font.unitsPerEm);
    const islands = groupContoursIntoIslands(flattenPathToContours(path));
    expect(islands).toHaveLength(1);
    expect(islands[0].holes).toHaveLength(0);
  });
});
