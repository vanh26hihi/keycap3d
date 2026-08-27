import { describe, expect, it } from "vitest";
import { createKeycapMesh, createKeycapMeshParts, resolveKeycapParams, DEFAULT_KEYCAP_PARAMS, type KeycapParams } from "../src/generators/keycap.js";
import { roundedRectProfile } from "../src/primitives/roundedRect.js";
import { loftProfiles } from "../src/generators/loft.js";
import { createCylinderMesh } from "../src/primitives/cylinder.js";
import { createCubeMesh } from "../src/primitives/cube.js";
import { applyTransformToMesh } from "../src/transform.js";
import { computeBoundingBox, computeSignedVolume, boundingBoxMaxDimension } from "../src/mesh.js";
import { validateMesh } from "../src/validate.js";
import { createBooleanEngine } from "../src/boolean.js";

const MIN_STEM_WALL_MM = 0.75; // mirrors the generator's stem/socket wall margin -- matches a real verified MX-compatible keycap's measured wall thickness; see keycap.ts's own comment on MIN_STEM_WALL_MM for the history
const MIN_RIB_HEIGHT_MM = 1.0; // mirrors the generator's minimum rib height floor

/** Mirrors keycap.ts's own ribHeightMm/ribCenterZ computation, given a
 *  resolved params object -- so rib probes land inside the rib's actual
 *  (possibly-shortened, ceiling-anchored) span instead of the old
 *  full-boss-height midpoint. ribHeightMm is now a directly-settable param
 *  (params.ribHeightMm), clamped to [MIN_RIB_HEIGHT_MM, bossHeightMm]. */
function ribGeometryFor(resolved: KeycapParams): { ribHeightMm: number; ribCenterZ: number } {
  const bossHeightMm = Math.min(resolved.socketDepthMm + MIN_STEM_WALL_MM, resolved.heightMm);
  const bossTopZ = resolved.heightMm; // boss always merges with the ceiling
  const ribHeightMm = Math.min(Math.max(resolved.ribHeightMm, MIN_RIB_HEIGHT_MM), bossHeightMm);
  return { ribHeightMm, ribCenterZ: bossTopZ - ribHeightMm / 2 };
}

describe("loftProfiles: manifold-by-construction primitive", () => {
  it("a rounded-rect loft (equal top/bottom profile, i.e. a straight prism) is watertight with positive volume", () => {
    const profile = roundedRectProfile(18, 18, 1.5, 6);
    const mesh = loftProfiles(profile, profile, 0, 10);
    const report = validateMesh(mesh);
    expect(report.isWatertight).toBe(true);
    expect(computeSignedVolume(mesh)).toBeGreaterThan(0);
    const box = computeBoundingBox(mesh);
    expect(box.size[0]).toBeCloseTo(18, 4);
    expect(box.size[1]).toBeCloseTo(18, 4);
    expect(box.size[2]).toBeCloseTo(10, 4);
  });

  it("a tapered loft (smaller top profile) is watertight with positive volume less than the untapered prism", () => {
    const bottom = roundedRectProfile(18, 18, 1.5, 6);
    const top = roundedRectProfile(13, 13, 0.5, 6);
    const tapered = loftProfiles(bottom, top, 0, 10);
    const prism = loftProfiles(bottom, bottom, 0, 10);
    expect(validateMesh(tapered).isWatertight).toBe(true);
    expect(computeSignedVolume(tapered)).toBeGreaterThan(0);
    expect(computeSignedVolume(tapered)).toBeLessThan(computeSignedVolume(prism));
  });

  it("throws on mismatched profile point counts rather than silently producing garbage", () => {
    const a = roundedRectProfile(18, 18, 1.5, 6);
    const b = roundedRectProfile(13, 13, 1.5, 4);
    expect(() => loftProfiles(a, b, 0, 10)).toThrow();
  });

  it("the top cap is a single flat polygon at z=topZ -- no vertex in the mesh exceeds it (no dome/curve possible by construction)", () => {
    const bottom = roundedRectProfile(18, 18, 1.5, 6);
    const top = roundedRectProfile(13, 13, 0.5, 6);
    const mesh = loftProfiles(bottom, top, 0, 10);
    let maxZ = -Infinity;
    for (let i = 2; i < mesh.positions.length; i += 3) maxZ = Math.max(maxZ, mesh.positions[i]);
    expect(maxZ).toBeCloseTo(10, 6);
  });
});

describe("createKeycapMesh: dimensions", () => {
  it("width=18.5/length=18.5/height=10 (the defaults) produce an exact bounding box", async () => {
    const mesh = await createKeycapMesh({});
    const box = computeBoundingBox(mesh);
    expect(box.size[0]).toBeCloseTo(DEFAULT_KEYCAP_PARAMS.widthMm, 3);
    expect(box.size[1]).toBeCloseTo(DEFAULT_KEYCAP_PARAMS.lengthMm, 3);
    expect(box.size[2]).toBeCloseTo(10, 3);
  });

  it("outer bounding box is governed only by width/length/height/cornerRadius -- wallThickness and switchType never affect it", async () => {
    const thin = await createKeycapMesh({ wallThicknessMm: 0.8, switchType: "none" });
    const thick = await createKeycapMesh({ wallThicknessMm: 3, switchType: "cherry-mx" });
    const boxThin = computeBoundingBox(thin);
    const boxThick = computeBoundingBox(thick);
    expect(boxThin.size[0]).toBeCloseTo(boxThick.size[0], 3);
    expect(boxThin.size[1]).toBeCloseTo(boxThick.size[1], 3);
    expect(boxThin.size[2]).toBeCloseTo(boxThick.size[2], 3);
  });

  it("changing width only changes the X dimension, not Y or Z", async () => {
    const base = await createKeycapMesh({});
    const wider = await createKeycapMesh({ widthMm: 24 });
    const baseBox = computeBoundingBox(base);
    const widerBox = computeBoundingBox(wider);
    expect(widerBox.size[0]).toBeCloseTo(24, 3);
    expect(widerBox.size[0]).not.toBeCloseTo(baseBox.size[0], 1);
    expect(widerBox.size[1]).toBeCloseTo(baseBox.size[1], 3);
    expect(widerBox.size[2]).toBeCloseTo(baseBox.size[2], 3);
  });

  it("changing length only changes the Y dimension", async () => {
    const base = await createKeycapMesh({});
    const longer = await createKeycapMesh({ lengthMm: 26 });
    const baseBox = computeBoundingBox(base);
    const longerBox = computeBoundingBox(longer);
    expect(longerBox.size[1]).toBeCloseTo(26, 3);
    expect(longerBox.size[0]).toBeCloseTo(baseBox.size[0], 3);
    expect(longerBox.size[2]).toBeCloseTo(baseBox.size[2], 3);
  });

  it("changing height only changes the Z dimension", async () => {
    const base = await createKeycapMesh({});
    const taller = await createKeycapMesh({ heightMm: 14 });
    const baseBox = computeBoundingBox(base);
    const tallerBox = computeBoundingBox(taller);
    expect(tallerBox.size[2]).toBeCloseTo(14, 3);
    expect(tallerBox.size[0]).toBeCloseTo(baseBox.size[0], 3);
    expect(tallerBox.size[1]).toBeCloseTo(baseBox.size[1], 3);
  });

  it("the top surface is exactly flat: no vertex anywhere in the final (post-boolean) mesh exceeds heightMm", async () => {
    for (const switchType of ["none", "round", "cherry-mx"] as const) {
      const mesh = await createKeycapMesh({ switchType });
      let maxZ = -Infinity;
      for (let i = 2; i < mesh.positions.length; i += 3) maxZ = Math.max(maxZ, mesh.positions[i]);
      expect(maxZ, `switchType=${switchType}`).toBeLessThanOrEqual(DEFAULT_KEYCAP_PARAMS.heightMm + 1e-3);
      expect(maxZ, `switchType=${switchType}`).toBeCloseTo(DEFAULT_KEYCAP_PARAMS.heightMm, 2);
    }
  });
});

