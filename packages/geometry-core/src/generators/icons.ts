/**
 * The curated set of icons available in the icon legend picker -- two sets
 * merged into one list:
 *
 * 1. Pixel-art icons (ids below with no "legacy" prefix): `char` is just
 *    this icon's own id string, used as the lookup key into
 *    `pixelIcons.ts`'s `PIXEL_ICON_GRIDS`. Matches a reference keycap-set
 *    mockup's flat pixel-art style.
 * 2. The original emoji-font icons (ids prefixed "legacy"), restored
 *    alongside the pixel set rather than replaced by it: `char` here is a
 *    literal Unicode character embedded in the Noto Emoji subset (see
 *    iconFontData.ts/NOTICE.md).
 *
 * `buildLegendMesh` (keycap.ts) tries the pixel-icon lookup by `char`
 * first and falls back to the emoji font, which is why the two sets can
 * safely share the one `legendText`/`char` storage field: a pixel id
 * ("smiley") and a Unicode character ("☺") never collide as lookup keys.
 * `id`, however, only needs to be unique for UI purposes (React keys,
 * data-testid, the Vietnamese label map in KeycapPanel.tsx) -- several
 * concepts exist in both sets (smiley, heart, music, ...), so every legacy
 * entry's `id` is prefixed to keep the combined list's ids unique even
 * though its `char` (the real lookup key) is untouched.
 */
export interface IconOption {
  id: string;
  char: string;
  label: string;
}

const PIXEL_ICON_OPTIONS: IconOption[] = [
  { id: "smiley", char: "smiley", label: "Smiley" },
  { id: "neutralFace", char: "neutralFace", label: "Neutral face" },
  { id: "haha", char: "haha", label: "Haha" },
  { id: "sparkle", char: "sparkle", label: "Sparkle" },
  { id: "heart", char: "heart", label: "Heart (outline)" },
  { id: "heartFilled", char: "heartFilled", label: "Heart" },
  { id: "brokenHeart", char: "brokenHeart", label: "Broken heart" },
  { id: "starFilled", char: "starFilled", label: "Star" },
  { id: "bulb", char: "bulb", label: "Bulb / idea" },
  { id: "sparkleCluster", char: "sparkleCluster", label: "Sparkles" },
  { id: "music", char: "music", label: "Music note" },
  { id: "dollar", char: "$", label: "Dollar" },
  { id: "clover", char: "clover", label: "Clover" },
  { id: "arrowDown", char: "arrowDown", label: "Arrow down" },
  // "sleepZ"/"question"/"exclamation"/"dollar" (below) are rendered from
  // the ordinary legend TEXT font instead of a pixel bitmap -- see
  // buildLegendMesh's fallback order in keycap.ts. The reference mockup
  // draws these as clean, smooth typography (unlike "haha", which is
  // genuinely blocky pixel-font style there), so a hand-drawn low-res
  // bitmap looked visibly cruder than just reusing the real font glyph.
  { id: "sleepZ", char: "Z", label: "Sleep (Z)" },
  { id: "question", char: "?", label: "Question" },
  { id: "exclamation", char: "!", label: "Exclamation" },
  { id: "splash", char: "splash", label: "Splash" },
  { id: "infinity", char: "infinity", label: "Infinity" },
  { id: "cross", char: "cross", label: "Cross" },
  { id: "circleO", char: "circleO", label: "Circle" },
  { id: "sparklingHeart", char: "sparklingHeart", label: "Sparkling heart" },
  { id: "ghostAngry", char: "ghostAngry", label: "Angry ghost" },
];

/**
 * This list is narrower than "every emoji anyone might ask for" -- it's
 * every candidate that was actually test-extruded and confirmed to produce
 * a clean, watertight solid. Noto Emoji's outline font draws some of its
 * more elaborate glyphs (skull, trophy, cat face, crown, rocket, sleeping
 * face, two-hearts/revolving-hearts, laughing/crying faces, a "cyclone"
 * spiral, and others) with self-intersecting compound strokes that this
 * generator's even-odd island/hole grouping can't triangulate into a single
 * manifold shape -- those were tried and dropped, not omitted by oversight.
 */
