import { computeBoundingBox } from "@keycap-web/geometry-core";
import type { ProjectState, SceneNodeState } from "../state/types";

export interface OccupiedRect {
  cx: number;
  cy: number;
  w: number;
  l: number;
}

/** A node's occupied footprint in the XY (bed) plane, centered on its own
 *  designTransform position. Keycap nodes use their own widthMm/lengthMm
 *  directly (cheap, exact); any other node (imported STL, split part, test
 *  primitive) falls back to its mesh's own XY bounding box size, since
 *  there's no simpler "footprint" concept for arbitrary geometry. */
function occupiedRectFor(node: SceneNodeState): OccupiedRect {
  const [cx, cy] = node.designTransform.position;
  if (node.parametric) {
    return { cx, cy, w: node.parametric.params.widthMm, l: node.parametric.params.lengthMm };
  }
  const box = computeBoundingBox(node.mesh);
  return { cx, cy, w: box.size[0] * node.designTransform.scale[0], l: box.size[1] * node.designTransform.scale[1] };
}

export function occupiedRectsForProject(project: ProjectState): OccupiedRect[] {
  return project.order.map((id) => project.nodes[id]).filter((n): n is SceneNodeState => !!n).map(occupiedRectFor);
}

function rectsOverlap(a: OccupiedRect, b: OccupiedRect): boolean {
  return Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 && Math.abs(a.cy - b.cy) < (a.l + b.l) / 2;
}

/**
 * Finds the nearest-to-origin XY position (spiraling outward on a grid
 * sized to `w`/`l` plus `gapMm`) whose w x l footprint doesn't overlap any
 * of `existing`'s occupied rects. Used so a newly created keycap never
 * spawns directly on top of one that's already there (the previous
 * behavior: every "+ Keycap" with no explicit position always landed at
 * the exact same [0,0,0], invisibly stacking on whatever was already at
 * the origin).
 */
export function findFreePosition(existing: OccupiedRect[], w: number, l: number, gapMm = 2): [number, number] {
  const stepX = w + gapMm;
  const stepY = l + gapMm;
  const MAX_RING = 200; // generous -- 200 rings covers thousands of occupied cells before giving up
  for (let ring = 0; ring <= MAX_RING; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        // Only the OUTER edge of this ring -- interior cells were already
        // tried at a smaller ring value.
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        // `|| 0` normalizes -0 (e.g. dx=-0 when ring=0) to a plain 0 -- both
        // are numerically identical, but -0 is a confusing thing to store
        // in a position field or assert against in a test.
        const candidate: OccupiedRect = { cx: dx * stepX || 0, cy: dy * stepY || 0, w, l };
        if (!existing.some((r) => rectsOverlap(candidate, r))) {
          return [candidate.cx, candidate.cy];
        }
      }
    }
  }
  return [0, 0]; // exhausted the search space -- should never realistically happen
}