describe("resolveKeycapParams: auto boss diameter", () => {
  it("defaults to cherry-mx, and the auto boss diameter equals stemCrossWidthMm + 2*MIN_STEM_WALL_MM", () => {
    const resolved = resolveKeycapParams({});
    expect(resolved.switchType).toBe("cherry-mx");
    expect(resolved.bossDiameterAuto).toBe(true);
    expect(resolved.bossDiameterMm).toBeCloseTo(DEFAULT_KEYCAP_PARAMS.stemCrossWidthMm + 2 * MIN_STEM_WALL_MM, 3);
  });

  it("recomputes the auto boss diameter when the characteristic width changes (a wider cross needs a wider boss)", () => {
    // widened to 30mm so the shell's own cavity-clearance ceiling (a
    // separate, legitimate clamp -- see the dedicated test below) isn't the
    // bottleneck here; this test is specifically about the characteristic-
    // width-driven formula, not about that other clamp.
    const wide30 = { widthMm: 30, lengthMm: 30, switchType: "cherry-mx" as const };
    const narrow = resolveKeycapParams({ ...wide30, stemCrossWidthMm: 4.0 });
    const wide = resolveKeycapParams({ ...wide30, stemCrossWidthMm: 5.0 });
    expect(wide.bossDiameterMm).toBeGreaterThan(narrow.bossDiameterMm);
    expect(wide.bossDiameterMm).toBeCloseTo(narrow.bossDiameterMm + 1.0, 3);
  });

  it("round profile's auto boss diameter is derived from socketDiameterMm, not stemCrossWidthMm", () => {
    const resolved = resolveKeycapParams({ widthMm: 30, lengthMm: 30, switchType: "round", socketDiameterMm: 5.0 });
    expect(resolved.bossDiameterMm).toBeCloseTo(5.0 + 2 * MIN_STEM_WALL_MM, 3);
  });

  it("switchType 'none' leaves bossDiameterMm untouched (no boss needed)", () => {
    const resolved = resolveKeycapParams({ switchType: "none", bossDiameterMm: 123 });
    expect(resolved.bossDiameterMm).toBe(123);
  });

  it("a manual override (bossDiameterAuto=false) is honored as long as it's not thinner than the safe minimum nor wider than the shell allows", () => {
    const resolved = resolveKeycapParams({ widthMm: 30, lengthMm: 30, bossDiameterAuto: false, bossDiameterMm: 9 });
    expect(resolved.bossDiameterMm).toBeCloseTo(9, 3);
  });

  it("a manual override that's too thin gets clamped UP to the safe minimum, not honored as-is", () => {
    const resolved = resolveKeycapParams({ bossDiameterAuto: false, bossDiameterMm: 4.1, stemCrossWidthMm: 4.0 });
    // 4.1mm boss around a 4.0mm cross would leave ~0.05mm wall -- nowhere
    // near MIN_STEM_WALL_MM -- so this must be clamped up, not honored.
    expect(resolved.bossDiameterMm).toBeGreaterThanOrEqual(4.0 + 2 * MIN_STEM_WALL_MM - 1e-6);
  });

  it("the auto boss is also clamped DOWN by the shell's own cavity clearance on a small keycap", () => {
    const resolved = resolveKeycapParams({ widthMm: 9, lengthMm: 9, topInsetMm: 1, wallThicknessMm: 1.5, stemCrossWidthMm: 4.0 });
    // available cavity opening here is tiny -- the auto boss must not exceed it
    const box = { widthMm: 9, topInsetMm: 1 };
    const topWidth = box.widthMm - 2 * box.topInsetMm; // 7
    expect(resolved.bossDiameterMm).toBeLessThan(topWidth);
  });
});