const LEGACY_EMOJI_ICON_OPTIONS: IconOption[] = [
  { id: "legacyCheck", char: "✅", label: "Check" },
  { id: "legacyCross", char: "❌", label: "Cross" },
  // These four render as a hollow/outline shape in this specific Noto
  // Emoji glyph (a ring/band, not a solid fill) -- confirmed by rasterizing
  // each glyph's actual fill (see the flattened-contour even-odd fill in
  // glyphOutline.ts): the glyph's own path data has a same-shape inner
  // subpath wound opposite the outer one, carving the whole interior out
  // rather than just a small facial-feature-style detail. Kept (they're
  // still valid, printable, closed geometry) but labeled "(viền)" in the
  // Vietnamese UI so picking one doesn't look like a rendering bug -- a
  // user wanting a SOLID star/heart should reach for starFilled/heartFilled
  // (pixel-art set) instead.
  { id: "legacyStar", char: "⭐", label: "Star (outline)" },
  { id: "legacyHeart", char: "❤", label: "Heart" },
  { id: "legacyQuestion", char: "❓", label: "Question" },
  { id: "legacyMusic", char: "\u{1F3B5}", label: "Music note" },
  { id: "legacyDollar", char: "\u{1F4B2}", label: "Dollar" },
  { id: "legacyGhost", char: "\u{1F47B}", label: "Ghost" },
  { id: "legacyFire", char: "\u{1F525}", label: "Fire" },
  { id: "legacyBolt", char: "⚡", label: "Lightning" },
  { id: "legacyController", char: "\u{1F3AE}", label: "Game controller" },
  { id: "legacyDice", char: "\u{1F3B2}", label: "Dice" },
  { id: "legacyDog", char: "\u{1F436}", label: "Dog" },
  { id: "legacyMoon", char: "\u{1F319}", label: "Moon" },
  { id: "legacySmiley", char: "☺", label: "Smiley" },
  { id: "legacySun", char: "☀", label: "Sun" },
  { id: "legacyGem", char: "\u{1F48E}", label: "Gem" },
  { id: "legacyKey", char: "\u{1F511}", label: "Key" },
  { id: "legacyLock", char: "\u{1F512}", label: "Lock" },
  { id: "legacyGear", char: "⚙", label: "Gear" },
  { id: "legacyAnchor", char: "⚓", label: "Anchor" },
  { id: "legacySnowflake", char: "❄", label: "Snowflake" },
  { id: "legacyFrown", char: "☹", label: "Frown" },
  { id: "legacyBrokenHeart", char: "\u{1F494}", label: "Broken heart (outline)" },
  { id: "legacySparkles", char: "✨", label: "Sparkles" },
  { id: "legacyExclamation", char: "❗", label: "Exclamation" },
  { id: "legacyDoubleExclamation", char: "‼", label: "Double exclamation" },
  { id: "legacyArrowDown", char: "⬇", label: "Arrow down" },
  { id: "legacyInfinity", char: "♾", label: "Infinity" },
  { id: "legacyCircle", char: "⭕", label: "Circle" },
  { id: "legacyClub", char: "♣", label: "Club" },
  { id: "legacySparklingHeart", char: "\u{1F496}", label: "Sparkling heart (outline)" },
  { id: "legacyChatBubble", char: "\u{1F4AC}", label: "Chat bubble (outline)" },
  { id: "legacyCollision", char: "\u{1F4A2}", label: "Collision / anger" },
];

export const ICON_OPTIONS: IconOption[] = [...PIXEL_ICON_OPTIONS, ...LEGACY_EMOJI_ICON_OPTIONS];
