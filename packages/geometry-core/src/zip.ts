/**
 * A minimal, dependency-free ZIP writer -- STORED (uncompressed) entries
 * only, no deflate. Written from scratch rather than pulling in a library
 * because this needs to run identically in both Node (fixture/export
 * scripts) and the browser (the app's "Export 3MF" button, client-side, no
 * server round-trip) -- Node's own `zlib` isn't available to browser
 * bundles, and STORED entries don't need compression at all: a 3MF's
 * payload (XML + mesh data) is small enough that skipping deflate costs
 * nothing meaningful in file size for this use case.
 */

function crc32(data: Uint8Array): number {
  let crc = ~0;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let bit = 0; bit < 8; bit++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return ~crc >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** Builds a ZIP archive (as raw bytes) containing the given entries, stored
 *  uncompressed. Entry order in `entries` is preserved in the archive. */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const localHeader = new DataView(new ArrayBuffer(30));
    localHeader.setUint32(0, 0x04034b50, true);
    localHeader.setUint16(4, 20, true); // version needed
    localHeader.setUint16(6, 0, true); // flags
    localHeader.setUint16(8, 0, true); // compression: stored
    localHeader.setUint16(10, 0, true); // mod time
    localHeader.setUint16(12, 0, true); // mod date
    localHeader.setUint32(14, crc, true);
    localHeader.setUint32(18, size, true); // compressed size
    localHeader.setUint32(22, size, true); // uncompressed size
    localHeader.setUint16(26, nameBytes.length, true);
    localHeader.setUint16(28, 0, true); // extra field length

    const localHeaderBytes = new Uint8Array(localHeader.buffer);
    localChunks.push(localHeaderBytes, nameBytes, entry.data);

    const centralHeader = new DataView(new ArrayBuffer(46));
    centralHeader.setUint32(0, 0x02014b50, true);
    centralHeader.setUint16(4, 20, true); // version made by
    centralHeader.setUint16(6, 20, true); // version needed
    centralHeader.setUint16(8, 0, true); // flags
    centralHeader.setUint16(10, 0, true); // compression: stored
    centralHeader.setUint16(12, 0, true); // mod time
    centralHeader.setUint16(14, 0, true); // mod date
    centralHeader.setUint32(16, crc, true);
    centralHeader.setUint32(20, size, true);
    centralHeader.setUint32(24, size, true);
    centralHeader.setUint16(28, nameBytes.length, true);
    centralHeader.setUint16(30, 0, true); // extra field length
    centralHeader.setUint16(32, 0, true); // comment length
    centralHeader.setUint16(34, 0, true); // disk number start
    centralHeader.setUint16(36, 0, true); // internal attrs
    centralHeader.setUint32(38, 0, true); // external attrs
    centralHeader.setUint32(42, offset, true); // local header offset

    const centralHeaderBytes = new Uint8Array(centralHeader.buffer);
    centralChunks.push(centralHeaderBytes, nameBytes);

    offset += localHeaderBytes.length + nameBytes.length + entry.data.length;
  }

  const centralDirectoryOffset = offset;
  const centralDirectorySize = centralChunks.reduce((sum, c) => sum + c.length, 0);

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(4, 0, true); // disk number
  eocd.setUint16(6, 0, true); // disk with central directory
  eocd.setUint16(8, entries.length, true); // entries on this disk
  eocd.setUint16(10, entries.length, true); // total entries
  eocd.setUint32(12, centralDirectorySize, true);
  eocd.setUint32(16, centralDirectoryOffset, true);
  eocd.setUint16(20, 0, true); // comment length

  return concatBytes([...localChunks, ...centralChunks, new Uint8Array(eocd.buffer)]);
}
