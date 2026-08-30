/**
 * The curated pixel-art icon set matching a reference keycap-set mockup
 * (28 physical keycaps, pastel chat-bubble style with flat pixel-art icons:
 * smiley faces, hearts, stars, a music note, "HA HA"/"Z" text, etc.) --
 * built from scratch here rather than reused from a font, because that
 * mockup's icons are simple flat/bold silhouettes, not the thin multi-color
 * vector strokes an emoji font draws. Each icon is a boolean grid (row 0 =
 * top); `pixelTrace.ts` turns any grid into extrudable geometry, so this
 * file's only job is "is this pixel on or off", authored either by hand
 * (the two text glyphs) or generated from simple shape math sampled onto a
 * grid (everything else -- circles/stars/hearts drawn freehand as ASCII art
 * come out lumpy and asymmetric; sampling a formula does not).
 *
 * Every entry here narrower-in-detail than the reference photo (e.g. one
 * "heart" shape used at different sizes/relief settings, rather than 4
 * separate near-duplicate heart bitmaps for each keycap in the photo that
 * happens to use a different scale) -- the app's existing font-size/relief
 * controls already cover "same icon, different size", so duplicating a
 * bitmap per size would just be dead weight.
 */

type Grid = boolean[][];

const SHAPE_GRID_SIZE = 32;

/** Samples `test(u, v)` (u,v in roughly [-1, 1], v pointing UP) onto a
 *  `size`x`size` boolean grid -- the shared plumbing every geometric (as
 *  opposed to hand-drawn) icon below is built from. */
function sampleShape(test: (u: number, v: number) => boolean, size = SHAPE_GRID_SIZE): Grid {
  const grid: Grid = [];
  for (let r = 0; r < size; r++) {
    const row: boolean[] = [];
    const v = 1 - ((r + 0.5) / size) * 2;
    for (let c = 0; c < size; c++) {
      const u = ((c + 0.5) / size) * 2 - 1;
      row.push(test(u, v));
    }
    grid.push(row);
  }
  return grid;
}

/** Turns any filled-region test into a ring/outline test: on the boundary
 *  of the shape at scale 1, but not inside the same shape shrunk toward the
 *  origin by `innerScale` -- reused for every outline-style icon (heart,
 *  star, circle-O) instead of writing a bespoke ring formula per shape. */
function outlineOf(test: (u: number, v: number) => boolean, innerScale: number): (u: number, v: number) => boolean {
  return (u, v) => test(u, v) && !test(u / innerScale, v / innerScale);
}

function circleTest(cu: number, cv: number, r: number): (u: number, v: number) => boolean {
  return (u, v) => (u - cu) ** 2 + (v - cv) ** 2 <= r * r;
}

function unionTest(...tests: Array<(u: number, v: number) => boolean>): (u: number, v: number) => boolean {
  return (u, v) => tests.some((t) => t(u, v));
}

/** Point-in-polygon (ray casting) -- used for the star/chevron shapes. */
function polygonTest(points: Pt[]): (u: number, v: number) => boolean {
  return (u, v) => {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i];
      const [xj, yj] = points[j];
      const intersects = yi > v !== yj > v && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi;
      if (intersects) inside = !inside;
    }
    return inside;
  };
}

type Pt = [number, number];

/** An n-pointed star polygon, one point aimed straight up, alternating
 *  `outerR`/`innerR` vertices -- n=5 for a classic star, n=4 for a sparkle
 *  (diamond-ish 4-point burst), etc. */
function starPolygon(points: number, outerR: number, innerR: number, rotationRad = 0): Pt[] {
  const verts: Pt[] = [];
  const step = Math.PI / points;
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = -Math.PI / 2 + i * step + rotationRad;
    verts.push([r * Math.cos(angle), r * Math.sin(angle)]);
  }
  return verts;
}

function starTest(points: number, outerR: number, innerR: number, rotationRad = 0): (u: number, v: number) => boolean {
  return polygonTest(starPolygon(points, outerR, innerR, rotationRad));
}

