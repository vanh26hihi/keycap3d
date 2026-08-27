import type { MeshBuffer } from "./mesh";
import { weldVertices } from "./mesh";
import { applyMatrixToMesh, composeExportMatrix, type PrintTransform, type Transform } from "./transform";

const STL_HEADER_BYTES = 80;

/**
 * Serializes a MeshBuffer (already in the coordinate space you want written
 * to disk — see `exportNodeAsSTL` if you need transform baking) to a binary
 * STL ArrayBuffer. Per-facet normals are recomputed from triangle winding
 * rather than trusting `mesh.normals` (STL has one normal per facet, not per
 * vertex, and must reflect actual winding for slicers that trust it over
 * recomputing); a degenerate (zero-area) triangle writes a (0,0,0) normal,
 * which is what most STL consumers already treat degenerate facets as.
 */
export function exportSTLBinary(mesh: MeshBuffer, name = "geometry-core"): ArrayBuffer {
  const triCount = mesh.indices.length / 3;
  const byteLength = STL_HEADER_BYTES + 4 + triCount * 50;
  const buffer = new ArrayBuffer(byteLength);
  const view = new DataView(buffer);

  const headerBytes = new TextEncoder().encode(name.slice(0, STL_HEADER_BYTES));
  new Uint8Array(buffer, 0, STL_HEADER_BYTES).set(headerBytes);

  view.setUint32(STL_HEADER_BYTES, triCount, true);

  const pos = mesh.positions;
  const idx = mesh.indices;
  let offset = STL_HEADER_BYTES + 4;

  for (let t = 0; t < triCount; t++) {
    const ia = idx[t * 3] * 3, ib = idx[t * 3 + 1] * 3, ic = idx[t * 3 + 2] * 3;
    const ax = pos[ia], ay = pos[ia + 1], az = pos[ia + 2];
    const bx = pos[ib], by = pos[ib + 1], bz = pos[ib + 2];
    const cx = pos[ic], cy = pos[ic + 1], cz = pos[ic + 2];

    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 1e-12) {
      nx /= len; ny /= len; nz /= len;
    } else {
      nx = 0; ny = 0; nz = 0;
    }

    view.setFloat32(offset, nx, true); offset += 4;
    view.setFloat32(offset, ny, true); offset += 4;
    view.setFloat32(offset, nz, true); offset += 4;

    view.setFloat32(offset, ax, true); offset += 4;
    view.setFloat32(offset, ay, true); offset += 4;
    view.setFloat32(offset, az, true); offset += 4;

    view.setFloat32(offset, bx, true); offset += 4;
    view.setFloat32(offset, by, true); offset += 4;
    view.setFloat32(offset, bz, true); offset += 4;

    view.setFloat32(offset, cx, true); offset += 4;
    view.setFloat32(offset, cy, true); offset += 4;
    view.setFloat32(offset, cz, true); offset += 4;

    view.setUint16(offset, 0, true); offset += 2; // attribute byte count, unused
  }

  return buffer;
}

/**
 * Composes designTransform (+ optional printTransform) into a single matrix
 * and bakes it into the mesh before serializing — the file's raw triangle
 * coordinates already carry the object's real-world mm position/rotation, so
 * a slicer needs no external transform to display correct dimensions.
 */
export function exportNodeAsSTL(
  mesh: MeshBuffer,
  design: Transform,
  print: PrintTransform | null | undefined,
  name = "geometry-core",
): ArrayBuffer {
  const matrix = composeExportMatrix(design, print ?? null);
  const baked = applyMatrixToMesh(mesh, matrix);
  return exportSTLBinary(baked, name);
}

/**
 * Parses raw STL bytes into an unindexed MeshBuffer (each triangle owns its
 * own 3 vertices, exactly as stored in the file — sequential indices
 * `[0,1,2,3,...]`). Does not weld coincident vertices; call `importSTL`
 * instead for a ready-to-use indexed mesh, or call `weldVertices` yourself
 * if you need a non-default epsilon.
 */
export function parseSTL(buffer: ArrayBuffer): MeshBuffer {
  if (isBinarySTL(buffer)) {
    return parseBinarySTL(buffer);
  }
  const text = new TextDecoder("utf-8").decode(buffer);
  return parseAsciiSTL(text);
}

/**
 * The standard STL sniffing heuristic: a binary file's byte length is
 * exactly determined by its header-declared triangle count
 * (`80 + 4 + triCount*50`). We check that first and trust it over the
 * "starts with the word 'solid'" heuristic, because some binary STL writers
 * put an ASCII-looking name (even literally starting with "solid") in the
 * 80-byte header — matching declared size is the only heuristic that can't
 * be fooled by that.
 */
function isBinarySTL(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < STL_HEADER_BYTES + 4) return false;
  const view = new DataView(buffer);
  const triCount = view.getUint32(STL_HEADER_BYTES, true);
  const expectedSize = STL_HEADER_BYTES + 4 + triCount * 50;
  return expectedSize === buffer.byteLength;
}

function parseBinarySTL(buffer: ArrayBuffer): MeshBuffer {
  const view = new DataView(buffer);
  const triCount = view.getUint32(STL_HEADER_BYTES, true);
  const positions = new Float32Array(triCount * 9);
  const normals = new Float32Array(triCount * 9);
  const indices = new Uint32Array(triCount * 3);

  let offset = STL_HEADER_BYTES + 4;
  for (let t = 0; t < triCount; t++) {
    const nx = view.getFloat32(offset, true);
    const ny = view.getFloat32(offset + 4, true);
    const nz = view.getFloat32(offset + 8, true);
    offset += 12;

    for (let v = 0; v < 3; v++) {
      const vi = t * 3 + v;
      positions[vi * 3] = view.getFloat32(offset, true);
      positions[vi * 3 + 1] = view.getFloat32(offset + 4, true);
      positions[vi * 3 + 2] = view.getFloat32(offset + 8, true);
      normals[vi * 3] = nx;
      normals[vi * 3 + 1] = ny;
      normals[vi * 3 + 2] = nz;
      indices[vi] = vi;
      offset += 12;
    }
    offset += 2; // attribute byte count
  }

  return { positions, indices, normals };
}

const VERTEX_RE = /vertex\s+([-+.\deE]+)\s+([-+.\deE]+)\s+([-+.\deE]+)/g;

function parseAsciiSTL(text: string): MeshBuffer {
  const verts: number[] = [];
  let match: RegExpExecArray | null;
  VERTEX_RE.lastIndex = 0;
  while ((match = VERTEX_RE.exec(text)) !== null) {
    verts.push(parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3]));
  }
  if (verts.length % 9 !== 0) {
    throw new Error(
      `parseAsciiSTL: found ${verts.length / 3} vertices, which is not a whole number of triangles (multiple of 3). The file is likely truncated or malformed.`,
    );
  }
  const positions = new Float32Array(verts);
  const vertCount = positions.length / 3;
  const indices = new Uint32Array(vertCount);
  for (let i = 0; i < vertCount; i++) indices[i] = i;
  return { positions, indices };
}

/**
 * Ready-to-use import: parses the file, then welds coincident vertices
 * (default epsilon 1e-5mm — tight enough to only merge true duplicates /
 * float32 round-off, loose enough to survive an STL round-trip through this
 * package's own exporter) so the result has real shared topology and can be
 * fed to `validateMesh` or the Boolean Engine.
 */
export function importSTL(buffer: ArrayBuffer, epsilonMm = 1e-5): MeshBuffer {
  const parsed = parseSTL(buffer);
  return weldVertices(parsed, epsilonMm);
}
