/**
 * Unit convention for the entire pipeline: 1 world/scene unit = 1 millimeter.
 *
 * Every generator, transform, STL importer/exporter, and boolean operation in
 * this package operates directly in millimeters. There is no implicit scale
 * factor anywhere — a value of `18` always means `18mm`. If a future consumer
 * needs a different display unit, convert at the UI edge, never inside
 * geometry-core.
 */
export const MM_PER_UNIT = 1 as const;

/** Explicit identity conversions, kept so call sites document intent instead of hiding a bare number. */
export function mmToUnits(mm: number): number {
  return mm * MM_PER_UNIT;
}

export function unitsToMm(units: number): number {
  return units / MM_PER_UNIT;
}

/**
 * STL files carry no unit metadata. The 3D-printing ecosystem (slicers,
 * Bambu Studio/Cura/PrusaSlicer included) treats raw STL coordinates as
 * millimeters by convention, so import never auto-scales. This only flags
 * bounding boxes that are implausible for a print-oriented mesh (e.g. a file
 * authored in meters, which would import as a ~0.001-unit speck) so the
 * caller can offer an explicit, user-confirmed correction instead of guessing.
 */
export interface ScaleSanityCheck {
  suspicious: boolean;
  reason: string | null;
  maxDimensionMm: number;
}

const SUSPICIOUSLY_SMALL_MM = 1;
const SUSPICIOUSLY_LARGE_MM = 1000;

export function checkImportScaleSanity(maxDimensionMm: number): ScaleSanityCheck {
  if (maxDimensionMm <= 0) {
    return { suspicious: true, reason: "Model has zero or negative size.", maxDimensionMm };
  }
  if (maxDimensionMm < SUSPICIOUSLY_SMALL_MM) {
    return {
      suspicious: true,
      reason: `Largest dimension is ${maxDimensionMm.toFixed(4)}mm — smaller than 1mm. The source file may have been authored in meters or inches; verify before printing.`,
      maxDimensionMm,
    };
  }
  if (maxDimensionMm > SUSPICIOUSLY_LARGE_MM) {
    return {
      suspicious: true,
      reason: `Largest dimension is ${maxDimensionMm.toFixed(1)}mm — larger than 1000mm. Verify this is intentional before printing.`,
      maxDimensionMm,
    };
  }
  return { suspicious: false, reason: null, maxDimensionMm };
}
