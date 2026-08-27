/**
 * A closed 2D polygon approximating a rounded rectangle, centered at the
 * origin, wound counter-clockwise as seen from +Z looking down the -Z axis
 * (standard math convention: increasing angle = CCW from above). This
 * winding sense is required by `loftProfiles` (src/generators/loft.ts),
 * which derives outward-facing 3D winding from it.
 *
 * `segmentsPerCorner` points are emitted per 90-degree corner arc
 * (segmentsPerCorner+1 points including both endpoints), so a profile has
 * `4 * (segmentsPerCorner + 1)` points total when `cornerRadius > 0`, or
 * exactly 4 (sharp corners) when it's ~0.
 */
export function roundedRectProfile(
  widthMm: number,
  lengthMm: number,
  cornerRadiusMm: number,
  segmentsPerCorner = 6,
): Array<[number, number]> {
  const hw = widthMm / 2;
  const hl = lengthMm / 2;
  const r = Math.max(0, Math.min(cornerRadiusMm, hw, hl));

  if (r < 1e-6) {
    // sharp-cornered rectangle, CCW from above starting at bottom-right
    return [
      [hw, -hl],
      [hw, hl],
      [-hw, hl],
      [-hw, -hl],
    ];
  }

  // each entry: [corner center x, corner center y, arc start angle]
  const corners: Array<[number, number, number]> = [
    [hw - r, -hl + r, -Math.PI / 2], // bottom-right corner, sweeps -90deg -> 0deg
    [hw - r, hl - r, 0], // top-right, 0 -> 90deg
    [-hw + r, hl - r, Math.PI / 2], // top-left, 90 -> 180deg
    [-hw + r, -hl + r, Math.PI], // bottom-left, 180 -> 270deg
  ];

  const points: Array<[number, number]> = [];
  for (const [cx, cy, startAngle] of corners) {
    for (let i = 0; i <= segmentsPerCorner; i++) {
      const angle = startAngle + (Math.PI / 2) * (i / segmentsPerCorner);
      points.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
    }
  }
  return points;
}

export function polygonCentroid2D(points: Array<[number, number]>): [number, number] {
  let sx = 0;
  let sy = 0;
  for (const [x, y] of points) {
    sx += x;
    sy += y;
  }
  return [sx / points.length, sy / points.length];
}
