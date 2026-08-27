/**
 * The curated set of icons available in the icon/emoji legend picker. Each
 * entry's `char` is the exact emoji character embedded in the Noto Emoji
 * subset (see iconFontData.ts/NOTICE.md) -- adding an icon here requires
 * re-subsetting that font to include the new glyph, it isn't automatic.
 *
 * This list is narrower than "every emoji anyone might ask for" -- it's
 * every candidate that was actually test-extruded and confirmed to produce
 * a clean, watertight solid. Noto Emoji's outline font draws some of its
 * more elaborate glyphs (skull, trophy, cat face, crown, rocket, sleeping
 * face, two-hearts/revolving-hearts, laughing/crying faces, a "cyclone"
 * spiral, and others) with self-intersecting compound strokes that this
 * generator's even-odd island/hole grouping can't triangulate into a single
 * manifold shape -- those were tried and dropped, not omitted by oversight.
 */
export interface IconOption {
  id: string;
  char: string;
  label: string;
}

export const ICON_OPTIONS: IconOption[] = [
  { id: "check", char: "✅", label: "Check" },
  { id: "cross", char: "❌", label: "Cross" },
  { id: "star", char: "⭐", label: "Star" },
  { id: "heart", char: "❤", label: "Heart" },
  { id: "question", char: "❓", label: "Question" },
  { id: "music", char: "\u{1F3B5}", label: "Music note" },
  { id: "dollar", char: "\u{1F4B2}", label: "Dollar" },
  { id: "ghost", char: "\u{1F47B}", label: "Ghost" },
  { id: "fire", char: "\u{1F525}", label: "Fire" },
  { id: "bolt", char: "⚡", label: "Lightning" },
  { id: "controller", char: "\u{1F3AE}", label: "Game controller" },
  { id: "dice", char: "\u{1F3B2}", label: "Dice" },
  { id: "dog", char: "\u{1F436}", label: "Dog" },
  { id: "moon", char: "\u{1F319}", label: "Moon" },
  { id: "smiley", char: "☺", label: "Smiley" },
  { id: "sun", char: "☀", label: "Sun" },
  { id: "gem", char: "\u{1F48E}", label: "Gem" },
  { id: "key", char: "\u{1F511}", label: "Key" },
  { id: "lock", char: "\u{1F512}", label: "Lock" },
  { id: "gear", char: "⚙", label: "Gear" },
  { id: "anchor", char: "⚓", label: "Anchor" },
  { id: "snowflake", char: "❄", label: "Snowflake" },
  { id: "frown", char: "☹", label: "Frown" },
  { id: "brokenHeart", char: "\u{1F494}", label: "Broken heart" },
  { id: "sparkles", char: "✨", label: "Sparkles" },
  { id: "exclamation", char: "❗", label: "Exclamation" },
  { id: "doubleExclamation", char: "‼", label: "Double exclamation" },
  { id: "arrowDown", char: "⬇", label: "Arrow down" },
  { id: "infinity", char: "♾", label: "Infinity" },
  { id: "circle", char: "⭕", label: "Circle" },
  { id: "club", char: "♣", label: "Club" },
  { id: "sparklingHeart", char: "\u{1F496}", label: "Sparkling heart" },
  { id: "chatBubble", char: "\u{1F4AC}", label: "Chat bubble" },
];
