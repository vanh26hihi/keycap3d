/**
 * Flattens an opentype.js glyph path into closed 2D polygon contours, in
 * this package's Y-up convention (opentype.js path coordinates are Y-down --
 * baseline at y=0, ascenders at negative y -- since it targets canvas
 * rendering; negated here once, at the source, so every downstream consumer
 * can assume ordinary Y-up math like `roundedRectProfile`).
 */

// opentype.js has no first-class TS types shipped for Path commands in the
// version pinned here; this is the minimal shape this module actually reads.
interface PathCommand {
  type: "M" | "L" | "C" | "Q" | "Z";
  x?: number;
  y?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}
export interface OpentypePathLike {
  commands: PathCommand[];
}

// Bumped from 8 (was visibly faceted on curved letters like "O"/"S" in a
// real print) -- same rationale as keycap.ts's PROFILE_SEGMENTS_PER_CORNER
// and CYLINDER_SEGMENTS: more line segments approximating the curve is the
// only lever that actually changes what a slicer/printer produces.
const CURVE_SEGMENTS = 12;

function quadraticPoint(p0: [number, number], p1: [number, number], p2: [number, number], t: number): [number, number] {
  const mt = 1 - t;
  return [mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0], mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1]];
}

function cubicPoint(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  t: number,
): [number, number] {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

/** Flattens a glyph outline into one or more closed contours (Y-up, mm or
 *  whatever unit the path was generated in -- this function doesn't scale
 *  anything). Each contour is deduplicated so its last point isn't a literal
 *  repeat of its first (both `layoutGlyphContours`'s caller and `earcut`
 *  expect an implicitly-closed ring, not an explicit closing duplicate). */
export function flattenPathToContours(path: OpentypePathLike): Array<Array<[number, number]>> {
  const contours: Array<Array<[number, number]>> = [];
  let current: Array<[number, number]> = [];
  let cursor: [number, number] = [0, 0];
  let start: [number, number] = [0, 0];

  const pushPoint = (p: [number, number]) => {
    const last = current[current.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > 1e-9 || Math.abs(last[1] - p[1]) > 1e-9) {
      current.push(p);
    }
  };

  // A contour's closing edge is implicit (the ring wraps its last point back
  // to its first) -- but not every font path spells that closure the same
  // way: some end each subpath with an explicit 'Z', others (this one
  // included) just draw an ordinary 'L' whose destination happens to equal
  // the subpath's start point, with no 'Z' at all. Relying on 'Z' alone to
  // dedupe that trailing point missed this font's contours entirely (found
  // empirically: an "O" glyph produced a literal zero-length wrap-around
  // edge, which validate.ts's own open-edge/degenerate-triangle counters
  // then correctly flagged as a bug, not silently absorbed). Deduping at
  // every contour BOUNDARY (a new 'M' or end-of-path) instead of at 'Z'
  // handles both conventions uniformly.
  const finishContour = () => {
    if (current.length >= 2) {
      const last = current[current.length - 1];
      if (Math.abs(last[0] - start[0]) < 1e-9 && Math.abs(last[1] - start[1]) < 1e-9) {
        current.pop();
      }
    }
    if (current.length >= 3) contours.push(current);
    current = [];
  };

  for (const cmd of path.commands) {
    if (cmd.type === "M") {
      finishContour();
      cursor = [cmd.x!, -cmd.y!];
      start = cursor;
      current.push(cursor);
    } else if (cmd.type === "L") {
      cursor = [cmd.x!, -cmd.y!];
      pushPoint(cursor);
    } else if (cmd.type === "Q") {
      const p1: [number, number] = [cmd.x1!, -cmd.y1!];
      const p2: [number, number] = [cmd.x!, -cmd.y!];
      for (let i = 1; i <= CURVE_SEGMENTS; i++) pushPoint(quadraticPoint(cursor, p1, p2, i / CURVE_SEGMENTS));
      cursor = p2;
    } else if (cmd.type === "C") {
      const p1: [number, number] = [cmd.x1!, -cmd.y1!];
      const p2: [number, number] = [cmd.x2!, -cmd.y2!];
      const p3: [number, number] = [cmd.x!, -cmd.y!];
      for (let i = 1; i <= CURVE_SEGMENTS; i++) pushPoint(cubicPoint(cursor, p1, p2, p3, i / CURVE_SEGMENTS));
      cursor = p3;
    }
    // 'Z' is treated as a no-op marker: closure is handled uniformly by
    // finishContour() at the next 'M' (or end-of-path below), whether or
    // not this particular font bothered to emit an explicit 'Z'.
  }
  finishContour();
  return contours;
}

export function signedArea2D(points: Array<[number, number]>): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    area += x0 * y1 - x1 * y0;
  }
  return area / 2;
}

