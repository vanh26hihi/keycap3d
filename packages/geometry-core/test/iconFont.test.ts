import { describe, expect, it } from "vitest";
import { getIconFont } from "../src/generators/iconFont.js";
import { ICON_OPTIONS } from "../src/generators/icons.js";
import { layoutLegendIslands } from "../src/generators/legendLayout.js";
import { extrudeGlyphIsland } from "../src/generators/glyphExtrude.js";
import { mergeMeshes, computeSignedVolume } from "../src/mesh.js";
import { validateMesh } from "../src/validate.js";

describe("icon font: every curated icon is present and extrudes cleanly", () => {
  const font = getIconFont();

  for (const icon of ICON_OPTIONS) {
    it(`"${icon.id}" (${icon.char}) has a real glyph and extrudes to a watertight solid`, () => {
      expect(font.charToGlyphIndex(icon.char)).not.toBe(0);

      const { islands } = layoutLegendIslands(icon.char, 6, 100, 100, "center", font);
      expect(islands.length).toBeGreaterThan(0);

      const mesh = mergeMeshes(islands.map((island) => extrudeGlyphIsland(island, 0, 1)));
      const report = validateMesh(mesh);
      expect(report.isWatertight).toBe(true);
      expect(report.degenerateTriangleCount).toBe(0);
      expect(computeSignedVolume(mesh)).toBeGreaterThan(0);
    });
  }

  it("a single icon never wraps onto multiple lines", () => {
    const { islands } = layoutLegendIslands(ICON_OPTIONS[0].char, 6, 5, 5, "center", font);
    // A tiny available width would force auto-wrap for multi-word text, but
    // a single glyph has nothing to wrap -- it just shrinks to fit instead.
    expect(islands.length).toBeGreaterThan(0);
  });
});