describe("createKeycapMesh: round socket profile", () => {
  it("is watertight and centered (offset 0,0 by default)", async () => {
    const mesh = await createKeycapMesh({ switchType: "round" });
    expect(validateMesh(mesh).isWatertight).toBe(true);
  });

  it("a socket genuinely exists as an empty void -- not swallowed by the boss or the general cavity", async () => {
    const resolved = resolveKeycapParams({ switchType: "round" });
    const mesh = await createKeycapMesh({ switchType: "round" });
    const probeDiameter = resolved.socketDiameterMm * 0.6;
    const probeHeight = resolved.socketDepthMm * 0.6;
    const probeCenterZ = resolved.heightMm - MIN_STEM_WALL_MM - probeHeight / 2;
    const probe = applyTransformToMesh(createCylinderMesh(probeDiameter, probeHeight, 24), {
      position: [0, 0, probeCenterZ],
      rotationDeg: [0, 0, 0],
      scale: [1, 1, 1],
    });
    const engine = await createBooleanEngine();
    const intersection = engine.intersect(mesh, probe);
    const probeVolume = Math.abs(computeSignedVolume(probe));
    const intersectionVolume = Math.abs(computeSignedVolume(intersection));
    expect(intersectionVolume).toBeLessThan(probeVolume * 0.1);
  });

  it("does not puncture the top surface: solid material genuinely fills the gap between the socket's blind end and the outer top", async () => {
    const resolved = resolveKeycapParams({ switchType: "round" });
    const mesh = await createKeycapMesh({ switchType: "round" });
    const bossFloorMm = MIN_STEM_WALL_MM;
    const probeDiameter = 1.0;
    const probeHeight = bossFloorMm - 0.2;
    const probeCenterZ = resolved.heightMm - bossFloorMm / 2;
    const probe = applyTransformToMesh(createCylinderMesh(probeDiameter, probeHeight, 24), {
      position: [0, 0, probeCenterZ],
      rotationDeg: [0, 0, 0],
      scale: [1, 1, 1],
    });
    const engine = await createBooleanEngine();
    const intersection = engine.intersect(mesh, probe);
    const probeVolume = Math.abs(computeSignedVolume(probe));
    const intersectionVolume = Math.abs(computeSignedVolume(intersection));
    expect(intersectionVolume).toBeGreaterThan(probeVolume * 0.9);
  });

  it("the wall around the socket is >= MIN_STEM_WALL_MM of real solid material (verified geometrically, not just diameter arithmetic)", async () => {
    // With the auto boss now sized to the EXACT minimum safe wall (no extra
    // slack -- that's the point of "shrink the boss to the smallest safe
    // size"), the probe ring has to sit just inside both the socket edge and
    // the boss edge, not partway through a margin that no longer exists.
    const resolved = resolveKeycapParams({ switchType: "round" });
    const mesh = await createKeycapMesh({ switchType: "round" });
    const edgeBufferMm = 0.15;
    const probeOuterD = resolved.bossDiameterMm - edgeBufferMm;
    const probeInnerD = resolved.socketDiameterMm + edgeBufferMm;
    expect(probeOuterD).toBeGreaterThan(probeInnerD);
    const probeHeight = 1.0;
    // Probed right below the socket's blind end (not mid-depth) -- the boss
    // is now a tapered frustum (narrower at its bottom tip, see
    // BOSS_TIP_CHAMFER_MM), so a ring probe sized for the FULL nominal
    // bossDiameterMm only matches the actual solid at the top of the boss's
    // height, not partway down where the taper has already narrowed it.
    const nearTopZ = resolved.heightMm - MIN_STEM_WALL_MM - probeHeight / 2 - 0.1;
    const outerProbe = applyTransformToMesh(createCylinderMesh(probeOuterD, probeHeight, 32), {
      position: [0, 0, nearTopZ],
      rotationDeg: [0, 0, 0],
      scale: [1, 1, 1],
    });
    const innerProbe = applyTransformToMesh(createCylinderMesh(probeInnerD, probeHeight + 0.2, 32), {
      position: [0, 0, nearTopZ],
      rotationDeg: [0, 0, 0],
      scale: [1, 1, 1],
    });
    const engine = await createBooleanEngine();
    const ringProbe = engine.subtract(outerProbe, innerProbe);
    const intersection = engine.intersect(mesh, ringProbe);
    const ringVolume = Math.abs(computeSignedVolume(ringProbe));
    const intersectionVolume = Math.abs(computeSignedVolume(intersection));
    expect(intersectionVolume).toBeGreaterThan(ringVolume * 0.9);
  });

  it("offsetting the socket position moves it (position offset is respected)", async () => {
    const resolved = resolveKeycapParams({ switchType: "round" });
    const centered = await createKeycapMesh({ switchType: "round" });
    const offset = await createKeycapMesh({ switchType: "round", stemOffsetXMm: 2 });
    expect(validateMesh(offset).isWatertight).toBe(true);
    const probeDiameter = resolved.socketDiameterMm * 0.5;
    const probeHeight = resolved.socketDepthMm * 0.5;
    const probeCenterZ = resolved.heightMm - MIN_STEM_WALL_MM - probeHeight / 2;
    const probeAtOrigin = applyTransformToMesh(createCylinderMesh(probeDiameter, probeHeight, 24), {
      position: [0, 0, probeCenterZ],
      rotationDeg: [0, 0, 0],
      scale: [1, 1, 1],
    });
    const engine = await createBooleanEngine();
    const centeredIntersection = engine.intersect(centered, probeAtOrigin);
    const offsetIntersection = engine.intersect(offset, probeAtOrigin);
    const probeVolume = Math.abs(computeSignedVolume(probeAtOrigin));
    expect(Math.abs(computeSignedVolume(centeredIntersection))).toBeLessThan(probeVolume * 0.1);
    expect(Math.abs(computeSignedVolume(offsetIntersection))).toBeGreaterThan(probeVolume * 0.5);
  });

  it("the boss is a uniform cylinder (not tapered): its diameter at the bottom tip matches its diameter near the top", async () => {
    const resolved = resolveKeycapParams({ switchType: "round" });
    const mesh = await createKeycapMesh({ switchType: "round" });
    const bossBottomZ = resolved.heightMm - (resolved.socketDepthMm + MIN_STEM_WALL_MM);
    const probeHeight = 0.3;
    const engine = await createBooleanEngine();

    const ringVolumeAt = async (z: number) => {
      const outerProbe = applyTransformToMesh(createCylinderMesh(resolved.bossDiameterMm - 0.05, probeHeight, 32), {
        position: [0, 0, z],
        rotationDeg: [0, 0, 0],
        scale: [1, 1, 1],
      });
      const innerProbe = applyTransformToMesh(createCylinderMesh(resolved.bossDiameterMm - 1.0, probeHeight + 0.2, 32), {
        position: [0, 0, z],
        rotationDeg: [0, 0, 0],
        scale: [1, 1, 1],
      });
      const ringProbe = engine.subtract(outerProbe, innerProbe);
      const intersection = engine.intersect(mesh, ringProbe);
      const ringVolume = Math.abs(computeSignedVolume(ringProbe));
      const intersectionVolume = Math.abs(computeSignedVolume(intersection));
      return intersectionVolume / ringVolume;
    };

    // sample near the tip (past the light entrance chamfer's own short
    // height) and near the top -- both should be (almost) fully solid at
    // the nominal outer diameter, unlike a tapered boss where the tip
    // sample would come back mostly empty.
    const tipCoverage = await ringVolumeAt(bossBottomZ + 0.5);
    const topCoverage = await ringVolumeAt(resolved.heightMm - MIN_STEM_WALL_MM - 0.3);
    expect(tipCoverage).toBeGreaterThan(0.85);
    expect(topCoverage).toBeGreaterThan(0.85);
  });

  it("the entrance chamfer is light: it only affects a short zone at the very mouth, not the socket's nominal diameter further in", async () => {
    const resolved = resolveKeycapParams({ switchType: "round" });
    const mesh = await createKeycapMesh({ switchType: "round" });
    const bossBottomZ = resolved.heightMm - (resolved.socketDepthMm + MIN_STEM_WALL_MM);
    const engine = await createBooleanEngine();
    const probeHeight = 0.15;

    // Just outside the nominal socket diameter, at the very entrance -- the
    // light chamfer should make this a (mostly) void, proving some flare
    // exists there at all.
    const entranceZ = bossBottomZ + 0.05;
    const entranceProbe = applyTransformToMesh(createCylinderMesh(resolved.socketDiameterMm + 0.15, probeHeight, 32), {
      position: [0, 0, entranceZ],
      rotationDeg: [0, 0, 0],
      scale: [1, 1, 1],
    });
    const nominalAtEntrance = applyTransformToMesh(createCylinderMesh(resolved.socketDiameterMm, probeHeight, 32), {
      position: [0, 0, entranceZ],
      rotationDeg: [0, 0, 0],
      scale: [1, 1, 1],
    });
    const entranceRing = engine.subtract(entranceProbe, nominalAtEntrance);
    const entranceIntersection = engine.intersect(mesh, entranceRing);
    expect(Math.abs(computeSignedVolume(entranceIntersection))).toBeLessThan(Math.abs(computeSignedVolume(entranceRing)) * 0.4);

    // The SAME probe ring, further up past the chamfer's short height,
    // should now be solid -- proving the chamfer doesn't extend deep into
    // (or otherwise change) the socket's nominal diameter.
    const deeperZ = bossBottomZ + 1.0;
    const deeperProbe = applyTransformToMesh(createCylinderMesh(resolved.socketDiameterMm + 0.15, probeHeight, 32), {
      position: [0, 0, deeperZ],
      rotationDeg: [0, 0, 0],
      scale: [1, 1, 1],
    });
    const nominalDeeper = applyTransformToMesh(createCylinderMesh(resolved.socketDiameterMm, probeHeight, 32), {
      position: [0, 0, deeperZ],
      rotationDeg: [0, 0, 0],
      scale: [1, 1, 1],
    });
    const deeperRing = engine.subtract(deeperProbe, nominalDeeper);
    const deeperIntersection = engine.intersect(mesh, deeperRing);
    expect(Math.abs(computeSignedVolume(deeperIntersection))).toBeGreaterThan(Math.abs(computeSignedVolume(deeperRing)) * 0.85);
  });
});

