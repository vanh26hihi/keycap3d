import type { GlyphIsland } from "./glyphOutline";
import { pointInPolygon, signedArea2D } from "./glyphOutline";

type Pt = [number, number];

/** N/E/S/W as 0/1/2/3, in clockwise order (matches how "clockwise" looks on
 *  screen in a normal Y-up frame: N->E->S->W->N, like a clock face). Used
 *  only to disambiguate branching vertices in `tracePixelGrid` below. */
function dirIndex(dx: number, dy: number): number {
  if (dy === 1) return 0; // N
  if (dx === 1) return 1; // E
  if (dy === -1) return 2; // S
  return 3; // W (dx === -1)
}

interface DirEdge {
  from: Pt;
  to: Pt;
  used: boolean;
}

/**
 * Traces the boundary of a boolean pixel grid into closed polygon contours,
 * in the same "raw contour" shape `groupContoursIntoIslands` expects
 * (arbitrary winding, arbitrary nesting depth) -- the pixel-icon equivalent
 * of `flattenPathToContours` for font glyphs. Grid row 0 is the TOP of the
 * icon (Y-up output: row r's top edge sits at y = rows - r), column 0 is the
 * LEFT (x = c).
 *
 * Algorithm: every unit edge between a filled cell and a non-filled
 * neighbor (or the grid edge) is a boundary edge, oriented so the filled
 * cell is always on the edge's RIGHT-hand side as you walk it (top edges
 * point East, right edges South, bottom edges West, left edges North --
 * verified by construction: "right of East is South", etc.). Chaining these
 * into loops by following `to -> next from` produces exactly the same
 * result as tracing a solid shape's outline by hand. At a branch point
 * (more than one outgoing edge shares a vertex -- e.g. two filled regions
 * touching at a single corner, or a hole's corner meeting the outer
 * boundary), the standard "always turn right" wall-following rule picks the
 * correct continuation: since filled area is consistently on the right,
 * turning right-most keeps tracing the SAME loop instead of jumping onto an
 * unrelated one sharing that point.
 */
export function tracePixelGrid(grid: boolean[][]): Pt[][] {
  const rows = grid.length;
  const cols = rows > 0 ? grid[0].length : 0;
  const filled = (r: number, c: number): boolean => r >= 0 && r < rows && c >= 0 && c < cols && grid[r][c];

  const outgoing = new Map<string, DirEdge[]>();
  const key = (p: Pt): string => `${p[0]},${p[1]}`;
  const addEdge = (from: Pt, to: Pt): void => {
    const edge: DirEdge = { from, to, used: false };
    const k = key(from);
    const list = outgoing.get(k);
    if (list) list.push(edge);
    else outgoing.set(k, [edge]);
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!filled(r, c)) continue;
      const topY = rows - r;
      const bottomY = rows - r - 1;
      const leftX = c;
      const rightX = c + 1;
      if (!filled(r - 1, c)) addEdge([leftX, topY], [rightX, topY]);
      if (!filled(r, c + 1)) addEdge([rightX, topY], [rightX, bottomY]);
      if (!filled(r + 1, c)) addEdge([rightX, bottomY], [leftX, bottomY]);
      if (!filled(r, c - 1)) addEdge([leftX, bottomY], [leftX, topY]);
    }
  }

  const allEdges: DirEdge[] = [];
  for (const list of outgoing.values()) allEdges.push(...list);

  const contours: Pt[][] = [];
  for (const startEdge of allEdges) {
    if (startEdge.used) continue;
    const loop: Pt[] = [startEdge.from];
    let current = startEdge;
    for (;;) {
      current.used = true;
      loop.push(current.to);
      const candidates = (outgoing.get(key(current.to)) ?? []).filter((e) => !e.used);
      if (candidates.length === 0) break;
      if (candidates.length === 1) {
        current = candidates[0];
        continue;
      }
      const inIdx = dirIndex(current.to[0] - current.from[0], current.to[1] - current.from[1]);
      let best = candidates[0];
      let bestScore = Infinity;
      for (const cand of candidates) {
        const outIdx = dirIndex(cand.to[0] - cand.from[0], cand.to[1] - cand.from[1]);
        // 0 = sharpest right turn (highest priority), 3 = doubling back.
        const score = ((outIdx - (inIdx + 1)) % 4 + 4) % 4;
        if (score < bestScore) {
          bestScore = score;
          best = cand;
        }
      }
      current = best;
    }
    if (loop.length > 1) {
      const first = loop[0];
      const last = loop[loop.length - 1];
      if (first[0] === last[0] && first[1] === last[1]) loop.pop();
    }
    if (loop.length >= 3) contours.push(simplifyCollinear(loop));
  }
  return contours;
}

/** Drops points that sit exactly between their two neighbors on the same
 *  straight run (a long flat edge produces one point per pixel otherwise) --
 *  keeps island contours small and avoids near-zero-area earcut triangles
 *  along runs of collinear boundary points. */
function simplifyCollinear(loop: Pt[]): Pt[] {
  const n = loop.length;
  const result: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const prev = loop[(i - 1 + n) % n];
    const cur = loop[i];
    const next = loop[(i + 1) % n];
    const dx1 = cur[0] - prev[0];
    const dy1 = cur[1] - prev[1];
    const dx2 = next[0] - cur[0];
    const dy2 = next[1] - cur[1];
    if (Math.abs(dx1 * dy2 - dy1 * dx2) > 1e-9) result.push(cur);
  }
  return result.length >= 3 ? result : loop;
}