/** Classic two-lobed heart silhouette: two circular lobes plus a triangular
 *  lower body, point aimed down (-v). */
function heartTest(scale = 1): (u: number, v: number) => boolean {
  const lobeR = 0.42 * scale;
  const lobeY = 0.32 * scale;
  const circles = unionTest(circleTest(-lobeR, lobeY, lobeR), circleTest(lobeR, lobeY, lobeR));
  const body = polygonTest([
    [-lobeR * 2, lobeY],
    [lobeR * 2, lobeY],
    [0, -1.05 * scale],
  ]);
  return unionTest(circles, body);
}

/** A solid downward arrow: a rectangular shaft plus a triangular head --
 *  reads more clearly as "arrow down" at icon scale than a hollow chevron. */
function arrowDownTest(): (u: number, v: number) => boolean {
  const shaft = polygonTest([
    [-0.3, 1.0],
    [0.3, 1.0],
    [0.3, -0.1],
    [-0.3, -0.1],
  ]);
  const head = polygonTest([
    [-0.65, -0.1],
    [0.65, -0.1],
    [0, -1.0],
  ]);
  return unionTest(shaft, head);
}

function musicNoteTest(): (u: number, v: number) => boolean {
  const head = circleTest(-0.15, -0.55, 0.4);
  const stem = polygonTest([
    [0.2, -0.35],
    [0.42, -0.35],
    [0.42, 0.85],
    [0.2, 0.85],
  ]);
  const flag = polygonTest([
    [0.42, 0.85],
    [0.9, 0.55],
    [0.9, 0.15],
    [0.42, 0.35],
  ]);
  return unionTest(head, stem, flag);
}

/** Four separated round lobes around a small stem -- distinct notches
 *  between lobes so it reads as a clover, not a single rounded blob (a
 *  bigger radius/overlap here just merges into a diamond shape). */
function cloverTest(): (u: number, v: number) => boolean {
  const r = 0.32;
  const d = 0.46;
  return unionTest(
    circleTest(0, d, r),
    circleTest(0, -d, r),
    circleTest(d, 0, r),
    circleTest(-d, 0, r),
    circleTest(0, 0, 0.16),
  );
}

function burstTest(petals: number): (u: number, v: number) => boolean {
  const tests: Array<(u: number, v: number) => boolean> = [circleTest(0, 0, 0.32)];
  for (let i = 0; i < petals; i++) {
    const angle = (i / petals) * Math.PI * 2 - Math.PI / 2;
    tests.push(circleTest(0.62 * Math.cos(angle), 0.62 * Math.sin(angle), 0.22));
  }
  return unionTest(...tests);
}

/** A classic light-bulb/idea silhouette: round glass, a short flared neck,
 *  and a screw-thread base (two thin notches cut into the base block). */
function bulbTest(): (u: number, v: number) => boolean {
  const glass = circleTest(0, 0.22, 0.5);
  const neck = polygonTest([
    [-0.24, 0.05],
    [0.24, 0.05],
    [0.3, -0.22],
    [-0.3, -0.22],
  ]);
  const base = polygonTest([
    [-0.3, -0.22],
    [0.3, -0.22],
    [0.26, -0.62],
    [-0.26, -0.62],
  ]);
  const threadGap = (u: number, v: number) => Math.abs(u) < 0.28 && (Math.abs(v + 0.34) < 0.035 || Math.abs(v + 0.48) < 0.035);
  return (u, v) => (glass(u, v) || neck(u, v) || base(u, v)) && !threadGap(u, v);
}

/** Two overlapping circle outlines side by side -- an approximate figure-8 /
 *  infinity symbol, close enough at icon scale to read clearly. */
function infinityTest(): (u: number, v: number) => boolean {
  const ring = (cu: number) => outlineOf(circleTest(cu, 0, 0.42), 0.55);
  return unionTest(ring(-0.4), ring(0.4));
}

/** A bold "X", built as two thick diagonal bars (distance from each
 *  diagonal's infinite line, clipped to the icon's square). */