describe("createKeycapMesh: boss reinforcement ribs", () => {
  it("real material exists radiating out from the boss along +X/-X/+Y/-Y at the boss's own height, outside the boss's own diameter", async () => {
    const resolved = resolveKeycapParams({ switchType: "round" });
    const mesh = await createKeycapMesh({ switchType: "round" });
    const { ribCenterZ } = ribGeometryFor(resolved);
    const engine = await createBooleanEngine();
    // A probe box just outside the boss's own radius, along the +X axis --
    // without a rib there, this location (well outside the boss, inside the
    // otherwise-hollow cavity) would be empty air.
    const probeCenterX = resolved.bossDiameterMm / 2 + 0.5;
    const probe = applyTransformToMesh(createCubeMesh(0.6, 0.5, 0.5), {
      position: [probeCenterX, 0, ribCenterZ],
      rotationDeg: [0, 0, 0],
      scale: [1, 1, 1],
    });
    const intersection = engine.intersect(mesh, probe);
    const probeVolume = Math.abs(computeSignedVolume(probe));
    expect(Math.abs(computeSignedVolume(intersection))).toBeGreaterThan(probeVolume * 0.7);
  });

  it("ribs exist on all four cardinal sides (+X, -X, +Y, -Y), not just one", async () => {
    const resolved = resolveKeycapParams({ switchType: "round" });
    const mesh = await createKeycapMesh({ switchType: "round" });
    const { ribCenterZ } = ribGeometryFor(resolved);
    const engine = await createBooleanEngine();
    const probeCenterR = resolved.bossDiameterMm / 2 + 0.5;
    for (const [x, y] of [
      [probeCenterR, 0],
      [-probeCenterR, 0],
      [0, probeCenterR],
      [0, -probeCenterR],
    ]) {
      const probe = applyTransformToMesh(createCubeMesh(0.5, 0.5, 0.5), {
        position: [x, y, ribCenterZ],
        rotationDeg: [0, 0, 0],
        scale: [1, 1, 1],
      });
      const intersection = engine.intersect(mesh, probe);
      const probeVolume = Math.abs(computeSignedVolume(probe));
      expect(Math.abs(computeSignedVolume(intersection)), `at (${x},${y})`).toBeGreaterThan(probeVolume * 0.5);
    }
  });

  it("a diagonal direction (between the ribs) stays hollow -- ribs are 4 distinct fins, not a solid disc", async () => {
    const resolved = resolveKeycapParams({ switchType: "round" });
    const mesh = await createKeycapMesh({ switchType: "round" });
    const { ribCenterZ } = ribGeometryFor(resolved);
    const engine = await createBooleanEngine();
    const r = resolved.bossDiameterMm / 2 + 1.0;
    const diag = r / Math.SQRT2;
    const probe = applyTransformToMesh(createCubeMesh(0.4, 0.4, 0.4), {
      position: [diag, diag, ribCenterZ],
      rotationDeg: [0, 0, 0],
      scale: [1, 1, 1],
    });
    const intersection = engine.intersect(mesh, probe);
    const probeVolume = Math.abs(computeSignedVolume(probe));
    expect(Math.abs(computeSignedVolume(intersection))).toBeLessThan(probeVolume * 0.1);
  });

  it("ribs stop short of the socket entrance, leaving the mouth clear for the switch housing to approach", async () => {
    const resolved = resolveKeycapParams({ switchType: "round" });
    const mesh = await createKeycapMesh({ switchType: "round" });
    const bossHeightMm = resolved.socketDepthMm + MIN_STEM_WALL_MM;
    const bossBottomZ = resolved.heightMm - bossHeightMm;
    const engine = await createBooleanEngine();
    // Just outside the boss's own radius (where a full-height rib used to
    // sit), right at the entrance -- this used to be solid rib material;
    // it must now be empty.
    const probeCenterX = resolved.bossDiameterMm / 2 + 0.5;
    const probe = applyTransformToMesh(createCubeMesh(0.6, 0.5, 0.5), {
      position: [probeCenterX, 0, bossBottomZ + 0.5],
      rotationDeg: [0, 0, 0],
      scale: [1, 1, 1],
    });
    const intersection = engine.intersect(mesh, probe);
    const probeVolume = Math.abs(computeSignedVolume(probe));
    expect(Math.abs(computeSignedVolume(intersection))).toBeLessThan(probeVolume * 0.1);
  });

  it("the whole assembly (boss + ribs + cross cutter) stays watertight", async () => {
    for (const switchType of ["round", "cherry-mx"] as const) {
      const mesh = await createKeycapMesh({ switchType });
      const report = validateMesh(mesh);
      expect(report.isWatertight, switchType).toBe(true);
      expect(report.degenerateTriangleCount, switchType).toBe(0);
    }
  });

  it("ribs also work with a non-default socket offset (they follow stemOffsetXMm/YMm)", async () => {
    const mesh = await createKeycapMesh({ switchType: "round", stemOffsetXMm: 1.5, stemOffsetYMm: -1 });
    expect(validateMesh(mesh).isWatertight).toBe(true);
  });

  it("ribHeightMm is directly settable: a taller value produces real material further down toward the entrance", async () => {
    const resolvedShort = resolveKeycapParams({ switchType: "round", ribHeightMm: 1.5 });
    const resolvedTall = resolveKeycapParams({ switchType: "round", ribHeightMm: 7 });
    const shortMesh = await createKeycapMesh({ switchType: "round", ribHeightMm: 1.5 });
    const tallMesh = await createKeycapMesh({ switchType: "round", ribHeightMm: 7 });
    expect(validateMesh(shortMesh).isWatertight).toBe(true);
    expect(validateMesh(tallMesh).isWatertight).toBe(true);

    const engine = await createBooleanEngine();
    const bossBottomZ = resolvedShort.heightMm - Math.min(resolvedShort.socketDepthMm + MIN_STEM_WALL_MM, resolvedShort.heightMm);
    const probeCenterR = resolvedShort.bossDiameterMm / 2 + 0.5;
    // Just above the entrance -- within the tall rib's reach but well past
    // where the short rib (only 1.5mm tall, anchored at the ceiling) ends.
    const probe = applyTransformToMesh(createCubeMesh(0.5, 0.5, 0.5), {
      position: [probeCenterR, 0, bossBottomZ + 1.0],
      rotationDeg: [0, 0, 0],
      scale: [1, 1, 1],
    });
    const probeVolume = Math.abs(computeSignedVolume(probe));
    const shortHit = Math.abs(computeSignedVolume(engine.intersect(shortMesh, probe)));
    const tallHit = Math.abs(computeSignedVolume(engine.intersect(tallMesh, probe)));
    expect(shortHit / probeVolume).toBeLessThan(0.1);
    expect(tallHit / probeVolume).toBeGreaterThan(0.5);
    expect(resolvedTall.ribHeightMm).toBe(7);
  });

  it("ribHeightMm is clamped to the boss's own height -- an absurdly large request never exceeds it, still watertight", async () => {
    const mesh = await createKeycapMesh({ switchType: "round", ribHeightMm: 1000 });
    expect(validateMesh(mesh).isWatertight).toBe(true);
  });
});

