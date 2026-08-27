import { describe, expect, it } from "vitest";
import { exportMultiPart3MF } from "../src/threemf.js";
import { createCubeMesh } from "../src/primitives/cube.js";
import { createCylinderMesh } from "../src/primitives/cylinder.js";

/** Minimal ZIP reader (same approach as zip.test.ts) -- reads STORED
 *  entries sequentially, enough to pull the 3MF's model XML back out for
 *  inspection without needing a real ZIP library. */
function readStoredEntries(zip: Uint8Array): Map<string, string> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const decoder = new TextDecoder();
  const entries = new Map<string, string>();
  let offset = 0;
  while (offset < zip.length) {
    const signature = view.getUint32(offset, true);
    if (signature !== 0x04034b50) break;
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = decoder.decode(zip.slice(nameStart, nameStart + nameLength));
    const data = decoder.decode(zip.slice(dataStart, dataStart + size));
    entries.set(name, data);
    offset = dataStart + size;
  }
  return entries;
}

describe("exportMultiPart3MF", () => {
  it("produces a ZIP with the 3 files a minimal valid 3MF needs", () => {
    const zip = exportMultiPart3MF([{ name: "Part", mesh: createCubeMesh(10, 10, 10) }]);
    const entries = readStoredEntries(zip);
    expect(entries.has("[Content_Types].xml")).toBe(true);
    expect(entries.has("_rels/.rels")).toBe(true);
    expect(entries.has("3D/3dmodel.model")).toBe(true);
  });

  it("the model XML declares one <object> per part, each with the right vertex/triangle counts", () => {
    const cube = createCubeMesh(10, 10, 10);
    const cylinder = createCylinderMesh(5, 8, 16);
    const zip = exportMultiPart3MF([
      { name: "Vo keycap", mesh: cube },
      { name: "Chu Icon", mesh: cylinder },
    ]);
    const model = readStoredEntries(zip).get("3D/3dmodel.model")!;

    const objectMatches = [...model.matchAll(/<object id="(\d+)"[^>]*name="([^"]*)"/g)];
    expect(objectMatches).toHaveLength(2);
    expect(objectMatches[0][2]).toBe("Vo keycap");
    expect(objectMatches[1][2]).toBe("Chu Icon");

    const vertexCounts = [...model.matchAll(/<vertices>((?:<vertex[^>]*\/>)*)<\/vertices>/g)].map(
      (m) => (m[1].match(/<vertex/g) ?? []).length,
    );
    expect(vertexCounts[0]).toBe(cube.positions.length / 3);
    expect(vertexCounts[1]).toBe(cylinder.positions.length / 3);

    const triangleCounts = [...model.matchAll(/<triangles>((?:<triangle[^>]*\/>)*)<\/triangles>/g)].map(
      (m) => (m[1].match(/<triangle/g) ?? []).length,
    );
    expect(triangleCounts[0]).toBe(cube.indices.length / 3);
    expect(triangleCounts[1]).toBe(cylinder.indices.length / 3);
  });

  it("declares a <build> item for every object, referencing valid object ids", () => {
    const zip = exportMultiPart3MF([
      { name: "A", mesh: createCubeMesh(5, 5, 5) },
      { name: "B", mesh: createCubeMesh(5, 5, 5) },
      { name: "C", mesh: createCubeMesh(5, 5, 5) },
    ]);
    const model = readStoredEntries(zip).get("3D/3dmodel.model")!;
    const buildSection = model.match(/<build>(.*)<\/build>/)![1];
    const itemIds = [...buildSection.matchAll(/objectid="(\d+)"/g)].map((m) => m[1]);
    expect(itemIds).toEqual(["1", "2", "3"]);
  });

  it("escapes a part name containing XML-special characters", () => {
    const zip = exportMultiPart3MF([{ name: `A & B "quoted" <tag>`, mesh: createCubeMesh(5, 5, 5) }]);
    const model = readStoredEntries(zip).get("3D/3dmodel.model")!;
    expect(model).toContain("A &amp; B &quot;quoted&quot; &lt;tag&gt;");
    expect(model).not.toContain(`A & B "quoted" <tag>`);
  });

  it("throws for an empty parts list rather than producing a build with nothing in it", () => {
    expect(() => exportMultiPart3MF([])).toThrow();
  });
});