function crossTest(): (u: number, v: number) => boolean {
  const thickness = 0.28;
  const nearDiagonal = (sign: 1 | -1) => (u: number, v: number) => Math.abs(u - sign * v) / Math.SQRT2 <= thickness;
  return unionTest(nearDiagonal(1), nearDiagonal(-1));
}

/** Just eyes + a mouth -- no surrounding face outline. The reference image
 *  draws these directly inside the (separately-rendered) chat-bubble
 *  background with no extra ring around the face itself; an outline circle
 *  here was extra geometry the reference never has. */
function faceTest(mouth: (u: number, v: number) => boolean): (u: number, v: number) => boolean {
  const eyeL = circleTest(-0.32, 0.35, 0.11);
  const eyeR = circleTest(0.32, 0.35, 0.11);
  return unionTest(eyeL, eyeR, mouth);
}

/** A short upward-curving arc (the bottom rim of a circle centered above
 *  the face's own center) -- the classic "cup" smile shape, clamped to a
 *  narrow band under the eyes so it reads as a mouth, not a full ring. */
function smileMouthTest(): (u: number, v: number) => boolean {
  const ring = outlineOf(circleTest(0, 0.5, 0.55), 0.82);
  return (u, v) => ring(u, v) && v < 0.15 && Math.abs(u) < 0.5;
}

function flatMouth(): (u: number, v: number) => boolean {
  return (u, v) => Math.abs(v + 0.35) < 0.06 && Math.abs(u) < 0.4;
}

/** Classic pixel-ghost silhouette: a domed head, straight sides, and a
 *  scalloped hem (3 rounded legs with gaps between them) -- unlike
 *  faceTest's bare eyes/mouth (no body outline, since a generic face relies
 *  on the separately-rendered chat-bubble for its shape), a ghost's body
 *  silhouette IS the point of the icon, so it gets a real outline here. */
function ghostBodyTest(): (u: number, v: number) => boolean {
  const domeR = 0.72;
  const domeCy = 0.05;
  const dome = circleTest(0, domeCy, domeR);
  const rect = polygonTest([
    [-domeR, domeCy],
    [domeR, domeCy],
    [domeR, -0.5],
    [-domeR, -0.5],
  ]);
  const legR = 0.24;
  const legY = -0.5;
  const legs = unionTest(circleTest(-0.48, legY, legR), circleTest(0, legY, legR), circleTest(0.48, legY, legR));
  return unionTest(dome, rect, legs);
}

/** A bold X mark (two crossing diagonal bars clipped to a square) -- used
 *  for the angry ghost's eyes. */
function xMarkTest(cu: number, cv: number, size: number, thickness: number): (u: number, v: number) => boolean {
  return (u, v) => {
    const du = u - cu;
    const dv = v - cv;
    if (Math.abs(du) > size || Math.abs(dv) > size) return false;
    return Math.abs(du - dv) <= thickness || Math.abs(du + dv) <= thickness;
  };
}

/** A wide flat mouth with two small notches cut into its lower edge --
 *  reads as a grimacing/toothy frown at icon scale. */
function angryMouthTest(): (u: number, v: number) => boolean {
  return polygonTest([
    [-0.3, -0.05],
    [0.3, -0.05],
    [0.3, -0.22],
    [0.15, -0.22],
    [0.15, -0.3],
    [0.05, -0.3],
    [0.05, -0.22],
    [-0.05, -0.22],
    [-0.05, -0.3],
    [-0.15, -0.3],
    [-0.15, -0.22],
    [-0.3, -0.22],
  ]);
}

/** Eyes/mouth cut as recessed holes out of the solid ghost body (as opposed
 *  to faceTest's bare eyes/mouth with no body) -- matches the reference
 *  angry-ghost keycap: a raised white body with dark facial features. */
function ghostAngryTest(): (u: number, v: number) => boolean {
  const body = ghostBodyTest();
  const eyeL = xMarkTest(-0.3, 0.12, 0.2, 0.085);
  const eyeR = xMarkTest(0.3, 0.12, 0.2, 0.085);
  const mouth = angryMouthTest();
  return (u, v) => body(u, v) && !(eyeL(u, v) || eyeR(u, v) || mouth(u, v));
}