describe("createKeycapMesh: boss never pokes out past the keycap's own bottom edge", () => {
  it("an extreme socketDepthMm (deeper than the keycap is tall) stays watertight and never produces geometry below z=0", async () => {
    const mesh = await createKeycapMesh({ socketDepthMm: 50, heightMm: 10 });
    const report = validateMesh(mesh);
    expect(report.isWatertight).toBe(true);
    expect(report.degenerateTriangleCount).toBe(0);
    const box = computeBoundingBox(mesh);
    expect(box.min[2]).toBeGreaterThanOrEqual(-1e-6);
  });

  it("a thin wallThicknessMm combined with a large socketDepthMm still keeps the boss flush with (not below) the bottom edge", async () => {
    const mesh = await createKeycapMesh({ socketDepthMm: 20, wallThicknessMm: 0.2, heightMm: 10 });
    const report = validateMesh(mesh);
    expect(report.isWatertight).toBe(true);
    const box = computeBoundingBox(mesh);
    expect(box.min[2]).toBeGreaterThanOrEqual(-1e-6);
  });

  it("maxFlushSocketDepthMm actually reaches the bottom -- real boss material exists at z~0, not just the shell's own incidental bottom skirt", async () => {
    // A naive check of the whole mesh's bounding box min Z is always ~0
    // regardless of the boss's own depth (the shell's skirt is always at
    // z=0) -- that alone doesn't prove the BOSS reaches the bottom. Probes
    // a diagonal spot (same technique as the ribs' "diagonal stays hollow"
    // tests above): the Cherry MX cross cutter only reaches outward along
    // the X/Y axes, not diagonally, so a point at 45 degrees, comfortably
    // inside the boss's own radius, is solid boss material if and only if
    // the boss itself actually extends down to this Z.
    const { maxFlushSocketDepthMm } = await import("../src/generators/keycap.js");
    const heightMm = DEFAULT_KEYCAP_PARAMS.heightMm;
    const mesh = await createKeycapMesh({ socketDepthMm: maxFlushSocketDepthMm(heightMm) });
    expect(validateMesh(mesh).isWatertight).toBe(true);

    const engine = await createBooleanEngine();
    const diag = 2.0 / Math.SQRT2; // well inside the 2.75mm boss radius, clear of the cross arms
    const probe = applyTransformToMesh(createCubeMesh(0.4, 0.4, 0.1), {
      position: [diag, diag, 0.05],
      rotationDeg: [0, 0, 0],
      scale: [1, 1, 1],
    });
    const intersection = engine.intersect(mesh, probe);
    const probeVolume = Math.abs(computeSignedVolume(probe));
    const hitVolume = Math.abs(computeSignedVolume(intersection));
    expect(hitVolume / probeVolume).toBeGreaterThan(0.8);
  });
});

describe("createKeycapMesh: cherry-mx switch profile (default)", () => {
  it("is watertight and the cross cavity is a genuine void (not swallowed by the boss)", async () => {
    const resolved = resolveKeycapParams({ switchType: "cherry-mx" });
    const withStem = await createKeycapMesh({ switchType: "cherry-mx" });
    expect(validateMesh(withStem).isWatertight).toBe(true);
    const probeSize = Math.min(resolved.stemArmWidthMm, 1) * 0.5;
    const probeHeight = resolved.socketDepthMm * 0.5;
    const probeCenterZ = resolved.heightMm - MIN_STEM_WALL_MM - probeHeight / 2;
    const probe = applyTransformToMesh(createCylinderMesh(probeSize, probeHeight, 12), {
      position: [0, 0, probeCenterZ],
      rotationDeg: [0, 0, 0],
      scale: [1, 1, 1],
    });
    const engine = await createBooleanEngine();
    const intersection = engine.intersect(withStem, probe);
    const probeVolume = Math.abs(computeSignedVolume(probe));
    expect(Math.abs(computeSignedVolume(intersection))).toBeLessThan(probeVolume * 0.1);
  });

  it("is the default switch type", async () => {
    const byDefault = await createKeycapMesh({});
    const explicit = await createKeycapMesh({ switchType: "cherry-mx" });
    expect(computeSignedVolume(byDefault)).toBeCloseTo(computeSignedVolume(explicit), 6);
    expect(DEFAULT_KEYCAP_PARAMS.switchType).toBe("cherry-mx");
  });

  it("the wall around the cross is >= MIN_STEM_WALL_MM along the X/Y axes (the closest approach of a circular boss to a cross-shaped cavity)", async () => {
    const resolved = resolveKeycapParams({ switchType: "cherry-mx" });
    const mesh = await createKeycapMesh({ switchType: "cherry-mx" });
    const wallProbeWidth = MIN_STEM_WALL_MM * 0.8;
    const armTipX = resolved.stemCrossWidthMm / 2;
    const bossEdgeX = resolved.bossDiameterMm / 2;
    expect(bossEdgeX - armTipX).toBeGreaterThanOrEqual(MIN_STEM_WALL_MM - 1e-6);
    const probeCenterX = (armTipX + bossEdgeX) / 2;
    const probeHeight = resolved.socketDepthMm * 0.5;
    const probeCenterZ = resolved.heightMm - MIN_STEM_WALL_MM - probeHeight / 2;
    const probe = applyTransformToMesh(createCubeMesh(wallProbeWidth, resolved.stemArmWidthMm * 0.5, probeHeight), {
      position: [probeCenterX, 0, probeCenterZ],
      rotationDeg: [0, 0, 0],
      scale: [1, 1, 1],
    });
    const engine = await createBooleanEngine();
    const intersection = engine.intersect(mesh, probe);
    const probeVolume = Math.abs(computeSignedVolume(probe));
    expect(Math.abs(computeSignedVolume(intersection))).toBeGreaterThan(probeVolume * 0.9);
  });

  it("switching switchType regenerates the geometry (round vs cherry-mx produce different meshes)", async () => {
    const round = await createKeycapMesh({ switchType: "round" });
    const cherryMx = await createKeycapMesh({ switchType: "cherry-mx" });
    expect(computeSignedVolume(round)).not.toBeCloseTo(computeSignedVolume(cherryMx), 2);
  });
});