function pointInPolygon(point: [number, number], polygon: Array<[number, number]>): boolean {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export interface GlyphIsland {
  /** Outer boundary, forced to CCW (positive signed area). */
  outer: Array<[number, number]>;
  /** Hole boundaries (e.g. the counter of an "O" or "A"), forced to CW
   *  (negative signed area). */
  holes: Array<[number, number]>[];
}

/**
 * Groups a glyph's flattened contours into islands (an outer boundary plus
 * any holes nested directly inside it) -- necessary because a single
 * character can be several disjoint shapes (e.g. "i" is a stem + a separate
 * dot; "%" is two circles and a slash) each of which may itself have holes
 * (e.g. "B" is one outer with two holes). Containment is decided by a
 * point-in-polygon test of each contour's first point against every other
 * contour, which is O(contours^2) but glyphs have at most a handful of
 * contours so this is not a performance concern.
 *
 * Nesting can go arbitrarily deep -- e.g. some emoji glyphs (a pupil inside
 * an eye-white inside a face outline) are 3 levels deep, not the 2 levels
 * (outer + hole) every Latin/digit glyph needs. Standard even-odd fill
 * handles this uniformly: a contour's fill/hole role is decided by its
 * *depth* (how many other contours contain it), not merely "is it inside
 * something" -- even depth (0, 2, 4...) is solid material, odd depth is a
 * hole cut into its immediate (even-depth) parent. A solid nested inside a
 * hole (depth 2) becomes its own new island, with any odd-depth contours
 * immediately inside IT as its own holes, and so on.
 */
/**
 * A point guaranteed to sit strictly inside `contour` (never exactly on its
 * boundary), close to its first edge -- used as the containment probe below
 * instead of either the contour's raw first vertex or its centroid. Why not
 * those two more obvious choices: the first vertex can sit exactly ON
 * another contour's boundary (e.g. two disjoint pixel-icon shapes that
 * happen to touch at a shared grid corner -- see pixelTrace.ts), which is an
 * ill-defined case for ray-casting point-in-polygon and was observed to
 * spuriously report "contained"; the centroid fails differently for a
 * RING/annulus shape (an outline icon's outer boundary and its concentric
 * hole share almost the same centroid, so the outer contour's own centroid
 * can land INSIDE the hole, misclassifying which one is the parent). A
 * point hugging the contour's own edge, nudged inward by a small amount, is
 * never on another shape's boundary and never drifts across into a
 * differently-centered concentric hole.
 */
function interiorProbe(contour: Array<[number, number]>): [number, number] {
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
  const candidateA: [number, number] = [mx + nx * eps, my + ny * eps];
  const candidateB: [number, number] = [mx - nx * eps, my - ny * eps];
  return pointInPolygon(candidateA, contour) ? candidateA : candidateB;
}

export function groupContoursIntoIslands(contours: Array<Array<[number, number]>>): GlyphIsland[] {
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

  // Walks the parent chain to compute nesting depth. Guarded against cycles
  // (a visited-set, not just a counter) because parentOf is built from
  // approximate point-in-polygon containment on flattened curves -- two
  // near-degenerate or touching contours can, in principle, each test as
  // "containing" the other's first point. A real containment chain can never
  // cycle (each step strictly shrinks in area), so any cycle found here is
  // itself the signal to stop rather than a shape this font is expected to
  // produce.
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