/** 5x7 pixel glyphs for the one bit of text drawn as a genuine blocky
 *  bitmap -- "HA HA" is the only text-as-icon in the reference image that
 *  actually reads as pixel-font/8-bit style; "Z"/"?"/"!"/"$" are clean
 *  smooth typography there instead, so those are rendered straight from
 *  the ordinary legend text font (see buildLegendMesh's fallback order in
 *  keycap.ts) rather than duplicated here as cruder bitmaps. */
const FONT_5X7: Record<string, string[]> = {
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
};

function parseRows(rows: string[]): Grid {
  return rows.map((row) => row.split("").map((ch) => ch === "#"));
}

function hcat(...grids: Grid[]): Grid {
  const height = grids[0].length;
  const rows: boolean[][] = [];
  for (let r = 0; r < height; r++) {
    let row: boolean[] = [];
    grids.forEach((g, i) => {
      if (i > 0) row.push(false);
      row = row.concat(g[r]);
    });
    rows.push(row);
  }
  return rows;
}

function vcat(...grids: Grid[]): Grid {
  const width = grids[0][0].length;
  const blank: boolean[] = new Array(width).fill(false);
  let rows: boolean[][] = [];
  grids.forEach((g, i) => {
    if (i > 0) rows.push(blank);
    rows = rows.concat(g);
  });
  return rows;
}

function glyph(ch: string): Grid {
  return parseRows(FONT_5X7[ch]);
}

const HAHA_GRID: Grid = vcat(hcat(glyph("H"), glyph("A")), hcat(glyph("H"), glyph("A")));

export const PIXEL_ICON_GRIDS: Record<string, Grid> = {
  smiley: sampleShape(faceTest(smileMouthTest())),
  neutralFace: sampleShape(faceTest(flatMouth())),
  haha: HAHA_GRID,
  sparkle: sampleShape(starTest(4, 0.95, 0.32)),
  heart: sampleShape(outlineOf(heartTest(), 0.45)),
  heartFilled: sampleShape(heartTest()),
  brokenHeart: sampleShape((u, v) => heartTest()(u, v) && Math.abs(u - 0.12 * Math.sin(v * 6)) > 0.06),
  // No plain "star" outline variant: a uniformly-shrunk copy of a 5-point
  // star's own reflex (concave) corners produces a hole that self-touches
  // the outer boundary there, which earcut can't triangulate into a closed
  // solid at any tested resolution/thickness -- starFilled (solid, no hole)
  // sidesteps the whole problem and is the more prominent treatment in the
  // reference image anyway (the bold row-4 star, not the thin outline one).
  starFilled: sampleShape(starTest(5, 0.95, 0.42)),
  bulb: sampleShape(bulbTest()),
  sparkleCluster: sampleShape(
    unionTest(starTest(4, 0.55, 0.18, 0), (u, v) => starTest(4, 0.3, 0.1)(u - 0.55, v + 0.5), (u, v) => starTest(4, 0.3, 0.1)(u + 0.55, v - 0.4)),
  ),
  music: sampleShape(musicNoteTest()),
  clover: sampleShape(cloverTest()),
  arrowDown: sampleShape(arrowDownTest()),
  splash: sampleShape(burstTest(6)),
  infinity: sampleShape(infinityTest()),
  cross: sampleShape(crossTest()),
  circleO: sampleShape(outlineOf(circleTest(0, 0, 0.9), 0.55)),
  sparklingHeart: sampleShape(
    unionTest(heartTest(0.75), (u, v) => starTest(4, 0.22, 0.08)(u - 0.95, v - 0.75), (u, v) => starTest(4, 0.16, 0.06)(u - 1.05, v - 0.25)),
  ),
  ghostAngry: sampleShape(ghostAngryTest()),
};

export function getPixelIconGrid(id: string): Grid | null {
  return PIXEL_ICON_GRIDS[id] ?? null;
}