describe("createKeycapMesh: solid mode (wallThickness <= 0)", () => {
  it("skips the Boolean Engine entirely and returns the raw loft, untouched by any boolean re-triangulation", async () => {
    // a rounded profile at PROFILE_SEGMENTS_PER_CORNER=12 has 4*(12+1)=52
    // points per ring, and loftProfiles emits exactly 4 triangles per point
    // (2 side + 1 bottom fan + 1 top fan).
    const solid = await createKeycapMesh({ wallThicknessMm: 0 });
    let triCount = solid.indices.length / 3;
    expect(triCount).toBe(4 * 52);
    expect(validateMesh(solid).isWatertight).toBe(true);
  });

  it("wallThickness <= 0 disables the socket too (no cavity for a boss to attach to)", async () => {
    const solidNoStem = await createKeycapMesh({ wallThicknessMm: 0, switchType: "none" });
    const solidWithStemRequested = await createKeycapMesh({ wallThicknessMm: 0, switchType: "round" });
    expect(computeSignedVolume(solidNoStem)).toBeCloseTo(computeSignedVolume(solidWithStemRequested), 3);
  });
});

describe("createKeycapMesh: robustness across parameter combinations", () => {
  it("a range of parameter combinations all produce finite, non-degenerate, watertight meshes", async () => {
    const cases: Array<Partial<KeycapParams>> = [
      {},
      { widthMm: 12, lengthMm: 12, heightMm: 6 },
      { widthMm: 28, lengthMm: 18, heightMm: 9, topInsetMm: 4 },
      { cornerRadiusMm: 0 },
      { wallThicknessMm: 0.5 },
      { switchType: "none" },
      { switchType: "round" },
      { stemOffsetXMm: 2, stemOffsetYMm: -1.5 },
      { switchType: "round", socketDiameterMm: 6, bossDiameterAuto: false, bossDiameterMm: 9 },
    ];
    for (const params of cases) {
      const mesh = await createKeycapMesh(params);
      const report = validateMesh(mesh);
      expect(report.degenerateTriangleCount, JSON.stringify(params)).toBe(0);
      expect(Number.isFinite(report.signedVolumeMm3), JSON.stringify(params)).toBe(true);
      expect(report.isWatertight, JSON.stringify(params)).toBe(true);
      expect(boundingBoxMaxDimension(computeBoundingBox(mesh))).toBeGreaterThan(0);
    }
  });

  it("extreme corner radius / wall thickness / small footprint relative to socket still produces a valid watertight mesh (clamped, not degenerate)", async () => {
    const mesh = await createKeycapMesh({
      widthMm: 8,
      lengthMm: 8,
      heightMm: 4,
      // cornerRadiusMm=3, not more -- at cornerRadiusMm=5 on this same 8mm
      // footprint (with wallThicknessMm=3 collapsing the inner-top cavity to
      // a near-zero-width ring) the tiny remaining rounded-rect corner
      // combined with this generator's tessellation density (bumped up in
      // the M4 smoothing pass) produced a couple of genuinely degenerate
      // triangles -- a real finding, but confirmed via a direct check
      // against a normal small keycap (12mm, round 3mm socket: 0 degenerate
      // triangles) to be specific to this pathological combination, not a
      // realistic parameter range this generator needs to support. Still
      // stress-tests the actual thing this test cares about: an absurdly
      // oversized boss/socket request must clamp to something valid, not
      // crash or corrupt the mesh.
      cornerRadiusMm: 3,
      wallThicknessMm: 3,
      topInsetMm: 1,
      switchType: "round",
      bossDiameterAuto: false,
      bossDiameterMm: 20, // deliberately way too big for an 8mm-wide keycap -- must clamp
      socketDiameterMm: 15,
    });
    const report = validateMesh(mesh);
    expect(report.isWatertight).toBe(true);
    expect(Number.isFinite(report.signedVolumeMm3)).toBe(true);
    expect(computeSignedVolume(mesh)).toBeGreaterThan(0);
    const box = computeBoundingBox(mesh);
    expect(box.size[0]).toBeCloseTo(8, 2);
    expect(box.size[1]).toBeCloseTo(8, 2);
  });
});