export interface PixelIconLayoutResult {
  islands: GlyphIsland[];
  actualCapHeightMm: number;
}

/**
 * Traces a pixel bitmap and lays it out in millimeter space: the grid's own
 * bounding-box height becomes `targetCapHeightMm` (a bitmap icon has no
 * baseline/cap-height concept the way text does -- its whole ink extent IS
 * its visual size), then uniformly shrunk (never grown) to fit
 * maxWidthMm/maxHeightMm, and centered at local (0,0) -- mirrors
 * `layoutLegendIslands`'s final centering/scaling block so the result plugs
 * into the same `extrudeGlyphIsland` pipeline a text/font-based legend uses.
 */
export function pixelIconIslands(
  grid: boolean[][],
  targetCapHeightMm: number,
  maxWidthMm: number,
  maxHeightMm: number,
): PixelIconLayoutResult {
  const contours = tracePixelGrid(grid);
  if (contours.length === 0) return { islands: [], actualCapHeightMm: 0 };
  const rawIslands = groupPixelContoursIntoIslands(contours);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
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
  if (rawHeight <= 0 || rawWidth <= 0) return { islands: [], actualCapHeightMm: 0 };

  const mmPerRawUnit = targetCapHeightMm / rawHeight;
  const blockWidthMm = rawWidth * mmPerRawUnit;
  const blockHeightMm = rawHeight * mmPerRawUnit;
  const shrink = Math.min(1, maxWidthMm / blockWidthMm, maxHeightMm / blockHeightMm);
  const finalScale = mmPerRawUnit * shrink;

  const transform = (ring: Pt[]): Pt[] => ring.map(([x, y]) => [(x - centerX) * finalScale, (y - centerY) * finalScale]);
  const islands: GlyphIsland[] = rawIslands.map((island) => ({
    outer: transform(island.outer),
    holes: island.holes.map(transform),
  }));

  return { islands, actualCapHeightMm: targetCapHeightMm * shrink };
}

/**
 * A point guaranteed to sit strictly inside `contour` (never exactly on its
 * boundary), close to its first edge. Pixel-traced contours routinely share
 * an EXACT coincident vertex with a different, disjoint contour (two
 * separate icon shapes that happen to touch at one shared grid corner --
 * unlike smooth font-glyph curves, where floating-point bezier points from
 * different letterforms essentially never land on the exact same
 * coordinate). Testing containment from a contour's raw first vertex (what
 * `glyphOutline.ts`'s `groupContoursIntoIslands` does, correctly, for font
 * glyphs) is ill-defined for ray-casting point-in-polygon when that vertex
 * sits exactly on another contour's edge, and was observed to spuriously
 * report "contained" for such touching-but-disjoint pixel contours. A point
 * hugging the contour's own edge, nudged inward by a small amount, is never
 * on another shape's boundary.
 */
function interiorProbe(contour: Pt[]): Pt {
  const [x0, y0] = contour[0];
  const [x1, y1] = contour[1] ?? contour[0];
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const eps = Math.max(len * 0.25, 1e-4);
  const candidateA: Pt = [mx + nx * eps, my + ny * eps];
  const candidateB: Pt = [mx - nx * eps, my - ny * eps];
  return pointInPolygon(candidateA, contour) ? candidateA : candidateB;
}

/**
 * The pixel-icon equivalent of `glyphOutline.ts`'s `groupContoursIntoIslands`
 * -- same even-odd nesting-by-depth logic, but probing containment from
 * `interiorProbe` above instead of each contour's raw first vertex, which
 * is what pixel-traced contours specifically need (see that function's doc
 * comment). Kept as its own copy rather than parameterizing the shared
 * function with a probe callback: the two probes solve genuinely different
 * problems (shared-vertex touching contours here; nothing analogous for
 * font glyphs) and letting each stay simple/self-contained is clearer than
 * one function trying to serve both.
 */
function groupPixelContoursIntoIslands(contours: Pt[][]): GlyphIsland[] {
  const areas = contours.map(signedArea2D);
  const parentOf: (number | null)[] = contours.map(() => null);
  const probes = contours.map(interiorProbe);

  for (let i = 0; i < contours.length; i++) {
    let bestParent = -1;
    let bestArea = Infinity;
    for (let j = 0; j < contours.length; j++) {
      if (i === j) continue;
      if (pointInPolygon(probes[i], contours[j]) && Math.abs(areas[j]) < bestArea) {
        bestParent = j;
        bestArea = Math.abs(areas[j]);
      }
    }
    parentOf[i] = bestParent >= 0 ? bestParent : null;
  }

  const depthOf = (i: number): number => {
    let depth = 0;
    let cur = parentOf[i];
    const visited = new Set<number>([i]);
    while (cur !== null && !visited.has(cur)) {
      visited.add(cur);
      depth++;
      cur = parentOf[cur];
    }
    return depth;
  };
  const depths = contours.map((_, i) => depthOf(i));

  const islands = new Map<number, GlyphIsland>();
  for (let i = 0; i < contours.length; i++) {
    if (depths[i] % 2 === 0) {
      const outer = areas[i] < 0 ? [...contours[i]].reverse() : contours[i];
      islands.set(i, { outer, holes: [] });
    }
  }
  for (let i = 0; i < contours.length; i++) {
    if (depths[i] % 2 !== 0 && parentOf[i] !== null) {
      const island = islands.get(parentOf[i]!);
      if (!island) continue;
      const hole = areas[i] > 0 ? [...contours[i]].reverse() : contours[i];
      island.holes.push(hole);
    }
  }
  return Array.from(islands.values());
}
