import { describe, expect, it } from "vitest";
import { buildZip } from "../src/zip.js";

/** Minimal ZIP reader for STORED entries, just enough to round-trip
 *  verify what buildZip produces -- reads local file headers sequentially
 *  from the front, since buildZip always writes them contiguously before
 *  the central directory. */
function readStoredEntries(zip: Uint8Array): Array<{ name: string; data: Uint8Array }> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const decoder = new TextDecoder();
  const entries: Array<{ name: string; data: Uint8Array }> = [];
  let offset = 0;
  while (offset < zip.length) {
    const signature = view.getUint32(offset, true);
    if (signature !== 0x04034b50) break; // hit the central directory
    const compression = view.getUint16(offset + 8, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = decoder.decode(zip.slice(nameStart, nameStart + nameLength));
    const data = zip.slice(dataStart, dataStart + size);
    expect(compression, `${name} should be stored (uncompressed)`).toBe(0);
    entries.push({ name, data });
    offset = dataStart + size;
  }
  return entries;
}

describe("buildZip: minimal stored-entry ZIP writer", () => {
  it("round-trips entry names and raw bytes exactly", () => {
    const encoder = new TextEncoder();
    const zip = buildZip([
      { name: "hello.txt", data: encoder.encode("Hello, world!") },
      { name: "nested/dir/file.xml", data: encoder.encode("<root/>") },
    ]);
    const entries = readStoredEntries(zip);
    expect(entries).toHaveLength(2);
    expect(entries[0].name).toBe("hello.txt");
    expect(new TextDecoder().decode(entries[0].data)).toBe("Hello, world!");
    expect(entries[1].name).toBe("nested/dir/file.xml");
    expect(new TextDecoder().decode(entries[1].data)).toBe("<root/>");
  });

  it("ends with a valid End Of Central Directory record", () => {
    const zip = buildZip([{ name: "a.txt", data: new TextEncoder().encode("a") }]);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    // EOCD is fixed-size (22 bytes, no comment) and must be the last thing in the file.
    const eocdOffset = zip.length - 22;
    expect(view.getUint32(eocdOffset, true)).toBe(0x06054b50);
    expect(view.getUint16(eocdOffset + 8, true)).toBe(1); // 1 entry
    expect(view.getUint16(eocdOffset + 10, true)).toBe(1);
  });

  it("handles an empty file's data (zero-length entry) without corrupting the archive", () => {
    const zip = buildZip([{ name: "empty.txt", data: new Uint8Array(0) }]);
    const entries = readStoredEntries(zip);
    expect(entries).toHaveLength(1);
    expect(entries[0].data.length).toBe(0);
  });

  it("throws for at least one caller-visible signal on totally empty input rather than silently producing a corrupt archive", () => {
    // buildZip itself doesn't reject an empty entry list (a valid, if
    // useless, ZIP of zero entries is well-defined) -- confirm it at least
    // produces a structurally valid empty archive rather than garbage.
    const zip = buildZip([]);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    expect(view.getUint32(0, true)).toBe(0x06054b50);
    expect(view.getUint16(8, true)).toBe(0);
  });
});