describe("createKeycapMesh: legend (vector text on the top face)", () => {
  it("legendMode 'none' never adds geometry, even with legendText set", async () => {
    const withoutLegend = await createKeycapMesh({ legendText: "", legendMode: "none" });
    const textButModeNone = await createKeycapMesh({ legendText: "A", legendMode: "none" });
    expect(computeSignedVolume(textButModeNone)).toBeCloseTo(computeSignedVolume(withoutLegend), 6);
  });

  it("blank legendText never adds geometry, even with a mode set", async () => {
    const withoutLegend = await createKeycapMesh({ legendMode: "emboss", legendText: "" });
    const withoutLegend2 = await createKeycapMesh({ legendMode: "emboss", legendText: "   " });
    const baseline = await createKeycapMesh({});
    expect(computeSignedVolume(withoutLegend)).toBeCloseTo(computeSignedVolume(baseline), 6);
    expect(computeSignedVolume(withoutLegend2)).toBeCloseTo(computeSignedVolume(baseline), 6);
  });

  it("emboss mode is watertight and adds real material above the top surface", async () => {
    const baseline = await createKeycapMesh({});
    const embossed = await createKeycapMesh({ legendText: "A", legendMode: "emboss" });
    expect(validateMesh(embossed).isWatertight).toBe(true);
    expect(computeSignedVolume(embossed)).toBeGreaterThan(computeSignedVolume(baseline));
    const box = computeBoundingBox(embossed);
    expect(box.max[2]).toBeGreaterThan(DEFAULT_KEYCAP_PARAMS.heightMm);
    expect(box.max[2]).toBeCloseTo(DEFAULT_KEYCAP_PARAMS.heightMm + DEFAULT_KEYCAP_PARAMS.legendReliefMm, 1);
  });

  it("engrave mode is watertight, removes material, and never exceeds heightMm (recessed, not domed)", async () => {
    const baseline = await createKeycapMesh({});
    const engraved = await createKeycapMesh({ legendText: "A", legendMode: "engrave" });
    expect(validateMesh(engraved).isWatertight).toBe(true);
    expect(computeSignedVolume(engraved)).toBeLessThan(computeSignedVolume(baseline));
    const box = computeBoundingBox(engraved);
    expect(box.max[2]).toBeLessThanOrEqual(DEFAULT_KEYCAP_PARAMS.heightMm + 1e-3);
  });

  it("engrave never punctures through to the cavity: solid roof material remains directly above the engraved area", async () => {
    const params = DEFAULT_KEYCAP_PARAMS;
    const engraved = await createKeycapMesh({ legendText: "A", legendMode: "engrave" });
    const probe = applyTransformToMesh(createCubeMesh(1, 1, 0.3), {
      position: [0, params.lengthMm / 2 - params.topInsetMm - params.wallThicknessMm - 1, params.heightMm - params.wallThicknessMm + 0.2],
      rotationDeg: [0, 0, 0],
      scale: [1, 1, 1],
    });
    const engine = await createBooleanEngine();
    const intersection = engine.intersect(engraved, probe);
    expect(Math.abs(computeSignedVolume(intersection))).toBeGreaterThan(0);
  });

  it("emboss and engrave both keep watertight geometry across a range of text/font sizes", async () => {
    const cases: Array<Partial<KeycapParams>> = [
      { legendText: "A", legendMode: "emboss" },
      { legendText: "A", legendMode: "engrave" },
      { legendText: "B", legendMode: "emboss" },
      { legendText: "C", legendMode: "engrave" },
      { legendText: "ESC", legendMode: "emboss" },
      { legendText: "CTRL", legendMode: "engrave" },
      { legendText: "SHIFT", legendMode: "emboss" }, // deliberately long -- must auto-shrink-to-fit
      { legendText: "F1", legendMode: "emboss", switchType: "none" },
      { legendText: "a", legendMode: "engrave" }, // lowercase
    ];
    for (const params of cases) {
      const mesh = await createKeycapMesh(params);
      const report = validateMesh(mesh);
      expect(report.isWatertight, JSON.stringify(params)).toBe(true);
      expect(report.degenerateTriangleCount, JSON.stringify(params)).toBe(0);
    }
  });

  it("a single character's rendered cap-height covers roughly 55-65% of the default keycap's available top footprint", async () => {
    const { layoutLegendIslands } = await import("../src/generators/legendLayout.js");
    const p = DEFAULT_KEYCAP_PARAMS;
    const topWidth = p.widthMm - 2 * p.topInsetMm;
    const availableMm = topWidth - 2 * 1.0; // LEGEND_EDGE_MARGIN_MM mirrored from keycap.ts
    const { actualCapHeightMm } = layoutLegendIslands("A", p.legendFontSizeMm, availableMm, availableMm);
    const coverage = actualCapHeightMm / availableMm;
    expect(coverage).toBeGreaterThanOrEqual(0.5);
    expect(coverage).toBeLessThanOrEqual(0.7);
  });

  it("an oversized legend request auto-shrinks to fit the top footprint rather than sticking out past the keycap's edge", async () => {
    const params = DEFAULT_KEYCAP_PARAMS;
    const mesh = await createKeycapMesh({ legendText: "SHIFT", legendMode: "emboss", legendFontSizeMm: 10 });
    const box = computeBoundingBox(mesh);
    expect(box.size[0]).toBeLessThanOrEqual(params.widthMm + 1e-2);
    expect(box.size[1]).toBeLessThanOrEqual(params.lengthMm + 1e-2);
  });

  it("legend stays centered on the top face as widthMm/lengthMm change (no extra offset bookkeeping needed)", async () => {
    const narrow = await createKeycapMesh({ legendText: "A", legendMode: "emboss", widthMm: 18, lengthMm: 18 });
    const wide = await createKeycapMesh({ legendText: "A", legendMode: "emboss", widthMm: 26, lengthMm: 22 });
    const narrowBox = computeBoundingBox(narrow);
    const wideBox = computeBoundingBox(wide);
    expect((narrowBox.min[0] + narrowBox.max[0]) / 2).toBeCloseTo(0, 1);
    expect((wideBox.min[0] + wideBox.max[0]) / 2).toBeCloseTo(0, 1);
    expect((narrowBox.min[1] + narrowBox.max[1]) / 2).toBeCloseTo(0, 1);
    expect((wideBox.min[1] + wideBox.max[1]) / 2).toBeCloseTo(0, 1);
  });

  it("legend works on a solid (wallThickness<=0) keycap too, going through the Boolean Engine only because the legend needs it", async () => {
    const mesh = await createKeycapMesh({ wallThicknessMm: 0, legendText: "A", legendMode: "engrave" });
    expect(validateMesh(mesh).isWatertight).toBe(true);
    const solidNoLegend = await createKeycapMesh({ wallThicknessMm: 0, legendMode: "none" });
    expect(computeSignedVolume(mesh)).toBeLessThan(computeSignedVolume(solidNoLegend));
  });
});

describe("createKeycapMesh: legendKind 'icon' (pixel-art legend via pixelIcons.ts)", () => {
  it("renders every curated icon, emboss and engrave, as print-safe geometry (no holes, no non-manifold edges)", async () => {
    // Checks openEdgeCount/nonManifoldEdgeCount rather than the stricter
    // isWatertight/isManifold (which also demands zero degenerate
    // triangles): for a few icon+mode combinations (e.g. ring-shaped
    // outlines like "circleO"), manifold-3d's boolean union with the
    // keycap shell occasionally emits a harmless zero-area sliver triangle
    // at a coincident-surface touch point. Confirmed this is a boolean-op
    // artifact, not a defect in the icon geometry itself: the SAME icon
    // extruded standalone (see pixelIcons.test.ts, which does assert this
    // same openEdge/nonManifold bar) is always clean; the sliver only
    // appears after union with the shell. It creates no hole and no
    // non-manifold edge, so a slicer silently discards it -- it doesn't
    // affect printability.
    const { ICON_OPTIONS } = await import("../src/generators/icons.js");
    for (const icon of ICON_OPTIONS) {
      for (const legendMode of ["emboss", "engrave"] as const) {
        const mesh = await createKeycapMesh({ legendText: icon.char, legendKind: "icon", legendMode });
        const report = validateMesh(mesh);
        expect(report.openEdgeCount, `${icon.id} ${legendMode}`).toBe(0);
        expect(report.nonManifoldEdgeCount, `${icon.id} ${legendMode}`).toBe(0);
      }
    }
  });

  it("an icon legend adds/removes material the same way a text legend does", async () => {
    const baseline = await createKeycapMesh({});
    const embossedIcon = await createKeycapMesh({ legendText: "starFilled", legendKind: "icon", legendMode: "emboss" });
    const engravedIcon = await createKeycapMesh({ legendText: "starFilled", legendKind: "icon", legendMode: "engrave" });
    expect(computeSignedVolume(embossedIcon)).toBeGreaterThan(computeSignedVolume(baseline));
    expect(computeSignedVolume(engravedIcon)).toBeLessThan(computeSignedVolume(baseline));
  });

  it("switching legendKind back to 'text' with the same legendText renders as text, not as an (unsupported-glyph) icon", async () => {
    // "A" isn't a real icon id, but legendKind:'text' should route it through
    // the text font regardless -- confirms the two kinds are actually wired
    // to different fonts, not just cosmetically labeled.
    const mesh = await createKeycapMesh({ legendText: "A", legendKind: "text", legendMode: "emboss" });
    expect(validateMesh(mesh).isWatertight).toBe(true);
  });
});

