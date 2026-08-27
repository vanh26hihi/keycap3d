import { describe, expect, it } from "vitest";
import { findFreePosition, type OccupiedRect } from "../src/lib/placement.js";

function overlaps(a: OccupiedRect, b: OccupiedRect): boolean {
  return Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 && Math.abs(a.cy - b.cy) < (a.l + b.l) / 2;
}

describe("findFreePosition", () => {
  it("with nothing occupied yet, places at the origin", () => {
    const [x, y] = findFreePosition([], 18.5, 18.5);
    expect(x).toBe(0);
    expect(y).toBe(0);
  });

  it("with the origin already occupied, finds a position that does NOT overlap it", () => {
    const existing: OccupiedRect[] = [{ cx: 0, cy: 0, w: 18.5, l: 18.5 }];
    const [x, y] = findFreePosition(existing, 18.5, 18.5);
    const candidate: OccupiedRect = { cx: x, cy: y, w: 18.5, l: 18.5 };
    expect(overlaps(candidate, existing[0])).toBe(false);
  });

  it("picks the position closest to the origin among the valid options (not just any free spot)", () => {
    const existing: OccupiedRect[] = [{ cx: 0, cy: 0, w: 18.5, l: 18.5 }];
    const [x, y] = findFreePosition(existing, 18.5, 18.5, 2);
    // The very next ring out should be exactly one step away on some axis.
    const dist = Math.max(Math.abs(x), Math.abs(y));
    expect(dist).toBeCloseTo(18.5 + 2, 6);
  });

  it("with many existing keycaps packed tightly, still finds a free spot that overlaps none of them", () => {
    const existing: OccupiedRect[] = [];
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        existing.push({ cx: i * 20.5, cy: j * 20.5, w: 18.5, l: 18.5 });
      }
    }
    const [x, y] = findFreePosition(existing, 18.5, 18.5, 2);
    const candidate: OccupiedRect = { cx: x, cy: y, w: 18.5, l: 18.5 };
    expect(existing.some((r) => overlaps(candidate, r))).toBe(false);
  });

  it("works for a different footprint size than what's already occupied (e.g. a bigger custom keycap)", () => {
    const existing: OccupiedRect[] = [{ cx: 0, cy: 0, w: 18.5, l: 18.5 }];
    const [x, y] = findFreePosition(existing, 30, 30, 2);
    const candidate: OccupiedRect = { cx: x, cy: y, w: 30, l: 30 };
    expect(overlaps(candidate, existing[0])).toBe(false);
  });
});
