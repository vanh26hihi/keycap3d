import { describe, expect, it } from "vitest";
import { extrudeGlyphIsland } from "../src/generators/glyphExtrude.js";
import { layoutLegendIslands } from "../src/generators/legendLayout.js";
import { mergeMeshes, computeSignedVolume } from "../src/mesh.js";
import { validateMesh } from "../src/validate.js";

describe("extrudeGlyphIsland", () => {
  it("a holeless island (plain square) extrudes to a watertight box with the exact expected volume", () => {
    const square: Array<[number, number]> = [
      [-5, -5],
      [5, -5],
      [5, 5],
      [-5, 5],
    ];
    const mesh = extrudeGlyphIsland({ outer: square, holes: [] }, 0, 3);
    const report = validateMesh(mesh);
    expect(report.isWatertight).toBe(true);
    expect(report.inconsistentWindingEdgeCount).toBe(0);
    expect(computeSignedVolume(mesh)).toBeCloseTo(10 * 10 * 3, 4);
  });

  it("an island with a hole extrudes to a watertight ring solid with volume = outer - hole", () => {
    const outer: Array<[number, number]> = [
      [-5, -5],
      [5, -5],
      [5, 5],
      [-5, 5],
    ];
    const holeCW: Array<[number, number]> = [
      [-2, 2],
      [2, 2],
      [2, -2],
      [-2, -2],
    ]; // already CW
    const mesh = extrudeGlyphIsland({ outer, holes: [holeCW] }, 0, 3);
    const report = validateMesh(mesh);
    expect(report.isWatertight).toBe(true);
    expect(report.inconsistentWindingEdgeCount).toBe(0);
    expect(computeSignedVolume(mesh)).toBeCloseTo(10 * 10 * 3 - 4 * 4 * 3, 4);
  });

  it("an island with two holes (e.g. a 'B'-like shape) stays watertight", () => {
    const outer: Array<[number, number]> = [
      [-5, -10],
      [5, -10],
      [5, 10],
      [-5, 10],
    ];
    const holeA: Array<[number, number]> = ([
      [-2, 4],
      [2, 4],
      [2, 7],
      [-2, 7],
    ] as Array<[number, number]>).reverse();
    const holeB: Array<[number, number]> = ([
      [-2, -7],
      [2, -7],
      [2, -4],
      [-2, -4],
    ] as Array<[number, number]>).reverse();
    const mesh = extrudeGlyphIsland({ outer, holes: [holeA, holeB] }, 0, 2);
    const report = validateMesh(mesh);
    expect(report.isWatertight).toBe(true);
    expect(computeSignedVolume(mesh)).toBeGreaterThan(0);
  });
});

describe("layoutLegendIslands + extrudeGlyphIsland: real font glyphs end-to-end", () => {
  it("every letter A-Z and digit 0-9 extrudes to watertight, positive-volume, non-degenerate geometry", async () => {
    for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") {
      const { islands } = layoutLegendIslands(ch, 6, 100, 100);
      expect(islands.length, `char "${ch}"`).toBeGreaterThan(0);
      const mesh = mergeMeshes(islands.map((isl) => extrudeGlyphIsland(isl, 0, 1)));
      const report = validateMesh(mesh);
      expect(report.isWatertight, `char "${ch}"`).toBe(true);
      expect(report.degenerateTriangleCount, `char "${ch}"`).toBe(0);
      expect(computeSignedVolume(mesh), `char "${ch}"`).toBeGreaterThan(0);
    }
  });

  it("a multi-character word (with letters that have holes, like 'ESCAPE') extrudes to one watertight merged solid", () => {
    const { islands } = layoutLegendIslands("ESCAPE", 6, 100, 100);
    const mesh = mergeMeshes(islands.map((isl) => extrudeGlyphIsland(isl, 0, 1)));
    const report = validateMesh(mesh);
    expect(report.isWatertight).toBe(true);
    expect(report.degenerateTriangleCount).toBe(0);
  });

  it("a single capital letter's rendered cap-height matches the requested targetCapHeightMm when it fits (no shrink needed)", () => {
    const result = layoutLegendIslands("A", 6.5, 100, 100);
    expect(result.actualCapHeightMm).toBeCloseTo(6.5, 3);
  });

  it("an oversized request (long word, small available space) shrinks rather than overflowing", () => {
    const result = layoutLegendIslands("SHIFT", 6.5, 11, 11); // ~11mm available, matches an 18mm keycap's default top footprint
    expect(result.actualCapHeightMm).toBeLessThan(6.5);
    expect(result.actualCapHeightMm).toBeGreaterThan(0);
  });

  it("an unsupported character (Unicode Private Use Area codepoint, guaranteed not mapped by this font) renders blank but doesn't throw or eat a neighboring real character", () => {
    const unsupportedChar = String.fromCodePoint(0xe000);
    const withUnsupported = layoutLegendIslands(`A${unsupportedChar}A`, 6, 100, 100);
    const plain = layoutLegendIslands("AA", 6, 100, 100);
    expect(withUnsupported.islands.length).toBeGreaterThan(0);
    expect(withUnsupported.islands.length).toBe(plain.islands.length);
  });
});