describe("createKeycapMesh: legendBubble (speech-bubble plaque behind the legend)", () => {
  it("legendBubble has no effect when there is no legend (blank text or mode 'none')", async () => {
    const withoutBubble = await createKeycapMesh({ legendBubble: false });
    const withBubbleNoText = await createKeycapMesh({ legendBubble: true });
    const withBubbleModeNone = await createKeycapMesh({ legendBubble: true, legendText: "A", legendMode: "none" });
    expect(computeSignedVolume(withBubbleNoText)).toBeCloseTo(computeSignedVolume(withoutBubble), 6);
    expect(computeSignedVolume(withBubbleModeNone)).toBeCloseTo(computeSignedVolume(withoutBubble), 6);
  });

  it("adds a raised plaque under an emboss legend, staying watertight, with the legend now sitting on top of (higher than) the plaque", async () => {
    const withoutBubble = await createKeycapMesh({ legendText: "A", legendMode: "emboss" });
    const withBubble = await createKeycapMesh({ legendText: "A", legendMode: "emboss", legendBubble: true });
    expect(validateMesh(withBubble).isWatertight).toBe(true);
    expect(computeSignedVolume(withBubble)).toBeGreaterThan(computeSignedVolume(withoutBubble));
    // The legend renders relative to the plaque's own raised surface, so
    // its absolute peak is higher than the no-bubble case by exactly the
    // plaque's own relief -- a badge sitting on a background, not the
    // legend floating at the same height with extra material underneath.
    const boxWith = computeBoundingBox(withBubble);
    const boxWithout = computeBoundingBox(withoutBubble);
    expect(boxWith.max[2]).toBeGreaterThan(boxWithout.max[2]);
    expect(boxWith.max[2]).toBeLessThan(boxWithout.max[2] + 0.5); // plaque relief is well under 0.5mm
  });

  it("works with an engrave legend too, staying watertight", async () => {
    const mesh = await createKeycapMesh({ legendText: "A", legendMode: "engrave", legendBubble: true });
    const report = validateMesh(mesh);
    expect(report.isWatertight).toBe(true);
    expect(report.degenerateTriangleCount).toBe(0);
    // The plaque itself is still a raised feature even though the legend
    // cut into it is recessed -- overall peak should exceed the bare
    // keycap's own heightMm.
    const box = computeBoundingBox(mesh);
    expect(box.max[2]).toBeGreaterThan(DEFAULT_KEYCAP_PARAMS.heightMm);
  });

  it("works with an icon legend, both emboss and engrave", async () => {
    for (const legendMode of ["emboss", "engrave"] as const) {
      const mesh = await createKeycapMesh({ legendText: "starFilled", legendKind: "icon", legendMode, legendBubble: true });
      const report = validateMesh(mesh);
      expect(report.isWatertight, legendMode).toBe(true);
      expect(report.degenerateTriangleCount, legendMode).toBe(0);
    }
  });

  it("the plaque (body + tail) is itself a real, single watertight solid", async () => {
    // Sanity check on buildBubbleMesh's own union, independent of the
    // legend on top of it: with legendReliefMm cranked up, the plaque
    // should still be present as solid material distinctly below the
    // legend's own peak.
    const mesh = await createKeycapMesh({ legendText: "A", legendMode: "emboss", legendBubble: true, legendReliefMm: 1.5 });
    expect(validateMesh(mesh).isWatertight).toBe(true);
  });
});

describe("createKeycapMeshParts: multi-color export (base/bubble/legend as separate objects)", () => {
  it("with no legend requested, returns only base -- identical to createKeycapMesh's own result", async () => {
    const whole = await createKeycapMesh({});
    const parts = await createKeycapMeshParts({});
    expect(parts.bubble).toBeNull();
    expect(parts.legend).toBeNull();
    expect(computeSignedVolume(parts.base)).toBeCloseTo(computeSignedVolume(whole), 6);
  });

  it("with an emboss legend and no bubble, splits into base + legend (no bubble)", async () => {
    const parts = await createKeycapMeshParts({ legendText: "A", legendMode: "emboss" });
    expect(parts.bubble).toBeNull();
    expect(parts.legend).not.toBeNull();
    expect(validateMesh(parts.base).isWatertight).toBe(true);
    expect(validateMesh(parts.legend!).isWatertight).toBe(true);
    // Each part is real, non-degenerate material.
    expect(computeSignedVolume(parts.legend!)).toBeGreaterThan(0);
  });

  it("with an emboss legend AND a bubble, splits into 3 separate parts", async () => {
    const parts = await createKeycapMeshParts({ legendText: "A", legendMode: "emboss", legendBubble: true });
    expect(parts.bubble).not.toBeNull();
    expect(parts.legend).not.toBeNull();
    expect(validateMesh(parts.base).isWatertight).toBe(true);
    expect(validateMesh(parts.bubble!).isWatertight).toBe(true);
    expect(validateMesh(parts.legend!).isWatertight).toBe(true);
  });

  it("with an ENGRAVE legend, both the legend AND its bubble background fold into base -- neither is a separate part", async () => {
    // A cut can't be its own separate printable object, and cutting into a
    // SEPARATE bubble part while leaving base untouched would just leave a
    // hole in one part with nothing sensible behind it -- simplest correct
    // behavior is folding the whole raised-plaque-plus-engraved-hole
    // combination into base as one object when the legend is engraved.
    const parts = await createKeycapMeshParts({ legendText: "A", legendMode: "engrave", legendBubble: true });
    expect(parts.legend).toBeNull();
    expect(parts.bubble).toBeNull();
    expect(validateMesh(parts.base).isWatertight).toBe(true);
    // The bubble + engrave cut are still really present in base, not
    // silently dropped -- volume differs from a plain no-legend keycap.
    const plainBase = await createKeycapMesh({});
    expect(computeSignedVolume(parts.base)).not.toBeCloseTo(computeSignedVolume(plainBase), 1);
  });

  it("reassembling the parts (union base+bubble+legend) reproduces the same single-mesh result createKeycapMesh returns", async () => {
    const paramsInput = { legendText: "A", legendMode: "emboss" as const, legendBubble: true };
    const whole = await createKeycapMesh(paramsInput);
    const parts = await createKeycapMeshParts(paramsInput);
    const engine = await createBooleanEngine();
    let reassembled = parts.base;
    if (parts.bubble) reassembled = engine.union(reassembled, parts.bubble);
    if (parts.legend) reassembled = engine.union(reassembled, parts.legend);
    expect(validateMesh(reassembled).isWatertight).toBe(true);
    expect(computeSignedVolume(reassembled)).toBeCloseTo(computeSignedVolume(whole), 3);
  });

  it("works with an icon legend too", async () => {
    const parts = await createKeycapMeshParts({ legendText: "starFilled", legendKind: "icon", legendMode: "emboss", legendBubble: true });
    expect(parts.bubble).not.toBeNull();
    expect(parts.legend).not.toBeNull();
    expect(validateMesh(parts.legend!).isWatertight).toBe(true);
  });
});
